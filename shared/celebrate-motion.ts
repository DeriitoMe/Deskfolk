import {POPPER_SHOTS, popperKick} from './confetti-motion.ts';

/**
 * Party-popper celebration, 2.5 s:
 *   0.00 poppers come up to the chest, eyes turn happy
 *   0.30 knee dip with the poppers pulled in
 *   0.52 jump; the arms swing overhead and both poppers fire near the top
 *   0.90 landing with a soft absorb
 *   1.05 a little dance: side sway, alternating popper waves, hair follow-through
 *   1.95 everything settles back to the rest pose by the end
 * Channels use the rig's pose units; `jump` lifts the whole model, feet included.
 */
export const CELEBRATE_SECONDS = 2.5;
const TAKEOFF = .52, LANDING = .9, JUMP_HEIGHT = .2;
const SWAY = Math.PI * 2 / .9, WAVE = Math.PI * 2 / .45;

const smooth = (value: number) => {
  const u = Math.max(0, Math.min(1, value));
  return u * u * (3 - 2 * u);
};
const bump = (t: number, center: number, width: number) => {
  const u = Math.max(0, 1 - Math.abs(t - center) / width);
  return u * u * (3 - 2 * u);
};
const mix = (a: number, b: number, u: number) => a + (b - a) * u;

export function celebrateMotion(t: number, reduced = false) {
  const k = reduced ? .4 : 1;
  const ready = smooth(t / .22), crouch = bump(t, .42, .16) * k, land = bump(t, .97, .11) * k;
  const s = (t - TAKEOFF) / (LANDING - TAKEOFF), air = s > 0 && s < 1 ? 4 * s * (1 - s) : 0;
  const raise = smooth((t - .44) / .2), settle = smooth((t - 1.95) / .5);
  const dance = smooth((t - 1.0) / .2) * (1 - smooth((t - 1.8) / .3)) * k, d = t - 1.0;
  const kickL = popperKick(t, 0) * k, kickR = popperKick(t, 1) * k;
  const sway = Math.sin(d * SWAY);
  // Chest hold → overhead → rest, with an alternating wave during the dance.
  const arm = (kick: number, phase: number) => mix(mix(.5 * ready, 1.98, raise) - .12 * crouch + .2 * kick + .2 * dance * Math.sin(d * WAVE + phase), 0, settle);
  const reach = mix(mix(-.45 * ready, .95, raise) + .07 * (kickL + kickR), 0, settle);
  const visible = smooth(t / .15) * (1 - smooth((t - 2.15) / .3));
  return {
    visible,
    happy: smooth(t / .15) * (1 - smooth((t - 2.2) / .3)),
    armL: arm(kickL, 0), armR: -arm(kickR, Math.PI), reach,
    kickL, kickR,
    jump: JUMP_HEIGHT * air * k,
    rise: -.07 * crouch - .06 * land + .012 * dance * Math.abs(Math.sin(d * WAVE / 2)),
    pitch: .05 * crouch - .04 * air * k + .03 * land,
    head: .05 * crouch - .06 * air * k + .03 * land + .02 * dance * Math.sin(d * WAVE),
    lean: .055 * dance * sway,
    yaw: .07 * dance * Math.sin(d * SWAY + .6),
    headRoll: -.045 * dance * Math.sin(d * SWAY - .5),
    // The hair trails the sway, and flips up a little on the landing.
    swish: .04 * dance * Math.sin(d * SWAY - 1.2) - .012 * land,
    spread: .03 * crouch + .05 * air * k,
    footL: -.1 * air * k, footR: .1 * air * k,
    liftFoot: .06 * dance * Math.max(0, sway),
  };
}

export {POPPER_SHOTS};
