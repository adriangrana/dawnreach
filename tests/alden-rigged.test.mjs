import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Matrix4, Vector3 } from 'three';
import { loadSkinnedGlb } from '../scripts/assets/load-skinned-glb.mjs';

const require = createRequire(import.meta.url);
const {
  createAldenRiggedIdle, ALDEN_IDLE_BRANCHES, createAldenRiggedWalk,
  sampleAldenWalkFoot, aldenWalkAtSpeed, ALDEN_RIGGED_WALK_SECONDS, ALDEN_RIGGED_WALK_STANCE,
  ALDEN_RIGGED_WALK_STRIDE, ALDEN_RIGGED_WALK_CLEARANCE, ALDEN_RIGGED_WALK_STANCE_WIDTH,
} = require('../node_modules/.cache/alden-rigged-test/heroes/alden/animateAldenRigged.js');
const { findImportedObject } = require('../node_modules/.cache/alden-rigged-test/heroes/animation/coherentBoneMotion.js');
const { sampleAldenGaitPhase } = require('../node_modules/.cache/alden-rigged-test/heroes/alden/aldenWalkPhases.js');
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

test('cape asset surgery preserves the original geometry, materials, nodes and non-cloth skin', async () => {
  const bytes = readFileSync(asset), length = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + length));
  const bin = bytes.subarray(28 + length);
  const { original, changedVertices } = json.extras.dawnreachCapeRig;
  const hash = data => createHash('sha256').update(data).digest('hex');
  assert.equal(hash(bin.subarray(0, original.byteLength)), original.binaryHash);
  const nodes = structuredClone(json.nodes.slice(0, original.nodes));
  for (const node of nodes) if (node.children) node.children = node.children.filter(i => i < original.nodes);
  assert.equal(hash(JSON.stringify({ materials: json.materials, textures: json.textures, images: json.images,
    samplers: json.samplers, nodes, meshes: [original.mesh], skins: [original.skin] })), original.metadataHash);
  const oldAttributes = original.mesh.primitives[0].attributes;
  const attributes = json.meshes[0].primitives[0].attributes;
  for (const key of Object.keys(oldAttributes).filter(k => !['JOINTS_0', 'WEIGHTS_0'].includes(k))) {
    assert.equal(attributes[key], oldAttributes[key]);
  }
  const read = (accessorIndex, vertex, component) => {
    const a = json.accessors[accessorIndex], v = json.bufferViews[a.bufferView];
    const size = a.componentType === 5121 ? 1 : a.componentType === 5123 ? 2 : 4;
    const offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + vertex * (v.byteStride ?? size * 4) + component * size;
    return size === 1 ? bin.readUInt8(offset) : size === 2 ? bin.readUInt16LE(offset) : bin.readFloatLE(offset);
  };
  const { mesh } = await fixture();
  const positions = mesh.geometry.attributes.position;
  let changed = 0;
  for (let i = 0; i < positions.count; i++) {
    const differs = ['JOINTS_0', 'WEIGHTS_0'].some(key => [0,1,2,3].some(k => read(attributes[key], i, k) !== read(oldAttributes[key], i, k)));
    if (differs) {
      changed++;
      assert.ok(positions.getY(i) < 0.78 && positions.getZ(i) < -0.01, 'only rear cloth below shoulder attachments may change');
    }
  }
  assert.equal(changed, changedVertices);
});

test('toe-off joins stance and swing without a knee-driving velocity step', () => {
  for (const speed of [0.5, 1, 1.25, 1.5, 2]) {
    const boundary = ALDEN_RIGGED_WALK_STANCE;
    const epsilon = 1e-4;
    const before2 = sampleAldenWalkFoot(boundary - epsilon * 2, speed).z;
    const before = sampleAldenWalkFoot(boundary - epsilon, speed).z;
    const at = sampleAldenWalkFoot(boundary, speed).z;
    const after = sampleAldenWalkFoot(boundary + epsilon, speed).z;
    const after2 = sampleAldenWalkFoot(boundary + epsilon * 2, speed).z;
    const leftVelocity = (at - before) / epsilon;
    const rightVelocity = (after - at) / epsilon;
    assert.ok(Math.abs(leftVelocity) < 0.02,
      `speed ${speed}: stance still has a sharp rearward velocity at toe-off (${leftVelocity})`);
    assert.ok(Math.abs(rightVelocity) < 0.02,
      `speed ${speed}: swing starts with a sharp velocity at toe-off (${rightVelocity})`);
    assert.ok(before2 >= before - 1e-10 && before >= at - 1e-10,
      `speed ${speed}: terminal stance must keep moving rearward monotonically`);
    assert.ok(after >= at - 1e-10 && after2 >= after - 1e-10,
      `speed ${speed}: initial swing must move forward monotonically`);
  }
});

test('gait knee and boot pitch have no hidden acceleration knots during swing', () => {
  const epsilon = 1e-4;
  const sampleSecondDerivative = (phase, key, side) => {
    const a = sampleAldenGaitPhase(phase + (side === 'left' ? -2 * epsilon : 0))[key];
    const b = sampleAldenGaitPhase(phase + (side === 'left' ? -epsilon : epsilon))[key];
    const c = sampleAldenGaitPhase(phase + (side === 'left' ? 0 : 2 * epsilon))[key];
    return (c - 2 * b + a) / (epsilon * epsilon);
  };
  // These were the old internal Hermite knots that produced a visible robotic tick.
  for (const phase of [0.5, 0.6]) {
    const kneeLeft = sampleSecondDerivative(phase, 'knee', 'left');
    const kneeRight = sampleSecondDerivative(phase, 'knee', 'right');
    assert.ok(Math.abs(kneeLeft - kneeRight) < 50,
      `knee acceleration discontinuity at ${phase}: ${kneeLeft} vs ${kneeRight}`);
  }
  for (const phase of [0.6, 0.87]) {
    const pitchLeft = sampleSecondDerivative(phase, 'pitch', 'left');
    const pitchRight = sampleSecondDerivative(phase, 'pitch', 'right');
    assert.ok(Math.abs(pitchLeft - pitchRight) < 50,
      `boot pitch acceleration discontinuity at ${phase}: ${pitchLeft} vs ${pitchRight}`);
  }
});

test('airborne foot return is monotonic with no rear-forward-rear recoil', () => {
  for (const speed of [0.5, 1, 1.25, 1.5, 2]) {
    const samples = 400;
    let previous = sampleAldenWalkFoot(ALDEN_RIGGED_WALK_STANCE + 1e-6, speed).z;
    for (let i = 1; i <= samples; i++) {
      const phase = ALDEN_RIGGED_WALK_STANCE
        + (1 - ALDEN_RIGGED_WALK_STANCE) * i / samples;
      const current = sampleAldenWalkFoot(phase, speed).z;
      assert.ok(current >= previous - 1e-10,
        `speed ${speed}: swing reverses longitudinally at phase ${phase} (${previous} -> ${current})`);
      previous = current;
    }
  }
});

test('speed bonuses increase stride, cadence and arms while preserving reachable feet and cape clearance', async t => {
  const { scene, mesh } = await fixture();
  const walk = createAldenRiggedWalk(scene);
  const ankles = ['L','R'].map(side => findImportedObject(scene, 'DEF-foot.' + side));
  const knees = ['L','R'].map(side => findImportedObject(scene, 'DEF-shin.' + side));
  const hips = ['L','R'].map(side => findImportedObject(scene, 'DEF-thigh.' + side));
  const lengths = hips.map((hip, side) => [hip.getWorldPosition(new Vector3()).distanceTo(knees[side].getWorldPosition(new Vector3())),
    knees[side].getWorldPosition(new Vector3()).distanceTo(ankles[side].getWorldPosition(new Vector3()))]);
  const restGround = Math.min(...Array.from({ length: mesh.geometry.attributes.position.count }, (_, i) => mesh.getVertexPosition(i, new Vector3()).y));
  const indices = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight;
  const capeVertices = Array.from({ length: indices.count }, (_, i) => i).filter(i => [0,1,2,3].some(k => indices.getComponent(i,k) >= 161 && weights.getComponent(i,k) > 0));
  let maxLengthError = 0, minCapeY = Infinity;
  let minContactFlexion = Infinity, maxContactFlexion = 0;
  const profiles = [0.5,1,1.25,1.5,2].map(speed => aldenWalkAtSpeed(speed));
  for (const gait of profiles) {
    assert.ok(Math.abs(gait.stride / gait.period / (ALDEN_RIGGED_WALK_STRIDE / ALDEN_RIGGED_WALK_SECONDS) - gait.speed) < 1e-10);
    for (let frame = 0; frame <= 40; frame++) {
      const phase = frame / 40;
      walk.apply(phase * gait.period, gait.speed);
      scene.updateMatrixWorld(true);
      for (let side = 0; side < 2; side++) {
        const hip = hips[side].getWorldPosition(new Vector3()), knee = knees[side].getWorldPosition(new Vector3()), ankle = ankles[side].getWorldPosition(new Vector3());
        maxLengthError = Math.max(maxLengthError, Math.abs(hip.distanceTo(knee) - lengths[side][0]), Math.abs(knee.distanceTo(ankle) - lengths[side][1]));
        if ((frame === 0 || frame === 40) && side === 0 || frame === 20 && side === 1) {
          const knee = knees[side].getWorldPosition(new Vector3());
          const upper = knee.clone().sub(hips[side].getWorldPosition(new Vector3())).normalize();
          const lower = ankles[side].getWorldPosition(new Vector3()).sub(knee).normalize();
          const flexion = Math.acos(Math.min(1, Math.max(-1, upper.dot(lower)))) * 180 / Math.PI;
          minContactFlexion = Math.min(minContactFlexion, flexion);
          maxContactFlexion = Math.max(maxContactFlexion, flexion);
        }
      }
      for (const i of capeVertices) minCapeY = Math.min(minCapeY, mesh.getVertexPosition(i, new Vector3()).y);
    }
  }
  assert.ok(profiles[2].stride > profiles[1].stride && profiles[2].period < profiles[1].period && profiles[2].armDegrees > profiles[1].armDegrees);
  t.diagnostic(JSON.stringify({ maxLengthError, minCapeY, minContactFlexion, maxContactFlexion }));
  assert.ok(minContactFlexion > 0 && maxContactFlexion < 5, 'the leading knee must nearly extend at contact without locking');
  assert.ok(maxLengthError < 1e-6, 'speed bonuses must preserve thigh and shin lengths');
  assert.ok(minCapeY > restGround + 0.005, 'cape clears the floor at all preview speeds');
  const pose = () => mesh.skeleton.bones.flatMap(b => [...b.position, ...b.quaternion]);
  walk.apply(0.37, 1);
  const before = pose();
  walk.advance(0, 2);
  assert.ok(maxDifference(before, pose()) < 1e-10, 'speed changes must preserve phase at zero elapsed time');
  walk.advance(1e-6, 2);
  assert.ok(maxDifference(before, pose()) < 0.0001, 'acceleration must be continuous');
  for (let frame = 0; frame < 120; frame++) walk.advance(1 / 60, 2);
  assert.ok(pose().every(Number.isFinite));
  t.diagnostic(JSON.stringify({ profiles, maxLengthError, minCapeY }));
});

test('weight transfer does not create a knee velocity kick at heel contact or toe-off', async () => {
  const { scene } = await fixture();
  const walk = createAldenRiggedWalk(scene);
  const knees = ['L', 'R'].map(side => findImportedObject(scene, 'DEF-shin.' + side));
  const sampleKnee = (phase, side) => {
    walk.apply(phase * ALDEN_RIGGED_WALK_SECONDS);
    scene.updateMatrixWorld(true);
    return knees[side].getWorldPosition(new Vector3());
  };
  const epsilon = 1e-3;
  for (const boundary of [0, 0.5, 0.6]) {
    for (let side = 0; side < 2; side++) {
      const before = sampleKnee(boundary - epsilon, side);
      const center = sampleKnee(boundary, side);
      const after = sampleKnee(boundary + epsilon, side);
      const leftVelocity = center.clone().sub(before).multiplyScalar(1 / epsilon);
      const rightVelocity = after.clone().sub(center).multiplyScalar(1 / epsilon);
      assert.ok(leftVelocity.distanceTo(rightVelocity) < 0.08,
        `side ${side} knee velocity kick at phase ${boundary}: ${leftVelocity.distanceTo(rightVelocity)}`);
    }
  }
});

test('trailing knees flex once through toe-off without rebounds or pauses, at every preview speed', async t => {
  const { scene } = await fixture();
  const walk = createAldenRiggedWalk(scene);
  let worstReversal = 0, worstStep = 0;
  for (const speed of [0.5, 1, 1.25, 1.5, 2]) for (const [side, offset] of [['L', 0], ['R', 0.5]]) {
    const bones = ['thigh', 'shin', 'foot'].map(name => findImportedObject(scene, `DEF-${name}.${side}`));
    const flexAt = phase => {
      walk.apply((phase + offset) * aldenWalkAtSpeed(speed).period, speed);
      scene.updateMatrixWorld(true);
      const [hip, knee, ankle] = bones.map(b => b.getWorldPosition(new Vector3()));
      return knee.clone().sub(hip).angleTo(ankle.clone().sub(knee)) * 180 / Math.PI;
    };
    for (const [phase, min, max] of [[0, 0, 5], [.1, 15, 20], [.3, 0, 5], [.4, 0, 5], [.6, 35, 41], [.73, 55, 65], [.87, 20, 30]]) {
      const angle = flexAt(phase);
      assert.ok(angle >= min && angle <= max, `${side} ${speed} phase ${phase}: ${angle} degrees`);
    }
    for (const [start, end, sign] of [[.4, .73, 1], [.73, 1, -1]]) {
      let previous = flexAt(start);
      for (let frame = Math.round(start * 1000) + 1; frame <= Math.round(end * 1000); frame++) {
        const current = flexAt(frame / 1000), delta = current - previous;
        worstReversal = Math.max(worstReversal, -delta * sign);
        worstStep = Math.max(worstStep, Math.abs(delta));
        assert.ok(delta * sign >= -0.01, `${side} ${speed}: knee reverses at ${frame / 1000} (${delta} degrees)`);
        assert.ok(Math.abs(delta) < 0.7, 'no knee pop between adjacent samples');
        previous = current;
      }
    }
    for (const phase of [.5, .6]) assert.ok(flexAt(phase + .001) - flexAt(phase - .001) > .15,
      'flexion must continue through pre-swing and toe-off instead of stopping at landmarks');
  }
  t.diagnostic(JSON.stringify({ worstReversal, worstStep }));
});

test('real GLB binding resolves sanitized names, disconnected branches and the untouched weapon socket', async () => {
  const { scene, mesh, animations, idle, sample } = await fixture();
  assert.equal(mesh.skeleton.bones.length, 176);
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

test('idle: planted boots, rigid head/chest and bounded motion of the hanging cape', async t => {
  const { scene, mesh, idle, sample } = await fixture();
  const positions = mesh.geometry.attributes.position;
  sample(0); // Static gravity drape is the baseline; evaluate cyclic motion from it.
  const rest = Array.from({ length: positions.count }, (_, i) => mesh.getVertexPosition(i, new Vector3()));
  const spine = findImportedObject(scene, 'DEF-spine.003');
  const inverseRestSpine = spine.matrixWorld.clone().invert();
  let maxBoot = 0, maxHeadError = 0, maxRigidError = 0, maxDisplacement = 0, maxChest = 0;
  let headCount = 0, bootCount = 0, maxEdgeStrain = 0, maxEdgeChange = 0, worstEdge = null;
  const affected = new Set();
  for (const name of ALDEN_IDLE_BRANCHES) findImportedObject(scene, name).traverse(o => { if (!o.name.startsWith('CAPE-')) affected.add(o); });
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

test('walk alternates support with smooth landings and constant stance speed', () => {
  const epsilon = 1e-5;
  for (const boundary of [0, ALDEN_RIGGED_WALK_STANCE, 1]) {
    const a = sampleAldenWalkFoot(boundary - epsilon), b = sampleAldenWalkFoot(boundary), c = sampleAldenWalkFoot(boundary + epsilon);
    for (const key of ['z', 'lift']) assert.ok(Math.abs((b[key] - a[key]) / epsilon - (c[key] - b[key]) / epsilon) < 0.003);
  }
  for (let phase = 0; phase < 1; phase += 0.01) {
    assert.ok(sampleAldenWalkFoot(phase).supporting || sampleAldenWalkFoot(phase + 0.5).supporting, 'walk cannot have a flight phase');
  }
  for (const phase of [0.1, 0.3, 0.5]) {
    const a = sampleAldenWalkFoot(phase), b = sampleAldenWalkFoot(phase + epsilon);
    assert.equal(a.lift, 0);
    assert.ok(Math.abs((b.z - a.z) / epsilon + ALDEN_RIGGED_WALK_STRIDE / ALDEN_RIGGED_WALK_STANCE) < 1e-9);
  }
});

test('walk: narrow supports, grounded soles, forward knees, coherent head/chest and hanging cape', async t => {
  const { scene, mesh } = await fixture();
  const walk = createAldenRiggedWalk(scene);
  const rest = Array.from({ length: mesh.geometry.attributes.position.count }, (_, i) => mesh.getVertexPosition(i, new Vector3()));
  const feet = ['L', 'R'].map(side => {
    const ankle = findImportedObject(scene, `DEF-foot.${side}`);
    const vertices = rest.flatMap((point, i) => point.y < -0.57 && point.z > 0 && (side === 'L' ? point.x > -0.433 : point.x < -0.433) ? [i] : []);
    return { ankle, knee: findImportedObject(scene, `DEF-shin.${side}`), hip: findImportedObject(scene, `DEF-thigh.${side}`),
      origin: ankle.getWorldPosition(new Vector3()), vertices, ground: Math.min(...vertices.map(i => rest[i].y)) };
  });
  feet.forEach(leg => { leg.origin.z = leg.hip.getWorldPosition(new Vector3()).z; });
  const spine = findImportedObject(scene, 'DEF-spine.003');
  const inverseRestSpine = spine.matrixWorld.clone().invert();
  const indices = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight;
  const articulated = mesh.skeleton.bones.map(b => /^(CAPE-|DEF-(thigh|shin|foot|toe|upper_arm|forearm|hand|thumb|palm|f_))/.test(b.userData.name));
  const rigid = rest.map((_, i) => [0, 1, 2, 3].every(k => weights.getComponent(i, k) === 0 || !articulated[indices.getComponent(i, k)]));
  let maxContactError = 0, maxLateralError = 0, maxRigidError = 0, maxVertexDisplacement = 0;
  let minClearance = Infinity, minTorsoForward = Infinity;
  let worstContact = null;
  let minKneeForward = Infinity, maxLift = 0, maxEdgeChange = 0, worstWalkEdge = null;
  let minCapeY = Infinity, maxCapeWidth = 0, maxCapeRear = -Infinity;
  const centerX = findImportedObject(scene, 'DEF-spine').getWorldPosition(new Vector3()).x;
  const capeVertex = rest.map((_, i) => [0,1,2,3].some(k => indices.getComponent(i,k) >= 161 && weights.getComponent(i,k) > 0));
  const point = new Vector3(), delta = new Matrix4();
  for (let frame = 0; frame <= 80; frame++) {
    const phase = frame / 80;
    walk.apply(phase * ALDEN_RIGGED_WALK_SECONDS);
    scene.updateMatrixWorld(true);
    const pelvis = findImportedObject(scene, 'DEF-spine').getWorldPosition(new Vector3());
    minTorsoForward = Math.min(minTorsoForward, findImportedObject(scene, 'DEF-spine.006').getWorldPosition(new Vector3()).z - pelvis.z);
    delta.multiplyMatrices(spine.matrixWorld, inverseRestSpine);
    const posed = rest.map((original, i) => {
      const current = mesh.getVertexPosition(i, new Vector3());
      assert.ok(current.toArray().every(Number.isFinite));
      if (!capeVertex[i]) maxVertexDisplacement = Math.max(maxVertexDisplacement, current.distanceTo(original));
      if (rigid[i]) maxRigidError = Math.max(maxRigidError, current.distanceTo(point.copy(original).applyMatrix4(delta)));
      return current;
    });
    const capePoints = posed.filter((_, i) => capeVertex[i]);
    minCapeY = Math.min(minCapeY, ...capePoints.map(v => v.y));
    maxCapeWidth = Math.max(maxCapeWidth, Math.max(...capePoints.map(v => v.x)) - Math.min(...capePoints.map(v => v.x)));
    maxCapeRear = Math.max(maxCapeRear, -Math.min(...capePoints.map(v => v.z)));
    for (let side = 0; side < 2; side++) {
      const leg = feet[side], foot = sampleAldenWalkFoot(phase + side * 0.5);
      const lowest = Math.min(...leg.vertices.map(i => posed[i].y));
      if (foot.supporting && Math.abs(lowest - leg.ground) > maxContactError) {
        maxContactError = Math.abs(lowest - leg.ground);
        worstContact = { phase, side, lowest, ground: leg.ground };
      }
      minClearance = Math.min(minClearance, lowest - leg.ground);
      maxLift = Math.max(maxLift, lowest - leg.ground);
      const hip = leg.hip.getWorldPosition(new Vector3()), knee = leg.knee.getWorldPosition(new Vector3()), ankle = leg.ankle.getWorldPosition(new Vector3());
      const direction = ankle.clone().sub(hip).normalize();
      const bend = knee.clone().sub(hip);
      bend.addScaledVector(direction, -bend.dot(direction));
      minKneeForward = Math.min(minKneeForward, bend.z);
      maxLateralError = Math.max(maxLateralError, Math.abs(ankle.x - (centerX + (side === 0 ? 1 : -1) * ALDEN_RIGGED_WALK_STANCE_WIDTH / 2)));
    }
    const triangles = mesh.geometry.index.array;
    for (let edge = 0; edge < triangles.length; edge++) {
      const a = triangles[edge], b = triangles[edge % 3 === 2 ? edge - 2 : edge + 1];
      const change = Math.abs(posed[a].distanceTo(posed[b]) - rest[a].distanceTo(rest[b]));
      if (change > maxEdgeChange) {
        maxEdgeChange = change;
        worstWalkEdge = { a, b, phase, restLength: rest[a].distanceTo(rest[b]), position: rest[a].toArray(),
          influences: [a,b].map(i => [0,1,2,3].map(k => [mesh.skeleton.bones[indices.getComponent(i,k)].userData.name, weights.getComponent(i,k)])) };
      }
    }
  }
  t.diagnostic(JSON.stringify({ maxContactError, worstContact, maxLateralError, minClearance, minTorsoForward, maxRigidError, maxVertexDisplacement, minKneeForward, maxLift, maxEdgeChange, worstWalkEdge, minCapeY, maxCapeWidth, maxCapeRear }));
  assert.ok(maxContactError < 0.001, 'heel/sole/toe contact must stay grounded within 1mm');
  assert.ok(minClearance > -0.001 && maxLift < 0.2, 'boots cannot penetrate the ground or jump excessively');
  assert.ok(maxLateralError < 1e-5, 'ankles must preserve the narrow stance');
  assert.ok(minKneeForward > 0.008, 'nearly extended knees must still bend forward, never reverse');
  assert.ok(minTorsoForward > 0.05, 'the torso must not lean behind the pelvis');
  assert.ok(maxRigidError < 1e-6, 'head/pectoral vertices must share one rigid delta');
  assert.ok(maxLift > ALDEN_RIGGED_WALK_CLEARANCE * 0.95);
  assert.ok(maxVertexDisplacement < ALDEN_RIGGED_WALK_STRIDE / 2 + 0.2, 'no body vertices beyond the stride and boot-roll envelope');
  assert.ok(minCapeY > Math.min(...feet.map(f => f.ground)) + 0.005, 'cape must clear the floor');
  assert.ok(maxCapeWidth < 1.05 && maxCapeRear < 0.38, 'cape should hang close with clearance behind the legs');
});

test('walk loops without drift, resets exactly and survives model placement', async () => {
  const { scene, mesh } = await fixture();
  const rest = mesh.skeleton.bones.flatMap(b => [...b.position, ...b.quaternion, ...b.scale]);
  const socket = findImportedObject(scene, 'weapon_socket.R');
  const socketRest = socket.matrix.clone();
  const parents = mesh.skeleton.bones.map(b => b.parent);
  const attributes = ['position', 'skinIndex', 'skinWeight'].map(key => mesh.geometry.attributes[key].array.slice());
  const walk = createAldenRiggedWalk(scene);
  const pose = time => {
    walk.apply(time);
    return mesh.skeleton.bones.flatMap(b => [...b.position, ...b.quaternion, ...b.scale]);
  };
  for (const time of [0, 0.2, 0.7, 1.399]) assert.ok(maxDifference(pose(time), pose(time + ALDEN_RIGGED_WALK_SECONDS)) < 1e-9);
  for (const boundary of [0, 0.1, 0.3, 0.4, 0.5, 0.6, 0.73, 0.87]) {
    const time = boundary * ALDEN_RIGGED_WALK_SECONDS, epsilon = 1e-5;
    const left = pose(time - epsilon), center = pose(time), right = pose(time + epsilon);
    const before = center.map((v, i) => (v - left[i]) / epsilon);
    const after = right.map((v, i) => (v - center[i]) / epsilon);
    assert.ok(maxDifference(before, after) < 0.005, 'joint velocity must be continuous at support transitions');
  }
  const expected = pose(0.95);
  for (let i = 0; i < 3000; i++) pose(i / 60);
  assert.ok(maxDifference(expected, pose(0.95)) < 1e-9);
  scene.position.set(10, 3, -4);
  scene.rotation.set(0.1, 0.8, -0.1);
  scene.scale.setScalar(1.45);
  assert.ok(maxDifference(expected, pose(0.95)) < 1e-6);
  assert.deepEqual(socket.matrix.elements, socketRest.elements);
  assert.equal(socket.parent, findImportedObject(scene, 'DEF-hand.R'));
  assert.ok(maxDifference(socket.matrixWorld.elements, new Matrix4().multiplyMatrices(socket.parent.matrixWorld, socketRest).elements) < 1e-9);
  ['position', 'skinIndex', 'skinWeight'].forEach((key, i) => assert.deepEqual(mesh.geometry.attributes[key].array, attributes[i]));
  mesh.skeleton.bones.forEach((b, i) => assert.equal(b.parent, parents[i]));
  walk.reset();
  assert.deepEqual(mesh.skeleton.bones.flatMap(b => [...b.position, ...b.quaternion, ...b.scale]), rest);
});
