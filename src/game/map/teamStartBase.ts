import * as THREE from 'three';
import type { GameEntity, GameEntityRegistry } from '../entities/gameEntities';
import {
  emitWorldCombatEvent,
  getMostRecentAttackOnTarget,
  getWorldEntityRuntime,
  publishWorldAttackEvent,
  publishWorldEntityRuntime,
  registerWorldAttackEventGuard,
  registerWorldCombatEventGuard,
  subscribeWorldCombatEvents,
  type WorldCombatEvent,
} from '../entities/worldCombatBridge';
import { makeCanvasTexture } from '../shared/textures';
import {
  TEAM_START_BASE_LAYOUT,
  getTeamBaseShopPosition,
  getTeamStartSpawnPosition,
} from './mapLayout';

type CombatTeam = 'blue' | 'red';
type Basis = ReturnType<typeof startBaseBasis>;
type GameplayHandle = { dispose(): void };
type ProtectedHpState = { value: number; restore(): void };

type StartBaseMaterials = {
  stone: THREE.MeshStandardMaterial;
  stoneLight: THREE.MeshStandardMaterial;
  stoneDark: THREE.MeshStandardMaterial;
  gold: THREE.MeshStandardMaterial;
  team: THREE.MeshStandardMaterial;
  glow: THREE.MeshStandardMaterial;
  crystal: THREE.MeshPhysicalMaterial;
  water: THREE.MeshPhysicalMaterial;
  waterJet: THREE.MeshBasicMaterial;
  cloth: THREE.MeshStandardMaterial;
  foliage: THREE.MeshStandardMaterial;
  trunk: THREE.MeshStandardMaterial;
  soil: THREE.MeshStandardMaterial;
};

const SYSTEM_KEY = 'dawnreachTeamStartBaseGameplay';
const DAMAGE_ASSOCIATION_MS = 260;
const REGEN_LOCK_MS = 3_000;
const DEFENSE_TICK_SECONDS = 0.10;
const INSIDE_MARGIN = 0.34;
const TRIANGLE_BUDGET = 18_000;
const FOUNTAIN_BEAM_ORIGIN_Y = 2.02;
const TEMP_A = new THREE.Vector3();
const TEMP_B = new THREE.Vector3();

export function installTeamStartBase(battlefield: THREE.Group, team: CombatTeam = 'blue') {
  const existing = battlefield.getObjectByName(`${team}-team-start-base`) as THREE.Group | undefined;
  if (existing) return existing;

  const center = getTeamBaseShopPosition(team);
  const root = buildTeamStartBase(team);
  root.position.set(center.x, 0, center.z);
  battlefield.add(root);
  bootstrapGameplay(root, team);
  return root;
}

function buildTeamStartBase(team: CombatTeam) {
  const root = new THREE.Group();
  root.name = `${team}-team-start-base`;
  root.userData.prefab = 'TeamStartBase';
  root.userData.team = team;
  root.userData.triggerRadius = TEAM_START_BASE_LAYOUT.radius;
  root.userData.waterDepth = TEAM_START_BASE_LAYOUT.waterDepth;
  root.userData.elevation = TEAM_START_BASE_LAYOUT.elevation;

  const materials = createMaterials(team);
  const basis = startBaseBasis(team);
  const rampAngle = Math.atan2(basis.inwardZ, basis.inwardX);
  const rampHalfAngle = Math.asin(Math.min(
    0.98,
    (TEAM_START_BASE_LAYOUT.rampWidth * 0.5 + 0.30) / (TEAM_START_BASE_LAYOUT.radius - 0.12),
  ));
  const fountainOffset = basisOffset(
    basis,
    TEAM_START_BASE_LAYOUT.fountainForward,
    TEAM_START_BASE_LAYOUT.fountainSide,
  );
  const waterY = TEAM_START_BASE_LAYOUT.elevation + 0.018 + TEAM_START_BASE_LAYOUT.waterDepth;

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(TEAM_START_BASE_LAYOUT.radius - 0.22, 64),
    materials.stone,
  );
  floor.name = `${team}-team-start-platform`;
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = TEAM_START_BASE_LAYOUT.elevation + 0.018;
  floor.userData.commandSurface = true;
  floor.receiveShadow = true;
  root.add(floor);

  addShopApron(root, materials, waterY);
  addRuneFloor(root, materials, fountainOffset, waterY);
  addRetainingWall(root, materials, rampAngle, rampHalfAngle);
  addCliffVisionRing(root);
  addRamp(root, materials, rampAngle);
  addSpillways(root, materials, rampAngle);
  addLanterns(root, materials, basis, rampAngle);
  const bannerCloths = addBanners(root, materials, basis);
  addPlanters(root, materials, basis);

  const waterGeometry = new THREE.CircleGeometry(TEAM_START_BASE_LAYOUT.radius - 0.72, 64);
  waterGeometry.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(waterGeometry, materials.water);
  water.name = `${team}-team-start-healing-water`;
  water.position.y = waterY;
  // Keep the healing pool out of createDawnreachGame's river-only geometry deformation.
  // waterEffects.ts consumes this dedicated semantic flag for footsteps/ripples instead.
  water.userData.waterSurfaceType = 'healing-pool';
  water.userData.waterEffectsSurface = true;
  water.userData.teamHealingWater = true;
  water.renderOrder = 2;
  water.receiveShadow = true;
  root.add(water);

  // The authored octagonal shop stays untouched. This proxy only gives its existing footprint
  // a collider inside the new platform because the start-base geometry is built around it.
  const shopProxy = new THREE.Group();
  shopProxy.name = `${team}-team-start-shop-collision-proxy`;
  shopProxy.userData.collisionRadius = 1.62;
  shopProxy.userData.structureKind = 'shop-proxy';
  root.add(shopProxy);

  const fountain = buildFountain(team, materials);
  fountain.position.set(fountainOffset.x, TEAM_START_BASE_LAYOUT.elevation, fountainOffset.z);
  root.add(fountain);

  const spawnWorld = getTeamStartSpawnPosition(team);
  const center = getTeamBaseShopPosition(team);
  const spawn = new THREE.Group();
  spawn.name = team === 'blue' ? 'TeamSpawnPoint' : `${team}-TeamSpawnPoint`;
  spawn.position.set(
    spawnWorld.x - center.x,
    waterY + 0.03,
    spawnWorld.z - center.z,
  );
  spawn.userData.teamSpawnPoint = true;
  spawn.userData.team = team;
  root.add(spawn);

  const animateFountain = fountain.userData.updateFountain as ((elapsed: number) => void) | undefined;
  const bannerBasePositions = bannerCloths.map(cloth => (
    cloth.geometry.getAttribute('position') as THREE.BufferAttribute
  ).clone());
  root.userData.animate = (elapsed: number) => {
    const bump = materials.water.bumpMap;
    if (bump) bump.offset.set(elapsed * 0.006, elapsed * 0.009);
    materials.water.opacity = 0.145 + Math.sin(elapsed * 0.72) * 0.012;
    animateFountain?.(elapsed);
    bannerCloths.forEach((cloth, clothIndex) => {
      const positions = cloth.geometry.getAttribute('position') as THREE.BufferAttribute;
      const base = bannerBasePositions[clothIndex];
      for (let vertex = 0; vertex < positions.count; vertex++) {
        const x = base.getX(vertex);
        const y = base.getY(vertex);
        const wave = Math.sin(elapsed * 1.35 + y * 2.2 + x * 1.5 + clothIndex) * 0.035
          + Math.sin(elapsed * 0.72 + y * 4.1) * 0.012;
        positions.setXYZ(vertex, x, y, base.getZ(vertex) + wave);
      }
      positions.needsUpdate = true;
      cloth.geometry.computeVertexNormals();
    });
  };

  const triangles = estimateTriangles(root);
  root.userData.triangleCountEstimate = triangles;
  root.userData.triangleBudget = TRIANGLE_BUDGET;
  if (triangles > TRIANGLE_BUDGET) {
    console.warn(`[Dawnreach] Team start base triangle budget exceeded: ${triangles}/${TRIANGLE_BUDGET}`);
  }
  return root;
}

function createMaterials(team: CombatTeam): StartBaseMaterials {
  const blue = team === 'blue';
  const stoneTexture = makeCanvasTexture(2048, (ctx, size) => {
    ctx.fillStyle = '#8f8a78';
    ctx.fillRect(0, 0, size, size);
    const cell = size / 16;
    for (let row = 0; row < 16; row++) {
      const offset = row % 2 ? cell * 0.5 : 0;
      for (let col = -1; col < 17; col++) {
        const px = col * cell + offset;
        const py = row * cell;
        const shade = 126 + ((col * 17 + row * 31 + 128) % 34);
        ctx.fillStyle = `rgb(${shade + 20},${shade + 17},${shade + 5})`;
        ctx.fillRect(px + 5, py + 5, cell - 10, cell - 10);
        ctx.strokeStyle = 'rgba(45,49,45,0.38)';
        ctx.lineWidth = 4;
        ctx.strokeRect(px + 5, py + 5, cell - 10, cell - 10);
      }
    }
    for (let i = 0; i < 1200; i++) {
      const x = pseudo(i * 37 + 7) * size;
      const y = pseudo(i * 83 + 13) * size;
      const alpha = 0.025 + pseudo(i * 19 + 3) * 0.07;
      ctx.fillStyle = i % 2 ? `rgba(27,31,29,${alpha})` : `rgba(239,229,198,${alpha})`;
      ctx.fillRect(x, y, 2 + pseudo(i * 11) * 5, 2 + pseudo(i * 29) * 5);
    }
  }, 5.4, 5.4);

  const waterBump = makeCanvasTexture(1024, (ctx, size) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, size, size);
    ctx.lineWidth = 2;
    for (let i = 0; i < 54; i++) {
      const baseY = i / 54 * size;
      ctx.strokeStyle = `rgba(218,218,218,${0.045 + (i % 4) * 0.009})`;
      ctx.beginPath();
      for (let x = 0; x <= size; x += 20) {
        const wave = Math.sin(x * 0.023 + i * 0.66) * (4 + (i % 6));
        if (x === 0) ctx.moveTo(x, baseY + wave);
        else ctx.lineTo(x, baseY + wave);
      }
      ctx.stroke();
    }
  }, 2.4, 2.4);
  waterBump.colorSpace = THREE.NoColorSpace;

  return {
    stone: new THREE.MeshStandardMaterial({ map: stoneTexture, bumpMap: stoneTexture, bumpScale: 0.055,
      color: 0xb7ae92, roughness: 0.94, metalness: 0.015 }),
    stoneLight: new THREE.MeshStandardMaterial({ map: stoneTexture, bumpMap: stoneTexture, bumpScale: 0.038,
      color: 0xd1c6a7, roughness: 0.91, metalness: 0.02 }),
    stoneDark: new THREE.MeshStandardMaterial({ map: stoneTexture, bumpMap: stoneTexture, bumpScale: 0.07,
      color: 0x626760, roughness: 0.98, metalness: 0.012 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xc6a45a, roughness: 0.38, metalness: 0.66 }),
    team: new THREE.MeshStandardMaterial({ color: blue ? 0x285f88 : 0x8d3d3b, roughness: 0.58, metalness: 0.32 }),
    glow: new THREE.MeshStandardMaterial({ color: blue ? 0x78d4f2 : 0xf17c72,
      emissive: blue ? 0x0a6f9e : 0x98251f, emissiveIntensity: 0.82, roughness: 0.38, metalness: 0.12 }),
    crystal: new THREE.MeshPhysicalMaterial({ color: blue ? 0x70dcff : 0xff7065,
      emissive: blue ? 0x087bb7 : 0xb52b22, emissiveIntensity: 1.85, roughness: 0.08,
      metalness: 0.03, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0.95 }),
    water: new THREE.MeshPhysicalMaterial({ color: blue ? 0xa6dce1 : 0xe0aaa5, roughness: 0.26,
      metalness: 0, clearcoat: 0.82, clearcoatRoughness: 0.12, ior: 1.333,
      bumpMap: waterBump, bumpScale: 0.014, transparent: true, opacity: 0.145, depthWrite: false }),
    waterJet: new THREE.MeshBasicMaterial({ color: blue ? 0xcdf8ff : 0xffd5cf,
      transparent: true, opacity: 0.58, depthWrite: false, toneMapped: false }),
    cloth: new THREE.MeshStandardMaterial({ color: blue ? 0x173f6c : 0x703035,
      roughness: 0.9, metalness: 0.02, side: THREE.DoubleSide }),
    foliage: new THREE.MeshStandardMaterial({ color: 0x29452f, roughness: 0.98 }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x66523e, roughness: 1 }),
    soil: new THREE.MeshStandardMaterial({ color: 0x333326, roughness: 1 }),
  };
}

function addShopApron(root: THREE.Group, materials: StartBaseMaterials, waterY: number) {
  const apron = new THREE.Mesh(new THREE.CircleGeometry(2.05, 40), materials.stoneLight);
  apron.name = 'team-start-shop-apron';
  apron.rotation.x = -Math.PI / 2;
  apron.position.y = waterY + 0.012;
  apron.receiveShadow = true;
  apron.userData.commandSurface = true;
  root.add(apron);

  const trim = new THREE.Mesh(new THREE.RingGeometry(1.91, 2.05, 40), materials.gold);
  trim.rotation.x = -Math.PI / 2;
  trim.position.y = waterY + 0.019;
  trim.scale.y = 0.94;
  root.add(trim);
}

function addRuneFloor(
  root: THREE.Group,
  materials: StartBaseMaterials,
  fountainOffset: Readonly<{ x: number; z: number }>,
  waterY: number,
) {
  const glow = materials.glow.clone();
  glow.transparent = true;
  glow.opacity = 0.42;

  for (const [start, length] of [[0.18, 1.12], [Math.PI + 0.22, 0.92]] as const) {
    const arc = new THREE.Mesh(new THREE.RingGeometry(1.62, 1.68, 32, 1, start, length), glow);
    arc.rotation.x = -Math.PI / 2;
    arc.position.set(fountainOffset.x, waterY + 0.022, fountainOffset.z);
    arc.renderOrder = 3;
    root.add(arc);
  }

  for (let index = 0; index < 8; index++) {
    const angle = index / 8 * Math.PI * 2 + 0.18;
    const rune = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.018, 0.38), glow);
    rune.position.set(
      fountainOffset.x + Math.cos(angle) * 1.94,
      waterY + 0.026,
      fountainOffset.z + Math.sin(angle) * 1.94,
    );
    rune.rotation.y = Math.PI / 2 - angle;
    rune.renderOrder = 3;
    root.add(rune);
  }
}

function addRetainingWall(root: THREE.Group, materials: StartBaseMaterials, rampAngle: number, rampHalfAngle: number) {
  const segments = 40;
  const radius = TEAM_START_BASE_LAYOUT.radius - 0.04;
  const step = Math.PI * 2 / segments;
  const baseWidth = 2 * radius * Math.sin(step / 2) * 1.08;
  const courseHeight = (TEAM_START_BASE_LAYOUT.elevation - 0.10) / 3;

  for (let index = 0; index < segments; index++) {
    const angle = (index + 0.5) * step;
    if (angularDistance(angle, rampAngle) < rampHalfAngle) continue;
    const edge = new THREE.Group();
    edge.name = 'base-ramp-architectural-edge';

    for (let course = 0; course < 3; course++) {
      const radialJitter = (pseudo(index * 17 + course * 23) - 0.5) * 0.075;
      const tangentialJitter = (pseudo(index * 41 + course * 11) - 0.5) * 0.08;
      const width = baseWidth * (0.97 + pseudo(index * 29 + course * 7) * 0.055);
      const material = (index + course) % 5 === 0
        ? materials.stoneDark
        : course === 2 && index % 4 === 1
          ? materials.stoneLight
          : materials.stone;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(width, courseHeight - 0.025, 0.64), material);
      const r = radius + radialJitter;
      wall.position.set(
        Math.cos(angle) * r - Math.sin(angle) * tangentialJitter,
        0.05 + courseHeight * (course + 0.5),
        Math.sin(angle) * r + Math.cos(angle) * tangentialJitter,
      );
      wall.rotation.y = Math.PI / 2 - angle;
      wall.castShadow = true;
      wall.receiveShadow = true;
      edge.add(wall);
    }

    const cap = new THREE.Mesh(new THREE.BoxGeometry(baseWidth * 1.03, 0.18, 0.78), materials.stoneLight);
    cap.position.set(Math.cos(angle) * radius, TEAM_START_BASE_LAYOUT.elevation + 0.09, Math.sin(angle) * radius);
    cap.rotation.y = Math.PI / 2 - angle;
    cap.castShadow = true;
    cap.receiveShadow = true;
    edge.add(cap);

    if (index % 8 === 2) {
      const clasp = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.48, 0.055), materials.gold);
      clasp.position.set(Math.cos(angle) * (radius + 0.34), 1.93, Math.sin(angle) * (radius + 0.34));
      clasp.rotation.y = Math.PI / 2 - angle;
      edge.add(clasp);
    }
    root.add(edge);
  }
}

function addCliffVisionRing(root: THREE.Group) {
  const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false });
  const segments = 40;
  const radius = TEAM_START_BASE_LAYOUT.radius - 0.18;
  const step = Math.PI * 2 / segments;
  const width = 2 * radius * Math.sin(step / 2) * 1.22;
  const height = TEAM_START_BASE_LAYOUT.elevation + 1.42;
  for (let index = 0; index < segments; index++) {
    const angle = (index + 0.5) * step;
    const blocker = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.52), material);
    blocker.name = 'team-start-cliff-vision-occluder';
    blocker.position.set(Math.cos(angle) * radius, height / 2 - 0.12, Math.sin(angle) * radius);
    blocker.rotation.y = Math.PI / 2 - angle;
    blocker.userData.visionOccluder = true;
    blocker.raycast = () => {};
    root.add(blocker);
  }
}

function addRamp(root: THREE.Group, materials: StartBaseMaterials, angle: number) {
  const halfWidth = TEAM_START_BASE_LAYOUT.rampWidth / 2;
  const innerRadius = TEAM_START_BASE_LAYOUT.radius - 0.76;
  const outerRadius = TEAM_START_BASE_LAYOUT.radius + TEAM_START_BASE_LAYOUT.rampLength;
  const highY = TEAM_START_BASE_LAYOUT.elevation + 0.038;
  const lowY = 0.045;

  const ramp = new THREE.Mesh(quadGeometry(angle, innerRadius, outerRadius, halfWidth, highY, lowY), materials.stoneDark);
  ramp.name = 'team-start-ramp';
  ramp.userData.commandSurface = true;
  ramp.castShadow = true;
  ramp.receiveShadow = true;
  root.add(ramp);

  const segmentCount = 8;
  const segmentLength = (outerRadius - innerRadius) / segmentCount;
  for (let index = 0; index < segmentCount; index++) {
    const r0 = innerRadius + index * segmentLength + 0.035;
    const r1 = innerRadius + (index + 1) * segmentLength - 0.035;
    const t0 = (r0 - innerRadius) / (outerRadius - innerRadius);
    const t1 = (r1 - innerRadius) / (outerRadius - innerRadius);
    const y0 = THREE.MathUtils.lerp(highY + 0.014, lowY + 0.014, t0);
    const y1 = THREE.MathUtils.lerp(highY + 0.014, lowY + 0.014, t1);
    const slabMaterial = index % 4 === 1
      ? materials.stone
      : index % 4 === 3
        ? materials.stoneDark
        : materials.stoneLight;
    const slab = new THREE.Mesh(quadGeometry(angle, r0, r1, halfWidth - 0.22, y0, y1), slabMaterial);
    slab.receiveShadow = true;
    root.add(slab);
  }

  const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
  const tangent = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
  for (const side of [-1, 1]) {
    const edge = new THREE.Group();
    edge.name = 'base-ramp-architectural-edge';
    const lateral = side * (halfWidth + 0.30);
    const start = radial.clone().multiplyScalar(innerRadius).addScaledVector(tangent, lateral);
    const end = radial.clone().multiplyScalar(outerRadius).addScaledVector(tangent, lateral);
    start.y = highY + 0.30;
    end.y = lowY + 0.30;
    edge.add(slopeBeam(start, end, 0.54, 0.40, materials.stoneDark));
    const trimStart = start.clone();
    const trimEnd = end.clone();
    trimStart.y += 0.31;
    trimEnd.y += 0.31;
    edge.add(slopeBeam(trimStart, trimEnd, 0.08, 0.20, materials.gold));
    root.add(edge);
  }
}

function addSpillways(root: THREE.Group, materials: StartBaseMaterials, rampAngle: number) {
  for (const offset of [-1.06, 1.14]) {
    const angle = rampAngle + offset;
    const radius = TEAM_START_BASE_LAYOUT.radius + 0.34;
    const fall = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 1.72), materials.waterJet);
    fall.name = 'team-start-spillway';
    fall.position.set(Math.cos(angle) * radius, 1.30, Math.sin(angle) * radius);
    fall.rotation.y = Math.PI / 2 - angle;
    fall.renderOrder = 4;
    root.add(fall);

    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.16, 0.44), materials.stoneDark);
    lip.position.set(
      Math.cos(angle) * (TEAM_START_BASE_LAYOUT.radius - 0.02),
      TEAM_START_BASE_LAYOUT.elevation + 0.01,
      Math.sin(angle) * (TEAM_START_BASE_LAYOUT.radius - 0.02),
    );
    lip.rotation.y = Math.PI / 2 - angle;
    root.add(lip);
  }
}

function slopeBeam(start: THREE.Vector3, end: THREE.Vector3, height: number, depth: number, material: THREE.Material) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  const xAxis = direction.clone().normalize();
  const zAxis = new THREE.Vector3(-xAxis.z, 0, xAxis.x).normalize();
  const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
  const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, height, depth), material);
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.quaternion.setFromRotationMatrix(basis);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function quadGeometry(angle: number, innerRadius: number, outerRadius: number, halfWidth: number, innerY: number, outerY: number) {
  const rx = Math.cos(angle);
  const rz = Math.sin(angle);
  const tx = -rz;
  const tz = rx;
  const point = (radius: number, side: number, y: number) => [
    rx * radius + tx * halfWidth * side,
    y,
    rz * radius + tz * halfWidth * side,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    ...point(innerRadius, 1, innerY), ...point(innerRadius, -1, innerY),
    ...point(outerRadius, 1, outerY), ...point(outerRadius, -1, outerY),
  ], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
  geometry.setIndex([0, 1, 2, 1, 3, 2]);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function rampHeightAtRadius(radius: number) {
  const innerRadius = TEAM_START_BASE_LAYOUT.radius - 0.76;
  const outerRadius = TEAM_START_BASE_LAYOUT.radius + TEAM_START_BASE_LAYOUT.rampLength;
  const t = THREE.MathUtils.clamp((radius - innerRadius) / (outerRadius - innerRadius), 0, 1);
  return THREE.MathUtils.lerp(TEAM_START_BASE_LAYOUT.elevation + 0.038, 0.045, t);
}

function addLanterns(root: THREE.Group, materials: StartBaseMaterials, basis: Basis, rampAngle: number) {
  const forward = TEAM_START_BASE_LAYOUT.radius + 0.30;
  const sideDistance = TEAM_START_BASE_LAYOUT.rampWidth / 2 + 0.66;
  const baseY = rampHeightAtRadius(forward);
  for (const side of [-1, 1]) {
    const position = basisOffset(basis, forward, side * sideDistance);
    const lantern = new THREE.Group();
    lantern.name = 'team-start-lantern';
    lantern.position.set(position.x, baseY, position.z);
    lantern.rotation.y = -rampAngle;
    lantern.userData.collisionRadius = 0.38;
    lantern.userData.structureKind = 'team-start-lantern';

    const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.50, 0.30, 8), materials.stoneDark);
    foot.position.y = 0.15;
    lantern.add(foot);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.25, 1.12, 6), materials.stoneLight);
    post.position.y = 0.86;
    post.castShadow = true;
    lantern.add(post);
    const crown = new THREE.Mesh(new THREE.OctahedronGeometry(0.30, 0), materials.crystal);
    crown.position.y = 1.56;
    crown.scale.set(0.72, 1.30, 0.72);
    lantern.add(crown);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.055, 6, 18), materials.gold);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.35;
    lantern.add(ring);
    const light = new THREE.PointLight(0x62d9ff, 3.2, 4.2, 2);
    light.position.y = 1.56;
    lantern.add(light);
    root.add(lantern);
  }
}

function addBanners(root: THREE.Group, materials: StartBaseMaterials, basis: Basis) {
  const cloths: THREE.Mesh<THREE.PlaneGeometry>[] = [];
  for (const side of [-1, 1]) {
    const position = basisOffset(basis, 0.05, side * 5.55);
    const banner = new THREE.Group();
    banner.name = 'team-start-banner';
    banner.position.set(position.x, TEAM_START_BASE_LAYOUT.elevation + 0.10, position.z);

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.09, 3.25, 8), materials.gold);
    pole.position.y = 1.62;
    pole.castShadow = true;
    banner.add(pole);

    const topBar = new THREE.Mesh(new THREE.BoxGeometry(1.70, 0.08, 0.08), materials.gold);
    topBar.position.set(side * 0.77, 2.82, 0);
    banner.add(topBar);

    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.50, 1.95, 5, 7), materials.cloth);
    cloth.position.set(side * 0.78, 1.84, 0.04);
    cloth.rotation.y = side > 0 ? -0.08 : 0.08;
    cloth.castShadow = true;
    cloths.push(cloth);
    banner.add(cloth);

    const bottomTrim = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.065, 0.065), materials.gold);
    bottomTrim.position.set(side * 0.78, 0.87, 0.02);
    banner.add(bottomTrim);

    const crest = new THREE.Mesh(new THREE.CircleGeometry(0.22, 6), materials.gold);
    crest.position.set(side * 0.78, 1.85, 0.065);
    banner.add(crest);
    root.add(banner);
  }
  return cloths;
}

function addPlanters(root: THREE.Group, materials: StartBaseMaterials, basis: Basis) {
  const sites = [[-3.8, -5.55, 0.68], [-4.4, 4.65, 0.76], [1.2, 5.55, 0.62]] as const;
  for (const [forward, side, scale] of sites) {
    const position = basisOffset(basis, forward, side);
    const planter = new THREE.Group();
    planter.name = 'team-start-planter';
    planter.position.set(position.x, TEAM_START_BASE_LAYOUT.elevation + 0.08, position.z);
    planter.userData.collisionRadius = 0.62 * scale;
    planter.userData.structureKind = 'team-start-planter';

    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.84, 0.42, 10), materials.stoneDark);
    bowl.position.y = 0.21;
    bowl.scale.setScalar(scale);
    bowl.castShadow = true;
    planter.add(bowl);
    const soil = new THREE.Mesh(new THREE.CircleGeometry(0.63, 10), materials.soil);
    soil.rotation.x = -Math.PI / 2;
    soil.position.y = 0.43 * scale;
    soil.scale.setScalar(scale);
    planter.add(soil);

    const pine = new THREE.Group();
    pine.position.y = 0.40 * scale;
    pine.scale.setScalar(scale);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 1.05, 7), materials.trunk);
    trunk.position.y = 0.52;
    pine.add(trunk);
    for (let tier = 0; tier < 3; tier++) {
      const crown = new THREE.Mesh(new THREE.ConeGeometry(0.72 - tier * 0.11, 1.18, 8), materials.foliage);
      crown.position.y = 1.0 + tier * 0.48;
      crown.castShadow = true;
      pine.add(crown);
    }
    planter.add(pine);
    root.add(planter);
  }
}

function buildFountain(team: CombatTeam, materials: StartBaseMaterials) {
  const fountain = new THREE.Group();
  fountain.name = `${team}-team-start-fountain`;
  fountain.userData.collisionRadius = 1.32;
  fountain.userData.structureKind = 'team-start-fountain';

  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(1.50, 1.64, 0.22, 24), materials.stoneDark);
  plinth.position.y = 0.11;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  fountain.add(plinth);

  const lower = new THREE.Mesh(new THREE.CylinderGeometry(1.40, 1.52, 0.30, 24), materials.stoneLight);
  lower.position.y = 0.34;
  lower.castShadow = true;
  lower.receiveShadow = true;
  fountain.add(lower);
  const lowerRim = new THREE.Mesh(new THREE.TorusGeometry(1.39, 0.085, 8, 28), materials.gold);
  lowerRim.rotation.x = Math.PI / 2;
  lowerRim.position.y = 0.50;
  fountain.add(lowerRim);
  const basinWater = new THREE.Mesh(new THREE.CircleGeometry(1.27, 32), materials.water);
  basinWater.rotation.x = -Math.PI / 2;
  basinWater.position.y = 0.515;
  basinWater.renderOrder = 6;
  fountain.add(basinWater);

  const middleStem = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.82, 0.42, 18), materials.stone);
  middleStem.position.y = 0.78;
  middleStem.castShadow = true;
  fountain.add(middleStem);
  const middleBowl = new THREE.Mesh(new THREE.CylinderGeometry(0.94, 0.72, 0.20, 20), materials.stoneLight);
  middleBowl.position.y = 1.00;
  middleBowl.castShadow = true;
  fountain.add(middleBowl);
  const middleRim = new THREE.Mesh(new THREE.TorusGeometry(0.92, 0.07, 8, 24), materials.gold);
  middleRim.rotation.x = Math.PI / 2;
  middleRim.position.y = 1.11;
  fountain.add(middleRim);

  const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.50, 0.58, 16), materials.stoneLight);
  upper.position.y = 1.42;
  upper.castShadow = true;
  fountain.add(upper);
  const rune = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.05, 7, 24), materials.glow);
  rune.rotation.x = Math.PI / 2;
  rune.position.y = 1.67;
  fountain.add(rune);
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.50, 0.38, 0.14, 16), materials.gold);
  crown.position.y = 1.75;
  fountain.add(crown);

  const crystalPivot = new THREE.Group();
  crystalPivot.name = 'team-start-fountain-crystal';
  crystalPivot.position.y = FOUNTAIN_BEAM_ORIGIN_Y;
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.44, 0), materials.crystal);
  crystal.scale.set(0.78, 1.34, 0.78);
  crystal.castShadow = true;
  crystalPivot.add(crystal);
  const crystalHalo = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.035, 6, 28), materials.glow);
  crystalHalo.rotation.x = Math.PI / 2;
  crystalHalo.position.y = -0.04;
  crystalPivot.add(crystalHalo);
  fountain.add(crystalPivot);

  const light = new THREE.PointLight(team === 'blue' ? 0x54d6ff : 0xff6657, 5.8, 6.6, 2);
  light.position.y = 1.95;
  fountain.add(light);

  const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.075, 3.0, 8, 1, true), materials.waterJet);
  jet.name = 'team-start-fountain-jet';
  jet.position.y = 3.88;
  jet.renderOrder = 7;
  fountain.add(jet);

  const falling = buildParticles(materials.waterJet.color.getHex(), 42, 0.05, 0.64);
  falling.name = 'team-start-fountain-falling-water';
  fountain.add(falling);
  const mist = buildParticles(0xc9f7ff, 26, 0.105, 0.36);
  mist.name = 'team-start-fountain-mist';
  fountain.add(mist);

  const beamGeometry = new THREE.BufferGeometry();
  beamGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const beam = new THREE.Line(beamGeometry, new THREE.LineBasicMaterial({
    color: team === 'blue' ? 0x72e3ff : 0xff7a6c,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    toneMapped: false,
  }));
  beam.name = 'team-start-fountain-defense-beam';
  beam.visible = false;
  beam.renderOrder = 20;
  fountain.add(beam);

  fountain.userData.updateFountain = (elapsed: number) => {
    crystalPivot.rotation.y = elapsed * 0.64;
    crystalPivot.position.y = FOUNTAIN_BEAM_ORIGIN_Y + Math.sin(elapsed * 1.55) * 0.07;
    crystalHalo.rotation.z = elapsed * -0.28;
    jet.scale.x = jet.scale.z = 0.94 + Math.sin(elapsed * 4.9) * 0.06;

    const fallPositions = falling.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let index = 0; index < fallPositions.count; index++) {
      const phase = (index / fallPositions.count + elapsed * (0.28 + (index % 5) * 0.011)) % 1;
      const angle = index * 2.399963229728653;
      const radius = 0.16 + phase * 1.12;
      const height = 5.28 - phase * 4.65 - phase * phase * 0.18;
      fallPositions.setXYZ(index, Math.cos(angle) * radius, height, Math.sin(angle) * radius);
    }
    fallPositions.needsUpdate = true;

    const mistPositions = mist.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let index = 0; index < mistPositions.count; index++) {
      const phase = (index / mistPositions.count + elapsed * 0.09) % 1;
      const angle = index * 2.171 + elapsed * 0.14;
      const radius = 0.34 + phase * 1.12;
      mistPositions.setXYZ(index, Math.cos(angle) * radius, 0.54 + phase * 0.44, Math.sin(angle) * radius);
    }
    mistPositions.needsUpdate = true;
  };
  return fountain;
}

function buildParticles(color: number, count: number, size: number, opacity: number) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({
    color, size, transparent: true, opacity, depthWrite: false, toneMapped: false, sizeAttenuation: true,
  }));
}

function startBaseBasis(team: CombatTeam) {
  const center = getTeamBaseShopPosition(team);
  const length = Math.hypot(center.x, center.z) || 1;
  const inwardX = -center.x / length;
  const inwardZ = -center.z / length;
  return { inwardX, inwardZ, tangentX: -inwardZ, tangentZ: inwardX };
}

function basisOffset(basis: Basis, forward: number, side: number) {
  return {
    x: basis.inwardX * forward + basis.tangentX * side,
    z: basis.inwardZ * forward + basis.tangentZ * side,
  };
}

function bootstrapGameplay(root: THREE.Group, team: CombatTeam) {
  if (typeof requestAnimationFrame !== 'function') return;
  let attempts = 0;
  const poll = () => {
    if (!root.parent || attempts++ > 240) return;
    const scene = findScene(root);
    const registry = scene?.userData.entityRegistry as GameEntityRegistry | undefined;
    if (scene && registry) {
      ensureTeamStartBaseGameplay(scene, registry, root, team);
      return;
    }
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
}

export function ensureTeamStartBaseGameplay(
  scene: THREE.Scene,
  registry: GameEntityRegistry,
  baseRoot: THREE.Group,
  team: CombatTeam = 'blue',
): GameplayHandle {
  const key = `${SYSTEM_KEY}:${team}`;
  const existing = scene.userData[key] as GameplayHandle | undefined;
  if (existing) return existing;

  const center = new THREE.Vector3();
  baseRoot.getWorldPosition(center);
  const fountainRoot = baseRoot.getObjectByName(`${team}-team-start-fountain`) as THREE.Group | undefined;
  const beam = fountainRoot?.getObjectByName('team-start-fountain-defense-beam') as THREE.Line | undefined;
  const healingEffects = new Map<string, THREE.Points>();
  const protectedHp = new Map<string, ProtectedHpState>();
  const lastEnemyHeroDamageAt = new Map<string, number>();
  let disposed = false;
  let lastSeconds = performance.now() * 0.001;
  let defenseAccumulator = 0;
  let animationFrame = 0;

  let fountainEntity: GameEntity | null = null;
  if (fountainRoot) {
    fountainEntity = registry.register(fountainRoot, {
      id: `${team}-team-start-fountain`, displayName: 'Fuente del Alba', kind: 'building', team,
      selectable: false, targetable: false, grantsVision: true, visionRadius: 9, visionHeight: 3.1,
      attackRange: TEAM_START_BASE_LAYOUT.radius, visibilityPolicy: 'structure-in-fog', interaction: 'structure',
      selectionRadius: 1.32, maxHp: 0, showHealthBar: false,
    });
  }

  const findEntity = (id: string) => registry.values().find(entity => entity.id === id);
  const isPointInside = (point: Readonly<{ x: number; z: number }>, margin = INSIDE_MARGIN) =>
    Math.hypot(point.x - center.x, point.z - center.z) <= TEAM_START_BASE_LAYOUT.radius - margin;
  const isInside = (entity: GameEntity, margin = INSIDE_MARGIN) => {
    entity.root.getWorldPosition(TEMP_B);
    return isPointInside(TEMP_B, margin)
      && TEMP_B.y >= TEAM_START_BASE_LAYOUT.elevation - 0.18
      && TEMP_B.y <= TEAM_START_BASE_LAYOUT.elevation + 0.95;
  };

  const recentOutsideEnemyAttack = (target: GameEntity, atMs: number) => {
    const attack = getMostRecentAttackOnTarget(target.id, atMs, DAMAGE_ASSOCIATION_MS);
    if (!attack || attack.attackerTeam === target.team || attack.attackerTeam === 'neutral') return false;
    return !isPointInside(attack.attackerPosition, 0.10);
  };

  const installHpProtection = (hero: GameEntity) => {
    if (protectedHp.has(hero.id)) return;
    const descriptor = Object.getOwnPropertyDescriptor(hero, 'currentHp');
    const state: ProtectedHpState = {
      value: hero.currentHp,
      restore() {
        Object.defineProperty(hero, 'currentHp', {
          configurable: descriptor?.configurable ?? true,
          enumerable: descriptor?.enumerable ?? true,
          writable: true,
          value: state.value,
        });
      },
    };
    Object.defineProperty(hero, 'currentHp', {
      configurable: true,
      enumerable: true,
      get: () => state.value,
      set: (next: number) => {
        const value = Number.isFinite(next) ? next : state.value;
        if (value < state.value && isInside(hero) && recentOutsideEnemyAttack(hero, performance.now())) {
          hero.root.userData.teamStartBaseBlockedDamageAtMs = performance.now();
          return;
        }
        state.value = value;
      },
    });
    protectedHp.set(hero.id, state);
  };

  const protectHeroes = () => {
    for (const entity of registry.values()) {
      if (entity.kind === 'hero' && entity.team === team) installHpProtection(entity);
    }
  };
  protectHeroes();

  const unregisterAttackGuard = registerWorldAttackEventGuard(`team-start-base-attack:${team}`, (event) => {
    if (event.targetTeam !== team || event.attackerTeam === team || event.attackerTeam === 'neutral') return true;
    const target = findEntity(event.targetId);
    if (!target || target.kind !== 'hero' || !isInside(target)) return true;
    return isPointInside(event.attackerPosition, 0.10);
  });

  const restoreBlockedDamage = (target: GameEntity) => {
    const snapshot = getWorldEntityRuntime(target.id);
    if (!snapshot) return;
    target.currentHp = snapshot.currentHp;
    target.currentResource = snapshot.currentResource;
    target.alive = snapshot.alive;
    target.root.userData.currentHp = target.currentHp;
  };

  const unregisterCombatGuard = registerWorldCombatEventGuard(`team-start-base-combat:${team}`, (event) => {
    if (event.reason !== 'damage' && event.reason !== 'death') return true;
    const target = findEntity(event.entityId);
    if (!target || target.kind !== 'hero' || target.team !== team || !isInside(target)) return true;

    let outsideEnemy = recentOutsideEnemyAttack(target, event.atMs);
    if (!outsideEnemy && event.sourceEntityId) {
      const source = findEntity(event.sourceEntityId);
      if (source && source.team !== team && source.team !== 'neutral') {
        source.root.getWorldPosition(TEMP_A);
        outsideEnemy = !isPointInside(TEMP_A, 0.10);
      }
    }
    if (!outsideEnemy) return true;
    restoreBlockedDamage(target);
    return false;
  });

  const unsubscribeCombat = subscribeWorldCombatEvents((event: WorldCombatEvent) => {
    if (event.reason !== 'damage' && event.reason !== 'death') return;
    const target = findEntity(event.entityId);
    if (!target || target.kind !== 'hero' || target.team !== team) return;
    const source = event.sourceEntityId ? findEntity(event.sourceEntityId) : null;
    const recentAttack = getMostRecentAttackOnTarget(target.id, event.atMs, DAMAGE_ASSOCIATION_MS);
    const enemyHero = source?.kind === 'hero' && source.team !== target.team
      ? source
      : recentAttack ? findEntity(recentAttack.attackerId) : null;
    if (enemyHero?.kind === 'hero' && enemyHero.team !== target.team) {
      lastEnemyHeroDamageAt.set(target.id, event.atMs);
    }
  });

  const syncRuntime = (entity: GameEntity) => {
    const previous = getWorldEntityRuntime(entity.id);
    publishWorldEntityRuntime(entity.id, {
      level: entity.level, maxHp: entity.maxHp, currentHp: entity.currentHp,
      maxResource: entity.maxResource, currentResource: entity.currentResource, alive: entity.alive,
      ...(previous?.physicalArmor === undefined ? {} : { physicalArmor: previous.physicalArmor }),
      ...(previous?.magicResistance === undefined ? {} : { magicResistance: previous.magicResistance }),
      ...(previous?.movementSpeed === undefined ? {} : { movementSpeed: previous.movementSpeed }),
      ...(previous?.magicPower === undefined ? {} : { magicPower: previous.magicPower }),
      ...(previous?.statuses ? { statuses: previous.statuses } : {}),
    });
  };

  const updateHealFx = (entity: GameEntity, active: boolean, elapsed: number) => {
    let effect = healingEffects.get(entity.id);
    if (!effect && active) {
      effect = buildHealingParticles();
      scene.add(effect);
      healingEffects.set(entity.id, effect);
    }
    if (!effect) return;
    effect.visible = active && entity.alive && Boolean(entity.root.parent);
    if (!effect.visible) return;
    entity.root.getWorldPosition(TEMP_B);
    effect.position.set(TEMP_B.x, TEMP_B.y + 0.18, TEMP_B.z);
    const positions = effect.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let index = 0; index < positions.count; index++) {
      const phase = (elapsed * 0.42 + index / positions.count) % 1;
      const angle = index * 2.399963229728653 + elapsed * 0.45;
      const radius = 0.20 + (index % 5) * 0.045;
      positions.setXYZ(index, Math.cos(angle) * radius, phase * 1.65, Math.sin(angle) * radius);
    }
    positions.needsUpdate = true;
  };

  const applyRegen = (entity: GameEntity, dt: number, nowMs: number, elapsed: number) => {
    if (entity.kind !== 'hero' || entity.team !== team || !entity.alive || !isInside(entity)) {
      updateHealFx(entity, false, elapsed);
      return;
    }
    if (nowMs - (lastEnemyHeroDamageAt.get(entity.id) ?? Number.NEGATIVE_INFINITY) < REGEN_LOCK_MS) {
      updateHealFx(entity, false, elapsed);
      return;
    }
    const beforeHp = entity.currentHp;
    const beforeResource = entity.currentResource;
    entity.currentHp = Math.min(entity.maxHp,
      entity.currentHp + entity.maxHp * TEAM_START_BASE_LAYOUT.hpRegenFractionPerSecond * dt);
    entity.currentResource = Math.min(entity.maxResource,
      entity.currentResource + entity.maxResource * TEAM_START_BASE_LAYOUT.resourceRegenFractionPerSecond * dt);
    entity.root.userData.currentHp = entity.currentHp;
    const hpDelta = entity.currentHp - beforeHp;
    const changed = hpDelta > 0.001 || entity.currentResource - beforeResource > 0.001;
    updateHealFx(entity, changed, elapsed);
    if (!changed) return;
    syncRuntime(entity);
    emitWorldCombatEvent({
      entityId: entity.id, reason: 'heal', currentHp: entity.currentHp,
      currentResource: entity.currentResource, alive: true, atMs: nowMs,
      amount: hpDelta, ...(fountainEntity ? { sourceEntityId: fountainEntity.id } : {}),
    });
  };

  const findDefenseTarget = () => {
    let target: GameEntity | null = null;
    let nearest = Infinity;
    for (const entity of registry.values()) {
      if (entity.kind !== 'hero' || entity.team === team || entity.team === 'neutral' || !entity.alive || !isInside(entity, 0.10)) continue;
      entity.root.getWorldPosition(TEMP_B);
      const distance = Math.hypot(TEMP_B.x - center.x, TEMP_B.z - center.z);
      if (distance < nearest) { nearest = distance; target = entity; }
    }
    return target;
  };

  const updateBeam = (target: GameEntity | null, elapsed: number) => {
    if (!beam || !fountainRoot) return;
    beam.visible = Boolean(target);
    if (!target) return;
    const positions = beam.geometry.getAttribute('position') as THREE.BufferAttribute;
    target.root.getWorldPosition(TEMP_B);
    fountainRoot.getWorldPosition(TEMP_A);
    positions.setXYZ(0, 0, FOUNTAIN_BEAM_ORIGIN_Y, 0);
    positions.setXYZ(1, TEMP_B.x - TEMP_A.x, TEMP_B.y + 0.85 - TEMP_A.y, TEMP_B.z - TEMP_A.z);
    positions.needsUpdate = true;
    const material = beam.material;
    if (material instanceof THREE.LineBasicMaterial) material.opacity = 0.72 + Math.sin(elapsed * 13) * 0.18;
  };

  const damageDefenseTarget = (target: GameEntity, seconds: number, nowMs: number) => {
    if (!fountainEntity || !fountainRoot || !target.alive || target.currentHp <= 0) return;
    fountainRoot.getWorldPosition(TEMP_A);
    target.root.getWorldPosition(TEMP_B);
    publishWorldAttackEvent({
      attackerId: fountainEntity.id, targetId: target.id, attackerTeam: team, targetTeam: target.team,
      attackerKind: 'building', targetKind: target.kind,
      attackerPosition: { x: TEMP_A.x, z: TEMP_A.z }, targetPosition: { x: TEMP_B.x, z: TEMP_B.z }, atMs: nowMs,
    });
    const damage = TEAM_START_BASE_LAYOUT.fountainTrueDamagePerSecond * seconds;
    target.currentHp = Math.max(0, target.currentHp - damage);
    target.root.userData.currentHp = target.currentHp;
    if (target.currentHp <= 0) target.alive = false;
    syncRuntime(target);
    emitWorldCombatEvent({
      entityId: target.id, reason: target.currentHp > 0 ? 'damage' : 'death',
      currentHp: target.currentHp, currentResource: target.currentResource,
      alive: target.currentHp > 0, atMs: nowMs, amount: damage,
      sourceEntityId: fountainEntity.id, damageType: 'true', isDirect: true,
    });
  };

  const frame = () => {
    if (disposed || !baseRoot.parent) return;
    const nowSeconds = performance.now() * 0.001;
    const dt = Math.min(0.05, Math.max(0, nowSeconds - lastSeconds));
    lastSeconds = nowSeconds;
    defenseAccumulator += dt;
    protectHeroes();
    const nowMs = nowSeconds * 1000;
    for (const entity of registry.values()) {
      if (entity.kind === 'hero' && entity.team === team) applyRegen(entity, dt, nowMs, nowSeconds);
    }
    const target = findDefenseTarget();
    updateBeam(target, nowSeconds);
    if (target && defenseAccumulator >= DEFENSE_TICK_SECONDS) {
      const seconds = defenseAccumulator;
      defenseAccumulator = 0;
      damageDefenseTarget(target, seconds, nowMs);
    } else if (!target) {
      defenseAccumulator = 0;
    }
    animationFrame = requestAnimationFrame(frame);
  };
  animationFrame = requestAnimationFrame(frame);

  const system: GameplayHandle = {
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(animationFrame);
      unsubscribeCombat();
      unregisterAttackGuard();
      unregisterCombatGuard();
      for (const effect of healingEffects.values()) {
        effect.removeFromParent();
        effect.geometry.dispose();
        if (effect.material instanceof THREE.Material) effect.material.dispose();
      }
      healingEffects.clear();
      for (const state of protectedHp.values()) state.restore();
      protectedHp.clear();
      if (fountainRoot) registry.unregister(fountainRoot);
      delete scene.userData[key];
    },
  };
  scene.userData[key] = system;
  return system;
}

function buildHealingParticles() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18 * 3), 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({
    color: 0x68ff8d, size: 0.085, transparent: true, opacity: 0.86, depthWrite: false, toneMapped: false,
  }));
}

function findScene(object: THREE.Object3D) {
  let current: THREE.Object3D = object;
  while (current.parent) current = current.parent;
  return current instanceof THREE.Scene ? current : null;
}

function estimateTriangles(root: THREE.Object3D) {
  let triangles = 0;
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    triangles += object.geometry.index
      ? Math.floor(object.geometry.index.count / 3)
      : Math.floor((object.geometry.getAttribute('position')?.count ?? 0) / 3);
  });
  return triangles;
}

function angularDistance(a: number, b: number) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

function pseudo(seed: number) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}
