import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const THREE = require('three');
const { buildSeryn } = require('../node_modules/.cache/seryn-test/heroes/seryn/buildSeryn.js');
const { animateSeryn, SERYN_ATTACK_RELEASE_PROGRESS } = require('../node_modules/.cache/seryn-test/heroes/seryn/animateSeryn.js');
const { SERYN_STRING_FINGERS } = require('../node_modules/.cache/seryn-test/heroes/seryn/archeryPose.js');
const { createSerynLoftGeometry, createTaperedCurveGeometry } = require('../node_modules/.cache/seryn-test/heroes/seryn/geometry.js');

// Geometry/animation checks do not need a GPU. The viewer separately verifies the
// real CanvasTexture artwork and WebGL rendering; this context only supplies its API.
globalThis.document = {
  createElement() {
    const gradient = { addColorStop() {} };
    const context = new Proxy({}, { get: (_target, key) => key === 'createLinearGradient' || key === 'createRadialGradient' ? () => gradient : () => {}, set: () => true });
    return { width: 0, height: 0, getContext: () => context };
  },
};

test('Seryn has valid geometry and normalized joint weights', () => {
  const rig = buildSeryn();
  let meshes = 0, triangles = 0, articulated = 0;
  rig.root.traverse(object => {
    if (!object.isMesh) return;
    meshes++;
    const geometry = object.geometry;
    triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3;
    for (const attribute of Object.values(geometry.attributes)) assert.ok(attribute.array.every(Number.isFinite), object.name);
    if (!object.isSkinnedMesh) return;
    articulated++;
    const weights = geometry.attributes.skinWeight;
    for (let i = 0; i < weights.count; i++) {
      assert.ok(Math.abs(weights.getX(i) + weights.getY(i) - 1) < 1e-6);
      assert.ok(weights.getX(i) >= 0 && weights.getY(i) >= 0);
    }
  });
  assert.equal(articulated, 6, 'sleeves, shoulders and boots must use joint deformation');
  assert.ok(triangles < 350_000, `triangle budget: ${triangles}`);
  assert.ok(meshes < 450, `mesh budget: ${meshes}`);
});

test('loft UV seams shade continuously and curved trim has outward normals', () => {
  const loft = createSerynLoftGeometry([{ y: 0, rx: 1, rz: 1 }, { y: 1, rx: 1, rz: 1 }], 32);
  const n = loft.attributes.normal;
  for (let row = 0; row < 2; row++) {
    assert.ok(new THREE.Vector3().fromBufferAttribute(n, row * 33).distanceTo(new THREE.Vector3().fromBufferAttribute(n, row * 33 + 32)) < 1e-7);
  }
  const tube = createTaperedCurveGeometry([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 2, 0)], .1, .1, 20, 12);
  const p = tube.attributes.position, normal = tube.attributes.normal;
  for (let i = 13; i < p.count - 13; i++) assert.ok(p.getX(i) * normal.getX(i) + p.getZ(i) * normal.getZ(i) > .08);
});

test('cloth remains finite, bounded and sewn through walk, idle and attack at game/viewer scales', () => {
  for (const scale of [.34, 1, 1.45]) {
    const rig = buildSeryn();
    rig.root.scale.setScalar(scale);
    rig.root.position.set(7, .05, -3);
    for (let frame = 0; frame < 150; frame++) {
      const moving = frame < 90;
      rig.root.userData.serynAttackProgress = frame >= 105 ? (frame - 105) / 45 : 0;
      animateSeryn(rig, frame / 30, moving, 1 / 30);
      rig.root.updateMatrixWorld(true);
      for (const cloth of rig.clothMeshes) {
        const p = cloth.geometry.attributes.position, rest = cloth.geometry.userData.serynClothBasePositions;
        const half = p.count / 2;
        for (let i = 0; i < half; i++) {
          const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
          assert.ok([x, y, z].every(Number.isFinite), cloth.name);
          assert.ok(Math.hypot(x - rest[i * 3], y - rest[i * 3 + 1], z - rest[i * 3 + 2]) < .9, `${cloth.name} cannot explode`);
          for (const [axis,value] of [[0,x],[1,y],[2,z]]) {
            const opposite = p.array[(i + half) * 3 + axis];
            assert.ok(Math.abs((value - opposite) - (rest[i * 3 + axis] - rest[(i + half) * 3 + axis])) < 1e-6, 'sewn thickness');
          }
          if (cloth.geometry.attributes.uv.getY(i) === 0) assert.ok(Math.hypot(x - rest[i * 3], y - rest[i * 3 + 1], z - rest[i * 3 + 2]) < 1e-6, 'pinned seam');
        }
      }
    }
    assert.deepEqual(rig.root.scale.toArray(), [scale, scale, scale]);
  }
});

test('skinned joints deform without detaching the bow or changing arrow release timing', () => {
  const rig = buildSeryn();
  for (const progress of [.1, .28, .45, .60, SERYN_ATTACK_RELEASE_PROGRESS + .01, .95, 0]) {
    rig.root.userData.serynAttackProgress = progress;
    animateSeryn(rig, progress * 3, false);
    rig.root.updateMatrixWorld(true);
    rig.root.traverse(object => {
      if (!object.isSkinnedMesh) return;
      object.skeleton.update();
      assert.ok(object.skeleton.boneMatrices.every(Number.isFinite));
      const p = object.geometry.attributes.position;
      for (let i = 0; i < p.count; i += 17) {
        const vertex = new THREE.Vector3(); object.getVertexPosition(i, vertex);
        assert.ok(vertex.toArray().every(Number.isFinite));
        assert.ok(vertex.length() < 2, object.name);
      }
    });
    assert.equal(rig.bow.parent, rig.sockets.leftHand);
    assert.equal(rig.nockedArrow.visible, progress >= .40 && progress < SERYN_ATTACK_RELEASE_PROGRESS);
  }
});

test('archery keeps finger contact and a single firing line at every draw phase and hero transform', () => {
  for (const scale of [.34, 1, 1.45]) {
    const rig = buildSeryn();
    rig.root.position.set(8, .2, -5);
    rig.root.rotation.y = 1.1;
    rig.model.scale.setScalar(scale);
    const world = (object, point = new THREE.Vector3()) => object.localToWorld(point.clone());
    for (const p of [.34, .4, .48, .57, .639]) {
      rig.root.userData.serynAttackProgress = p;
      animateSeryn(rig, 0, false);
      rig.root.updateMatrixWorld(true);
      const string = rig.bowString.geometry.attributes.position;
      const nock = world(rig.bow, new THREE.Vector3().fromBufferAttribute(string, 1));
      const fingers = world(rig.sockets.rightHand, SERYN_STRING_FINGERS);
      assert.ok(nock.distanceTo(fingers) / scale < 1e-6, `string must touch fingers at ${p}`);
      assert.ok(world(rig.nockedArrow).distanceTo(nock) / scale < 1e-6);
      const rest = world(rig.bow, new THREE.Vector3(-.052, .075, .018));
      const arrowDirection = new THREE.Vector3(0, 1, 0).transformDirection(rig.nockedArrow.matrixWorld);
      assert.ok(arrowDirection.dot(rest.clone().sub(nock).normalize()) > .99999, 'arrow passes through the rest');
      assert.ok(rest.distanceTo(nock) / scale < .97, 'shaft reaches beyond the bow');
      assert.ok(world(rig.bow, new THREE.Vector3(-.052, 0, 0))
        .distanceTo(world(rig.sockets.leftHand, new THREE.Vector3(0, -.060, -.018))) / scale < 1e-6, 'grip stays in palm');
      if (p >= .57) {
        const forward = new THREE.Vector3(0, 0, 1).transformDirection(rig.model.matrixWorld);
        assert.ok(arrowDirection.dot(forward) > .999, 'arrow follows gameplay facing');
        assert.ok(new THREE.Vector3(0, 1, 0).transformDirection(rig.bow.matrixWorld).dot(new THREE.Vector3(0, 1, 0)) > .999);
        const shoulder = world(rig.rightArm), elbow = world(rig.rightForearm), wrist = world(rig.sockets.rightHand);
        const bend = elbow.clone().sub(shoulder).angleTo(wrist.clone().sub(elbow));
        assert.ok(bend > .8 && bend < 2.4, 'drawing elbow must not fold to 180 degrees');
        assert.ok(Math.abs(elbow.y - fingers.y) / scale < .12, 'drawing elbow stays at arrow height');
        assert.ok(world(rig.head).distanceTo(fingers) / scale < .26, 'draw anchors beside face');
      }
    }
  }
});

test('attack recovery blends into the same idle joints without a last-frame wrist snap', () => {
  const rig = buildSeryn();
  const joints = [rig.torso, rig.head, rig.leftArm, rig.rightArm, rig.leftForearm, rig.rightForearm,
    rig.sockets.leftHand, rig.sockets.rightHand, rig.bow];
  rig.root.userData.serynAttackProgress = .9999;
  animateSeryn(rig, 0, false);
  const ending = joints.map(joint => joint.quaternion.clone());
  rig.root.userData.serynAttackProgress = 0;
  animateSeryn(rig, 0, false);
  joints.forEach((joint, i) => assert.ok(joint.quaternion.angleTo(ending[i]) < .001, joint.name));
  const string = rig.bowString.geometry.attributes.position;
  assert.ok(new THREE.Vector3().fromBufferAttribute(string, 1).distanceTo(rig.bowStringRestNock) < 1e-7);
  assert.equal(rig.handArrow.visible, false);
  assert.equal(rig.nockedArrow.visible, false);
});
