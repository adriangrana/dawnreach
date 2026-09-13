import * as THREE from 'three';
import type { AldenRig } from './buildAlden.js';
import { animateHumanoid, HUMANOID_DEFAULT_MOVE_SPEED } from '../../characters/animateHumanoid.js';

export {
  HUMANOID_WALK_SPEED as ALDEN_WALK_SPEED,
  HUMANOID_FAST_WALK_SPEED as ALDEN_FAST_WALK_SPEED,
  HUMANOID_DEFAULT_MOVE_SPEED as ALDEN_DEFAULT_MOVE_SPEED,
  HUMANOID_GAIT_RATE as ALDEN_GAIT_RATE,
} from '../../characters/animateHumanoid.js';

/**
 * Alden's basic attack is authored as a four-phase left-handed diagonal cut:
 * anticipation 0-35%, impact 35-45%, follow-through 45-65%, recovery 65-100%.
 *
 * createDawnreachGame already drives the local sword pivot while an attack is active.
 * We use that movement as the attack trigger and layer the full-body motion on the
 * dedicated left-wrist pivot, so combat code does not need to know anything about
 * the animation rig.
 */
const BASIC_ATTACK_BODY_DURATION = 0.54;
const ATTACK_SIGNAL_THRESHOLD = THREE.MathUtils.degToRad(1.5);

type AttackPose = Readonly<{
  pelvisYaw: number;
  pelvisDrop: number;
  torsoYaw: number;
  torsoPitch: number;
  leftShoulderPitch: number;
  leftShoulderYaw: number;
  leftShoulderRollOffset: number;
  leftElbow: number;
  wristPitch: number;
  wristYaw: number;
  wristRoll: number;
  rightShoulderPitch: number;
  rightShoulderYaw: number;
  rightShoulderRollOffset: number;
  rightElbow: number;
  leftHipPitch: number;
  rightHipPitch: number;
}>;

type AttackRuntime = {
  restSwordQuaternion: THREE.Quaternion;
  pelvisRestY: number;
  leftShoulderRestZ: number;
  rightShoulderRestZ: number;
  active: boolean;
  elapsed: number;
  swordDrivenLastFrame: boolean;
};

const attackRuntime = new WeakMap<AldenRig, AttackRuntime>();

const NEUTRAL: AttackPose = {
  pelvisYaw: 0,
  pelvisDrop: 0,
  torsoYaw: 0,
  torsoPitch: 0,
  leftShoulderPitch: 0,
  leftShoulderYaw: 0,
  leftShoulderRollOffset: 0,
  leftElbow: -20,
  wristPitch: 0,
  wristYaw: 0,
  wristRoll: 0,
  rightShoulderPitch: 0,
  rightShoulderYaw: 0,
  rightShoulderRollOffset: 0,
  rightElbow: -20,
  leftHipPitch: 0,
  rightHipPitch: 0,
};

// 35% — left side loads, elbow closes near 90 degrees and the sword is cocked
// behind the left ear. The right hand comes forward as a compact defensive guard.
const ANTICIPATION: AttackPose = {
  pelvisYaw: -18,
  pelvisDrop: -0.055,
  torsoYaw: -30,
  torsoPitch: -3,
  leftShoulderPitch: -62,
  leftShoulderYaw: -25,
  leftShoulderRollOffset: -10,
  leftElbow: -90,
  wristPitch: -30,
  wristYaw: -8,
  wristRoll: -18,
  rightShoulderPitch: -18,
  rightShoulderYaw: 12,
  rightShoulderRollOffset: -5,
  rightElbow: -55,
  leftHipPitch: 10,
  rightHipPitch: -7,
};

// 45% — explosive release. The elbow deliberately stops short of full extension
// (about 168 degrees) and the wrist snaps forward to provide the sword's whip.
const IMPACT: AttackPose = {
  pelvisYaw: 25,
  pelvisDrop: -0.015,
  torsoYaw: 40,
  torsoPitch: 5,
  leftShoulderPitch: 42,
  leftShoulderYaw: 28,
  leftShoulderRollOffset: 8,
  leftElbow: -12,
  wristPitch: 20,
  wristYaw: 10,
  wristRoll: 26,
  rightShoulderPitch: 32,
  rightShoulderYaw: -18,
  rightShoulderRollOffset: 12,
  rightElbow: -30,
  leftHipPitch: -5,
  rightHipPitch: 12,
};

// 65% — the blade has crossed the chest and is braking down to Alden's right.
const FOLLOW_THROUGH: AttackPose = {
  pelvisYaw: 30,
  pelvisDrop: -0.006,
  torsoYaw: 45,
  torsoPitch: 8,
  leftShoulderPitch: 58,
  leftShoulderYaw: 35,
  leftShoulderRollOffset: 20,
  leftElbow: -40,
  wristPitch: 45,
  wristYaw: 16,
  wristRoll: 38,
  rightShoulderPitch: 38,
  rightShoulderYaw: -24,
  rightShoulderRollOffset: 16,
  rightElbow: -35,
  leftHipPitch: -4,
  rightHipPitch: 10,
};

export function animateAlden(
  rig: AldenRig,
  elapsed: number,
  moving: boolean,
  delta = 1 / 60,
  speed = HUMANOID_DEFAULT_MOVE_SPEED,
) {
  const dt = Math.max(0, Math.min(delta, 0.1));
  const state = getAttackRuntime(rig);

  // The low-level combat loop moves rig.sword during a basic attack. Read that local
  // deviation before animateHumanoid runs, then fire one full-body animation on the
  // rising edge. This keeps attack timing/damage ownership in gameplay and pose
  // ownership here in the animation layer.
  const swordDriven = state.restSwordQuaternion.angleTo(rig.sword.quaternion) > ATTACK_SIGNAL_THRESHOLD;
  if (swordDriven && !state.swordDrivenLastFrame && !state.active) {
    state.active = true;
    state.elapsed = 0;
  }
  state.swordDrivenLastFrame = swordDriven;

  animateHumanoid(rig, elapsed, moving, delta, speed / rig.model.scale.x);

  let attackProgress = -1;
  if (state.active) {
    attackProgress = THREE.MathUtils.clamp(state.elapsed / BASIC_ATTACK_BODY_DURATION, 0, 1);
    applyBasicAttackPose(rig, state, sampleAttackPose(attackProgress));
    state.elapsed += dt;
    if (state.elapsed >= BASIC_ATTACK_BODY_DURATION) {
      state.active = false;
      state.elapsed = BASIC_ATTACK_BODY_DURATION;
    }
  } else {
    // These axes are not touched by the locomotion animator, so explicitly restore them
    // after recovery to guarantee no pose residue can accumulate across attacks.
    rig.leftArm.rotation.y = 0;
    rig.rightArm.rotation.y = 0;
    rig.leftArm.rotation.z = state.leftShoulderRestZ;
    rig.rightArm.rotation.z = state.rightShoulderRestZ;
    rig.swordWrist.rotation.set(0, 0, 0);
    rig.pelvis.position.y = state.pelvisRestY;
  }

  const target = moving ? 1 : 0;
  const gaitWeight = THREE.MathUtils.smoothstep(rig.gait.weight, 0, 1);
  const phase = rig.gait.phase;
  const attackCapeWeight = attackProgress >= 0
    ? Math.sin(Math.min(1, attackProgress / 0.72) * Math.PI) * 0.42
    : 0;

  rig.capeMotion += (Math.max(target, attackCapeWeight) - rig.capeMotion) * (1 - Math.exp(-dt * 6));
  rig.cape.rotation.x = 0.025 + rig.capeMotion * 0.04;
  rig.cape.rotation.z = Math.sin(phase - 0.6) * 0.018 * gaitWeight
    + Math.sin(elapsed * 1.2) * 0.003 * (1 - gaitWeight)
    - attackCapeWeight * 0.06;

  for (const { geometry, rest } of rig.capePanels) {
    const position = geometry.getAttribute('position');
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      const horizontal = rest[vertex * 3];
      const vertical = rest[vertex * 3 + 1];
      const depth = rest[vertex * 3 + 2];
      const weight = Math.min(1, Math.max(0, -vertical / 1.86)) ** 2;
      const flutter = Math.sin(elapsed * 7.5 + vertical * 5 + horizontal * 2.1);
      const ripple = Math.sin(elapsed * 11.5 + vertical * 7.2 - horizontal * 4);
      const amplitude = 0.006 + rig.capeMotion * 0.14;
      const billow = (flutter * 0.72 + ripple * 0.28) * weight * amplitude;
      position.setXYZ(
        vertex,
        horizontal + Math.sin(elapsed * 5 + vertical * 3) * weight * amplitude * 0.35,
        vertical + weight * rig.capeMotion * 0.025 + billow * 0.12,
        depth - weight * rig.capeMotion * 0.025 + billow,
      );
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
  }
}

function getAttackRuntime(rig: AldenRig): AttackRuntime {
  let state = attackRuntime.get(rig);
  if (!state) {
    state = {
      restSwordQuaternion: rig.sword.quaternion.clone(),
      pelvisRestY: rig.pelvis.position.y,
      leftShoulderRestZ: rig.leftArm.rotation.z,
      rightShoulderRestZ: rig.rightArm.rotation.z,
      active: false,
      elapsed: 0,
      swordDrivenLastFrame: false,
    };
    attackRuntime.set(rig, state);
  }
  return state;
}

function applyBasicAttackPose(rig: AldenRig, state: AttackRuntime, pose: AttackPose) {
  const rad = THREE.MathUtils.degToRad;

  rig.pelvis.rotation.y = rad(pose.pelvisYaw);
  rig.pelvis.position.y = state.pelvisRestY + pose.pelvisDrop * rig.bodyScale;

  rig.torso.rotation.x = rad(pose.torsoPitch);
  rig.torso.rotation.y = rad(pose.torsoYaw);

  rig.leftArm.rotation.x = rad(pose.leftShoulderPitch);
  rig.leftArm.rotation.y = rad(pose.leftShoulderYaw);
  rig.leftArm.rotation.z = state.leftShoulderRestZ + rad(pose.leftShoulderRollOffset);
  rig.leftForearm.rotation.x = rad(pose.leftElbow);
  rig.leftForearm.rotation.z = rad(-4 * Math.sin(Math.PI * Math.min(1, Math.abs(pose.leftElbow) / 90)));

  rig.swordWrist.rotation.set(
    rad(pose.wristPitch),
    rad(pose.wristYaw),
    rad(pose.wristRoll),
  );

  // Right hand is intentionally unarmed: it stays compact during the load, then moves
  // backwards/outwards as a counterweight through impact and follow-through.
  rig.rightArm.rotation.x = rad(pose.rightShoulderPitch);
  rig.rightArm.rotation.y = rad(pose.rightShoulderYaw);
  rig.rightArm.rotation.z = state.rightShoulderRestZ + rad(pose.rightShoulderRollOffset);
  rig.rightForearm.rotation.x = rad(pose.rightElbow);

  // Small opposing leg changes make the hip rotation read as weight transfer instead of
  // a torso-only twist while keeping root movement and navigation untouched.
  rig.leftLeg.rotation.x += rad(pose.leftHipPitch);
  rig.rightLeg.rotation.x += rad(pose.rightHipPitch);
}

function sampleAttackPose(progress: number): AttackPose {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  if (p <= 0.35) {
    const t = easeInQuad(p / 0.35);
    return lerpPose(NEUTRAL, ANTICIPATION, t);
  }
  if (p <= 0.45) {
    const t = (p - 0.35) / 0.10;
    return lerpPose(ANTICIPATION, IMPACT, t);
  }
  if (p <= 0.65) {
    const t = THREE.MathUtils.smoothstep(p, 0.45, 0.65);
    return lerpPose(IMPACT, FOLLOW_THROUGH, t);
  }

  const t = easeOutCubic((p - 0.65) / 0.35);
  return lerpPose(FOLLOW_THROUGH, NEUTRAL, t);
}

function lerpPose(from: AttackPose, to: AttackPose, t: number): AttackPose {
  const blend = THREE.MathUtils.clamp(t, 0, 1);
  return {
    pelvisYaw: THREE.MathUtils.lerp(from.pelvisYaw, to.pelvisYaw, blend),
    pelvisDrop: THREE.MathUtils.lerp(from.pelvisDrop, to.pelvisDrop, blend),
    torsoYaw: THREE.MathUtils.lerp(from.torsoYaw, to.torsoYaw, blend),
    torsoPitch: THREE.MathUtils.lerp(from.torsoPitch, to.torsoPitch, blend),
    leftShoulderPitch: THREE.MathUtils.lerp(from.leftShoulderPitch, to.leftShoulderPitch, blend),
    leftShoulderYaw: THREE.MathUtils.lerp(from.leftShoulderYaw, to.leftShoulderYaw, blend),
    leftShoulderRollOffset: THREE.MathUtils.lerp(from.leftShoulderRollOffset, to.leftShoulderRollOffset, blend),
    leftElbow: THREE.MathUtils.lerp(from.leftElbow, to.leftElbow, blend),
    wristPitch: THREE.MathUtils.lerp(from.wristPitch, to.wristPitch, blend),
    wristYaw: THREE.MathUtils.lerp(from.wristYaw, to.wristYaw, blend),
    wristRoll: THREE.MathUtils.lerp(from.wristRoll, to.wristRoll, blend),
    rightShoulderPitch: THREE.MathUtils.lerp(from.rightShoulderPitch, to.rightShoulderPitch, blend),
    rightShoulderYaw: THREE.MathUtils.lerp(from.rightShoulderYaw, to.rightShoulderYaw, blend),
    rightShoulderRollOffset: THREE.MathUtils.lerp(from.rightShoulderRollOffset, to.rightShoulderRollOffset, blend),
    rightElbow: THREE.MathUtils.lerp(from.rightElbow, to.rightElbow, blend),
    leftHipPitch: THREE.MathUtils.lerp(from.leftHipPitch, to.leftHipPitch, blend),
    rightHipPitch: THREE.MathUtils.lerp(from.rightHipPitch, to.rightHipPitch, blend),
  };
}

function easeInQuad(t: number) {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x;
}

function easeOutCubic(t: number) {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return 1 - (1 - x) ** 3;
}
