import * as THREE from 'three';
import type { DawnreachTextures } from '../shared/textures';
import { DAWNREACH_LAYOUT, type MapPoint } from './mapLayout';

const TREE_VISUAL_SCALE = 1.16;
const BASE_VISUAL_SCALE = 0.9;

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

  addGroundColourBreakup(world, materials);
  buildRiver(world, materials);

  let laneIndex = 0;
  for (const points of Object.values(DAWNREACH_LAYOUT.lanes)) {
    buildLane(world, points, materials, laneIndex++);
  }

  addRiverCrossings(world, materials);

  world.add(buildBase('blue', DAWNREACH_LAYOUT.blueBase.x, DAWNREACH_LAYOUT.blueBase.z, materials));
  world.add(buildBase('red', DAWNREACH_LAYOUT.redBase.x, DAWNREACH_LAYOUT.redBase.z, materials));

  for (let index = 0; index < DAWNREACH_LAYOUT.jungleClusters.length; index += 1) {
    const [x, z, scale] = DAWNREACH_LAYOUT.jungleClusters[index];
    world.add(buildForestCluster(x, z, scale, index, materials));
  }

  for (const pit of DAWNREACH_LAYOUT.objectivePits) {
    world.add(buildObjectivePit(pit.x, pit.z, pit.kind, materials));
  }

  addRuins(world, materials);
  addMapEdgeCliffs(world, materials);
  return world;
}

function createMapMaterials(textures: DawnreachTextures) {
  const foliage = [
    new THREE.MeshStandardMaterial({ color: 0x173821, roughness: 0.98 }),
    new THREE.MeshStandardMaterial({ color: 0x21482a, roughness: 0.98 }),
    new THREE.MeshStandardMaterial({ color: 0x2d5733, roughness: 0.98 }),
    new THREE.MeshStandardMaterial({ color: 0x375f39, roughness: 0.98 }),
    new THREE.MeshStandardMaterial({ color: 0x24452d, roughness: 0.98 }),
  ];

  return {
    ground: new THREE.MeshStandardMaterial({ map: textures.grass, color: 0xe9eee5, roughness: 1 }),
    groundDark: new THREE.MeshStandardMaterial({ color: 0x314c35, roughness: 1, transparent: true, opacity: 0.28, depthWrite: false }),
    groundWarm: new THREE.MeshStandardMaterial({ color: 0x5c6040, roughness: 1, transparent: true, opacity: 0.12, depthWrite: false }),
    lane: new THREE.MeshStandardMaterial({ map: textures.lane, color: 0xd8cfb5, roughness: 1 }),
    laneEdge: new THREE.MeshStandardMaterial({ color: 0x66604d, roughness: 1, transparent: true, opacity: 0.62 }),
    riverBank: new THREE.MeshStandardMaterial({ color: 0x34443d, roughness: 1 }),
    water: new THREE.MeshPhysicalMaterial({
      color: 0x155268,
      roughness: 0.17,
      metalness: 0.02,
      clearcoat: 0.7,
      clearcoatRoughness: 0.2,
      transparent: true,
      opacity: 0.9,
    }),
    waterShimmer: new THREE.MeshBasicMaterial({
      color: 0x79bfd0,
      transparent: true,
      opacity: 0.095,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    stone: new THREE.MeshStandardMaterial({ color: 0x5d625d, roughness: 0.96, metalness: 0.01 }),
    stoneDark: new THREE.MeshStandardMaterial({ color: 0x343a37, roughness: 0.99 }),
    stoneLight: new THREE.MeshStandardMaterial({ color: 0x777a70, roughness: 0.94 }),
    stoneWarm: new THREE.MeshStandardMaterial({ color: 0x6f6858, roughness: 0.97 }),
    soil: new THREE.MeshStandardMaterial({ color: 0x393f32, roughness: 1 }),
    forestFloor: new THREE.MeshStandardMaterial({ color: 0x263a2a, roughness: 1 }),
    bark: new THREE.MeshStandardMaterial({ color: 0x37281f, roughness: 1 }),
    barkLight: new THREE.MeshStandardMaterial({ color: 0x513829, roughness: 1 }),
    moss: new THREE.MeshStandardMaterial({ color: 0x53633b, roughness: 1 }),
    foliage,
  };
}

type MapMaterials = ReturnType<typeof createMapMaterials>;

function addGroundColourBreakup(world: THREE.Group, materials: MapMaterials) {
  const patches: Array<[number, number, number, number, number]> = [
    [-27, 18, 13, 7, 0.25], [-11, -18, 14, 8, -0.42], [18, 18, 16, 8, 0.18],
    [29, -17, 13, 7, 0.6], [-2, 25, 11, 6, 0.1], [3, -25, 12, 7, -0.2],
  ];

  patches.forEach(([x, z, sx, sz, rotation], index) => {
    const patch = new THREE.Mesh(
      new THREE.CircleGeometry(1, 48),
      index % 2 === 0 ? materials.groundDark : materials.groundWarm,
    );
    patch.rotation.x = -Math.PI / 2;
    patch.rotation.z = rotation;
    patch.position.set(x, 0.006, z);
    patch.scale.set(sx, sz, 1);
    world.add(patch);
  });
}

function buildRiver(world: THREE.Group, materials: MapMaterials) {
  const bank = new THREE.Mesh(
    createRibbonGeometry(DAWNREACH_LAYOUT.river, 8.6, 0.01, 5),
    materials.riverBank,
  );
  bank.receiveShadow = true;
  world.add(bank);

  const shallow = new THREE.Mesh(
    createRibbonGeometry(DAWNREACH_LAYOUT.river, 7.1, 0.017, 5),
    materials.soil,
  );
  shallow.receiveShadow = true;
  world.add(shallow);

  const water = new THREE.Mesh(
    createRibbonGeometry(DAWNREACH_LAYOUT.river, 6.2, 0.025, 5),
    materials.water,
  );
  water.receiveShadow = true;
  world.add(water);

  const shimmer = new THREE.Mesh(
    createRibbonGeometry(DAWNREACH_LAYOUT.river, 5.25, 0.032, 4.2),
    materials.waterShimmer,
  );
  world.add(shimmer);

  decorateRiverBanks(world, materials);
}

function buildLane(world: THREE.Group, points: readonly MapPoint[], materials: MapMaterials, laneIndex: number) {
  const transition = new THREE.Mesh(createRibbonGeometry(points, 4.82, 0.019, 4.4), materials.laneEdge);
  transition.receiveShadow = true;
  world.add(transition);

  const lane = new THREE.Mesh(createRibbonGeometry(points, 4.08, 0.034, 4), materials.lane);
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

  const samples = Math.max(56, points.length * 16);
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

    // Small deterministic edge wobble keeps every road from looking machine-cut.
    const wobble = Math.sin(t * Math.PI * 14 + points.length) * 0.08 + Math.sin(t * Math.PI * 5.5) * 0.05;
    const left = point.clone().addScaledVector(normal, width / 2 + wobble);
    const right = point.clone().addScaledVector(normal, -width / 2 + wobble * 0.45);
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

  const faction = team === 'blue' ? 0x66b7ff : 0xff6258;
  const glow = team === 'blue' ? 0x2588ff : 0xff2d25;
  const factionStone = new THREE.MeshStandardMaterial({
    color: team === 'blue' ? 0x4a5d6d : 0x694d4c,
    roughness: 0.84,
    metalness: 0.04,
  });
  const trim = new THREE.MeshStandardMaterial({
    color: faction,
    emissive: glow,
    emissiveIntensity: 0.48,
    metalness: 0.42,
    roughness: 0.34,
  });

  const foundation = new THREE.Mesh(new THREE.CylinderGeometry(5.45, 5.82, 0.42, 16), materials.stoneDark);
  foundation.position.y = 0.21;
  foundation.castShadow = true;
  foundation.receiveShadow = true;
  group.add(foundation);

  const lowerStep = new THREE.Mesh(new THREE.CylinderGeometry(4.72, 5.12, 0.34, 16), materials.stone);
  lowerStep.position.y = 0.55;
  lowerStep.castShadow = true;
  lowerStep.receiveShadow = true;
  group.add(lowerStep);

  const terrace = new THREE.Mesh(new THREE.CylinderGeometry(3.72, 4.14, 0.34, 16), factionStone);
  terrace.position.y = 0.87;
  terrace.castShadow = true;
  terrace.receiveShadow = true;
  group.add(terrace);

  const trimRing = new THREE.Mesh(new THREE.TorusGeometry(3.35, 0.085, 8, 48), trim);
  trimRing.rotation.x = Math.PI / 2;
  trimRing.position.y = 1.07;
  group.add(trimRing);

  for (let i = 0; i < 4; i += 1) {
    const angle = Math.PI / 4 + (i / 4) * Math.PI * 2;
    const obelisk = buildBaseObelisk(materials, faction, glow);
    obelisk.position.set(Math.cos(angle) * 3.72, 0.92, Math.sin(angle) * 3.72);
    obelisk.rotation.y = -angle;
    group.add(obelisk);
  }

  for (let i = 0; i < 8; i += 1) {
    const angle = (i / 8) * Math.PI * 2;
    const buttress = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.6, 1.02), materials.stoneLight);
    buttress.position.set(Math.cos(angle) * 4.65, 0.62, Math.sin(angle) * 4.65);
    buttress.rotation.y = -angle;
    buttress.castShadow = true;
    buttress.receiveShadow = true;
    group.add(buttress);
  }

  const crystalMaterial = new THREE.MeshStandardMaterial({
    color: faction,
    emissive: glow,
    emissiveIntensity: 1.7,
    metalness: 0.12,
    roughness: 0.18,
  });

  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.72, 1.05, 10), materials.stoneDark);
  pedestal.position.y = 1.45;
  pedestal.castShadow = true;
  pedestal.receiveShadow = true;
  group.add(pedestal);

  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.04, 0), crystalMaterial);
  crystal.scale.set(0.82, 1.95, 0.82);
  crystal.position.y = 3.15;
  crystal.rotation.y = Math.PI / 4;
  crystal.castShadow = true;
  group.add(crystal);

  for (let i = 0; i < 4; i += 1) {
    const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.28 + (i % 2) * 0.07, 0), crystalMaterial);
    const angle = (i / 4) * Math.PI * 2 + 0.35;
    shard.position.set(Math.cos(angle) * 1.45, 1.75 + (i % 2) * 0.22, Math.sin(angle) * 1.45);
    shard.scale.y = 1.6;
    shard.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.18;
    shard.castShadow = true;
    group.add(shard);
  }

  const light = new THREE.PointLight(faction, 18, 10, 2);
  light.position.y = 3.6;
  group.add(light);
  return group;
}

function buildBaseObelisk(materials: MapMaterials, faction: number, glow: number) {
  const group = new THREE.Group();
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.62, 0.34, 8), materials.stoneDark);
  plinth.position.y = 0.17;
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.36, 1.48, 8), materials.stoneLight);
  shaft.position.y = 1.02;
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.055, 6, 20), materials.stoneWarm);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 1.62;
  const cap = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.32, 0),
    new THREE.MeshStandardMaterial({ color: faction, emissive: glow, emissiveIntensity: 0.8, roughness: 0.25 }),
  );
  cap.position.y = 2.0;
  cap.scale.y = 1.4;
  for (const part of [plinth, shaft, collar, cap]) {
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

  const mound = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 3.35, 0.18, 24), materials.forestFloor);
  mound.position.y = 0.09;
  mound.scale.set(1.16, 1, 0.88);
  mound.receiveShadow = true;
  group.add(mound);

  const positions: Array<[number, number, number]> = [
    [-1.72, -0.96, 0.88], [-0.7, -1.55, 1.02], [0.65, -1.42, 0.84], [1.55, -0.48, 0.94],
    [-1.52, 0.48, 0.84], [-0.45, 0.36, 1.12], [0.68, 0.22, 0.94], [1.38, 1.05, 0.82],
    [-0.82, 1.38, 0.84], [0.22, 1.55, 0.96],
  ];

  for (let i = 0; i < positions.length; i += 1) {
    const [tx, tz, ts] = positions[i];
    group.add(buildTree(tx, tz, ts * TREE_VISUAL_SCALE, clusterIndex * 31 + i, materials));
  }

  for (let i = 0; i < 7; i += 1) {
    const angle = i * 0.91 + hash01(clusterIndex, i) * 0.7;
    const radius = 1.6 + hash01(i, clusterIndex, 9) * 1.2;
    const shrub = buildShrub(materials, clusterIndex * 17 + i);
    shrub.position.set(Math.cos(angle) * radius, 0.18, Math.sin(angle) * radius);
    shrub.scale.setScalar(0.62 + hash01(i, 5) * 0.45);
    group.add(shrub);
  }

  for (let i = 0; i < 3; i += 1) {
    const angle = i * 2.13 + hash01(clusterIndex, i) * 0.8;
    const radius = 1.35 + hash01(i, clusterIndex, 9) * 1.3;
    const rock = buildRock(materials, clusterIndex * 17 + i, 0.4 + hash01(i, 3) * 0.18);
    rock.position.set(Math.cos(angle) * radius, 0.34, Math.sin(angle) * radius);
    rock.scale.set(0.7 + hash01(i, 5) * 0.4, 0.42 + hash01(i, 7) * 0.22, 0.6 + hash01(i, 11) * 0.34);
    group.add(rock);
  }

  return group;
}

function buildTree(x: number, z: number, scale: number, seed: number, materials: MapMaterials) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.scale.setScalar(scale);
  group.rotation.y = hash01(seed, 1) * Math.PI * 2;

  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.3, 2.15, 9), materials.bark);
  trunk.position.y = 1.08;
  trunk.rotation.z = (hash01(seed, 2) - 0.5) * 0.09;
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  group.add(trunk);

  for (let i = 0; i < 4; i += 1) {
    const side = i % 2 === 0 ? -1 : 1;
    const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.085, 0.9 + hash01(seed, i) * 0.35, 7), materials.barkLight);
    branch.position.set(side * (0.18 + hash01(seed, i, 2) * 0.14), 1.55 + i * 0.16, (hash01(seed, i, 3) - 0.5) * 0.28);
    branch.rotation.z = side * (0.75 + hash01(seed, i, 4) * 0.24);
    branch.rotation.y = hash01(seed, i, 5) * 0.9;
    branch.castShadow = true;
    group.add(branch);
  }

  const clumps = [
    [-0.62, 2.26, 0.08, 0.66], [0.58, 2.32, -0.08, 0.7], [-0.2, 2.58, 0.52, 0.68],
    [0.28, 2.62, -0.5, 0.66], [-0.72, 2.72, -0.24, 0.58], [0.72, 2.78, 0.28, 0.6],
    [-0.28, 3.0, -0.18, 0.66], [0.34, 3.08, 0.18, 0.62], [0.02, 3.38, 0.0, 0.54],
  ] as const;

  for (let i = 0; i < clumps.length; i += 1) {
    const [cx, cy, cz, radius] = clumps[i];
    const crown = new THREE.Mesh(
      new THREE.DodecahedronGeometry(radius * (0.92 + hash01(seed, i, 22) * 0.16), 1),
      materials.foliage[(seed + i) % materials.foliage.length],
    );
    crown.position.set(
      cx + (hash01(seed, i, 30) - 0.5) * 0.2,
      cy + (hash01(seed, i, 31) - 0.5) * 0.12,
      cz + (hash01(seed, i, 32) - 0.5) * 0.2,
    );
    crown.scale.set(
      0.9 + hash01(seed, i, 40) * 0.3,
      0.68 + hash01(seed, i, 41) * 0.22,
      0.88 + hash01(seed, i, 42) * 0.26,
    );
    crown.rotation.set(hash01(seed, i, 50) * 0.3, hash01(seed, i, 51) * Math.PI, hash01(seed, i, 52) * 0.22);
    crown.castShadow = true;
    crown.receiveShadow = true;
    group.add(crown);
  }

  return group;
}

function buildShrub(materials: MapMaterials, seed: number) {
  const group = new THREE.Group();
  for (let i = 0; i < 4; i += 1) {
    const mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28 + hash01(seed, i) * 0.14, 0), materials.foliage[(seed + i + 2) % materials.foliage.length]);
    const angle = (i / 4) * Math.PI * 2;
    mesh.position.set(Math.cos(angle) * 0.22, 0.18 + (i % 2) * 0.08, Math.sin(angle) * 0.22);
    mesh.scale.y = 0.7;
    mesh.castShadow = true;
    group.add(mesh);
  }
  return group;
}

function buildObjectivePit(x: number, z: number, kind: 'upper' | 'lower', materials: MapMaterials) {
  const group = new THREE.Group();
  group.position.set(x, 0.014, z);
  group.name = `${kind}-objective-pit`;

  const basin = new THREE.Mesh(new THREE.CylinderGeometry(4.55, 4.95, 0.22, 28), materials.soil);
  basin.position.y = 0.08;
  basin.receiveShadow = true;
  group.add(basin);

  const waterMaterial = new THREE.MeshPhysicalMaterial({
    color: kind === 'upper' ? 0x184d5b : 0x312348,
    roughness: 0.18,
    metalness: 0.02,
    clearcoat: 0.55,
    transparent: true,
    opacity: 0.93,
  });
  const pool = new THREE.Mesh(new THREE.CircleGeometry(3.3, 48), waterMaterial);
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.205;
  group.add(pool);

  for (let i = 0; i < 22; i += 1) {
    if (i === 3 || i === 4 || i === 14 || i === 15) continue;
    const angle = (i / 22) * Math.PI * 2;
    const radius = 4.0 + (hash01(i, x, z) - 0.5) * 0.34;
    const rock = buildRock(materials, i + (kind === 'upper' ? 100 : 200), 0.58);
    rock.position.set(Math.cos(angle) * radius, 0.37 + hash01(i, 70) * 0.12, Math.sin(angle) * radius);
    rock.scale.set(0.8 + hash01(i, 71) * 0.36, 0.48 + hash01(i, 72) * 0.25, 0.62 + hash01(i, 73) * 0.35);
    rock.rotation.y = -angle + hash01(i, 74) * 0.45;
    group.add(rock);
  }

  for (const side of [-1, 1]) {
    const sentinel = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.55, 0.32, 8), materials.stoneDark);
    base.position.y = 0.16;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.31, 1.2, 8), materials.stoneLight);
    shaft.position.y = 0.87;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.52, 6), materials.stoneWarm);
    cap.position.y = 1.72;
    for (const part of [base, shaft, cap]) {
      part.castShadow = true;
      part.receiveShadow = true;
      sentinel.add(part);
    }
    sentinel.position.set(side * 3.35, 0.15, side * -1.72);
    sentinel.rotation.y = side * 0.35;
    group.add(sentinel);
  }

  return group;
}

function addRiverCrossings(world: THREE.Group, materials: MapMaterials) {
  const crossings: Array<[number, number, number]> = [
    [-25.4, -28.1, -0.02],
    [0, 0, -0.64],
    [25.2, 26.8, -0.88],
  ];

  for (const [x, z, rotation] of crossings) {
    const bridge = new THREE.Group();
    bridge.position.set(x, 0.08, z);
    bridge.rotation.y = rotation;

    const deck = new THREE.Mesh(new THREE.BoxGeometry(6.1, 0.22, 4.35), materials.stoneWarm);
    deck.position.y = 0.12;
    deck.castShadow = true;
    deck.receiveShadow = true;
    bridge.add(deck);

    for (const side of [-1, 1]) {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(6.25, 0.38, 0.24), materials.stoneDark);
      curb.position.set(0, 0.28, side * 2.05);
      curb.castShadow = true;
      bridge.add(curb);
    }

    for (let i = -2; i <= 2; i += 1) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.025, 3.75), materials.stoneDark);
      seam.position.set(i * 1.05, 0.25, 0);
      bridge.add(seam);
    }

    world.add(bridge);
  }
}

function decorateLaneEdges(world: THREE.Group, points: readonly MapPoint[], materials: MapMaterials, laneIndex: number) {
  const curve = new THREE.CatmullRomCurve3(
    points.map(([x, z]) => new THREE.Vector3(x, 0.05, z)),
    false,
    'catmullrom',
    0.35,
  );

  for (let i = 1; i <= 18; i += 1) {
    const t = i / 19;
    const point = curve.getPoint(t);
    const tangent = curve.getTangent(t).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
    const side = (i + laneIndex) % 2 === 0 ? 1 : -1;
    point.addScaledVector(normal, side * (2.22 + hash01(laneIndex, i) * 0.5));

    if (i % 3 === 0) {
      const shrub = buildShrub(materials, laneIndex * 80 + i);
      shrub.position.set(point.x, 0.08, point.z);
      shrub.scale.setScalar(0.34 + hash01(i, laneIndex) * 0.18);
      world.add(shrub);
    } else {
      const pebble = buildRock(materials, laneIndex * 50 + i, 0.18);
      pebble.position.set(point.x, 0.13, point.z);
      const size = 0.15 + hash01(i, laneIndex, 1) * 0.14;
      pebble.scale.set(size * 1.45, size * 0.65, size);
      world.add(pebble);
    }
  }
}

function decorateRiverBanks(world: THREE.Group, materials: MapMaterials) {
  const curve = new THREE.CatmullRomCurve3(
    DAWNREACH_LAYOUT.river.map(([x, z]) => new THREE.Vector3(x, 0.04, z)),
    false,
    'catmullrom',
    0.35,
  );

  for (let i = 1; i <= 26; i += 1) {
    const t = i / 27;
    const point = curve.getPoint(t);
    const tangent = curve.getTangent(t).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
    const side = i % 2 === 0 ? 1 : -1;
    point.addScaledVector(normal, side * (3.15 + hash01(i, 90) * 0.55));

    const bankRock = buildRock(materials, 400 + i, 0.24);
    bankRock.position.set(point.x, 0.18, point.z);
    const size = 0.25 + hash01(i, 91) * 0.22;
    bankRock.scale.set(size * 1.5, size * 0.74, size);
    world.add(bankRock);
  }
}

function addRuins(world: THREE.Group, materials: MapMaterials) {
  const sites: Array<[number, number, number]> = [
    [-18, 15, 0.4], [-10, -22, -0.8], [18, -15, 2.7], [10, 22, 2.2],
  ];

  sites.forEach(([x, z, rotation], index) => {
    const ruin = new THREE.Group();
    ruin.position.set(x, 0, z);
    ruin.rotation.y = rotation;

    for (let i = 0; i < 3; i += 1) {
      const column = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 1.25 + i * 0.18, 8), i === 1 ? materials.stoneDark : materials.stoneLight);
      column.position.set((i - 1) * 0.85, 0.63 + i * 0.09, (i % 2) * 0.22);
      column.rotation.z = (i - 1) * 0.12;
      column.castShadow = true;
      column.receiveShadow = true;
      ruin.add(column);
    }

    const fallen = new THREE.Mesh(new THREE.BoxGeometry(2.65, 0.28, 0.42), materials.stoneWarm);
    fallen.position.set(0.4, 0.2, -0.65);
    fallen.rotation.y = 0.25;
    fallen.rotation.z = -0.12;
    fallen.castShadow = true;
    ruin.add(fallen);

    const moss = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 0.22), materials.moss);
    moss.position.set(-0.2, 1.25, 0.02);
    moss.rotation.z = index % 2 === 0 ? 0.08 : -0.08;
    ruin.add(moss);
    world.add(ruin);
  });
}

function buildRock(materials: MapMaterials, seed: number, radius = 1) {
  const geometry = new THREE.DodecahedronGeometry(radius, 0);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i += 1) {
    const factor = 0.84 + hash01(seed, i, 991) * 0.3;
    position.setXYZ(
      i,
      position.getX(i) * factor,
      position.getY(i) * factor,
      position.getZ(i) * factor,
    );
  }
  geometry.computeVertexNormals();

  const selector = hash01(seed, 777);
  const material = selector > 0.72 ? materials.stoneLight : selector > 0.38 ? materials.stone : materials.stoneDark;
  const rock = new THREE.Mesh(geometry, material);
  rock.rotation.set((hash01(seed, 1) - 0.5) * 0.42, hash01(seed, 2) * Math.PI * 2, (hash01(seed, 3) - 0.5) * 0.36);
  rock.castShadow = true;
  rock.receiveShadow = true;
  return rock;
}

function addMapEdgeCliffs(world: THREE.Group, materials: MapMaterials) {
  const { width, height } = DAWNREACH_LAYOUT;
  const step = 2.6;
  let seed = 0;

  const addRidgeRock = (x: number, z: number) => {
    const rock = buildRock(materials, 800 + seed, 1.1 + hash01(seed, 10) * 0.32);
    rock.position.set(x, 0.62 + hash01(seed, 11) * 0.34, z);
    rock.scale.set(1.18 + hash01(seed, 12) * 0.5, 0.68 + hash01(seed, 13) * 0.48, 0.95 + hash01(seed, 14) * 0.4);
    world.add(rock);

    if (seed % 3 === 0) {
      const shrub = buildShrub(materials, 950 + seed);
      shrub.position.set(x * 0.985, 0.12, z * 0.985);
      shrub.scale.setScalar(0.7 + hash01(seed, 20) * 0.5);
      world.add(shrub);
    }
    seed += 1;
  };

  for (let x = -width / 2; x <= width / 2; x += step) {
    addRidgeRock(x, -height / 2 - 0.62);
    addRidgeRock(x, height / 2 + 0.62);
  }
  for (let z = -height / 2 + step; z <= height / 2 - step; z += step) {
    addRidgeRock(-width / 2 - 0.62, z);
    addRidgeRock(width / 2 + 0.62, z);
  }
}

function hash01(...values: number[]) {
  let n = 2166136261 >>> 0;
  for (const value of values) {
    const scaled = Math.floor((value + 1024) * 1000);
    n ^= scaled;
    n = Math.imul(n, 16777619);
    n ^= n >>> 13;
  }
  return (n >>> 0) / 0xffffffff;
}
