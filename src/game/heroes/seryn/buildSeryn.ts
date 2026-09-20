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
  dark: THREE.MeshStandardMaterial;
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

type RingSection = Readonly<{
  y: number;
  rx: number;
  rz: number;
  front?: number;
  back?: number;
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
    skin: standard(0xb97863, 0, 0.9),
    skinWarm: standard(0xa96053, 0, 0.92),
    hair: standard(0xb9c2cd, 0.03, 0.62),
    hairShadow: standard(0x768391, 0.03, 0.70),
    eyeWhite: standard(0xd9e0e4, 0, 0.62),
    iris: standard(0x4dc9ea, 0.02, 0.36, 0x0c5773, 0.18),
    dark: standard(0x1e252c, 0, 0.88),
    lips: standard(0x7d3f43, 0, 0.86),
    navy: standard(0x173455, 0.08, 0.72),
    navyDark: standard(0x09182a, 0.10, 0.78),
    teal: standard(0x2f6970, 0.06, 0.76),
    silver: standard(0x9eacb8, 0.62, 0.34),
    silverDark: standard(0x5a6875, 0.58, 0.40),
    gold: standard(0xb78f4c, 0.68, 0.34),
    leather: standard(0x2a2020, 0.05, 0.90),
    crystal: standard(0x55d3f2, 0.24, 0.24, 0x126b8a, 0.30),
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
  const geometry = new THREE.SphereGeometry(1, segments, Math.max(10, Math.floor(segments * 0.68)));
  geometry.scale(...size);
  return mesh(parent, name, geometry, material, position);
}

function ringGeometry(sections: readonly RingSection[], segments = 24) {
  const vertices: number[] = [];
  const indices: number[] = [];

  for (const section of sections) {
    for (let index = 0; index < segments; index++) {
      const angle = index / segments * Math.PI * 2;
      const sx = Math.sin(angle);
      const cz = Math.cos(angle);
      const front = Math.max(0, cz);
      const back = Math.max(0, -cz);
      const x = sx * section.rx;
      const z = cz * section.rz
        + (section.front ?? 0) * front * front
        - (section.back ?? 0) * back * back;
      vertices.push(x, section.y, z);
    }
  }

  for (let ring = 0; ring < sections.length - 1; ring++) {
    for (let index = 0; index < segments; index++) {
      const next = (index + 1) % segments;
      const a = ring * segments + index;
      const b = ring * segments + next;
      const c = (ring + 1) * segments + next;
      const d = (ring + 1) * segments + index;
      indices.push(a, d, c, a, c, b);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function tube(
  parent: THREE.Object3D,
  name: string,
  points: THREE.Vector3[],
  radius: number,
  material: THREE.Material,
  tubularSegments = 18,
) {
  return mesh(
    parent,
    name,
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), tubularSegments, radius, 7, false),
    material,
  );
}

function makeFacePlate(
  parent: THREE.Object3D,
  name: string,
  size: [number, number, number],
  position: [number, number, number],
  material: THREE.Material,
) {
  const part = rounded(parent, name, size, position, material, 18);
  part.scale.z = 0.45;
  return part;
}

function buildFemaleAnatomy(rig: HumanoidRig, m: MaterialSet) {
  // Re-proportion the shared skeleton itself, rather than hiding the generic proportions
  // below armor. This gives Seryn longer legs, a narrower ribcage and a lighter shoulder line.
  rig.pelvis.position.y = 1.34;
  rig.torso.position.y = 1.92;
  rig.head.position.y = 0.77;

  rig.leftLeg.position.x = 0.175;
  rig.rightLeg.position.x = -0.175;
  rig.leftShin.position.y = -0.61;
  rig.rightShin.position.y = -0.61;
  rig.leftFoot.position.y = -0.535;
  rig.rightFoot.position.y = -0.535;

  rig.leftArm.position.set(0.385, 0.29, 0);
  rig.rightArm.position.set(-0.385, 0.29, 0);
  rig.leftForearm.position.y = -0.455;
  rig.rightForearm.position.y = -0.455;
  rig.sockets.leftHand.position.y = -0.43;
  rig.sockets.rightHand.position.y = -0.43;

  mesh(rig.pelvis, 'seryn-anatomy-pelvis', ringGeometry([
    { y: -0.22, rx: 0.17, rz: 0.13 },
    { y: -0.13, rx: 0.25, rz: 0.17, back: 0.018 },
    { y: 0.02, rx: 0.285, rz: 0.18, back: 0.020 },
    { y: 0.16, rx: 0.255, rz: 0.155 },
    { y: 0.23, rx: 0.18, rz: 0.125 },
  ]), m.skin);

  mesh(rig.torso, 'seryn-anatomy-torso', ringGeometry([
    { y: -0.54, rx: 0.175, rz: 0.12 },
    { y: -0.40, rx: 0.190, rz: 0.13 },
    { y: -0.20, rx: 0.215, rz: 0.145 },
    { y: 0.00, rx: 0.245, rz: 0.155, front: 0.026 },
    { y: 0.17, rx: 0.282, rz: 0.165, front: 0.040 },
    { y: 0.34, rx: 0.268, rz: 0.150, front: 0.018 },
    { y: 0.48, rx: 0.205, rz: 0.120 },
  ]), m.skin);

  mesh(rig.torso, 'seryn-anatomy-neck', ringGeometry([
    { y: 0.43, rx: 0.072, rz: 0.066 },
    { y: 0.58, rx: 0.077, rz: 0.070 },
    { y: 0.72, rx: 0.071, rz: 0.066 },
  ], 18), m.skin);

  for (const side of [-1, 1]) {
    const upperArm = side > 0 ? rig.leftArm : rig.rightArm;
    const forearm = side > 0 ? rig.leftForearm : rig.rightForearm;
    const hand = side > 0 ? rig.sockets.leftHand : rig.sockets.rightHand;
    const thigh = side > 0 ? rig.leftLeg : rig.rightLeg;
    const shin = side > 0 ? rig.leftShin : rig.rightShin;
    const foot = side > 0 ? rig.leftFoot : rig.rightFoot;

    mesh(upperArm, 'seryn-anatomy-upper-arm', ringGeometry([
      { y: 0.00, rx: 0.075, rz: 0.068 },
      { y: -0.13, rx: 0.082, rz: 0.072 },
      { y: -0.31, rx: 0.068, rz: 0.061 },
      { y: -0.44, rx: 0.055, rz: 0.052 },
    ], 18), m.skin);

    rounded(forearm, 'seryn-anatomy-elbow', [0.058, 0.060, 0.055], [0, 0, 0], m.skin, 16);
    mesh(forearm, 'seryn-anatomy-forearm', ringGeometry([
      { y: -0.01, rx: 0.057, rz: 0.054 },
      { y: -0.13, rx: 0.066, rz: 0.058 },
      { y: -0.29, rx: 0.053, rz: 0.049 },
      { y: -0.41, rx: 0.044, rz: 0.043 },
    ], 18), m.skin);

    rounded(hand, 'seryn-anatomy-hand', [0.048, 0.095, 0.052], [0, -0.030, 0.012], m.skin, 18);

    mesh(thigh, 'seryn-anatomy-thigh', ringGeometry([
      { y: -0.01, rx: 0.110, rz: 0.105 },
      { y: -0.16, rx: 0.118, rz: 0.108 },
      { y: -0.36, rx: 0.094, rz: 0.086 },
      { y: -0.58, rx: 0.070, rz: 0.066 },
    ], 20), m.skin);

    rounded(shin, 'seryn-anatomy-knee', [0.064, 0.062, 0.060], [0, 0, 0], m.skin, 16);
    mesh(shin, 'seryn-anatomy-calf', ringGeometry([
      { y: -0.01, rx: 0.062, rz: 0.058 },
      { y: -0.14, rx: 0.076, rz: 0.070 },
      { y: -0.31, rx: 0.067, rz: 0.062 },
      { y: -0.50, rx: 0.047, rz: 0.045 },
    ], 18), m.skin);

    rounded(foot, 'seryn-anatomy-foot', [0.082, 0.060, 0.178], [0, -0.030, 0.075], m.skin, 18);
  }

  // Head is a single low-poly facial volume with a tapered jaw. Avoid separate cheek blobs:
  // those were the main reason the previous version read as a porcelain doll.
  mesh(rig.head, 'seryn-head', ringGeometry([
    { y: -0.205, rx: 0.058, rz: 0.100, front: 0.012 },
    { y: -0.155, rx: 0.112, rz: 0.132, front: 0.010 },
    { y: -0.070, rx: 0.150, rz: 0.158, front: 0.012 },
    { y: 0.040, rx: 0.168, rz: 0.165, front: 0.010 },
    { y: 0.135, rx: 0.156, rz: 0.155 },
    { y: 0.205, rx: 0.102, rz: 0.128 },
    { y: 0.235, rx: 0.032, rz: 0.052 },
  ], 28), m.skin);
}

function buildFaceAndHair(rig: HumanoidRig, m: MaterialSet) {
  for (const side of [-1, 1]) {
    makeFacePlate(rig.head, 'seryn-eye-sclera', [0.047, 0.018, 0.014], [side * 0.061, 0.044, 0.160], m.eyeWhite);
    rounded(rig.head, 'seryn-eye-iris', [0.013, 0.013, 0.007], [side * 0.061, 0.044, 0.171], m.iris, 14);
    rounded(rig.head, 'seryn-eye-pupil', [0.0055, 0.007, 0.004], [side * 0.061, 0.044, 0.177], m.dark, 10);
    const brow = mesh(
      rig.head,
      'seryn-eyebrow',
      new THREE.BoxGeometry(0.060, 0.007, 0.007),
      m.hairShadow,
      [side * 0.060, 0.084, 0.161],
    );
    brow.rotation.z = side * -0.08;
  }

  const nose = mesh(rig.head, 'seryn-nose', new THREE.ConeGeometry(0.018, 0.060, 5), m.skinWarm, [0, 0.000, 0.170]);
  nose.rotation.x = Math.PI / 2;
  nose.scale.set(0.72, 1, 0.72);

  makeFacePlate(rig.head, 'seryn-upper-lip', [0.038, 0.007, 0.009], [0, -0.076, 0.157], m.lips);
  makeFacePlate(rig.head, 'seryn-lower-lip', [0.034, 0.008, 0.009], [0, -0.089, 0.155], m.lips);

  for (const side of [-1, 1]) {
    const ear = mesh(
      rig.head,
      'seryn-pointed-ear',
      new THREE.ConeGeometry(0.045, 0.155, 5),
      m.skin,
      [side * 0.184, 0.036, 0.000],
    );
    ear.rotation.z = side * -Math.PI / 2;
    ear.scale.z = 0.45;
  }

  const cap = mesh(
    rig.head,
    'seryn-hair-cap',
    new THREE.SphereGeometry(1, 28, 16, 0, Math.PI * 2, 0, Math.PI * 0.45),
    m.hair,
    [0, 0.070, -0.010],
  );
  cap.scale.set(0.176, 0.190, 0.170);

  // Angular layered locks read as game-character hair, not as tubes or a porcelain helmet.
  for (const side of [-1, 1]) {
    const frontLock = mesh(
      rig.head,
      'seryn-front-hair-lock',
      new THREE.ConeGeometry(0.033, 0.33, 5),
      side > 0 ? m.hair : m.hairShadow,
      [side * 0.115, -0.030, 0.100],
    );
    frontLock.rotation.z = side * -0.10;
    frontLock.scale.z = 0.75;

    const templeLock = mesh(
      rig.head,
      'seryn-temple-hair-lock',
      new THREE.ConeGeometry(0.042, 0.42, 6),
      m.hair,
      [side * 0.145, -0.090, -0.015],
    );
    templeLock.rotation.z = side * -0.07;
    templeLock.scale.z = 0.78;
  }

  for (const [x, z, length, shade] of [
    [-0.085, -0.105, 0.48, m.hairShadow],
    [0.000, -0.120, 0.52, m.hair],
    [0.085, -0.105, 0.46, m.hairShadow],
  ] as const) {
    const lock = mesh(
      rig.head,
      'seryn-back-hair-lock',
      new THREE.ConeGeometry(0.048, length, 6),
      shade,
      [x, -0.145, z],
    );
    lock.scale.z = 0.82;
  }

  const jewel = mesh(rig.head, 'seryn-forehead-prism', new THREE.OctahedronGeometry(0.035, 0), m.crystal, [0, 0.137, 0.164]);
  jewel.scale.set(0.56, 1.18, 0.42);
  const setting = mesh(rig.head, 'seryn-forehead-setting', new THREE.TorusGeometry(0.035, 0.006, 5, 14), m.gold, [0, 0.137, 0.155]);
  setting.scale.y = 1.16;
}

function buildOutfit(rig: HumanoidRig, m: MaterialSet) {
  // Fitted scout base layer. It follows the anatomy instead of replacing it with a box.
  mesh(rig.torso, 'seryn-base-top', ringGeometry([
    { y: -0.545, rx: 0.184, rz: 0.126 },
    { y: -0.39, rx: 0.201, rz: 0.136 },
    { y: -0.19, rx: 0.229, rz: 0.152 },
    { y: 0.00, rx: 0.258, rz: 0.164, front: 0.024 },
    { y: 0.17, rx: 0.293, rz: 0.174, front: 0.037 },
    { y: 0.33, rx: 0.280, rz: 0.159, front: 0.015 },
    { y: 0.43, rx: 0.215, rz: 0.127 },
  ]), m.navy);

  mesh(rig.pelvis, 'seryn-base-leggings-hip', ringGeometry([
    { y: -0.225, rx: 0.178, rz: 0.136 },
    { y: -0.13, rx: 0.259, rz: 0.176 },
    { y: 0.02, rx: 0.294, rz: 0.188 },
    { y: 0.16, rx: 0.264, rz: 0.163 },
    { y: 0.225, rx: 0.187, rz: 0.132 },
  ]), m.navyDark);

  // Small flexible cuirass sections rather than one giant grey slab.
  const chestCenter = mesh(
    rig.torso,
    'seryn-cuirass-center',
    new THREE.OctahedronGeometry(0.145, 0),
    m.silver,
    [0, 0.105, 0.225],
  );
  chestCenter.scale.set(0.70, 1.55, 0.22);

  for (const side of [-1, 1]) {
    const sidePlate = rounded(
      rig.torso,
      'seryn-cuirass-side',
      [0.115, 0.165, 0.035],
      [side * 0.145, 0.110, 0.205],
      m.silverDark,
      18,
    );
    sidePlate.rotation.z = side * -0.14;
    sidePlate.scale.z = 0.58;
  }

  const prism = mesh(rig.torso, 'seryn-chest-prism', new THREE.OctahedronGeometry(0.065, 0), m.crystal, [0, 0.105, 0.286]);
  prism.scale.set(0.56, 1.35, 0.38);

  const collar = mesh(rig.torso, 'seryn-teal-collar', ringGeometry([
    { y: 0.40, rx: 0.176, rz: 0.110 },
    { y: 0.48, rx: 0.185, rz: 0.118 },
    { y: 0.57, rx: 0.154, rz: 0.105 },
  ], 20), m.teal);
  collar.scale.z = 1.04;

  for (const side of [-1, 1]) {
    const arm = side > 0 ? rig.leftArm : rig.rightArm;
    const guard = rounded(
      arm,
      'seryn-light-pauldron',
      [0.135, 0.055, 0.125],
      [0, -0.025, 0],
      m.silver,
      18,
    );
    guard.rotation.z = side * -0.15;
    guard.scale.z = 0.78;

    const forearm = side > 0 ? rig.leftForearm : rig.rightForearm;
    mesh(forearm, 'seryn-bracer', ringGeometry([
      { y: -0.045, rx: 0.068, rz: 0.060 },
      { y: -0.12, rx: 0.074, rz: 0.064 },
      { y: -0.28, rx: 0.062, rz: 0.055 },
      { y: -0.37, rx: 0.050, rz: 0.047 },
    ], 18), m.silver);
    const bracerPrism = mesh(forearm, 'seryn-bracer-prism', new THREE.OctahedronGeometry(0.035, 0), m.crystal, [0, -0.205, 0.060]);
    bracerPrism.scale.set(0.50, 1.15, 0.33);

    const thigh = side > 0 ? rig.leftLeg : rig.rightLeg;
    mesh(thigh, 'seryn-legging', ringGeometry([
      { y: -0.015, rx: 0.116, rz: 0.109 },
      { y: -0.16, rx: 0.123, rz: 0.112 },
      { y: -0.36, rx: 0.099, rz: 0.091 },
      { y: -0.57, rx: 0.074, rz: 0.070 },
    ], 20), m.navy);

    const shin = side > 0 ? rig.leftShin : rig.rightShin;
    mesh(shin, 'seryn-greave', ringGeometry([
      { y: -0.015, rx: 0.068, rz: 0.062 },
      { y: -0.14, rx: 0.082, rz: 0.074 },
      { y: -0.31, rx: 0.071, rz: 0.066 },
      { y: -0.48, rx: 0.052, rz: 0.049 },
    ], 18), m.silver);

    const foot = side > 0 ? rig.leftFoot : rig.rightFoot;
    rounded(foot, 'seryn-boot', [0.090, 0.066, 0.188], [0, -0.035, 0.075], m.navyDark, 18);
    const toe = rounded(foot, 'seryn-boot-toe', [0.080, 0.037, 0.100], [0, -0.020, 0.152], m.silverDark, 16);
    toe.scale.y = 0.72;
  }

  mesh(rig.torso, 'seryn-belt', ringGeometry([
    { y: -0.505, rx: 0.187, rz: 0.132 },
    { y: -0.455, rx: 0.194, rz: 0.138 },
    { y: -0.405, rx: 0.188, rz: 0.133 },
  ], 20), m.leather);

  const buckle = mesh(rig.torso, 'seryn-belt-prism', new THREE.OctahedronGeometry(0.060, 0), m.crystal, [0, -0.455, 0.154]);
  buckle.scale.set(0.72, 0.92, 0.36);
  const buckleFrame = mesh(rig.torso, 'seryn-belt-frame', new THREE.TorusGeometry(0.067, 0.009, 5, 16), m.gold, [0, -0.455, 0.147]);
  buckleFrame.scale.x = 1.18;

  for (const side of [-1, 1]) {
    const panel = mesh(
      rig.pelvis,
      'seryn-hip-cloth',
      new THREE.PlaneGeometry(0.145, 0.46, 1, 5),
      side > 0 ? m.teal : m.navyDark,
      [side * 0.205, -0.245, 0.020],
    );
    panel.rotation.y = side * -0.20;
    panel.rotation.z = side * 0.06;
    (panel.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  }
}

function buildBow(rig: HumanoidRig, m: MaterialSet) {
  const bow = new THREE.Group();
  bow.name = 'seryn-prism-longbow';

  const upper = [
    new THREE.Vector3(0, 0.02, 0),
    new THREE.Vector3(0.08, 0.28, 0.012),
    new THREE.Vector3(0.17, 0.57, 0.045),
    new THREE.Vector3(0.14, 0.82, 0.070),
    new THREE.Vector3(0.07, 1.02, 0.028),
  ];
  const lower = upper.map(point => new THREE.Vector3(-point.x, -point.y, point.z));
  tube(bow, 'seryn-bow-upper', upper, 0.027, m.gold, 22);
  tube(bow, 'seryn-bow-lower', lower, 0.027, m.gold, 22);

  const upperInner = upper.map(point => new THREE.Vector3(point.x * 0.80, point.y * 0.96, point.z - 0.012));
  const lowerInner = upperInner.map(point => new THREE.Vector3(-point.x, -point.y, point.z));
  tube(bow, 'seryn-bow-upper-inner', upperInner, 0.014, m.silverDark, 22);
  tube(bow, 'seryn-bow-lower-inner', lowerInner, 0.014, m.silverDark, 22);

  rounded(bow, 'seryn-bow-grip', [0.043, 0.150, 0.044], [0, 0, 0], m.leather, 16);
  const centerPrism = mesh(bow, 'seryn-bow-center-prism', new THREE.OctahedronGeometry(0.068, 0), m.crystal, [0.035, 0.015, 0.030]);
  centerPrism.scale.set(0.58, 1.18, 0.44);

  for (const side of [-1, 1]) {
    const tip = mesh(bow, 'seryn-bow-tip-prism', new THREE.OctahedronGeometry(0.060, 0), m.crystal, [side * 0.07, side * 1.015, 0.032]);
    tip.scale.set(0.56, 1.42, 0.46);
  }

  const stringGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0.07, 1.02, 0.028),
    new THREE.Vector3(0, 0, -0.10),
    new THREE.Vector3(-0.07, -1.02, 0.028),
  ]);
  const bowString = new THREE.Line(
    stringGeometry,
    new THREE.LineBasicMaterial({ color: 0xaeeeff, transparent: true, opacity: 0.88 }),
  );
  bowString.name = 'seryn-bow-energy-string';
  bow.add(bowString);

  bow.position.set(0.012, -0.105, 0.025);
  bow.rotation.set(0.02, -0.05, -0.08);
  rig.sockets.leftHand.add(bow);

  return { bow, bowString };
}

function buildQuiver(rig: HumanoidRig, m: MaterialSet) {
  const quiver = new THREE.Group();
  quiver.name = 'seryn-quiver';

  const body = mesh(
    quiver,
    'seryn-quiver-body',
    new THREE.CylinderGeometry(0.082, 0.102, 0.74, 14),
    m.leather,
  );
  body.rotation.z = 0.10;

  const rim = mesh(
    quiver,
    'seryn-quiver-rim',
    new THREE.TorusGeometry(0.090, 0.013, 6, 16),
    m.gold,
    [0, 0.372, 0],
  );
  rim.rotation.x = Math.PI / 2;

  for (let index = 0; index < 5; index++) {
    const arrow = new THREE.Group();
    arrow.name = 'seryn-quiver-arrow';
    const shaft = mesh(
      arrow,
      'seryn-arrow-shaft',
      new THREE.CylinderGeometry(0.008, 0.008, 0.70, 7),
      m.silver,
    );
    shaft.position.y = 0.30;
    mesh(arrow, 'seryn-arrow-prism', new THREE.ConeGeometry(0.027, 0.095, 5), m.crystal, [0, 0.695, 0]);
    arrow.position.x = (index - 2) * 0.025;
    arrow.position.z = Math.abs(index - 2) * 0.010;
    quiver.add(arrow);
  }

  quiver.position.set(-0.235, 0.02, -0.115);
  quiver.rotation.set(0.06, -0.08, 0.31);
  rig.sockets.back.add(quiver);
  return quiver;
}

export function buildSeryn(): SerynRig {
  const rig = createHumanoidRig({
    name: 'H002',
    armRestAngle: 0.055,
  });
  const m = materials();

  buildFemaleAnatomy(rig, m);
  buildFaceAndHair(rig, m);
  buildOutfit(rig, m);
  const { bow, bowString } = buildBow(rig, m);
  const quiver = buildQuiver(rig, m);

  rig.root.userData.heroDefinitionId = 'H002';
  rig.root.userData.heroAttackStyle = 'ranged';
  rig.root.userData.serynModelRevision = 'female-horizon-v3';

  return Object.assign(rig, { bow, bowString, quiver });
}
