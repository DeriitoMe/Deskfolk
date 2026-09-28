/** V40: interaction cancels the pastime and starts a fresh 30-second idle interval. */
export const IDLE_SEQUENCE = [
  { action: 'idle', milliseconds: 30_000 },
  { action: 'nap', milliseconds: 15_000 },
  { action: 'idle', milliseconds: 30_000 },
  { action: 'water', milliseconds: 15_000 },
  { action: 'water-happy', milliseconds: 3_600 },
] as const;
export type IdleMode = 'idle' | 'busy' | 'interaction';
export class IdleCadence {
  private index = 0;
  private elapsed = 0;
  private previous: number | undefined;
  private mode: IdleMode = 'idle';
  reset(now: number) {
    this.index = 0; this.elapsed = 0; this.previous = now; this.mode = 'idle';
  }
  tick(now: number, mode: IdleMode) {
    const delta = this.previous === undefined ? 0 : Math.max(0, now - this.previous);
    if (this.mode === 'idle') this.elapsed += delta;
    this.previous = now;
    if (mode !== 'idle') { this.index = 0; this.elapsed = 0; }
    this.mode = mode;
    while (this.elapsed >= IDLE_SEQUENCE[this.index].milliseconds) {
      this.elapsed -= IDLE_SEQUENCE[this.index].milliseconds;
      this.index = (this.index + 1) % IDLE_SEQUENCE.length;
    }
    return { ...IDLE_SEQUENCE[this.index], elapsed: this.elapsed, index: this.index };
  }
}
