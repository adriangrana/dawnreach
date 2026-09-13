import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BASE_LAYOUT, OBJECTIVE_LAYOUT } from './mapLayout';

type StoneMaterials = {
  stone: THREE.MeshStandardMaterial;
  stoneDark: THREE.MeshStandardMaterial;
  stoneLight: THREE.MeshStandardMaterial;
  stoneWarm: THREE.MeshStandardMaterial;
};

class Masonry {
  private parts = new Map<THREE.Material, THREE.BufferGeometry[]>();

  add(geometry: THREE.BufferGeometry, material: THREE.Material, position = new THREE.Vector3(), rotation = new THREE.Euler()) {
    const transform = new THREE.Matrix4().compose(position, new THREE.Quaternion().setFromEuler(rotation), new THREE.Vector3(1, 1, 1));
    geometry.applyMatrix4(transform);
    const parts = this.parts.get(material) ?? [];
    parts.push(geometry.index ? geometry.toNonIndexed() : geometry);
    if (geometry.index) geometry.dispose();
    this.parts.set(material, parts);
  }

  box(material: THREE.Material, width: number, height: number, depth: number, x: number, y: number, z: number, yaw = 0) {
    this.add(new THREE.BoxGeometry(width, height, depth), material, new THREE.Vector3(x, y, z), new THREE.Euler(0, yaw, 0));
  }

  cylinder(material: THREE.Material, top: number, bottom: number, height: number, x: number, y: number, z: number, segments = 16) {
    this.add(new THREE.CylinderGeometry(top, bottom, height, segments), material, new THREE.Vector3(x, y, z));
  }

  ring(material: THREE.Material, inner: number, outer: number, y: number, start = 0, length = Math.PI * 2, x = 0, z = 0) {
    this.add(new THREE.RingGeometry(inner, outer, Math.max(3, Math.ceil(length * 18)), 1, start, length), material,
      new THREE.Vector3(x, y, z), new THREE.Euler(-Math.PI / 2, 0, 0));
  }

  finish(name: string) {
    const group = new THREE.Group();
    group.name = name;
    for (const [material, parts] of this.parts) {
      const geometry = mergeGeometries(parts)!;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
      parts.forEach(part => part.dispose());
    }
    return group;
  }
}

export function buildObjectiveRuins(kind: 'upper' | 'lower', stone: StoneMaterials, entranceAngle: number) {
  const build = new Masonry();
  const { wallRadius, gateHalfAngle } = OBJECTIVE_LAYOUT;
  const crystal = new THREE.MeshStandardMaterial({ color: kind === 'lower' ? 0xba80d5 : 0x81d0be,
    emissive: kind === 'lower' ? 0x642391 : 0x236e67, emissiveIntensity: 0.8, roughness: 0.32, metalness: 0.15 });
  const inlay = new THREE.MeshStandardMaterial({ color: kind === 'lower' ? 0x947baa : 0x8bad9e,
    emissive: kind === 'lower' ? 0x372047 : 0x244a40, emissiveIntensity: 0.45, roughness: 0.68 });
  const moss = new THREE.MeshStandardMaterial({ color: 0x526a3c, roughness: 1 });
  const arc = Math.PI * 2 - gateHalfAngle * 2;
  const count = 17;
  for (let section = 0; section < count; section++) {
    const angle = entranceAngle + gateHalfAngle + (section + 0.5) * arc / count;
    const radius = wallRadius + Math.sin(section * 2.7) * 0.14;
    const positionX = Math.cos(angle) * radius;
    const positionZ = Math.sin(angle) * radius;
    const yaw = Math.PI / 2 - angle;
    const front = Math.max(0, Math.cos(angle - 0.85));
    const height = 3.6 + Math.sin(section * 2.4) * 0.8 - front * 1.35;
    const width = arc * wallRadius / count * 0.94;
    build.box(stone.stoneDark, width + 0.25, 0.32, 1.15, positionX, 0.16, positionZ, yaw);
    const silhouette = new THREE.Shape();
    silhouette.moveTo(-width / 2, 0);
    silhouette.lineTo(width / 2, 0);
    silhouette.lineTo(width * 0.48, height * 0.75);
    silhouette.lineTo(width * 0.34, height * 0.79);
    silhouette.lineTo(width * 0.41, height);
    silhouette.lineTo(width * 0.06, height * 0.94);
    silhouette.lineTo(-width * 0.18, height * 1.06);
    silhouette.lineTo(-width * 0.49, height * 0.84);
    silhouette.closePath();
    const slab = new THREE.ExtrudeGeometry(silhouette, { depth: 0.68, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: 0.06, bevelThickness: 0.06 });
    slab.translate(0, 0.28, -0.34);
    build.add(slab, section % 3 === 0 ? stone.stoneLight : stone.stone, new THREE.Vector3(positionX, 0, positionZ), new THREE.Euler(0, yaw, 0));
    for (let course = 0; course < Math.floor(height / 0.65); course++) {
      build.box(stone.stoneDark, width * 0.94, 0.04, 0.73, positionX, 0.55 + course * 0.65, positionZ, yaw);
    }
    if (section % 2 === 0) {
      const buttress = new THREE.CylinderGeometry(0.16, 0.5, height + 0.45, 4);
      buttress.rotateY(Math.PI / 4);
      build.add(buttress, stone.stoneLight, new THREE.Vector3(Math.cos(angle) * (radius + 0.45), height / 2 + 0.22, Math.sin(angle) * (radius + 0.45)), new THREE.Euler(0, yaw, 0));
      build.box(moss, width * 0.65, 0.06, 0.4, positionX, 0.35, positionZ, yaw);
    }
    if (section % 4 === 1) {
      const shard = new THREE.OctahedronGeometry(0.23, 0);
      shard.scale(0.7, 2.4, 0.7);
      build.add(shard, crystal, new THREE.Vector3(Math.cos(angle) * (radius - 0.42), height * 0.55, Math.sin(angle) * (radius - 0.42)));
    }
  }
  for (const side of [-1, 1]) {
    const angle = entranceAngle + side * (gateHalfAngle + 0.035);
    const positionX = Math.cos(angle) * wallRadius;
    const positionZ = Math.sin(angle) * wallRadius;
    const yaw = Math.PI / 2 - angle;
    build.cylinder(stone.stoneDark, 0.72, 0.96, 0.45, positionX, 0.22, positionZ, 8);
    build.cylinder(stone.stoneLight, 0.42, 0.61, 2.5, positionX, 1.6, positionZ, 6);
    for (const height of [0.65, 2.65]) build.box(stone.stoneDark, 1.18, 0.16, 1.18, positionX, height, positionZ, yaw);
    build.cylinder(stone.stoneDark, 0.62, 0.48, 0.28, positionX, 2.95, positionZ, 8);
    const shard = new THREE.OctahedronGeometry(0.47, 0);
    shard.scale(0.65, 1.8, 0.65);
    build.add(shard, crystal, new THREE.Vector3(positionX, 3.65, positionZ));
    const fin = new THREE.ConeGeometry(0.6, 3.8, 4);
    fin.scale(0.55, 1, 1.3);
    build.add(fin, stone.stoneLight, new THREE.Vector3(positionX + Math.cos(angle) * 0.67, 2.25, positionZ + Math.sin(angle) * 0.67), new THREE.Euler(side * 0.12, yaw, side * 0.12));
  }
  const rear = entranceAngle + Math.PI;
  const rearYaw = Math.PI / 2 - rear;
  for (const side of [-1, 1]) {
    const angle = rear + side * 0.35;
    const shard = new THREE.ConeGeometry(0.95, side === 1 ? 5.3 : 4.6, 4);
    shard.scale(0.5, 1, 0.75);
    build.add(shard, stone.stoneLight, new THREE.Vector3(Math.cos(angle) * (wallRadius + 0.3), 2.75, Math.sin(angle) * (wallRadius + 0.3)), new THREE.Euler(0.12, Math.PI / 2 - angle, side * 0.18));
  }
  for (let segment = 0; segment < 8; segment++) {
    if (segment === 4) continue;
    const angle = segment / 8 * Math.PI;
    const localX = Math.cos(angle) * 1.8;
    const arch = new THREE.BoxGeometry(0.78, 0.4, 0.55);
    const position = new THREE.Vector3(Math.cos(rear) * (wallRadius - 0.05) + Math.cos(rearYaw) * localX,
      2.25 + Math.sin(angle) * 1.65, Math.sin(rear) * (wallRadius - 0.05) - Math.sin(rearYaw) * localX);
    build.add(arch, stone.stoneDark, position, new THREE.Euler(0, rearYaw, angle - Math.PI / 2));
  }
  for (let segment = 0; segment < 12; segment++) {
    const start = segment / 12 * Math.PI * 2;
    build.ring(stone.stoneDark, 2.25, 2.55, 0.022, start + 0.025, Math.PI / 6 - 0.05);
    build.ring(inlay, 2.33, 2.38, 0.026, start + 0.08, Math.PI / 6 - 0.16);
    build.ring(stone.stoneLight, 3.2, 3.5, 0.021, start + 0.03, Math.PI / 6 - 0.10);
    build.box(inlay, 0.09, 0.006, 0.4, Math.cos(start) * 2.68, 0.028, Math.sin(start) * 2.68, Math.PI / 2 - start);
  }
  const group = build.finish('objective-ruins');
  group.userData.entranceAngle = entranceAngle;
  group.userData.clearRadius = 2.2;
  return group;
}

function factionMaterials(team: 'blue' | 'red') {
  const blue = team === 'blue';
  return {
    metal: new THREE.MeshStandardMaterial({ color: blue ? 0x53656e : 0x474851, metalness: 0.42, roughness: 0.65 }),
    trim: new THREE.MeshStandardMaterial({ color: blue ? 0xb4a47e : 0xa18d76, metalness: 0.55, roughness: 0.4 }),
    cloth: new THREE.MeshStandardMaterial({ color: blue ? 0x1b6093 : 0xa52d2a, roughness: 0.98, side: THREE.DoubleSide }),
    crystal: new THREE.MeshPhysicalMaterial({ color: blue ? 0x58cbf4 : 0xf44b3d, emissive: blue ? 0x116bb1 : 0xb32112,
      emissiveIntensity: 0.65, metalness: 0.15, roughness: 0.18, clearcoat: 1 }),
    light: new THREE.MeshBasicMaterial({ color: blue ? 0x8addff : 0xff8b63 }),
    fire: new THREE.MeshStandardMaterial({ color: 0xffd281, emissive: 0xff961e, emissiveIntensity: 1.8, roughness: 0.5 }),
  };
}

type FactionMaterials = ReturnType<typeof factionMaterials>;

function addBrazier(build: Masonry, stone: StoneMaterials, faction: FactionMaterials, x: number, y: number, z: number) {
  build.cylinder(stone.stoneDark, 0.32, 0.24, 0.18, x, y, z, 8);
  build.cylinder(faction.trim, 0.28, 0.12, 0.2, x, y + 0.15, z, 8);
  const flame = new THREE.OctahedronGeometry(0.2, 0);
  flame.scale(0.8, 1.8, 0.8);
  build.add(flame, faction.fire, new THREE.Vector3(x, y + 0.45, z));
}

function addBanner(build: Masonry, faction: FactionMaterials, x: number, y: number, z: number, yaw: number) {
  const geometry = new THREE.PlaneGeometry(0.72, 2.05, 8, 16);
  const positions = geometry.getAttribute('position');
  for (let vertex = 0; vertex < positions.count; vertex++) {
    const horizontal = positions.getX(vertex);
    const drop = 1.025 - positions.getY(vertex);
    positions.setXYZ(vertex, horizontal, positions.getY(vertex) - Math.max(0, drop - 1.8) * (1 - Math.abs(horizontal) / 0.36),
      Math.sin(drop * 4.5 + horizontal * 3) * drop * 0.065);
  }
  geometry.computeVertexNormals();
  build.add(geometry, faction.cloth, new THREE.Vector3(x, y, z), new THREE.Euler(0, yaw, 0));
  build.box(faction.trim, 0.94, 0.07, 0.07, x, y + 1.08, z, yaw);
  const emblem = new THREE.CircleGeometry(0.17, 4);
  build.add(emblem, faction.trim, new THREE.Vector3(x + Math.sin(yaw) * 0.14, y + 0.25, z + Math.cos(yaw) * 0.14), new THREE.Euler(0, yaw, 0));
}

function addPillar(build: Masonry, stone: StoneMaterials, faction: FactionMaterials, x: number, z: number, height: number, yaw: number, banner: boolean) {
  build.box(stone.stoneDark, 1.04, 0.22, 1.04, x, 0.11, z, yaw);
  build.cylinder(stone.stoneLight, 0.35, 0.49, height, x, height / 2 + 0.2, z, 4);
  build.box(faction.metal, 0.67, 0.12, 0.67, x, height * 0.45, z, yaw);
  build.box(stone.stoneLight, 0.93, 0.16, 0.93, x, height + 0.25, z, yaw);
  addBrazier(build, stone, faction, x, height + 0.46, z);
  if (banner) addBanner(build, faction, x + Math.sin(yaw) * 0.47, height - 0.5, z + Math.cos(yaw) * 0.47, yaw);
}

export function buildCitadel(team: 'blue' | 'red', stone: StoneMaterials) {
  const build = new Masonry();
  const faction = factionMaterials(team);
  const rotation = team === 'blue' ? 0 : Math.PI;
  const gates = BASE_LAYOUT.gates.map(angle => angle + rotation);
  const { radius, rampWidth } = BASE_LAYOUT;
  const gateHalfAngle = rampWidth / (radius * 2) + 0.015;
  build.cylinder(stone.stoneDark, radius + 0.38, radius + 0.55, 0.24, 0, -0.11, 0, 128);
  for (let band = 0; band < 17; band++) {
    const inner = 0.6 + band * 1.16;
    if (inner >= radius) continue;
    const sections = Math.max(10, Math.round(inner * 4.8));
    for (let segment = 0; segment < sections; segment++) {
      const start = segment * Math.PI * 2 / sections + (band % 2) * Math.PI / sections;
      build.ring((band + segment) % 4 === 0 ? stone.stoneLight : stone.stoneWarm,
        inner + 0.025, Math.min(radius, inner + 1.12), 0.018 + band * 0.0005, start + 0.004, Math.PI * 2 / sections - 0.008);
    }
  }
  for (const edge of [3.5, 5.9, 12.8, radius - 0.25]) {
    build.ring(stone.stoneDark, edge - 0.07, edge + 0.12, 0.035);
    build.ring(faction.trim, edge, edge + 0.035, 0.038);
  }
  for (let segment = 0; segment < 128; segment++) {
    const angle = segment / 128 * Math.PI * 2;
    const distanceToGate = Math.min(...gates.map(gate => Math.abs(Math.atan2(Math.sin(angle - gate), Math.cos(angle - gate)))));
    if (distanceToGate < gateHalfAngle) continue;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const yaw = -angle;
    build.box(stone.stoneDark, 0.82, 0.32, 1.05, x, 0.16, z, yaw);
    for (let course = 0; course < 3; course++) {
      build.box(course === 1 ? faction.metal : stone.stone, 0.56, 0.4, 0.94, x, 0.55 + course * 0.42, z, yaw);
    }
    build.box(stone.stoneLight, 0.82, 0.18, 1.07, x, 1.66, z, yaw);
    if (segment % 2 === 0) build.box(stone.stoneLight, 0.58, 0.35, 0.42, x, 1.9, z, yaw);
    if (segment % 6 === 0) addPillar(build, stone, faction, x, z, 2.9, Math.PI / 2 - angle, true);
  }
  for (const angle of gates) {
    for (const side of [-1, 1]) {
      const position = angle + side * (gateHalfAngle + 0.025);
      addPillar(build, stone, faction, Math.cos(position) * radius, Math.sin(position) * radius, 2.25, Math.PI / 2 - angle, true);
    }
    for (let mark = 0; mark < 9; mark++) {
      const along = 9.2 + mark * 1.1;
      build.box(faction.light, 0.11, 0.012, 0.7, Math.cos(angle) * along, 0.048, Math.sin(angle) * along, Math.PI / 2 - angle);
    }
  }

  build.cylinder(stone.stoneDark, 3.22, 3.5, 0.18, 0, 0.09, 0, 48);
  build.cylinder(stone.stoneLight, 2.92, 3.15, 0.18, 0, 0.27, 0, 48);
  build.cylinder(faction.metal, 2.25, 2.62, 0.45, 0, 0.56, 0, 32);
  build.ring(faction.trim, 2.28, 2.4, 0.80);
  build.cylinder(stone.stoneDark, 1.25, 1.75, 0.57, 0, 1.0, 0, 16);
  build.ring(faction.light, 1.38, 1.52, 1.2);
  const crystal = new THREE.OctahedronGeometry(1, 0);
  crystal.scale(0.88, 2.35, 0.88);
  build.add(crystal, faction.crystal, new THREE.Vector3(0, 3.05, 0), new THREE.Euler(0, 0.3, 0.10));
  for (let shardIndex = 0; shardIndex < 5; shardIndex++) {
    const angle = shardIndex * Math.PI * 2 / 5;
    const x = Math.cos(angle) * 1.14;
    const z = Math.sin(angle) * 1.14;
    const shard = new THREE.OctahedronGeometry(0.38, 0);
    shard.scale(0.65, 2.7, 0.7);
    build.add(shard, faction.crystal, new THREE.Vector3(x, 1.9, z), new THREE.Euler(Math.sin(angle) * 0.2, angle, Math.cos(angle) * 0.2));
  }
  for (let support = 0; support < 8; support++) {
    const angle = support * Math.PI / 4;
    const points = [new THREE.Vector3(Math.cos(angle) * 2.65, 0.2, Math.sin(angle) * 2.65),
      new THREE.Vector3(Math.cos(angle) * 1.95, 0.95, Math.sin(angle) * 1.95),
      new THREE.Vector3(Math.cos(angle) * 1.6, 1.65, Math.sin(angle) * 1.6)];
    build.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 12, 0.14, 6, false), faction.trim);
  }
  const fountainX = team === 'blue' ? -4.7 : 4.7;
  const fountainZ = -fountainX;
  build.cylinder(stone.stoneLight, 2.02, 2.22, 0.11, fountainX, 0.09, fountainZ, 48);
  build.cylinder(faction.metal, 1.8, 1.9, 0.1, fountainX, 0.17, fountainZ, 48);
  for (const ring of [0.65, 1.25, 1.65]) build.ring(faction.light, ring - 0.04, ring + 0.04, 0.23, 0, Math.PI * 2, fountainX, fountainZ);
  const group = build.finish(`${team}-base`);
  group.userData.gates = gates;
  group.userData.plazaRadius = radius;
  group.userData.towerSites = [];
  for (const angle of gates) {
    const tower = buildDefenseTower(team, stone);
    tower.position.set(Math.cos(angle + 0.08) * (radius - 3.2), 0.05, Math.sin(angle + 0.08) * (radius - 3.2));
    tower.scale.set(0.78, 2, 0.78);
    tower.userData.role = 'gate';
    group.userData.towerSites.push(tower.position.toArray());
    group.add(tower);
  }
  for (const side of [-1, 1]) {
    const angle = BASE_LAYOUT.gates[1] + rotation + side * 0.65;
    const tower = buildDefenseTower(team, stone);
    tower.position.set(Math.cos(angle) * 7.4, 0.05, Math.sin(angle) * 7.4);
    tower.scale.set(0.78, 2, 0.78);
    tower.userData.role = 'throne';
    group.userData.towerSites.push(tower.position.toArray());
    group.add(tower);
  }
  return group;
}

export function buildDefenseTower(team: 'blue' | 'red', stone: StoneMaterials) {
  const build = new Masonry();
  const faction = factionMaterials(team);
  build.cylinder(stone.stoneDark, 1.1, 1.27, 0.14, 0, 0.07, 0, 32);
  build.cylinder(stone.stoneLight, 0.98, 1.1, 0.18, 0, 0.23, 0, 32);
  build.ring(faction.trim, 0.82, 0.91, 0.33);
  build.cylinder(faction.metal, 0.53, 0.76, 1.5, 0, 1.08, 0, 12);
  for (let support = 0; support < 4; support++) {
    const angle = support * Math.PI / 2 + Math.PI / 4;
    build.box(stone.stoneLight, 0.16, 1.2, 0.22, Math.cos(angle) * 0.61, 0.94, Math.sin(angle) * 0.61, -angle);
  }
  build.cylinder(stone.stoneLight, 0.7, 0.6, 0.17, 0, 1.88, 0, 12);
  build.cylinder(faction.trim, 0.59, 0.66, 0.16, 0, 2.06, 0, 12);
  const crystal = new THREE.OctahedronGeometry(0.42, 0);
  crystal.scale(0.8, 1.55, 0.8);
  build.add(crystal, faction.crystal, new THREE.Vector3(0, 2.62, 0));
  for (let prong = 0; prong < 4; prong++) {
    const angle = prong * Math.PI / 2;
    build.cylinder(faction.metal, 0.05, 0.11, 0.8, Math.cos(angle) * 0.46, 2.45, Math.sin(angle) * 0.46, 5);
  }
  const tower = build.finish(`${team}-defense-tower`);
  tower.scale.y = 2;
  return tower;
}

export function buildMasonryWalls(paths: readonly (readonly (readonly [number, number])[])[], stone: StoneMaterials,
  isGate: (x: number, z: number) => boolean, height = 1.35) {
  const build = new Masonry();
  const blue = factionMaterials('blue');
  const red = factionMaterials('red');
  let count = 0;
  for (const path of paths) {
    const curve = new THREE.CatmullRomCurve3(path.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'catmullrom', 0.35);
    const segments = Math.ceil(curve.getLength() / 1.35);
    for (let segment = 0; segment < segments; segment++) {
      const start = curve.getPointAt(segment / segments);
      const end = curve.getPointAt((segment + 1) / segments);
      const center = start.clone().add(end).multiplyScalar(0.5);
      if (isGate(center.x, center.z)) continue;
      const yaw = Math.atan2(end.x - start.x, end.z - start.z);
      const length = start.distanceTo(end) + 0.05;
      build.box(stone.stoneDark, 0.84, 0.24, length, center.x, 0.12, center.z, yaw);
      for (let course = 0; course < 3; course++) {
        build.box(course === 1 ? stone.stone : stone.stoneLight, 0.58, height / 3 - 0.025, length - 0.035,
          center.x, 0.24 + height / 6 + course * height / 3, center.z, yaw);
      }
      build.box(stone.stoneLight, 0.83, 0.17, length, center.x, height + 0.3, center.z, yaw);
      if (height > 1 && segment % 5 === 0) addPillar(build, stone, center.x + center.z < 0 ? blue : red, center.x, center.z, height + 0.65, yaw + Math.PI / 2, segment % 10 === 0);
      count++;
    }
  }
  const group = build.finish(height > 1 ? 'perimeter-walls' : 'jungle-retaining-walls');
  group.userData.segments = count;
  return group;
}