import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Box3, Vector3 } from 'three';
import { loadSkinnedGlb } from './load-skinned-glb.mjs';

const path = process.argv[2] ?? 'src/game/heroes/alden/model/alden_rigged_socket.glb';
const gltf = await loadSkinnedGlb(path);
const name = object => object.userData.name ?? object.name;
const boxJSON = box => box.isEmpty() ? null : { min: box.min.toArray(), max: box.max.toArray() };
const hierarchy = [];
const meshes = [];
gltf.scene.traverse(object => {
  hierarchy.push({ name: name(object), runtimeName: object.name, type: object.type, parent: object.parent ? name(object.parent) : null });
  if (!object.isSkinnedMesh) return;
  const { position, skinIndex, skinWeight } = object.geometry.attributes;
  const stats = object.skeleton.bones.map((bone, index) => ({
    index, name: name(bone), runtimeName: bone.name, parent: name(bone.parent),
    origin: bone.getWorldPosition(new Vector3()).toArray(),
    vertices: 0, weightSum: 0, maxWeight: 0, dominantVertices: 0,
    bounds: new Box3(), significantBounds: new Box3(), centroid: new Vector3(),
  }));
  let invalidWeights = 0, maxSumError = 0;
  const point = new Vector3();
  for (let vertex = 0; vertex < position.count; vertex++) {
    point.fromBufferAttribute(position, vertex).applyMatrix4(object.matrixWorld);
    let sum = 0, dominant = -1, largest = 0;
    for (let slot = 0; slot < skinWeight.itemSize; slot++) {
      const weight = skinWeight.getComponent(vertex, slot);
      const stat = stats[skinIndex.getComponent(vertex, slot)];
      if (!Number.isFinite(weight) || weight < 0 || !stat) { invalidWeights++; continue; }
      sum += weight;
      if (weight <= 0) continue;
      stat.vertices++;
      stat.weightSum += weight;
      stat.maxWeight = Math.max(stat.maxWeight, weight);
      stat.bounds.expandByPoint(point);
      if (weight >= 0.1) stat.significantBounds.expandByPoint(point);
      stat.centroid.addScaledVector(point, weight);
      if (weight > largest) { largest = weight; dominant = stat.index; }
    }
    if (dominant >= 0) stats[dominant].dominantVertices++;
    maxSumError = Math.max(maxSumError, Math.abs(1 - sum));
  }
  meshes.push({ name: name(object), vertices: position.count, joints: stats.length, invalidWeights, maxSumError,
    bones: stats.map(stat => ({ ...stat, bounds: boxJSON(stat.bounds), significantBounds: boxJSON(stat.significantBounds),
      centroid: stat.weightSum ? stat.centroid.divideScalar(stat.weightSum).toArray() : null })),
  });
});
console.log(JSON.stringify({ asset: path, sha256: createHash('sha256').update(await readFile(path)).digest('hex'),
  coordinates: 'Unscaled glTF scene space; Y up. Bounds use every positive weight; significantBounds use weight >= 0.1.',
  animationClips: gltf.animations.length, hierarchy, meshes }, null, 2));
