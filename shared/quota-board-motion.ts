export const QUOTA_BOARD_SECONDS = 3.8;
export const QUOTA_BOARD_SPEED = 6.2 / QUOTA_BOARD_SECONDS;
export const QUOTA_BOARD_BLEND_SECONDS = .55 / QUOTA_BOARD_SPEED;
export const QUOTA_BOARD_FADE_SECONDS = .45 / QUOTA_BOARD_SPEED;
const smooth = (value: number) => {
  const u = Math.max(0, Math.min(1, value));
  return u * u * (3 - 2 * u);
};

/** One continuous lift, readable hold, then a gentle rigid retreat and release. */
export function quotaBoardMotion(seconds: number) {
  seconds *= QUOTA_BOARD_SPEED;
  const arm = smooth(seconds / .90) * (1 - smooth((seconds - 4.45) / 1.0));
  const reveal = smooth((seconds - .22) / .83);
  const retreat = smooth((seconds - 4.65) / .80);
  return {
    arm,
    height: 3.18 + 1.86 * reveal - .62 * retreat,
    tilt: -.30 * (1 - reveal) + .12 * retreat,
    opacity: smooth((seconds - .28) / .55) * (1 - smooth((seconds - 4.62) / .74)),
  };
}
