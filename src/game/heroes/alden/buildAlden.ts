import * as THREE from 'three';
import type { AldenMaterials, AldenRig } from './types';

export function buildAlden(materials: AldenMaterials): AldenRig {
  const root = new THREE.Group();
  const model = new THREE.Group();
  root.add(model);

  const selection = new THREE.Mesh(
    new THREE.RingGeometry(0.62, 0.72, 64),
    new THREE.MeshBasicMaterial({
      color: 0x63f0c2,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
    }),
  );
  selection.rotation.x = -Math.PI / 2;
  selection.position.y = 0.025;
  root.add(selection);

  const label = buildHeroLabel();
  label.position.set(0, 3.22, 0);
  root.add(label);

  const leftLeg = buildLeg(materials, -0.20);
  const rightLeg = buildLeg(materials, 0.20);
  model.add(leftLeg, rightLeg);

  const hips = new THREE.Mesh(
    new THREE.CylinderGeometry(0.31, 0.37, 0.34, 14),
    materials.chain,
  );
  hips.position.y = 1.08;
  model.add(hips);

  const torso = new THREE.Group();
  torso.position.y = 1.69;
  model.add(torso);

  const breastplateProfile = [
    new THREE.Vector2(0.20, -0.49),
    new THREE.Vector2(0.28, -0.34),
    new THREE.Vector2(0.35, -0.10),
    new THREE.Vector2(0.43, 0.17),
    new THREE.Vector2(0.40, 0.40),
  ];
  const chest = new THREE.Mesh(
    new THREE.LatheGeometry(breastplateProfile, 24),
    materials.steelDark,
  );
  chest.scale.z = 0.66;
  chest.castShadow = true;
  torso.add(chest);

  const tabardShape = new THREE.Shape();
  tabardShape.moveTo(-0.27, 0.31);
  tabardShape.quadraticCurveTo(-0.28, 0.10, -0.20, -0.43);
  tabardShape.lineTo(0.20, -0.43);
  tabardShape.quadraticCurveTo(0.28, 0.10, 0.27, 0.31);
  tabardShape.closePath();

  const tabard = new THREE.Mesh(
    new THREE.ExtrudeGeometry(tabardShape, {
      depth: 0.03,
      bevelEnabled: true,
      bevelSize: 0.012,
      bevelThickness: 0.01,
      bevelSegments: 2,
    }),
    materials.blue,
  );
  tabard.position.set(0, -0.01, 0.305);
  tabard.castShadow = true;
  torso.add(tabard);

  const leftTrim = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.71, 0.035),
    materials.gold,
  );
  leftTrim.position.set(-0.225, -0.04, 0.34);
  leftTrim.rotation.z = -0.07;

  const rightTrim = leftTrim.clone();
  rightTrim.position.x = 0.225;
  rightTrim.rotation.z = 0.07;
  torso.add(leftTrim, rightTrim);

  const emblemShape = new THREE.Shape();
  emblemShape.moveTo(0, 0.17);
  emblemShape.lineTo(0.055, 0.055);
  emblemShape.lineTo(0.022, 0.01);
  emblemShape.lineTo(0, -0.17);
  emblemShape.lineTo(-0.022, 0.01);
  emblemShape.lineTo(-0.055, 0.055);
  emblemShape.closePath();

  const chestEmblem = new THREE.Mesh(
    new THREE.ShapeGeometry(emblemShape),
    materials.gold,
  );
  chestEmblem.position.set(0, 0.02, 0.35);
  torso.add(chestEmblem);

  const collar = new THREE.Mesh(
    new THREE.TorusGeometry(0.28, 0.03, 8, 28, Math.PI),
    materials.gold,
  );
  collar.rotation.set(Math.PI / 2, 0, Math.PI);
  collar.position.set(0, 0.34, 0.10);
  collar.scale.z = 0.68;
  torso.add(collar);

  const waistBelt = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.34, 0.13, 20),
    materials.leather,
  );
  waistBelt.scale.z = 0.68;
  waistBelt.position.y = -0.47;
  torso.add(waistBelt);

  const buckle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 0.05, 20),
    materials.gold,
  );
  buckle.rotation.x = Math.PI / 2;
  buckle.position.set(0, -0.47, 0.27);
  torso.add(buckle);

  addShoulder(torso, materials, -0.47);
  addShoulder(torso, materials, 0.47);

  const leftArm = buildArm(materials, -0.49, false);
  const rightArm = buildArm(materials, 0.49, true);
  torso.add(leftArm, rightArm);

  const cape = buildCape(materials);
  torso.add(cape);

  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.17, 0.18, 12),
    materials.chain,
  );
  neck.position.y = 0.56;
  torso.add(neck);

  const head = buildHelmet(materials);
  head.position.y = 0.92;
  torso.add(head);

  const sword = buildSword(materials);
  sword.position.set(0.03, -1.00, 0.01);
  sword.rotation.set(0.04, 0.10, -0.58);
  rightArm.add(sword);

  model.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  return { root, model, leftLeg, rightLeg, leftArm, rightArm, cape, sword };
}

function buildLeg(materials: AldenMaterials, x: number) {
  const pivot = new THREE.Group();
  pivot.position.set(x, 1.05, 0);

  const thigh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.155, 0.56, 12),
    materials.chain,
  );
  thigh.position.y = -0.27;
  pivot.add(thigh);

  const knee = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 14, 10),
    materials.steel,
  );
  knee.scale.set(1.0, 0.82, 1.08);
  knee.position.y = -0.57;
  pivot.add(knee);

  const shin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.16, 0.56, 12),
    materials.steel,
  );
  shin.position.y = -0.86;
  pivot.add(shin);

  const goldBand = new THREE.Mesh(
    new THREE.TorusGeometry(0.145, 0.022, 8, 18),
    materials.gold,
  );
  goldBand.rotation.x = Math.PI / 2;
  goldBand.position.y = -0.69;
  pivot.add(goldBand);

  const boot = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.20, 0.44),
    materials.leather,
  );
  boot.position.set(0, -1.16, 0.11);
  boot.geometry.translate(0, 0, 0.06);
  pivot.add(boot);

  const toe = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 14, 10),
    materials.leather,
  );
  toe.scale.set(1.1, 0.72, 1.55);
  toe.position.set(0, -1.15, 0.26);
  pivot.add(toe);

  return pivot;
}

function buildArm(materials: AldenMaterials, x: number, swordArm: boolean) {
  const pivot = new THREE.Group();
  pivot.position.set(x, 0.28, 0);

  const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.145, 0.51, 12), materials.chain);
  upper.position.y = -0.25;
  pivot.add(upper);

  const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 8), materials.steel);
  elbow.position.y = -0.52;
  pivot.add(elbow);

  const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.14, 0.47, 12), materials.steel);
  forearm.position.y = -0.75;
  pivot.add(forearm);

  const glove = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), materials.leather);
  glove.scale.set(0.92, 0.9, 1.08);
  glove.position.y = -1.02;
  pivot.add(glove);

  pivot.rotation.z = x < 0 ? 0.08 : -0.08;
  if (swordArm) pivot.rotation.x = -0.08;
  return pivot;
}

function addShoulder(torso: THREE.Group, materials: AldenMaterials, x: number) {
  const pauldron = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 18, 12),
    materials.steel,
  );
  pauldron.scale.set(1.24, 0.58, 0.96);
  pauldron.position.set(x, 0.25, 0.0);
  torso.add(pauldron);

  const trim = new THREE.Mesh(
    new THREE.TorusGeometry(0.185, 0.028, 8, 20, Math.PI),
    materials.gold,
  );
  trim.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  trim.position.set(x, 0.26, 0.015);
  torso.add(trim);
}

function buildHelmet(materials: AldenMaterials) {
  const group = new THREE.Group();

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 16), materials.steel);
  helmet.scale.set(0.92, 1.12, 0.93);
  group.add(helmet);

  const facePlateShape = new THREE.Shape();
  facePlateShape.moveTo(-0.23, 0.15);
  facePlateShape.lineTo(0.23, 0.15);
  facePlateShape.lineTo(0.20, -0.15);
  facePlateShape.lineTo(0, -0.24);
  facePlateShape.lineTo(-0.20, -0.15);
  facePlateShape.closePath();
  const facePlate = new THREE.Mesh(
    new THREE.ExtrudeGeometry(facePlateShape, { depth: 0.065, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.01, bevelSegments: 2 }),
    materials.steel,
  );
  facePlate.position.set(0, -0.04, 0.285);
  group.add(facePlate);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.045, 0.025), materials.visor);
  visor.position.set(0, 0.02, 0.36);
  group.add(visor);

  const visorVertical = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.25, 0.026), materials.visor);
  visorVertical.position.set(0, -0.09, 0.362);
  group.add(visorVertical);

  const crest = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.58, 4), materials.gold);
  crest.position.y = 0.48;
  crest.scale.z = 0.55;
  group.add(crest);

  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.055, 0.06), materials.gold);
  brow.position.set(0, 0.11, 0.34);
  group.add(brow);
  return group;
}

function buildCape(materials: AldenMaterials) {
  const group = new THREE.Group();
  group.position.set(0, 0.18, -0.31);
  group.rotation.x = 0.10;

  const width = 1.34;
  const height = 1.92;
  const geometry = new THREE.PlaneGeometry(width, height, 12, 14);
  const pos = geometry.attributes.position as THREE.BufferAttribute;

  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const t = (y + height / 2) / height;
    const n = x / (width / 2);
    const widthFactor = 0.74 + (1 - t) * 0.38;
    const shapedX = x * widthFactor;
    const topPinch = t * 0.12;
    const sideCurve = Math.pow(Math.abs(n), 1.7) * (1 - t) * 0.15;
    const bottomDip = (1 - t) * 0.08;
    const hemWave = Math.cos(n * Math.PI * 2.4) * (1 - t) * 0.03;
    const shapedY = y + sideCurve - bottomDip + hemWave + topPinch;
    const drape = -(1 - t) * 0.24 - Math.abs(n) * 0.05;
    const fold = Math.sin(n * Math.PI * 3.0) * 0.04 * (1 - t * 0.25);
    pos.setXYZ(i, shapedX, shapedY, drape + fold);
  }

  geometry.computeVertexNormals();

  const capeMat = new THREE.MeshStandardMaterial({
    map: materials.blue.map,
    color: 0xffffff,
    roughness: 0.92,
    side: THREE.DoubleSide,
  });

  const capeMesh = new THREE.Mesh(geometry, capeMat);
  capeMesh.position.y = -0.60;
  group.add(capeMesh);

  const edgeLeft = new THREE.Mesh(
    new THREE.BoxGeometry(0.035, 1.58, 0.02),
    materials.gold,
  );
  edgeLeft.position.set(-0.47, -0.58, -0.01);
  edgeLeft.rotation.z = -0.10;

  const edgeRight = edgeLeft.clone();
  edgeRight.position.x = 0.47;
  edgeRight.rotation.z = 0.10;
  group.add(edgeLeft, edgeRight);

  const hem = new THREE.Mesh(
    new THREE.TorusGeometry(0.48, 0.018, 6, 30, Math.PI),
    materials.gold,
  );
  hem.rotation.set(Math.PI / 2, 0, Math.PI);
  hem.position.set(0, -1.53, -0.18);
  hem.scale.set(1.12, 1, 0.72);
  group.add(hem);

  const emblemShape = new THREE.Shape();
  emblemShape.moveTo(0, 0.26);
  emblemShape.lineTo(0.10, 0.05);
  emblemShape.lineTo(0.04, -0.02);
  emblemShape.lineTo(0, -0.22);
  emblemShape.lineTo(-0.04, -0.02);
  emblemShape.lineTo(-0.10, 0.05);
  emblemShape.closePath();

  const emblem = new THREE.Mesh(
    new THREE.ShapeGeometry(emblemShape),
    materials.gold,
  );
  emblem.position.set(0, -0.62, 0.02);
  emblem.rotation.y = Math.PI;
  emblem.scale.setScalar(1.24);
  group.add(emblem);

  return group;
}

function buildSword(materials: AldenMaterials) {
  const sword = new THREE.Group();

  const grip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.05, 0.34, 12),
    materials.leather,
  );
  grip.position.y = 0;
  sword.add(grip);

  const pommel = new THREE.Mesh(new THREE.OctahedronGeometry(0.09, 0), materials.gold);
  pommel.position.y = 0.22;
  sword.add(pommel);

  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.07, 0.09), materials.gold);
  guard.position.y = -0.17;
  sword.add(guard);

  const ricasso = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.14, 0.05), materials.steel);
  ricasso.position.y = -0.29;
  sword.add(ricasso);

  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.05, 0.045), materials.steel);
  blade.position.y = -0.86;
  sword.add(blade);

  const fuller = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.76, 0.006), materials.steelDark);
  fuller.position.set(0, -0.86, 0.021);
  sword.add(fuller);

  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.22, 4), materials.steel);
  tip.position.y = -1.49;
  tip.rotation.y = Math.PI / 4;
  sword.add(tip);

  return sword;
}

function buildHeroLabel() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 34px Arial';
  ctx.textAlign = 'center';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(10,14,12,0.9)';
  ctx.strokeText('Alden', 256, 39);
  ctx.fillStyle = '#f5f1e7';
  ctx.fillText('Alden', 256, 39);

  ctx.fillStyle = 'rgba(8,15,13,0.96)';
  ctx.fillRect(90, 57, 332, 38);
  ctx.fillStyle = '#49ce61';
  ctx.fillRect(98, 65, 316, 22);
  ctx.strokeStyle = '#0a0f0d';
  ctx.lineWidth = 5;
  ctx.strokeRect(90, 57, 332, 38);

  ctx.fillStyle = '#0d1519';
  ctx.fillRect(42, 56, 40, 40);
  ctx.strokeStyle = '#70818c';
  ctx.lineWidth = 3;
  ctx.strokeRect(42, 56, 40, 40);
  ctx.font = 'bold 24px Arial';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('1', 62, 84);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(3.3, 0.82, 1);
  sprite.renderOrder = 10;
  return sprite;
}
