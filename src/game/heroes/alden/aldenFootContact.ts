import * as THREE from 'three';
import { findImportedObject } from '../animation/coherentBoneMotion';

/** Capture the real boot sole once. Contact is evaluated on a small silhouette
 * table, avoiding per-frame skin/vertex edits or assumptions about bone axes.
 */
export function createAldenFootContact(root: THREE.Object3D, side: 'L' | 'R', ankle: THREE.Vector3) {
  const mesh = findImportedObject(root, 'ALDEN') as THREE.SkinnedMesh;
  const space = findImportedObject(root, 'rig');
  const toSpace = space.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
  const points: THREE.Vector3[] = [];
  const indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
  const joints = new Set(mesh.skeleton.bones.flatMap((bone, i) =>
    ['DEF-foot.' + side, 'DEF-toe.' + side].includes(bone.userData.name) ? [i] : []));
  for (let i = 0; i < indices.count; i++) {
    let influence = 0;
    for (let k = 0; k < 4; k++) if (joints.has(indices.getComponent(i, k))) influence += weights.getComponent(i, k);
    // Heel vertices retain a few percent of shin weight in this export.
    // Excluding them mistakes the middle of the sole for the heel edge.
    if (influence > 0.9) points.push(mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(toSpace));
  }
  const ground = Math.min(...points.map(p => p.y));
  const sole = points.filter(p => p.y < ground + 0.025);
  const heel = Math.min(...sole.map(p => p.z)) - ankle.z;
  const toe = Math.max(...sole.map(p => p.z)) - ankle.z;
  // Integer-degree samples include all rigid boot vertices, so pointed armour
  // cannot dip below the plane while the foot rolls from heel to toe.
  const heights = Array.from({ length: 121 }, (_, i) => {
    const angle = THREE.MathUtils.degToRad(i - 60), c = Math.cos(angle), s = Math.sin(angle);
    return ground - Math.min(...points.map(p => (p.y - ankle.y) * c - (p.z - ankle.z) * s));
  });
  return {
    ground,
    sample(pitchDegrees: number) {
      const value = THREE.MathUtils.clamp(pitchDegrees, -60, 59.999) + 60;
      const index = Math.floor(value), t = value - index;
      const pitch = THREE.MathUtils.degToRad(pitchDegrees);
      const pivot = pitch < 0 ? heel : toe;
      return { y: THREE.MathUtils.lerp(heights[index], heights[index + 1], t),
        z: pivot * (1 - Math.cos(pitch)) - (ground - ankle.y) * Math.sin(pitch), pitch };
    },
  };
}
