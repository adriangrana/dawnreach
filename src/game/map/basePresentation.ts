import * as THREE from 'three';
import { BASE_LAYOUT } from './mapLayout';

type BasePresentationMaterials = {
  stoneDark: THREE.Material;
  stoneLight: THREE.Material;
  stoneWarm: THREE.Material;
};

export function upgradeBasePresentation(
  battlefield: THREE.Group,
  team: 'blue' | 'red',
  center: { x: number; z: number },
) {
  const citadel = battlefield.getObjectByName(`${team}-base`) as THREE.Group | undefined;
  if (!citadel) return;

  const materials = createPresentationMaterials(team);

  // The authored citadel is meant to sit on an elevated plaza. Keep all of its
  // architecture together and lift it as a single unit so towers/walls/core remain aligned.
  citadel.position.y = BASE_LAYOUT.elevation;

  const elevation = buildBaseElevation(team, materials);
  elevation.position.set(center.x, 0, center.z);
  battlefield.add(elevation);

  replaceLegacyThroneCrystal(citadel, team, materials);
}

function createPresentationMaterials(team: 'blue' | 'red'): BasePresentationMaterials {
  const blue = team === 'blue';
  return {
    stoneDark: new THREE.MeshStandardMaterial({
      color: blue ? 0x46545d : 0x594849,
      roughness: 0.94,
      metalness: 0.02,
    }),
    stoneLight: new THREE.MeshStandardMaterial({
      color: blue ? 0xaeb9b4 : 0xb7aaa3,
      roughness: 0.86,
      metalness: 0.03,
    }),
    stoneWarm: new THREE.MeshStandardMaterial({
      color: blue ? 0x8f927f : 0x94877c,
      roughness: 0.9,
      metalness: 0.02,
    }),
  };
}

function buildBaseElevation(
  team: 'blue' | 'red',
  materials: BasePresentationMaterials,
) {
  const group = new THREE.Group();
  group.name = `${team}-base-elevation`;

  const rotation = team === 'blue' ? 0 : Math.PI;
  const gateAngles = BASE_LAYOUT.gates.map(angle => angle + rotation);
  const gateHalfAngle = BASE_LAYOUT.rampWidth / (BASE_LAYOUT.radius * 2) + 0.11;

  // Build the elevated retaining edge as individual sections and leave genuine openings
  // at every gate. A solid cylinder here intersected the ramps and visually swallowed the
  // hero's lower body while he crossed the base threshold.
  const wallRadius = BASE_LAYOUT.radius - 0.02;
  const wallThickness = 0.66;
  const wallSegments = 144;
  const segmentAngle = Math.PI * 2 / wallSegments;
  const segmentWidth = 2 * wallRadius * Math.sin(segmentAngle / 2) * 1.08;

  for (let index = 0; index < wallSegments; index++) {
    const angle = (index + 0.5) * segmentAngle;
    const blockedByGate = gateAngles.some(gate => angularDistance(angle, gate) < gateHalfAngle);
    if (blockedByGate) continue;

    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(segmentWidth, BASE_LAYOUT.elevation, wallThickness),
      materials.stoneDark,
    );
    wall.position.set(
      Math.cos(angle) * wallRadius,
      BASE_LAYOUT.elevation / 2,
      Math.sin(angle) * wallRadius,
    );
    wall.rotation.y = Math.PI / 2 - angle;
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);

    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(segmentWidth, 0.14, wallThickness + 0.14),
      materials.stoneLight,
    );
    cap.position.set(
      Math.cos(angle) * wallRadius,
      BASE_LAYOUT.elevation + 0.07,
      Math.sin(angle) * wallRadius,
    );
    cap.rotation.y = Math.PI / 2 - angle;
    cap.castShadow = true;
    cap.receiveShadow = true;
    group.add(cap);
  }

  const plaza = new THREE.Mesh(
    new THREE.CircleGeometry(BASE_LAYOUT.radius - 0.42, 128),
    materials.stoneWarm,
  );
  plaza.name = `${team}-base-plaza`;
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = BASE_LAYOUT.elevation + 0.018;
  plaza.userData.commandSurface = true;
  plaza.receiveShadow = true;
  group.add(plaza);

  const edgeMaterial = new THREE.MeshStandardMaterial({
    color: team === 'blue' ? 0x7398b2 : 0x9e706b,
    roughness: 0.78,
    metalness: 0.08,
  });

  for (const angle of gateAngles) {
    const ramp = new THREE.Mesh(createRampGeometry(angle), materials.stoneWarm);
    ramp.name = `${team}-base-ramp`;
    ramp.userData.commandSurface = true;
    ramp.castShadow = true;
    ramp.receiveShadow = true;
    group.add(ramp);

    for (const side of [-1, 1]) {
      const rail = createRampRail(angle, side, edgeMaterial);
      group.add(rail);
    }
  }

  return group;
}

function angularDistance(a: number, b: number) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

function createRampGeometry(angle: number) {
  // Push the ramp farther into the plaza and finish it slightly above the old citadel
  // perimeter trim. That legacy ring sits almost coplanar with the former ramp top and
  // showed up as the dark bar across the entrance. The overlap removes the seam while
  // keeping the walkable transition continuous.
  const innerRadius = BASE_LAYOUT.radius - 1.75;
  const outerRadius = BASE_LAYOUT.radius + BASE_LAYOUT.rampLength;
  const halfWidth = BASE_LAYOUT.rampWidth / 2;
  const high = BASE_LAYOUT.elevation + 0.12;
  const low = 0.045;
  const bottom = 0.015;
  const radialX = Math.cos(angle);
  const radialZ = Math.sin(angle);
  const tangentX = -radialZ;
  const tangentZ = radialX;

  const point = (radius: number, side: number, y: number) => [
    radialX * radius + tangentX * halfWidth * side,
    y,
    radialZ * radius + tangentZ * halfWidth * side,
  ] as const;

  const outerLeft = point(outerRadius, 1, low);
  const outerRight = point(outerRadius, -1, low);
  const innerLeft = point(innerRadius, 1, high);
  const innerRight = point(innerRadius, -1, high);
  const outerLeftBottom = point(outerRadius, 1, bottom);
  const outerRightBottom = point(outerRadius, -1, bottom);
  const innerLeftBottom = point(innerRadius, 1, bottom);
  const innerRightBottom = point(innerRadius, -1, bottom);

  const vertices = [
    ...outerLeft, ...outerRight, ...innerLeft, ...innerRight,
    ...outerLeftBottom, ...outerRightBottom, ...innerLeftBottom, ...innerRightBottom,
  ];

  const indices = [
    0, 1, 2, 1, 3, 2,
    4, 6, 5, 5, 6, 7,
    0, 2, 4, 4, 2, 6,
    1, 5, 3, 5, 7, 3,
    2, 3, 6, 3, 7, 6,
    0, 4, 1, 1, 4, 5,
  ];

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function createRampRail(angle: number, side: number, material: THREE.Material) {
  const innerRadius = BASE_LAYOUT.radius - 0.6;
  const outerRadius = BASE_LAYOUT.radius + BASE_LAYOUT.rampLength - 0.35;
  const halfWidth = BASE_LAYOUT.rampWidth / 2 + 0.14;
  const radialX = Math.cos(angle);
  const radialZ = Math.sin(angle);
  const tangentX = -radialZ;
  const tangentZ = radialX;

  const inner = new THREE.Vector3(
    radialX * innerRadius + tangentX * halfWidth * side,
    BASE_LAYOUT.elevation + 0.2,
    radialZ * innerRadius + tangentZ * halfWidth * side,
  );
  const outer = new THREE.Vector3(
    radialX * outerRadius + tangentX * halfWidth * side,
    0.2,
    radialZ * outerRadius + tangentZ * halfWidth * side,
  );
  const direction = new THREE.Vector3().subVectors(inner, outer);
  const length = direction.length();
  direction.normalize();

  const rail = new THREE.Mesh(new THREE.BoxGeometry(length, 0.18, 0.18), material);
  rail.position.copy(outer).add(inner).multiplyScalar(0.5);
  rail.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction);
  rail.castShadow = true;
  rail.receiveShadow = true;
  return rail;
}

function replaceLegacyThroneCrystal(
  citadel: THREE.Group,
  team: 'blue' | 'red',
  materials: BasePresentationMaterials,
) {
  for (const child of [...citadel.children]) {
    if (!(child instanceof THREE.Mesh)) continue;
    const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
    if (!childMaterials.some(material => material instanceof THREE.MeshPhysicalMaterial)) continue;
    citadel.remove(child);
    child.geometry.dispose();
  }

  const blue = team === 'blue';
  const throne = new THREE.Group();
  throne.name = `${team}-throne`;
  throne.userData.collisionRadius = 2.72;
  throne.userData.structureKind = 'throne';

  const metal = new THREE.MeshStandardMaterial({
    color: blue ? 0x344d63 : 0x633b3b,
    metalness: 0.5,
    roughness: 0.38,
  });
  const gold = new THREE.MeshStandardMaterial({
    color: blue ? 0xc8ae72 : 0xb99567,
    metalness: 0.62,
    roughness: 0.3,
  });
  const crystal = new THREE.MeshPhysicalMaterial({
    color: blue ? 0x55cfff : 0xff6658,
    emissive: blue ? 0x0876c9 : 0xb51f19,
    emissiveIntensity: 1.2,
    roughness: 0.12,
    metalness: 0.04,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    transparent: true,
    opacity: 0.97,
  });
  const innerGlow = new THREE.MeshBasicMaterial({
    color: blue ? 0xb9f4ff : 0xffc0a8,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    toneMapped: false,
  });

  const lower = new THREE.Mesh(new THREE.CylinderGeometry(2.55, 2.82, 0.28, 48), materials.stoneDark);
  lower.position.y = 0.28;
  lower.castShadow = true;
  lower.receiveShadow = true;
  throne.add(lower);

  const middle = new THREE.Mesh(new THREE.CylinderGeometry(2.22, 2.5, 0.28, 48), materials.stoneLight);
  middle.position.y = 0.52;
  middle.castShadow = true;
  middle.receiveShadow = true;
  throne.add(middle);

  const socket = new THREE.Mesh(new THREE.CylinderGeometry(1.42, 1.78, 0.58, 24), metal);
  socket.position.y = 0.91;
  socket.castShadow = true;
  socket.receiveShadow = true;
  throne.add(socket);

  const trimRing = new THREE.Mesh(new THREE.TorusGeometry(1.78, 0.11, 8, 48), gold);
  trimRing.rotation.x = Math.PI / 2;
  trimRing.position.y = 1.05;
  trimRing.castShadow = true;
  throne.add(trimRing);

  for (let arm = 0; arm < 4; arm++) {
    const angle = arm * Math.PI / 2 + Math.PI / 4;
    const brace = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.18, 0.28), gold);
    brace.position.set(Math.cos(angle) * 1.75, 0.64, Math.sin(angle) * 1.75);
    brace.rotation.y = -angle;
    brace.castShadow = true;
    throne.add(brace);

    const prong = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.2, 0.34), metal);
    prong.position.set(Math.cos(angle) * 1.38, 1.38, Math.sin(angle) * 1.38);
    prong.rotation.y = -angle;
    prong.rotation.z = arm % 2 === 0 ? 0.2 : -0.2;
    prong.castShadow = true;
    throne.add(prong);
  }

  const baseGem = new THREE.Mesh(new THREE.OctahedronGeometry(1.08, 0), crystal);
  baseGem.scale.set(0.94, 0.82, 0.94);
  baseGem.position.y = 1.55;
  baseGem.rotation.y = Math.PI / 4;
  baseGem.castShadow = true;
  throne.add(baseGem);

  const floatingPrism = new THREE.Group();
  floatingPrism.name = `${team}-throne-prism`;
  const prismBaseY = 5.05;
  const prismFloatAmplitude = 0.18;
  const prismFloatSpeed = 1.35;
  const prismRotationSpeed = blue ? 0.52 : -0.52;
  const prismPhase = blue ? 0 : Math.PI * 0.4;
  floatingPrism.position.y = prismBaseY;
  throne.add(floatingPrism);

  const spire = new THREE.Mesh(new THREE.ConeGeometry(1.02, 4.45, 6, 1, false), crystal);
  spire.rotation.y = Math.PI / 6;
  spire.castShadow = true;
  floatingPrism.add(spire);

  const glowSpire = new THREE.Mesh(new THREE.ConeGeometry(0.54, 3.7, 6, 1, false), innerGlow);
  glowSpire.position.y = -0.08;
  glowSpire.rotation.y = Math.PI / 6;
  floatingPrism.add(glowSpire);

  const light = new THREE.PointLight(blue ? 0x49c8ff : 0xff5148, 16, 9, 2);
  light.position.y = 0.12;
  floatingPrism.add(light);

  spire.onBeforeRender = () => {
    const time = performance.now() * 0.001;
    floatingPrism.position.y = prismBaseY + Math.sin(time * prismFloatSpeed + prismPhase) * prismFloatAmplitude;
    floatingPrism.rotation.y = time * prismRotationSpeed;
  };

  citadel.add(throne);
}
