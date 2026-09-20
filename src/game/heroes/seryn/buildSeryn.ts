import * as THREE from 'three';
import { createHumanoidRig, type HumanoidRig } from '../../characters/humanoidRig';

export type SerynRig = HumanoidRig & {
  bow: THREE.Group;
  bowString: THREE.Line;
  quiver: THREE.Group;
};

type MaterialSet = Readonly<{
  skin: THREE.MeshStandardMaterial;
  skinWarm: THREE.MeshStandardMaterial;
  hair: THREE.MeshStandardMaterial;
  hairShadow: THREE.MeshStandardMaterial;
  eyeWhite: THREE.MeshStandardMaterial;
  iris: THREE.MeshStandardMaterial;
  lashes: THREE.MeshStandardMaterial;
  lips: THREE.MeshStandardMaterial;
  navy: THREE.MeshStandardMaterial;
  navyDark: THREE.MeshStandardMaterial;
  teal: THREE.MeshStandardMaterial;
  silver: THREE.MeshStandardMaterial;
  silverDark: THREE.MeshStandardMaterial;
  gold: THREE.MeshStandardMaterial;
  leather: THREE.MeshStandardMaterial;
  crystal: THREE.MeshStandardMaterial;
}>;

function standard(
  color: number,
  metalness: number,
  roughness: number,
  emissive = 0x000000,
  emissiveIntensity = 0,
) {
  return new THREE.MeshStandardMaterial({
    color,
    metalness,
    roughness,
    emissive,
    emissiveIntensity,
  });
}

function materials(): MaterialSet {
  return {
    skin: standard(0xd8ad98, 0.0, 0.72),
    skinWarm: standard(0xc88f7c, 0.0, 0.78),
    hair: standard(0xd8dde5, 0.08, 0.45),
    hairShadow: standard(0x9aa7b5, 0.08, 0.52),
    eyeWhite: standard(0xf1f4f6, 0.0, 0.42),
    iris: standard(0x53c9e9, 0.05, 0.30, 0x0e6784, 0.26),
    lashes: standard(0x202630, 0.0, 0.82),
    lips: standard(0x9f5c5c, 0.0, 0.66),
    navy: standard(0x122b50, 0.16, 0.60),
    navyDark: standard(0x07182c, 0.22, 0.64),
    teal: standard(0x2d6570, 0.10, 0.66),
    silver: standard(0xb8c3ce, 0.76, 0.24),
    silverDark: standard(0x667789, 0.70, 0.30),
    gold: standard(0xc6a25a, 0.80, 0.23),
    leather: standard(0x2b2324, 0.12, 0.78),
    crystal: standard(0x61dcff, 0.32, 0.16, 0x148eb7, 0.42),
  };
}

function mesh(
  parent: THREE.Object3D,
  name: string,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number] = [0, 0, 0],
) {
  const part = new THREE.Mesh(geometry, material);
  part.name = name;
  part.position.set(...position);
  part.castShadow = true;
  part.receiveShadow = true;
  parent.add(part);
  return part;
}

function group(
  parent: THREE.Object3D,
  name: string,
  position: [number, number, number] = [0, 0, 0],
) {
  const value = new THREE.Group();
  value.name = name;
  value.position.set(...position);
  parent.add(value);
  return value;
}

function rounded(
  parent: THREE.Object3D,
  name: string,
  size: [number, number, number],
  position: [number, number, number],
  material: THREE.Material,
  segments = 20,
) {
  const geometry = new THREE.SphereGeometry(1, segments, Math.max(10, Math.floor(segments * 0.65)));
  geometry.scale(...size);
  return mesh(parent, name, geometry, material, position);
}

function contour(
  parent: THREE.Object3D,
  name: string,
  sections: Array<[number, number]>,
  depth: number,
  material: THREE.Material,
  radialSegments = 22,
) {
  const geometry = new THREE.LatheGeometry(
    sections.map(([radius, y]) => new THREE.Vector2(radius, y)),
    radialSegments,
  );
  geometry.scale(1, 1, depth);
  return mesh(parent, name, geometry, material);
}

function plate(
  parent: THREE.Object3D,
  name: string,
  points: Array<[number, number]>,
  depth: number,
  material: THREE.Material,
  z = 0,
  bevel = 0.016,
) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], index) => {
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: bevel,
    bevelThickness: bevel * 0.7,
  });
  geometry.translate(0, 0, z);
  return mesh(parent, name, geometry, material);
}

function tube(
  parent: THREE.Object3D,
  name: string,
  points: THREE.Vector3[],
  radius: number,
  material: THREE.Material,
  tubularSegments = 20,
) {
  const curve = new THREE.CatmullRomCurve3(points);
  return mesh(
    parent,
    name,
    new THREE.TubeGeometry(curve, tubularSegments, radius, 7, false),
    material,
  );
}

function buildFemaleBody(rig: HumanoidRig, m: MaterialSet) {
  // Seryn is deliberately lighter and narrower than Alden. These are rig proportions,
  // not just armor scale, so every animation retains a feminine silhouette.
  rig.leftArm.position.x = 0.405;
  rig.rightArm.position.x = -0.405;
  rig.leftLeg.position.x = 0.19;
  rig.rightLeg.position.x = -0.19;
  rig.head.position.y = 0.82;
  rig.leftShin.position.y = -0.565;
  rig.rightShin.position.y = -0.565;
  rig.leftFoot.position.y = -0.49;
  rig.rightFoot.position.y = -0.49;

  contour(rig.pelvis, 'seryn-body-pelvis', [
    [0.00, -0.22],
    [0.20, -0.21],
    [0.295, -0.10],
    [0.315, 0.03],
    [0.285, 0.19],
    [0.00, 0.23],
  ], 0.76, m.skin);

  contour(rig.torso, 'seryn-body-torso', [
    [0.00, -0.53],
    [0.215, -0.52],
    [0.225, -0.35],
    [0.245, -0.18],
    [0.295, 0.02],
    [0.335, 0.20],
    [0.315, 0.38],
    [0.255, 0.50],
    [0.00, 0.52],
  ], 0.69, m.skin);

  // Soft upper-chest volume is kept anatomical and mostly covered by the cuirass.
  rounded(rig.torso, 'seryn-body-chest-left', [0.145, 0.135, 0.105], [0.125, 0.14, 0.185], m.skin);
  rounded(rig.torso, 'seryn-body-chest-right', [0.145, 0.135, 0.105], [-0.125, 0.14, 0.185], m.skin);

  contour(rig.torso, 'seryn-body-neck', [
    [0.00, 0.44],
    [0.088, 0.45],
    [0.092, 0.68],
    [0.078, 0.74],
    [0.00, 0.75],
  ], 0.90, m.skin);

  const head = rounded(rig.head, 'seryn-face', [0.195, 0.245, 0.190], [0, 0.015, 0], m.skin, 28);
  head.scale.z = 0.97;

  // Jaw and cheek shaping keeps the face from reading as a featureless sphere.
  rounded(rig.head, 'seryn-jaw', [0.145, 0.115, 0.145], [0, -0.115, 0.015], m.skin, 24);
  rounded(rig.head, 'seryn-cheek-left', [0.075, 0.060, 0.045], [0.105, -0.005, 0.145], m.skinWarm, 18);
  rounded(rig.head, 'seryn-cheek-right', [0.075, 0.060, 0.045], [-0.105, -0.005, 0.145], m.skinWarm, 18);

  for (const side of [-1, 1]) {
    const upperArm = side > 0 ? rig.leftArm : rig.rightArm;
    const forearm = side > 0 ? rig.leftForearm : rig.rightForearm;
    const hand = side > 0 ? rig.sockets.leftHand : rig.sockets.rightHand;
    const thigh = side > 0 ? rig.leftLeg : rig.rightLeg;
    const shin = side > 0 ? rig.leftShin : rig.rightShin;
    const foot = side > 0 ? rig.leftFoot : rig.rightFoot;

    contour(upperArm, 'seryn-body-upper-arm', [
      [0.00, -0.44],
      [0.064, -0.43],
      [0.082, -0.27],
      [0.092, -0.08],
      [0.072, -0.015],
      [0.00, 0],
    ], 0.92, m.skin, 18);

    rounded(forearm, 'seryn-body-elbow', [0.070, 0.070, 0.066], [0, 0, 0], m.skin, 16);
    contour(forearm, 'seryn-body-forearm', [
      [0.00, -0.43],
      [0.048, -0.42],
      [0.060, -0.30],
      [0.075, -0.12],
      [0.066, -0.04],
      [0.00, -0.025],
    ], 0.92, m.skin, 18);

    rounded(hand, 'seryn-body-hand', [0.058, 0.105, 0.063], [0, -0.035, 0.005], m.skin, 16);

    rounded(thigh, 'seryn-body-hip', [0.115, 0.105, 0.115], [0, 0, 0], m.skin, 18);
    contour(thigh, 'seryn-body-thigh', [
      [0.00, -0.54],
      [0.078, -0.53],
      [0.108, -0.39],
      [0.128, -0.16],
      [0.118, -0.045],
      [0.00, 0],
    ], 0.92, m.skin, 20);

    rounded(shin, 'seryn-body-knee', [0.073, 0.075, 0.070], [0, 0, 0], m.skin, 16);
    contour(shin, 'seryn-body-calf', [
      [0.00, -0.47],
      [0.052, -0.46],
      [0.078, -0.31],
      [0.095, -0.16],
      [0.072, -0.045],
      [0.00, -0.025],
    ], 0.90, m.skin, 18);

    rounded(foot, 'seryn-body-foot', [0.095, 0.070, 0.205], [0, -0.025, 0.075], m.skin, 18);
  }
}

function buildFaceAndHair(rig: HumanoidRig, m: MaterialSet) {
  // Eyes sit on local +Z because Dawnreach humanoids face +Z.
  for (const side of [-1, 1]) {
    const eye = rounded(rig.head, 'seryn-eye-white', [0.055, 0.028, 0.018], [side * 0.072, 0.045, 0.181], m.eyeWhite, 18);
    eye.rotation.z = side * -0.05;
    rounded(rig.head, 'seryn-eye-iris', [0.021, 0.021, 0.012], [side * 0.072, 0.045, 0.198], m.iris, 16);
    rounded(rig.head, 'seryn-eye-pupil', [0.009, 0.012, 0.007], [side * 0.072, 0.045, 0.207], m.lashes, 12);
    const brow = mesh(rig.head, 'seryn-brow', new THREE.BoxGeometry(0.090, 0.012, 0.010), m.hairShadow, [side * 0.073, 0.105, 0.192]);
    brow.rotation.z = side * -0.08;
  }

  const nose = mesh(rig.head, 'seryn-nose', new THREE.ConeGeometry(0.032, 0.105, 8), m.skinWarm, [0, -0.005, 0.205]);
  nose.rotation.x = Math.PI / 2;
  nose.scale.set(0.72, 1, 0.66);

  rounded(rig.head, 'seryn-upper-lip', [0.055, 0.012, 0.013], [0, -0.080, 0.190], m.lips, 16);
  rounded(rig.head, 'seryn-lower-lip', [0.050, 0.014, 0.014], [0, -0.098, 0.187], m.lips, 16);

  // Pointed ears follow the established Seryn concept art while retaining human skin.
  for (const side of [-1, 1]) {
    const ear = mesh(rig.head, 'seryn-pointed-ear', new THREE.ConeGeometry(0.070, 0.235, 5), m.skin, [side * 0.220, 0.045, -0.005]);
    ear.rotation.z = side * -Math.PI / 2;
    ear.rotation.y = side * -0.08;
    ear.scale.z = 0.55;
  }

  // Silver-blonde cap plus layered lengths. The cap leaves the face fully visible.
  const cap = mesh(
    rig.head,
    'seryn-hair-cap',
    new THREE.SphereGeometry(0.215, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.64),
    m.hair,
    [0, 0.055, -0.010],
  );
  cap.scale.set(1.08, 1.08, 1.08);

  const backHair = group(rig.head, 'seryn-back-hair', [0, 0.01, -0.12]);
  tube(backHair, 'seryn-hair-center', [
    new THREE.Vector3(0, 0.11, 0),
    new THREE.Vector3(0.01, -0.16, -0.01),
    new THREE.Vector3(-0.02, -0.42, -0.03),
    new THREE.Vector3(-0.04, -0.67, 0.00),
  ], 0.070, m.hair, 22);
  tube(backHair, 'seryn-hair-left', [
    new THREE.Vector3(0.10, 0.09, 0.01),
    new THREE.Vector3(0.15, -0.16, 0.02),
    new THREE.Vector3(0.12, -0.40, -0.01),
    new THREE.Vector3(0.08, -0.60, 0.01),
  ], 0.055, m.hairShadow, 20);
  tube(backHair, 'seryn-hair-right', [
    new THREE.Vector3(-0.10, 0.09, 0.01),
    new THREE.Vector3(-0.14, -0.16, 0.02),
    new THREE.Vector3(-0.10, -0.41, -0.01),
    new THREE.Vector3(-0.05, -0.61, 0.01),
  ], 0.055, m.hairShadow, 20);

  for (const side of [-1, 1]) {
    tube(rig.head, 'seryn-face-lock', [
      new THREE.Vector3(side * 0.145, 0.16, 0.05),
      new THREE.Vector3(side * 0.175, 0.01, 0.11),
      new THREE.Vector3(side * 0.155, -0.17, 0.105),
      new THREE.Vector3(side * 0.115, -0.30, 0.055),
    ], 0.030, m.hair, 16);
  }

  const jewel = mesh(rig.head, 'seryn-forehead-prism', new THREE.OctahedronGeometry(0.045, 0), m.crystal, [0, 0.155, 0.198]);
  jewel.scale.set(0.62, 1.25, 0.42);
  const setting = mesh(rig.head, 'seryn-forehead-setting', new THREE.TorusGeometry(0.045, 0.008, 5, 12), m.gold, [0, 0.155, 0.187]);
  setting.scale.y = 1.2;
}

function buildClothing(rig: HumanoidRig, m: MaterialSet) {
  // Fitted midnight under-layer keeps the body shape readable instead of turning Seryn
  // into the rectangular armored silhouette used by Alden.
  contour(rig.torso, 'seryn-midnight-tunic', [
    [0.00, -0.535],
    [0.224, -0.53],
    [0.236, -0.34],
    [0.260, -0.16],
    [0.310, 0.04],
    [0.347, 0.22],
    [0.324, 0.39],
    [0.260, 0.49],
    [0.00, 0.51],
  ], 0.715, m.navy, 24);

  contour(rig.pelvis, 'seryn-midnight-hip-guard', [
    [0.00, -0.225],
    [0.205, -0.22],
    [0.303, -0.10],
    [0.325, 0.03],
    [0.294, 0.19],
    [0.00, 0.235],
  ], 0.78, m.navyDark, 22);

  // Segmented silver cuirass with open side channels and a cyan prism center.
  plate(rig.torso, 'seryn-cuirass-center', [
    [-0.135, 0.37], [0.135, 0.37], [0.190, 0.15], [0.135, -0.16],
    [0.075, -0.31], [-0.075, -0.31], [-0.135, -0.16], [-0.190, 0.15],
  ], 0.035, m.silver, 0.248, 0.014);
  const leftPlate = plate(rig.torso, 'seryn-cuirass-left', [
    [0.145, 0.33], [0.315, 0.25], [0.300, 0.03], [0.205, -0.13], [0.170, 0.10],
  ], 0.030, m.silverDark, 0.238, 0.012);
  leftPlate.rotation.y = -0.08;
  const rightPlate = plate(rig.torso, 'seryn-cuirass-right', [
    [-0.145, 0.33], [-0.315, 0.25], [-0.300, 0.03], [-0.205, -0.13], [-0.170, 0.10],
  ], 0.030, m.silverDark, 0.238, 0.012);
  rightPlate.rotation.y = 0.08;

  const prism = mesh(rig.torso, 'seryn-cuirass-prism', new THREE.OctahedronGeometry(0.105, 0), m.crystal, [0, 0.105, 0.335]);
  prism.scale.set(0.58, 1.45, 0.42);

  // Gold cartographic seams echo the horizon / meridian VFX language.
  for (const x of [-0.205, 0.205]) {
    const seam = mesh(rig.torso, 'seryn-cuirass-gold-seam', new THREE.BoxGeometry(0.018, 0.48, 0.018), m.gold, [x, 0.07, 0.292]);
    seam.rotation.z = x > 0 ? -0.18 : 0.18;
  }

  // Teal scarf around the neck and two short tails at the back.
  contour(rig.torso, 'seryn-scout-scarf', [
    [0.00, 0.38],
    [0.155, 0.39],
    [0.175, 0.49],
    [0.150, 0.60],
    [0.00, 0.61],
  ], 0.86, m.teal, 24);
  for (const side of [-1, 1]) {
    const tail = plate(rig.torso, 'seryn-scarf-tail', [
      [side * 0.025, 0.39],
      [side * 0.155, 0.30],
      [side * 0.125, -0.12],
      [side * 0.035, -0.23],
    ], 0.012, m.teal, -0.285, 0.006);
    tail.rotation.z = side * 0.05;
  }

  // Light shoulder guards hug the body rather than extending like knight pauldrons.
  for (const side of [-1, 1]) {
    const arm = side > 0 ? rig.leftArm : rig.rightArm;
    const guard = rounded(arm, 'seryn-shoulder-guard', [0.185, 0.080, 0.175], [0, -0.035, 0.010], m.silver, 18);
    guard.rotation.z = side * -0.16;
    guard.scale.z = 0.82;
    const accent = mesh(arm, 'seryn-shoulder-gold-fin', new THREE.ConeGeometry(0.045, 0.26, 4), m.gold, [side * 0.115, -0.03, 0.01]);
    accent.rotation.z = side * -Math.PI / 2;
  }

  for (const side of [-1, 1]) {
    const upperArm = side > 0 ? rig.leftArm : rig.rightArm;
    const forearm = side > 0 ? rig.leftForearm : rig.rightForearm;
    const thigh = side > 0 ? rig.leftLeg : rig.rightLeg;
    const shin = side > 0 ? rig.leftShin : rig.rightShin;
    const foot = side > 0 ? rig.leftFoot : rig.rightFoot;

    contour(upperArm, 'seryn-upper-arm-sleeve', [
      [0.00, -0.31], [0.072, -0.30], [0.085, -0.16], [0.084, -0.055], [0.00, -0.035],
    ], 0.95, m.navyDark, 18);

    contour(forearm, 'seryn-bracer', [
      [0.00, -0.37],
      [0.067, -0.36],
      [0.080, -0.22],
      [0.090, -0.08],
      [0.075, -0.045],
      [0.00, -0.035],
    ], 0.96, m.silver, 18);
    const bracerPrism = mesh(forearm, 'seryn-bracer-prism', new THREE.OctahedronGeometry(0.050, 0), m.crystal, [0, -0.19, 0.088]);
    bracerPrism.scale.set(0.55, 1.2, 0.36);

    contour(thigh, 'seryn-legging', [
      [0.00, -0.54], [0.082, -0.53], [0.112, -0.37], [0.132, -0.15], [0.122, -0.045], [0.00, 0],
    ], 0.94, m.navy, 20);

    contour(shin, 'seryn-greave', [
      [0.00, -0.445],
      [0.060, -0.44],
      [0.083, -0.30],
      [0.101, -0.15],
      [0.079, -0.045],
      [0.00, -0.025],
    ], 0.95, m.silver, 18);

    const knee = rounded(shin, 'seryn-knee-plate', [0.088, 0.070, 0.045], [0, -0.015, 0.075], m.silverDark, 16);
    knee.rotation.x = -0.15;

    rounded(foot, 'seryn-boot', [0.112, 0.085, 0.225], [0, -0.035, 0.077], m.navyDark, 18);
    const toe = rounded(foot, 'seryn-boot-silver-toe', [0.100, 0.045, 0.120], [0, -0.025, 0.165], m.silverDark, 16);
    toe.scale.y = 0.75;
  }

  // Belt and asymmetrical field-skirt panels.
  contour(rig.torso, 'seryn-waist-belt', [
    [0.00, -0.50], [0.245, -0.50], [0.260, -0.42], [0.245, -0.35], [0.00, -0.35],
  ], 0.80, m.leather, 24);
  const buckle = mesh(rig.torso, 'seryn-belt-prism', new THREE.OctahedronGeometry(0.095, 0), m.crystal, [0, -0.425, 0.300]);
  buckle.scale.set(0.75, 0.85, 0.40);
  const buckleFrame = mesh(rig.torso, 'seryn-belt-frame', new THREE.TorusGeometry(0.100, 0.014, 5, 16), m.gold, [0, -0.425, 0.288]);
  buckleFrame.scale.x = 1.22;

  for (const side of [-1, 1]) {
    const panel = plate(rig.pelvis, 'seryn-field-skirt-panel', [
      [side * 0.06, 0.04],
      [side * 0.285, -0.02],
      [side * 0.245, -0.52],
      [side * 0.10, -0.59],
    ], 0.018, side > 0 ? m.teal : m.navyDark, 0.08, 0.008);
    panel.rotation.y = side * -0.12;
  }
}

function buildBow(rig: HumanoidRig, m: MaterialSet) {
  const bow = new THREE.Group();
  bow.name = 'seryn-prism-longbow';

  const limbPointsUpper = [
    new THREE.Vector3(0, 0.02, 0),
    new THREE.Vector3(0.11, 0.28, 0.015),
    new THREE.Vector3(0.22, 0.58, 0.055),
    new THREE.Vector3(0.17, 0.84, 0.085),
    new THREE.Vector3(0.08, 1.06, 0.035),
  ];
  const limbPointsLower = limbPointsUpper.map(point => new THREE.Vector3(-point.x, -point.y, point.z));
  tube(bow, 'seryn-bow-upper', limbPointsUpper, 0.032, m.gold, 24);
  tube(bow, 'seryn-bow-lower', limbPointsLower, 0.032, m.gold, 24);

  const innerUpper = limbPointsUpper.map(point => new THREE.Vector3(point.x * 0.82, point.y * 0.96, point.z - 0.015));
  const innerLower = innerUpper.map(point => new THREE.Vector3(-point.x, -point.y, point.z));
  tube(bow, 'seryn-bow-upper-silver', innerUpper, 0.018, m.silverDark, 24);
  tube(bow, 'seryn-bow-lower-silver', innerLower, 0.018, m.silverDark, 24);

  const grip = rounded(bow, 'seryn-bow-grip', [0.055, 0.175, 0.050], [0, 0, 0], m.leather, 16);
  grip.rotation.z = -0.04;
  const centerPrism = mesh(bow, 'seryn-bow-center-prism', new THREE.OctahedronGeometry(0.095, 0), m.crystal, [0.045, 0.02, 0.035]);
  centerPrism.scale.set(0.65, 1.25, 0.48);

  for (const side of [-1, 1]) {
    const tip = mesh(bow, 'seryn-bow-tip-prism', new THREE.OctahedronGeometry(0.085, 0), m.crystal, [side * 0.08, side * 1.05, 0.04]);
    tip.scale.set(0.62, 1.55, 0.48);
  }

  const stringGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0.08, 1.06, 0.035),
    new THREE.Vector3(0, 0, -0.12),
    new THREE.Vector3(-0.08, -1.06, 0.035),
  ]);
  const bowString = new THREE.Line(
    stringGeometry,
    new THREE.LineBasicMaterial({ color: 0xb8f5ff, transparent: true, opacity: 0.92 }),
  );
  bowString.name = 'seryn-bow-energy-string';
  bow.add(bowString);

  // Keep the longbow vertical and slightly canted in her left hand.
  bow.position.set(0.02, -0.12, 0.03);
  bow.rotation.set(0.04, -0.06, -0.10);
  rig.sockets.leftHand.add(bow);

  return { bow, bowString };
}

function buildQuiver(rig: HumanoidRig, m: MaterialSet) {
  const quiver = new THREE.Group();
  quiver.name = 'seryn-quiver';

  const body = mesh(quiver, 'seryn-quiver-body', new THREE.CylinderGeometry(0.115, 0.145, 0.95, 14), m.leather);
  body.rotation.z = 0.12;
  const rim = mesh(quiver, 'seryn-quiver-rim', new THREE.TorusGeometry(0.122, 0.018, 6, 16), m.gold, [0, 0.475, 0]);
  rim.rotation.x = Math.PI / 2;

  for (let index = 0; index < 6; index++) {
    const arrow = new THREE.Group();
    arrow.name = 'seryn-quiver-arrow';
    const shaft = mesh(arrow, 'seryn-arrow-shaft', new THREE.CylinderGeometry(0.010, 0.010, 0.84, 7), m.silver);
    shaft.position.y = 0.38;
    const tip = mesh(arrow, 'seryn-arrow-prism', new THREE.ConeGeometry(0.036, 0.12, 5), m.crystal, [0, 0.84, 0]);
    const feather = mesh(arrow, 'seryn-arrow-fletching', new THREE.ConeGeometry(0.035, 0.12, 4), m.teal, [0, -0.06, 0]);
    feather.rotation.z = Math.PI;
    arrow.position.x = (index - 2.5) * 0.031;
    arrow.position.z = Math.abs(index - 2.5) * 0.012;
    quiver.add(arrow);
  }

  quiver.position.set(-0.25, 0.08, -0.13);
  quiver.rotation.set(0.08, -0.12, 0.34);
  rig.sockets.back.add(quiver);
  return quiver;
}

export function buildSeryn(): SerynRig {
  const rig = createHumanoidRig({
    name: 'H002',
    armRestAngle: 0.075,
  });
  const m = materials();

  buildFemaleBody(rig, m);
  buildFaceAndHair(rig, m);
  buildClothing(rig, m);
  const { bow, bowString } = buildBow(rig, m);
  const quiver = buildQuiver(rig, m);

  rig.root.userData.heroDefinitionId = 'H002';
  rig.root.userData.heroAttackStyle = 'ranged';
  rig.root.userData.serynModelRevision = 'female-prism-scout-v2';

  return Object.assign(rig, { bow, bowString, quiver });
}
