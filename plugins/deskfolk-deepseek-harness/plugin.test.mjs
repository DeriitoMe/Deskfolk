import test from 'node:test';
import assert from 'node:assert/strict';
import { HarnessObserver } from './plugin.mjs';
import { parseDeepSeekHarnessEnvelope } from '../../electron/deepseek-harness.ts';

function fixture({ header = {}, events = [], active = [] } = {}) {
  const session = { id: 'session', header: { cwd: 'D:/sample', ...header }, inheritedEventCount: 0,
    snapshotEvents: from => events.slice(from) };
  const agent = { session, status: 'idle' }, sent = [];
  const ctx = { agents: { get: () => agent, list:()=>[agent] }, sessions: { list: () => [session] },
    sessionProjections: { snapshot: () => ({ values: { userQuestions: { active } } }) } };
  const observer = new HarnessObserver(ctx, body => {
    const serialized = JSON.parse(JSON.stringify(body));
    assert.ok(parseDeepSeekHarnessEnvelope(serialized), `valid wire envelope: ${body.event}`);
    sent.push(serialized);
  }, { now: () => 100_000, streamId: 'stream' });
  const append = (type, data) => {
    const event = { type, data, seq: events.length, time: 99_999 }; events.push(event);
    observer.observe(session, event); return event;
  };
  const start = (turn = 1) => { observer.state(session); agent.status = 'running'; append('turn/start', { turn }); };
  return { session, agent, sent, observer, append, start, active };
}

test('adoption and full snapshots forward lifecycle metadata only, with ordered sequences', () => {
  const f = fixture({ events: [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'user/message', data: { content: 'PRIVATE_PROMPT', source: { kind: 'human' } } },
    { type: 'tool/call', data: { arguments: 'PRIVATE_TOOL_ARGUMENTS' } },
  ] });
  f.agent.status = 'running'; f.observer.heartbeat();
  assert.equal(f.sent[0].event, 'snapshot');
  assert.equal(f.sent[0].status, 'running');
  assert.equal(f.sent[0].turn, 1);
  assert.deepEqual(f.sent.map(e => e.sequence), [1, 2]);
  assert.doesNotMatch(JSON.stringify(f.sent), /PRIVATE_/);
});

test('native approvals are paired independently and never forward the permission reason', () => {
  const f = fixture(); f.start();
  f.append('approval/asked', { id: 'one', reason: 'PRIVATE_COMMAND' });
  f.append('approval/asked', { id: 'two' });
  assert.equal(f.sent.at(-1).status, 'asking');
  f.append('approval/decided', { id: 'one', outcome: 'allowed-once' });
  f.observer.heartbeat();
  assert.deepEqual(f.sent.at(-1).pendingInputs, [{ id: 'approval:two', kind: 'approval' }]);
  assert.doesNotMatch(JSON.stringify(f.sent), /PRIVATE_COMMAND/);
});

test('question observer delegates exact answers and preserves failures', async () => {
  const f = fixture(); f.start();
  const answer = { answers: [{ selected: ['PRIVATE_ANSWER'] }] };
  assert.equal(await f.observer.question({ agent: f.agent, wait: { callId: 'ask' },
    questions: [{ question: 'PRIVATE_QUESTION' }] }, async () => answer), answer);
  assert.equal(f.sent.at(-1).event, 'input/resolved');
  const error = new Error('PRIVATE_NATIVE_ERROR');
  await assert.rejects(f.observer.question({ agent: f.agent, wait: { callId: 'ask2' } }, async () => { throw error; }), reason => reason === error);
  assert.doesNotMatch(JSON.stringify(f.sent), /PRIVATE_/);
});

test('timed and PTC questions stay pending after the requesting turn completes until native settlement', async () => {
  const f = fixture(); f.start();
  f.active.push({ callId: 'continued', state: 'continued', questions: ['PRIVATE'] });
  await f.observer.question({ agent: f.agent, wait: { callId: 'continued', timed: true } }, async () => ({ pending: true }));
  assert.equal(f.sent.at(-1).event, 'snapshot');
  f.append('turn/end', { turn: 1, reason: { kind: 'completed' } }); f.agent.status = 'idle';
  f.observer.heartbeat();
  assert.equal(f.sent.at(-1).turnComplete, true);
  assert.equal(f.sent.at(-1).status, 'asking');
  f.active.length = 0;
  f.append('user/message', { source: { kind: 'user-question-reply' }, content: 'PRIVATE_ANSWER' });
  assert.equal(f.sent.at(-1).status, 'idle');
  assert.deepEqual(f.sent.at(-1).pendingInputs, []);
});

test('tool execution preserves results/errors and exposes active nested call identities to restart snapshots', async () => {
  const f = fixture(); f.start();
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  const result = { content: 'PRIVATE_TOOL_RESULT' };
  const running = f.observer.tool({ agent: f.agent, callId: 'tool', name: 'bash', arguments: 'PRIVATE_ARG' }, () => done);
  f.observer.heartbeat();
  assert.deepEqual(f.sent.at(-1).activeTools, [{ id: 'tool', name: 'bash' }]);
  finish(result); assert.equal(await running, result);
  assert.equal(f.sent.at(-1).event, 'tool/result');
  assert.deepEqual(f.sent.at(-1).activeTools, []);
  const error = new Error('PRIVATE_ERROR');
  await assert.rejects(f.observer.tool({ agent: f.agent, callId: 'edit', name: 'edit' }, async () => { throw error; }), e => e === error);
  assert.doesNotMatch(JSON.stringify(f.sent), /PRIVATE_/);
});

test('old question settlement does not dismiss a newer turn and telemetry failures cannot change native operations', async () => {
  const f = fixture(); f.start();
  let finish;
  const running = f.observer.question({ agent: f.agent, wait: { callId: 'old' } }, () => new Promise(resolve => { finish = resolve; }));
  f.start(2); f.append('approval/asked', { id: 'new' });
  const count = f.sent.length; finish({}); await running;
  assert.equal(f.sent.length, count);
  f.observer.send = () => { throw new Error('offline'); };
  const value = {};
  assert.equal(await f.observer.tool({ agent: f.agent, callId: 'tool', name: 'write' }, async () => value), value);
  assert.equal(await f.observer.question({ agent: f.agent, wait: { callId: 'ask' } }, async () => value), value);
});

test('fork lineage stays main, actual subagents are labeled, and cancellation clears every native request', () => {
  for (const [header, origin] of [[{ parentSession: 'parent' }, 'main'], [{ parentSession: 'parent', origin: 'subagent' }, 'subagent']]) {
    const f = fixture({ header }); f.start(); f.append('approval/asked', { id: 'ask' });
    assert.equal(f.sent.at(-1).origin, origin);
    f.append('turn/end', { turn: 1, reason: { kind: 'aborted' } });
    assert.deepEqual(f.sent.at(-1).pendingInputs, []);
    f.observer.disposed(f.agent);
    assert.equal(f.sent.at(-1).event, 'agent/disposed');
    assert.deepEqual(f.sent.at(-1).pendingInputs, []);
  }
});

test('long native identifiers remain distinct and quota failure survives a heartbeat snapshot', () => {
  const f=fixture();f.start();
  f.session.id='session-'+ 'x'.repeat(150)+'one';f.observer.heartbeat();const first=f.sent.at(-1).sessionId;
  f.session.id='session-'+ 'x'.repeat(150)+'two';f.observer.heartbeat();const second=f.sent.at(-1).sessionId;
  assert.notEqual(first,second);assert.ok(first.length<=100 && second.length<=100);
  f.append('approval/asked',{id:'approval-'+ 'a'.repeat(150)+'one'});
  f.append('approval/asked',{id:'approval-'+ 'a'.repeat(150)+'two'});
  assert.equal(f.sent.at(-1).pendingInputs.length,2);
  f.append('turn/end',{turn:1,reason:{kind:'error',error:{code:'QUOTA',message:'PRIVATE_ERROR'}}});
  f.agent.status='idle';f.observer.heartbeat();
  assert.equal(f.sent.at(-1).errorCode,'QUOTA');assert.doesNotMatch(JSON.stringify(f.sent),/PRIVATE_ERROR/);
});

test('older native terminal events cannot be relabeled as the newer turn', () => {
  const f=fixture();f.start();f.start(2);f.append('approval/asked',{id:'current'});
  const count=f.sent.length;
  f.append('turn/end',{turn:1,reason:{kind:'completed'}});
  assert.equal(f.sent.length,count);
  f.observer.heartbeat();assert.equal(f.sent.at(-1).turn,2);assert.equal(f.sent.at(-1).status,'asking');
});
