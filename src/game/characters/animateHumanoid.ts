import * as THREE from 'three';
import type { HumanoidRig } from './humanoidRig.js';

type GaitKey = readonly [phase: number, degrees: number];

export const HUMANOID_WALK_SPEED = 2.4;
export const HUMANOID_FAST_WALK_SPEED = 5;
export const HUMANOID_DEFAULT_MOVE_SPEED = HUMANOID_FAST_WALK_SPEED;
const WALK_STEP_LENGTH = 1.2;
export const HUMANOID_GAIT_RATE = Math.PI * HUMANOID_DEFAULT_MOVE_SPEED / WALK_STEP_LENGTH;

const hipKeys: readonly GaitKey[] = [[0, 28], [0.1, 24], [0.3, 5], [0.5, -12], [0.6, -5], [0.7, 30], [0.87, 28], [1, 28]];
const kneeKeys: readonly GaitKey[] = [[0, 4], [0.1, 18], [0.3, 5], [0.5, 58], [0.6, 60], [0.7, 60], [0.85, 25], [1, 4]];
const ankleKeys: readonly GaitKey[] = [[0, 0], [0.1, 5], [0.3, -10], [0.5, 0], [0.6, 18], [0.7, -20], [0.85, 0], [1, 0]];
const supportTiltKeys: readonly GaitKey[] = [[0, 0], [0.1, 0], [0.25, 5], [0.4, 4], [0.5, 0], [0.6, 0], [0.75, -5], [0.9, -4], [1, 0]];

export function animateHumanoid(rig: HumanoidRig, elapsed: number, moving: boolean, delta = 1 / 60, speed = HUMANOID_DEFAULT_MOVE_SPEED) {
  const dt = Math.max(0, Math.min(delta, 0.1));
  const target = moving ? 1 : 0;
  const decay = Math.exp(-dt * 10);
  const phaseTime = target * dt + (rig.gait.weight - target) * (1 - decay) / 10;
  const gaitRate = HUMANOID_GAIT_RATE * speed / HUMANOID_DEFAULT_MOVE_SPEED / rig.bodyScale;
  rig.gait.phase = (rig.gait.phase + phaseTime * gaitRate) % (Math.PI * 2);
  rig.gait.weight = target + (rig.gait.weight - target) * decay;
  if (!moving && rig.gait.weight < 0.000001) rig.gait.weight = 0;
  const weight = THREE.MathUtils.smoothstep(rig.gait.weight, 0, 1);
  const phase = rig.gait.phase;
  const cycle = phase / (Math.PI * 2);

  // Preserve Dawnreach's established visual gait after correcting anatomical side names:
  // the physical -X side is now the right side, while the physical +X side is the left.
  animateLeg(rig.rightLeg, rig.rightShin, rig.rightFoot, cycle, weight);
  animateLeg(rig.leftLeg, rig.leftShin, rig.leftFoot, (cycle + 0.5) % 1, weight);
  animateArm(rig.rightArm, rig.rightForearm, phase, weight, -1);
  animateArm(rig.leftArm, rig.leftForearm, phase + Math.PI, weight, 1);
  // Ability presentation can add a transient pelvis pitch after locomotion. Locomotion itself
  // does not author this axis, so reset it every frame to prevent additive pose residue.
  rig.pelvis.rotation.x = 0;
  rig.pelvis.rotation.y = Math.cos(phase) * THREE.MathUtils.degToRad(4) * weight * rig.waistMotionScale;
  rig.pelvis.rotation.z = -sampleAngle(supportTiltKeys, cycle) * weight * rig.waistMotionScale;
  const supportTransfer = -Math.sin(phase) * weight;
  rig.pelvis.position.x = supportTransfer * 0.035 * rig.bodyScale * rig.waistMotionScale;
  rig.torso.rotation.y = -rig.pelvis.rotation.y;
  rig.torso.rotation.z = -rig.pelvis.rotation.z * 0.6;
  const headRollOffset = rig.head.position.y * Math.sin(rig.torso.rotation.z) * Math.cos(rig.torso.rotation.y);
  rig.torso.position.x = headRollOffset;
  rig.head.quaternion.copy(rig.torso.quaternion).invert();

  rig.model.position.y = 0;
  rig.model.rotation.z = 0;
  rig.root.updateMatrixWorld(true);
  let lowestSole = Infinity;
  for (const { foot, points } of rig.soleSamples) {
    const matrix = foot.matrixWorld.elements;
    for (const point of points) {
      lowestSole = Math.min(lowestSole, matrix[1] * point.x + matrix[5] * point.y + matrix[9] * point.z + matrix[13]);
    }
  }
  const breathing = Math.sin(elapsed * 2.25) * 0.008 * (1 - weight) * rig.bodyScale;
  const supportHeight = (rig.root.position.y + 0.015 * rig.bodyScale - lowestSole) * weight;
  const loadingPhase = phase - Math.PI * 0.2;
  const bodyHeight = (-0.01 - Math.cos(loadingPhase * 2) * 0.02) * weight * rig.bodyScale;
  rig.model.position.y = supportHeight + breathing;
  rig.torso.position.y = rig.torsoRestY + bodyHeight + breathing - rig.model.position.y;
}

function sampleAngle(keys: readonly GaitKey[], cycle: number) {
  const next = keys.findIndex(key => key[0] > cycle);
  if (next < 1) return THREE.MathUtils.degToRad(keys[0][1]);
  const [start, from] = keys[next - 1];
  const [end, to] = keys[next];
  const blend = THREE.MathUtils.smoothstep(cycle, start, end);
  return THREE.MathUtils.degToRad(THREE.MathUtils.lerp(from, to, blend));
}

function animateLeg(hip: THREE.Group, knee: THREE.Group, foot: THREE.Group, cycle: number, weight: number) {
  hip.rotation.x = -sampleAngle(hipKeys, cycle) * weight;
  knee.rotation.x = sampleAngle(kneeKeys, cycle) * weight;
  foot.rotation.x = sampleAngle(ankleKeys, cycle) * weight;
}

function animateArm(shoulder: THREE.Group, elbow: THREE.Group, phase: number, weight: number, side: number) {
  shoulder.rotation.x = THREE.MathUtils.degToRad(-5 + Math.cos(phase) * 15) * weight;
  const followThrough = 0.16 + Math.sin(phase - 0.65) * 0.22 + Math.sin((phase - 0.65) * 2) * 0.04;
  elbow.rotation.x = -0.35 - followThrough * weight;
  elbow.rotation.z = Math.sin(phase - 1) * 0.025 * weight * side;
}
