import type { PetEvent } from './types';

export function isNativeRequestId(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim() && !/^legacy:/i.test(value);
}
/** Hooks and model-authored notices cannot prove that a native dialog exists. */
export function hasNativeInputIdentity(event: PetEvent): boolean {
  return event.source === 'codex-log' && !event.isSubagent && !event.questionId &&
    isNativeRequestId(event.sessionId) && isNativeRequestId(event.turnId) &&
    isNativeRequestId(event.nativeCallId);
}
export function isNativeQuestionReminder(event: PetEvent): boolean {
  return event.type === 'needs_input' && event.nativeQuestion === true && hasNativeInputIdentity(event);
}
/** Demo questions preview the bubble without creating a real pending request. */
export function isQuestionReminder(event: PetEvent): boolean {
  return isNativeQuestionReminder(event) || (event.source === 'demo' && !event.questionId &&
    (event.type === 'needs_input' || event.type === 'approval_needed'));
}
export function shouldShowBubble(event: PetEvent): boolean {
  const liveStart = event.type === 'work_started' &&
    (event.source === 'codex-log' || event.source === 'demo') &&
    !event.replayed && !event.isSubagent;
  return liveStart || isQuestionReminder(event) || ['turn_ended','task_complete','stage_complete','interrupted'].includes(event.type);
}
