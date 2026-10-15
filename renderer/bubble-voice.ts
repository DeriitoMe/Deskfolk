/** One voice at a time, only when its matching bubble is shown. */
export class BubbleVoice {
  private audio: HTMLAudioElement | null = null;
  private readonly played = new Set<string>();

  constructor(
    private readonly clips: Readonly<Record<string, string>>,
    private readonly createAudio: () => HTMLAudioElement = () => new Audio(),
  ) {}

  play(eventId: string, message: string): void {
    const source = this.clips[message];
    if (!source) {
      this.stop();
      return;
    }
    // A deferred completion can show its bubble again. Do not restart its voice.
    const key = JSON.stringify([eventId, message]);
    if (this.played.has(key)) return;
    this.played.add(key);
    if (this.played.size > 256) this.played.delete(this.played.values().next().value!);

    this.stop();
    const audio = this.audio ??= this.createAudio();
    audio.preload = 'auto';
    audio.loop = false;
    audio.volume = 1;
    audio.src = source;
    void audio.play().catch(() => {
      // Keep visual reminders functional when an audio device is unavailable.
      // A repeated event still must not cause retries or a sound loop.
    });
  }

  stop(): void {
    if (!this.audio) return;
    this.audio.pause();
    this.audio.currentTime = 0;
  }

  dispose(): void {
    this.stop();
    this.audio?.removeAttribute('src');
    this.audio?.load();
    this.audio = null;
    this.played.clear();
  }
}
