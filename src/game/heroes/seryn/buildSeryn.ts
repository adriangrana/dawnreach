import * as THREE from 'three';
import { createHumanoidRig, type HumanoidRig } from '../../characters/humanoidRig';
import { createTaperedCurveGeometry } from './geometry';
import { createSerynMaterials, type SerynMaterials } from './materials';
import { buildSerynAppearance, decorateSerynBow } from './appearance';

export type SerynRig = HumanoidRig & {
  bow: THREE.Group;
  bowString: THREE.Line;
  bowStringUpperAnchor: THREE.Vector3;
  bowStringLowerAnchor: THREE.Vector3;
  bowStringRestNock: THREE.Vector3;
  bowRestPosition: THREE.Vector3;
  bowRestRotation: THREE.Euler;
  arrowLaunchSocket: THREE.Group;
  handArrow: THREE.Group;
  nockedArrow: THREE.Group;
  projectileArrowPrototype: THREE.Group;
  quiver: THREE.Group;
  quiverArrows: THREE.Group[];
  hair: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  clothMeshes: THREE.Mesh[];
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

function configureSkeleton(rig: HumanoidRig) {
  // Heroic female proportions: long legs, narrow ribcage/shoulders and a wider pelvis.
  rig.pelvis.position.y = 1.31;
  rig.torso.position.y = 1.88;
  // The MakeHuman CC0 portrait includes the cervical column in the same anatomical
  // mesh as the head. Seat that neck substantially inside the shoulder/collar volume
  // instead of balancing the skull on the full visible neck length. This shortens the
  // apparent neck without scaling/distorting the authored head topology.
  rig.head.position.y = 0.64;
  // The anatomical skull's cervical axis sits behind its geometric centre.
  // Align that axis with the torso, rather than bending the neck back to the collar.
  rig.head.position.z = 0.065;

  rig.leftLeg.position.x = 0.12;
  rig.rightLeg.position.x = -0.12;
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

function createSerynArrow(m: SerynMaterials, name = 'seryn-arrow') {
  const arrow = new THREE.Group();
  arrow.name = name;

  const shaft = part(
    arrow,
    `${name}-shaft`,
    new THREE.CylinderGeometry(0.0065, 0.0065, 0.64, 10),
    m.silver,
    [0, 0.21, 0],
  );
  shaft.castShadow = true;

  const head = part(
    arrow,
    `${name}-head`,
    new THREE.ConeGeometry(0.017, 0.087, 4),
    m.silver,
    [0, 0.57, 0],
  );
  head.castShadow = true;

  const fletching = part(
    arrow,
    `${name}-fletching`,
    new THREE.ConeGeometry(0.027, 0.105, 4),
    m.teal,
    [0, -0.075, 0],
  );
  fletching.rotation.z = Math.PI;
  fletching.castShadow = true;

  return arrow;
}

function buildBow(rig: HumanoidRig, m: SerynMaterials) {
  const bow = new THREE.Group();
  bow.name = 'seryn-celestial-recurve-longbow';

  // A single coherent recurve silhouette: rigid sculpted riser in the middle, limbs
  // swelling away from the grip, then curling back toward the string at the tips.
  // Everything remains in one XY plane so it reads as an actual bow from every angle.
  // True recurve geometry: the grip/riser sits well behind the string plane, the
  // working limbs bow farther away from the string, and only the final third sweeps
  // aggressively back toward the tips. The large brace offset is intentional: when the
  // weapon is carried horizontally the tips must remain visibly above/below the grip
  // line instead of collapsing into the old moustache-like silhouette.
  const tipX = 0.405;
  const tipY = 1.165;
  const upper = [
    new THREE.Vector3(-0.030, 0.245, 0),
    new THREE.Vector3(-0.105, 0.355, 0),
    new THREE.Vector3(-0.172, 0.515, 0),
    new THREE.Vector3(-0.198, 0.675, 0),
    new THREE.Vector3(-0.165, 0.815, 0),
    new THREE.Vector3(-0.070, 0.945, 0),
    new THREE.Vector3(0.095, 1.055, 0),
    new THREE.Vector3(0.255, 1.125, 0),
    new THREE.Vector3(tipX, tipY, 0),
  ];
  const lower = upper.map(point => new THREE.Vector3(point.x, -point.y, point.z));

  // Gold outer rails carry the main silhouette. Silver and blue inner rails give the
  // layered forged/enamel construction seen in Seryn's concept bow.
  curve(bow, 'seryn-bow-upper-outer-rail', upper, 0.027, m.gold, 0.011, 42);
  curve(bow, 'seryn-bow-lower-outer-rail', lower, 0.027, m.gold, 0.011, 42);

  const upperSilver = upper.map((p, index) =>
    new THREE.Vector3(p.x * 0.86 - 0.014 + index * 0.0015, p.y * 0.992, -0.017));
  const lowerSilver = lower.map((p, index) =>
    new THREE.Vector3(p.x * 0.86 - 0.014 + index * 0.0015, p.y * 0.992, -0.017));
  curve(bow, 'seryn-bow-upper-silver-spine', upperSilver, 0.015, m.silver, 0.0065, 42);
  curve(bow, 'seryn-bow-lower-silver-spine', lowerSilver, 0.015, m.silver, 0.0065, 42);

  const upperBlue = upper.slice(0, -1).map((p, index) =>
    new THREE.Vector3(p.x * 0.70 - 0.022, p.y * 0.985, 0.012 + index * 0.001));
  const lowerBlue = lower.slice(0, -1).map((p, index) =>
    new THREE.Vector3(p.x * 0.70 - 0.022, p.y * 0.985, 0.012 + index * 0.001));
  curve(bow, 'seryn-bow-upper-blue-core', upperBlue, 0.0115, m.bowBlue, 0.004, 34);
  curve(bow, 'seryn-bow-lower-blue-core', lowerBlue, 0.0115, m.bowBlue, 0.004, 34);

  // Sculpted riser. The limbs no longer converge into a floating capsule: these four
  // rails make a rigid bridge from the lower limb through the grip to the upper limb.
  const upperRiser = [
    new THREE.Vector3(-0.044, 0.035, 0),
    new THREE.Vector3(-0.058, 0.105, 0),
    new THREE.Vector3(-0.052, 0.180, 0),
    new THREE.Vector3(-0.025, 0.245, 0),
  ];
  const lowerRiser = upperRiser.map(point => new THREE.Vector3(point.x, -point.y, point.z));
  curve(bow, 'seryn-bow-upper-riser-gold', upperRiser, 0.031, m.gold, 0.020, 28);
  curve(bow, 'seryn-bow-lower-riser-gold', lowerRiser, 0.031, m.gold, 0.020, 28);
  curve(
    bow,
    'seryn-bow-upper-riser-silver',
    upperRiser.map(p => new THREE.Vector3(p.x - 0.004, p.y, 0.018)),
    0.017,
    m.silverDark,
    0.010,
    28,
  );
  curve(
    bow,
    'seryn-bow-lower-riser-silver',
    lowerRiser.map(p => new THREE.Vector3(p.x - 0.004, p.y, 0.018)),
    0.017,
    m.silverDark,
    0.010,
    28,
  );

  // Deep-blue wrapped grip with gold collars/lacing, integrated into the riser.
  rounded(bow, 'seryn-bow-grip', [0.056, 0.158, 0.050], [-0.052, 0, 0], m.bowBlue, 30);
  for (const y of [-0.126, -0.063, 0, 0.063, 0.126]) {
    const ring = part(
      bow,
      'seryn-bow-grip-band',
      new THREE.TorusGeometry(0.056, 0.0045, 6, 24),
      m.gold,
      [-0.052, y, 0],
    );
    ring.rotation.x = Math.PI / 2;
    ring.scale.z = 0.88;
  }
  for (const side of [-1, 1]) {
    curve(
      bow,
      'seryn-bow-grip-lacing',
      [
        new THREE.Vector3(-0.088, side * 0.118, 0.047),
        new THREE.Vector3(-0.020, side * 0.055, 0.052),
        new THREE.Vector3(-0.086, side * 0.006, 0.047),
      ],
      0.0035,
      m.gold,
      0.0022,
      18,
    );
  }

  // Forged tip housings make the limbs terminate as designed points instead of ending
  // in a bare tube. The crystal sits inside the gold spear cap.
  for (const side of [-1, 1]) {
    const cap = part(
      bow,
      'seryn-bow-tip-housing',
      new THREE.ConeGeometry(0.052, 0.155, 5),
      m.gold,
      [tipX, side * 1.138, 0],
    );
    cap.rotation.z = side > 0 ? 0 : Math.PI;
    cap.scale.z = 0.72;

    const tipCrystal = part(
      bow,
      'seryn-bow-tip-crystal',
      new THREE.OctahedronGeometry(0.038, 0),
      m.crystal,
      [tipX, side * 1.142, 0.018],
    );
    tipCrystal.scale.set(0.54, 1.22, 0.34);
  }

  // The string is physically anchored to the two blue tip crystals. At rest the
  // middle vertex is exactly collinear with those anchors, so there is no artificial
  // kink: visually it is one taut segment from blue point to blue point. During draw,
  // animateSeryn moves only the middle nocking point toward the archer.
  const bowStringUpperAnchor = new THREE.Vector3(tipX, 1.142, 0.018);
  const bowStringLowerAnchor = new THREE.Vector3(tipX, -1.142, 0.018);
  const bowStringRestNock = new THREE.Vector3(tipX, 0, 0.018);
  const stringGeometry = new THREE.BufferGeometry().setFromPoints([
    bowStringUpperAnchor.clone(),
    bowStringRestNock.clone(),
    bowStringLowerAnchor.clone(),
  ]);
  const bowString = new THREE.Line(
    stringGeometry,
    new THREE.LineBasicMaterial({ color: 0xc7f6ff, transparent: true, opacity: 0.96 }),
  );
  bowString.name = 'seryn-bow-energy-string';
  bow.add(bowString);

  decorateSerynBow(bow, m);

  // The projectile detaches just in front of the nocking line. The gameplay runtime
  // then aims the world projectile at its actual target.
  const arrowLaunchSocket = new THREE.Group();
  arrowLaunchSocket.name = 'seryn-arrow-launch-socket';
  arrowLaunchSocket.position.copy(bowStringRestNock).add(new THREE.Vector3(0, 0, 0.085));
  bow.add(arrowLaunchSocket);

  const nockedArrow = createSerynArrow(m, 'seryn-nocked-arrow');
  // Arrow geometry is authored along +Y; rotate it so it points through bow-local +Z,
  // which is the target direction in the attack pose.
  nockedArrow.rotation.x = Math.PI / 2;
  nockedArrow.position.copy(bowStringRestNock);
  nockedArrow.visible = false;
  bow.add(nockedArrow);

  // Existing authored carry orientation is preserved; the weapon was redesigned in
  // local bow space so idle/walk/attack animation code does not need to be retuned.
  bow.position.set(0.012, -0.075, 0.040);
  bow.rotation.set(
    THREE.MathUtils.degToRad(8.5),
    0,
    -Math.PI / 2,
  );
  rig.sockets.leftHand.add(bow);

  return {
    bow,
    bowString,
    bowStringUpperAnchor,
    bowStringLowerAnchor,
    bowStringRestNock,
    bowRestPosition: bow.position.clone(),
    bowRestRotation: bow.rotation.clone(),
    arrowLaunchSocket,
    nockedArrow,
  };
}

function buildQuiver(rig: HumanoidRig, m: SerynMaterials) {
  const quiver = new THREE.Group();
  quiver.name = 'seryn-quiver';

  const body = part(quiver, 'seryn-quiver-body', new THREE.CylinderGeometry(0.075, 0.095, 0.72, 16), m.leather);
  body.rotation.z = 0.10;
  const rim = part(quiver, 'seryn-quiver-rim', new THREE.TorusGeometry(0.086, 0.012, 6, 18), m.gold, [0, 0.36, 0]);
  rim.rotation.x = Math.PI / 2;

  const arrows: THREE.Group[] = [];
  for (let index = 0; index < 5; index++) {
    const arrow = createSerynArrow(m, `seryn-quiver-arrow-${index}`);
    arrow.scale.setScalar(0.96);
    arrow.position.x = (index - 2) * 0.023;
    arrow.position.y = 0.025 + Math.abs(index - 2) * 0.012;
    arrow.position.z = Math.abs(index - 2) * 0.009;
    quiver.add(arrow);
    arrows.push(arrow);
  }

  quiver.position.set(-0.225, 0.015, -0.120);
  quiver.rotation.set(0.06, -0.08, 0.31);
  rig.sockets.back.add(quiver);
  return { quiver, arrows };
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

  const { hair, clothMeshes } = buildSerynAppearance(rig, materials);
  const {
    bow,
    bowString,
    bowStringUpperAnchor,
    bowStringLowerAnchor,
    bowStringRestNock,
    bowRestPosition,
    bowRestRotation,
    arrowLaunchSocket,
    nockedArrow,
  } = buildBow(rig, materials);
  const { quiver, arrows: quiverArrows } = buildQuiver(rig, materials);

  const handArrow = createSerynArrow(materials, 'seryn-hand-arrow');
  handArrow.visible = false;
  handArrow.rotation.set(0.12, 0.16, -0.42);
  handArrow.position.set(-0.018, -0.018, 0.010);
  rig.sockets.rightHand.add(handArrow);

  // Unattached prototype used by the world runtime when a basic attack is released.
  // Clones share the authored geometry/materials and become independent world objects.
  const projectileArrowPrototype = createSerynArrow(materials, 'seryn-basic-attack-arrow');
  projectileArrowPrototype.visible = false;

  configureSoles(rig);

  rig.root.userData.heroDefinitionId = 'H002';
  rig.root.userData.heroAttackStyle = 'ranged';
  rig.root.userData.serynModelRevision = 'horizon-scout-v30-anchored-string-archery';

  return Object.assign(rig, {
    bow,
    bowString,
    bowStringUpperAnchor,
    bowStringLowerAnchor,
    bowStringRestNock,
    bowRestPosition,
    bowRestRotation,
    arrowLaunchSocket,
    handArrow,
    nockedArrow,
    projectileArrowPrototype,
    quiver,
    quiverArrows,
    hair,
    clothMeshes,
  });
}
