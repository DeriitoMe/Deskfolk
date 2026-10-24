/**
 * Idle pastime: Mutsumi holds her guitar and drifts off, looking it over.
 * 15 s, the same slot as napping and watering. Body, hands and guitar share
 * one slow breath; twice she turns the guitar a few degrees to inspect it
 * (neck up, then neck down), each turn settling back. Her eyes wander between
 * the body, the middle of the neck and the headstock.
 */
export const GUITAR_SECONDS = 15;
/** Slow turns: +1 tips the neck up (counter-clockwise), -1 down. */
export const GUITAR_INSPECTIONS = [{at: 3.4, dir: 1}, {at: 9.2, dir: -1}] as const;
const INSPECT_SECONDS = 3.4, SACCADE = .14;
/** Where the eyes rest on the guitar: [from second, x, y] in gaze units. */
const FIXATIONS = [
  [0, .22, .62], [1.9, .36, .56], [3.5, .2, .64], [4.4, .54, .46], [6.4, .34, .57],
  [7.9, .16, .66], [9.5, .4, .58], [10.4, .52, .64], [12.3, .26, .6], [13.8, .34, .57],
] as const;

const smooth = (value: number) => {
  const u = Math.max(0, Math.min(1, value));
  return u * u * (3 - 2 * u);
};

/** One turn: ease out to the side, hold a moment, ease back. */
function inspectAt(seconds: number, at: number) {
  const u = (seconds - at) / INSPECT_SECONDS;
  return smooth(u / .38) * (1 - smooth((u - .62) / .38));
}

function eyes(seconds: number) {
  let k = 0;
  while (k + 1 < FIXATIONS.length && seconds >= FIXATIONS[k + 1][0]) k++;
  const [, x, y] = FIXATIONS[k];
  if (k === 0) return {x, y};
  const [, px, py] = FIXATIONS[k - 1], u = smooth((seconds - FIXATIONS[k][0]) / SACCADE);
  return {x: px + (x - px) * u, y: py + (y - py) * u};
}

export function guitarMotion(seconds: number, reduced = false) {
  const k = reduced ? .4 : 1, t = Math.max(0, seconds);
  const inspect = GUITAR_INSPECTIONS.reduce((sum, {at, dir}) => sum + dir * inspectAt(t, at), 0);
  const eye = eyes(t);
  return {
    breath: Math.sin(t * Math.PI * 2 / 4) * k,
    inspect: inspect * k,
    eyeX: eye.x,
    eyeY: eye.y,
  };
}
