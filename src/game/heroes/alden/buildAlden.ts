import * as THREE from 'three';
import { applyPaintedFinish } from './materials.js';
import {
  breastclothSurface, createCapeSurface, createBootGeometry, createBreastplateGeometry,
  createCapeGeometry, createEmblemGeometry, createGreaveGeometry, createLoftGeometry,
  createPauldronGeometry, createPlateGeometry, createProjectedShapeGeometry, createSurfaceGeometry, createSurfaceRibbon,
  createSwordGeometry, createPauldronSurface, mantleSections,
} from './geometry.js';
import type { Surface } from './geometry.js';
import { createHumanoidRig, type HumanoidRig } from '../../characters/humanoidRig.js';

export type AldenMaterials = Record<
  'steel' | 'steelDark' | 'gold' | 'blue' | 'blueDark' | 'leather' | 'chain' | 'visor',
  THREE.MeshStandardMaterial
>;

export type AldenRig = HumanoidRig & {
  cape: THREE.Group;
  capeMotion: number;
  capePanels: Array<{ geometry: THREE.BufferGeometry; rest: Float32Array }>;
  swordWrist: THREE.Group;
  sword: THREE.Group;
};

function mesh(parent: THREE.Object3D, name: string, geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0) {
  const part = new THREE.Mesh(geometry, material);
  part.name = name;
  part.position.set(x, y, z);
  part.castShadow = true;
  part.receiveShadow = true;
  parent.add(part);
  return part;
}

function group(parent: THREE.Object3D, name: string, x = 0, y = 0, z = 0) {
  const pivot = new THREE.Group();
  pivot.name = name;
  pivot.position.set(x, y, z);
  parent.add(pivot);
  return pivot;
}

function piping(parent: THREE.Object3D, name: string, points: THREE.Vector3[], material: THREE.Material, radius = 0.012) {
  const curve = new THREE.CatmullRomCurve3(points);
  return mesh(parent, name, new THREE.TubeGeometry(curve, Math.max(8, points.length * 3), radius, 4, false), material);
}

function ribbon(parent: THREE.Object3D, name: string, surface: Surface, start: [number, number], end: [number, number], width: number, offset: number, material: THREE.Material) {
  return mesh(parent, name, createSurfaceRibbon(surface, new THREE.Vector2(...start), new THREE.Vector2(...end), width, offset), material);
}

export function buildAlden(materials: AldenMaterials, options: { armRestAngle?: number; shoulderNeckBlend?: number; capeNeckBlend?: number } = {}): AldenRig {
  const shoulderNeckBlend = options.shoulderNeckBlend ?? 1;
  const rig = createHumanoidRig({ ...options, name: 'H001' });
  const { model, pelvis, torso, head } = rig;
  buildLeg(rig.leftLeg, rig.leftShin, rig.leftFoot, materials);
  buildLeg(rig.rightLeg, rig.rightShin, rig.rightFoot, materials);

  mesh(pelvis, 'mail-skirt', createLoftGeometry([
    { y: 0.96, width: 0.36, front: 0.22, back: 0.20 },
    { y: 1.16, width: 0.34, front: 0.23, back: 0.22 },
    { y: 1.40, width: 0.28, front: 0.19, back: 0.18 },
  ]), materials.chain, 0, -1.18);

  mesh(torso, 'breastplate', createBreastplateGeometry(), materials.steel);
  mesh(torso, 'breastcloth', createSurfaceGeometry(breastclothSurface, 12, 12, true), materials.blue);
  for (const side of [-1, 1]) {
    ribbon(torso, 'tabard-gold-selvedge', breastclothSurface, [side * 0.94, 0], [side * 0.94, 1], 0.12, 0.008, materials.gold);
  }
  ribbon(torso, 'tabard-neckline', breastclothSurface, [-1, 0.015], [1, 0.015], 0.025, 0.009, materials.gold);
  mesh(torso, 'chest-star', createEmblemGeometry(breastclothSurface, 0.64, 0.22, 0.54, 0.018), materials.gold);

  for (const [index, height] of [-0.36, -0.45].entries()) {
    mesh(torso, 'articulated-fauld', createLoftGeometry([
      { y: height - 0.07, width: 0.32 + index * 0.02, front: 0.235, back: 0.21 },
      { y: height + 0.035, width: 0.295 + index * 0.02, front: 0.223, back: 0.20 },
    ]), materials.steelDark);
  }
  mesh(torso, 'waist-belt', createLoftGeometry([
    { y: -0.52, width: 0.33, front: 0.262, back: 0.224 },
    { y: -0.40, width: 0.32, front: 0.258, back: 0.22 },
  ]), materials.leather);
  const buckle = mesh(torso, 'belt-buckle', new THREE.CylinderGeometry(0.108, 0.108, 0.043, 12), materials.gold, 0, -0.46, 0.282);
  buckle.rotation.x = Math.PI / 2;
  const inset = mesh(torso, 'buckle-inset', new THREE.TorusGeometry(0.078, 0.008, 4, 16), materials.steelDark, 0, -0.46, 0.309);
  inset.scale.y = 1.05;
  for (const side of [-1, 1]) {
    const tailSurface: Surface = (across, down) => new THREE.Vector3(
      side * (0.145 + down * 0.025) + across * (0.125 + down * 0.025),
      -0.53 - down * 0.54 + Math.abs(across) * down * 0.07,
      0.265 + 0.06 * down + Math.cos(across * Math.PI) * 0.015,
    );
    mesh(torso, 'split-tabard', createSurfaceGeometry(tailSurface, 8, 8, true), materials.blue);
    ribbon(torso, 'tabard-tail-trim', tailSurface, [side * 0.92, 0], [side * 0.92, 0.98], 0.14, 0.006, materials.gold);
    ribbon(torso, 'tabard-tail-hem', tailSurface, [-1, 0.97], [1, 0.97], 0.065, 0.006, materials.gold);
    const tasset = mesh(torso, 'hip-tasset', createPlateGeometry([
      [-0.10, 0], [0.11, 0.015], [0.155, -0.33], [-0.08, -0.30],
    ]), materials.steel, side * 0.32, -0.55, 0.095);
    tasset.rotation.y = side * 0.62;
    tasset.rotation.z = side * 0.16;
  }

  mesh(torso, 'gorget', createLoftGeometry([
    { y: 0.34, width: 0.28, front: 0.20, back: 0.21 },
    { y: 0.46, width: 0.205, front: 0.16, back: 0.16 },
    { y: 0.56, width: 0.16, front: 0.14, back: 0.14 },
  ]), materials.steelDark);
  mesh(torso, 'folded-blue-mantle', createLoftGeometry(mantleSections), materials.blueDark);
  piping(torso, 'mantle-fold', [new THREE.Vector3(-0.30, 0.40, 0.15), new THREE.Vector3(0, 0.335, 0.235), new THREE.Vector3(0.29, 0.43, 0.15)], materials.blue, 0.028);
  const clasp = mesh(torso, 'cape-clasp', new THREE.CylinderGeometry(0.087, 0.087, 0.043, 12), materials.gold, -0.30, 0.37, 0.19);
  clasp.rotation.x = Math.PI / 2;
  mesh(torso, 'clasp-ring', new THREE.TorusGeometry(0.064, 0.009, 4, 12), materials.gold, -0.30, 0.37, 0.218);

  buildArm(rig.leftArm, rig.leftForearm, materials, -1, shoulderNeckBlend);
  buildArm(rig.rightArm, rig.rightForearm, materials, 1, shoulderNeckBlend);

  // Alden is canonically left-handed. The weapon hand owns both the gauntlet and the
  // sword; the right hand remains free and is used as a counter-balance/guard during
  // combat animation.
  buildHand(group(rig.sockets.rightHand, 'right-hand'), materials, 1);
  const swordWrist = group(rig.sockets.leftHand, 'left-wrist-attack-pivot');
  const sword = buildSword(swordWrist, materials, -1);

  head.name = 'helmet';
  buildHelmet(rig.sockets.head, materials);
  const { cape, capePanels } = buildCape(rig.sockets.back, materials, options.capeNeckBlend ?? 1);
  applyPaintedFinish(model);
  rig.soleSamples = [rig.leftFoot, rig.rightFoot].map(foot => {
    const sole = foot.getObjectByName('boot-sole') as THREE.Mesh;
    const position = sole.geometry.getAttribute('position');
    sole.updateMatrix();
    const points = Array.from({ length: position.count }, (_, vertex) =>
      new THREE.Vector3().fromBufferAttribute(position, vertex).applyMatrix4(sole.matrix),
    );
    return { foot, points };
  });

  return {
    ...rig,
    cape, capeMotion: 0, capePanels, swordWrist, sword,
  };
}

function buildLeg(pivot: THREE.Group, shin: THREE.Group, foot: THREE.Group, materials: AldenMaterials) {
  mesh(pivot, 'thigh-mail', createLoftGeometry([
    { y: -0.54, width: 0.11, front: 0.11, back: 0.10 },
    { y: -0.29, width: 0.145, front: 0.145, back: 0.13 },
    { y: -0.05, width: 0.16, front: 0.14, back: 0.135 },
  ]), materials.chain);
  mesh(pivot, 'cuisses', createPlateGeometry([
    [-0.115, -0.16], [0.12, -0.16], [0.105, -0.42], [0, -0.49], [-0.10, -0.42],
  ], 0.04, 0.025), materials.steel, 0, 0, 0.105);
  mesh(shin, 'greave', createGreaveGeometry(), materials.steel);
  const kneeOutline: Array<[number, number]> = [[0, 0.13], [0.13, 0.055], [0.115, -0.07], [0, -0.14], [-0.115, -0.07], [-0.13, 0.055]];
  mesh(shin, 'poleyn-gold-rim', createPlateGeometry(kneeOutline, 0.025, 0.012), materials.gold, 0, 0, 0.115);
  const knee = mesh(shin, 'poleyn', createPlateGeometry(kneeOutline, 0.045, 0.021), materials.steel, 0, 0.007, 0.137);
  knee.scale.set(0.88, 0.82, 1);
  piping(shin, 'greave-ridge', [new THREE.Vector3(0, -0.12, 0.172), new THREE.Vector3(0, -0.29, 0.17), new THREE.Vector3(0, -0.49, 0.104)], materials.steel, 0.012);
  mesh(foot, 'boot', createBootGeometry(), materials.leather, 0, -0.15);
  mesh(foot, 'boot-sole', createBootGeometry(true), materials.visor, 0, -0.15);
  for (const height of [0.115, 0.17]) {
    piping(foot, 'boot-vamp-seam', [
      new THREE.Vector3(-0.105, height - 0.15, 0.12),
      new THREE.Vector3(0, height - 0.126, height === 0.115 ? 0.27 : 0.19),
      new THREE.Vector3(0.105, height - 0.15, 0.12),
    ], materials.leather, 0.011);
  }
}

function buildArm(pivot: THREE.Group, forearm: THREE.Group, materials: AldenMaterials, side: number, neckBlend: number) {
  const shoulder = group(pivot, 'pauldron');
  shoulder.scale.x = side;
  mesh(shoulder, 'pauldron-shell', createPauldronGeometry(neckBlend), materials.steel);
  const surface = createPauldronSurface(neckBlend);
  const rimSurface: Surface = (across, down) => surface(across, down).add(new THREE.Vector3(0.006, 0.004, 0));
  ribbon(shoulder, 'pauldron-gold-rim', rimSurface, [-1, 0.96], [1, 0.96], 0.09, 0, materials.gold);
  const lame = mesh(shoulder, 'pauldron-lame', createPauldronGeometry(), materials.steelDark, 0.013, -0.13);
  lame.scale.set(0.84, 0.65, 0.91);
  mesh(pivot, 'upper-arm-mail', createLoftGeometry([
    { y: -0.46, width: 0.087, front: 0.09, back: 0.085 },
    { y: -0.24, width: 0.116, front: 0.12, back: 0.10 },
    { y: -0.06, width: 0.135, front: 0.125, back: 0.11 },
  ]), materials.chain);
  mesh(pivot, 'rerebrace', createLoftGeometry([
    { y: -0.35, width: 0.103, front: 0.107, back: 0.095 },
    { y: -0.18, width: 0.125, front: 0.13, back: 0.114 },
  ]), materials.steelDark);
  mesh(forearm, 'elbow-mail-joint', createLoftGeometry([
    { y: -0.06, width: 0.086, front: 0.085, back: 0.085 },
    { y: 0.065, width: 0.087, front: 0.085, back: 0.085 },
  ], 10), materials.chain);
  mesh(forearm, 'elbow-couter', createPlateGeometry([
    [0, 0.08], [0.11, 0], [0.075, -0.09], [0, -0.13], [-0.08, -0.065], [-0.10, 0],
  ], 0.03, 0.018), materials.steel, 0, 0, 0.08);
  mesh(forearm, 'vambrace', createLoftGeometry([
    { y: -0.385, width: 0.077, front: 0.08, back: 0.07 },
    { y: -0.30, width: 0.085, front: 0.10, back: 0.08 },
    { y: -0.09, width: 0.115, front: 0.14, back: 0.10 },
    { y: -0.035, width: 0.105, front: 0.10, back: 0.095 },
  ]), materials.steel);
  mesh(forearm, 'gauntlet-cuff', createLoftGeometry([
    { y: -0.415, width: 0.087, front: 0.082, back: 0.077 },
    { y: -0.355, width: 0.105, front: 0.10, back: 0.09 },
  ]), materials.gold);
}

function buildHand(parent: THREE.Group, materials: AldenMaterials, side = 1) {
  mesh(parent, 'closed-glove', createLoftGeometry([
    { y: -0.078, width: 0.06, front: 0.06, back: 0.055 },
    { y: -0.04, width: 0.075, front: 0.08, back: 0.065 },
    { y: 0.058, width: 0.073, front: 0.077, back: 0.065 },
    { y: 0.079, width: 0.052, front: 0.055, back: 0.05 },
  ], 8), materials.leather);
  for (const height of [-0.043, -0.003, 0.037]) {
    piping(parent, 'armored-knuckles', [
      new THREE.Vector3(-0.065 * side, height, 0.022),
      new THREE.Vector3(-0.045 * side, height, 0.078),
      new THREE.Vector3(0.04 * side, height, 0.078),
    ], materials.steelDark, 0.015);
  }
  const thumb = mesh(parent, 'glove-thumb', createPlateGeometry([[-0.02, 0.05], [0.02, 0.04], [0.035, -0.03], [0, -0.052], [-0.02, -0.015]], 0.025, 0.006), materials.leather, 0.057 * side, 0, 0.019);
  thumb.scale.x = side;
  thumb.rotation.z = -0.3 * side;
}

function buildSword(handSocket: THREE.Group, materials: AldenMaterials, handSide = 1) {
  const sword = group(handSocket, 'sword-grip-pivot', 0, 0, 0.008);
  const bladeFrame = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(-1, 0, 0),
  );
  handSocket.updateWorldMatrix(true, false);
  const wristOrientation = handSocket.getWorldQuaternion(new THREE.Quaternion());
  sword.quaternion.copy(wristOrientation.invert()).multiply(new THREE.Quaternion().setFromRotationMatrix(bladeFrame));
  buildHand(sword, materials, handSide);
  mesh(sword, 'sword-grip', createLoftGeometry([
    { y: -0.16, width: 0.043, front: 0.043, back: 0.043 },
    { y: 0.15, width: 0.039, front: 0.039, back: 0.039 },
  ], 8), materials.leather);
  for (const height of [-0.125, 0.115, 0.16]) {
    const binding = mesh(sword, 'grip-binding', new THREE.TorusGeometry(0.042, 0.007, 4, 8), materials.gold, 0, height);
    binding.rotation.x = Math.PI / 2;
  }
  const pommel = mesh(sword, 'sword-pommel', new THREE.OctahedronGeometry(0.076), materials.gold, 0, 0.225);
  pommel.scale.y = 1.25;
  mesh(sword, 'sword-guard', createPlateGeometry([
    [-0.255, -0.24], [-0.24, -0.16], [-0.15, -0.155], [-0.065, -0.177],
    [0, -0.15], [0.065, -0.177], [0.15, -0.155], [0.24, -0.16], [0.255, -0.24],
    [0.16, -0.212], [0.075, -0.222], [0, -0.24], [-0.075, -0.222], [-0.16, -0.212],
  ], 0.065, 0.012), materials.gold, 0, 0, -0.0325);
  mesh(sword, 'sword-blade', createSwordGeometry(), materials.steel);
  mesh(sword, 'guard-signet', new THREE.OctahedronGeometry(0.068), materials.gold, 0, -0.19, 0.045);
  return sword;
}

function buildHelmet(head: THREE.Group, materials: AldenMaterials) {
  const sections = [
    { y: -0.26, width: 0.19, front: 0.24, back: 0.19 },
    { y: -0.13, width: 0.265, front: 0.28, back: 0.235 },
    { y: 0.12, width: 0.275, front: 0.30, back: 0.24 },
    { y: 0.27, width: 0.215, front: 0.19, back: 0.21 },
    { y: 0.35, width: 0.105, front: 0.10, back: 0.12 },
    { y: 0.365, width: 0.015, front: 0.02, back: 0.03 },
  ];
  mesh(head, 'helmet-shell', createLoftGeometry(sections), materials.steel);
  const helmetSurface = (horizontal: number, vertical: number, offset: number) => {
    const clampedY = THREE.MathUtils.clamp(vertical, sections[0].y, sections[sections.length - 1].y);
    const upperIndex = Math.max(1, sections.findIndex(section => section.y >= clampedY));
    const lower = sections[upperIndex - 1];
    const upper = sections[upperIndex];
    const fraction = (clampedY - lower.y) / (upper.y - lower.y);
    const width = THREE.MathUtils.lerp(lower.width, upper.width, fraction);
    const depth = THREE.MathUtils.lerp(lower.front, upper.front, fraction);
    return new THREE.Vector3(horizontal, vertical, depth * Math.sqrt(Math.max(0, 1 - (horizontal / width) ** 2)) + offset);
  };
  const face = (name: string, points: Array<[number, number]>, material: THREE.Material, offset: number) => {
    const geometry = createProjectedShapeGeometry(points, (horizontal, vertical) => helmetSurface(horizontal, vertical, 0.015 + offset));
    return mesh(head, name, geometry, material);
  };
  face('black-t-visor', [[-0.235, 0.12], [0.235, 0.12], [0.20, -0.18], [0, -0.30], [-0.20, -0.18]], materials.visor, 0);
  for (const side of [-1, 1]) {
    face('shield-cheek', [[0.225 * side, 0.038], [0.027 * side, -0.033], [0.021 * side, -0.259], [0.188 * side, -0.173]], materials.steel, 0.016);
    piping(head, 'visor-gold-edge', [-0.035, -0.10, -0.18, -0.25].map(height => helmetSurface(side * 0.024, height, 0.038)), materials.gold, 0.008);
  }
  face('angular-brow', [[-0.235, 0.145], [-0.18, 0.24], [0, 0.29], [0.18, 0.24], [0.235, 0.145], [0, 0.067]], materials.steel, 0.008);
  piping(head, 'brow-gold-rim', [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1].map(across => helmetSurface(across * 0.237, 0.047 + Math.abs(across) * 0.078, 0.033)), materials.gold, 0.010);
  mesh(head, 'sagittal-gold-crest', createLoftGeometry([
    { y: 0.20, width: 0.025, front: 0.17, back: 0.22 },
    { y: 0.32, width: 0.075, front: 0.20, back: 0.20 },
    { y: 0.48, width: 0.037, front: 0.10, back: 0.10 },
    { y: 0.63, width: 0.001, front: 0.01, back: 0.01 },
  ], 4), materials.gold);
  for (const side of [-1, 1]) {
    const hinge = mesh(head, 'visor-hinge', new THREE.CylinderGeometry(0.034, 0.034, 0.015, 8), materials.gold, side * 0.271, 0.04, 0.04);
    hinge.rotation.z = Math.PI / 2;
  }
  return head;
}

function buildCape(backSocket: THREE.Group, materials: AldenMaterials, neckBlend: number) {
  const cape = group(backSocket, 'cape');
  const surface = createCapeSurface(neckBlend);
  mesh(cape, 'pleated-cape', createCapeGeometry(neckBlend), materials.blue);
  for (const side of [-1, 1]) {
    ribbon(cape, 'cape-selvedge', surface, [side * 0.965, 0], [side * 0.965, 0.985], 0.063, -0.008, materials.gold);
    ribbon(cape, 'cape-heraldic-border', surface, [side * 0.54, 0.18], [side * 0.54, 0.77], 0.033, -0.01, materials.gold);
    ribbon(cape, 'cape-heraldic-point', surface, [side * 0.54, 0.77], [0, 0.91], 0.026, -0.012, materials.gold);
  }
  ribbon(cape, 'cape-gold-hem', surface, [-1, 0.984], [1, 0.984], 0.031, -0.008, materials.gold);
  mesh(cape, 'cape-star', createEmblemGeometry(surface, 0.63, 0.28, 0.45, -0.019), materials.gold);
  const capePanels: AldenRig['capePanels'] = [];
  cape.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      capePanels.push({ geometry: object.geometry, rest: new Float32Array(object.geometry.getAttribute('position').array) });
    }
  });
  return { cape, capePanels };
}