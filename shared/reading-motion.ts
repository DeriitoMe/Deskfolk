/** Seconds per text line: four fixations left to right, then a return sweep. */
export const READING_LINE_SECONDS = 1.7;
export const READING_LINES_PER_PAGE = 3;
/** Pause at the end of a page: both hands snap the paper flat and the eyes go back up. */
export const READING_PAGE_PAUSE = 1.1;
export const READING_PAGE_SECONDS = READING_LINES_PER_PAGE * READING_LINE_SECONDS + READING_PAGE_PAUSE;

const FIXATIONS = [-.5, -.17, .17, .5];
const DWELL = .33, SACCADE = .07, RETURN = .14;
const LINE_STEP = .13, TOP = .42;

const smooth = (value: number) => {
  const u = Math.max(0, Math.min(1, value));
  return u * u * (3 - 2 * u);
};

/** Eye x along the current line: dwell on each word group, jump quickly between them. */
function lineX(u: number) {
  for (let k = 0; k < FIXATIONS.length; k++) {
    const start = k * (DWELL + SACCADE);
    if (u < start + DWELL) return FIXATIONS[k];
    if (k < FIXATIONS.length - 1 && u < start + DWELL + SACCADE) return FIXATIONS[k] + (FIXATIONS[k + 1] - FIXATIONS[k]) * smooth((u - start - DWELL) / SACCADE);
  }
  const last = FIXATIONS[FIXATIONS.length - 1], back = u - (FIXATIONS.length * (DWELL + SACCADE) - SACCADE);
  return last + (FIXATIONS[0] - last) * smooth(back / RETURN);
}

/**
 * The flick that snaps the paper flat: a short gather (negative), a sharp
 * pull outward (peaks at 1), then a damped wobble that settles to exactly 0.
 */
export function paperSnap(seconds: number) {
  const s = seconds;
  if (s <= 0) return 0;
  if (s < .14) return -.35 * smooth(s / .14);
  if (s < .24) return -.35 + 1.35 * smooth((s - .14) / .1);
  const u = s - .24;
  return Math.exp(-u * 6) * Math.cos(u * Math.PI * 2 * 2.6) * (1 - smooth((s - .9) / .2));
}

/**
 * Line-by-line reading: eye offsets (x right, y down, both in gaze units),
 * a small head lift at each new page and the snap between pages.
 */
export function readingScan(seconds: number) {
  const t = Math.max(0, seconds) % READING_PAGE_SECONDS;
  const reading = READING_LINES_PER_PAGE * READING_LINE_SECONDS;
  if (t < reading) {
    const line = Math.floor(t / READING_LINE_SECONDS), u = t - line * READING_LINE_SECONDS;
    // The drop to the next line happens during the return sweep.
    const sweep = smooth((u - (READING_LINE_SECONDS - RETURN)) / RETURN);
    const y = TOP + LINE_STEP * (line + (line < READING_LINES_PER_PAGE - 1 ? sweep : 0));
    return {x: lineX(u), y, snap: 0, nod: 0};
  }
  // Page pause: the last return sweep already brought the eyes left. They
  // glance over the top edge while the hands snap the paper flat, then
  // settle on the first line of the next page.
  const s = t - reading, u = s / READING_PAGE_PAUSE, bottom = TOP + LINE_STEP * (READING_LINES_PER_PAGE - 1);
  return {
    x: FIXATIONS[0],
    y: bottom + (TOP - .12 - bottom) * smooth(u / .5) + .12 * smooth((u - .6) / .4),
    snap: paperSnap(s),
    nod: Math.sin(u * Math.PI),
  };
}
