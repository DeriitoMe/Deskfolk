export type TouchVoiceKind = 'headpat' | 'tearful-first' | 'tearful-second';

/** Cached interaction voices; alternation follows reaction triggers, not clicks. */
export class TouchVoice {
  private readonly sources: Readonly<Record<TouchVoiceKind, string>>;
  private readonly createAudio: () => HTMLAudioElement;
  private readonly clips = new Map<TouchVoiceKind, HTMLAudioElement>();
  private active: HTMLAudioElement | null = null;
  private next: 'tearful-first' | 'tearful-second' = 'tearful-first';

  constructor(sources: Readonly<Record<TouchVoiceKind, string>>,
    createAudio: () => HTMLAudioElement = () => new Audio()) {
    this.sources = sources;
    this.createAudio = createAudio;
  }

  prepare(): void {
    if (this.clips.size) return;
    for (const kind of Object.keys(this.sources) as TouchVoiceKind[]) {
      const audio = this.createAudio();
      audio.preload = 'auto';
      audio.loop = false;
      audio.volume = 0.75;
      audio.src = this.sources[kind];
      audio.load();
      this.clips.set(kind, audio);
    }
  }

  tap(triggered: boolean, reactionActive: boolean, enabled = true): TouchVoiceKind | undefined {
    let kind: TouchVoiceKind;
    if (triggered) {
      kind = this.next;
      this.next = kind === 'tearful-first' ? 'tearful-second' : 'tearful-first';
    } else if (reactionActive) {
      if (!enabled) this.stop();
      return;
    } else kind = 'headpat';

    if (!enabled) {
      this.stop();
      return kind;
    }
    this.prepare();
    this.stop();
    const audio = this.clips.get(kind)!;
    this.active = audio;
    audio.currentTime = 0;
    void audio.play().catch(() => {
      // Visual touch/reaction feedback continues if a device cannot play audio.
    });
    return kind;
  }

  stop(): void {
    if (!this.active) return;
    this.active.pause();
    this.active.currentTime = 0;
    this.active = null;
  }

  dispose(): void {
    this.stop();
    for (const audio of this.clips.values()) {
      audio.removeAttribute('src');
      audio.load();
    }
    this.clips.clear();
  }
}
