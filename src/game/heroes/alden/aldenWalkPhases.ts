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

// The first walk used a monotone cubic Hermite spline through every landmark.
// Position and first derivative were continuous, but acceleration changed abruptly
// at 0.5/0.6/0.73. On Alden's long rigid greaves that C1-only curve reads as a
// visible knee "tick" even though the foot itself no longer recoils.
//
// Use C2 quintic easing for the actual runtime channels. The artist landmarks above
// remain documentation/reference values; runtime motion is shaped by broad gait
// phases rather than forcing the knee through every intermediate key.
function smootherstep01(value: number) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function easeBetween(phase: number, start: number, end: number, from: number, to: number) {
  if (phase <= start) return from;
  if (phase >= end) return to;
  return from + (to - from) * smootherstep01((phase - start) / (end - start));
}

function sampleKnee(cycle: number) {
  // Loading response: absorb the contact and return to a nearly straight support leg.
  if (cycle < 0.1) return easeBetween(cycle, 0, 0.1, 3, 18);
  if (cycle < 0.3) return easeBetween(cycle, 0.1, 0.3, 18, 3);
  if (cycle < 0.4) return 3;

  // One uninterrupted flexion arc from terminal stance to the swing peak.
  // Removing the old 0.5 and 0.6 spline knots eliminates the robotic knee tick.
  if (cycle < 0.73) return easeBetween(cycle, 0.4, 0.73, 3, 60);

  // Extend continuously toward the next heel contact.
  return easeBetween(cycle, 0.73, 1, 60, 3);
}

function samplePitch(cycle: number) {
  // Heel contact -> flat support.
  if (cycle < 0.1) return easeBetween(cycle, 0, 0.1, -25, 0);
  if (cycle < 0.4) return 0;

  // Smooth toe roll and release; every boundary has zero velocity/acceleration.
  if (cycle < 0.6) return easeBetween(cycle, 0.4, 0.6, 0, 16);
  if (cycle < 0.87) return easeBetween(cycle, 0.6, 0.87, 16, 0);

  // Prepare the boot for the next heel contact without a last-frame snap.
  return easeBetween(cycle, 0.87, 1, 0, -25);
}

export function sampleAldenGaitPhase(phase: number) {
  const cycle = ((phase % 1) + 1) % 1;
  return { cycle, knee: sampleKnee(cycle), pitch: samplePitch(cycle) };
}
