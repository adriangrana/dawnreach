import * as THREE from 'three';
import { createHumanoidRig, type HumanoidRig } from '../../characters/humanoidRig';
import {
  createHairBladeGeometry,
  createPanelGeometry,
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
      { x: side * 0.355, y: 0.295, z: 0.000, ry: 0.091, rz: 0.084 },
    ], m.skin, 32);

    curve(rig.torso, 'seryn-clavicle-line', [
      new THREE.Vector3(side * 0.060, 0.410, 0.116),
      new THREE.Vector3(side * 0.145, 0.398, 0.120),
      new THREE.Vector3(side * 0.235, 0.366, 0.108),
      new THREE.Vector3(side * 0.315, 0.322, 0.076),
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

  // One sculpted head shell, not a sphere-plus-cheeks assembly.
  loft(rig.head, 'seryn-head', [
    { y: -0.205, rx: 0.052, rz: 0.086, front: 0.010 },
    { y: -0.165, rx: 0.094, rz: 0.113, front: 0.014 },
    { y: -0.105, rx: 0.126, rz: 0.139, front: 0.018 },
    { y: -0.015, rx: 0.151, rz: 0.154, front: 0.018 },
    { y: 0.075, rx: 0.160, rz: 0.158, front: 0.010 },
    { y: 0.155, rx: 0.145, rz: 0.148 },
    { y: 0.215, rx: 0.096, rz: 0.119 },
    { y: 0.242, rx: 0.030, rz: 0.047 },
  ], m.skin, 40);
}

function buildFace(rig: HumanoidRig, m: SerynMaterials) {
  for (const side of [-1, 1]) {
    // Recessed almond-shaped eyes. The white is nearly flush with the face instead of
    // being a separate eyeball floating in front of it.
    const socket = rounded(rig.head, 'seryn-eye-socket', [0.050, 0.021, 0.007], [side * 0.057, 0.045, 0.155], m.eyeDark, 18);
    socket.scale.z = 0.45;
    const sclera = rounded(rig.head, 'seryn-eye-white', [0.043, 0.0135, 0.0045], [side * 0.057, 0.044, 0.160], m.eyeWhite, 18);
    sclera.scale.z = 0.45;
    rounded(rig.head, 'seryn-iris', [0.010, 0.011, 0.003], [side * 0.057, 0.044, 0.164], m.iris, 14);
    rounded(rig.head, 'seryn-pupil', [0.0045, 0.0065, 0.002], [side * 0.057, 0.044, 0.167], m.eyeDark, 10);

    const brow = curve(rig.head, 'seryn-brow', [
      new THREE.Vector3(side * 0.100, 0.085, 0.154),
      new THREE.Vector3(side * 0.063, 0.094, 0.160),
      new THREE.Vector3(side * 0.025, 0.088, 0.157),
    ], 0.006, m.hairShadow, 0.004, 10);
    brow.scale.z = 0.7;

    const upperLash = curve(rig.head, 'seryn-upper-lash', [
      new THREE.Vector3(side * 0.096, 0.057, 0.163),
      new THREE.Vector3(side * 0.058, 0.061, 0.167),
      new THREE.Vector3(side * 0.020, 0.057, 0.163),
    ], 0.003, m.eyeDark, 0.002, 9);
    upperLash.scale.z = 0.6;

    const ear = part(
      rig.head,
      'seryn-pointed-ear',
      new THREE.ConeGeometry(0.040, 0.165, 6),
      m.skin,
      [side * 0.174, 0.035, -0.004],
    );
    ear.rotation.z = side * -Math.PI / 2;
    ear.rotation.y = side * -0.05;
    ear.scale.z = 0.42;
  }

  // Nose bridge + tip + nostril shadow gives profile depth without a cone stuck to the face.
  curve(rig.head, 'seryn-nose-bridge', [
    new THREE.Vector3(0, 0.074, 0.145),
    new THREE.Vector3(0, 0.030, 0.160),
    new THREE.Vector3(0, -0.018, 0.173),
  ], 0.014, m.skinShadow, 0.010, 10);
  rounded(rig.head, 'seryn-nose-tip', [0.024, 0.018, 0.018], [0, -0.025, 0.168], m.skin, 16);
  for (const side of [-1, 1]) {
    rounded(rig.head, 'seryn-nostril', [0.006, 0.003, 0.002], [side * 0.013, -0.032, 0.178], m.eyeDark, 8);
  }

  const upperLip = curve(rig.head, 'seryn-upper-lip', [
    new THREE.Vector3(-0.039, -0.078, 0.153),
    new THREE.Vector3(0, -0.071, 0.160),
    new THREE.Vector3(0.039, -0.078, 0.153),
  ], 0.006, m.lips, 0.004, 12);
  upperLip.scale.z = 0.55;
  const lowerLip = curve(rig.head, 'seryn-lower-lip', [
    new THREE.Vector3(-0.034, -0.087, 0.153),
    new THREE.Vector3(0, -0.094, 0.159),
    new THREE.Vector3(0.034, -0.087, 0.153),
  ], 0.0065, m.lips, 0.004, 12);
  lowerLip.scale.z = 0.55;

  // Subtle jaw/chin highlight breaks the flat front plane.
  rounded(rig.head, 'seryn-chin-plane', [0.052, 0.026, 0.010], [0, -0.147, 0.121], m.skinShadow, 16);
}

function buildHair(rig: HumanoidRig, m: SerynMaterials) {
  // Scalp mass follows the skull and intentionally stops above the eyes. Layered blades
  // and tapered locks hide the lower edge so it never reads as a helmet.
  loft(rig.head, 'seryn-hair-scalp', [
    { y: -0.005, rx: 0.157, rz: 0.151, cz: -0.022, back: 0.018 },
    { y: 0.085, rx: 0.171, rz: 0.164, cz: -0.020 },
    { y: 0.165, rx: 0.151, rz: 0.150, cz: -0.018 },
    { y: 0.225, rx: 0.098, rz: 0.118, cz: -0.014 },
    { y: 0.250, rx: 0.026, rz: 0.042, cz: -0.010 },
  ], m.hair, 36);

  const fringe = [
    { x: -0.120, y: 0.064, z: 0.135, w: 0.080, l: 0.205, r: -0.16, mat: m.hairShadow },
    { x: -0.053, y: 0.075, z: 0.148, w: 0.074, l: 0.170, r: -0.08, mat: m.hair },
    { x: 0.020, y: 0.080, z: 0.150, w: 0.070, l: 0.150, r: 0.04, mat: m.hair },
    { x: 0.086, y: 0.067, z: 0.140, w: 0.075, l: 0.185, r: 0.13, mat: m.hairShadow },
  ];
  for (const lock of fringe) {
    const blade = part(
      rig.head,
      'seryn-fringe-lock',
      createHairBladeGeometry(lock.w, lock.l, 0.022, 6),
      lock.mat,
      [lock.x, lock.y, lock.z],
    );
    blade.rotation.z = lock.r;
    blade.rotation.x = -0.04;
  }

  for (const side of [-1, 1]) {
    const temple = part(
      rig.head,
      'seryn-temple-hair',
      createHairBladeGeometry(0.075, 0.43, 0.055, 8),
      side > 0 ? m.hair : m.hairShadow,
      [side * 0.138, 0.055, 0.060],
    );
    temple.rotation.z = side * -0.05;
    temple.rotation.y = side * -0.18;

    curve(rig.head, 'seryn-side-hair-volume', [
      new THREE.Vector3(side * 0.140, 0.080, -0.055),
      new THREE.Vector3(side * 0.155, -0.070, -0.060),
      new THREE.Vector3(side * 0.145, -0.240, -0.055),
      new THREE.Vector3(side * 0.115, -0.390, -0.035),
    ], 0.035, side > 0 ? m.hairShadow : m.hair, 0.014, 22);
  }

  const backLocks = [
    [-0.115, -0.075, 0.54, 0.044, m.hairShadow],
    [-0.058, -0.092, 0.60, 0.048, m.hair],
    [0.000, -0.100, 0.64, 0.050, m.hairShadow],
    [0.060, -0.092, 0.59, 0.047, m.hair],
    [0.115, -0.075, 0.53, 0.043, m.hairShadow],
  ] as const;
  for (const [x, z, length, radius, material] of backLocks) {
    curve(rig.head, 'seryn-back-hair-lock', [
      new THREE.Vector3(x, 0.105, z),
      new THREE.Vector3(x * 1.08, -0.090, z - 0.008),
      new THREE.Vector3(x * 0.96, -0.300, z + 0.010),
      new THREE.Vector3(x * 0.72, 0.105 - length, z + 0.035),
    ], radius, material, 0.010, 28);
  }

  const jewel = part(rig.head, 'seryn-forehead-prism', new THREE.OctahedronGeometry(0.034, 0), m.crystal, [0, 0.128, 0.165]);
  jewel.scale.set(0.55, 1.22, 0.42);
  const setting = part(rig.head, 'seryn-forehead-setting', new THREE.TorusGeometry(0.035, 0.006, 5, 16), m.gold, [0, 0.128, 0.156]);
  setting.scale.y = 1.2;
}

function buildClothing(rig: HumanoidRig, m: SerynMaterials) {
  // Opaque fitted underlayer with enough clearance to avoid z-fighting against the body.
  loft(rig.torso, 'seryn-underlayer-torso', [
    { y: -0.556, rx: 0.176, rz: 0.130 },
    { y: -0.42, rx: 0.188, rz: 0.136 },
    { y: -0.26, rx: 0.207, rz: 0.147 },
    { y: -0.08, rx: 0.237, rz: 0.158 },
    { y: 0.08, rx: 0.275, rz: 0.171, front: 0.034 },
    { y: 0.21, rx: 0.294, rz: 0.180, front: 0.048 },
    { y: 0.31, rx: 0.285, rz: 0.168, front: 0.028 },
    { y: 0.39, rx: 0.238, rz: 0.150, front: 0.015 },
    { y: 0.47, rx: 0.157, rz: 0.108 },
    { y: 0.515, rx: 0.104, rz: 0.082 },
  ], m.navy, 36);

  loft(rig.pelvis, 'seryn-underlayer-hips', [
    { y: -0.235, rx: 0.166, rz: 0.136 },
    { y: -0.16, rx: 0.235, rz: 0.170 },
    { y: -0.04, rx: 0.300, rz: 0.197, back: 0.030 },
    { y: 0.09, rx: 0.307, rz: 0.193, back: 0.026 },
    { y: 0.215, rx: 0.219, rz: 0.151 },
  ], m.navyDark, 34);

  // Layered cuirass follows the bust instead of obscuring it with one slab.
  const sternum = panel(rig.torso, 'seryn-sternum-plate', [
    [-0.070, 0.270], [0.070, 0.270], [0.105, 0.105], [0.072, -0.160],
    [0.000, -0.270], [-0.072, -0.160], [-0.105, 0.105],
  ], m.silver, [0, 0.105, 0.192], 0.022, 0.009);
  sternum.scale.z = 0.72;

  for (const side of [-1, 1]) {
    const chestPlate = panel(rig.torso, 'seryn-breastplate-wing', [
      [0.00, 0.225], [side * 0.145, 0.190], [side * 0.185, 0.075],
      [side * 0.158, -0.075], [side * 0.085, -0.135], [side * 0.018, 0.020],
    ], m.silverDark, [side * 0.085, 0.105, 0.170], 0.018, 0.008);
    chestPlate.rotation.y = side * -0.13;
    chestPlate.rotation.z = side * -0.035;

    curve(rig.torso, 'seryn-gold-cuirass-seam', [
      new THREE.Vector3(side * 0.075, 0.285, 0.214),
      new THREE.Vector3(side * 0.120, 0.090, 0.224),
      new THREE.Vector3(side * 0.095, -0.160, 0.205),
    ], 0.009, m.gold, 0.007, 15);
  }

  const prism = part(rig.torso, 'seryn-chest-prism', new THREE.OctahedronGeometry(0.060, 0), m.crystal, [0, 0.095, 0.226]);
  prism.scale.set(0.55, 1.35, 0.40);

  // Teal field scarf: cowl plus layered back tails.
  loft(rig.torso, 'seryn-scarf-cowl', [
    { y: 0.395, rx: 0.185, rz: 0.126 },
    { y: 0.485, rx: 0.195, rz: 0.132 },
    { y: 0.575, rx: 0.152, rz: 0.108 },
  ], m.teal, 28);

  for (const side of [-1, 1]) {
    const tail = part(
      rig.torso,
      'seryn-scarf-tail',
      createHairBladeGeometry(0.125, 0.48, 0.075, 7),
      m.teal,
      [side * 0.075, 0.405, -0.145],
    );
    tail.rotation.y = side * 0.10;
    tail.rotation.z = side * 0.025;
  }

  // Arm/leg equipment uses multiple layers, analogous to the drake's overlapping scutes.
  for (const side of [-1, 1]) {
    const arm = side > 0 ? rig.leftArm : rig.rightArm;
    const forearm = side > 0 ? rig.leftForearm : rig.rightForearm;
    const thigh = side > 0 ? rig.leftLeg : rig.rightLeg;
    const shin = side > 0 ? rig.leftShin : rig.rightShin;
    const foot = side > 0 ? rig.leftFoot : rig.rightFoot;

    // Sleeve starts inside the anatomical shoulder. No pauldron is used here yet:
    // the base body must read correctly before armor is layered over it.
    loft(arm, 'seryn-upper-sleeve', [
      { y: 0.035, rx: 0.098, rz: 0.090 },
      { y: -0.045, rx: 0.101, rz: 0.092 },
      { y: -0.135, rx: 0.090, rz: 0.081 },
      { y: -0.225, rx: 0.080, rz: 0.071 },
      { y: -0.310, rx: 0.070, rz: 0.063 },
    ], m.navyDark, 28, true, false);

    loft(forearm, 'seryn-bracer-base', [
      { y: -0.045, rx: 0.065, rz: 0.060 },
      { y: -0.14, rx: 0.071, rz: 0.064 },
      { y: -0.31, rx: 0.057, rz: 0.052 },
      { y: -0.385, rx: 0.048, rz: 0.045 },
    ], m.silverDark, 24);
    for (let band = 0; band < 3; band++) {
      const bandY = -0.115 - band * 0.090;
      const bandMesh = part(
        forearm,
        'seryn-bracer-band',
        new THREE.TorusGeometry(0.063 - band * 0.004, 0.006, 5, 20),
        band === 1 ? m.gold : m.silver,
        [0, bandY, 0],
      );
      bandMesh.rotation.x = Math.PI / 2;
    }
    const bracerPrism = part(forearm, 'seryn-bracer-prism', new THREE.OctahedronGeometry(0.033, 0), m.crystal, [0, -0.220, 0.060]);
    bracerPrism.scale.set(0.48, 1.15, 0.32);

    loft(thigh, 'seryn-leggings', [
      { y: -0.020, rx: 0.114, rz: 0.110 },
      { y: -0.17, rx: 0.121, rz: 0.113 },
      { y: -0.39, rx: 0.096, rz: 0.090 },
      { y: -0.58, rx: 0.072, rz: 0.068 },
    ], m.navy, 26);

    loft(shin, 'seryn-greave-base', [
      { y: -0.015, rx: 0.069, rz: 0.063 },
      { y: -0.14, rx: 0.083, rz: 0.075 },
      { y: -0.32, rx: 0.072, rz: 0.066 },
      { y: -0.485, rx: 0.052, rz: 0.049 },
    ], m.silverDark, 24);
    const shinPlate = panel(shin, 'seryn-greave-face', [
      [-0.044, 0.170], [0.044, 0.170], [0.055, 0.000],
      [0.030, -0.175], [0, -0.220], [-0.030, -0.175], [-0.055, 0.000],
    ], m.silver, [0, -0.245, 0.068], 0.014, 0.005);
    shinPlate.scale.y = 0.90;
    const shinPrism = part(shin, 'seryn-greave-prism', new THREE.OctahedronGeometry(0.027, 0), m.crystal, [0, -0.235, 0.082]);
    shinPrism.scale.set(0.45, 1.05, 0.30);

    rounded(foot, 'seryn-boot-upper', [0.087, 0.064, 0.182], [0, -0.030, 0.076], m.navyDark, 20);
    rounded(foot, 'seryn-boot-toe', [0.080, 0.038, 0.110], [0, -0.018, 0.150], m.silverDark, 18);
    const sole = rounded(foot, 'seryn-boot-sole', [0.084, 0.020, 0.190], [0, -0.092, 0.073], m.leather, 18);
    sole.scale.y = 0.75;
  }

  // Belt, pouches and asymmetric layered field cloth.
  loft(rig.torso, 'seryn-belt-core', [
    { y: -0.515, rx: 0.185, rz: 0.135 },
    { y: -0.465, rx: 0.195, rz: 0.142 },
    { y: -0.405, rx: 0.188, rz: 0.136 },
  ], m.leather, 26);
  const buckle = part(rig.torso, 'seryn-belt-prism', new THREE.OctahedronGeometry(0.055, 0), m.crystal, [0, -0.465, 0.154]);
  buckle.scale.set(0.72, 0.92, 0.36);
  const frame = part(rig.torso, 'seryn-belt-frame', new THREE.TorusGeometry(0.064, 0.008, 5, 18), m.gold, [0, -0.465, 0.148]);
  frame.scale.x = 1.18;

  for (const side of [-1, 1]) {
    const hipPanel = part(
      rig.pelvis,
      'seryn-field-cloth',
      createHairBladeGeometry(0.165, 0.50, 0.075, 7),
      side > 0 ? m.teal : m.navyDark,
      [side * 0.205, -0.050, 0.050],
    );
    hipPanel.rotation.y = side * -0.28;
    hipPanel.rotation.z = side * 0.05;

    const pouch = rounded(
      rig.pelvis,
      'seryn-belt-pouch',
      [0.070, 0.090, 0.040],
      [side * 0.205, -0.120, -0.135],
      m.leather,
      14,
    );
    pouch.rotation.y = side * 0.15;
  }
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
  buildHair(rig, materials);
  buildClothing(rig, materials);
  const { bow, bowString } = buildBow(rig, materials);
  const quiver = buildQuiver(rig, materials);
  configureSoles(rig);

  rig.root.userData.heroDefinitionId = 'H002';
  rig.root.userData.heroAttackStyle = 'ranged';
  rig.root.userData.serynModelRevision = 'horizon-scout-v7-anatomical-shoulder-bridge';

  return Object.assign(rig, { bow, bowString, quiver });
}
