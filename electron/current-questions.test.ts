import assert from 'node:assert/strict';
import test from 'node:test';
import { CurrentQuestionLedger } from './current-questions.ts';
import type { PetEvent } from '../shared/types';

const event = (extra: Partial<PetEvent> = {}): PetEvent => ({
  id: 'event', source: 'codex-log', type: 'needs_input', sessionId: 'session', turnId: 'turn',
  nativeQuestion: true, nativeCallId: 'question', createdAt: '2026-10-06T00:00:00Z',
  read: false, ...extra,
});
const snapshot = (ids: string[], terminal: boolean, extra: Partial<PetEvent> = {}): PetEvent => event({
  type: 'input_sync', nativeQuestion: undefined, nativeCallId: undefined,
  nativePendingInputIds: ids, nativeTurnTerminal: terminal, ...extra,
});

test('a current native question remains pending when its turn successfully completes', () => {
  const ledger = new CurrentQuestionLedger();
  ledger.accepted(event({ type: 'work_started' }));
  ledger.accepted(event());
  ledger.accepted(event({ type: 'turn_ended', outcome: 'success' }));
  const input = snapshot(['question', 'historical-question'], true, { outcome: 'success' });
  const before = structuredClone(input);
  assert.deepEqual(ledger.filterSnapshot(input).nativePendingInputIds, ['question']);
  assert.deepEqual(input, before);
});

test('initial active-turn pending questions remain current after a later terminal snapshot', () => {
  const ledger = new CurrentQuestionLedger();
  assert.deepEqual(ledger.filterSnapshot(snapshot(['one', 'two'], false, { replayed: true })).nativePendingInputIds, ['one', 'two']);
  assert.deepEqual(ledger.filterSnapshot(snapshot(['one', 'two'], true, { outcome: 'success' })).nativePendingInputIds, ['one', 'two']);
  ledger.accepted(event({ type: 'input_resolved', nativeCallId: 'one' }));
  assert.deepEqual(ledger.filterSnapshot(snapshot(['two'], true)).nativePendingInputIds, ['two']);
});

test('questions from a terminal turn before this pet process do not become current pending items', () => {
  const ledger = new CurrentQuestionLedger();
  ledger.accepted(event({ type: 'work_started', replayed: true }));
  ledger.accepted(event({ replayed: true }));
  assert.deepEqual(ledger.filterSnapshot(snapshot(['question'], true, { replayed: true, outcome: 'success' })).nativePendingInputIds, []);
  assert.deepEqual(ledger.filterSnapshot(snapshot(['question'], true)).nativePendingInputIds, []);
});

test('a native answer prevents delayed questions and snapshots from reviving that request', () => {
  const ledger = new CurrentQuestionLedger();
  ledger.accepted(event());
  ledger.accepted(event({ type: 'input_resolved' }));
  ledger.accepted(event());
  assert.deepEqual(ledger.filterSnapshot(snapshot(['question'], true)).nativePendingInputIds, []);
  assert.deepEqual(ledger.filterSnapshot(snapshot(['question'], false)).nativePendingInputIds, []);
});

test('an authoritative active snapshot removes questions that are no longer pending', () => {
  const ledger = new CurrentQuestionLedger();
  ledger.accepted(event());
  assert.deepEqual(ledger.filterSnapshot(snapshot([], false)).nativePendingInputIds, []);
  assert.deepEqual(ledger.filterSnapshot(snapshot(['question'], false)).nativePendingInputIds, []);
});

test('a newer accepted turn supersedes old questions and old snapshots preserve the newer evidence', () => {
  const ledger = new CurrentQuestionLedger();
  ledger.accepted(event());
  ledger.accepted(event({ type: 'work_started', turnId: 'new-turn' }));
  ledger.accepted(event({ turnId: 'new-turn', nativeCallId: 'new-question' }));
  const old = snapshot(['question'], true);
  assert.equal(ledger.filterSnapshot(old), old);
  ledger.accepted(event());
  ledger.accepted(event({ type: 'input_resolved' }));
  assert.deepEqual(ledger.filterSnapshot(snapshot(['new-question'], true, { turnId: 'new-turn' })).nativePendingInputIds, ['new-question']);
  assert.deepEqual(ledger.filterSnapshot(snapshot(['question'], true, { turnId: 'new-turn' })).nativePendingInputIds, []);
});

test('duplicate starts in the current turn retain its live questions', () => {
  const ledger = new CurrentQuestionLedger();
  ledger.accepted(event());
  ledger.accepted(event({ type: 'work_started' }));
  assert.deepEqual(ledger.filterSnapshot(snapshot(['question'], true)).nativePendingInputIds, ['question']);
});

test('Hook, MCP, demo, subagent and incomplete claims cannot register current questions', () => {
  for (const claim of [
    ...(['hook', 'mcp', 'demo'] as const).map(source => event({ source })),
    event({ nativeQuestion: false }), event({ isSubagent: true }),
    event({ sessionId: undefined }), event({ turnId: undefined }), event({ nativeCallId: undefined }),
    event({ questionId: 'pet-dialog' }), event({ nativeCallId: 'legacy:input' }),
  ]) {
    const ledger = new CurrentQuestionLedger();
    ledger.accepted(claim);
    assert.deepEqual(ledger.filterSnapshot(snapshot(['question'], true)).nativePendingInputIds, []);
  }
});

test('invalid snapshots stay unchanged and do not alter valid current evidence', () => {
  const ledger = new CurrentQuestionLedger();
  ledger.accepted(event());
  for (const invalid of [
    snapshot([], true, { source: 'hook' }), snapshot([], true, { source: 'mcp' }),
    snapshot([], true, { source: 'demo' }), snapshot([], true, { isSubagent: true }),
    snapshot([], true, { sessionId: undefined }), snapshot([], true, { turnId: undefined }),
    snapshot([], true, { nativePendingInputIds: undefined }), snapshot([], true, { nativeTurnTerminal: undefined }),
  ]) assert.equal(ledger.filterSnapshot(invalid), invalid);
  assert.deepEqual(ledger.filterSnapshot(snapshot(['question', 'question', 'legacy:input', ' '], true)).nativePendingInputIds, ['question']);
});

test('sessions have independent current question evidence', () => {
  const ledger = new CurrentQuestionLedger();
  ledger.accepted(event());
  assert.deepEqual(ledger.filterSnapshot(snapshot(['question'], true, { sessionId: 'other' })).nativePendingInputIds, []);
  assert.deepEqual(ledger.filterSnapshot(snapshot(['question'], true)).nativePendingInputIds, ['question']);
});

test('Harness restores answerable continued questions from its terminal native projection', () => {
  const ledger = new CurrentQuestionLedger();
  const extra = {source:'deepseek-harness' as const, sessionId:'deepseek-harness:session', replayed:true};
  ledger.accepted(event({...extra,type:'work_started'}));
  assert.deepEqual(ledger.filterSnapshot(snapshot(['continued'],true,extra)).nativePendingInputIds,['continued']);
  ledger.accepted(event({...extra,replayed:false,type:'input_resolved',nativeCallId:'continued'}));
  assert.deepEqual(ledger.filterSnapshot(snapshot([],true,extra)).nativePendingInputIds,[]);
  // A disconnected local lease is not a native answer. A later current
  // projection may restore that still-answerable call with the same identity.
  assert.deepEqual(ledger.filterSnapshot(snapshot(['continued'],true,extra)).nativePendingInputIds,['continued']);
});
