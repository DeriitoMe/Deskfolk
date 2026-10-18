export const QUOTA_BOARD_SECONDS = 3.8;
export const QUOTA_BOARD_SPEED = 6.2 / QUOTA_BOARD_SECONDS;
export const QUOTA_BOARD_BLEND_SECONDS = .55 / QUOTA_BOARD_SPEED;
export const QUOTA_BOARD_FADE_SECONDS = .45 / QUOTA_BOARD_SPEED;
/** Hand height rises almost linearly with the arm weight (0.89 → 3.75). */
export const QUOTA_BOARD_GRIP_BASE = 2.18;
export const QUOTA_BOARD_GRIP_RANGE = 2.86;
const smooth = (value: number) => {
  const u = Math.max(0, Math.min(1, value));
  return u * u * (3 - 2 * u);
};
const bump = (value: number, center: number, width: number) =>
  Math.max(0, 1 - Math.abs(value - center) / width) ** 2;

/** Board centre height that keeps its lower corners in both hands. */
export const quotaBoardGripHeight = (arm: number) => QUOTA_BOARD_GRIP_BASE + QUOTA_BOARD_GRIP_RANGE * arm;

/**
 * Small knee dip, lift with a light overshoot, a swaying hold, then the board
 * comes down with the hands and fades while they still hold it.
 */
export function quotaBoardMotion(seconds: number) {
  seconds *= QUOTA_BOARD_SPEED;
  const lift = smooth((seconds - .12) / .86);
  const retreat = smooth((seconds - 4.45) / 1.0);
  const overshoot = .07 * bump(seconds, 1.06, .38) - .025 * bump(seconds, 1.42, .3);
  const arm = Math.max(0, (lift + overshoot) * (1 - retreat));
  const hold = smooth((seconds - 1.2) / .5) * (1 - smooth((seconds - 4.3) / .3));
  const sway = Math.sin((seconds - 1.2) * Math.PI * 2 / 2.1) * hold;
  return {
    arm,
    height: quotaBoardGripHeight(arm),
    tilt: -.26 * (1 - lift) + .14 * retreat,
    roll: .028 * sway,
    // Visible only while the hands are above the head and gripping it.
    opacity: smooth((arm - .42) / .38),
    dip: bump(seconds, .2, .28) - .5 * bump(seconds, 1.0, .3),
    lookUp: smooth((seconds - .5) / .7) * (1 - retreat),
    sway,
  };
}
