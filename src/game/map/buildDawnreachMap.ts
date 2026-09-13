import * as THREE from 'three';
import { buildJungleCamps } from './buildJungleCamps';
import type { DawnreachTextures } from '../shared/textures';
import { BASE_LAYOUT, CAMP_LAYOUT, DAWNREACH_LAYOUT, MAP_BOUNDS, OBJECTIVE_LAYOUT, type MapPoint } from './mapLayout';
import { buildMapVegetation, sampleMapPath, distanceToMapPath, getLaneTowerSites } from './buildMapVegetation';
import { buildCitadel, buildDefenseTower, buildMasonryWalls, buildObjectiveRuins } from './buildMapArchitecture';

const TREE_VISUAL_SCALE = 1.16;
const BASE_VISUAL_SCALE = 0.9;

export function buildDawnreachMap(textures: DawnreachTextures) {
  const world = new THREE.Group();
  world.name = 'dawnreach-map';

  const materials = createMapMaterials(textures);

  const ground = new THREE.Mesh(
    createTerrainGeometry(),
    materials.ground,
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  world.add(ground);

  ground.name = 'terrain';
  ground.userData.commandSurface = true;
  materials.ground.vertexColors = true;
  buildRiver(world, materials);

  let laneIndex = 0;
  for (const points of Object.values(DAWNREACH_LAYOUT.lanes)) {
    buildLane(world, points, materials, laneIndex++);
  }

  addRiverCrossings(world, materials);

  for (const team of ['blue', 'red'] as const) {
    const base = buildCitadel(team, materials);
    const center = team === 'blue' ? DAWNREACH_LAYOUT.blueBase : DAWNREACH_LAYOUT.redBase;
    base.position.set(center.x, 0, center.z);
    world.add(base);
  }

  for (const path of DAWNREACH_LAYOUT.junglePaths) {
    const trail = new THREE.Mesh(createRibbonGeometry(path, 1.85, 0.015, 3), materials.dirt);
    trail.name = 'jungle-trail';
    trail.userData.commandSurface = true;
    trail.receiveShadow = true;
    world.add(trail);
  }
  world.add(buildMapVegetation(textures));

  for (const pit of DAWNREACH_LAYOUT.objectivePits) {
    world.add(buildObjectivePit(pit.x, pit.z, pit.kind, materials));
  }

  addRuins(world, materials);
  addMapEdgeCliffs(world, materials);
  addFortifications(world, materials);
  addJungleLandmarks(world, materials);
  world.add(buildJungleCamps(textures));
  for (const site of getLaneTowerSites()) {
    const tower = buildDefenseTower(site.team, materials);
    tower.position.set(site.x, 0, site.z);
    tower.name = `${site.team}-${site.lane}-tower`;
    world.add(tower);
  }
  return world;
}

function createTerrainGeometry() {
  const geometry = new THREE.PlaneGeometry(DAWNREACH_LAYOUT.width, DAWNREACH_LAYOUT.height, 96, 72);
  const positions = geometry.getAttribute('position');
  const colors: number[] = [];
  for (let vertex = 0; vertex < positions.count; vertex++) {
    const x = positions.getX(vertex);
    const z = -positions.getY(vertex);
    const forest = Math.min(...DAWNREACH_LAYOUT.jungleClusters.map(([centerX, centerZ]) => Math.hypot(x - centerX, z - centerZ)));
    const shade = THREE.MathUtils.smoothstep(forest, 1, 7);
    const variation = Math.sin(x * 0.24 + Math.sin(z * 0.3)) * Math.cos(z * 0.21) * 0.055;
    const color = new THREE.Color().setRGB(0.6 + shade * 0.32 + variation, 0.67 + shade * 0.26 + variation, 0.52 + shade * 0.26 + variation);
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
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
    lane: new THREE.MeshStandardMaterial({ map: textures.paving, bumpMap: textures.paving, bumpScale: 0.085, color: 0xc9c6ad, roughness: 0.96, vertexColors: true, transparent: true, depthWrite: false }),
    dirt: new THREE.MeshStandardMaterial({ map: textures.lane, color: 0xbeb395, roughness: 1, vertexColors: true, transparent: true, depthWrite: false }),
    laneEdge: new THREE.MeshStandardMaterial({ map: textures.lane, color: 0xaaa484, roughness: 1, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false }),
    riverBank: new THREE.MeshStandardMaterial({ map: textures.riverBed, color: 0x888d6f, roughness: 0.92, vertexColors: true, transparent: true }),
    riverBed: new THREE.MeshStandardMaterial({ map: textures.riverBed, bumpMap: textures.riverBed, bumpScale: 0.06,
      color: 0xb1bba0, roughness: 0.82, vertexColors: true, transparent: true }),
    water: new THREE.MeshPhysicalMaterial({
      color: 0x489f9d,
      roughness: 0.24,
      metalness: 0,
      clearcoat: 0.9,
      clearcoatRoughness: 0.16,
      ior: 1.333,
      bumpMap: textures.water,
      bumpScale: 0.055,
      vertexColors: true,
      transparent: true,
      opacity: 0.40,
      depthWrite: false,
    }),
    waterShimmer: new THREE.MeshBasicMaterial({
      map: textures.waterFlow,
      color: 0xc6e3d2,
      vertexColors: true,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    stone: new THREE.MeshStandardMaterial({ map: textures.stone, bumpMap: textures.stone, bumpScale: 0.12, color: 0x8d928c, roughness: 0.96, metalness: 0.01 }),
    stoneDark: new THREE.MeshStandardMaterial({ map: textures.stone, bumpMap: textures.stone, bumpScale: 0.13, color: 0x515e61, roughness: 0.99 }),
    stoneLight: new THREE.MeshStandardMaterial({ map: textures.stone, bumpMap: textures.stone, bumpScale: 0.08, color: 0xb2b6a6, roughness: 0.94 }),
    stoneWarm: new THREE.MeshStandardMaterial({ map: textures.paving, bumpMap: textures.paving, bumpScale: 0.08, color: 0xb3ac94, roughness: 0.97 }),
    soil: new THREE.MeshStandardMaterial({ color: 0x393f32, roughness: 1 }),
    forestFloor: new THREE.MeshStandardMaterial({ color: 0x263a2a, roughness: 1 }),
    bark: new THREE.MeshStandardMaterial({ map: textures.bark, bumpMap: textures.bark, bumpScale: 0.1, color: 0x6b5843, roughness: 1 }),
    barkLight: new THREE.MeshStandardMaterial({ map: textures.bark, color: 0x8e7453, roughness: 1 }),
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
  bank.name = 'river-bank';
  bank.userData.commandSurface = true;
  bank.receiveShadow = true;
  world.add(bank);

  const shallow = new THREE.Mesh(
    createRibbonGeometry(DAWNREACH_LAYOUT.river, 7.1, 0.017, 5),
    materials.riverBed,
  );
  shallow.name = 'river-bed';
  shallow.userData.commandSurface = true;
  shallow.receiveShadow = true;
  world.add(shallow);

  const water = new THREE.Mesh(
    createRibbonGeometry(DAWNREACH_LAYOUT.river, 6.6, 0.048, 5),
    materials.water,
  );
  water.name = 'river-surface';
  water.userData.commandSurface = true;
  water.userData.waterSurface = true;
  water.renderOrder = 2;
  water.receiveShadow = true;
  world.add(water);

  const shimmer = new THREE.Mesh(
    createRibbonGeometry(DAWNREACH_LAYOUT.river, 6.4, 0.060, 4.2),
    materials.waterShimmer,
  );
  shimmer.name = 'river-current';
  shimmer.renderOrder = 3;
  world.add(shimmer);

  const curve = new THREE.CatmullRomCurve3(DAWNREACH_LAYOUT.river.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'catmullrom', 0.35);
  const stones = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 1), materials.stone, 520);
  stones.name = 'river-pebbles';
  const transform = new THREE.Object3D();
  for (let index = 0; index < stones.count; index++) {
    const fraction = 0.01 + hash01(index, 817) * 0.98;
    const position = curve.getPointAt(fraction);
    const tangent = curve.getTangentAt(fraction);
    position.addScaledVector(new THREE.Vector3(-tangent.z, 0, tangent.x), (hash01(index, 818) - 0.5) * 5.6);
    transform.position.set(position.x, 0.026, position.z);
    transform.rotation.set(0, hash01(index, 819) * Math.PI * 2, 0);
    const size = 0.09 + hash01(index, 820) ** 2 * 0.22;
    transform.scale.set(size, 0.008 + hash01(index, 821) * 0.006, size * 0.75);
    transform.updateMatrix();
    stones.setMatrixAt(index, transform.matrix);
    stones.setColorAt(index, new THREE.Color().setHSL(0.11 + hash01(index, 822) * 0.09, 0.13, 0.42 + hash01(index, 823) * 0.35));
  }
  stones.receiveShadow = true;
  stones.computeBoundingSphere();
  world.add(stones);

  decorateRiverBanks(world, materials);
}

export function animateRiverSurface(surface: THREE.Mesh<THREE.BufferGeometry>, elapsed: number) {
  const positions = surface.geometry.getAttribute('position');
  const uvs = surface.geometry.getAttribute('uv');
  for (let vertex = 0; vertex < positions.count; vertex++) {
    const across = uvs.getX(vertex);
    const along = uvs.getY(vertex);
    const fade = Math.sin(across * Math.PI);
    const wave = Math.sin(along * 7 - elapsed * 1.8 + across * 4) * 0.004
      + Math.sin(along * 11 + elapsed * 1.1 - across * 6) * 0.002;
    positions.setY(vertex, 0.048 + wave * fade);
  }
  positions.needsUpdate = true;
  surface.geometry.computeVertexNormals();
}

function buildLane(world: THREE.Group, points: readonly MapPoint[], materials: MapMaterials, laneIndex: number) {
  const transition = new THREE.Mesh(createRibbonGeometry(points, 5.15, 0.01, 4.4), materials.laneEdge);
  transition.receiveShadow = true;
  world.add(transition);

  const lane = new THREE.Mesh(createRibbonGeometry(points, 4.08, 0.016, 4), materials.lane);
  lane.userData.commandSurface = true;
  lane.renderOrder = 1;
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
  const colors: number[] = [];
  const indices: number[] = [];
  const crossSection = [-1, -0.85, -0.6, 0, 0.6, 0.85, 1];
  const opacity = [0, 0.28, 1, 1, 1, 0.28, 0];
  const length = curve.getLength();
  let distance = 0;
  let previous = curve.getPoint(0);

  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const point = curve.getPoint(t);
    const tangent = curve.getTangent(t).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    if (i > 0) distance += point.distanceTo(previous);
    previous = point;

    const wobble = Math.sin(distance * 1.3 + points.length) * 0.13 + Math.sin(distance * 0.51) * 0.14;
    const capDistance = Math.min(distance, length - distance, width / 2);
    const cap = Math.sqrt(Math.max(0.001, 1 - (1 - capDistance / (width / 2)) ** 2));
    for (let across = 0; across < crossSection.length; across++) {
      const fraction = crossSection[across];
      const vertex = point.clone().addScaledVector(normal, fraction * (width / 2 + wobble) * cap);
      vertices.push(vertex.x, vertex.y, vertex.z);
      uvs.push((fraction + 1) / 2, distance / uvScale);
      colors.push(1, 1, 1, opacity[across] * Math.min(1, capDistance / 0.45));
      if (i < samples && across < crossSection.length - 1) {
        const current = i * crossSection.length + across;
        const next = current + crossSection.length;
        indices.push(current, current + 1, next, next, current + 1, next + 1);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
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
  group.position.set(x, 0, z);
  group.name = `${kind}-objective-pit`;
  const river = sampleMapPath(DAWNREACH_LAYOUT.river);
  const closest = river.reduce((nearest, point) => Math.hypot(point.x - x, point.z - z) < Math.hypot(nearest.x - x, nearest.z - z) ? point : nearest);
  const entranceAngle = Math.atan2(closest.z - z, closest.x - x);
  group.userData.entranceAngle = entranceAngle;
  group.userData.poolRadius = OBJECTIVE_LAYOUT.poolRadius;
  const bed = new THREE.Mesh(createObjectiveFloor(OBJECTIVE_LAYOUT.wallRadius + 0.95, 0.014), materials.riverBed);
  bed.name = 'objective-bed';
  bed.userData.commandSurface = true;
  bed.receiveShadow = true;
  group.add(bed);
  const poolGeometry = createObjectiveFloor(OBJECTIVE_LAYOUT.poolRadius, 0.048);
  const pool = new THREE.Mesh(poolGeometry, materials.water);
  pool.name = 'objective-water';
  pool.userData.commandSurface = true;
  pool.userData.waterSurface = true;
  pool.renderOrder = 2;
  pool.receiveShadow = true;
  const current = new THREE.Mesh(createObjectiveFloor(OBJECTIVE_LAYOUT.poolRadius, 0.06), materials.waterShimmer);
  current.name = 'objective-current';
  current.renderOrder = 3;
  for (const surface of [pool, current]) {
    const positions = surface.geometry.getAttribute('position');
    const colors = surface.geometry.getAttribute('color');
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const riverDistance = distanceToMapPath(x + positions.getX(vertex), z + positions.getZ(vertex), river);
      colors.setW(vertex, colors.getW(vertex) * THREE.MathUtils.smoothstep(riverDistance, 2.45, 3.3));
    }
    group.add(surface);
  }
  group.add(buildObjectiveRuins(kind, materials, entranceAngle));
  for (let index = 0; index < 42; index++) {
    const angle = entranceAngle + OBJECTIVE_LAYOUT.gateHalfAngle + hash01(index, 754) * (Math.PI * 2 - OBJECTIVE_LAYOUT.gateHalfAngle * 2);
    const radius = 5.1 + hash01(index, 753) * 2.0;
    const rock = buildRock(materials, 910 + index, 0.32 + hash01(index, 751) * 0.4);
    rock.position.set(Math.cos(angle) * radius, 0.16, Math.sin(angle) * radius);
    rock.scale.set(1, 0.45 + hash01(index, 750) * 0.4, 0.7);
    rock.rotation.y = angle;
    group.add(rock);
    if (index % 3 === 0) {
      const moss = buildShrub(materials, 614 + index);
      moss.position.copy(rock.position);
      moss.position.y += 0.16;
      moss.scale.set(0.8, 0.35, 0.8);
      group.add(moss);
    }
  }
  return group;
}

function createObjectiveFloor(radius: number, height: number) {
  const vertices: number[] = [];
  const colors: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const rings = 14;
  const sections = 80;
  for (let ring = 0; ring <= rings; ring++) {
    const fraction = ring / rings;
    for (let section = 0; section <= sections; section++) {
      const angle = section / sections * Math.PI * 2;
      const reach = radius * fraction * (1 + Math.sin(angle * 3) * 0.035 + Math.sin(angle * 7 + 1) * 0.025);
      const positionX = Math.cos(angle) * reach;
      const positionZ = Math.sin(angle) * reach;
      vertices.push(positionX, height, positionZ);
      uvs.push(positionX / 6, positionZ / 6);
      colors.push(1, 1, 1, 1 - THREE.MathUtils.smoothstep(fraction, 0.86, 1));
      if (ring < rings && section < sections) {
        const start = ring * (sections + 1) + section;
        const next = start + sections + 1;
        indices.push(start, start + 1, next, start + 1, next + 1, next);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addRiverCrossings(world: THREE.Group, materials: MapMaterials) {
  const river = sampleMapPath(DAWNREACH_LAYOUT.river);
  for (const [name, points] of Object.entries(DAWNREACH_LAYOUT.lanes)) {
    const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'catmullrom', 0.35);
    let closest = Infinity;
    let fraction = 0;
    for (let sample = 0; sample <= 500; sample++) {
      const point = curve.getPointAt(sample / 500);
      const distance = distanceToMapPath(point.x, point.z, river);
      if (distance < closest) {
        closest = distance;
        fraction = sample / 500;
      }
    }
    const center = curve.getPointAt(fraction);
    const tangent = curve.getTangentAt(fraction);
    const bridge = new THREE.Group();
    bridge.name = `${name}-river-bridge`;
    bridge.position.set(center.x, 0.02, center.z);
    bridge.rotation.y = -Math.atan2(tangent.z, tangent.x);

    const deck = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.12, 4.1), materials.stoneWarm);
    deck.userData.commandSurface = true;
    deck.position.y = 0.01;
    deck.castShadow = true;
    deck.receiveShadow = true;
    bridge.add(deck);

    for (const side of [-1, 1]) {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.4, 0.24), materials.stoneLight);
      curb.position.set(0, 0.2, side * 2.05);
      curb.castShadow = true;
      bridge.add(curb);
      for (const along of [-4.9, -1.65, 1.65, 4.9]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.72, 0.45), materials.stoneDark);
        post.position.set(along, 0.36, side * 2.05);
        post.castShadow = true;
        bridge.add(post);
      }
    }

    for (let i = -2; i <= 2; i += 1) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.025, 3.75), materials.stoneDark);
      seam.position.set(i * 1.7, 0.079, 0);
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

    if ([DAWNREACH_LAYOUT.blueBase, DAWNREACH_LAYOUT.redBase]
      .some(base => Math.hypot(point.x - base.x, point.z - base.z) < BASE_LAYOUT.radius + 1.5)) continue;

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
    // Old ruin decorations must not occupy the expanded camp interiors.
    if (DAWNREACH_LAYOUT.camps.some(([campX, campZ]) =>
      Math.hypot(x - campX, z - campZ) < CAMP_LAYOUT.clearingRadius + 1.5)) return;
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
  const geometry = new THREE.DodecahedronGeometry(radius, 1);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i += 1) {
    const factor = 0.86 + hash01(seed, position.getX(i), position.getY(i), position.getZ(i)) * 0.25;
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
  const foundation = new THREE.Mesh(new THREE.BoxGeometry(width, 6.5, height), materials.stoneDark);
  foundation.position.y = -3.3;
  foundation.name = 'island-foundation';
  foundation.receiveShadow = true;
  world.add(foundation);

  const addRidgeRock = (x: number, z: number) => {
    const rock = buildRock(materials, 800 + seed, 1.1 + hash01(seed, 10) * 0.32);
    rock.position.set(x + (hash01(seed, 8) - 0.5) * 0.8, -2.35 + hash01(seed, 11) * 0.3, z);
    rock.scale.set(1.18 + hash01(seed, 12) * 0.5, 2.3 + hash01(seed, 13) * 0.9, 0.95 + hash01(seed, 14) * 0.4);
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

function addFortifications(world: THREE.Group, materials: MapMaterials) {
  const lanes = Object.values(DAWNREACH_LAYOUT.lanes).map(sampleMapPath);
  const river = sampleMapPath(DAWNREACH_LAYOUT.river);
  const bases = [DAWNREACH_LAYOUT.blueBase, DAWNREACH_LAYOUT.redBase];
  const left = MAP_BOUNDS.minX + 1.7;
  const right = MAP_BOUNDS.maxX - 1.7;
  const top = MAP_BOUNDS.minZ + 2;
  const bottom = MAP_BOUNDS.maxZ - 2;
  const perimeter: MapPoint[][] = [
    [[left, bottom - 4], [left, 0], [left + 0.5, top + 2.2], [left + 4.3, top], [0, top], [right - 3.3, top], [right, top + 4]],
    [[right, top + 4], [right, 0], [right, bottom - 2.2], [right - 4.3, bottom], [0, bottom], [left + 4.3, bottom], [left, bottom - 4]],
  ];
  const isGate = (x: number, z: number) => distanceToMapPath(x, z, river) < 5.2
    || bases.some(base => Math.hypot(x - base.x, z - base.z) < BASE_LAYOUT.radius + 1)
    || lanes.some(lane => distanceToMapPath(x, z, lane) < 3.1);
  world.add(buildMasonryWalls(perimeter, materials, isGate));
  const trails = DAWNREACH_LAYOUT.junglePaths.map(sampleMapPath);
  world.add(buildMasonryWalls(DAWNREACH_LAYOUT.retainingWalls, materials,
    (x, z) => isGate(x, z) || trails.some(trail => distanceToMapPath(x, z, trail) < 1.7), 0.8));
}

function addJungleLandmarks(world: THREE.Group, materials: MapMaterials) {
  const lanes = Object.values(DAWNREACH_LAYOUT.lanes).map(sampleMapPath);
  const trails = DAWNREACH_LAYOUT.junglePaths.map(sampleMapPath);
  const river = sampleMapPath(DAWNREACH_LAYOUT.river);
  for (let cluster = 0; cluster < DAWNREACH_LAYOUT.jungleClusters.length; cluster++) {
    const [x, z] = DAWNREACH_LAYOUT.jungleClusters[cluster];
    for (let index = 0; index < 5; index++) {
      const rockX = x + (index - 2) * 1.2;
      const rockZ = z + Math.sin(index * 1.4 + cluster) * 1.2;
      if ([DAWNREACH_LAYOUT.blueBase, DAWNREACH_LAYOUT.redBase]
        .some(base => Math.hypot(rockX - base.x, rockZ - base.z) < BASE_LAYOUT.radius + 2)
        || distanceToMapPath(rockX, rockZ, river) < 4.4
        || lanes.some(lane => distanceToMapPath(rockX, rockZ, lane) < 3.5)
        || trails.some(trail => distanceToMapPath(rockX, rockZ, trail) < 2)
        || DAWNREACH_LAYOUT.camps.some(([campX, campZ]) => Math.hypot(rockX - campX, rockZ - campZ) < CAMP_LAYOUT.clearingRadius + 0.5)) continue;
      const rock = buildRock(materials, 1600 + cluster * 11 + index, 1);
      rock.position.set(rockX, 0.7, rockZ);
      rock.scale.set(0.7 + hash01(cluster, index) * 0.5, 1.25 + hash01(index, cluster, 9) * 1.1, 0.85);
      world.add(rock);
    }
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
