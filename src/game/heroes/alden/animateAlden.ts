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
 * anticipation 0-35%, impact 35-45% (contact at ~40%), follow-through 45-65%,
 * recovery 65-100%.
 *
 * createDawnreachGame already drives the local sword pivot while an attack is active.
 * We use that movement as the attack trigger and layer the full-body motion on the
 * dedicated left-wrist pivot, so combat code does not need to know anything about
 * the animation rig.
 */
const BASIC_ATTACK_BODY_DURATION = 1 / 3.4;
const ATTACK_SIGNAL_THRESHOLD = THREE.MathUtils.degToRad(1.5);

/**
 * Alden's authored idle is a 2.25 second perfectly periodic loop. The pose is a
 * relaxed left-handed guard rather than a generic T-pose/rest pose. A short settle
 * delay preserves the locomotion recovery before the authored guard fades in.
 */
export const ALDEN_IDLE_LOOP_SECONDS = 2.25;
const IDLE_SETTLE_SECONDS = 0.55;
const IDLE_BLEND_SECONDS = 0.25;
const CHEST_OFFSET_SECONDS = 3.5 / 60;
const RIGHT_ARM_OFFSET_SECONDS = 2 / 60;

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
  stationaryElapsed: number;
  idleCycleElapsed: number;
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

// ~40% — actual contact. The elbow deliberately stops short of full extension
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
  const state = getAttackRuntime(rig, moving);

  // The low-level combat loop moves rig.sword during a basic attack. Read that local
  // deviation before animateHumanoid runs, then fire one full-body animation on the
  // rising edge. Start one frame into the clip because the sword movement we observe
  // was authored by the previous render frame.
  const swordDriven = state.restSwordQuaternion.angleTo(rig.sword.quaternion) > ATTACK_SIGNAL_THRESHOLD;
  if (swordDriven && !state.swordDrivenLastFrame && !state.active) {
    state.active = true;
    state.elapsed = dt;
  }
  state.swordDrivenLastFrame = swordDriven;

  animateHumanoid(rig, elapsed, moving, delta, speed / rig.model.scale.x);

  const gaitWeight = THREE.MathUtils.smoothstep(rig.gait.weight, 0, 1);
  const idleWeight = state.active ? 0 : sampleIdleBlend(state, moving);
  const idlePhase = state.idleCycleElapsed / ALDEN_IDLE_LOOP_SECONDS;

  // The shared humanoid has a generic non-periodic idle bob. Fade that contribution out
  // only while Alden's authored idle is active so his complete resting pose is genuinely
  // cyclic at exactly 2.25 seconds and his boots remain visually planted.
  if (idleWeight > 0) {
    const genericBreathing = Math.sin(elapsed * 2.25) * 0.008 * (1 - gaitWeight) * rig.bodyScale;
    rig.model.position.y -= genericBreathing * idleWeight;
  }

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
    rig.torso.rotation.x = 0;

    if (idleWeight > 0) {
      applyOrganicIdlePose(rig, state, idlePhase, idleWeight);
    } else {
      // animateHumanoid calculated head stabilization before the attack-only X rotation
      // was cleared above. Recompute it so locomotion remains pristine after recovery.
      rig.head.quaternion.copy(rig.torso.quaternion).invert();
    }
  }

  advanceIdleState(state, moving || state.active, dt);

  const target = moving ? 1 : 0;
  const phase = rig.gait.phase;
  const attackCapeWeight = attackProgress >= 0
    ? Math.sin(Math.min(1, attackProgress / 0.72) * Math.PI) * 0.42
    : 0;

  rig.capeMotion += (Math.max(target, attackCapeWeight) - rig.capeMotion) * (1 - Math.exp(-dt * 6));
  if (!moving && attackCapeWeight === 0 && Math.abs(rig.capeMotion) < 0.001) rig.capeMotion = 0;
  rig.cape.rotation.x = 0.025 + rig.capeMotion * 0.04;

  const idleRadians = idlePhase * Math.PI * 2;
  const locomotionCapeSway = Math.sin(phase - 0.6) * 0.018 * gaitWeight;
  const legacyRestCapeSway = Math.sin(elapsed * 1.2) * 0.003 * (1 - gaitWeight);
  const authoredRestCapeSway = Math.sin(idleRadians - 0.42) * 0.0032;
  rig.cape.rotation.z = locomotionCapeSway
    + THREE.MathUtils.lerp(legacyRestCapeSway, authoredRestCapeSway, idleWeight)
    - attackCapeWeight * 0.06;

  for (const { geometry, rest } of rig.capePanels) {
    const position = geometry.getAttribute('position');
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      const horizontal = rest[vertex * 3];
      const vertical = rest[vertex * 3 + 1];
      const depth = rest[vertex * 3 + 2];
      const weight = Math.min(1, Math.max(0, -vertical / 1.86)) ** 2;
      const legacyFlutter = Math.sin(elapsed * 7.5 + vertical * 5 + horizontal * 2.1);
      const legacyRipple = Math.sin(elapsed * 11.5 + vertical * 7.2 - horizontal * 4);
      const idleFlutter = Math.sin(idleRadians + vertical * 5 + horizontal * 2.1);
      const idleRipple = Math.sin(idleRadians * 2 + vertical * 7.2 - horizontal * 4);
      const flutter = THREE.MathUtils.lerp(legacyFlutter, idleFlutter, idleWeight);
      const ripple = THREE.MathUtils.lerp(legacyRipple, idleRipple, idleWeight);
      const amplitude = 0.006 + rig.capeMotion * 0.14;
      const billow = (flutter * 0.72 + ripple * 0.28) * weight * amplitude;
      const legacyLateral = Math.sin(elapsed * 5 + vertical * 3);
      const idleLateral = Math.sin(idleRadians + vertical * 3);
      const lateral = THREE.MathUtils.lerp(legacyLateral, idleLateral, idleWeight);
      position.setXYZ(
        vertex,
        horizontal + lateral * weight * amplitude * 0.35,
        vertical + weight * rig.capeMotion * 0.025 + billow * 0.12,
        depth - weight * rig.capeMotion * 0.025 + billow,
      );
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
  }
}

function getAttackRuntime(rig: AldenRig, moving: boolean): AttackRuntime {
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
      // A hero spawned already at rest should immediately assume the authored guard.
      // A hero arriving from locomotion uses the settle delay below instead.
      stationaryElapsed: moving ? 0 : IDLE_SETTLE_SECONDS + IDLE_BLEND_SECONDS,
      idleCycleElapsed: 0,
    };
    attackRuntime.set(rig, state);
  }
  return state;
}

function sampleIdleBlend(state: AttackRuntime, moving: boolean) {
  if (moving || state.active) return 0;
  const blend = THREE.MathUtils.clamp(
    (state.stationaryElapsed - IDLE_SETTLE_SECONDS) / IDLE_BLEND_SECONDS,
    0,
    1,
  );
  return easeInOutCubic(blend);
}

function advanceIdleState(state: AttackRuntime, interrupted: boolean, dt: number) {
  if (interrupted) {
    state.stationaryElapsed = 0;
    state.idleCycleElapsed = 0;
    return;
  }

  state.stationaryElapsed += dt;
  if (state.stationaryElapsed <= IDLE_SETTLE_SECONDS) return;
  state.idleCycleElapsed = (state.idleCycleElapsed + dt) % ALDEN_IDLE_LOOP_SECONDS;
}

function applyOrganicIdlePose(
  rig: AldenRig,
  state: AttackRuntime,
  phase: number,
  weight: number,
) {
  const rad = THREE.MathUtils.degToRad;
  const pelvisBreath = idleBreath(phase);
  const chestBreath = idleBreath(phase - CHEST_OFFSET_SECONDS / ALDEN_IDLE_LOOP_SECONDS);
  const leftArmBreath = chestBreath;
  const rightArmBreath = idleBreath(
    phase - (CHEST_OFFSET_SECONDS + RIGHT_ARM_OFFSET_SECONDS) / ALDEN_IDLE_LOOP_SECONDS,
  );
  const sway = Math.sin(wrap01(phase) * Math.PI * 2);

  // Pelvis: a planted left-handed fighting stance with a 2.4% vertical compression at
  // mid-cycle and one degree of lateral weight transfer. This is the center of gravity;
  // every upper-body motion is intentionally delayed from it.
  rig.pelvis.rotation.y = THREE.MathUtils.lerp(rig.pelvis.rotation.y, rad(-12), weight);
  rig.pelvis.rotation.z = THREE.MathUtils.lerp(rig.pelvis.rotation.z, rad(sway), weight);
  rig.pelvis.position.y = THREE.MathUtils.lerp(
    rig.pelvis.position.y,
    state.pelvisRestY - 0.024 * rig.bodyScale * pelvisBreath,
    weight,
  );

  // Chest: delayed by roughly 3.5 frames at 60 Hz. The sternum opens by four degrees
  // on inhalation, rises slightly, then returns on the same sinusoidal curve.
  rig.torso.rotation.x = THREE.MathUtils.lerp(rig.torso.rotation.x, rad(4 * chestBreath), weight);
  rig.torso.rotation.y = THREE.MathUtils.lerp(rig.torso.rotation.y, rad(-6), weight);
  rig.torso.rotation.z = THREE.MathUtils.lerp(rig.torso.rotation.z, rad(-sway * 0.35), weight);
  rig.torso.position.y += 0.012 * rig.bodyScale * chestBreath * weight;

  // Head counter-rotates the chest to keep Alden's gaze on the horizon instead of
  // nodding with every breath. Small yaw/roll compensation keeps the helmet stable too.
  rig.head.rotation.x = THREE.MathUtils.lerp(rig.head.rotation.x, rad(-2.5 * chestBreath), weight);
  rig.head.rotation.y = THREE.MathUtils.lerp(rig.head.rotation.y, rad(6), weight);
  rig.head.rotation.z = THREE.MathUtils.lerp(rig.head.rotation.z, rad(sway * 0.35), weight);

  // Left weapon arm: 115-degree elbow angle (65 degrees of rig flexion), shoulder held
  // slightly back and the wrist presenting the sword diagonally upward and forward.
  rig.leftArm.rotation.x = THREE.MathUtils.lerp(rig.leftArm.rotation.x, rad(-24 + leftArmBreath * 1.2), weight);
  rig.leftArm.rotation.y = THREE.MathUtils.lerp(rig.leftArm.rotation.y, rad(-10), weight);
  rig.leftArm.rotation.z = THREE.MathUtils.lerp(
    rig.leftArm.rotation.z,
    state.leftShoulderRestZ + rad(-2 + leftArmBreath * 0.8),
    weight,
  );
  rig.leftForearm.rotation.x = THREE.MathUtils.lerp(rig.leftForearm.rotation.x, rad(-65 + leftArmBreath * 2), weight);
  rig.leftForearm.rotation.z = THREE.MathUtils.lerp(rig.leftForearm.rotation.z, rad(-2.5 * sway), weight);
  rig.swordWrist.rotation.x = THREE.MathUtils.lerp(rig.swordWrist.rotation.x, rad(-12 + leftArmBreath), weight);
  rig.swordWrist.rotation.y = THREE.MathUtils.lerp(rig.swordWrist.rotation.y, rad(-8), weight);
  rig.swordWrist.rotation.z = THREE.MathUtils.lerp(rig.swordWrist.rotation.z, rad(-14 + leftArmBreath * 0.8), weight);

  // Right arm: compact 90-degree defensive counterweight, intentionally two frames
  // behind the sword arm so both sides never breathe in mechanical lockstep.
  rig.rightArm.rotation.x = THREE.MathUtils.lerp(rig.rightArm.rotation.x, rad(-14 + rightArmBreath), weight);
  rig.rightArm.rotation.y = THREE.MathUtils.lerp(rig.rightArm.rotation.y, rad(8), weight);
  rig.rightArm.rotation.z = THREE.MathUtils.lerp(
    rig.rightArm.rotation.z,
    state.rightShoulderRestZ + rad(-4 + rightArmBreath * 0.7),
    weight,
  );
  rig.rightForearm.rotation.x = THREE.MathUtils.lerp(rig.rightForearm.rotation.x, rad(-90 + rightArmBreath * 1.5), weight);
  rig.rightForearm.rotation.z = THREE.MathUtils.lerp(rig.rightForearm.rotation.z, rad(1.5 * sway), weight);

  // Tiny knee/ankle compliance sells the pelvis drop as weight transfer rather than a
  // floating root translation. The values remain intentionally below visible walking.
  const kneeFlex = rad(1.5 * pelvisBreath);
  rig.leftLeg.rotation.x = THREE.MathUtils.lerp(rig.leftLeg.rotation.x, rad(0.45 * sway), weight);
  rig.rightLeg.rotation.x = THREE.MathUtils.lerp(rig.rightLeg.rotation.x, rad(-0.45 * sway), weight);
  rig.leftShin.rotation.x = THREE.MathUtils.lerp(rig.leftShin.rotation.x, kneeFlex, weight);
  rig.rightShin.rotation.x = THREE.MathUtils.lerp(rig.rightShin.rotation.x, kneeFlex, weight);
  rig.leftFoot.rotation.x = THREE.MathUtils.lerp(rig.leftFoot.rotation.x, rad(-0.65 * pelvisBreath), weight);
  rig.rightFoot.rotation.x = THREE.MathUtils.lerp(rig.rightFoot.rotation.x, rad(-0.65 * pelvisBreath), weight);
}

function idleBreath(phase: number) {
  // 0 -> 1 -> 0 over one period. This is exactly an ease-in/out sine on each half,
  // giving zero velocity at the top and bottom of the breath with no hard keyframe stop.
  return 0.5 - 0.5 * Math.cos(wrap01(phase) * Math.PI * 2);
}

function wrap01(value: number) {
  return ((value % 1) + 1) % 1;
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
  if (p <= 0.40) {
    // Explosive release: deliberately linear so the weapon does not feel floaty.
    const t = (p - 0.35) / 0.05;
    return lerpPose(ANTICIPATION, IMPACT, t);
  }
  if (p <= 0.45) {
    // Finish the contact window while immediately beginning to absorb the strike.
    const t = (p - 0.40) / 0.05;
    return lerpPose(IMPACT, FOLLOW_THROUGH, t * 0.22);
  }
  if (p <= 0.65) {
    const t = THREE.MathUtils.smoothstep(p, 0.45, 0.65);
    return lerpPose(IMPACT, FOLLOW_THROUGH, 0.22 + t * 0.78);
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

function easeInOutCubic(t: number) {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2;
}

function easeInQuad(t: number) {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x;
}

function easeOutCubic(t: number) {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return 1 - (1 - x) ** 3;
}
