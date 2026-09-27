import * as THREE from 'three';
import { createTwoBoneLeg } from '../animation/twoBoneLeg';
import { createBoneSpaceRotation } from '../animation/rotateBoneInSpace';
import { createAldenCape } from './animateAldenCape';
import { createCoherentBoneMotion, findImportedObject } from '../animation/coherentBoneMotion';

export const ALDEN_RIGGED_IDLE_SECONDS = 4;
export const ALDEN_RIGGED_BREATH_DEGREES = 0.5;
export const ALDEN_RIGGED_SWAY_DEGREES = 0.2;

// Longer, less hurried steps at base speed; bonuses change stride AND cadence.
// Translation remains gameplay-owned; this is an in-place locomotion cycle.
export const ALDEN_RIGGED_WALK_SECONDS = 1.1;
export const ALDEN_RIGGED_WALK_STANCE = 0.6;
export const ALDEN_RIGGED_WALK_STRIDE = 0.5;
export const ALDEN_RIGGED_WALK_CLEARANCE = 0.055;
export const ALDEN_RIGGED_WALK_STANCE_WIDTH = 0.32;

/** Pass effective movement speed / unmodified movement speed (e.g. boots 1.25).
 * Stride is reach-limited; cadence supplies the rest of the speed increase.
 * This is animation input only and never changes movement stats.
 */
export function aldenWalkAtSpeed(speedMultiplier = 1) {
  const speed = Number.isFinite(speedMultiplier) ? Math.max(0, speedMultiplier) : 0;
  const strideScale = THREE.MathUtils.clamp(1 + 0.25 * (speed - 1), 0.6, 1.16);
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
 * smooth returning swing. Position and velocity agree at heel-strike/toe-off.
 * A 60% support interval provides double support; both feet never fly together.
 */
export function sampleAldenWalkFoot(phase: number, speedMultiplier = 1) {
  const cycle = ((phase % 1) + 1) % 1;
  const gait = aldenWalkAtSpeed(speedMultiplier);
  const stride = gait.stride;
  const stance = ALDEN_RIGGED_WALK_STANCE;
  if (cycle <= stance) return { z: stride * (0.5 - cycle / stance), lift: 0, supporting: true };
  const swing = (cycle - stance) / (1 - stance);
  const tangent = -stride * (1 - stance) / stance;
  const smooth = swing * swing * (3 - 2 * swing);
  return {
    z: -stride * 0.5 + stride * smooth + tangent * swing * (1 - swing) * (1 - 2 * swing),
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
  const supportHeights = [0, 0];
  const rad = THREE.MathUtils.degToRad;
  let phase = 0, currentSpeed = 1;
  const pose = (phase: number, speedMultiplier: number) => {
      const gait = aldenWalkAtSpeed(speedMultiplier);
      const angle = phase * Math.PI * 2;
      // Establish one connected body motion before adding restrained arm swing.
      // The cape now has dedicated joints; the arm roots can swing independently.
      bodyAngles.set(rad(1.4 + 0.6 * (gait.effort - 1) + 0.3 * Math.cos(2 * angle)),
        rad(-(1.8 + 0.3 * (gait.effort - 1)) * Math.cos(angle)), rad(-0.65 * Math.sin(angle)));
      bodyRotation.setFromEuler(bodyAngles);
      bodyOffset.set(0.018 * Math.sin(angle), 0, 0);
      for (let side = 0; side < legs.length; side++) {
        const foot = sampleAldenWalkFoot(phase + side * 0.5, speedMultiplier);
        const leg = legs[side];
        const target = targets[side];
        target.copy(leg.restAnkle);
        target.x = pivot.x + (side === 0 ? 1 : -1) * ALDEN_RIGGED_WALK_STANCE_WIDTH * 0.5;
        // Center travel under the hip, not the rearward ankle in the bind pose.
        // This gives a longer forward step without overextending the trailing leg.
        target.z = leg.restHip.z + foot.z;
        target.y += foot.lift;
        hipPosition.copy(leg.restHip).sub(pivot).applyQuaternion(bodyRotation).add(pivot).add(bodyOffset);
        // Near extension (about 8 degrees of knee flexion), never a locked leg.
        // Let the planted leg raise the pelvis instead of holding a crouch.
        const reach = leg.restLength * Math.cos(rad(4));
        const horizontalSq = (hipPosition.x - target.x) ** 2 + (hipPosition.z - target.z) ** 2;
        supportHeights[side] = target.y + Math.sqrt(Math.max(0, reach * reach - horizontalSq)) - hipPosition.y;
      }
      // Smooth minimum keeps BOTH targets reachable through double support.
      // Small loading compression softens contact without shortening the step.
      const [leftHeight, rightHeight] = supportHeights;
      bodyOffset.y = (leftHeight + rightHeight - Math.hypot(leftHeight - rightHeight, 0.003)) * 0.5
        - 0.003 * (1 - Math.cos(2 * angle));
      bodyMotion.apply(bodyRotation, bodyOffset);
      root.updateMatrixWorld(true);
      for (let side = 0; side < legs.length; side++) {
        legs[side].solve(targets[side]);
        const swing = Math.cos(angle + side * Math.PI);
        rotateBone(arms[side].upper, lateralAxis, rad(gait.armDegrees * swing));
        rotateBone(arms[side].forearm, lateralAxis, rad(-3 + 2 * swing));
      }
      cape(angle, true);
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
