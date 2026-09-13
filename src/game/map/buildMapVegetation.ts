import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { DawnreachTextures } from '../shared/textures';
import { BASE_LAYOUT, DAWNREACH_LAYOUT, MAP_BOUNDS, OBJECTIVE_LAYOUT, type MapPoint } from './mapLayout';

export function sampleMapPath(points: readonly MapPoint[]) {
  return new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'catmullrom', 0.35).getPoints(160);
}

export function distanceToMapPath(x: number, z: number, path: readonly THREE.Vector3[]) {
  let squared = Infinity;
  for (const point of path) squared = Math.min(squared, (x - point.x) ** 2 + (z - point.z) ** 2);
  return Math.sqrt(squared);
}

export function mapRandom(...values: number[]) {
  let state = 2166136261 >>> 0;
  for (const value of values) {
    state ^= Math.round((value + 1024) * 4096);
    state = Math.imul(state, 16777619);
    state ^= state >>> 13;
  }
  return (state >>> 0) / 0xffffffff;
}

export function getLaneTowerSites() {
  const bases = [DAWNREACH_LAYOUT.blueBase, DAWNREACH_LAYOUT.redBase];
  return Object.entries(DAWNREACH_LAYOUT.lanes).flatMap(([lane, points]) => {
    const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'catmullrom', 0.35);
    const samples = curve.getSpacedPoints(400);
    const outside = samples.map((point, index) => ({ point, fraction: index / 400 }))
      .filter(({ point }) => bases.every(base => Math.hypot(point.x - base.x, point.z - base.z) > BASE_LAYOUT.radius + 5.2));
    if (!outside.length) return [];
    const start = outside[0].fraction;
    const end = outside[outside.length - 1].fraction;
    const positions = lane === 'mid' ? [0.09, 0.35, 0.65, 0.91] : [0.05, 0.35, 0.65, 0.95];
    return positions.map((progress, index) => {
      const fraction = THREE.MathUtils.lerp(start, end, progress);
      const point = curve.getPointAt(fraction);
      const tangent = curve.getTangentAt(fraction);
      point.add(new THREE.Vector3(-tangent.z, 0, tangent.x).multiplyScalar(index < 2 ? 1.1 : -1.1));
      return { x: point.x, z: point.z, team: index < 2 ? 'blue' as const : 'red' as const, lane,
        distanceAlongLane: fraction * curve.getLength() };
    });
  });
}

export function buildMapVegetation(textures: DawnreachTextures) {
  const group = new THREE.Group();
  group.name = 'map-vegetation';
  const lanes = Object.values(DAWNREACH_LAYOUT.lanes).map(sampleMapPath);
  const paths = DAWNREACH_LAYOUT.junglePaths.map(sampleMapPath);
  const river = sampleMapPath(DAWNREACH_LAYOUT.river);
  const walls = DAWNREACH_LAYOUT.retainingWalls.map(sampleMapPath);
  const bases = [DAWNREACH_LAYOUT.blueBase, DAWNREACH_LAYOUT.redBase];
  const towers = getLaneTowerSites();
  const treeGeometry = createPineGeometry();
  const trunkGeometry = new THREE.CylinderGeometry(0.075, 0.24, 3.3, 8).translate(0, 1.65, 0);
  const grassGeometry = createGrassGeometry();
  const fernGeometry = createFernGeometry();
  const foliage = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.93, side: THREE.DoubleSide });
  const pineMaterial = foliage.clone();
  pineMaterial.map = textures.pine;
  pineMaterial.alphaTest = 0.35;
  pineMaterial.alphaToCoverage = true;
  const grassMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 1, side: THREE.DoubleSide });
  const bark = new THREE.MeshStandardMaterial({ color: 0x79644b, map: textures.bark, bumpMap: textures.bark, bumpScale: 0.12, roughness: 1 });
  const trees: THREE.Matrix4[] = [];
  const grass: THREE.Matrix4[] = [];
  const ferns: THREE.Matrix4[] = [];
  const object = new THREE.Object3D();

  const clearance = (x: number, z: number) => {
    if (towers.some(tower => Math.hypot(x - tower.x, z - tower.z) < 2)) return -1;
    if (bases.some(base => Math.hypot(x - base.x, z - base.z) < BASE_LAYOUT.radius + 1.5)) return -1;
    if (DAWNREACH_LAYOUT.objectivePits.some(pit => Math.hypot(x - pit.x, z - pit.z) < OBJECTIVE_LAYOUT.clearance)) return -1;
    if (DAWNREACH_LAYOUT.camps.some(([campX, campZ]) => Math.hypot(x - campX, z - campZ) < 2.4)) return -1;
    return Math.min(
      ...lanes.map(path => distanceToMapPath(x, z, path) - 2.65),
      ...paths.map(path => distanceToMapPath(x, z, path) - 1.05),
      ...walls.map(path => distanceToMapPath(x, z, path) - 0.65),
      distanceToMapPath(x, z, river) - 4.25,
    );
  };
  const place = (collection: THREE.Matrix4[], x: number, z: number, width: number, height: number, seed: number) => {
    object.position.set(x, 0.03, z);
    object.rotation.set(0, mapRandom(seed, 14) * Math.PI * 2, 0);
    object.scale.set(width, height, width);
    object.updateMatrix();
    collection.push(object.matrix.clone());
  };

  for (let row = MAP_BOUNDS.minZ + 4; row <= MAP_BOUNDS.maxZ - 4; row += 1.5) {
    for (let column = MAP_BOUNDS.minX + 4; column <= MAP_BOUNDS.maxX - 4; column += 1.5) {
      const seed = column * 103 + row * 37;
      const x = column + (mapRandom(column, row) - 0.5) * 1.1;
      const z = row + (mapRandom(row, column, 8) - 0.5) * 1.1;
      const available = clearance(x, z);
      const forestDistance = Math.min(...DAWNREACH_LAYOUT.jungleClusters.map(([centerX, centerZ, scale]) => Math.hypot(x - centerX, z - centerZ) / scale));
      const edgeDistance = Math.min(x - MAP_BOUNDS.minX, MAP_BOUNDS.maxX - x, z - MAP_BOUNDS.minZ, MAP_BOUNDS.maxZ - z);
      const boundary = edgeDistance < 9;
      if (available > 0.9 && (forestDistance < 6.2 || boundary) && mapRandom(seed, 7) > 0.10) {
        const width = 0.65 + mapRandom(seed, 8) * 0.46;
        const height = width * (0.87 + mapRandom(seed, 9) * 0.3);
        place(trees, x, z, width, height, seed);
      }
      if (available > 0.2 && available < 2.6 && mapRandom(seed, 10) > 0.52) {
        place(ferns, x, z, 0.5 + mapRandom(seed, 12) * 0.5, 0.55 + mapRandom(seed, 13) * 0.4, seed);
      }
    }
  }
  for (let row = MAP_BOUNDS.minZ + 3.4; row <= MAP_BOUNDS.maxZ - 3.4; row += 0.48) {
    for (let column = MAP_BOUNDS.minX + 3.4; column <= MAP_BOUNDS.maxX - 3.4; column += 0.48) {
      const x = column + mapRandom(column, row) * 0.4;
      const z = row + mapRandom(row, column, 8) * 0.4;
      const available = clearance(x, z);
      if (available < 0 || mapRandom(column, row, 7) < 0.24) continue;
      const patch = 0.5 + Math.sin(x * 0.53 + Math.cos(z * 0.8)) * 0.5;
      const height = (0.24 + mapRandom(column, row, 4) * 0.48) * (0.6 + patch * 0.5);
      place(grass, x, z, 0.55 + mapRandom(column, row, 2) * 0.65, height, column * 109 + row);
    }
  }

  addBatches(group, 'pine-crowns', treeGeometry, pineMaterial, trees, true);
  addBatches(group, 'pine-trunks', trunkGeometry, bark, trees, true);
  addBatches(group, 'grass', grassGeometry, grassMaterial, grass, false);
  addBatches(group, 'ferns', fernGeometry, foliage, ferns, false);
  group.userData.counts = { trees: trees.length, grass: grass.length, ferns: ferns.length };
  return group;
}

function addBatches(group: THREE.Group, name: string, geometry: THREE.BufferGeometry, material: THREE.Material,
  transforms: THREE.Matrix4[], castShadow: boolean) {
  const cells = new Map<string, THREE.Matrix4[]>();
  for (const matrix of transforms) {
    const key = `${Math.floor(matrix.elements[12] / 12)},${Math.floor(matrix.elements[14] / 12)}`;
    const cell = cells.get(key) ?? [];
    cell.push(matrix);
    cells.set(key, cell);
  }
  for (const [key, matrices] of cells) {
    const batch = new THREE.InstancedMesh(geometry, material, matrices.length);
    batch.name = `${name}:${key}`;
    matrices.forEach((matrix, index) => {
      batch.setMatrixAt(index, matrix);
      const tint = new THREE.Color().setHSL(0.21 + mapRandom(index, key.length) * 0.06, 0.14, 0.76 + mapRandom(index, 6) * 0.19);
      batch.setColorAt(index, tint);
    });
    batch.instanceMatrix.needsUpdate = true;
    batch.castShadow = castShadow;
    batch.receiveShadow = true;
    batch.computeBoundingSphere();
    group.add(batch);
  }
}

function createPineGeometry() {
  const tiers: THREE.BufferGeometry[] = [];
  for (let tier = 0; tier < 8; tier++) {
    const radius = 1.28 * (1 - tier / 9);
    const height = 1.12 - tier * 0.045;
    const geometry = new THREE.ConeGeometry(radius, height, 32, 3, true).toNonIndexed();
    const positions = geometry.getAttribute('position');
    const colors: number[] = [];
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const x = positions.getX(vertex);
      const y = positions.getY(vertex);
      const z = positions.getZ(vertex);
      const angle = Math.atan2(z, x);
      const branch = 0.8 + 0.2 * Math.cos(angle * 8 + tier * 1.7);
      const spread = (height / 2 - y) / height;
      positions.setXYZ(vertex, x * branch, y + 1.23 + tier * 0.37 - Math.sin(angle * 16 + tier) * spread * 0.08, z * branch);
      const color = new THREE.Color().setHSL(0.29 + tier * 0.003, 0.32 + spread * 0.16,
        0.23 + (1 - spread) * 0.15 + tier * 0.009 + mapRandom(x, y, z) * 0.035, THREE.SRGBColorSpace);
      colors.push(color.r, color.g, color.b);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.rotateY(tier * 0.72);
    geometry.computeVertexNormals();
    tiers.push(geometry);
  }
  const merged = mergeGeometries(tiers)!;
  tiers.forEach(geometry => geometry.dispose());
  return merged;
}

function createGrassGeometry() {
  const positions: number[] = [];
  const colors: number[] = [];
  for (let blade = 0; blade < 9; blade++) {
    const angle = blade * 2.399;
    const centerX = Math.cos(angle) * 0.18;
    const centerZ = Math.sin(angle) * 0.18;
    const width = 0.027 + mapRandom(blade, 5) * 0.023;
    const height = 0.5 + mapRandom(blade, 7) * 0.5;
    const bendX = Math.cos(angle) * 0.24;
    const bendZ = Math.sin(angle) * 0.24;
    const left = [centerX - width, 0, centerZ];
    const right = [centerX + width, 0, centerZ];
    const middleLeft = [centerX + bendX * 0.35 - width * 0.6, height * 0.57, centerZ + bendZ * 0.35];
    const middleRight = [centerX + bendX * 0.35 + width * 0.6, height * 0.57, centerZ + bendZ * 0.35];
    const tip = [centerX + bendX, height, centerZ + bendZ];
    positions.push(...left, ...right, ...middleLeft, ...right, ...middleRight, ...middleLeft, ...middleLeft, ...middleRight, ...tip);
    for (const light of [0.16, 0.16, 0.30, 0.16, 0.30, 0.30, 0.30, 0.30, 0.43]) {
      const color = new THREE.Color().setHSL(0.20 + mapRandom(blade, 3) * 0.07, 0.45, light + 0.06, THREE.SRGBColorSpace);
      colors.push(color.r, color.g, color.b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function createFernGeometry() {
  const positions: number[] = [];
  const colors: number[] = [];
  for (let frond = 0; frond < 7; frond++) {
    const angle = frond * Math.PI * 2 / 7;
    const forward = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
    const sideways = new THREE.Vector3(Math.cos(angle), 0, -Math.sin(angle));
    for (let leaf = 1; leaf < 8; leaf++) {
      const along = leaf / 8;
      const center = forward.clone().multiplyScalar(along * 0.85);
      center.y = Math.sin(along * Math.PI * 0.85) * 0.6;
      for (const side of [-1, 1]) {
        const tip = center.clone().addScaledVector(sideways, (1 - along) * 0.3 * side).addScaledVector(forward, 0.13);
        const end = center.clone().addScaledVector(forward, 0.13);
        positions.push(...center.toArray(), ...tip.toArray(), ...end.toArray());
        const color = new THREE.Color().setHSL(0.27, 0.47, 0.26 + along * 0.14, THREE.SRGBColorSpace);
        for (let vertex = 0; vertex < 3; vertex++) colors.push(color.r, color.g, color.b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}