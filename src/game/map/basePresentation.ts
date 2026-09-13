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

  const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(
      BASE_LAYOUT.radius - 0.18,
      BASE_LAYOUT.radius + 0.55,
      BASE_LAYOUT.elevation,
      128,
    ),
    materials.stoneDark,
  );
  platform.position.y = BASE_LAYOUT.elevation / 2;
  platform.castShadow = true;
  platform.receiveShadow = true;
  group.add(platform);

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

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(BASE_LAYOUT.radius - 0.65, 0.11, 8, 128),
    materials.stoneLight,
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = BASE_LAYOUT.elevation + 0.085;
  rim.castShadow = true;
  group.add(rim);

  const rotation = team === 'blue' ? 0 : Math.PI;
  const edgeMaterial = new THREE.MeshStandardMaterial({
    color: team === 'blue' ? 0x7398b2 : 0x9e706b,
    roughness: 0.78,
    metalness: 0.08,
  });

  for (const authoredGate of BASE_LAYOUT.gates) {
    const angle = authoredGate + rotation;
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

function createRampGeometry(angle: number) {
  const innerRadius = BASE_LAYOUT.radius - 1.15;
  const outerRadius = BASE_LAYOUT.radius + BASE_LAYOUT.rampLength;
  const halfWidth = BASE_LAYOUT.rampWidth / 2;
  const high = BASE_LAYOUT.elevation + 0.025;
  const low = 0.035;
  const bottom = 0.02;
  const radialX = Math.cos(angle);
  const radialZ = Math.sin(angle);
  const tangentX = -radialZ;
  const tangentZ = radialX;

  const point = (radius: number, side: number, y: number) => [
    radialX * radius + tangentX * halfWidth * side,
    y,
    radialZ * radius + tangentZ * halfWidth * side,
  ] as const;

  const innerLeft = point(innerRadius, 1, high);
  const innerRight = point(innerRadius, -1, high);
  const outerLeft = point(outerRadius, 1, low);
  const outerRight = point(outerRadius, -1, low);
  const innerLeftBottom = point(innerRadius, 1, bottom);
  const innerRightBottom = point(innerRadius, -1, bottom);
  const outerLeftBottom = point(outerRadius, 1, bottom);
  const outerRightBottom = point(outerRadius, -1, bottom);

  const vertices = [
    ...outerLeft, ...outerRight, ...innerLeft, ...innerRight,
    ...outerLeftBottom, ...outerRightBottom, ...innerLeftBottom, ...innerRightBottom,
  ];
  const indices = [
    0, 2, 1, 1, 2, 3,
    4, 5, 6, 5, 7, 6,
    0, 4, 2, 4, 6, 2,
    1, 3, 5, 5, 3, 7,
    2, 6, 3, 6, 7, 3,
    0, 1, 4, 1, 5, 4,
  ];

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createRampRail(angle: number, side: number, material: THREE.Material) {
  const innerRadius = BASE_LAYOUT.radius - 0.6;
  const outerRadius = BASE_LAYOUT.radius + BASE_LAYOUT.rampLength - 0.35;
  const middleRadius = (innerRadius + outerRadius) / 2;
  const run = outerRadius - innerRadius;
  const halfWidth = BASE_LAYOUT.rampWidth / 2 + 0.14;
  const radialX = Math.cos(angle);
  const radialZ = Math.sin(angle);
  const tangentX = -radialZ;
  const tangentZ = radialX;
  const slope = Math.atan2(BASE_LAYOUT.elevation, run);

  const rail = new THREE.Mesh(new THREE.BoxGeometry(run, 0.18, 0.18), material);
  rail.position.set(
    radialX * middleRadius + tangentX * halfWidth * side,
    BASE_LAYOUT.elevation / 2 + 0.18,
    radialZ * middleRadius + tangentZ * halfWidth * side,
  );
  rail.rotation.order = 'YXZ';
  rail.rotation.y = -angle;
  // Both rails follow the same ramp plane. Side only offsets them laterally.
  rail.rotation.z = -slope;
  rail.castShadow = true;
  rail.receiveShadow = true;
  return rail;
}

function replaceLegacyThroneCrystal(
  citadel: THREE.Group,
  team: 'blue' | 'red',
  materials: BasePresentationMaterials,
) {
  // The old core crystal and its five satellite diamonds were merged into the single
  // MeshPhysicalMaterial child. Remove only that legacy crystal mesh; keep the authored
  // plaza, metallic supports and surrounding defensive architecture.
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

  const spire = new THREE.Mesh(new THREE.ConeGeometry(1.02, 4.45, 6, 1, false), crystal);
  spire.position.y = 3.5;
  spire.rotation.y = Math.PI / 6;
  spire.castShadow = true;
  throne.add(spire);

  const glowSpire = new THREE.Mesh(new THREE.ConeGeometry(0.54, 3.7, 6, 1, false), innerGlow);
  glowSpire.position.y = 3.38;
  glowSpire.rotation.y = Math.PI / 6;
  throne.add(glowSpire);

  const light = new THREE.PointLight(blue ? 0x49c8ff : 0xff5148, 16, 9, 2);
  light.position.y = 3.5;
  throne.add(light);

  citadel.add(throne);
}
