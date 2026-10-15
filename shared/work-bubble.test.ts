import test from 'node:test';
import assert from 'node:assert/strict';
import { hasSuperWorkload, NORMAL_WORK_MESSAGE, SUPER_WORK_MESSAGE, SuperWorkBubbleGate } from './work-bubble.ts';
import type { PetActivity } from './types';

const activity = (count: number, extra: Partial<PetActivity> = {}): PetActivity => ({
  phase: count ? 'working' : 'idle', workingProjectCount: count,
  fullPower: count >= 2, updatedAt: '2026-10-14T00:00:00.000Z', ...extra,
});

test('ordinary workload stays separate from the nine-mark super notice', () => {
  assert.equal(NORMAL_WORK_MESSAGE, '祥，工作');
  assert.equal(SUPER_WORK_MESSAGE, '！'.repeat(9));
  assert.equal(hasSuperWorkload(activity(1)), false);
  assert.equal(hasSuperWorkload(activity(2)), true);
  assert.equal(hasSuperWorkload({ phase: 'working', updatedAt: '', fullPower: true }), true);
});

test('enter once, hold across progress and third project, then allow a fresh entry', () => {
  const gate = new SuperWorkBubbleGate();
  gate.observe(activity(0), false);
  gate.observe(activity(1)); assert.equal(gate.pending, false);
  gate.observe(activity(2)); const first = gate.take(); assert(first);
  for (const count of [2, 3, 2]) { gate.observe(activity(count)); assert.equal(gate.take(), undefined); }
  gate.observe(activity(1)); gate.observe(activity(2));
  assert(gate.take()); assert.equal(gate.pending, false);
});

test('startup and historical reconciliation establish a quiet baseline', () => {
  const gate = new SuperWorkBubbleGate();
  gate.observe(activity(2), false); assert.equal(gate.take(), undefined);
  gate.observe(activity(0));
  gate.observe(activity(2, { replayed: true })); assert.equal(gate.take(), undefined);
  gate.observe(activity(2)); assert.equal(gate.take(), undefined);
  gate.observe(activity(1)); gate.observe(activity(2)); assert(gate.take());
});

test('a deferred notice survives a question while its workload holds, but is cancelled on exit or mute', () => {
  const gate = new SuperWorkBubbleGate();
  gate.observe(activity(1), false);
  gate.observe(activity(2, { phase: 'asking', fullPower: false })); assert.equal(gate.pending, true);
  gate.observe(activity(2)); assert(gate.take());
  gate.observe(activity(2, { phase: 'asking', fullPower: false })); assert.equal(gate.pending, false);
  gate.observe(activity(1)); gate.observe(activity(2)); assert.equal(gate.pending, true);
  gate.observe(activity(1)); assert.equal(gate.pending, false);
  gate.observe(activity(2)); gate.discard(); gate.observe(activity(2)); assert.equal(gate.pending, false);
});
