import soloUrl from './assets/audio/mutsumi-guitar-solo.wav?url';
import {SOLO_AUDIO_AT, decideGuitarEgg} from '../shared/guitar-solo';

const STORAGE_KEY = 'deskfolk.guitarEgg';
const VOLUME = .75, FADE_MS = 200;

/**
 * Guitar pastime easter egg: decides each guitar pastime (persisted across
 * restarts in the renderer's local storage) and plays the lead clip while
 * the solo pose is showing. Leaving the pose fades the clip out at once.
 */
export class GuitarEgg {
  private plainSinceEgg = 0;
  private audio = new Audio(soloUrl);
  private startTimer = 0; private watchTimer = 0; private fadeTimer = 0;
  constructor(private isSoloShowing: () => boolean) {
    try { const n = Number(localStorage.getItem(STORAGE_KEY)); if (Number.isInteger(n) && n >= 0) this.plainSinceEgg = Math.min(n, 3); } catch {}
    this.audio.preload = 'auto';
  }
  /** Called once when a guitar pastime begins; true plays the solo. */
  decide(random = Math.random()) {
    const result = decideGuitarEgg(this.plainSinceEgg, random);
    this.plainSinceEgg = result.plainSinceEgg;
    try { localStorage.setItem(STORAGE_KEY, String(this.plainSinceEgg)); } catch {}
    return result.egg;
  }
  /** The solo pose just started; the clip comes in once the neck is up. */
  start(muted: boolean) {
    this.stop(true);
    if (muted) return;
    this.startTimer = window.setTimeout(() => {
      if (!this.isSoloShowing()) return;
      window.clearTimeout(this.fadeTimer);
      this.audio.currentTime = 0; this.audio.volume = VOLUME;
      void this.audio.play().catch(() => {});
      this.watchTimer = window.setInterval(() => {
        if (this.audio.ended) { window.clearInterval(this.watchTimer); return; }
        if (!this.isSoloShowing()) this.stop();
      }, 100);
    }, SOLO_AUDIO_AT * 1000);
  }
  /** Fade out (or cut, when replacing) and cancel a pending start. */
  stop(immediate = false) {
    window.clearTimeout(this.startTimer); window.clearInterval(this.watchTimer);
    if (this.audio.paused) return;
    if (immediate) { this.audio.pause(); return; }
    const from = this.audio.volume, started = performance.now();
    window.clearTimeout(this.fadeTimer);
    const step = () => {
      const u = Math.min(1, (performance.now() - started) / FADE_MS);
      this.audio.volume = from * (1 - u);
      if (u < 1) this.fadeTimer = window.setTimeout(step, 16); else this.audio.pause();
    };
    step();
  }
}
