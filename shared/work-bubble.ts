import type { PetActivity } from './types';

export const NORMAL_WORK_MESSAGE = '祥，工作';
export const SUPER_WORK_MESSAGE = '！！！！！！！！！';
export const SUPER_WORK_BUBBLE_PREFIX = 'local:super-work:';

/** Count the workload independently of a temporary question or animation. */
export function hasSuperWorkload(activity: PetActivity): boolean {
  return (activity.workingProjectCount ?? 0) >= 2 || activity.fullPower === true;
}

/** Queue one notice when the aggregate workload crosses into multiple projects. */
export class SuperWorkBubbleGate {
  private active = false;
  private pendingId: string | undefined;
  private sequence = 0;

  observe(activity: PetActivity, announce = true): void {
    const next = hasSuperWorkload(activity);
    if (!next || !announce || activity.replayed) this.pendingId = undefined;
    else if (!this.active) this.pendingId = SUPER_WORK_BUBBLE_PREFIX + ++this.sequence;
    this.active = next;
  }

  get pending(): boolean { return this.pendingId !== undefined; }
  discard(): void { this.pendingId = undefined; }
  take(): string | undefined {
    const id = this.pendingId;
    this.pendingId = undefined;
    return id;
  }
}
