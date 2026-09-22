import * as THREE from 'three';
import { createHumanoidRig, type HumanoidRig } from '../../characters/humanoidRig';
import { createTaperedCurveGeometry } from './geometry';
import { createSerynMaterials, type SerynMaterials } from './materials';
import { buildSerynAppearance, decorateSerynBow } from './appearance';

export type SerynRig = HumanoidRig & {
  bow: THREE.Group;
  bowString: THREE.Line;
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
  bow.name = 'seryn-prism-longbow';

  // Keep the entire recurved frame in one geometric plane. The previous lower limb
  // mirrored X as well as Y and the Z offsets changed along the limb, producing an
  // unintended S/twist when viewed from the front.
  const upper = [
    new THREE.Vector3(0.000, 0.020, 0),
    new THREE.Vector3(0.088, 0.255, 0),
    new THREE.Vector3(0.154, 0.525, 0),
    new THREE.Vector3(0.128, 0.790, 0),
    new THREE.Vector3(0.046, 1.020, 0),
  ];
  const lower = upper.map(point => new THREE.Vector3(point.x, -point.y, 0));

  curve(bow, 'seryn-bow-upper-gold', upper, 0.024, m.gold, 0.015, 32);
  curve(bow, 'seryn-bow-lower-gold', lower, 0.024, m.gold, 0.015, 32);

  // Parallel inner spine adds depth without torsion: it stays in a plane parallel to
  // the main frame instead of wandering through Z.
  const upperSpine = upper.map(p => new THREE.Vector3(p.x * 0.84 - 0.004, p.y * 0.985, -0.014));
  const lowerSpine = lower.map(p => new THREE.Vector3(p.x * 0.84 - 0.004, p.y * 0.985, -0.014));
  curve(bow, 'seryn-bow-upper-spine', upperSpine, 0.013, m.silverDark, 0.008, 32);
  curve(bow, 'seryn-bow-lower-spine', lowerSpine, 0.013, m.silverDark, 0.008, 32);

  rounded(bow, 'seryn-bow-grip', [0.042, 0.145, 0.043], [0, 0, 0], m.leather, 20);

  for (const side of [-1, 1]) {
    const gem = part(
      bow,
      'seryn-bow-tip-prism',
      new THREE.OctahedronGeometry(0.056, 0),
      m.crystal,
      [0.046, side * 1.020, 0],
    );
    gem.scale.set(0.54, 1.40, 0.44);
  }

  const centerGem = part(
    bow,
    'seryn-bow-center-prism',
    new THREE.OctahedronGeometry(0.065, 0),
    m.crystal,
    [0.025, 0.010, 0.032],
  );
  centerGem.scale.set(0.58, 1.16, 0.42);

  // The bow limbs run on local Y. During the attack pose the bow is counter-rotated
  // against the raised arm so local Y stays world-up, while local +Z becomes the firing
  // direction. The string therefore draws backward on local -Z, not sideways on X.
  const stringGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0.046, 1.020, 0),
    new THREE.Vector3(0.046, 0, -0.105),
    new THREE.Vector3(0.046, -1.020, 0),
  ]);
  const bowString = new THREE.Line(
    stringGeometry,
    new THREE.LineBasicMaterial({ color: 0xbaf4ff, transparent: true, opacity: 0.90 }),
  );
  bowString.name = 'seryn-bow-energy-string';
  bow.add(bowString);
  decorateSerynBow(bow, m);

  const arrowLaunchSocket = new THREE.Group();
  arrowLaunchSocket.name = 'seryn-arrow-launch-socket';
  arrowLaunchSocket.position.set(0.046, 0, 0.045);
  bow.add(arrowLaunchSocket);

  const nockedArrow = createSerynArrow(m, 'seryn-nocked-arrow');
  // Arrow geometry points along local +Y. Rotate it onto bow-local +Z, which is the
  // character's forward firing axis once the attack pose is applied.
  nockedArrow.rotation.x = Math.PI / 2;
  nockedArrow.position.set(0.046, 0, -0.105);
  nockedArrow.visible = false;
  bow.add(nockedArrow);

  // Idle carry pose: Seryn holds the grip naturally at hip height while the longbow
  // rests across the front of her body. Rotating around the grip keeps the hand contact
  // intact: the former upper limb moves down/right and the lower limb rises left, giving
  // the relaxed horizontal carry shown in the model reference. Attack animation still
  // takes full control of the bow and raises it into the firing orientation.
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
  rig.root.userData.serynModelRevision = 'horizon-scout-v25-arm-driven-bow-carry';

  return Object.assign(rig, {
    bow,
    bowString,
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
