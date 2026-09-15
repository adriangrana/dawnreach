import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const THREE = require('three');
const { buildAlden } = require('../node_modules/.cache/alden-test/heroes/alden/buildAlden.js');
const { ALDEN_DEFAULT_MOVE_SPEED, ALDEN_FAST_WALK_SPEED, ALDEN_GAIT_RATE, ALDEN_WALK_SPEED, animateAlden } = require('../node_modules/.cache/alden-test/heroes/alden/animateAlden.js');
const { capeSurface, breastclothSurface, createBreastplateGeometry } = require('../node_modules/.cache/alden-test/heroes/alden/geometry.js');
const { createHumanoidRig } = require('../node_modules/.cache/alden-test/characters/humanoidRig.js');
const { buildHumanoidBody } = require('../node_modules/.cache/alden-test/characters/buildHumanoidBody.js');
const { animateHumanoid } = require('../node_modules/.cache/alden-test/characters/animateHumanoid.js');

test('Alden animation preserves the presentation scale while walking and resting', () => {
  for (const scale of [0.34, 0.493, 0.986, 1.4]) {
    const rig = makeRig();
    rig.model.scale.setScalar(scale);
    for (let frame = 0; frame < 180; frame++) {
      animateAlden(rig, frame / 60, frame < 120, 1 / 60, 3.4);
      assert.deepEqual(rig.model.scale.toArray(), [scale, scale, scale]);
    }
  }
});

test('bare humanoid rigs have usable contacts, anatomical side names and no required equipment', () => {
  for (const bodyScale of [0, -1, NaN, Infinity]) assert.throws(() => createHumanoidRig({ bodyScale }), RangeError);
  for (const armRestAngle of [-1, NaN, Infinity, Math.PI]) assert.throws(() => createHumanoidRig({ armRestAngle }), RangeError);
  const rig = createHumanoidRig();
  assert.equal(rig.cape, undefined);
  assert.equal(rig.sword, undefined);
  for (let frame = 0; frame < 120; frame += 1) animateHumanoid(rig, frame / 60, frame < 60);
  rig.root.updateMatrixWorld(true);
  rig.root.traverse(part => assert.ok(part.matrixWorld.elements.every(Number.isFinite)));
  assert.equal(rig.sockets.leftHand.parent, rig.leftForearm);
  assert.equal(rig.sockets.rightHand.parent, rig.rightForearm);
  assert.equal(rig.sockets.head.parent, rig.head);
  assert.equal(rig.sockets.back.parent, rig.torso);
  const localX = joint => rig.torso.worldToLocal(joint.getWorldPosition(new THREE.Vector3())).x;
  assert.ok(localX(rig.leftArm) > 0, 'anatomical left shoulder must be +X for a +Z-facing humanoid');
  assert.ok(localX(rig.rightArm) < 0, 'anatomical right shoulder must be -X for a +Z-facing humanoid');
  assert.ok(localX(rig.sockets.leftHand) > 0, 'left hand socket must stay on anatomical left');
  assert.ok(localX(rig.sockets.rightHand) < 0, 'right hand socket must stay on anatomical right');
});

test('the basic body reuses Alden joint curves at different uniform sizes and keeps its soles grounded', () => {
  const alden = makeRig();
  for (const bodyScale of [0.8, 1, 1.2]) {
    const body = buildHumanoidBody({ bodyScale });
    assert.equal(body.cape, undefined);
    assert.equal(body.sword, undefined);
    body.root.position.set(3, 0.03, -2);
    body.model.rotation.y = 1.1;
    let triangles = 0;
    body.root.traverse(part => {
      if (!part.isMesh) return;
      assert.ok(part.castShadow && part.receiveShadow);
      for (const attribute of Object.values(part.geometry.attributes)) assert.ok(Array.from(attribute.array).every(Number.isFinite));
      triangles += part.geometry.index.count / 3;
    });
    assert.ok(triangles > 1000 && triangles < 16000);
    for (let frame = 0; frame < 120; frame += 1) {
      const phase = frame / 120 * Math.PI * 2;
      poseAtPhase(alden, phase);
      body.gait.phase = phase;
      body.gait.weight = 1;
      animateHumanoid(body, frame / 60, true, 0);
      body.root.updateMatrixWorld(true);
      for (const joint of ['leftLeg', 'rightLeg', 'leftShin', 'rightShin', 'leftFoot', 'rightFoot', 'leftArm', 'rightArm', 'leftForearm', 'rightForearm']) {
        assert.ok(body[joint].quaternion.angleTo(alden[joint].quaternion) < 1e-6, joint);
      }
      const lowest = Math.min(...body.soleSamples.flatMap(({ foot, points }) => points.map(point => point.clone().applyMatrix4(foot.matrixWorld).y)));
      assert.ok(Math.abs(lowest - body.root.position.y - 0.015 * bodyScale) < 1e-6);
      const head = body.model.worldToLocal(body.head.getWorldPosition(new THREE.Vector3()));
      assert.ok(Math.abs(head.x) < 1e-6);
      assert.ok(body.head.getWorldQuaternion(new THREE.Quaternion()).angleTo(body.model.getWorldQuaternion(new THREE.Quaternion())) < 1e-6);
      assert.deepEqual(body.root.position.toArray(), [3, 0.03, -2]);
      assert.equal(body.model.rotation.y, 1.1);
    }
    body.gait.phase = 0;
    animateHumanoid(body, 0, true, 0.1, ALDEN_WALK_SPEED);
    assert.ok(Math.abs(body.gait.phase - Math.PI * ALDEN_WALK_SPEED / 1.2 / bodyScale * 0.1) < 1e-8);
  }
});

test('shoulders share a continuous weighted surface with the chest throughout walking', () => {
  for (const bodyScale of [0.8, 1, 1.2]) {
    const body = buildHumanoidBody({ bodyScale });
    assert.equal(body.root.getObjectByName('shoulder-joint'), undefined);
    const chest = body.root.getObjectByName('thoracic-shell');
    assert.ok(chest.isSkinnedMesh);
    const chestIndices = new Set(chest.geometry.index.array);
    const shoulders = ['left', 'right'].map(side => body.root.getObjectByName(`${side}-shoulder-surface`));
    const edges = new Map();
    let signedVolume = 0;
    for (const mesh of [chest, ...shoulders]) {
      const indices = mesh.geometry.index.array;
      const position = mesh.geometry.attributes.position;
      for (let triangle = 0; triangle < indices.length; triangle += 3) {
        const corners = Array.from(indices.slice(triangle, triangle + 3));
        const points = corners.map(index => new THREE.Vector3().fromBufferAttribute(position, index));
        signedVolume += points[0].dot(points[1].clone().cross(points[2])) / 6;
        for (let corner = 0; corner < 3; corner += 1) {
          const from = corners[corner];
          const to = corners[(corner + 1) % 3];
          const key = `${Math.min(from, to)}:${Math.max(from, to)}`;
          const edge = edges.get(key) ?? { count: 0, orientation: 0 };
          edge.count += 1;
          edge.orientation += from < to ? 1 : -1;
          edges.set(key, edge);
        }
      }
    }
    assert.ok(signedVolume > 0, 'upper body faces outward');
    for (const [key, edge] of edges) {
      assert.equal(edge.count, 2, `closed upper-body edge ${key}`);
      assert.equal(edge.orientation, 0, `consistent triangle winding at ${key}`);
    }
    for (const shoulder of shoulders) {
      assert.equal(shoulder.material, chest.material);
      assert.equal(shoulder.geometry.attributes.position, chest.geometry.attributes.position);
      assert.equal(shoulder.geometry.attributes.normal, chest.geometry.attributes.normal);
      assert.ok(Array.from(shoulder.geometry.index.array).some(index => {
        const weight = shoulder.geometry.attributes.skinWeight.getY(index);
        return weight > 0 && weight < 1;
      }));
    }
    for (let frame = 0; frame < 120; frame += 1) {
      body.gait.phase = frame / 120 * Math.PI * 2;
      body.gait.weight = 1;
      animateHumanoid(body, frame / 60, true, 0);
      body.root.updateMatrixWorld(true);
      for (const shoulder of shoulders) {
        const seam = [...new Set(shoulder.geometry.index.array)].filter(index => chestIndices.has(index));
        assert.equal(seam.length, 24);
        for (const index of seam) {
          const chestPoint = chest.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(chest.matrixWorld);
          const shoulderPoint = shoulder.getVertexPosition(index, new THREE.Vector3()).applyMatrix4(shoulder.matrixWorld);
          assert.ok(chestPoint.distanceTo(shoulderPoint) < 1e-6, 'no gap along the shoulder/chest boundary');
        }
      }
    }
  }
});

test('body regions and socket equipment are independent of locomotion and other characters', () => {
  const first = buildHumanoidBody();
  const second = buildHumanoidBody({ name: 'second', color: 0x964957 });
  const original = appearanceSignature(second);
  const armor = new THREE.Group();
  const weapon = new THREE.Group();
  first.leftForearm.add(armor);
  first.bodyParts.leftForearm.visible = false;
  first.sockets.rightHand.add(weapon);
  const localPose = weapon.matrix.clone();
  const handPositions = [];
  for (let frame = 0; frame < 120; frame += 1) {
    animateHumanoid(first, frame / 60, true);
    first.root.updateMatrixWorld(true);
    assert.deepEqual(weapon.matrix.elements, localPose.elements);
    assert.ok(weapon.getWorldPosition(new THREE.Vector3()).distanceTo(first.sockets.rightHand.getWorldPosition(new THREE.Vector3())) < 1e-8);
    handPositions.push(weapon.getWorldPosition(new THREE.Vector3()).z);
  }
  assert.ok(Math.max(...handPositions) - Math.min(...handPositions) > 0.2);
  weapon.removeFromParent();
  armor.removeFromParent();
  first.bodyParts.leftForearm.visible = true;
  for (let frame = 0; frame < 120; frame += 1) animateHumanoid(first, 2 + frame / 60, false);
  assert.equal(first.gait.weight, 0);
  assert.ok(Math.abs(first.leftLeg.rotation.x) < 1e-8);
  assert.equal(appearanceSignature(second), original);
  assert.deepEqual(second.gait, { phase: 0, weight: 0 });
  assert.equal(second.bodyParts.leftForearm.visible, true);
});

function makeRig(painted = false, options = {}) {
  const materials = Object.fromEntries(['steel', 'steelDark', 'gold', 'blue', 'blueDark', 'leather', 'chain', 'visor']
    .map(name => [name, new THREE.MeshStandardMaterial({ name, side: THREE.DoubleSide, vertexColors: painted && name !== 'chain' && name !== 'visor' })]));
  return buildAlden(materials, options);
}

function poseAtPhase(rig, phase) {
  rig.gait.phase = phase;
  rig.gait.weight = 1;
  animateAlden(rig, phase / ALDEN_GAIT_RATE, true, 0);
}

function appearanceSignature(rig) {
  rig.root.updateMatrixWorld(true);
  const records = [];
  const bufferHash = array => createHash('sha256').update(Buffer.from(array.buffer, array.byteOffset, array.byteLength)).digest('hex');
  rig.root.traverse(part => {
    if (!part.isMesh) return;
    records.push(JSON.stringify({
      name: part.name,
      matrix: part.matrixWorld.toArray().map(value => Number(value.toFixed(9))),
      attributes: Object.entries(part.geometry.attributes).sort(([first], [second]) => first.localeCompare(second)).map(([name, attribute]) => [name, bufferHash(attribute.array)]),
      index: part.geometry.index ? bufferHash(part.geometry.index.array) : null,
      material: [part.material.name, part.material.color.toArray(), part.material.roughness, part.material.metalness, part.material.side, part.material.vertexColors],
      shadows: [part.castShadow, part.receiveShadow],
    }));
  });
  return createHash('sha256').update(JSON.stringify(records.sort())).digest('hex');
}

test('Alden with the original waist, arms, pauldrons and cape matches the frozen pre-extraction reference', () => {
  const reference = {};
  const rig = makeRig(true, { armRestAngle: 0.24, shoulderNeckBlend: 0, capeNeckBlend: 0 });
  rig.waistMotionScale = 1;
  reference.rest = appearanceSignature(rig);
  rig.capeMotion = 1;
  rig.root.position.set(3, 0.03, -2);
  for (let frame = 0; frame < 12; frame += 1) {
    rig.model.rotation.y = frame * Math.PI / 6;
    poseAtPhase(rig, frame / 12 * Math.PI * 2);
    reference[`phase-${frame}`] = appearanceSignature(rig);
  }
  for (const speed of [ALDEN_WALK_SPEED, ALDEN_FAST_WALK_SPEED]) {
    const movingRig = makeRig(true, { armRestAngle: 0.24, shoulderNeckBlend: 0, capeNeckBlend: 0 });
    movingRig.waistMotionScale = 1;
    for (let frame = 0; frame < 90; frame += 1) {
      animateAlden(movingRig, frame / 60, frame < 60, 1 / 60, speed);
      if ([0, 5, 30, 59, 60, 65, 89].includes(frame)) reference[`speed-${speed}-frame-${frame}`] = appearanceSignature(movingRig);
    }
  }
  const fixture = new URL('./fixtures/alden-before-shared-rig.json', import.meta.url);
  if (process.env.CAPTURE_ALDEN_REFERENCE === '1') {
    mkdirSync(new URL('./fixtures/', import.meta.url), { recursive: true });
    writeFileSync(fixture, `${JSON.stringify(reference, null, 2)}\n`, { flag: 'wx' });
  }
  assert.deepEqual(reference, JSON.parse(readFileSync(fixture, 'utf8')));
});

test('default waist motion is halved without changing limb curves, cadence or vertical loading', () => {
  for (const build of [makeRig, buildHumanoidBody]) {
    const reduced = build();
    const original = build();
    original.waistMotionScale = 1;
    assert.equal(reduced.waistMotionScale, 0.5);
    assert.equal(appearanceSignature(reduced), appearanceSignature(original));
    for (const speed of [ALDEN_WALK_SPEED, ALDEN_FAST_WALK_SPEED]) {
      for (let frame = 0; frame < 180; frame += 1) {
        for (const rig of [reduced, original]) {
          animateHumanoid(rig, frame / 60, frame < 120, 1 / 60, speed);
          rig.root.updateMatrixWorld(true);
        }
        assert.deepEqual(reduced.gait, original.gait);
        for (const joint of ['leftLeg', 'rightLeg', 'leftShin', 'rightShin', 'leftFoot', 'rightFoot', 'leftArm', 'rightArm', 'leftForearm', 'rightForearm']) {
          assert.deepEqual(reduced[joint].rotation.toArray(), original[joint].rotation.toArray(), joint);
        }
        for (const joint of ['pelvis', 'torso']) {
          for (const axis of ['y', 'z']) assert.equal(reduced[joint].rotation[axis], original[joint].rotation[axis] * 0.5);
        }
        assert.equal(reduced.pelvis.position.x, original.pelvis.position.x * 0.5);
        assert.ok(Math.abs(reduced.torso.getWorldPosition(new THREE.Vector3()).y - original.torso.getWorldPosition(new THREE.Vector3()).y) < 1e-8);
        assert.ok(Math.abs(reduced.torso.position.x - reduced.pelvis.position.x) < 0.041);
      }
    }
  }
});

test('pauldrons extend inward toward the collar without changing the outer armor or animation', () => {
  const blended = makeRig();
  const previous = makeRig(false, { shoulderNeckBlend: 0 });
  for (const side of ['left', 'right']) {
    const surface = blended[`${side}Arm`].getObjectByName('pauldron-shell');
    const original = previous[`${side}Arm`].getObjectByName('pauldron-shell');
    const position = surface.geometry.attributes.position;
    const before = original.geometry.attributes.position;
    for (let vertex = 0; vertex < 11; vertex += 1) {
      assert.ok(Math.abs(before.getX(vertex) - position.getX(vertex) - 0.19) < 1e-6);
    }
    for (let vertex = 44; vertex < position.count; vertex += 1) {
      assert.deepEqual(new THREE.Vector3().fromBufferAttribute(position, vertex), new THREE.Vector3().fromBufferAttribute(before, vertex));
    }
    assert.deepEqual(surface.geometry.index.array, original.geometry.index.array);
  }
  for (let frame = 0; frame < 120; frame += 1) {
    for (const rig of [blended, previous]) {
      poseAtPhase(rig, frame / 120 * Math.PI * 2);
      rig.root.updateMatrixWorld(true);
    }
    for (const side of ['left', 'right']) {
      const arm = blended[`${side}Arm`];
      const shell = arm.getObjectByName('pauldron-shell');
      assert.deepEqual(arm.rotation.toArray(), previous[`${side}Arm`].rotation.toArray());
      for (let vertex = 0; vertex < 11; vertex += 1) {
        const point = new THREE.Vector3().fromBufferAttribute(shell.geometry.attributes.position, vertex).applyMatrix4(shell.matrixWorld);
        blended.torso.worldToLocal(point);
        assert.ok(Math.abs(point.x) > 0.18 && Math.abs(point.x) < 0.30, `inner shoulder reaches the collar: ${point.toArray()}`);
        assert.ok(point.y > 0.38 && point.y < 0.55, 'inner shoulder stays below the helmet');
      }
    }
  }
});

test('the cape neckline remains tucked inside the mantle while its lower drape is preserved', () => {
  const rig = makeRig();
  const previous = makeRig(false, { capeNeckBlend: 0 });
  const cloth = rig.root.getObjectByName('pleated-cape');
  const original = previous.root.getObjectByName('pleated-cape').geometry.attributes.position;
  const positions = cloth.geometry.attributes.position;
  for (let vertex = 5 * 33; vertex < positions.count; vertex += 1) {
    assert.deepEqual(new THREE.Vector3().fromBufferAttribute(positions, vertex), new THREE.Vector3().fromBufferAttribute(original, vertex));
  }
  const mantle = new THREE.Mesh(rig.root.getObjectByName('folded-blue-mantle').geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mantle.updateMatrixWorld(true);
  for (let frame = 0; frame < 240; frame += 1) {
    animateAlden(rig, frame / 60, frame >= 30 && frame < 150);
    rig.root.updateMatrixWorld(true);
    for (let vertex = 0; vertex < 33; vertex += 1) {
      const point = new THREE.Vector3().fromBufferAttribute(positions, vertex).applyMatrix4(cloth.matrixWorld);
      rig.torso.worldToLocal(point);
      const radial = new THREE.Vector3(point.x, 0, point.z).normalize();
      const origin = radial.clone().multiplyScalar(2);
      origin.y = point.y;
      const hit = new THREE.Raycaster(origin, radial.clone().negate()).intersectObject(mantle)[0];
      assert.ok(hit, `neckline stays within mantle height at ${frame}:${vertex}`);
      const overlap = Math.hypot(hit.point.x, hit.point.z) - Math.hypot(point.x, point.z);
      assert.ok(overlap > 0 && overlap < 0.04, `neckline overlap at ${frame}:${vertex}: ${overlap}`);
    }
  }
  mantle.material.dispose();
});

test('painted finish only adds bounded color washes without changing geometry', () => {
  const original = makeRig();
  const painted = makeRig(true);
  const originals = [];
  original.model.traverse(part => { if (part.isMesh) originals.push(part); });
  let index = 0;
  let coloredParts = 0;
  painted.model.traverse(part => {
    if (!part.isMesh) return;
    const before = originals[index++];
    for (const attribute of ['position', 'normal', 'uv']) {
      assert.deepEqual(part.geometry.getAttribute(attribute).array, before.geometry.getAttribute(attribute).array, `${part.name}: ${attribute}`);
    }
    if (part.material.vertexColors) {
      const color = part.geometry.getAttribute('color');
      assert.equal(color.count, part.geometry.getAttribute('position').count);
      assert.ok(Array.from(color.array).every(value => Number.isFinite(value) && value >= 0.8 && value <= 1));
      coloredParts += 1;
    }
  });
  assert.equal(index, originals.length);
  assert.ok(coloredParts > 50);
});

test('hero geometry is finite, indexed correctly, shadowed and within a low-poly budget', () => {
  const rig = makeRig();
  let triangles = 0;
  rig.root.traverse(part => {
    if (!part.isMesh) return;
    assert.ok(part.castShadow && part.receiveShadow, part.name);
    assert.notEqual(part.geometry.type, 'BoxGeometry', part.name);
    assert.notEqual(part.geometry.type, 'SphereGeometry', part.name);
    const position = part.geometry.getAttribute('position');
    for (const name of ['position', 'normal', 'uv']) {
      assert.ok(Array.from(part.geometry.getAttribute(name).array).every(Number.isFinite), `${part.name}: ${name}`);
    }
    if (part.geometry.index) {
      assert.ok(Array.from(part.geometry.index.array).every(index => index < position.count));
    }
    triangles += (part.geometry.index?.count ?? position.count) / 3;
  });
  assert.ok(triangles < 16000, `${triangles} triangles`);
  const bounds = new THREE.Box3().setFromObject(rig.root);
  assert.ok(bounds.min.y >= -0.01, `ground penetration: ${bounds.min.y}`);
  assert.ok(bounds.max.y < 3.4);
});

test('breastplate widens at the chest and has a convex thoracic profile', () => {
  const geometry = createBreastplateGeometry();
  const position = geometry.getAttribute('position');
  const widthAt = height => {
    const horizontal = [];
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      if (Math.abs(position.getY(vertex) - height) < 0.001) horizontal.push(Math.abs(position.getX(vertex)));
    }
    return Math.max(...horizontal);
  };
  assert.ok(widthAt(0.16) > widthAt(-0.43) * 1.5);
  geometry.computeBoundingBox();
  assert.ok(geometry.boundingBox.max.z > 0.30);
});

test('cape has a narrow attachment, flared irregular hem and longitudinal folds', () => {
  assert.ok(capeSurface(1, 1).x > capeSurface(1, 0).x * 2);
  assert.ok(capeSurface(1, 1).y > capeSurface(0, 1).y + 0.05);
  const drape = capeSurface(0, 0).z - capeSurface(0, 1).z;
  assert.ok(drape > 0.22 && drape < 0.32, `cape should fall closer to the body: ${drape}`);
  assert.ok(Math.abs(capeSurface(0, 0.6).z - capeSurface(0.25, 0.6).z) > 0.08);
});

test('sword pivot is inside the right hand and grip, above the guard and blade', () => {
  const rig = makeRig();
  assert.equal(rig.swordWrist.parent, rig.sockets.rightHand);
  assert.equal(rig.swordWrist.name, 'right-wrist-attack-pivot');
  const hand = rig.sword.getObjectByName('closed-glove');
  const grip = rig.sword.getObjectByName('sword-grip');
  assert.equal(hand.parent, rig.sword);
  assert.equal(grip.parent, rig.sword);
  for (const part of [hand, grip]) {
    part.geometry.computeBoundingBox();
    assert.ok(part.geometry.boundingBox.containsPoint(new THREE.Vector3()));
  }
  const blade = rig.sword.getObjectByName('sword-blade');
  blade.geometry.computeBoundingBox();
  assert.ok(blade.geometry.boundingBox.max.y < -0.20);
  assert.ok(rig.sword.getObjectByName('sword-pommel').position.y > 0.20);
});

test('idle sword is horizontal with its cutting edges above and below', () => {
  const rig = makeRig();
  for (let frame = 0; frame < 100; frame += 1) animateAlden(rig, frame / 60, false);
  rig.root.updateMatrixWorld(true);
  const hand = rig.sword.localToWorld(new THREE.Vector3());
  const tip = rig.sword.localToWorld(new THREE.Vector3(0, -1.52, 0));
  const direction = tip.clone().sub(hand).normalize();
  const angle = THREE.MathUtils.radToDeg(Math.asin(direction.y));
  assert.ok(Math.abs(angle) < 0.5, `sword elevation: ${angle}`);
  const edgeAxis = new THREE.Vector3(1, 0, 0).transformDirection(rig.sword.getObjectByName('sword-blade').matrixWorld);
  assert.ok(Math.abs(edgeAxis.y) > 0.999, `cutting edges must face up/down: ${edgeAxis.toArray()}`);
  assert.ok(tip.z > 0.65, `sword should clear the feet in front: ${tip.z}`);
  assert.ok(tip.x > 0.60, `sword should remain outside the leg: ${tip.x}`);
});

test('walk preserves opposite limbs, the grip and clearance through a full cycle', () => {
  const rig = makeRig();
  const gripOrientation = rig.sword.quaternion.clone();
  const handDepths = [];
  const elevations = [];
  for (let frame = 0; frame < 120; frame += 1) {
    poseAtPhase(rig, frame / 120 * Math.PI * 2);
    rig.root.updateMatrixWorld(true);
    assert.ok(Math.abs(rig.leftArm.rotation.x + rig.rightArm.rotation.x - THREE.MathUtils.degToRad(-10)) < 1e-8);
    assert.ok(rig.sword.quaternion.angleTo(gripOrientation) < 1e-7, 'the wrist must not counteract the arm swing');
    const hand = rig.sword.localToWorld(new THREE.Vector3());
    const tip = rig.sword.localToWorld(new THREE.Vector3(0, -1.52, 0));
    handDepths.push(hand.z);
    elevations.push(Math.asin(tip.clone().sub(hand).normalize().y));
    assert.ok(tip.y > 0.08, `sword hits ground at frame ${frame}: ${tip.y}`);
    for (const shin of [rig.leftShin, rig.rightShin]) {
      const boot = new THREE.Box3().setFromObject(shin.getObjectByName('boot-sole'));
      assert.ok(boot.min.y >= -0.025, `boot below floor at frame ${frame}: ${boot.min.y}`);
    }
  }
  assert.ok(Math.max(...handDepths) - Math.min(...handDepths) > 0.18, 'sword hand must swing with the arm');
  assert.ok(Math.max(...elevations) - Math.min(...elevations) > 0.18, 'blade must follow the arm instead of remaining stabilized');
});

test('animation never changes destination position or facing yaw and settles to authored idle', () => {
  const rig = makeRig();
  const gripOrientation = rig.sword.quaternion.clone();
  rig.root.position.set(3, 0.03, -2);
  for (let heading = 0; heading < 8; heading += 1) {
    const yaw = heading * Math.PI / 4;
    rig.model.rotation.y = yaw;
    animateAlden(rig, heading / 8, true);
    assert.equal(rig.model.rotation.y, yaw);
    assert.deepEqual(rig.root.position.toArray(), [3, 0.03, -2]);
  }
  for (let frame = 0; frame < 120; frame += 1) animateAlden(rig, frame / 60, false);
  assert.ok(Math.abs(rig.leftLeg.rotation.x) < THREE.MathUtils.degToRad(0.6));
  assert.ok(Math.abs(rig.rightLeg.rotation.x) < THREE.MathUtils.degToRad(0.6));
  assert.ok(Math.abs(rig.leftShin.rotation.x) < THREE.MathUtils.degToRad(1.6));
  assert.ok(Math.abs(rig.rightShin.rotation.x) < THREE.MathUtils.degToRad(1.6));
  assert.ok(rig.sword.quaternion.angleTo(gripOrientation) < 1e-7);
  const relaxedElbow = THREE.MathUtils.degToRad(-22);
  assert.ok(Math.abs(rig.leftForearm.rotation.x - relaxedElbow) < THREE.MathUtils.degToRad(1));
  assert.ok(Math.abs(rig.rightForearm.rotation.x - relaxedElbow) < THREE.MathUtils.degToRad(1));
});

test('cloth and gold move gently from immutable rest positions without accumulating drift', () => {
  const rig = makeRig();
  rig.capeMotion = 1;
  animateAlden(rig, 0.3, true);
  const first = rig.capePanels.map(panel => Array.from(panel.geometry.getAttribute('position').array));
  animateAlden(rig, 4, true);
  animateAlden(rig, 0.3, true);
  for (const [index, panel] of rig.capePanels.entries()) {
    const current = panel.geometry.getAttribute('position').array;
    assert.deepEqual(Array.from(current), first[index]);
    assert.ok(current.some((value, coordinate) => Math.abs(value - panel.rest[coordinate]) > 0.0001));
    assert.ok(current.every((value, coordinate) => Math.abs(value - panel.rest[coordinate]) < 0.20));
  }
});

test('forearms flex independently and anatomical hands stay separated from the waist', () => {
  const rig = makeRig();
  poseAtPhase(rig, 1.05);
  const before = [rig.leftForearm.rotation.x, rig.rightForearm.rotation.x];
  poseAtPhase(rig, 4.2);
  assert.ok(Math.abs(before[0] - rig.leftForearm.rotation.x) > 0.10);
  assert.ok(Math.abs(before[1] - rig.rightForearm.rotation.x) > 0.10);
  rig.root.updateMatrixWorld(true);
  assert.ok(rig.torso.worldToLocal(rig.leftForearm.getWorldPosition(new THREE.Vector3())).x > 0.54);
  assert.ok(rig.torso.worldToLocal(rig.rightForearm.getWorldPosition(new THREE.Vector3())).x < -0.54);
});

test('arms rest closer to the body without changing their swing or crowding the waist', () => {
  for (const build of [options => makeRig(false, options), buildHumanoidBody]) {
    const closer = build();
    const previous = build({ armRestAngle: 0.24 });
    for (let frame = 0; frame < 180; frame += 1) {
      for (const rig of [closer, previous]) {
        animateHumanoid(rig, frame / 60, frame >= 30 && frame < 120);
        rig.root.updateMatrixWorld(true);
      }
      for (const side of ['left', 'right']) {
        const arm = `${side}Arm`;
        const forearm = `${side}Forearm`;
        assert.equal(Math.abs(closer[arm].rotation.z), 0.18);
        assert.equal(closer[arm].rotation.x, previous[arm].rotation.x);
        assert.deepEqual(closer[forearm].rotation.toArray(), previous[forearm].rotation.toArray());
        const lateralHandPosition = rig => Math.abs(rig.torso.worldToLocal(rig.sockets[`${side}Hand`].getWorldPosition(new THREE.Vector3())).x);
        const hand = lateralHandPosition(closer);
        const shift = lateralHandPosition(previous) - hand;
        assert.ok(shift > 0.035 && shift < 0.06, `small inward hand shift: ${shift}`);
        assert.ok(hand > 0.58, `hand remains outside the waist: ${hand}`);
      }
      assert.deepEqual(closer.gait, previous.gait);
      assert.deepEqual(closer.leftLeg.rotation.toArray(), previous.leftLeg.rotation.toArray());
      assert.deepEqual(closer.rightLeg.rotation.toArray(), previous.rightLeg.rotation.toArray());
    }
  }
});

test('human gait uses contact, loading, dorsiflexion, push-off and recovery angles', () => {
  const rig = makeRig();
  const checkpoints = [[0, 28, 4, 0], [0.1, 24, 18, 5], [0.3, 5, 5, -10], [0.5, -12, 58, 0], [0.6, -5, 60, 18], [0.7, 30, 60, -20]];
  for (const [cycle, hip, knee, ankle] of checkpoints) {
    poseAtPhase(rig, cycle * Math.PI * 2);
    if (hip !== null) assert.ok(Math.abs(THREE.MathUtils.radToDeg(-rig.rightLeg.rotation.x) - hip) < 0.01);
    assert.ok(Math.abs(THREE.MathUtils.radToDeg(rig.rightShin.rotation.x) - knee) < 0.01);
    if (ankle !== null) assert.ok(Math.abs(THREE.MathUtils.radToDeg(rig.rightFoot.rotation.x) - ankle) < 0.01);
  }
});

test('recovery flexion stays at 60 degrees with the other sole supporting the body', () => {
  const rig = makeRig();
  for (const cycle of [0.2, 0.7]) {
    poseAtPhase(rig, cycle * Math.PI * 2);
    rig.root.updateMatrixWorld(true);
    const recovery = cycle < 0.5 ? rig.leftShin : rig.rightShin;
    const support = cycle < 0.5 ? rig.rightShin : rig.leftShin;
    assert.ok(Math.abs(THREE.MathUtils.radToDeg(recovery.rotation.x) - 60) < 0.01);
    const soleHeight = shin => {
      const { foot, points } = rig.soleSamples.find(sample => sample.foot.parent === shin);
      return Math.min(...points.map(point => point.clone().applyMatrix4(foot.matrixWorld).y));
    };
    assert.ok(soleHeight(recovery) > 0.04, `recovery foot clearance: ${soleHeight(recovery)}`);
    assert.ok(Math.abs(soleHeight(support) - 0.015) < 0.001, `support foot height: ${soleHeight(support)}`);
  }
});

test('the forward foot reaches the floor at contact and stays planted while loading', () => {
  const rig = makeRig();
  for (const cycle of [0, 0.1, 0.3, 0.5, 0.6, 0.8]) {
    poseAtPhase(rig, cycle * Math.PI * 2);
    rig.root.updateMatrixWorld(true);
    const { foot, points } = rig.soleSamples[cycle < 0.5 ? 1 : 0];
    const height = Math.min(...points.map(point => point.clone().applyMatrix4(foot.matrixWorld).y));
    assert.ok(Math.abs(height - 0.015) < 0.005, `contact foot at ${cycle}: ${height}`);
  }
});

test('joint ranges are bounded, pelvis counters the thorax, and the head remains forward', () => {
  const rig = makeRig();
  const degrees = THREE.MathUtils.radToDeg;
  for (let frame = 0; frame < 200; frame += 1) {
    poseAtPhase(rig, frame / 200 * Math.PI * 2);
    for (const [hip, knee, ankle, shoulder] of [[rig.leftLeg, rig.leftShin, rig.leftFoot, rig.leftArm], [rig.rightLeg, rig.rightShin, rig.rightFoot, rig.rightArm]]) {
      assert.ok(degrees(-hip.rotation.x) >= -12.001 && degrees(-hip.rotation.x) <= 30.001);
      assert.ok(degrees(knee.rotation.x) >= 3.999 && degrees(knee.rotation.x) <= 60.001);
      assert.ok(degrees(ankle.rotation.x) >= -20.001 && degrees(ankle.rotation.x) <= 18.001);
      assert.ok(degrees(shoulder.rotation.x) >= -20.001 && degrees(shoulder.rotation.x) <= 10.001);
      assert.equal(hip.rotation.y, 0);
      assert.equal(hip.rotation.z, 0);
    }
    assert.ok(Math.abs(degrees(rig.pelvis.rotation.y)) <= 2.001);
    assert.ok(Math.abs(degrees(rig.pelvis.rotation.z)) <= 2.501);
    assert.ok(Math.abs(rig.pelvis.rotation.y + rig.torso.rotation.y) < 1e-8);
    assert.ok(Math.abs(degrees(rig.torso.rotation.z)) <= 1.501);
    assert.ok(rig.pelvis.rotation.z * rig.torso.rotation.z <= 0, 'chest roll must oppose pelvic roll');
    rig.model.rotation.y = 1.1;
    rig.root.updateMatrixWorld(true);
    const head = rig.head.getWorldQuaternion(new THREE.Quaternion());
    const facing = rig.model.getWorldQuaternion(new THREE.Quaternion());
    assert.ok(head.angleTo(facing) < 1e-6);
  }
  for (const cycle of [0.25, 0.75]) {
    poseAtPhase(rig, cycle * Math.PI * 2);
    rig.root.updateMatrixWorld(true);
    const leftHipHeight = rig.leftLeg.getWorldPosition(new THREE.Vector3()).y;
    const rightHipHeight = rig.rightLeg.getWorldPosition(new THREE.Vector3()).y;
    assert.ok(cycle < 0.5 ? leftHipHeight < rightHipHeight : rightHipHeight < leftHipHeight, 'the pelvis must drop on the airborne side');
    const shoulderHeightDifference = rig.leftArm.getWorldPosition(new THREE.Vector3()).y - rig.rightArm.getWorldPosition(new THREE.Vector3()).y;
    assert.ok((leftHipHeight - rightHipHeight) * shoulderHeightDifference < -0.00025, 'shoulder and hip lines must slope subtly in opposite directions');
  }
  for (const cycle of [0, 0.5]) {
    poseAtPhase(rig, cycle * Math.PI * 2);
    rig.root.updateMatrixWorld(true);
    const depth = joint => rig.model.worldToLocal(joint.getWorldPosition(new THREE.Vector3())).z;
    assert.ok((depth(rig.leftLeg) - depth(rig.rightLeg)) * (depth(rig.leftArm) - depth(rig.rightArm)) < -0.00025, 'the opposite shoulder must advance with the forward hip');
  }
});

test('normal walking stays at 2.4 and fast walking at 3.8 is the default', () => {
  assert.equal(ALDEN_WALK_SPEED, 2.4);
  assert.equal(ALDEN_FAST_WALK_SPEED, 3.8);
  assert.equal(ALDEN_DEFAULT_MOVE_SPEED, ALDEN_FAST_WALK_SPEED);
  for (const speed of [ALDEN_WALK_SPEED, ALDEN_FAST_WALK_SPEED]) {
    const rig = makeRig();
    rig.gait.weight = 1;
    for (let frame = 1; frame <= 15; frame += 1) animateAlden(rig, frame / 60, true, 1 / 60, speed);
    const expectedPhase = Math.PI * speed / 1.2 * 0.25;
    assert.ok(Math.abs(rig.gait.phase - expectedPhase) < 1e-8, `cadence must match speed ${speed}`);
    if (speed === ALDEN_WALK_SPEED) assert.ok(Math.abs(rig.gait.phase - Math.PI / 2) < 1e-8, 'normal walking must keep its original cadence');
  }
  const rig = makeRig();
  rig.gait.weight = 1;
  for (let frame = 1; frame <= 15; frame += 1) animateAlden(rig, frame / 60, true, 1 / 60);
  assert.ok(Math.abs(rig.gait.phase - ALDEN_GAIT_RATE * 0.25) < 1e-8, 'default animation must use fast walking');
  assert.ok(Math.abs(ALDEN_DEFAULT_MOVE_SPEED * Math.PI / ALDEN_GAIT_RATE - 1.2) < 1e-8, 'cadence must track the configured step length');
});

test('the pelvis loads the support side while the chest counterbalances and the head stays centered', () => {
  const rig = makeRig();
  for (const cycle of [0.2, 0.3, 0.7, 0.8]) {
    poseAtPhase(rig, cycle * Math.PI * 2);
    rig.root.updateMatrixWorld(true);
    const foot = cycle < 0.5 ? rig.rightFoot : rig.leftFoot;
    const footPosition = rig.model.worldToLocal(foot.getWorldPosition(new THREE.Vector3()));
    const pelvisDistance = Math.abs(rig.pelvis.position.x - footPosition.x);
    assert.ok(pelvisDistance < Math.abs(footPosition.x) - 0.0125, 'the pelvis must shift subtly toward the supporting foot');
    assert.ok(rig.torso.position.x * rig.pelvis.position.x < 0, 'the chest must counterbalance instead of shifting as a rigid block');
    assert.ok(Math.abs(rig.torso.position.x - rig.pelvis.position.x) < 0.041, 'the waist must stay connected with restrained lateral movement');
  }
  for (const cycle of [0.1, 0.6]) {
    poseAtPhase(rig, cycle * Math.PI * 2);
    rig.root.updateMatrixWorld(true);
    const loadedHeight = rig.torso.getWorldPosition(new THREE.Vector3()).y;
    poseAtPhase(rig, (cycle + 0.2) * Math.PI * 2);
    rig.root.updateMatrixWorld(true);
    const supportedHeight = rig.torso.getWorldPosition(new THREE.Vector3()).y;
    assert.ok(supportedHeight - loadedHeight > 0.03, 'the body must absorb weight then rise with the supporting leg');
  }
  for (let frame = 0; frame < 180; frame += 1) animateAlden(rig, frame / 60, false);
  assert.equal(Math.abs(rig.torso.position.x), 0);
  assert.equal(Math.abs(rig.pelvis.position.x), 0);
  for (let frame = 0; frame < 120; frame += 1) {
    rig.model.rotation.y = frame / 120 * Math.PI * 2;
    poseAtPhase(rig, frame / 120 * Math.PI * 2);
    rig.root.updateMatrixWorld(true);
    const headPosition = rig.model.worldToLocal(rig.head.getWorldPosition(new THREE.Vector3()));
    assert.ok(Math.abs(headPosition.x) < 1e-6, 'head center must not sway with pelvic loading');
  }
});

test('the torso and head show bounded weight-bearing motion without contact bumps', () => {
  const rig = makeRig();
  const torsoHeights = [];
  const headHeights = [];
  for (let frame = 0; frame < 240; frame += 1) {
    poseAtPhase(rig, frame / 240 * Math.PI * 2);
    rig.root.updateMatrixWorld(true);
    torsoHeights.push(rig.torso.getWorldPosition(new THREE.Vector3()).y);
    headHeights.push(rig.head.getWorldPosition(new THREE.Vector3()).y);
  }
  for (const heights of [torsoHeights, headHeights]) {
    const travel = Math.max(...heights) - Math.min(...heights);
    assert.ok(travel > 0.035 && travel < 0.045, `body motion must show loading without excessive bounce: ${travel}`);
  }
  let previousHeight = null;
  for (let frame = 0; frame < 240; frame += 1) {
    animateAlden(rig, frame / 60, frame >= 60 && frame < 180, 1 / 60);
    rig.root.updateMatrixWorld(true);
    const height = rig.torso.getWorldPosition(new THREE.Vector3()).y;
    if (previousHeight !== null) assert.ok(Math.abs(height - previousHeight) < 0.008, `body height jumps at frame ${frame}`);
    previousHeight = height;
  }
});

test('gait and follow-through are independent of frame rate through start and stop', () => {
  for (const speed of [ALDEN_WALK_SPEED, ALDEN_FAST_WALK_SPEED]) {
    const snapshots = [30, 60, 120].map(rate => {
      const rig = makeRig();
      for (let frame = 1; frame <= rate; frame += 1) animateAlden(rig, frame / rate, true, 1 / rate, speed);
      for (let frame = 1; frame <= rate / 5; frame += 1) animateAlden(rig, 1 + frame / rate, false, 1 / rate, speed);
      return [rig.gait.phase, rig.gait.weight, rig.leftLeg.rotation.x, rig.leftShin.rotation.x, rig.rightForearm.rotation.x, rig.capeMotion, rig.torso.position.y, rig.model.position.y, rig.torso.position.x, rig.pelvis.position.x];
    });
    for (const snapshot of snapshots.slice(1)) {
      snapshot.forEach((value, index) => assert.ok(Math.abs(value - snapshots[0][index]) < 1e-6));
    }
  }
});

test('starting and stopping blend continuously instead of snapping the joints', () => {
  const rig = makeRig();
  let previous = [0, 0, 0, -0.35];
  for (let frame = 0; frame < 180; frame += 1) {
    animateAlden(rig, frame / 60, frame < 60, 1 / 60);
    const current = [rig.leftLeg.rotation.x, rig.leftShin.rotation.x, rig.leftArm.rotation.x, rig.leftForearm.rotation.x];
    current.forEach((value, index) => assert.ok(Math.abs(value - previous[index]) < 0.25, `joint jump at frame ${frame}: ${value - previous[index]}`));
    previous = current;
  }
  assert.equal(rig.gait.weight, 0);
});

test('cape waves travel visibly and settle gradually after stopping', () => {
  const rig = makeRig();
  for (let frame = 0; frame < 60; frame += 1) animateAlden(rig, frame / 60, true);
  const panel = rig.capePanels[0];
  const first = Array.from(panel.geometry.getAttribute('position').array);
  animateAlden(rig, 1.25, true);
  const difference = Math.max(...first.map((value, index) => Math.abs(value - panel.geometry.getAttribute('position').array[index])));
  assert.ok(difference > 0.10, `wave amplitude: ${difference}`);
  animateAlden(rig, 1.26, false);
  assert.ok(rig.capeMotion > 0.80);
  for (let frame = 0; frame < 120; frame += 1) animateAlden(rig, 1.27 + frame / 60, false);
  assert.ok(rig.capeMotion < 0.001);
});

test('the blue chest panel stays outside the metal thorax throughout its surface', () => {
  const chest = new THREE.Mesh(createBreastplateGeometry(), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  chest.updateMatrixWorld(true);
  for (let row = 0; row <= 12; row += 1) {
    for (let column = 0; column <= 12; column += 1) {
      const point = breastclothSurface(column / 6 - 1, row / 12);
      const ray = new THREE.Raycaster(new THREE.Vector3(point.x, point.y, 1), new THREE.Vector3(0, 0, -1));
      const hit = ray.intersectObject(chest)[0];
      assert.ok(hit && point.z > hit.point.z + 0.01, `panel intersects at ${row}, ${column}`);
    }
  }
});