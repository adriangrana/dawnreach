import * as THREE from 'three';
import { createHumanoidRig, type HumanoidRig } from '../../characters/humanoidRig';
import {
  createPanelGeometry,
  createSerynClothPanelGeometry,
  createSerynHairGeometry,
  createSerynHeadGeometry,
  createSerynLoftGeometry,
  createSerynShoulderBlendGeometry,
  createTaperedCurveGeometry,
  type SerynLoftSection,
  type SerynShoulderSection,
} from './geometry';
import { createSerynMaterials, type SerynMaterials } from './materials';

export type SerynRig = HumanoidRig & {
  bow: THREE.Group;
  bowString: THREE.Line;
  quiver: THREE.Group;
  hair: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  clothMeshes: THREE.Mesh<THREE.BufferGeometry, THREE.Material>[];
};

function part(
  parent: THREE.Object3D,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number] = [0, 0, 0],
) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function rounded(
  parent: THREE.Object3D,
  name: string,
  size: [number, number, number],
  position: [number, number, number],
  material: THREE.Material,
  segments = 20,
) {
  const geometry = new THREE.SphereGeometry(1, segments, Math.max(12, Math.floor(segments * 0.68)));
  geometry.scale(...size);
  return part(parent, name, geometry, material, position);
}

function loft(
  parent: THREE.Object3D,
  name: string,
  sections: readonly SerynLoftSection[],
  material: THREE.Material,
  sides = 30,
  capLast = true,
  capFirst = true,
) {
  return part(parent, name, createSerynLoftGeometry(sections, sides, capLast, capFirst), material);
}

function shoulderBlend(
  parent: THREE.Object3D,
  name: string,
  sections: readonly SerynShoulderSection[],
  material: THREE.Material,
  sides = 30,
) {
  return part(parent, name, createSerynShoulderBlendGeometry(sections, sides, false, false), material);
}

function curve(
  parent: THREE.Object3D,
  name: string,
  points: readonly THREE.Vector3[],
  radius: number,
  material: THREE.Material,
  endRadius = 0.004,
  steps = 28,
) {
  return part(parent, name, createTaperedCurveGeometry(points, radius, endRadius, steps, 10), material);
}

function panel(
  parent: THREE.Object3D,
  name: string,
  outline: readonly Readonly<[number, number]>[],
  material: THREE.Material,
  position: [number, number, number],
  depth = 0.018,
  bevel = 0.008,
) {
  return part(parent, name, createPanelGeometry(outline, depth, bevel), material, position);
}

function configureSkeleton(rig: HumanoidRig) {
  // Heroic female proportions: long legs, narrow ribcage/shoulders and a wider pelvis.
  rig.pelvis.position.y = 1.31;
  rig.torso.position.y = 1.88;
  rig.head.position.y = 0.75;

  rig.leftLeg.position.x = 0.17;
  rig.rightLeg.position.x = -0.17;
  rig.leftShin.position.y = -0.625;
  rig.rightShin.position.y = -0.625;
  rig.leftFoot.position.y = -0.535;
  rig.rightFoot.position.y = -0.535;

  // Pull the shoulder pivots inward so the arm originates inside the shoulder girdle
  // instead of hanging from the outside of the torso like a separate mannequin piece.
  rig.leftArm.position.set(0.335, 0.305, 0);
  rig.rightArm.position.set(-0.335, 0.305, 0);
  rig.leftForearm.position.y = -0.47;
  rig.rightForearm.position.y = -0.47;
  rig.sockets.leftHand.position.y = -0.445;
  rig.sockets.rightHand.position.y = -0.445;
  rig.torsoRestY = rig.torso.position.y;
  rig.waistMotionScale = 0.38;
}

function buildAnatomy(rig: HumanoidRig, m: SerynMaterials) {
  loft(rig.pelvis, 'seryn-body-pelvis', [
    { y: -0.23, rx: 0.155, rz: 0.125 },
    { y: -0.16, rx: 0.222, rz: 0.158, back: 0.016 },
    { y: -0.04, rx: 0.286, rz: 0.184, back: 0.030 },
    { y: 0.09, rx: 0.292, rz: 0.180, back: 0.024 },
    { y: 0.21, rx: 0.205, rz: 0.142 },
  ], m.skin, 34);

  loft(rig.torso, 'seryn-body-torso', [
    { y: -0.55, rx: 0.162, rz: 0.118 },
    { y: -0.42, rx: 0.174, rz: 0.124 },
    { y: -0.26, rx: 0.192, rz: 0.134 },
    { y: -0.08, rx: 0.222, rz: 0.145 },
    { y: 0.08, rx: 0.260, rz: 0.157, front: 0.030 },
    { y: 0.21, rx: 0.278, rz: 0.165, front: 0.045 },
    { y: 0.31, rx: 0.270, rz: 0.154, front: 0.026 },
    { y: 0.39, rx: 0.224, rz: 0.138, front: 0.014 },
    { y: 0.47, rx: 0.145, rz: 0.098 },
    { y: 0.52, rx: 0.094, rz: 0.076 },
  ], m.skin, 36);

  loft(rig.torso, 'seryn-body-neck', [
    { y: 0.49, rx: 0.072, rz: 0.064 },
    { y: 0.59, rx: 0.071, rz: 0.064 },
    { y: 0.71, rx: 0.067, rz: 0.061 },
  ], m.skin, 24);

  // Anatomical shoulder bridge: an actual 3D cross-axis loft from the base of the neck
  // into the deltoid. The first rings live inside the upper torso and the final rings
  // overlap the arm root, so the visible surface reads as one continuous body mass.
  for (const side of [-1, 1]) {
    shoulderBlend(rig.torso, 'seryn-anatomical-shoulder-bridge', [
      { x: side * 0.070, y: 0.455, z: -0.004, ry: 0.055, rz: 0.082 },
      { x: side * 0.135, y: 0.432, z: 0.000, ry: 0.063, rz: 0.090 },
      { x: side * 0.205, y: 0.395, z: 0.004, ry: 0.074, rz: 0.094 },
      { x: side * 0.270, y: 0.354, z: 0.004, ry: 0.084, rz: 0.092 },
      { x: side * 0.325, y: 0.315, z: 0.002, ry: 0.092, rz: 0.088 },
      { x: side * 0.365, y: 0.292, z: 0.000, ry: 0.094, rz: 0.086 },
      // Extend the bridge through the whole deltoid width. The arm pivot is at
      // |x|=0.335 and its top radius is ~0.094, so the outer shoulder reaches ~0.429.
      // Ending near that edge makes the torso bridge overlap the full shoulder cap
      // rather than stopping around the middle of the arm.
      { x: side * 0.398, y: 0.282, z: -0.001, ry: 0.091, rz: 0.083 },
      { x: side * 0.428, y: 0.278, z: -0.002, ry: 0.082, rz: 0.076 },
    ], m.skin, 34);

    curve(rig.torso, 'seryn-clavicle-line', [
      new THREE.Vector3(side * 0.060, 0.410, 0.116),
      new THREE.Vector3(side * 0.145, 0.398, 0.120),
      new THREE.Vector3(side * 0.235, 0.366, 0.108),
      new THREE.Vector3(side * 0.315, 0.322, 0.076),
      new THREE.Vector3(side * 0.365, 0.294, 0.050),
    ], 0.012, m.skinShadow, 0.007, 18);
  }

  for (const side of [-1, 1]) {
    const arm = side > 0 ? rig.leftArm : rig.rightArm;
    const forearm = side > 0 ? rig.leftForearm : rig.rightForearm;
    const hand = side > 0 ? rig.sockets.leftHand : rig.sockets.rightHand;
    const thigh = side > 0 ? rig.leftLeg : rig.rightLeg;
    const shin = side > 0 ? rig.leftShin : rig.rightShin;
    const foot = side > 0 ? rig.leftFoot : rig.rightFoot;

    // The deltoid is now the widened top of the arm loft itself. It begins inside the
    // shoulder yoke and tapers naturally into the biceps/triceps, eliminating the
    // visible oval shoulder piece.
    loft(arm, 'seryn-body-upper-arm', [
      { y: 0.050, rx: 0.094, rz: 0.086 },
      { y: -0.025, rx: 0.099, rz: 0.090 },
      { y: -0.110, rx: 0.091, rz: 0.081 },
      { y: -0.230, rx: 0.075, rz: 0.067 },
      { y: -0.350, rx: 0.062, rz: 0.056 },
      { y: -0.455, rx: 0.052, rz: 0.049 },
    ], m.skin, 30, true, false);

    rounded(forearm, 'seryn-body-elbow', [0.055, 0.058, 0.053], [0, 0, 0], m.skin, 18);
    loft(forearm, 'seryn-body-forearm', [
      { y: -0.01, rx: 0.055, rz: 0.052 },
      { y: -0.14, rx: 0.064, rz: 0.057 },
      { y: -0.30, rx: 0.052, rz: 0.048 },
      { y: -0.43, rx: 0.042, rz: 0.040 },
    ], m.skin, 22);

    const palm = rounded(hand, 'seryn-body-palm', [0.050, 0.078, 0.048], [0, -0.040, 0.012], m.skin, 18);
    palm.rotation.x = -0.06;
    for (let finger = 0; finger < 4; finger++) {
      const x = (finger - 1.5) * 0.018;
      curve(hand, 'seryn-finger', [
        new THREE.Vector3(x, -0.078, 0.022),
        new THREE.Vector3(x, -0.118, 0.026),
        new THREE.Vector3(x * 0.92, -0.148, 0.020),
      ], 0.010, m.skin, 0.007, 10);
    }
    curve(hand, 'seryn-thumb', [
      new THREE.Vector3(side * -0.050, -0.045, 0.020),
      new THREE.Vector3(side * -0.066, -0.078, 0.030),
      new THREE.Vector3(side * -0.058, -0.105, 0.028),
    ], 0.012, m.skin, 0.007, 10);

    loft(thigh, 'seryn-body-thigh', [
      { y: -0.01, rx: 0.108, rz: 0.105 },
      { y: -0.16, rx: 0.116, rz: 0.108 },
      { y: -0.37, rx: 0.092, rz: 0.085 },
      { y: -0.61, rx: 0.066, rz: 0.062 },
    ], m.skin, 28);

    rounded(shin, 'seryn-body-knee', [0.061, 0.064, 0.058], [0, 0, 0], m.skin, 18);
    loft(shin, 'seryn-body-calf', [
      { y: -0.01, rx: 0.060, rz: 0.056 },
      { y: -0.14, rx: 0.075, rz: 0.069 },
      { y: -0.32, rx: 0.065, rz: 0.060 },
      { y: -0.50, rx: 0.045, rz: 0.043 },
    ], m.skin, 24);

    rounded(foot, 'seryn-body-foot', [0.078, 0.055, 0.172], [0, -0.030, 0.074], m.skin, 20);
  }

  // High-density single connected head mesh. Facial anatomy, eye sockets, nose,
  // lips, chin and pointed ears are all sculpted into the same surface.
  part(rig.head, 'seryn-head', createSerynHeadGeometry(), m.face);
}

function buildFace(_rig: HumanoidRig, _m: SerynMaterials) {
  // Facial anatomy and colour are authored directly into createSerynHeadGeometry().
}

function buildHair(rig: HumanoidRig, m: SerynMaterials) {
  // One continuous fitted hairstyle mesh: crown, parting, temple curtains and the
  // shoulder-length back are all one connected surface. No tube/lock primitives.
  const hair = part(
    rig.head,
    'seryn-unified-hair',
    createSerynHairGeometry(),
    m.hair,
  );
  hair.frustumCulled = false;

  // Jewelry remains separate from hair/anatomy because it is an actual accessory.
  const jewel = part(rig.head, 'seryn-forehead-prism', new THREE.OctahedronGeometry(0.030, 0), m.crystal, [0, 0.132, 0.166]);
  jewel.scale.set(0.52, 1.16, 0.40);
  const setting = part(rig.head, 'seryn-forehead-setting', new THREE.TorusGeometry(0.032, 0.0055, 5, 16), m.gold, [0, 0.132, 0.157]);
  setting.scale.y = 1.18;

  return hair;
}

function buildClothing(rig: HumanoidRig, m: SerynMaterials) {
  const clothMeshes: THREE.Mesh<THREE.BufferGeometry, THREE.Material>[] = [];

  const clothPanel = (
    parent: THREE.Object3D,
    name: string,
    material: THREE.Material,
    options: Parameters<typeof createSerynClothPanelGeometry>[0],
    position: [number, number, number],
    rotation: [number, number, number] = [0, 0, 0],
    widthSegments = 30,
    lengthSegments = 40,
    dynamics: {
      role: 'front' | 'side-left' | 'side-right' | 'cape';
      inertia: number;
      gravity: number;
      collisionMargin: number;
    } = { role: 'front', inertia: 1, gravity: 1, collisionMargin: 0.004 },
  ) => {
    const mesh = part(
      parent,
      name,
      createSerynClothPanelGeometry(options, widthSegments, lengthSegments),
      material,
      position,
    );
    mesh.rotation.set(...rotation);
    mesh.frustumCulled = false;
    mesh.userData.serynClothDynamics = {
      ...dynamics,
      basePosition: mesh.position.clone(),
      baseRotation: new THREE.Euler(mesh.rotation.x, mesh.rotation.y, mesh.rotation.z, mesh.rotation.order),
    };
    clothMeshes.push(mesh);
    return mesh;
  };

  // ---------------------------------------------------------------------------
  // FITTED BASE: PANTS + BLOUSE
  // Every radius below is deliberately larger than the underlying anatomy. The skin
  // stays inside the garment instead of poking through it during rotation/animation.
  // ---------------------------------------------------------------------------
  loft(rig.pelvis, 'seryn-pants-waist', [
    { y: -0.235, rx: 0.178, rz: 0.143 },
    { y: -0.165, rx: 0.241, rz: 0.176, back: 0.018 },
    { y: -0.045, rx: 0.306, rz: 0.211, back: 0.034 },
    { y: 0.090, rx: 0.314, rz: 0.207, back: 0.030 },
    { y: 0.215, rx: 0.226, rz: 0.160 },
  ], m.navyDark, 44);

  for (const side of [-1, 1]) {
    const thigh = side > 0 ? rig.leftLeg : rig.rightLeg;
    const shin = side > 0 ? rig.leftShin : rig.rightShin;
    const arm = side > 0 ? rig.leftArm : rig.rightArm;
    const forearm = side > 0 ? rig.leftForearm : rig.rightForearm;
    const foot = side > 0 ? rig.leftFoot : rig.rightFoot;

    // Real trouser legs, slightly proud of the skin from hip to knee.
    loft(thigh, 'seryn-fitted-trouser-leg', [
      { y: 0.035, rx: 0.123, rz: 0.119 },
      { y: -0.120, rx: 0.129, rz: 0.121 },
      { y: -0.310, rx: 0.111, rz: 0.103 },
      { y: -0.500, rx: 0.084, rz: 0.079 },
      { y: -0.600, rx: 0.076, rz: 0.072 },
    ], m.navyDark, 34, true, false);

    curve(thigh, 'seryn-trouser-gold-seam', [
      new THREE.Vector3(side * 0.109, 0.010, 0.018),
      new THREE.Vector3(side * 0.116, -0.165, 0.020),
      new THREE.Vector3(side * 0.096, -0.375, 0.018),
      new THREE.Vector3(side * 0.070, -0.575, 0.014),
    ], 0.0045, m.gold, 0.0032, 20);

    // Ivory fitted upper sleeves overlap the shoulder/arm skin instead of terminating
    // inside it.
    loft(arm, 'seryn-ivory-upper-sleeve', [
      { y: 0.050, rx: 0.106, rz: 0.097 },
      { y: -0.045, rx: 0.111, rz: 0.099 },
      { y: -0.145, rx: 0.100, rz: 0.090 },
      { y: -0.270, rx: 0.083, rz: 0.075 },
      { y: -0.320, rx: 0.076, rz: 0.069 },
    ], m.ivory, 34, true, false);

    loft(forearm, 'seryn-black-bracer', [
      { y: -0.020, rx: 0.071, rz: 0.066 },
      { y: -0.125, rx: 0.076, rz: 0.069 },
      { y: -0.290, rx: 0.063, rz: 0.057 },
      { y: -0.400, rx: 0.052, rz: 0.048 },
    ], m.blackLeather, 30);
    for (let band = 0; band < 4; band++) {
      const bandY = -0.078 - band * 0.095;
      const ring = part(
        forearm,
        'seryn-bracer-band',
        new THREE.TorusGeometry(0.069 - band * 0.0043, 0.0046, 6, 26),
        band % 2 === 0 ? m.gold : m.silver,
        [0, bandY, 0],
      );
      ring.rotation.x = Math.PI / 2;
    }
    const bracerGem = part(forearm, 'seryn-bracer-prism', new THREE.OctahedronGeometry(0.028, 0), m.crystal, [0, -0.225, 0.066]);
    bracerGem.scale.set(0.46, 1.10, 0.30);

    // Boots overlap the trouser cuff and knee so no skin ring appears between pieces.
    loft(shin, 'seryn-tall-black-boot', [
      { y: 0.040, rx: 0.068, rz: 0.064 },
      { y: -0.080, rx: 0.081, rz: 0.074 },
      { y: -0.235, rx: 0.083, rz: 0.076 },
      { y: -0.390, rx: 0.067, rz: 0.062 },
      { y: -0.505, rx: 0.052, rz: 0.049 },
    ], m.blackLeather, 32, true, false);

    const greave = panel(shin, 'seryn-ornate-greave', [
      [-0.050, 0.205], [0.050, 0.205], [0.065, 0.085],
      [0.050, -0.100], [0.022, -0.205], [0, -0.235],
      [-0.022, -0.205], [-0.050, -0.100], [-0.065, 0.085],
    ], m.gold, [0, -0.230, 0.081], 0.014, 0.005);
    greave.scale.y = 0.92;
    const innerGreave = panel(shin, 'seryn-greave-dark-inlay', [
      [-0.034, 0.155], [0.034, 0.155], [0.044, 0.040],
      [0.028, -0.125], [0, -0.185], [-0.028, -0.125], [-0.044, 0.040],
    ], m.silverDark, [0, -0.230, 0.089], 0.010, 0.003);
    innerGreave.scale.y = 0.92;
    const bootGem = part(shin, 'seryn-boot-prism', new THREE.OctahedronGeometry(0.026, 0), m.crystal, [0, -0.228, 0.100]);
    bootGem.scale.set(0.44, 1.05, 0.28);

    rounded(foot, 'seryn-boot-foot', [0.089, 0.064, 0.190], [0, -0.032, 0.080], m.blackLeather, 24);
    const toe = rounded(foot, 'seryn-armored-toe', [0.082, 0.040, 0.116], [0, -0.016, 0.156], m.silverDark, 22);
    toe.scale.y = 0.74;
  }

  loft(rig.torso, 'seryn-ivory-blouse', [
    { y: -0.558, rx: 0.179, rz: 0.133 },
    { y: -0.420, rx: 0.192, rz: 0.140 },
    { y: -0.260, rx: 0.211, rz: 0.151 },
    { y: -0.080, rx: 0.241, rz: 0.162 },
    { y: 0.080, rx: 0.281, rz: 0.181, front: 0.034 },
    { y: 0.210, rx: 0.300, rz: 0.190, front: 0.050 },
    { y: 0.310, rx: 0.292, rz: 0.178, front: 0.030 },
    { y: 0.390, rx: 0.246, rz: 0.160, front: 0.016 },
    { y: 0.470, rx: 0.168, rz: 0.119 },
  ], m.ivory, 46);

  // Fabric over the anatomical shoulder bridge. It is slightly larger than the skin
  // bridge on every section so the shoulder never protrudes through the sleeve.
  for (const side of [-1, 1]) {
    shoulderBlend(rig.torso, 'seryn-ivory-shoulder-shell', [
      { x: side * 0.070, y: 0.459, z: -0.004, ry: 0.065, rz: 0.093 },
      { x: side * 0.135, y: 0.436, z: 0.000, ry: 0.073, rz: 0.101 },
      { x: side * 0.205, y: 0.399, z: 0.004, ry: 0.084, rz: 0.105 },
      { x: side * 0.270, y: 0.358, z: 0.004, ry: 0.094, rz: 0.103 },
      { x: side * 0.325, y: 0.319, z: 0.002, ry: 0.102, rz: 0.099 },
      { x: side * 0.365, y: 0.296, z: 0.000, ry: 0.104, rz: 0.097 },
      { x: side * 0.400, y: 0.286, z: -0.001, ry: 0.100, rz: 0.094 },
      { x: side * 0.433, y: 0.282, z: -0.002, ry: 0.091, rz: 0.086 },
    ], m.ivory, 38);
  }

  // Dark structured corset sits OUTSIDE the blouse.
  loft(rig.torso, 'seryn-midnight-corset', [
    { y: -0.505, rx: 0.186, rz: 0.143 },
    { y: -0.360, rx: 0.202, rz: 0.151 },
    { y: -0.180, rx: 0.226, rz: 0.160 },
    { y: 0.020, rx: 0.260, rz: 0.175, front: 0.033 },
    { y: 0.170, rx: 0.292, rz: 0.190, front: 0.050 },
    { y: 0.270, rx: 0.286, rz: 0.180, front: 0.029 },
  ], m.navyDark, 46);

  const corsetCenter = panel(rig.torso, 'seryn-corset-center-panel', [
    [-0.082, 0.215], [0.082, 0.215], [0.107, 0.045],
    [0.080, -0.205], [0, -0.315], [-0.080, -0.205], [-0.107, 0.045],
  ], m.blackLeather, [0, -0.015, 0.201], 0.022, 0.009);
  corsetCenter.scale.z = 0.72;

  for (const side of [-1, 1]) {
    curve(rig.torso, 'seryn-corset-gold-piping', [
      new THREE.Vector3(side * 0.094, 0.235, 0.207),
      new THREE.Vector3(side * 0.130, 0.050, 0.216),
      new THREE.Vector3(side * 0.108, -0.230, 0.202),
    ], 0.006, m.gold, 0.004, 20);
  }
  const chestPrism = part(rig.torso, 'seryn-corset-prism', new THREE.OctahedronGeometry(0.052, 0), m.crystal, [0, 0.030, 0.237]);
  chestPrism.scale.set(0.52, 1.30, 0.38);

  // Narrow waist/belt instead of a second bulky pelvis shell.
  loft(rig.torso, 'seryn-waist-belt', [
    { y: -0.535, rx: 0.181, rz: 0.139 },
    { y: -0.485, rx: 0.191, rz: 0.146 },
    { y: -0.425, rx: 0.188, rz: 0.142 },
  ], m.blackLeather, 34);

  // ---------------------------------------------------------------------------
  // VOLUMETRIC SPLIT TUNIC
  // ---------------------------------------------------------------------------
  const outerPanels = [
    { name: 'seryn-ivory-front-left', material: m.ivory, x: -0.088, z: 0.188, rotY: -0.09, widthTop: 0.215, widthBottom: 0.292, length: 1.08, drift: -0.105, curve: 0.044, bias: 0.2 },
    { name: 'seryn-ivory-front-right', material: m.ivory, x: 0.088, z: 0.188, rotY: 0.09, widthTop: 0.215, widthBottom: 0.292, length: 1.08, drift: 0.105, curve: 0.044, bias: 1.0 },
    { name: 'seryn-blue-side-left', material: m.cloakBlue, x: -0.215, z: 0.018, rotY: -1.08, widthTop: 0.205, widthBottom: 0.330, length: 1.18, drift: -0.120, curve: 0.024, bias: 1.8 },
    { name: 'seryn-blue-side-right', material: m.cloakBlueDark, x: 0.215, z: 0.018, rotY: 1.08, widthTop: 0.205, widthBottom: 0.330, length: 1.18, drift: 0.120, curve: 0.024, bias: 2.6 },
  ] as const;

  for (const spec of outerPanels) {
    clothPanel(
      rig.torso,
      spec.name,
      spec.material,
      {
        widthTop: spec.widthTop,
        widthBottom: spec.widthBottom,
        length: spec.length,
        zTop: 0,
        zBottom: -0.020,
        xDrift: spec.drift,
        flare: 0.14,
        foldDepth: 0.014,
        curveDepth: spec.curve,
        thickness: 0.014,
        edgeCurl: 0.008,
        hemWave: 0.030,
        bias: spec.bias,
      },
      [spec.x, -0.445, spec.z],
      [0.025, spec.rotY, 0],
      34,
      46,
      spec.name.includes('front')
        ? { role: 'front', inertia: 0.72, gravity: 0.62, collisionMargin: 0.010 }
        : {
            role: spec.name.includes('left') ? 'side-left' : 'side-right',
            inertia: 0.88,
            gravity: 0.78,
            collisionMargin: 0.008,
          },
    );
  }

  // Leather/gold harness layered above blouse/corset.
  for (const side of [-1, 1]) {
    curve(rig.torso, 'seryn-cross-harness', [
      new THREE.Vector3(side * 0.208, 0.245, 0.216),
      new THREE.Vector3(side * 0.112, 0.050, 0.236),
      new THREE.Vector3(side * 0.020, -0.235, 0.218),
      new THREE.Vector3(side * -0.070, -0.430, 0.184),
    ], 0.015, m.leather, 0.013, 24);
    curve(rig.torso, 'seryn-harness-gold-edge', [
      new THREE.Vector3(side * 0.208, 0.245, 0.230),
      new THREE.Vector3(side * 0.112, 0.050, 0.250),
      new THREE.Vector3(side * 0.020, -0.235, 0.232),
      new THREE.Vector3(side * -0.070, -0.430, 0.198),
    ], 0.0042, m.gold, 0.0034, 22);
  }

  // ---------------------------------------------------------------------------
  // MANTLE + LAYERED CAPE
  // ---------------------------------------------------------------------------
  loft(rig.torso, 'seryn-blue-mantle', [
    { y: 0.350, rx: 0.312, rz: 0.176 },
    { y: 0.420, rx: 0.287, rz: 0.160 },
    { y: 0.500, rx: 0.210, rz: 0.138 },
    { y: 0.565, rx: 0.162, rz: 0.116 },
  ], m.cloakBlue, 46);

  const capeLayers = [
    { name: 'seryn-cape-center', material: m.cloakBlueDark, x: 0.000, widthTop: 0.39, widthBottom: 0.58, length: 1.72, drift: 0.02, rotY: 0.00, curve: -0.034, bias: 0.4 },
    { name: 'seryn-cape-left', material: m.cloakBlue, x: -0.205, widthTop: 0.34, widthBottom: 0.55, length: 1.62, drift: -0.16, rotY: -0.16, curve: -0.030, bias: 1.4 },
    { name: 'seryn-cape-right', material: m.cloakBlue, x: 0.205, widthTop: 0.34, widthBottom: 0.55, length: 1.66, drift: 0.17, rotY: 0.16, curve: -0.030, bias: 2.3 },
  ] as const;

  for (const spec of capeLayers) {
    clothPanel(
      rig.torso,
      spec.name,
      spec.material,
      {
        widthTop: spec.widthTop,
        widthBottom: spec.widthBottom,
        length: spec.length,
        zTop: 0,
        zBottom: -0.105,
        xDrift: spec.drift,
        flare: 0.18,
        foldDepth: 0.020,
        curveDepth: spec.curve,
        thickness: 0.016,
        edgeCurl: 0.010,
        hemWave: 0.075,
        bias: spec.bias,
      },
      [spec.x, 0.320, -0.225],
      [-0.060, spec.rotY, 0],
      42,
      58,
      { role: 'cape', inertia: 1.35, gravity: 1.12, collisionMargin: 0.014 },
    );
  }

  return clothMeshes;
}

function buildBow(rig: HumanoidRig, m: SerynMaterials) {
  const bow = new THREE.Group();
  bow.name = 'seryn-prism-longbow';

  const upper = [
    new THREE.Vector3(0, 0.02, 0),
    new THREE.Vector3(0.075, 0.26, 0.010),
    new THREE.Vector3(0.160, 0.54, 0.038),
    new THREE.Vector3(0.145, 0.80, 0.066),
    new THREE.Vector3(0.065, 1.02, 0.030),
  ];
  const lower = upper.map(point => new THREE.Vector3(-point.x, -point.y, point.z));
  curve(bow, 'seryn-bow-upper-gold', upper, 0.024, m.gold, 0.015, 26);
  curve(bow, 'seryn-bow-lower-gold', lower, 0.024, m.gold, 0.015, 26);
  curve(bow, 'seryn-bow-upper-spine', upper.map(p => new THREE.Vector3(p.x * 0.84, p.y * 0.98, p.z - 0.012)), 0.013, m.silverDark, 0.008, 26);
  curve(bow, 'seryn-bow-lower-spine', lower.map(p => new THREE.Vector3(p.x * 0.84, p.y * 0.98, p.z - 0.012)), 0.013, m.silverDark, 0.008, 26);

  rounded(bow, 'seryn-bow-grip', [0.042, 0.145, 0.043], [0, 0, 0], m.leather, 18);
  for (const side of [-1, 1]) {
    const gem = part(bow, 'seryn-bow-tip-prism', new THREE.OctahedronGeometry(0.056, 0), m.crystal, [side * 0.065, side * 1.015, 0.032]);
    gem.scale.set(0.54, 1.40, 0.44);
  }
  const centerGem = part(bow, 'seryn-bow-center-prism', new THREE.OctahedronGeometry(0.065, 0), m.crystal, [0.032, 0.010, 0.030]);
  centerGem.scale.set(0.58, 1.16, 0.42);

  const stringGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0.065, 1.02, 0.030),
    new THREE.Vector3(0, 0, -0.10),
    new THREE.Vector3(-0.065, -1.02, 0.030),
  ]);
  const bowString = new THREE.Line(
    stringGeometry,
    new THREE.LineBasicMaterial({ color: 0xbaf4ff, transparent: true, opacity: 0.90 }),
  );
  bowString.name = 'seryn-bow-energy-string';
  bow.add(bowString);

  bow.position.set(0.010, -0.105, 0.026);
  bow.rotation.set(0.025, -0.050, -0.075);
  rig.sockets.leftHand.add(bow);
  return { bow, bowString };
}

function buildQuiver(rig: HumanoidRig, m: SerynMaterials) {
  const quiver = new THREE.Group();
  quiver.name = 'seryn-quiver';

  const body = part(quiver, 'seryn-quiver-body', new THREE.CylinderGeometry(0.075, 0.095, 0.72, 16), m.leather);
  body.rotation.z = 0.10;
  const rim = part(quiver, 'seryn-quiver-rim', new THREE.TorusGeometry(0.086, 0.012, 6, 18), m.gold, [0, 0.36, 0]);
  rim.rotation.x = Math.PI / 2;

  for (let index = 0; index < 5; index++) {
    const arrow = new THREE.Group();
    const shaft = part(arrow, 'seryn-arrow-shaft', new THREE.CylinderGeometry(0.007, 0.007, 0.69, 8), m.silver);
    shaft.position.y = 0.30;
    part(arrow, 'seryn-arrowhead', new THREE.ConeGeometry(0.026, 0.090, 5), m.crystal, [0, 0.690, 0]);
    const fletching = part(arrow, 'seryn-fletching', new THREE.ConeGeometry(0.023, 0.085, 4), m.teal, [0, -0.055, 0]);
    fletching.rotation.z = Math.PI;
    arrow.position.x = (index - 2) * 0.023;
    arrow.position.z = Math.abs(index - 2) * 0.009;
    quiver.add(arrow);
  }

  quiver.position.set(-0.225, 0.015, -0.120);
  quiver.rotation.set(0.06, -0.08, 0.31);
  rig.sockets.back.add(quiver);
  return quiver;
}

function configureSoles(rig: HumanoidRig) {
  rig.soleSamples = [rig.leftFoot, rig.rightFoot].map(foot => ({
    foot,
    points: Array.from({ length: 18 }, (_, index) => {
      const angle = index / 18 * Math.PI * 2;
      return new THREE.Vector3(Math.cos(angle) * 0.084, -0.095, Math.sin(angle) * 0.19 + 0.073);
    }),
  }));
}

export function buildSeryn(): SerynRig {
  const rig = createHumanoidRig({ name: 'H002', armRestAngle: 0.050 });
  configureSkeleton(rig);
  const materials = createSerynMaterials();

  buildAnatomy(rig, materials);
  buildFace(rig, materials);
  const hair = buildHair(rig, materials);
  const clothMeshes = buildClothing(rig, materials);
  const { bow, bowString } = buildBow(rig, materials);
  const quiver = buildQuiver(rig, materials);
  configureSoles(rig);

  rig.root.userData.heroDefinitionId = 'H002';
  rig.root.userData.heroAttackStyle = 'ranged';
  rig.root.userData.serynModelRevision = 'horizon-scout-v14-inertial-cloth';

  return Object.assign(rig, { bow, bowString, quiver, hair, clothMeshes });
}
