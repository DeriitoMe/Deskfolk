import test from 'node:test';
import assert from 'node:assert/strict';
import type { PetEvent } from '../shared/types';
import { dominantActivity, shouldCelebrateCompletion, updateSessionActivities, type SessionActivities } from '../shared/activity.ts';
import { shouldPresentAcceptedEvent } from './event-presentation.ts';
import { DEEPSEEK_HARNESS_LEASE_MS, DeepSeekHarnessAdapter, deepSeekCompletionOutcome,
  parseDeepSeekHarnessEnvelope, type DeepSeekHarnessEventInput } from './deepseek-harness.ts';

const S = '11111111-2222-3333-4444-555555555555';
const raw = (event: string, sequence: number, extra: Record<string, unknown> = {}) => ({
  version: 1, streamId: 'stream-a', sessionId: S, sequence, time: 1_000,
  turn: 1, event, origin: 'main', cwd: 'D:\\Work\\Deskfolk', ...extra,
});
const snapshot = (sequence: number, extra: Record<string, unknown> = {}) =>
  raw('snapshot', sequence, { status: 'running', pendingInputs: [], ...extra });
const event = (input: DeepSeekHarnessEventInput): PetEvent => ({ ...input, source: 'deepseek-harness',
  createdAt: new Date().toISOString(), read: false });

function consume(inputs: DeepSeekHarnessEventInput[], previous: SessionActivities = {}) {
  let sessions = previous;
  const presented: PetEvent[] = [], celebrated: PetEvent[] = [];
  for (const input of inputs) {
    const e = event(input), before = sessions;
    const celebrate = shouldCelebrateCompletion(sessions, e);
    sessions = updateSessionActivities(sessions, e);
    const changed = JSON.stringify(dominantActivity(before)) !== JSON.stringify(dominantActivity(sessions));
    if (shouldPresentAcceptedEvent(e, before, sessions, changed, Date.now())) {
      presented.push(e); if (celebrate) celebrated.push(e);
    }
  }
  return { sessions, phase: dominantActivity(sessions).phase, presented, celebrated };
}

test('a dedicated initial snapshot adopts a stream; live events alone cannot claim a session', () => {
  const a = new DeepSeekHarnessAdapter();
  assert.deepEqual(a.translate(raw('turn/start', 1)), []);
  const restored = consume(a.translate(snapshot(1), 0));
  assert.equal(restored.phase, 'working');
  assert.deepEqual(restored.presented, [], 'catch-up must stay silent');
  assert.equal(Object.keys(restored.sessions)[0], 'deepseek-harness:' + S);
});

test('a new real turn starts work and completed celebrates once', () => {
  const a = new DeepSeekHarnessAdapter();
  let r = consume(a.translate(snapshot(1, { turn: 0, status: 'idle' })));
  r = consume(a.translate(raw('turn/start', 2)), r.sessions);
  assert.equal(r.phase, 'working');
  assert.deepEqual(r.presented.map(e => e.type), ['work_started']);
  assert.equal(r.presented[0].project, 'Deskfolk');
  r = consume(a.translate(raw('turn/end', 3, { reason: 'completed' })), r.sessions);
  assert.equal(r.phase, 'idle');
  assert.equal(r.celebrated.length, 1);
  assert.deepEqual(a.translate(raw('turn/end', 3, { reason: 'completed' })), []);
  assert.deepEqual(a.translate(raw('turn/end', 4, { reason: 'completed' })), []);
});

test('questions and permissions use independent native identities; a reply dismisses only itself', () => {
  const a = new DeepSeekHarnessAdapter();
  let r = consume(a.translate(snapshot(1)));
  r = consume(a.translate(raw('input/required', 2, { callId: 'q1', kind: 'question' })), r.sessions);
  r = consume(a.translate(raw('input/required', 3, { callId: 'a1', kind: 'approval' })), r.sessions);
  assert.equal(r.phase, 'asking');
  assert.equal(r.presented[0].nativeQuestion, true);
  assert.match(r.presented[0].message!, /权限/);
  assert.deepEqual(a.translate(raw('input/resolved', 4, { callId: 'unknown' })), []);
  r = consume(a.translate(raw('input/resolved', 5, { callId: 'q1' })), r.sessions);
  assert.equal(r.phase, 'asking');
  assert.deepEqual(r.sessions['deepseek-harness:' + S].pendingInputIds, ['a1']);
  r = consume(a.translate(raw('input/resolved', 6, { callId: 'a1' })), r.sessions);
  assert.equal(r.phase, 'working');
});

test('late older turn ends and replies never erase a newer reminder, even with higher transport sequence', () => {
  const a = new DeepSeekHarnessAdapter();
  let r = consume(a.translate(snapshot(1)));
  r = consume(a.translate(raw('turn/start', 2, { turn: 2 })), r.sessions);
  r = consume(a.translate(raw('input/required', 3, { turn: 2, callId: 'current', kind: 'question' })), r.sessions);
  for (const late of [raw('turn/end', 8, { reason: 'completed' }),
    raw('input/resolved', 9, { callId: 'current' }), snapshot(10, { status: 'idle' })]) {
    assert.deepEqual(a.translate(late), []);
  }
  r = consume(a.translate(snapshot(4, { turn: 2, status: 'asking', pendingInputs: [{ id: 'current', kind: 'question' }] })), r.sessions);
  assert.equal(r.phase, 'asking');
  assert.deepEqual(r.sessions['deepseek-harness:' + S].pendingInputIds, ['current']);
});

test('pet restart snapshots restore working, asking and idle without replaying celebrations', () => {
  let persisted: SessionActivities = {};
  const first = new DeepSeekHarnessAdapter();
  persisted = consume(first.translate(snapshot(1, { turn: 3 })), persisted).sessions;
  persisted = consume(first.translate(raw('input/required', 2, { turn: 3, callId: 'old', kind: 'question' })), persisted).sessions;
  for (const [status, pendingInputs, phase] of [
    ['running', [], 'working'], ['asking', [{ id: 'new', kind: 'approval' }], 'asking'], ['idle', [], 'idle'],
  ] as const) {
    const restarted = new DeepSeekHarnessAdapter();
    const r = consume(restarted.translate(snapshot(5, { turn: 3, status, pendingInputs,
      reason: status === 'idle' ? 'completed' : undefined })), persisted);
    assert.equal(r.phase, phase); assert.equal(r.celebrated.length, 0); assert.equal(r.presented.length, 0);
  }
  const newer = consume(new DeepSeekHarnessAdapter().translate(snapshot(9, { turn: 4, status: 'idle', reason: 'completed' })), persisted);
  assert.equal(newer.phase, 'idle');
  assert.equal(newer.sessions['deepseek-harness:' + S].turnId, 'turn:4');
  assert.equal(newer.celebrated.length, 0);
});

test('async question turns remain asking after completed and become idle on their own reply', () => {
  const a = new DeepSeekHarnessAdapter();
  let r = consume(a.translate(snapshot(1, { status: 'asking', pendingInputs: [{ id: 'q', kind: 'question' }] })));
  r = consume(a.translate(raw('turn/end', 2, { reason: 'completed' })), r.sessions);
  assert.equal(r.phase, 'asking'); assert.equal(r.celebrated.length, 0);
  r = consume(a.translate(raw('input/resolved', 3, { callId: 'q' })), r.sessions);
  assert.equal(r.phase, 'idle');
  const restored = consume(new DeepSeekHarnessAdapter().translate(snapshot(4, { status: 'asking',
    turnComplete: true, reason: 'completed', pendingInputs: [{ id: 'q', kind: 'question' }] })));
  assert.equal(restored.phase, 'asking'); assert.equal(restored.celebrated.length, 0);
});

test('late duplicate requests cannot reopen a resolved native dialog', () => {
  const a = new DeepSeekHarnessAdapter();
  a.translate(snapshot(1));
  a.translate(raw('input/resolved', 2, { callId: 'q' }));
  assert.deepEqual(a.translate(raw('input/required', 3, { callId: 'q', kind: 'question' })), []);
  a.translate(raw('input/required', 4, { callId: 'q2', kind: 'question' }));
  a.translate(raw('input/resolved', 5, { callId: 'q2' }));
  assert.deepEqual(a.translate(raw('input/required', 6, { callId: 'q2', kind: 'question' })), []);
});

test('cancellation, yielding, errors and real account quotas are never success', () => {
  for (const [reason, errorCode, outcome] of [
    ['aborted', undefined, 'interrupted'], ['blocked', undefined, 'interrupted'],
    ['forked', undefined, 'interrupted'], ['interrupted', undefined, 'interrupted'],
    ['max-tokens', undefined, 'failed'], ['error', 'RATE_LIMIT', 'failed'],
    ['error', 'QUOTA', 'quota_exhausted'], ['error', 'ACCOUNT_QUOTA', 'quota_exhausted'],
  ] as const) {
    const a = new DeepSeekHarnessAdapter();
    let r = consume(a.translate(snapshot(1, { status: 'asking', pendingInputs: [{ id: 'q', kind: 'question' }] })));
    r = consume(a.translate(raw('turn/end', 2, { reason, errorCode })), r.sessions);
    assert.equal(r.phase, 'idle'); assert.equal(r.celebrated.length, 0);
    assert.equal(r.presented.at(-1)?.outcome, outcome);
  }
  assert.equal(deepSeekCompletionOutcome('error', 'random'), 'failed');
});

test('subagents never make a working project or parent celebration; fork lineage alone is ignored', () => {
  const a = new DeepSeekHarnessAdapter();
  let r = consume(a.translate(snapshot(1, { origin: 'subagent' })));
  assert.equal(r.phase, 'idle');
  r = consume(a.translate(raw('turn/end', 2, { origin: 'subagent', reason: 'completed' })), r.sessions);
  assert.equal(r.celebrated.length, 0);
  const fork = consume(new DeepSeekHarnessAdapter().translate(snapshot(1, { parentSession: 'a-fork-source' })));
  assert.equal(fork.phase, 'working');
});

test('new streams require snapshots and permanently retire older stream messages', () => {
  const a = new DeepSeekHarnessAdapter();
  a.translate(snapshot(8));
  assert.deepEqual(a.translate(raw('turn/start', 1, { streamId: 'stream-b', turn: 2 })), []);
  const adopted = a.translate(snapshot(1, { streamId: 'stream-b', turn: 2 }));
  assert.ok(adopted.length);
  assert.deepEqual(a.translate(snapshot(999, { turn: 3 })), []);
  assert.deepEqual(a.translate(raw('input/required', 999, { turn: 2, callId: 'stale', kind: 'question' })), []);
  assert.deepEqual(a.translate(snapshot(1, { streamId: 'older-stream', turn: 1 })), []);
});

test('lost heartbeat silently clears work and questions; a current snapshot restores them', () => {
  const a = new DeepSeekHarnessAdapter();
  let r = consume(a.translate(snapshot(1, { status: 'asking', pendingInputs: [{ id: 'q', kind: 'question' }] }), 0));
  assert.deepEqual(a.expire(DEEPSEEK_HARNESS_LEASE_MS), []);
  r = consume(a.expire(DEEPSEEK_HARNESS_LEASE_MS + 1), r.sessions);
  assert.equal(r.phase, 'idle'); assert.equal(r.presented.length, 0);
  assert.deepEqual(a.expire(DEEPSEEK_HARNESS_LEASE_MS * 2), []);
  r = consume(a.translate(snapshot(2, { status: 'asking', pendingInputs: [{ id: 'q', kind: 'question' }] }), 50_000), r.sessions);
  assert.equal(r.phase, 'asking'); assert.equal(r.presented.length, 0);
});

test('disposal clears pending dialogs silently and duplicate starts cannot resurrect a terminal turn', () => {
  const a = new DeepSeekHarnessAdapter();
  let r = consume(a.translate(snapshot(1, { status: 'asking', pendingInputs: [{ id: 'q', kind: 'question' }] })));
  r = consume(a.translate(raw('agent/disposed', 2)), r.sessions);
  assert.equal(r.phase, 'idle'); assert.equal(r.presented.length, 0);
  assert.deepEqual(a.translate(raw('turn/start', 3)), []);
  assert.deepEqual(a.translate(raw('input/required', 4, { callId: 'disposed-question', kind: 'question' })), []);
});

test('real native evidence after a lease lapse can finish the same resumed turn once', () => {
  const a = new DeepSeekHarnessAdapter();
  let r = consume(a.translate(snapshot(1), 0));
  r = consume(a.expire(DEEPSEEK_HARNESS_LEASE_MS + 1), r.sessions);
  assert.equal(r.phase, 'idle');
  r = consume(a.translate(raw('turn/end', 2, { reason: 'completed' }), 30_000), r.sessions);
  assert.equal(r.phase, 'idle'); assert.equal(r.celebrated.length, 1);
  assert.deepEqual(a.translate(raw('turn/end', 3, { reason: 'completed' }), 30_001), []);
});

test('strict envelope validation discards arbitrary content and malformed identities', () => {
  const parsed = parseDeepSeekHarnessEnvelope(snapshot(1, { prompt: 'secret', arguments: 'secret', answer: 'secret' }))!;
  for (const key of ['prompt', 'arguments', 'answer']) assert.equal(key in parsed, false);
  for (const bad of [null, [], {}, snapshot(1, { version: 2 }), snapshot(1, { streamId: '' }),
    snapshot(1, { origin: 'fork' }), snapshot(1, { sequence: NaN }), snapshot(1, { time: Infinity }),
    snapshot(1, { turn: -1 }), snapshot(1, { status: 'asking' }),
    snapshot(1, { pendingInputs: [{ id: 'q', kind: 'question' }] }),
    raw('input/required', 2, { callId: 'q' }), raw('tool/call', 2, { callId: 'x' }),
    snapshot(1, { pendingInputs: [], activeTools: [{ id: 'tool', name: '' }] })]) {
    assert.equal(parseDeepSeekHarnessEnvelope(bad), undefined);
  }
});

test('real Harness observer envelopes drive native work, tool, permission and completion end to end', async () => {
  const moduleUrl = new URL('../plugins/deskfolk-deepseek-harness/plugin.mjs', import.meta.url).href;
  const { HarnessObserver } = await import(moduleUrl);
  const nativeEvents: unknown[] = [];
  const session = { id: S, header: { cwd: 'D:/Work/Deskfolk' }, inheritedEventCount: 0,
    snapshotEvents: (from: number) => nativeEvents.slice(from) };
  const agent = { session, status: 'idle' };
  const ctx = { agents: { get: () => agent, list: () => [agent] }, sessions: { list: () => [session] },
    sessionProjections: { snapshot: () => ({ values: { userQuestions: { active: [] } } }) } };
  const a = new DeepSeekHarnessAdapter();
  let sessions: SessionActivities = {};
  const shown: PetEvent[] = [], celebrated: PetEvent[] = [];
  const observer = new HarnessObserver(ctx, (body: unknown) => {
    const result = consume(a.translate(JSON.parse(JSON.stringify(body))), sessions);
    sessions = result.sessions; shown.push(...result.presented); celebrated.push(...result.celebrated);
  }, { now: () => 1_000, streamId: 'observer-stream' });
  const append = (type: string, data: unknown) => {
    const native = { type, data, seq: nativeEvents.length, time: 1_000 };
    nativeEvents.push(native); observer.observe(session, native);
  };
  observer.state(session);
  agent.status = 'running'; append('turn/start', { turn: 1 });
  assert.equal(dominantActivity(sessions).phase, 'working');
  assert.deepEqual(shown.map(e => e.type), ['work_started']);
  append('approval/asked', { id: 'approval', toolName: 'bash', reason: 'PRIVATE_COMMAND' });
  assert.equal(dominantActivity(sessions).phase, 'asking');
  append('approval/decided', { id: 'approval', outcome: 'allowed-once' });
  assert.equal(dominantActivity(sessions).phase, 'working');
  const nativeResult = { content: 'PRIVATE_RESULT' };
  assert.equal(await observer.tool({ agent, name: 'bash', callId: 'tool', arguments: 'PRIVATE_ARGUMENT' },
    async () => nativeResult), nativeResult);
  append('turn/end', { turn: 1, reason: { kind: 'completed' } });
  agent.status = 'idle'; observer.heartbeat();
  assert.equal(dominantActivity(sessions).phase, 'idle');
  assert.equal(celebrated.length, 1);
  assert.doesNotMatch(JSON.stringify(shown), /PRIVATE_/);
});
