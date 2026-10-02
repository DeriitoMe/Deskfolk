import test from 'node:test';
import assert from 'node:assert/strict';
import { CelebrationSequence, QuestionReminderWindow, isSuccessfulCompletion } from './companion-feedback.ts';
import type { PetEvent } from './types';

const event = (extra: Partial<PetEvent> = {}): PetEvent => ({
  id: 'first', type: 'turn_ended', source: 'codex-log', outcome: 'success',
  sessionId: 'session-one', turnId: 'turn-one', projectPath: 'D:/ProjectA',
  createdAt: new Date(0).toISOString(), read: false, ...extra,
});

test('random first choice is followed by strict A/D alternation', () => {
  for (const [random, expected] of [[0, ['A', 'D', 'A', 'D']], [.9, ['D', 'A', 'D', 'A']]] as const) {
    const sequence = new CelebrationSequence(() => random);
    for (let i = 0; i < 4; i++) sequence.enqueue(event({ id: String(i), turnId: String(i) }));
    assert.deepEqual(expected.map(() => sequence.takeNext()!.variant), expected);
    assert.equal(sequence.takeNext(), undefined);
  }
});

test('each project completion queues once even when other projects keep working', () => {
  const sequence = new CelebrationSequence(() => 0);
  assert.equal(sequence.enqueue(event()), true);
  assert.equal(sequence.enqueue(event({ id: 'mcp-copy', source: 'mcp' })), false);
  assert.equal(sequence.enqueue(event({ id: 'second', sessionId: 'session-two', projectPath: 'E:/ProjectB' })), true);
  assert.equal(sequence.queued, 2);
  assert.equal(sequence.takeNext()!.event.projectPath, 'D:/ProjectA');
  assert.equal(sequence.takeNext()!.event.projectPath, 'E:/ProjectB');
});

test('stops, errors, stages, unverified ends and historical replay cannot celebrate', () => {
  for (const extra of [
    { type: 'interrupted', outcome: 'interrupted' }, { outcome: 'failed' },
    { outcome: 'quota_exhausted' }, { outcome: undefined }, { replayed: true },
    { isSubagent: true }, { type: 'stage_complete' },
  ] as Partial<PetEvent>[]) assert.equal(isSuccessfulCompletion(event(extra)), false);
});

test('question presentation expires at 8 seconds and repeated sync cannot restart it', () => {
  const reminder = new QuestionReminderWindow();
  const question = event({ type: 'needs_input', nativeCallId: 'native-call-one' });
  assert(reminder.show(question, 100));
  assert.equal(reminder.active(8_099), true);
  assert.equal(reminder.active(8_100), false);
  assert.equal(reminder.show({ ...question, id: 'repeat-delivery' }, 8_101), false);
  assert.equal(reminder.show({ ...question, id: 'hook-copy', turnId: undefined }, 8_102), false);
  assert.equal(reminder.active(8_101), false);
  assert.equal(reminder.show({ ...question, nativeCallId: 'native-call-two' }, 8_200), true);
  assert.equal(reminder.active(8_201), true);
});

test('dismissing a visual reminder does not edit or resolve the native question event', () => {
  const reminder = new QuestionReminderWindow();
  const question = Object.freeze(event({ type: 'needs_input', nativeQuestion: true }));
  reminder.show(question, 0); reminder.dismiss();
  assert.equal(reminder.active(1), false);
  assert.equal(question.type, 'needs_input');
  assert.equal(question.read, false);
  assert.equal(reminder.show(question, 1), false);
});
