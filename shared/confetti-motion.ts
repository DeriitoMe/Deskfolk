/**
 * Party-popper shots and confetti flight (the body choreography lives in
 * celebrate-motion.ts).
 *
 * The screen-right popper fires first, the other a beat later; each shot
 * kicks its arm up. Confetti leaves along the
 * popper barrel in a cone, loses speed to air drag, then drifts down at a
 * paper-like terminal speed with a side-to-side flutter and a 3D tumble.
 */
export const CONFETTI_PIECES = 40;
/** Shot times (s) for poppers[0] (left hand, screen-right) and poppers[1], around the top of the jump. */
export const POPPER_SHOTS = [.68, .77] as const;
const GRAVITY = 2.6;
/** Every piece has faded out before the celebration ends. */
export const CONFETTI_END = 2.45;

const smooth = (value: number) => {
  const u = Math.max(0, Math.min(1, value));
  return u * u * (3 - 2 * u);
};
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

/** Recoil of one popper: 0 before its shot, a quick kick that settles in ~0.4 s. */
export function popperKick(seconds: number, side: 0 | 1) {
  const u = seconds - POPPER_SHOTS[side];
  if (u <= 0) return 0;
  return Math.exp(-u * 8) * Math.sin(Math.min(u * Math.PI * 2 * 2.2, Math.PI * 3)) * 2.1;
}

export type ConfettiPiece = {
  side: 0 | 1; launch: number; cone: number; depth: number; speed: number; drag: number;
  flutter: number; flutterRate: number; phase: number; spin: [number, number, number]; life: number; scale: number;
};

export function confettiPiece(i: number): ConfettiPiece {
  const side = (i % 2) as 0 | 1, h = (k: number) => hash(i * 13 + k);
  const life = 1.25 + h(9) * .3, launch = POPPER_SHOTS[side] + h(1) * .05;
  return {
    // Peaks 1.4–2.5 above the popper mouth: around the top of her large head
    // and still inside the 512 px render. Depth only goes toward the viewer
    // so pieces never hide behind the hair.
    side, launch, cone: (h(2) - .5) * .95, depth: .15 + h(3) * .55,
    speed: 5.6 + h(4) * 1.6, drag: 1.8 + h(5) * .8,
    flutter: .05 + h(6) * .06, flutterRate: 8 + h(7) * 5, phase: h(8) * Math.PI * 2,
    spin: [5 + h(10) * 7, 3 + h(11) * 6, (h(12) - .5) * 9],
    life: Math.min(life, CONFETTI_END - launch), scale: .95 + h(13) * .4,
  };
}

/**
 * Offset from the popper mouth after `u` seconds, given the barrel direction
 * (unit vector in the screen plane, x right, y up). Linear drag gives a fast
 * burst that bends into a slow fall at speed GRAVITY / drag.
 */
export function confettiFlight(piece: ConfettiPiece, seconds: number, barrelX: number, barrelY: number) {
  const u = seconds - piece.launch;
  if (u <= 0) return {x: 0, y: 0, z: 0, u, opacity: 0, rx: 0, ry: 0, rz: piece.phase};
  const c = Math.cos(piece.cone), s = Math.sin(piece.cone);
  const dx = barrelX * c - barrelY * s, dy = barrelX * s + barrelY * c;
  const k = piece.drag, decay = (1 - Math.exp(-k * u)) / k, fall = GRAVITY / k;
  const vx = dx * piece.speed, vy = dy * piece.speed, vz = piece.depth * piece.speed * .5;
  const sway = Math.sin(u * piece.flutterRate + piece.phase) * piece.flutter * smooth(u / .35);
  return {
    x: vx * decay + sway,
    y: (vy + fall) * decay - fall * u,
    z: vz * decay,
    u,
    opacity: smooth(u / .04) * smooth((piece.life - u) / .35),
    rx: u * piece.spin[0], ry: u * piece.spin[1], rz: piece.phase + u * piece.spin[2],
  };
}
