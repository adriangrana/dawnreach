import * as THREE from 'three';

/** Apply a model-space rotation after the frame's rest/body pose is rebuilt. */
export function createBoneSpaceRotation(space: THREE.Object3D) {
  const spaceRotation = new THREE.Quaternion();
  const parentRotation = new THREE.Quaternion();
  const localDelta = new THREE.Quaternion();
  const delta = new THREE.Quaternion();
  return (bone: THREE.Object3D, axis: THREE.Vector3, angle: number) => {
    space.getWorldQuaternion(spaceRotation);
    bone.parent!.getWorldQuaternion(parentRotation);
    localDelta.copy(parentRotation).invert().multiply(spaceRotation);
    delta.setFromAxisAngle(axis, angle);
    localDelta.multiply(delta).multiply(spaceRotation.invert()).multiply(parentRotation);
    bone.quaternion.premultiply(localDelta);
    bone.updateWorldMatrix(false, true);
  };
}
