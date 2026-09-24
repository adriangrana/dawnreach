import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { Matrix4, Vector3 } from 'three';
import { loadSkinnedGlb } from '../scripts/assets/load-skinned-glb.mjs';

const require = createRequire(import.meta.url);
const { createAldenRiggedIdle, ALDEN_IDLE_BRANCHES } = require('../node_modules/.cache/alden-rigged-test/heroes/alden/animateAldenRigged.js');
const { findImportedObject } = require('../node_modules/.cache/alden-rigged-test/heroes/animation/coherentBoneMotion.js');
const asset = 'src/game/heroes/alden/model/alden_rigged_socket.glb';
async function fixture() {
  const { scene, animations } = await loadSkinnedGlb(asset);
  const mesh = findImportedObject(scene, 'ALDEN');
  const idle = createAldenRiggedIdle(scene);
  const sample = t => {
    idle.apply(t);
    scene.updateMatrixWorld(true);
    mesh.skeleton.update();
    return mesh.skeleton.bones.flatMap(bone => [...bone.position, ...bone.quaternion, ...bone.scale]);
  };
  return { scene, mesh, idle, sample, animations };
}
const maxDifference = (a, b) => a.reduce((max, value, i) => Math.max(max, Math.abs(value - b[i])), 0);

test('real GLB binding resolves sanitized names, disconnected branches and the untouched weapon socket', async () => {
  const { scene, mesh, animations, idle, sample } = await fixture();
  assert.equal(mesh.skeleton.bones.length, 161);
  assert.equal(animations.length, 0);
  assert.equal(ALDEN_IDLE_BRANCHES.length, 95);
  assert.equal(findImportedObject(scene, 'DEF-spine.006').name, 'DEF-spine006');
  const socket = findImportedObject(scene, 'weapon_socket.R');
  assert.equal(socket.parent, findImportedObject(scene, 'DEF-hand.R'));
  const local = socket.matrix.clone();
  const original = mesh.skeleton.bones.map(b => [b.position.clone(), b.quaternion.clone(), b.scale.clone(), b.parent]);
  const attributes = ['position', 'skinIndex', 'skinWeight'].map(key => mesh.geometry.attributes[key].array.slice());
  sample(1.7);
  assert.deepEqual(socket.matrix.elements, local.elements);
  assert.ok(maxDifference(socket.matrixWorld.elements, new Matrix4().multiplyMatrices(socket.parent.matrixWorld, local).elements) < 1e-12);
  idle.reset();
  mesh.skeleton.bones.forEach((bone, i) => {
    assert.ok(bone.position.equals(original[i][0]));
    assert.ok(bone.quaternion.equals(original[i][1]));
    assert.ok(bone.scale.equals(original[i][2]));
    assert.equal(bone.parent, original[i][3]);
  });
  ['position', 'skinIndex', 'skinWeight'].forEach((key, i) => assert.deepEqual(mesh.geometry.attributes[key].array, attributes[i]));
});

test('four-second pose and velocity continuity, deterministic scrubbing, no accumulated drift', async () => {
  const { sample } = await fixture();
  for (const t of [0, 0.13, 0.9, 2, 3.99]) assert.ok(maxDifference(sample(t), sample(t + 4)) < 1e-12);
  const expected = sample(1.37);
  for (let frame = 0; frame < 12000; frame++) sample(frame / 60);
  assert.ok(maxDifference(expected, sample(1.37)) < 1e-12);
  assert.ok(maxDifference(sample(-0.5), sample(3.5)) < 1e-12);
  const epsilon = 1e-4;
  const left = sample(4 - epsilon), center = sample(0), right = sample(epsilon);
  const leftVelocity = center.map((v, i) => (v - left[i]) / epsilon);
  const rightVelocity = right.map((v, i) => (v - center[i]) / epsilon);
  assert.ok(maxDifference(leftVelocity, rightVelocity) < 1e-5);
});

test('sample every skinned vertex: planted boots, rigid head/chest/cape, bounded waist deformation', async t => {
  const { scene, mesh, idle, sample } = await fixture();
  const positions = mesh.geometry.attributes.position;
  const rest = Array.from({ length: positions.count }, (_, i) => mesh.getVertexPosition(i, new Vector3()));
  const spine = findImportedObject(scene, 'DEF-spine.003');
  const inverseRestSpine = spine.matrixWorld.clone().invert();
  let maxBoot = 0, maxHeadError = 0, maxRigidError = 0, maxDisplacement = 0, maxChest = 0;
  let headCount = 0, bootCount = 0, maxEdgeStrain = 0, maxEdgeChange = 0, worstEdge = null;
  const affected = new Set();
  for (const name of ALDEN_IDLE_BRANCHES) findImportedObject(scene, name).traverse(o => affected.add(o));
  const indices = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight;
  const rigid = rest.map((_, i) => Array.from({ length: 4 }, (_, k) => weights.getComponent(i, k) <= 0 || affected.has(mesh.skeleton.bones[indices.getComponent(i, k)])).every(Boolean));
  const triangles = mesh.geometry.index.array;
  for (let frame = 0; frame <= 32; frame++) {
    sample(frame / 8);
    const delta = new Matrix4().multiplyMatrices(spine.matrixWorld, inverseRestSpine);
    const posed = rest.map((point, i) => {
      const current = mesh.getVertexPosition(i, new Vector3());
      assert.ok(current.toArray().every(Number.isFinite));
      const displacement = current.distanceTo(point);
      maxDisplacement = Math.max(maxDisplacement, displacement);
      if (point.y < -0.4 && point.z > 0) { maxBoot = Math.max(maxBoot, displacement); if (!frame) bootCount++; }
      const expected = point.clone().applyMatrix4(delta);
      if (point.y > 1.02) { maxHeadError = Math.max(maxHeadError, current.distanceTo(expected)); if (!frame) headCount++; }
      if (rigid[i]) maxRigidError = Math.max(maxRigidError, current.distanceTo(expected));
      if (point.y > 0.7 && point.y < 0.9 && point.z > 0.3) maxChest = Math.max(maxChest, displacement);
      return current;
    });
    for (let edge = 0; edge < triangles.length; edge++) {
      const a = triangles[edge], b = triangles[edge % 3 === 2 ? edge - 2 : edge + 1];
      const length = rest[a].distanceTo(rest[b]);
      const change = Math.abs(posed[a].distanceTo(posed[b]) - length);
      maxEdgeChange = Math.max(maxEdgeChange, change);
      const strain = change / length;
      if (length > 0.002 && strain > maxEdgeStrain) {
        maxEdgeStrain = strain;
        worstEdge = { a, b, length, change, positionA: rest[a].toArray(), positionB: rest[b].toArray() };
      }
    }
  }
  t.diagnostic(JSON.stringify({ maxBoot, maxHeadError, maxRigidError, maxChest, maxDisplacement, maxEdgeChange, maxEdgeStrain, worstEdge }));
  assert.ok(bootCount > 1000 && headCount > 500);
  assert.ok(maxBoot < 1e-9, `boot displacement ${maxBoot}`);
  assert.ok(maxHeadError < 2e-7, `head coherence error ${maxHeadError}`);
  assert.ok(maxRigidError < 2e-7, `plate/cape coherence error ${maxRigidError}`);
  assert.ok(maxChest > 0.001, 'pectoral geometry must participate');
  assert.ok(maxDisplacement < 0.015, `unbounded vertex ${maxDisplacement}`);
  // Mixed waist weights cannot be rigid with planted legs. Bound their absolute
  // edge-length change to 0.04% of character height; percentages on 2mm edges
  // alone exaggerate sub-millimetre errors. Fully upper-body vertices have the
  // much stricter common-rigid-transform assertion above.
  const height = Math.max(...rest.map(v => v.y)) - Math.min(...rest.map(v => v.y));
  assert.ok(maxEdgeChange < height * 0.0004, `waist / stray-weight edge change ${maxEdgeChange}`);
  idle.reset();
  t.diagnostic(JSON.stringify({ bootCount, headCount, rigidVertices: rigid.filter(Boolean).length, maxBoot, maxHeadError, maxRigidError, maxChest, maxDisplacement, maxEdgeStrain }));
});

test('model placement after capture does not change the local animation', async () => {
  const { scene, sample } = await fixture();
  const expected = sample(2);
  scene.position.set(10, 3, -4);
  scene.rotation.set(0.1, 0.8, -0.1);
  scene.scale.setScalar(1.45);
  assert.ok(maxDifference(expected, sample(2)) < 1e-12);
});
