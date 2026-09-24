import * as THREE from 'three';

/** GLTFLoader sanitizes punctuation for track bindings but retains source names. */
export function findImportedObject(root: THREE.Object3D, sourceName: string): THREE.Object3D {
  let match: THREE.Object3D | undefined;
  root.traverse(object => {
    if (object.userData.name === sourceName || object.name === sourceName) match = object;
  });
  if (!match) throw new Error(`Imported rig is missing ${sourceName}`);
  return match;
}

/**
 * Give disconnected export branches the SAME rigid motion in model space.
 * Unlike identical local Euler rotations, this preserves their common pivot
 * and skinning delta even when bone axes and parents differ. No reparenting,
 * inverse-bind edits, mesh transforms or scale animation are involved.
 */
export function createCoherentBoneMotion(
  space: THREE.Object3D,
  branchRoots: readonly THREE.Object3D[],
  pivot: THREE.Vector3,
) {
  const selected = new Set(branchRoots);
  for (const bone of branchRoots) {
    for (let parent = bone.parent; parent; parent = parent.parent) {
      if (selected.has(parent)) throw new Error('Coherent motion roots must not overlap');
    }
  }
  space.updateWorldMatrix(true, true);
  const inverseSpace = space.matrixWorld.clone().invert();
  const rest = new Map<THREE.Object3D, { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }>();
  // Capture every joint, including descendants, so reset is exact after scrubbing.
  // Sockets are Object3D attachments and are deliberately never written.
  space.traverse(object => {
    if ((object as THREE.Bone).isBone) rest.set(object, {
      position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone(),
    });
  });
  const bindings = branchRoots.map(object => {
    const pose = rest.get(object);
    if (!pose || !object.parent) throw new Error('Coherent motion requires attached skin joints');
    const parentToSpace = inverseSpace.clone().multiply(object.parent.matrixWorld);
    const parentRotation = new THREE.Quaternion();
    parentToSpace.decompose(new THREE.Vector3(), parentRotation, new THREE.Vector3());
    return { object, pose, parentRotation, inverseParentRotation: parentRotation.clone().invert(),
      spaceToParent: parentToSpace.clone().invert(), positionInSpace: pose.position.clone().applyMatrix4(parentToSpace) };
  });
  const reset = () => {
    for (const [object, pose] of rest) {
      object.position.copy(pose.position);
      object.quaternion.copy(pose.quaternion);
      object.scale.copy(pose.scale);
    }
  };
  return {
    reset,
    apply(rotation: THREE.Quaternion) {
      reset();
      for (const binding of bindings) {
        const { object, pose, parentRotation, inverseParentRotation, positionInSpace, spaceToParent } = binding;
        object.position.copy(positionInSpace).sub(pivot).applyQuaternion(rotation).add(pivot).applyMatrix4(spaceToParent);
        object.quaternion.copy(inverseParentRotation).multiply(rotation).multiply(parentRotation).multiply(pose.quaternion);
      }
    },
  };
}
