import {GUITAR_SECONDS, guitarMotion} from './guitar-motion.ts';

/**
 * Easter egg on the guitar pastime: five seconds in, the fretting hand lifts
 * the neck into a standing playing angle and she plays the short lead clip
 * (renderer/assets/audio/mutsumi-guitar-solo.wav), picking on its notes and
 * fretting along the neck, then lowers the guitar again. Same 15 s slot.
 */
export const GUITAR_SOLO_SECONDS = GUITAR_SECONDS;
export const SOLO_RAISE_AT = 5, SOLO_RAISE_SECONDS = .8;
/** The clip starts once the neck is up, and is 8 s long. */
export const SOLO_AUDIO_AT = SOLO_RAISE_AT + SOLO_RAISE_SECONDS, SOLO_AUDIO_SECONDS = 8;
export const SOLO_LOWER_AT = SOLO_AUDIO_AT + SOLO_AUDIO_SECONDS;
/** Note onsets in the clip (s), from scripts/prepare-guitar-solo-audio.py. */
export const SOLO_ONSETS = [0.72, 1.033, 1.347, 1.66, 1.962, 2.287, 2.496, 2.589, 2.891, 3.042, 3.204, 3.506, 3.82, 4.145,
  4.423, 4.748, 5.05, 5.364, 5.677, 5.991, 6.2, 6.594, 6.745, 6.908, 7.187, 7.523, 7.848] as const;

const smooth = (value: number) => {
  const u = Math.max(0, Math.min(1, value));
  return u * u * (3 - 2 * u);
};
const hash = (n: number) => { const x = Math.sin(n * 91.345 + 7.1) * 43758.5453; return x - Math.floor(x); };

/** A light pick: quick down-stroke, softer return, within 0.2 s of the note. */
function pickAt(u: number) {
  if (u < -.04 || u > .2) return 0;
  return u < 0 ? smooth((u + .04) / .04) : 1 - smooth(u / .2);
}

export function guitarSoloMotion(seconds: number, reduced = false) {
  const k = reduced ? .4 : 1, t = Math.max(0, seconds);
  const base = guitarMotion(t, reduced);
  const raise = smooth((t - SOLO_RAISE_AT) / SOLO_RAISE_SECONDS) * (1 - smooth((t - SOLO_LOWER_AT) / SOLO_RAISE_SECONDS));
  const clip = t - SOLO_AUDIO_AT;
  const playing = clip > 0 && clip < SOLO_AUDIO_SECONDS + .3;
  let pick = 0, fret = 0;
  if (playing) {
    pick = Math.max(...SOLO_ONSETS.map(at => pickAt(clip - at)));
    // The fretting fingers move to a new spot for each note, slid quickly.
    for (let i = 0; i < SOLO_ONSETS.length; i++) {
      const start = SOLO_ONSETS[i] - .08;
      if (clip < start) break;
      const from = i ? hash(i - 1) * 2 - 1 : 0, to = hash(i) * 2 - 1;
      fret = from + (to - from) * smooth((clip - start) / .08);
    }
  }
  const play = smooth(clip / .3) * (1 - smooth((clip - SOLO_AUDIO_SECONDS) / .3));
  return {
    ...base,
    // The first inspection turn hands over to the raise instead of easing
    // back; the second one falls inside the solo and is dropped.
    inspect: base.inspect * (1 - raise),
    raise: raise * k,
    pick: pick * play * k,
    fret: fret * play * k,
    nod: Math.sin(clip * Math.PI * 2 / .62) * play * k,
    eyeX: base.eyeX + (.46 - base.eyeX) * raise,
    eyeY: base.eyeY + (.52 - base.eyeY) * raise,
  };
}

/**
 * Chance of the egg on the n-th guitar pastime since the last egg: never on
 * the first, then 50 %, 75 % and certainly on the fourth. Triggering starts
 * the count again.
 */
export function guitarEggChance(plainSinceEgg: number) {
  return [0, .5, .75][plainSinceEgg] ?? 1;
}

/** Decide one guitar pastime; returns the egg decision and the next count. */
export function decideGuitarEgg(plainSinceEgg: number, random: number) {
  const egg = random < guitarEggChance(plainSinceEgg);
  return {egg, plainSinceEgg: egg ? 0 : Math.min(plainSinceEgg + 1, 3)};
}
