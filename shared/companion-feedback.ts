import type { PetEvent } from './types';
import { isSuccessfulCompletion, successfulCompletionIdentity } from './activity.ts';
export { isSuccessfulCompletion } from './activity.ts';

export const QUESTION_REMINDER_MS = 8_000;
export const TOUCH_SECONDS = 1.6;
export type CelebrationVariant = 'A' | 'D';
export const CELEBRATION_SECONDS: Record<CelebrationVariant, number> = { A: 2.5, D: 2.4 };

export class CelebrationSequence {
  private nextVariant: CelebrationVariant;
  private seen = new Set<string>();
  private pending: PetEvent[] = [];

  constructor(random: () => number = Math.random) {
    this.nextVariant = random() < .5 ? 'A' : 'D';
  }

  enqueue(event: PetEvent): boolean {
    if (!isSuccessfulCompletion(event)) return false;
    const key = successfulCompletionIdentity(event);
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    if (this.seen.size > 512) this.seen.delete(this.seen.values().next().value!);
    this.pending.push(event);
    return true;
  }

  takeNext(): { event: PetEvent; variant: CelebrationVariant } | undefined {
    const event = this.pending.shift();
    if (!event) return undefined;
    const variant = this.nextVariant;
    this.nextVariant = variant === 'A' ? 'D' : 'A';
    return { event, variant };
  }

  get queued(): number { return this.pending.length; }
}

export class QuestionReminderWindow {
  private seen = new Set<string>();
  private until = 0;
  private currentKey?: string;

  show(event: PetEvent, now: number): boolean {
    const key = event.nativeCallId && event.sessionId
      ? `${event.sessionId}|${event.nativeCallId}` : event.id;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    if (this.seen.size > 512) this.seen.delete(this.seen.values().next().value!);
    this.currentKey = key;
    this.until = now + QUESTION_REMINDER_MS;
    return true;
  }

  active(now: number): boolean { return !!this.currentKey && now < this.until; }
  dismiss(): void { this.currentKey = undefined; this.until = 0; }
}
