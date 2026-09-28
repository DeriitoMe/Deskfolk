import type { PetEvent } from './types';

/** Only native questions and verified completion events have desktop bubbles. */
export function isQuestionReminder(event: PetEvent): boolean {
  return (event.type === 'needs_input' || event.type === 'approval_needed') &&
    !event.questionId && (event.source === 'demo' || event.nativeQuestion === true);
}
export function shouldShowBubble(event: PetEvent): boolean {
  return isQuestionReminder(event) || ['turn_ended','task_complete','stage_complete'].includes(event.type);
}
