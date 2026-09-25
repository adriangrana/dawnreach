import * as THREE from 'three';
import { findImportedObject } from '../animation/coherentBoneMotion';

/** Three pinned, five-joint cloth strips. The source mesh remains untouched;
 * gravity is represented by a hanging pose plus small periodic inertial lag.
 * All offsets follow the body's freshly restored pose, never last frame's pose.
 */
export function createAldenCape(root: THREE.Object3D) {
  const spaceRotation = findImportedObject(root, 'rig').getWorldQuaternion(new THREE.Quaternion());
  const columns = ['R', 'C', 'L'].map(side => Array.from({ length: 5 }, (_, row) => {
    const bone = findImportedObject(root, `CAPE-${side}.${row}`);
    return { bone, quaternion: bone.quaternion.clone(), position: bone.position.clone(),
      backOffset: new THREE.Vector3(0, 0, -0.045).applyQuaternion(spaceRotation)
        .applyQuaternion(bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert()) };
  }));
  const delta = new THREE.Quaternion(), angles = new THREE.Euler();
  const rad = THREE.MathUtils.degToRad;
  const bend = [-18, -3, 8, 15, 18];
  return (phase: number, walking: boolean) => {
    for (let column = 0; column < columns.length; column++) {
      for (let row = 0; row < columns[column].length; row++) {
        const { bone, quaternion, position, backOffset } = columns[column][row];
        const lag = phase - row * 0.48 + (column - 1) * 0.3;
        const swing = Math.sin(lag) * (walking ? 1.4 : 0.2) * row / 4;
        angles.set(rad(bend[row] + swing), rad(row === 0 ? (column - 1) * 45 : 0),
          rad(Math.sin(lag + 0.7) * (walking ? 0.65 : 0.08) * row / 4));
        bone.quaternion.copy(quaternion).multiply(delta.setFromEuler(angles));
        if (row === 0) bone.position.copy(position).add(backOffset);
      }
    }
  };
}
