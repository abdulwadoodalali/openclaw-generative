// The "glass marble" filter: device rotation in, a highlight offset out. A fast low-pass smooths the
// sensor; a slow one tracks how the phone is usually held, so the offset is the tilt away from that
// rest pose and drifts back to centre when the hand settles. Pure, for node:test.

export type TiltFilter = { beta: number; gamma: number; restBeta: number; restGamma: number; primed: boolean };

export const TILT_REST: TiltFilter = { beta: 0, gamma: 0, restBeta: 0, restGamma: 0, primed: false };

/** Smoothing per sample (~30 Hz): the reading, and the rest pose it is measured against. */
const SMOOTH = 0.2;
const REST = 0.02;
/** Tilt (radians) away from the rest pose that moves the highlight all the way. */
const FULL_TILT = 0.35;

/** One sensor sample: `beta` tips forward and back, `gamma` side to side (radians). */
export function stepTilt(f: TiltFilter, beta: number, gamma: number): TiltFilter {
  if (!f.primed) return { beta, gamma, restBeta: beta, restGamma: gamma, primed: true };
  const b = f.beta + SMOOTH * (beta - f.beta);
  const g = f.gamma + SMOOTH * (gamma - f.gamma);
  return { beta: b, gamma: g, restBeta: f.restBeta + REST * (b - f.restBeta), restGamma: f.restGamma + REST * (g - f.restGamma), primed: true };
}

/** Highlight offset in points, each axis within ±maxPt. */
export function tiltOffset(f: TiltFilter, maxPt: number): { x: number; y: number } {
  const clamp = (v: number) => Math.max(-1, Math.min(1, v / FULL_TILT)) * maxPt;
  return { x: clamp(f.gamma - f.restGamma), y: clamp(f.beta - f.restBeta) };
}
