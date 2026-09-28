/** Artist-facing normalized gait landmarks, measured on the reference leg.
 * Degrees describe knee flexion and sole pitch (+ means heel raised), not
 * Euler angles on the imported bones. IK resolves their different axes.
 */
export const ALDEN_WALK_PHASES = [
  { phase: 0, name: 'Heel contact', knee: 3, pitch: -25 },
  { phase: 0.1, name: 'Loading response', knee: 18, pitch: 0 },
  { phase: 0.3, name: 'Mid stance', knee: 3, pitch: 0 },
  { phase: 0.4, name: 'Terminal stance', knee: 3, pitch: 0 },
  { phase: 0.5, name: 'Pre swing', knee: 20, pitch: 2 },
  { phase: 0.6, name: 'Toe off', knee: 38, pitch: 16 },
  { phase: 0.73, name: 'Initial swing', knee: 60, pitch: 5 },
  { phase: 0.87, name: 'Mid swing', knee: 25, pitch: 0 },
  { phase: 1, name: 'Terminal swing / contact', knee: 3, pitch: -25 },
] as const;

// Monotone Hermite tangents keep flexing through pre-swing and toe-off.
// Zeroing the velocity at every landmark makes a smooth curve still hesitate.
function tangent(index: number, channel: 'knee' | 'pitch') {
  if (index === 0 || index === ALDEN_WALK_PHASES.length - 1) return 0;
  const a = ALDEN_WALK_PHASES[index - 1], b = ALDEN_WALK_PHASES[index], c = ALDEN_WALK_PHASES[index + 1];
  const h0 = b.phase - a.phase, h1 = c.phase - b.phase;
  const d0 = (b[channel] - a[channel]) / h0, d1 = (c[channel] - b[channel]) / h1;
  if (d0 * d1 <= 0) return 0;
  const w0 = 2 * h1 + h0, w1 = h1 + 2 * h0;
  return (w0 + w1) / (w0 / d0 + w1 / d1);
}
const tangents = ALDEN_WALK_PHASES.map((_, i) => ({ knee: tangent(i, 'knee'), pitch: tangent(i, 'pitch') }));

export function sampleAldenGaitPhase(phase: number) {
  const cycle = ((phase % 1) + 1) % 1;
  const index = ALDEN_WALK_PHASES.findIndex((key, i) => i > 0 && cycle <= key.phase);
  const a = ALDEN_WALK_PHASES[index - 1], b = ALDEN_WALK_PHASES[index];
  const t = (cycle - a.phase) / (b.phase - a.phase);
  const t2 = t * t, t3 = t2 * t, span = b.phase - a.phase;
  const sample = (channel: 'knee' | 'pitch') =>
    (2 * t3 - 3 * t2 + 1) * a[channel] + (t3 - 2 * t2 + t) * span * tangents[index - 1][channel]
    + (-2 * t3 + 3 * t2) * b[channel] + (t3 - t2) * span * tangents[index][channel];
  return { cycle, knee: sample('knee'), pitch: sample('pitch') };
}
