import * as THREE from 'three';
import { createCoherentBoneMotion, findImportedObject } from '../animation/coherentBoneMotion';

export const ALDEN_RIGGED_IDLE_SECONDS = 4;
export const ALDEN_RIGGED_BREATH_DEGREES = 0.5;
export const ALDEN_RIGGED_SWAY_DEGREES = 0.2;

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
