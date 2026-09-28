import * as THREE from 'three';
import { createTwoBoneLeg } from '../animation/twoBoneLeg';
import { createBoneSpaceRotation } from '../animation/rotateBoneInSpace';
import { createAldenCape } from './animateAldenCape';
import { createAldenFootContact } from './aldenFootContact';
import { sampleAldenGaitPhase } from './aldenWalkPhases';
import { createCoherentBoneMotion, findImportedObject } from '../animation/coherentBoneMotion';

export const ALDEN_RIGGED_IDLE_SECONDS = 4;
export const ALDEN_RIGGED_BREATH_DEGREES = 0.5;
export const ALDEN_RIGGED_SWAY_DEGREES = 0.2;

// Longer, less hurried steps at base speed; bonuses change stride AND cadence.
// Translation remains gameplay-owned; this is an in-place locomotion cycle.
export const ALDEN_RIGGED_WALK_SECONDS = 1.1;
export const ALDEN_RIGGED_WALK_STANCE = 0.6;
export const ALDEN_RIGGED_WALK_STRIDE = 0.85;
export const ALDEN_RIGGED_WALK_CLEARANCE = 0.055;
export const ALDEN_RIGGED_WALK_STANCE_WIDTH = 0.32;

/** Pass effective movement speed / unmodified movement speed (e.g. boots 1.25).
 * Stride is reach-limited; cadence supplies the rest of the speed increase.
 * This is animation input only and never changes movement stats.
 */
export function aldenWalkAtSpeed(speedMultiplier = 1) {
  const speed = Number.isFinite(speedMultiplier) ? Math.max(0, speedMultiplier) : 0;
  const strideScale = THREE.MathUtils.clamp(1 + 0.1 * (speed - 1), 0.7, 1.08);
  return {
    speed,
    stride: ALDEN_RIGGED_WALK_STRIDE * strideScale,
    clearance: ALDEN_RIGGED_WALK_CLEARANCE * THREE.MathUtils.clamp(1 + 0.15 * (speed - 1), 0.8, 1.15),
    period: speed > 0 ? ALDEN_RIGGED_WALK_SECONDS * strideScale / speed : Infinity,
    armDegrees: THREE.MathUtils.clamp(8 + 4 * (speed - 1), 4, 12),
    effort: THREE.MathUtils.clamp(speed, 0.5, 2),
  };
}

// Verified against alden-skin-audit.json, not inferred from Rigify conventions.
// All 87 facial joints are siblings of the spine in this export. Even facial
// joints with zero weights participate so their authored relationships survive.
const FACE_BRANCHES = [
  'DEF-brow.T.L',
  'DEF-cheek.T.L',
  'DEF-brow.T.L.001',
  'DEF-brow.T.L.002',
  'DEF-brow.T.L.003',
  'DEF-brow.T.R',
  'DEF-cheek.T.R',
  'DEF-brow.T.R.001',
  'DEF-brow.T.R.002',
  'DEF-brow.T.R.003',
  'DEF-forehead.L',
  'DEF-forehead.L.001',
  'DEF-forehead.L.002',
  'DEF-forehead.R',
  'DEF-forehead.R.001',
  'DEF-forehead.R.002',
  'DEF-temple.L',
  'DEF-temple.R',
  'DEF-ear.L',
  'DEF-ear.L.001',
  'DEF-ear.L.002',
  'DEF-ear.L.003',
  'DEF-ear.L.004',
  'DEF-ear.R',
  'DEF-ear.R.001',
  'DEF-ear.R.002',
  'DEF-ear.R.003',
  'DEF-ear.R.004',
  'DEF-jaw.L',
  'DEF-jaw.R',
  'DEF-chin.001',
  'DEF-chin',
  'DEF-chin.L',
  'DEF-chin.R',
  'DEF-jaw',
  'DEF-jaw.L.001',
  'DEF-jaw.R.001',
  'DEF-tongue.001',
  'DEF-tongue.002',
  'DEF-tongue',
  'DEF-brow.B.L',
  'DEF-brow.B.L.001',
  'DEF-brow.B.L.002',
  'DEF-brow.B.L.003',
  'DEF-lid.B.L',
  'DEF-lid.B.L.001',
  'DEF-lid.B.L.002',
  'DEF-lid.B.L.003',
  'DEF-lid.T.L',
  'DEF-lid.T.L.001',
  'DEF-lid.T.L.002',
  'DEF-lid.T.L.003',
  'DEF-brow.B.R',
  'DEF-brow.B.R.001',
  'DEF-brow.B.R.002',
  'DEF-brow.B.R.003',
  'DEF-lid.B.R',
  'DEF-lid.B.R.001',
  'DEF-lid.B.R.002',
  'DEF-lid.B.R.003',
  'DEF-lid.T.R',
  'DEF-lid.T.R.001',
  'DEF-lid.T.R.002',
  'DEF-lid.T.R.003',
  'DEF-lip.B.L',
  'DEF-lip.B.R',
  'DEF-lip.B.L.001',
  'DEF-lip.B.R.001',
  'DEF-cheek.B.L.001',
  'DEF-cheek.B.R.001',
  'DEF-cheek.B.L',
  'DEF-cheek.B.R',
  'DEF-lip.T.L',
  'DEF-lip.T.R',
  'DEF-lip.T.L.001',
  'DEF-lip.T.R.001',
  'DEF-cheek.T.L.001',
  'DEF-cheek.T.R.001',
  'DEF-nose.002',
  'DEF-nose.001',
  'DEF-nose.003',
  'DEF-nose.004',
  'DEF-nose.L.001',
  'DEF-nose.R.001',
  'DEF-nose',
  'DEF-nose.L',
  'DEF-nose.R',
] as const;

export const ALDEN_IDLE_BRANCHES = [
  'DEF-spine.001', // abdomen -> back/cape -> neck -> inner head
  'DEF-breast.L', 'DEF-breast.R', // front pectoral plates
  'DEF-shoulder.L', 'DEF-shoulder.R', // pauldrons AND cape
  'DEF-upper_arm.L', 'DEF-upper_arm.R', // arms, fingers AND cape
  'neutral_bone', // five vertices on the upper back
  ...FACE_BRANCHES, // helmet/mask AND head; never animate them independently
] as const;

const ALDEN_WALK_BODY_BRANCHES = [
  'DEF-thigh.L', 'DEF-thigh.R', // hips share the pelvis placement before leg IK
  'DEF-spine', // pelvis/torso chain
  'DEF-pelvis.L', 'DEF-pelvis.R', // rigid waist/hip armour roots
  'DEF-breast.L', 'DEF-breast.R', // pectoral plates are disconnected roots
  'DEF-shoulder.L', 'DEF-shoulder.R', // pauldrons/cape weights
  'DEF-upper_arm.L', 'DEF-upper_arm.R', // arm roots/cape weights
  'neutral_bone',
  ...FACE_BRANCHES, // mask/helmet/head roots must follow the torso as one rigid branch set
] as const;

export function createAldenRiggedIdle(root: THREE.Object3D) {
  const space = findImportedObject(root, 'rig');
  const abdomen = findImportedObject(root, 'DEF-spine.001');
  const branches = ALDEN_IDLE_BRANCHES.map(name => findImportedObject(root, name));
  // The audit shows these are disconnected roots, not children of the chest.
  for (const branch of branches) {
    const expectedParent = branch === abdomen ? findImportedObject(root, 'DEF-spine') : space;
    if (branch.parent !== expectedParent) throw new Error('Alden skin hierarchy changed; re-audit before animating');
  }
  space.updateWorldMatrix(true, true);
  const pivot = space.worldToLocal(abdomen.getWorldPosition(new THREE.Vector3()));
  const motion = createCoherentBoneMotion(space, branches, pivot);
  const cape = createAldenCape(root);
  const rotation = new THREE.Quaternion();
  const angles = new THREE.Euler(0, 0, 0, 'XYZ');
  return {
    reset: motion.reset,
    apply(elapsed: number) {
      const cycle = ((elapsed % ALDEN_RIGGED_IDLE_SECONDS) + ALDEN_RIGGED_IDLE_SECONDS) % ALDEN_RIGGED_IDLE_SECONDS;
      const phase = cycle * (2 * Math.PI / ALDEN_RIGGED_IDLE_SECONDS);
      // Smooth periodic time warp: a slightly quicker inhale, slower exhale.
      // Integer harmonics only; values AND velocities meet at the loop boundary.
      const breath = (1 - Math.cos(phase + 0.15 * (1 - Math.cos(phase)))) * 0.5;
      angles.set(
        -THREE.MathUtils.degToRad(ALDEN_RIGGED_BREATH_DEGREES) * breath,
        0,
        THREE.MathUtils.degToRad(ALDEN_RIGGED_SWAY_DEGREES) * Math.sin(phase),
      );
      motion.apply(rotation.setFromEuler(angles));
      cape(phase, false);
    },
  };
}


/** Model-space treadmill trajectory: constant backward support velocity and a
 * strictly forward returning swing. The old endpoint-tangent correction matched
 * stance velocity mathematically, but because stance velocity is rearward it
 * forced the airborne foot to overshoot behind toe-off, advance, overshoot near
 * contact, then recoil again. A quintic smootherstep keeps the entire return
 * monotonic while still easing naturally at both swing endpoints.
 * A 60% support interval provides double support; both feet never fly together.
 */
export function sampleAldenWalkFoot(phase: number, speedMultiplier = 1) {
  const cycle = ((phase % 1) + 1) % 1;
  const gait = aldenWalkAtSpeed(speedMultiplier);
  const stride = gait.stride;
  const stance = ALDEN_RIGGED_WALK_STANCE;
  if (cycle <= stance) {
    // Keep the planted foot moving rearward through most of support, then ease its
    // longitudinal velocity to zero over the final 10% of the cycle. Swing starts
    // at zero velocity too, so the knee no longer receives a sharp velocity change
    // exactly at toe-off.
    const easeStart = stance - 0.1;
    if (cycle <= easeStart) {
      return { z: stride * (0.5 - cycle / stance), lift: 0, supporting: true };
    }
    const span = stance - easeStart;
    const t = (cycle - easeStart) / span;
    const t2 = t * t, t3 = t2 * t;
    const startZ = stride * (0.5 - easeStart / stance);
    const endZ = -stride * 0.5;
    const startSlope = -stride / stance;
    const z = (2 * t3 - 3 * t2 + 1) * startZ
      + (t3 - 2 * t2 + t) * span * startSlope
      + (-2 * t3 + 3 * t2) * endZ;
    return { z, lift: 0, supporting: true };
  }
  const swing = (cycle - stance) / (1 - stance);
  const smooth = swing * swing * swing * (swing * (swing * 6 - 15) + 10);
  return {
    z: -stride * 0.5 + stride * smooth,
    lift: gait.clearance * Math.sin(Math.PI * swing) ** 2,
    supporting: false,
  };
}

export function createAldenRiggedWalk(root: THREE.Object3D) {
  const space = findImportedObject(root, 'rig');
  const spineRoot = findImportedObject(root, 'DEF-spine');
  const bodyBranches = ALDEN_WALK_BODY_BRANCHES.map(name => findImportedObject(root, name));
  for (const branch of bodyBranches) {
    if (branch.parent !== space) throw new Error('Alden walk hierarchy changed; re-audit before animating');
  }
  space.updateWorldMatrix(true, true);
  const pivot = space.worldToLocal(spineRoot.getWorldPosition(new THREE.Vector3()));
  const bodyMotion = createCoherentBoneMotion(space, bodyBranches, pivot);
  const cape = createAldenCape(root);
  const legs = (['L', 'R'] as const).map(side => createTwoBoneLeg(space,
    findImportedObject(root, 'DEF-thigh.' + side),
    findImportedObject(root, 'DEF-shin.' + side),
    findImportedObject(root, 'DEF-foot.' + side)));
  const contacts = legs.map((leg, side) => createAldenFootContact(root, side === 0 ? 'L' : 'R', leg.restAnkle));
  const arms = (['L', 'R'] as const).map(side => ({
    upper: findImportedObject(root, 'DEF-upper_arm.' + side),
    forearm: findImportedObject(root, 'DEF-forearm.' + side),
  }));
  const rotateBone = createBoneSpaceRotation(space);
  const lateralAxis = new THREE.Vector3(1, 0, 0);
  const bodyRotation = new THREE.Quaternion();
  const bodyAngles = new THREE.Euler(0, 0, 0, 'XYZ');
  const bodyOffset = new THREE.Vector3();
  const hipPosition = new THREE.Vector3();
  const targets = legs.map(() => new THREE.Vector3());
  const rad = THREE.MathUtils.degToRad;
  const smooth = (a: number, b: number, value: number) => THREE.MathUtils.smoothstep(value, a, b);
  const ankleAt = (phase: number, speed: number, side: number, target: THREE.Vector3) => {
    const gait = aldenWalkAtSpeed(speed), foot = sampleAldenWalkFoot(phase, speed);
    const joint = sampleAldenGaitPhase(phase), contact = contacts[side].sample(joint.pitch);
    target.set(pivot.x + (side === 0 ? 1 : -1) * ALDEN_RIGGED_WALK_STANCE_WIDTH * 0.5,
      contact.y, legs[side].restHip.z + gait.stride * 0.05 + foot.z + contact.z);
    return { ...joint, ...foot, footPitch: contact.pitch };
  };
  const landmarkTarget = new THREE.Vector3();
  const landmarkHip = new THREE.Vector3();
  const landmarkRotation = new THREE.Quaternion();
  const landmarkAngles = new THREE.Euler(0, 0, 0, 'XYZ');
  const bodyAt = (cycle: number, speed: number, angles: THREE.Euler) => {
    const effort = aldenWalkAtSpeed(speed).effort, angle = cycle * Math.PI * 2;
    return angles.set(rad(10 + 0.6 * (effort - 1)),
      rad(-(1.8 + 0.3 * (effort - 1)) * Math.cos(angle)), rad(-0.65 * Math.sin(angle)));
  };
  const pelvisAtLandmark = (phase: number, speed: number, side: number) => {
    const joint = ankleAt(phase, speed, side, landmarkTarget), leg = legs[side];
    const reach = leg.reachAtFlexion(rad(joint.knee));
    landmarkRotation.setFromEuler(bodyAt(phase - side * 0.5, speed, landmarkAngles));
    landmarkHip.copy(leg.restHip).sub(pivot).applyQuaternion(landmarkRotation).add(pivot);
    landmarkHip.x += 0.012 * Math.sin((phase + side * 0.5) * Math.PI * 2);
    const horizontalSq = (landmarkHip.x - landmarkTarget.x) ** 2 + (landmarkHip.z - landmarkTarget.z) ** 2;
    return landmarkTarget.y + Math.sqrt(Math.max(0, reach * reach - horizontalSq)) - landmarkHip.y;
  };
  const smoother01 = (value: number) => {
    const t = THREE.MathUtils.clamp(value, 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
  };
  const supportLoad = (cycle: number) => {
    const c = ((cycle % 1) + 1) % 1;
    // Weight is transferred during real double support: the incoming foot accepts
    // load after heel contact while the trailing foot releases it toward toe-off.
    // Quintic ramps keep position, velocity and acceleration continuous.
    if (c <= 0.1) return smoother01(c / 0.1);
    if (c <= 0.5) return 1;
    if (c <= ALDEN_RIGGED_WALK_STANCE) {
      return 1 - smoother01((c - 0.5) / (ALDEN_RIGGED_WALK_STANCE - 0.5));
    }
    return 0;
  };
  const pelvisHeight = (phase: number, speed: number) => {
    let weightedHeight = 0;
    let totalWeight = 0;
    for (let side = 0; side < legs.length; side++) {
      const cycle = ((phase + side * 0.5) % 1 + 1) % 1;
      const weight = supportLoad(cycle);
      if (weight <= 1e-8) continue;
      weightedHeight += pelvisAtLandmark(cycle, speed, side) * weight;
      totalWeight += weight;
    }
    // There is always at least one support foot, but keep a deterministic fallback
    // for malformed future gait timings.
    return totalWeight > 1e-8 ? weightedHeight / totalWeight : pelvisAtLandmark(0, speed, 0);
  };
  let phase = 0, currentSpeed = 1;
  const pose = (phase: number, speedMultiplier: number) => {
      const gait = aldenWalkAtSpeed(speedMultiplier);
      const angle = phase * Math.PI * 2;
      // Establish one connected body motion before adding restrained arm swing.
      // The cape now has dedicated joints; the arm roots can swing independently.
      // The imported torso leans back in its rest pose; bring its mass above
      // the pelvis before adding the small locomotion motion.
      bodyAt(phase, speedMultiplier, bodyAngles);
      bodyRotation.setFromEuler(bodyAngles);
      const height = pelvisHeight(phase, speedMultiplier);
      bodyOffset.set(0.012 * Math.sin(angle), height, 0);
      for (let side = 0; side < legs.length; side++) {
        const foot = ankleAt(phase + side * 0.5, speedMultiplier, side, targets[side]);
        const leg = legs[side];
        const target = targets[side];
        hipPosition.copy(leg.restHip).sub(pivot).applyQuaternion(bodyRotation).add(pivot).add(bodyOffset);
        const kneeReach = leg.reachAtFlexion(rad(foot.knee));
        if (foot.cycle > 0.4 && foot.cycle <= ALDEN_RIGGED_WALK_STANCE) {
          // During terminal stance, shorten the trailing leg without allowing the
          // reach correction to leak into the airborne return. Blend fully back to
          // the authored ankle trajectory by toe-off, so swing starts from one
          // position and then advances continuously toward the next contact.
          const dy = hipPosition.y - target.y - foot.lift;
          const rear = hipPosition.z - Math.sqrt(Math.max(0,
            kneeReach * kneeReach - dy * dy - (hipPosition.x - target.x) ** 2));
          target.z = THREE.MathUtils.lerp(
            rear,
            target.z,
            smooth(0.4, ALDEN_RIGGED_WALK_STANCE, foot.cycle),
          );
        }
        if (!foot.supporting) {
          const minimumClearance = foot.lift * 0.25;
          const horizontalSq = (hipPosition.x - target.x) ** 2 + (hipPosition.z - target.z) ** 2;
          const kneeHeight = hipPosition.y - Math.sqrt(Math.max(0, kneeReach * kneeReach - horizontalSq));
          // The reach correction used to switch on in one frame at toe-off. Even
          // when the knee angle stayed monotonic, that instantaneous Y correction
          // produced a visible little knee "tick". Fade it in during initial swing.
          const reachClearance = Math.max(0, kneeHeight - target.y);
          const swingReachBlend = smooth(
            ALDEN_RIGGED_WALK_STANCE,
            ALDEN_RIGGED_WALK_STANCE + 0.06,
            foot.cycle,
          );
          target.y += Math.max(minimumClearance, reachClearance * swingReachBlend);
        }
      }
      bodyMotion.apply(bodyRotation, bodyOffset);
      root.updateMatrixWorld(true);
      for (let side = 0; side < legs.length; side++) {
        const foot = sampleAldenGaitPhase(phase + side * 0.5);
        legs[side].solve(targets[side], rad(foot.pitch));
        const swing = Math.cos(angle + side * Math.PI);
        rotateBone(arms[side].upper, lateralAxis, rad(gait.armDegrees * swing));
        rotateBone(arms[side].forearm, lateralAxis, rad(-3 + 2 * swing));
      }
      // Keep the cloth hanging as the chest leans into the walk.
      cape(angle, true, bodyAngles.x - rad(2));
  };
  return {
    reset: bodyMotion.reset,
    /** Deterministic pose inspection. Live playback must use advance to retain phase. */
    apply(elapsed: number, speedMultiplier = 1) {
      const gait = aldenWalkAtSpeed(speedMultiplier);
      currentSpeed = gait.speed;
      phase = Number.isFinite(gait.period) ? ((elapsed / gait.period % 1) + 1) % 1 : 0;
      pose(phase, currentSpeed);
    },
    advance(delta: number, speedMultiplier = 1) {
      const dt = THREE.MathUtils.clamp(delta, 0, 0.1);
      const previousRate = 1 / aldenWalkAtSpeed(currentSpeed).period;
      const targetSpeed = aldenWalkAtSpeed(speedMultiplier).speed;
      // Smooth a boots/buff change without multiplying global elapsed by speed,
      // which would teleport the feet to another point in the gait.
      currentSpeed += (targetSpeed - currentSpeed) * (1 - Math.exp(-dt / 0.12));
      const rate = 1 / aldenWalkAtSpeed(currentSpeed).period;
      phase = (phase + dt * (previousRate + rate) * 0.5) % 1;
      pose(phase, currentSpeed);
    },
  };
}
