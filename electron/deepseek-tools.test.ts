import test from 'node:test';
import assert from 'node:assert/strict';
import { DeepSeekToolTracker, DEEPSEEK_TOOL_MIN_HOLD_MS, deepSeekToolGesture } from './deepseek-tools.ts';
import { DEEPSEEK_HARNESS_LEASE_MS } from './deepseek-harness.ts';

const raw = (event: string, sequence: number, extra: Record<string, unknown> = {}) => ({
  version: 1, streamId: 'a', sessionId: 'session', sequence, time: 1_000, turn: 1, event, origin: 'main', ...extra,
});
const snapshot = (sequence: number, extra: Record<string, unknown> = {}) =>
  raw('snapshot', sequence, { status: 'running', pendingInputs: [], ...extra });
const setup = () => { const tracker = new DeepSeekToolTracker(); tracker.observe(snapshot(1), 0); return tracker; };
const working = () => true;

test('only exact actual Harness execution tools receive tool gestures', () => {
  for (const name of ['bash', 'pwsh', 'terminal_open', 'terminal_send']) assert.equal(deepSeekToolGesture(name), 'type');
  for (const name of ['edit', 'write']) assert.equal(deepSeekToolGesture(name), 'write');
  for (const name of ['read', 'read_image', 'terminal_read', 'terminal_list', 'terminal_close', 'terminal_signal',
    'run_code', 'Bash', 'Pwsh', 'powershell', 'Write', 'constructor', '__proto__', undefined, 3]) assert.equal(deepSeekToolGesture(name), undefined);
});

test('actual running commands continue typing; fast file edits retain a short visible hold', () => {
  const t = setup();
  t.observe(raw('tool/call', 2, { callId: 'bash1', toolName: 'bash' }), 0);
  assert.equal(t.current(10_000, working), 'type');
  t.observe(raw('tool/result', 3, { callId: 'bash1', toolName: 'bash' }), 12_000);
  assert.equal(t.current(12_001, working), null);
  t.observe(raw('tool/call', 4, { callId: 'edit1', toolName: 'edit' }), 13_000);
  t.observe(raw('tool/result', 5, { callId: 'edit1', toolName: 'edit' }), 13_050);
  assert.equal(t.current(14_000, working), 'write');
  assert.equal(t.current(13_000 + DEEPSEEK_TOOL_MIN_HOLD_MS, working), null);
});

test('missing execution start, unadopted sessions and child agents cannot manufacture poses', () => {
  const t = new DeepSeekToolTracker();
  assert.equal(t.observe(raw('tool/call', 1, { callId: 'b', toolName: 'bash' }), 0), false);
  t.observe(snapshot(1), 0);
  assert.equal(t.observe(raw('tool/result', 2, { callId: 'b', toolName: 'bash' }), 1), false);
  assert.equal(t.observe(raw('tool/call', 3, { callId: 'b', toolName: 'bash', origin: 'subagent' }), 2), false);
  assert.equal(t.current(100, working), null);
});

test('old turns and streams cannot clear or replace the current tool', () => {
  const t = setup();
  t.observe(raw('turn/start', 2, { turn: 2 }), 100);
  t.observe(raw('tool/call', 3, { turn: 2, callId: 'now', toolName: 'write' }), 200);
  assert.equal(t.observe(raw('turn/end', 90, { reason: 'completed' }), 300), false);
  assert.equal(t.current(500, working), 'write');
  t.observe(snapshot(1, { streamId: 'b', turn: 2, activeTools: [{ id: 'now', name: 'write' }] }), 600);
  assert.equal(t.observe(snapshot(100, { status: 'idle', turn: 3 }), 700), false);
  assert.equal(t.current(800, working), 'write');
});

test('snapshots restore active execution after pet restart and idle clears it', () => {
  const t = new DeepSeekToolTracker();
  t.observe(snapshot(5, { activeTools: [{ id: 'b', name: 'bash' }] }), 0);
  assert.equal(t.current(100, working), 'type');
  assert.equal(t.current(100, () => false), null);
  t.observe(snapshot(6, { status: 'idle', activeTools: [] }), 200);
  assert.equal(t.current(300, working), null);
});

test('heartbeats renew execution lease and a missing Harness process clears the pose', () => {
  const t = setup();
  t.observe(raw('tool/call', 2, { callId: 'b', toolName: 'bash' }), 0);
  t.observe(snapshot(3, { activeTools: [{ id: 'b', name: 'bash' }] }), 15_000);
  assert.equal(t.current(25_000, working), 'type');
  assert.equal(t.nextChangeAt(), 35_001);
  assert.equal(t.current(15_000 + DEEPSEEK_HARNESS_LEASE_MS + 1, working), null);
});

test('asking, turn completion and disposal clear gestures, with no old late result replay', () => {
  for (const end of [snapshot(3, { status: 'asking', pendingInputs: [{ id: 'q', kind: 'question' }] }),
    raw('turn/end', 3, { reason: 'completed' }), raw('agent/disposed', 3)]) {
    const t = setup();
    t.observe(raw('tool/call', 2, { callId: 'b', toolName: 'bash' }), 0);
    assert.equal(t.observe(end, 100), true);
    t.observe(raw('tool/result', 4, { callId: 'b', toolName: 'bash' }), 200);
    assert.equal(t.current(300, working), null);
  }
});

test('a duplicate execution call cannot replay a finished tool or revive a terminal turn', () => {
  const t = setup();
  t.observe(raw('tool/call', 2, { callId: 'b', toolName: 'bash' }), 0);
  t.observe(raw('tool/result', 3, { callId: 'b', toolName: 'bash' }), 10);
  assert.equal(t.observe(raw('tool/call', 4, { callId: 'b', toolName: 'bash' }), 3000), false);
  assert.equal(t.current(3001, working), null);
  t.observe(raw('turn/end', 5, { reason: 'completed' }), 4000);
  assert.equal(t.observe(raw('tool/call', 6, { callId: 'late', toolName: 'write' }), 4100), false);
  assert.equal(t.current(4200, working), null);
});
