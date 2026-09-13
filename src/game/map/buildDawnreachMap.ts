import * as THREE from 'three';
import type { DawnreachTextures } from '../shared/textures';
import { DAWNREACH_LAYOUT, type MapPoint } from './mapLayout';

const TREE_VISUAL_SCALE = 1.32;
const BASE_VISUAL_SCALE = 1.08;

export function buildDawnreachMap(textures: DawnreachTextures) {
  const world = new THREE.Group();
  world.name = 'dawnreach-map';

  const materials = createMapMaterials(textures);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(DAWNREACH_LAYOUT.width, DAWNREACH_LAYOUT.height),
    materials.ground,
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  world.add(ground);

  buildRiver(world, materials);

  let laneIndex = 0;
  for (const points of Object.values(DAWNREACH_LAYOUT.lanes)) {
    buildLane(world, points, materials, laneIndex++);
  }

  world.add(buildBase('blue', DAWNREACH_LAYOUT.blueBase.x, DAWNREACH_LAYOUT.blueBase.z, materials));
  world.add(buildBase('red', DAWNREACH_LAYOUT.redBase.x, DAWNREACH_LAYOUT.redBase.z, materials));

  for (let index = 0; index < DAWNREACH_LAYOUT.jungleClusters.length; index += 1) {
    const [x, z, scale] = DAWNREACH_LAYOUT.jungleClusters[index];
    world.add(buildForestCluster(x, z, scale, index, materials));
  }

  for (const pit of DAWNREACH_LAYOUT.objectivePits) {
    world.add(buildObjectivePit(pit.x, pit.z, pit.kind, materials));
  }

  addMapEdgeCliffs(world, materials);
  return world;
}

function createMapMaterials(textures: DawnreachTextures) {
  const foliage = [
    new THREE.MeshStandardMaterial({ color: 0x1f3f2b, roughness: 0.98 }),
    new THREE.MeshStandardMaterial({ color: 0x2b5133, roughness: 0.98 }),
    new THREE.MeshStandardMaterial({ color: 0x355f3c, roughness: 0.98 }),
    new THREE.MeshStandardMaterial({ color: 0x244932, roughness: 0.98 }),
  ];

  return {
    ground: new THREE.MeshStandardMaterial({ map: textures.grass, color: 0xe4eadc, roughness: 1 }),
    lane: new THREE.MeshStandardMaterial({ map: textures.lane, color: 0xd7d1bd, roughness: 0.99 }),
    laneShoulder: new THREE.MeshStandardMaterial({ color: 0x4c4d3d, roughness: 1 }),
    riverBank: new THREE.MeshStandardMaterial({ color: 0x425048, roughness: 1 }),
    water: new THREE.MeshPhysicalMaterial({
      color: 0x1c5a6d,
      roughness: 0.18,
      metalness: 0.03,
      clearcoat: 0.55,
      clearcoatRoughness: 0.22,
      transparent: true,
      opacity: 0.9,
    }),
    waterShimmer: new THREE.MeshBasicMaterial({
      color: 0x72aeba,
      transparent: true,
      opacity: 0.11,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    stone: new THREE.MeshStandardMaterial({ color: 0x59605a, roughness: 0.96, metalness: 0.01 }),
    stoneDark: new THREE.MeshStandardMaterial({ color: 0x353d39, roughness: 0.98 }),
    stoneLight: new THREE.MeshStandardMaterial({ color: 0x777d73, roughness: 0.93 }),
    soil: new THREE.MeshStandardMaterial({ color: 0x3c4437, roughness: 1 }),
    forestFloor: new THREE.MeshStandardMaterial({
      color: 0x263d2c,
      roughness: 1,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    }),
    bark: new THREE.MeshStandardMaterial({ color: 0x403126, roughness: 1 }),
    barkLight: new THREE.MeshStandardMaterial({ color: 0x5a4130, roughness: 1 }),
    foliage,
  };
}

type MapMaterials = ReturnType<typeof createMapMaterials>;

function buildRiver(world: THREE.Group, materials: MapMaterials) {
  const bank = new THREE.Mesh(
    createRibbonGeometry(DAWNREACH_LAYOUT.river, 8.5, 0.009, 5),
    materials.riverBank,
  );
  bank.receiveShadow = true;
  world.add(bank);

  const water = new THREE.Mesh(
    createRibbonGeometry(DAWNREACH_LAYOUT.river, 6.35, 0.018, 5),
    materials.water,
  );
  water.receiveShadow = true;
  world.add(water);

  const shimmer = new THREE.Mesh(
    createRibbonGeometry(DAWNREACH_LAYOUT.river, 5.6, 0.024, 4.2),
    materials.waterShimmer,
  );
  world.add(shimmer);

  decorateRiverBanks(world, materials);
}

function buildLane(world: THREE.Group, points: readonly MapPoint[], materials: MapMaterials, laneIndex: number) {
  const shoulder = new THREE.Mesh(createRibbonGeometry(points, 5.35, 0.021, 4.2), materials.laneShoulder);
  shoulder.receiveShadow = true;
  world.add(shoulder);

  const lane = new THREE.Mesh(createRibbonGeometry(points, 4.15, 0.032, 4), materials.lane);
  lane.receiveShadow = true;
  world.add(lane);

  decorateLaneEdges(world, points, materials, laneIndex);
}

function createRibbonGeometry(
  points: readonly MapPoint[],
  width: number,
  y: number,
  uvScale: number,
) {
  const curve = new THREE.CatmullRomCurve3(
    points.map(([x, z]) => new THREE.Vector3(x, y, z)),
    false,
    'catmullrom',
    0.35,
  );

  const samples = Math.max(48, points.length * 14);
  const vertices: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let distance = 0;
  let previous = curve.getPoint(0);

  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const point = curve.getPoint(t);
    const tangent = curve.getTangent(t).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    if (i > 0) distance += point.distanceTo(previous);
    previous = point;

    const left = point.clone().addScaledVector(normal, width / 2);
    const right = point.clone().addScaledVector(normal, -width / 2);
    vertices.push(left.x, left.y, left.z, right.x, right.y, right.z);
    uvs.push(0, distance / uvScale, 1, distance / uvScale);

    if (i < samples) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, c, d, b);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildBase(team: 'blue' | 'red', x: number, z: number, materials: MapMaterials) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.scale.setScalar(BASE_VISUAL_SCALE);
  group.name = `${team}-base`;

  const faction = team === 'blue' ? 0x66b7ff : 0xff5f55;
  const glow = team === 'blue' ? 0x2588ff : 0xff2d25;
  const factionStone = new THREE.MeshStandardMaterial({
    color: team === 'blue' ? 0x4d6070 : 0x684e4d,
    roughness: 0.82,
    metalness: 0.04,
  });

  const foundation = new THREE.Mesh(new THREE.CylinderGeometry(6.8, 7.15, 0.34, 56), materials.stoneDark);
  foundation.position.y = 0.17;
  foundation.castShadow = true;
  foundation.receiveShadow = true;
  group.add(foundation);

  const terrace = new THREE.Mesh(new THREE.CylinderGeometry(5.55, 6.05, 0.34, 56), materials.stone);
  terrace.position.y = 0.47;
  terrace.castShadow = true;
  terrace.receiveShadow = true;
  group.add(terrace);

  const sanctum = new THREE.Mesh(new THREE.CylinderGeometry(3.85, 4.2, 0.24, 48), factionStone);
  sanctum.position.y = 0.76;
  sanctum.castShadow = true;
  sanctum.receiveShadow = true;
  group.add(sanctum);

  const runeRing = new THREE.Mesh(
    new THREE.TorusGeometry(3.35, 0.075, 8, 56),
    new THREE.MeshStandardMaterial({
      color: faction,
      emissive: glow,
      emissiveIntensity: 0.68,
      metalness: 0.5,
      roughness: 0.28,
    }),
  );
  runeRing.rotation.x = Math.PI / 2;
  runeRing.position.y = 0.91;
  group.add(runeRing);

  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const buttress = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.58, 0.78), materials.stoneLight);
    buttress.position.set(Math.cos(angle) * 5.75, 0.52, Math.sin(angle) * 5.75);
    buttress.rotation.y = -angle;
    buttress.castShadow = true;
    buttress.receiveShadow = true;
    group.add(buttress);
  }

  for (let i = 0; i < 4; i += 1) {
    const angle = Math.PI / 4 + (i / 4) * Math.PI * 2;
    const obelisk = buildBaseObelisk(materials, faction, glow);
    obelisk.position.set(Math.cos(angle) * 4.55, 0.9, Math.sin(angle) * 4.55);
    obelisk.rotation.y = -angle;
    group.add(obelisk);
  }

  const crystalMaterial = new THREE.MeshStandardMaterial({
    color: faction,
    emissive: glow,
    emissiveIntensity: 1.55,
    metalness: 0.16,
    roughness: 0.2,
  });

  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.28, 0), crystalMaterial);
  crystal.scale.set(0.86, 1.72, 0.86);
  crystal.position.y = 2.45;
  crystal.castShadow = true;
  group.add(crystal);

  for (let i = 0; i < 3; i += 1) {
    const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.42 + i * 0.06, 0), crystalMaterial);
    const angle = (i / 3) * Math.PI * 2 + 0.25;
    shard.position.set(Math.cos(angle) * 1.45, 1.25 + i * 0.08, Math.sin(angle) * 1.45);
    shard.scale.y = 1.5;
    shard.rotation.z = (i - 1) * 0.16;
    shard.castShadow = true;
    group.add(shard);
  }

  const light = new THREE.PointLight(faction, 15, 10, 2);
  light.position.y = 3.4;
  group.add(light);
  return group;
}

function buildBaseObelisk(materials: MapMaterials, faction: number, glow: number) {
  const group = new THREE.Group();
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.32, 0.72), materials.stoneDark);
  plinth.position.y = 0.16;
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1.45, 0.42), materials.stoneLight);
  shaft.position.y = 0.98;
  const cap = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.35, 0),
    new THREE.MeshStandardMaterial({ color: faction, emissive: glow, emissiveIntensity: 0.72, roughness: 0.28 }),
  );
  cap.position.y = 1.86;
  cap.scale.y = 1.25;
  for (const part of [plinth, shaft, cap]) {
    part.castShadow = true;
    part.receiveShadow = true;
    group.add(part);
  }
  return group;
}

function buildForestCluster(
  x: number,
  z: number,
  scale: number,
  clusterIndex: number,
  materials: MapMaterials,
) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.scale.setScalar(scale);

  const floor = new THREE.Mesh(new THREE.CircleGeometry(3.15, 36), materials.forestFloor);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.012;
  floor.scale.set(1.15, 0.86, 1);
  group.add(floor);

  const positions: Array<[number, number, number]> = [
    [-1.8, -1.1, 0.95], [-0.7, -1.7, 1.1], [0.8, -1.4, 0.85], [1.7, -0.5, 1.0],
    [-1.7, 0.5, 0.85], [-0.5, 0.4, 1.2], [0.8, 0.3, 1.0], [1.6, 1.2, 0.9],
    [-0.9, 1.5, 0.9], [0.3, 1.7, 1.05],
  ];

  for (let i = 0; i < positions.length; i += 1) {
    const [tx, tz, ts] = positions[i];
    group.add(buildTree(tx, tz, ts * TREE_VISUAL_SCALE, clusterIndex * 31 + i, materials));
  }

  for (let i = 0; i < 3; i += 1) {
    const angle = i * 2.13 + hash01(clusterIndex, i) * 0.8;
    const radius = 1.2 + hash01(i, clusterIndex, 9) * 1.25;
    const rock = buildRock(materials, clusterIndex * 17 + i, 0.38 + hash01(i, 3) * 0.18);
    rock.position.set(Math.cos(angle) * radius, 0.35, Math.sin(angle) * radius);
    rock.scale.set(0.65 + hash01(i, 5) * 0.45, 0.4 + hash01(i, 7) * 0.25, 0.55 + hash01(i, 11) * 0.4);
    group.add(rock);
  }

  return group;
}

function buildTree(x: number, z: number, scale: number, seed: number, materials: MapMaterials) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.scale.setScalar(scale);
  group.rotation.y = hash01(seed, 1) * Math.PI * 2;

  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.27, 1.85, 9), materials.bark);
  trunk.position.y = 0.925;
  trunk.rotation.z = (hash01(seed, 2) - 0.5) * 0.08;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  group.add(trunk);

  for (const side of [-1, 1]) {
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.095, 0.92, 7), materials.barkLight);
    branch.position.set(side * 0.22, 1.43 + hash01(seed, side + 4) * 0.18, 0.02);
    branch.rotation.z = side * (0.68 + hash01(seed, side + 8) * 0.18);
    branch.rotation.y = side * 0.45;
    branch.castShadow = true;
    group.add(branch);
  }

  const clumps = [
    { x: -0.48, y: 2.2, z: 0.06, sx: 0.95, sy: 0.76, sz: 0.88 },
    { x: 0.46, y: 2.3, z: -0.08, sx: 0.9, sy: 0.82, sz: 0.94 },
    { x: -0.08, y: 2.58, z: 0.26, sx: 1.02, sy: 0.86, sz: 0.92 },
    { x: 0.1, y: 2.82, z: -0.24, sx: 0.88, sy: 0.78, sz: 0.86 },
    { x: 0, y: 3.18, z: 0, sx: 0.72, sy: 0.86, sz: 0.74 },
  ];

  for (let i = 0; i < clumps.length; i += 1) {
    const clump = clumps[i];
    const crown = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.86 + hash01(seed, i, 22) * 0.12, 1),
      materials.foliage[(seed + i) % materials.foliage.length],
    );
    crown.position.set(
      clump.x + (hash01(seed, i, 30) - 0.5) * 0.16,
      clump.y + (hash01(seed, i, 31) - 0.5) * 0.12,
      clump.z + (hash01(seed, i, 32) - 0.5) * 0.16,
    );
    crown.scale.set(
      clump.sx * (0.92 + hash01(seed, i, 40) * 0.16),
      clump.sy * (0.92 + hash01(seed, i, 41) * 0.16),
      clump.sz * (0.92 + hash01(seed, i, 42) * 0.16),
    );
    crown.rotation.set(hash01(seed, i, 50) * 0.35, hash01(seed, i, 51) * Math.PI, hash01(seed, i, 52) * 0.25);
    crown.castShadow = true;
    crown.receiveShadow = true;
    group.add(crown);
  }

  return group;
}

function buildObjectivePit(x: number, z: number, kind: 'upper' | 'lower', materials: MapMaterials) {
  const group = new THREE.Group();
  group.position.set(x, 0.012, z);
  group.name = `${kind}-objective-pit`;

  const basin = new THREE.Mesh(new THREE.CircleGeometry(4.8, 56), materials.soil);
  basin.rotation.x = -Math.PI / 2;
  basin.position.y = 0.006;
  basin.receiveShadow = true;
  group.add(basin);

  const waterMaterial = new THREE.MeshPhysicalMaterial({
    color: kind === 'upper' ? 0x214c58 : 0x35284f,
    roughness: 0.2,
    metalness: 0.03,
    clearcoat: 0.45,
    transparent: true,
    opacity: 0.92,
  });
  const pool = new THREE.Mesh(new THREE.CircleGeometry(3.55, 56), waterMaterial);
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.025;
  group.add(pool);

  for (let i = 0; i < 20; i += 1) {
    if (i === 3 || i === 4 || i === 13 || i === 14) continue;
    const angle = (i / 20) * Math.PI * 2;
    const radius = 4.05 + (hash01(i, x, z) - 0.5) * 0.35;
    const rock = buildRock(materials, i + (kind === 'upper' ? 100 : 200), 0.62);
    rock.position.set(Math.cos(angle) * radius, 0.34 + hash01(i, 70) * 0.14, Math.sin(angle) * radius);
    rock.scale.set(0.72 + hash01(i, 71) * 0.42, 0.42 + hash01(i, 72) * 0.28, 0.55 + hash01(i, 73) * 0.42);
    rock.rotation.y = -angle + hash01(i, 74) * 0.45;
    group.add(rock);
  }

  for (const side of [-1, 1]) {
    const sentinel = new THREE.Mesh(new THREE.BoxGeometry(0.48, 1.5, 0.58), materials.stoneLight);
    sentinel.position.set(side * 3.45, 0.78, side * -1.7);
    sentinel.rotation.y = side * 0.35;
    sentinel.castShadow = true;
    sentinel.receiveShadow = true;
    group.add(sentinel);
  }

  return group;
}

function decorateLaneEdges(
  world: THREE.Group,
  points: readonly MapPoint[],
  materials: MapMaterials,
  laneIndex: number,
) {
  const curve = new THREE.CatmullRomCurve3(
    points.map(([x, z]) => new THREE.Vector3(x, 0.045, z)),
    false,
    'catmullrom',
    0.35,
  );

  for (let i = 1; i <= 10; i += 1) {
    const t = i / 11;
    const point = curve.getPoint(t);
    const tangent = curve.getTangent(t).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
    const side = (i + laneIndex) % 2 === 0 ? 1 : -1;
    point.addScaledVector(normal, side * (2.45 + hash01(laneIndex, i) * 0.38));

    const pebble = buildRock(materials, laneIndex * 50 + i, 0.2);
    pebble.position.set(point.x, 0.13, point.z);
    const size = 0.18 + hash01(i, laneIndex, 1) * 0.18;
    pebble.scale.set(size * 1.4, size * 0.65, size);
    world.add(pebble);
  }
}

function decorateRiverBanks(world: THREE.Group, materials: MapMaterials) {
  const points = DAWNREACH_LAYOUT.river;
  const curve = new THREE.CatmullRomCurve3(
    points.map(([x, z]) => new THREE.Vector3(x, 0.035, z)),
    false,
    'catmullrom',
    0.35,
  );

  for (let i = 1; i <= 14; i += 1) {
    const t = i / 15;
    const point = curve.getPoint(t);
    const tangent = curve.getTangent(t).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
    const side = i % 2 === 0 ? 1 : -1;
    point.addScaledVector(normal, side * (3.25 + hash01(i, 90) * 0.42));

    const bankRock = buildRock(materials, 400 + i, 0.28);
    bankRock.position.set(point.x, 0.18, point.z);
    const size = 0.28 + hash01(i, 91) * 0.26;
    bankRock.scale.set(size * 1.45, size * 0.75, size);
    world.add(bankRock);
  }
}

function buildRock(materials: MapMaterials, seed: number, radius = 1) {
  const geometry = new THREE.DodecahedronGeometry(radius, 0);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i += 1) {
    const factor = 0.88 + hash01(seed, i, 991) * 0.24;
    position.setXYZ(
      i,
      position.getX(i) * factor,
      position.getY(i) * factor,
      position.getZ(i) * factor,
    );
  }
  geometry.computeVertexNormals();

  const rock = new THREE.Mesh(geometry, hash01(seed, 777) > 0.55 ? materials.stone : materials.stoneDark);
  rock.rotation.set((hash01(seed, 1) - 0.5) * 0.35, hash01(seed, 2) * Math.PI * 2, (hash01(seed, 3) - 0.5) * 0.28);
  rock.castShadow = true;
  rock.receiveShadow = true;
  return rock;
}

function addMapEdgeCliffs(world: THREE.Group, materials: MapMaterials) {
  const { width, height } = DAWNREACH_LAYOUT;
  const step = 2.9;
  let seed = 0;

  const addRidgeRock = (x: number, z: number, outwardX: number, outwardZ: number) => {
    const rock = buildRock(materials, 800 + seed, 1.18 + hash01(seed, 10) * 0.28);
    rock.position.set(x, 0.65 + hash01(seed, 11) * 0.3, z);
    rock.scale.set(1.25 + hash01(seed, 12) * 0.45, 0.72 + hash01(seed, 13) * 0.42, 1.0 + hash01(seed, 14) * 0.35);
    world.add(rock);

    if (seed % 2 === 0) {
      const rear = buildRock(materials, 1200 + seed, 0.9 + hash01(seed, 15) * 0.28);
      rear.position.set(x + outwardX * 1.25, 0.5 + hash01(seed, 16) * 0.3, z + outwardZ * 1.25);
      rear.scale.set(1.15, 0.72 + hash01(seed, 17) * 0.3, 1.0);
      world.add(rear);
    }
    seed += 1;
  };

  for (let x = -width / 2; x <= width / 2; x += step) {
    addRidgeRock(x, -height / 2 - 0.55, 0, -1);
    addRidgeRock(x, height / 2 + 0.55, 0, 1);
  }
  for (let z = -height / 2 + step; z <= height / 2 - step; z += step) {
    addRidgeRock(-width / 2 - 0.55, z, -1, 0);
    addRidgeRock(width / 2 + 0.55, z, 1, 0);
  }
}

function hash01(...values: number[]) {
  let hash = 2166136261;
  for (const value of values) {
    hash ^= Math.round(value * 1000);
    hash = Math.imul(hash, 16777619);
    hash ^= hash >>> 13;
  }
  return (hash >>> 0) / 0xffffffff;
}
