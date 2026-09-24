import * as THREE from 'three';
import { createCoherentBoneMotion, findImportedObject } from '../animation/coherentBoneMotion';

export const ALDEN_RIGGED_IDLE_SECONDS = 4;
export const ALDEN_RIGGED_BREATH_DEGREES = 0.5;
export const ALDEN_RIGGED_SWAY_DEGREES = 0.2;

// Heavy-armour walk: two steps per 1.2 second loop (~100 steps/min).
// Translation remains gameplay-owned; this is an in-place locomotion cycle.
export const ALDEN_RIGGED_WALK_SECONDS = 1.2;
export const ALDEN_RIGGED_WALK_HIP_DEGREES = 16;
export const ALDEN_RIGGED_WALK_KNEE_DEGREES = 24;

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
    },
  };
}


type SpaceBoneRotationRuntime = Readonly<{
  apply(bone: THREE.Object3D, axisInSpace: THREE.Vector3, radians: number): void;
}>;

function createSpaceBoneRotationRuntime(space: THREE.Object3D): SpaceBoneRotationRuntime {
  const parentWorld = new THREE.Quaternion();
  const inverseParentWorld = new THREE.Quaternion();
  const spaceWorld = new THREE.Quaternion();
  const inverseSpaceWorld = new THREE.Quaternion();
  const spaceDelta = new THREE.Quaternion();
  const worldDelta = new THREE.Quaternion();
  const localDelta = new THREE.Quaternion();

  return {
    apply(bone, axisInSpace, radians) {
      if (!bone.parent || Math.abs(radians) < 1e-8) return;

      // Apply a delta expressed in the imported rig's model space. This avoids relying
      // on Rigify local bone axes, which are not meaningful after glTF name sanitising
      // and export. Descendants follow through the actual skeleton hierarchy.
      space.getWorldQuaternion(spaceWorld);
      inverseSpaceWorld.copy(spaceWorld).invert();
      bone.parent.getWorldQuaternion(parentWorld);
      inverseParentWorld.copy(parentWorld).invert();

      spaceDelta.setFromAxisAngle(axisInSpace, radians);
      worldDelta.copy(spaceWorld).multiply(spaceDelta).multiply(inverseSpaceWorld);
      localDelta.copy(inverseParentWorld).multiply(worldDelta).multiply(parentWorld);
      bone.quaternion.premultiply(localDelta);
      bone.updateWorldMatrix(false, true);
    },
  };
}

export function createAldenRiggedWalk(root: THREE.Object3D) {
  const space = findImportedObject(root, 'rig');
  const spineRoot = findImportedObject(root, 'DEF-spine');
  const bodyBranches = ALDEN_WALK_BODY_BRANCHES.map(name => findImportedObject(root, name));

  // These roots were verified in docs/animation/alden-skin-audit.json. The unusual
  // export has torso armour, face/mask, shoulders and arm roots as siblings under rig,
  // so they must receive one coherent body transform before limb articulation.
  for (const branch of bodyBranches) {
    if (branch.parent !== space) throw new Error('Alden walk hierarchy changed; re-audit before animating');
  }

  const thighL = findImportedObject(root, 'DEF-thigh.L');
  const thighR = findImportedObject(root, 'DEF-thigh.R');
  const shinL = findImportedObject(root, 'DEF-shin.L');
  const shinR = findImportedObject(root, 'DEF-shin.R');
  const footL = findImportedObject(root, 'DEF-foot.L');
  const footR = findImportedObject(root, 'DEF-foot.R');
  const toeL = findImportedObject(root, 'DEF-toe.L');
  const toeR = findImportedObject(root, 'DEF-toe.R');
  const upperArmL = findImportedObject(root, 'DEF-upper_arm.L');
  const upperArmR = findImportedObject(root, 'DEF-upper_arm.R');
  const forearmL = findImportedObject(root, 'DEF-forearm.L');
  const forearmR = findImportedObject(root, 'DEF-forearm.R');

  if (thighL.parent !== space || thighR.parent !== space) {
    throw new Error('Alden thigh roots changed; re-audit before animating');
  }

  space.updateWorldMatrix(true, true);
  const pivot = space.worldToLocal(spineRoot.getWorldPosition(new THREE.Vector3()));
  const bodyMotion = createCoherentBoneMotion(space, bodyBranches, pivot);
  const rotateBone = createSpaceBoneRotationRuntime(space);

  const xAxis = new THREE.Vector3(1, 0, 0);
  const bodyRotation = new THREE.Quaternion();
  const bodyAngles = new THREE.Euler(0, 0, 0, 'XYZ');
  const rad = THREE.MathUtils.degToRad;

  return {
    reset: bodyMotion.reset,
    apply(elapsed: number) {
      const cycle = ((elapsed % ALDEN_RIGGED_WALK_SECONDS) + ALDEN_RIGGED_WALK_SECONDS) % ALDEN_RIGGED_WALK_SECONDS;
      const phase = cycle * (2 * Math.PI / ALDEN_RIGGED_WALK_SECONDS);
      const step = Math.sin(phase);
      const weightShift = Math.cos(phase);
      const leftSwing = step;
      const rightSwing = -step;

      // Small whole-body counter-rotation keeps the armour mass connected while the
      // legs alternate. No root translation is authored here: gameplay owns movement.
      bodyAngles.set(
        rad(1.1 + 0.35 * Math.cos(phase * 2)),
        rad(-1.15 * step),
        rad(0.55 * weightShift),
      );
      bodyMotion.apply(bodyRotation.setFromEuler(bodyAngles));

      // Legs: model-space X is the verified lateral hinge axis (Y up, Z depth).
      // The first DEF thigh/shin/foot bones carry the dominant weights; their .001
      // children are retained as exported deformation subdivisions and follow naturally.
      const hipL = rad(ALDEN_RIGGED_WALK_HIP_DEGREES * leftSwing);
      const hipR = rad(ALDEN_RIGGED_WALK_HIP_DEGREES * rightSwing);
      const kneeL = rad(4 + ALDEN_RIGGED_WALK_KNEE_DEGREES * Math.max(0, leftSwing));
      const kneeR = rad(4 + ALDEN_RIGGED_WALK_KNEE_DEGREES * Math.max(0, rightSwing));

      rotateBone.apply(thighL, xAxis, hipL);
      rotateBone.apply(shinL, xAxis, -kneeL);
      rotateBone.apply(footL, xAxis, -hipL * 0.42 + kneeL * 0.38);
      rotateBone.apply(toeL, xAxis, rad(5) * Math.max(0, -leftSwing));

      rotateBone.apply(thighR, xAxis, hipR);
      rotateBone.apply(shinR, xAxis, -kneeR);
      rotateBone.apply(footR, xAxis, -hipR * 0.42 + kneeR * 0.38);
      rotateBone.apply(toeR, xAxis, rad(5) * Math.max(0, -rightSwing));

      // Alden is heavily armoured and will eventually carry a sword, so the arm swing
      // stays intentionally restrained. This also avoids exaggerating the cape weights
      // that the audit found on the upper-arm roots.
      rotateBone.apply(upperArmL, xAxis, rad(-3.5 * leftSwing));
      rotateBone.apply(upperArmR, xAxis, rad(-3.5 * rightSwing));
      rotateBone.apply(forearmL, xAxis, rad(1.2 * leftSwing));
      rotateBone.apply(forearmR, xAxis, rad(1.2 * rightSwing));

    },
  };
}
