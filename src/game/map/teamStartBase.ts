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
  plaza: THREE.MeshStandardMaterial;
  plazaInset: THREE.MeshStandardMaterial;
  wall: THREE.MeshStandardMaterial;
  wallDark: THREE.MeshStandardMaterial;
  wallLight: THREE.MeshStandardMaterial;
  gold: THREE.MeshStandardMaterial;
  team: THREE.MeshStandardMaterial;
  glow: THREE.MeshStandardMaterial;
  crystal: THREE.MeshPhysicalMaterial;
  water: THREE.MeshPhysicalMaterial;
  waterStream: THREE.MeshPhysicalMaterial;
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
const FOUNTAIN_BEAM_ORIGIN_Y = 2.68;
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
  const gateHalfAngle = Math.asin(Math.min(
    0.98,
    (TEAM_START_BASE_LAYOUT.rampWidth * 0.5 + 0.72) / (TEAM_START_BASE_LAYOUT.radius - 0.06),
  ));
  const fountainOffset = basisOffset(
    basis,
    TEAM_START_BASE_LAYOUT.fountainForward,
    TEAM_START_BASE_LAYOUT.fountainSide,
  );

  addTerraceBody(root, materials, rampAngle, gateHalfAngle);
  addPlaza(root, materials, basis, rampAngle);
  addEntrance(root, materials, basis, rampAngle);
  addCliffVisionRing(root, rampAngle, gateHalfAngle);
  addShopApron(root, materials);
  const healingPool = addHealingPool(root, materials, fountainOffset);
  const fountain = buildFountain(team, materials);
  fountain.position.set(fountainOffset.x, TEAM_START_BASE_LAYOUT.elevation + 0.04, fountainOffset.z);
  root.add(fountain);

  addRuneInlays(root, materials, fountainOffset);
  const bannerCloths = addBanners(root, materials, basis);
  addPlanters(root, materials, basis);

  const shopProxy = new THREE.Group();
  shopProxy.name = `${team}-team-start-shop-collision-proxy`;
  shopProxy.userData.collisionRadius = 1.62;
  shopProxy.userData.structureKind = 'shop-proxy';
  root.add(shopProxy);

  const spawnWorld = getTeamStartSpawnPosition(team);
  const center = getTeamBaseShopPosition(team);
  const spawn = new THREE.Group();
  spawn.name = team === 'blue' ? 'TeamSpawnPoint' : `${team}-TeamSpawnPoint`;
  spawn.position.set(
    spawnWorld.x - center.x,
    TEAM_START_BASE_LAYOUT.elevation + 0.09,
    spawnWorld.z - center.z,
  );
  spawn.userData.teamSpawnPoint = true;
  spawn.userData.team = team;
  root.add(spawn);

  const animateFountain = fountain.userData.updateFountain as ((elapsed: number) => void) | undefined;
  const clothBases = bannerCloths.map(cloth => (
    cloth.geometry.getAttribute('position') as THREE.BufferAttribute
  ).clone());
  root.userData.animate = (elapsed: number) => {
    const bump = materials.water.bumpMap;
    if (bump) bump.offset.set(elapsed * 0.010, elapsed * 0.007);
    materials.water.opacity = 0.31 + Math.sin(elapsed * 0.8) * 0.018;
    materials.waterStream.opacity = 0.68 + Math.sin(elapsed * 3.1) * 0.05;
    healingPool.rotation.z = Math.sin(elapsed * 0.12) * 0.0015;
    animateFountain?.(elapsed);
    bannerCloths.forEach((cloth, clothIndex) => {
      const positions = cloth.geometry.getAttribute('position') as THREE.BufferAttribute;
      const base = clothBases[clothIndex];
      for (let vertex = 0; vertex < positions.count; vertex++) {
        const x = base.getX(vertex);
        const y = base.getY(vertex);
        const z = base.getZ(vertex);
        const normalizedX = (x + 1.0) * 0.5;
        const flutter = Math.sin(elapsed * 1.9 + y * 2.8 + normalizedX * 2.4 + clothIndex) * 0.055;
        const secondary = Math.sin(elapsed * 0.82 + y * 5.1 + clothIndex * 0.7) * 0.018;
        const edgeWeight = THREE.MathUtils.clamp(normalizedX, 0, 1);
        positions.setXYZ(vertex, x, y, z + (flutter + secondary) * edgeWeight);
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

  const plazaTexture = makeCanvasTexture(2048, (ctx, size) => {
    ctx.fillStyle = '#807d70';
    ctx.fillRect(0, 0, size, size);
    const rows = 10;
    const cellH = size / rows;
    for (let row = 0; row < rows; row++) {
      const cols = row % 2 === 0 ? 9 : 10;
      const cellW = size / cols;
      const offset = row % 2 === 0 ? -cellW * 0.2 : 0;
      for (let col = -1; col <= cols; col++) {
        const x = col * cellW + offset;
        const y = row * cellH;
        const seed = row * 37 + col * 19;
        const warm = pseudo(seed + 2) > 0.46;
        const base = 118 + Math.floor(pseudo(seed + 7) * 26);
        ctx.fillStyle = warm
          ? `rgb(${base + 13},${base + 8},${base - 5})`
          : `rgb(${base + 2},${base + 5},${base + 4})`;
        ctx.fillRect(x + 5, y + 5, cellW - 10, cellH - 10);
        ctx.strokeStyle = 'rgba(40,42,39,0.46)';
        ctx.lineWidth = 4;
        ctx.strokeRect(x + 5, y + 5, cellW - 10, cellH - 10);
        if (pseudo(seed + 11) > 0.62) {
          ctx.strokeStyle = 'rgba(45,43,38,0.32)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x + cellW * 0.20, y + cellH * 0.25);
          ctx.lineTo(x + cellW * 0.45, y + cellH * 0.50);
          ctx.lineTo(x + cellW * 0.62, y + cellH * 0.43);
          ctx.stroke();
        }
      }
    }
  }, 3.4, 3.4);

  const wallTexture = makeCanvasTexture(2048, (ctx, size) => {
    ctx.fillStyle = '#595c57';
    ctx.fillRect(0, 0, size, size);
    const courses = 12;
    const courseH = size / courses;
    for (let row = 0; row < courses; row++) {
      const blockW = size / (row % 3 === 0 ? 7 : 8);
      const offset = row % 2 ? blockW * 0.5 : 0;
      for (let col = -1; col < 10; col++) {
        const x = col * blockW - offset;
        const y = row * courseH;
        const seed = row * 47 + col * 23;
        const shade = 78 + Math.floor(pseudo(seed + 5) * 36);
        ctx.fillStyle = `rgb(${shade + 7},${shade + 8},${shade + 5})`;
        ctx.fillRect(x + 4, y + 5, blockW - 8, courseH - 10);
        ctx.strokeStyle = 'rgba(28,30,29,0.62)';
        ctx.lineWidth = 4;
        ctx.strokeRect(x + 4, y + 5, blockW - 8, courseH - 10);
      }
    }
    for (let i = 0; i < 500; i++) {
      const x = pseudo(i * 31 + 7) * size;
      const y = pseudo(i * 67 + 11) * size;
      ctx.fillStyle = i % 2 ? 'rgba(32,35,33,0.08)' : 'rgba(196,191,170,0.05)';
      ctx.fillRect(x, y, 2 + pseudo(i * 13) * 7, 2 + pseudo(i * 17) * 4);
    }
  }, 4.8, 3.2);

  const waterBump = makeCanvasTexture(1024, (ctx, size) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 72; i++) {
      const y = i / 72 * size;
      ctx.strokeStyle = `rgba(220,220,220,${0.035 + (i % 5) * 0.009})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x <= size; x += 18) {
        const wave = Math.sin(x * 0.025 + i * 0.83) * (3 + i % 5);
        if (x === 0) ctx.moveTo(x, y + wave);
        else ctx.lineTo(x, y + wave);
      }
      ctx.stroke();
    }
  }, 2.8, 2.8);
  waterBump.colorSpace = THREE.NoColorSpace;

  const clothTexture = makeCanvasTexture(1024, (ctx, size) => {
    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, blue ? '#123960' : '#5b2529');
    gradient.addColorStop(0.52, blue ? '#1c5688' : '#80343a');
    gradient.addColorStop(1, blue ? '#0b2d50' : '#4b1d22');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    ctx.globalAlpha = 0.12;
    for (let x = 0; x < size; x += 7) {
      ctx.strokeStyle = x % 14 === 0 ? '#e5edf0' : '#071622';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }
    for (let y = 0; y < size; y += 7) {
      ctx.strokeStyle = y % 14 === 0 ? '#e5edf0' : '#071622';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#c9a95f';
    ctx.lineWidth = 34;
    ctx.strokeRect(34, 34, size - 68, size - 68);
    ctx.lineWidth = 10;
    ctx.strokeRect(68, 68, size - 136, size - 136);
    ctx.fillStyle = '#c9a95f';
    ctx.beginPath();
    ctx.moveTo(size * 0.50, size * 0.26);
    ctx.lineTo(size * 0.64, size * 0.49);
    ctx.lineTo(size * 0.50, size * 0.72);
    ctx.lineTo(size * 0.36, size * 0.49);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = blue ? '#3fa5d2' : '#b44d4a';
    ctx.beginPath();
    ctx.moveTo(size * 0.50, size * 0.33);
    ctx.lineTo(size * 0.59, size * 0.49);
    ctx.lineTo(size * 0.50, size * 0.65);
    ctx.lineTo(size * 0.41, size * 0.49);
    ctx.closePath();
    ctx.fill();
  });

  return {
    plaza: new THREE.MeshStandardMaterial({
      map: plazaTexture, bumpMap: plazaTexture, bumpScale: 0.055,
      color: 0xb3ad99, roughness: 0.95, metalness: 0.01,
    }),
    plazaInset: new THREE.MeshStandardMaterial({
      map: plazaTexture, bumpMap: plazaTexture, bumpScale: 0.04,
      color: 0x777a73, roughness: 0.97, metalness: 0.01,
    }),
    wall: new THREE.MeshStandardMaterial({
      map: wallTexture, bumpMap: wallTexture, bumpScale: 0.09,
      color: 0x777a73, roughness: 0.98, metalness: 0.01,
    }),
    wallDark: new THREE.MeshStandardMaterial({
      map: wallTexture, bumpMap: wallTexture, bumpScale: 0.11,
      color: 0x4a504f, roughness: 0.99, metalness: 0.015,
    }),
    wallLight: new THREE.MeshStandardMaterial({
      map: wallTexture, bumpMap: wallTexture, bumpScale: 0.065,
      color: 0xa8a38f, roughness: 0.95, metalness: 0.015,
    }),
    gold: new THREE.MeshStandardMaterial({ color: 0xc5a45a, roughness: 0.34, metalness: 0.70 }),
    team: new THREE.MeshStandardMaterial({ color: blue ? 0x1e608d : 0x8a3634, roughness: 0.52, metalness: 0.36 }),
    glow: new THREE.MeshStandardMaterial({
      color: blue ? 0x64ccf0 : 0xef7368,
      emissive: blue ? 0x0874a7 : 0x98231d,
      emissiveIntensity: 1.05,
      roughness: 0.34,
      metalness: 0.15,
    }),
    crystal: new THREE.MeshPhysicalMaterial({
      color: blue ? 0x56cbff : 0xff6d63,
      emissive: blue ? 0x087fc1 : 0xb42a22,
      emissiveIntensity: 1.65,
      roughness: 0.08,
      metalness: 0.02,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      transparent: true,
      opacity: 0.95,
    }),
    water: new THREE.MeshPhysicalMaterial({
      color: blue ? 0x2f91d0 : 0xc65f5d,
      roughness: 0.17,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.07,
      ior: 1.333,
      bumpMap: waterBump,
      bumpScale: 0.028,
      transparent: true,
      opacity: 0.31,
      depthWrite: false,
    }),
    waterStream: new THREE.MeshPhysicalMaterial({
      color: blue ? 0x83d8ff : 0xffb3aa,
      emissive: blue ? 0x0a4968 : 0x5a1613,
      emissiveIntensity: 0.18,
      roughness: 0.08,
      metalness: 0,
      clearcoat: 0.9,
      clearcoatRoughness: 0.04,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
    }),
    cloth: new THREE.MeshStandardMaterial({
      map: clothTexture,
      bumpMap: clothTexture,
      bumpScale: 0.025,
      color: 0xffffff,
      roughness: 0.98,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
    foliage: new THREE.MeshStandardMaterial({ color: 0x28482e, roughness: 0.98 }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x5b4937, roughness: 1 }),
    soil: new THREE.MeshStandardMaterial({ color: 0x2f3025, roughness: 1 }),
  };
}

function addTerraceBody(
  root: THREE.Group,
  materials: StartBaseMaterials,
  rampAngle: number,
  gateHalfAngle: number,
) {
  const radius = TEAM_START_BASE_LAYOUT.radius;
  const segmentCount = 52;
  const step = Math.PI * 2 / segmentCount;
  const courseCount = 4;
  const courseHeight = TEAM_START_BASE_LAYOUT.elevation / courseCount;

  for (let index = 0; index < segmentCount; index++) {
    const angle = (index + 0.5) * step;
    if (angularDistance(angle, rampAngle) < gateHalfAngle) continue;
    const width = 2 * radius * Math.sin(step / 2) * 1.10;

    for (let course = 0; course < courseCount; course++) {
      const outward = (courseCount - course - 1) * 0.08;
      const localRadius = radius + outward;
      const material = course === 0 || (index + course) % 7 === 0
        ? materials.wallDark
        : course === courseCount - 1 && index % 5 === 1
          ? materials.wallLight
          : materials.wall;
      const block = new THREE.Mesh(
        createChamferedBlockGeometry(width * (0.95 + pseudo(index * 19 + course * 7) * 0.08), courseHeight - 0.045, 0.84, 0.055),
        material,
      );
      block.position.set(
        Math.cos(angle) * localRadius,
        courseHeight * (course + 0.5),
        Math.sin(angle) * localRadius,
      );
      block.rotation.y = Math.PI / 2 - angle;
      block.castShadow = true;
      block.receiveShadow = true;
      root.add(block);
    }

    const cap = new THREE.Mesh(
      createChamferedBlockGeometry(width * 1.02, 0.18, 0.96, 0.045),
      index % 5 === 1 ? materials.wallLight : materials.wallDark,
    );
    cap.position.set(
      Math.cos(angle) * (radius - 0.015),
      TEAM_START_BASE_LAYOUT.elevation + 0.09,
      Math.sin(angle) * (radius - 0.015),
    );
    cap.rotation.y = Math.PI / 2 - angle;
    cap.castShadow = true;
    cap.receiveShadow = true;
    root.add(cap);

    if (index % 6 === 2) {
      const buttress = new THREE.Group();
      buttress.name = 'team-start-buttress';
      buttress.position.set(Math.cos(angle) * (radius + 0.47), 0, Math.sin(angle) * (radius + 0.47));
      buttress.rotation.y = Math.PI / 2 - angle;
      const lower = new THREE.Mesh(createChamferedBlockGeometry(0.82, 1.22, 0.72, 0.07), materials.wallDark);
      lower.position.y = 0.61;
      buttress.add(lower);
      const upper = new THREE.Mesh(createChamferedBlockGeometry(0.64, 1.02, 0.58, 0.06), materials.wall);
      upper.position.y = 1.72;
      buttress.add(upper);
      const crest = new THREE.Mesh(new THREE.OctahedronGeometry(0.20, 1), materials.gold);
      crest.position.set(0, 2.38, 0.33);
      crest.scale.set(1, 0.62, 0.45);
      buttress.add(crest);
      root.add(buttress);
    }
  }
}

function addPlaza(root: THREE.Group, materials: StartBaseMaterials, basis: Basis, rampAngle: number) {
  const plaza = new THREE.Mesh(
    new THREE.CircleGeometry(TEAM_START_BASE_LAYOUT.radius - 0.30, 96),
    materials.plaza,
  );
  plaza.name = 'team-start-plaza';
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = TEAM_START_BASE_LAYOUT.elevation + 0.018;
  plaza.userData.commandSurface = true;
  plaza.receiveShadow = true;
  root.add(plaza);

  const insetLength = 4.7;
  const inset = new THREE.Mesh(
    new THREE.PlaneGeometry(2.25, insetLength, 1, 1),
    materials.plazaInset,
  );
  inset.name = 'team-start-entry-inlay';
  inset.rotation.x = -Math.PI / 2;
  inset.rotation.z = -rampAngle + Math.PI / 2;
  const position = basisOffset(basis, 3.25, 0);
  inset.position.set(position.x, TEAM_START_BASE_LAYOUT.elevation + 0.026, position.z);
  inset.receiveShadow = true;
  root.add(inset);

  for (let index = 0; index < 9; index++) {
    const forward = 1.35 + index * 0.48;
    const markerPosition = basisOffset(basis, forward, 0);
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(0.13, 0.028, 0.54),
      index === 4 ? materials.glow : materials.gold,
    );
    marker.position.set(markerPosition.x, TEAM_START_BASE_LAYOUT.elevation + 0.046, markerPosition.z);
    marker.rotation.y = -rampAngle;
    root.add(marker);
  }
}

function addEntrance(root: THREE.Group, materials: StartBaseMaterials, basis: Basis, angle: number) {
  const halfWidth = (TEAM_START_BASE_LAYOUT.rampWidth + 0.45) / 2;
  const innerRadius = TEAM_START_BASE_LAYOUT.radius - 0.82;
  const outerRadius = TEAM_START_BASE_LAYOUT.radius + TEAM_START_BASE_LAYOUT.rampLength;
  const highY = TEAM_START_BASE_LAYOUT.elevation + 0.045;
  const lowY = 0.045;

  const ramp = new THREE.Mesh(
    quadGeometry(angle, innerRadius, outerRadius, halfWidth, highY, lowY),
    materials.wallDark,
  );
  ramp.name = 'team-start-ramp';
  ramp.userData.commandSurface = true;
  ramp.receiveShadow = true;
  root.add(ramp);

  const segments = 11;
  const length = (outerRadius - innerRadius) / segments;
  for (let index = 0; index < segments; index++) {
    const r0 = innerRadius + index * length + 0.025;
    const r1 = innerRadius + (index + 1) * length - 0.025;
    const t0 = (r0 - innerRadius) / (outerRadius - innerRadius);
    const t1 = (r1 - innerRadius) / (outerRadius - innerRadius);
    const y0 = THREE.MathUtils.lerp(highY + 0.025, lowY + 0.025, t0);
    const y1 = THREE.MathUtils.lerp(highY + 0.025, lowY + 0.025, t1);
    const slab = new THREE.Mesh(
      quadGeometry(angle, r0, r1, halfWidth - 0.20, y0, y1),
      index % 4 === 1 ? materials.plazaInset : materials.plaza,
    );
    slab.receiveShadow = true;
    root.add(slab);
  }

  const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
  const tangent = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
  for (const side of [-1, 1]) {
    const barrier = new THREE.Group();
    barrier.name = 'base-ramp-architectural-edge';
    const lateral = side * (halfWidth + 0.34);
    const start = radial.clone().multiplyScalar(innerRadius).addScaledVector(tangent, lateral);
    const end = radial.clone().multiplyScalar(outerRadius).addScaledVector(tangent, lateral);
    start.y = highY + 0.38;
    end.y = lowY + 0.30;
    const visibleRail = slopeBeam(start, end, 0.56, 0.44, materials.wallDark);
    barrier.add(visibleRail);
    const trimStart = start.clone();
    const trimEnd = end.clone();
    trimStart.y += 0.34;
    trimEnd.y += 0.34;
    barrier.add(slopeBeam(trimStart, trimEnd, 0.08, 0.20, materials.gold));
    root.add(barrier);
  }

  const gateRadius = TEAM_START_BASE_LAYOUT.radius - 0.50;
  for (const side of [-1, 1]) {
    const gatePosition = radial.clone().multiplyScalar(gateRadius).addScaledVector(tangent, side * (halfWidth + 0.55));
    const pylon = buildGatePylon(materials, side);
    pylon.position.set(gatePosition.x, TEAM_START_BASE_LAYOUT.elevation, gatePosition.z);
    pylon.rotation.y = Math.PI / 2 - angle;
    root.add(pylon);
  }

  const footRadius = outerRadius - 0.45;
  for (const side of [-1, 1]) {
    const gatePosition = radial.clone().multiplyScalar(footRadius).addScaledVector(tangent, side * (halfWidth + 0.46));
    const beacon = buildGateBeacon(materials);
    beacon.position.set(gatePosition.x, lowY, gatePosition.z);
    root.add(beacon);
  }

  const threshold = basisOffset(basis, TEAM_START_BASE_LAYOUT.radius - 0.28, 0);
  const thresholdBar = new THREE.Mesh(
    new THREE.BoxGeometry(TEAM_START_BASE_LAYOUT.rampWidth + 1.25, 0.13, 0.34),
    materials.gold,
  );
  thresholdBar.position.set(threshold.x, TEAM_START_BASE_LAYOUT.elevation + 0.11, threshold.z);
  thresholdBar.rotation.y = Math.PI / 2 - angle;
  root.add(thresholdBar);
}

function buildGatePylon(materials: StartBaseMaterials, side: number) {
  const group = new THREE.Group();
  group.name = 'team-start-gate-pylon';
  group.userData.collisionRadius = 0.58;
  group.userData.structureKind = 'team-start-gate-pylon';

  const base = new THREE.Mesh(createChamferedBlockGeometry(1.05, 0.42, 1.05, 0.08), materials.wallDark);
  base.position.y = 0.21;
  base.castShadow = true;
  group.add(base);

  const shaft = new THREE.Mesh(createChamferedBlockGeometry(0.76, 2.10, 0.76, 0.07), materials.wall);
  shaft.position.y = 1.43;
  shaft.castShadow = true;
  group.add(shaft);

  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.14, 8), materials.gold);
  band.position.y = 2.16;
  group.add(band);

  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.54, 0.42, 0.34, 8), materials.wallLight);
  crown.position.y = 2.38;
  group.add(crown);

  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 1), materials.crystal);
  crystal.position.y = 2.88;
  crystal.scale.set(0.75, 1.22, 0.75);
  group.add(crystal);

  const wing = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.74, 0.62), materials.team);
  wing.position.set(side * 0.46, 1.54, 0);
  wing.rotation.z = side * 0.12;
  group.add(wing);

  const light = new THREE.PointLight(0x58cfff, 3.6, 4.2, 2);
  light.position.y = 2.88;
  group.add(light);
  return group;
}

function buildGateBeacon(materials: StartBaseMaterials) {
  const group = new THREE.Group();
  group.name = 'team-start-gate-beacon';
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.46, 0.24, 8), materials.wallDark);
  foot.position.y = 0.12;
  group.add(foot);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.20, 0.92, 8), materials.wall);
  post.position.y = 0.70;
  group.add(post);
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 1), materials.crystal);
  crystal.position.y = 1.28;
  crystal.scale.y = 1.25;
  group.add(crystal);
  return group;
}

function addCliffVisionRing(root: THREE.Group, rampAngle: number, gateHalfAngle: number) {
  const material = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0, depthWrite: false, colorWrite: false,
  });
  const segments = 48;
  const radius = TEAM_START_BASE_LAYOUT.radius - 0.18;
  const step = Math.PI * 2 / segments;
  const width = 2 * radius * Math.sin(step / 2) * 1.20;
  const height = TEAM_START_BASE_LAYOUT.elevation + 1.45;
  for (let index = 0; index < segments; index++) {
    const angle = (index + 0.5) * step;
    if (angularDistance(angle, rampAngle) < gateHalfAngle) continue;
    const blocker = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.54), material);
    blocker.name = 'team-start-cliff-vision-occluder';
    blocker.position.set(Math.cos(angle) * radius, height / 2 - 0.10, Math.sin(angle) * radius);
    blocker.rotation.y = Math.PI / 2 - angle;
    blocker.userData.visionOccluder = true;
    blocker.raycast = () => {};
    root.add(blocker);
  }
}

function addShopApron(root: THREE.Group, materials: StartBaseMaterials) {
  const apron = new THREE.Mesh(new THREE.CylinderGeometry(2.14, 2.24, 0.16, 8), materials.plazaInset);
  apron.name = 'team-start-shop-apron';
  apron.position.y = TEAM_START_BASE_LAYOUT.elevation + 0.08;
  apron.receiveShadow = true;
  root.add(apron);

  const border = new THREE.Mesh(new THREE.TorusGeometry(2.15, 0.075, 6, 8), materials.gold);
  border.rotation.x = Math.PI / 2;
  border.position.y = TEAM_START_BASE_LAYOUT.elevation + 0.17;
  root.add(border);
}

function addHealingPool(
  root: THREE.Group,
  materials: StartBaseMaterials,
  fountainOffset: Readonly<{ x: number; z: number }>,
) {
  const shape = new THREE.Shape();
  const points: Array<[number, number]> = [
    [-2.75, -0.15], [-2.34, -1.55], [-1.10, -2.34], [0.48, -2.54],
    [2.02, -2.06], [2.82, -0.78], [2.58, 0.70], [1.66, 1.78],
    [0.16, 2.15], [-1.38, 1.80], [-2.45, 0.92],
  ];
  points.forEach(([x, y], index) => {
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape, 8);
  const pool = new THREE.Mesh(geometry, materials.water);
  pool.name = 'team-start-healing-water';
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(
    fountainOffset.x + 0.16,
    TEAM_START_BASE_LAYOUT.elevation + 0.105,
    fountainOffset.z + 0.05,
  );
  pool.scale.set(1.08, 0.92, 1);
  pool.userData.waterSurfaceType = 'healing-pool';
  pool.userData.waterEffectsSurface = true;
  pool.userData.teamHealingWater = true;
  pool.renderOrder = 4;
  pool.receiveShadow = true;
  root.add(pool);

  const rimPoints = points.map(([x, y]) => new THREE.Vector3(
    fountainOffset.x + 0.16 + x * 1.08,
    TEAM_START_BASE_LAYOUT.elevation + 0.11,
    fountainOffset.z + 0.05 - y * 0.92,
  ));
  rimPoints.push(rimPoints[0].clone());
  const rimCurve = new THREE.CatmullRomCurve3(rimPoints, false, 'centripetal');
  const rim = new THREE.Mesh(new THREE.TubeGeometry(rimCurve, 84, 0.075, 7, false), materials.wallLight);
  rim.name = 'team-start-pool-rim';
  rim.castShadow = true;
  root.add(rim);
  return pool;
}

function addRuneInlays(
  root: THREE.Group,
  materials: StartBaseMaterials,
  fountainOffset: Readonly<{ x: number; z: number }>,
) {
  const glow = materials.glow.clone();
  glow.transparent = true;
  glow.opacity = 0.58;
  for (let index = 0; index < 7; index++) {
    const angle = index / 7 * Math.PI * 2 + 0.25;
    const rune = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.018, 0.48), glow);
    rune.position.set(
      fountainOffset.x + Math.cos(angle) * 2.48,
      TEAM_START_BASE_LAYOUT.elevation + 0.055,
      fountainOffset.z + Math.sin(angle) * 2.48,
    );
    rune.rotation.y = Math.PI / 2 - angle;
    root.add(rune);
  }
}

function buildFountain(team: CombatTeam, materials: StartBaseMaterials) {
  const fountain = new THREE.Group();
  fountain.name = `${team}-team-start-fountain`;
  fountain.userData.collisionRadius = 1.54;
  fountain.userData.structureKind = 'team-start-fountain';

  const plinthProfile = [
    [1.78, 0.00], [1.84, 0.10], [1.78, 0.20], [1.62, 0.25],
    [1.58, 0.38], [1.68, 0.46], [1.64, 0.54],
  ] as const;
  const plinth = latheMesh(plinthProfile, 56, materials.wallDark);
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  fountain.add(plinth);

  const basinProfile = [
    [1.54, 0.52], [1.64, 0.59], [1.62, 0.69], [1.40, 0.77],
    [1.15, 0.80], [0.92, 0.86], [0.84, 0.96],
  ] as const;
  const lowerBasin = latheMesh(basinProfile, 64, materials.wallLight);
  lowerBasin.castShadow = true;
  fountain.add(lowerBasin);

  const lowerGold = new THREE.Mesh(new THREE.TorusGeometry(1.61, 0.075, 8, 48), materials.gold);
  lowerGold.rotation.x = Math.PI / 2;
  lowerGold.position.y = 0.67;
  fountain.add(lowerGold);

  const lowerWater = new THREE.Mesh(new THREE.CircleGeometry(1.42, 48), materials.water);
  lowerWater.rotation.x = -Math.PI / 2;
  lowerWater.position.y = 0.80;
  lowerWater.renderOrder = 7;
  fountain.add(lowerWater);

  const columnProfile = [
    [0.72, 0.82], [0.68, 1.05], [0.56, 1.17], [0.52, 1.44],
    [0.62, 1.53], [0.66, 1.64],
  ] as const;
  const column = latheMesh(columnProfile, 48, materials.wall);
  column.castShadow = true;
  fountain.add(column);

  const middleProfile = [
    [0.96, 1.56], [1.06, 1.63], [1.03, 1.73], [0.83, 1.81],
    [0.62, 1.85], [0.50, 1.91], [0.46, 2.02],
  ] as const;
  const middleBasin = latheMesh(middleProfile, 56, materials.wallLight);
  middleBasin.castShadow = true;
  fountain.add(middleBasin);

  const middleGold = new THREE.Mesh(new THREE.TorusGeometry(1.03, 0.065, 8, 44), materials.gold);
  middleGold.rotation.x = Math.PI / 2;
  middleGold.position.y = 1.72;
  fountain.add(middleGold);

  const middleWater = new THREE.Mesh(new THREE.CircleGeometry(0.90, 40), materials.water);
  middleWater.rotation.x = -Math.PI / 2;
  middleWater.position.y = 1.82;
  middleWater.renderOrder = 8;
  fountain.add(middleWater);

  const upperProfile = [
    [0.43, 1.92], [0.40, 2.17], [0.34, 2.28], [0.32, 2.48],
    [0.42, 2.56], [0.46, 2.64],
  ] as const;
  const upper = latheMesh(upperProfile, 40, materials.wallLight);
  upper.castShadow = true;
  fountain.add(upper);

  const crystalPivot = new THREE.Group();
  crystalPivot.name = 'team-start-fountain-crystal';
  crystalPivot.position.y = FOUNTAIN_BEAM_ORIGIN_Y;
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.42, 1), materials.crystal);
  crystal.scale.set(0.74, 1.30, 0.74);
  crystal.castShadow = true;
  crystalPivot.add(crystal);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.61, 0.032, 6, 40), materials.glow);
  halo.rotation.x = Math.PI / 2;
  halo.position.y = -0.02;
  crystalPivot.add(halo);
  fountain.add(crystalPivot);

  const light = new THREE.PointLight(team === 'blue' ? 0x4ec8ff : 0xff685f, 6.8, 7.2, 2);
  light.position.y = 2.72;
  fountain.add(light);

  const jetCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 2.88, 0),
    new THREE.Vector3(0.035, 3.42, -0.018),
    new THREE.Vector3(-0.025, 4.05, 0.025),
    new THREE.Vector3(0.015, 4.62, 0),
  ], false, 'catmullrom', 0.4);
  const centralJet = new THREE.Mesh(new THREE.TubeGeometry(jetCurve, 34, 0.055, 7, false), materials.waterStream);
  centralJet.name = 'team-start-fountain-central-stream';
  centralJet.renderOrder = 9;
  fountain.add(centralJet);

  const crownDrop = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), materials.waterStream);
  crownDrop.position.y = 4.61;
  crownDrop.scale.set(0.78, 1.22, 0.78);
  fountain.add(crownDrop);

  const streams: THREE.Mesh[] = [];
  for (let index = 0; index < 8; index++) {
    const angle = index / 8 * Math.PI * 2 + 0.19;
    const start = new THREE.Vector3(Math.cos(angle) * 0.08, 4.56, Math.sin(angle) * 0.08);
    const control = new THREE.Vector3(Math.cos(angle) * 0.78, 4.26, Math.sin(angle) * 0.78);
    const end = new THREE.Vector3(Math.cos(angle) * 1.20, 0.91, Math.sin(angle) * 1.20);
    const curve = new THREE.QuadraticBezierCurve3(start, control, end);
    const stream = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.032, 6, false), materials.waterStream);
    stream.name = 'team-start-fountain-arc-stream';
    stream.renderOrder = 9;
    streams.push(stream);
    fountain.add(stream);
  }

  for (let index = 0; index < 10; index++) {
    const angle = index / 10 * Math.PI * 2;
    const start = new THREE.Vector3(Math.cos(angle) * 0.82, 1.86, Math.sin(angle) * 0.82);
    const control = new THREE.Vector3(Math.cos(angle) * 1.05, 1.60, Math.sin(angle) * 1.05);
    const end = new THREE.Vector3(Math.cos(angle) * 1.30, 0.90, Math.sin(angle) * 1.30);
    const stream = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(start, control, end), 20, 0.022, 5, false),
      materials.waterStream,
    );
    stream.renderOrder = 9;
    streams.push(stream);
    fountain.add(stream);
  }

  const beamGeometry = new THREE.BufferGeometry();
  beamGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const beam = new THREE.Line(beamGeometry, new THREE.LineBasicMaterial({
    color: team === 'blue' ? 0x6fddff : 0xff796e,
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
    crystalPivot.rotation.y = elapsed * 0.58;
    crystalPivot.position.y = FOUNTAIN_BEAM_ORIGIN_Y + Math.sin(elapsed * 1.55) * 0.055;
    halo.rotation.z = -elapsed * 0.22;
    crownDrop.scale.y = 1.18 + Math.sin(elapsed * 4.5) * 0.10;
    streams.forEach((stream, index) => {
      stream.scale.x = stream.scale.z = 0.97 + Math.sin(elapsed * 3.2 + index * 0.7) * 0.035;
    });
  };
  return fountain;
}

function latheMesh(
  profile: readonly (readonly [radius: number, y: number])[],
  segments: number,
  material: THREE.Material,
) {
  return new THREE.Mesh(
    new THREE.LatheGeometry(profile.map(([radius, y]) => new THREE.Vector2(radius, y)), segments),
    material,
  );
}

function addBanners(root: THREE.Group, materials: StartBaseMaterials, basis: Basis) {
  const cloths: THREE.Mesh<THREE.PlaneGeometry>[] = [];
  const sites = [
    [-1.0, -5.62, -1],
    [-1.55, 5.48, 1],
  ] as const;
  for (const [forward, side, facing] of sites) {
    const position = basisOffset(basis, forward, side);
    const banner = new THREE.Group();
    banner.name = 'team-start-banner';
    banner.position.set(position.x, TEAM_START_BASE_LAYOUT.elevation + 0.08, position.z);

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.10, 3.8, 12), materials.gold);
    pole.position.y = 1.90;
    pole.castShadow = true;
    banner.add(pole);

    const finial = new THREE.Mesh(new THREE.OctahedronGeometry(0.17, 1), materials.gold);
    finial.position.y = 3.87;
    finial.scale.y = 1.35;
    banner.add(finial);

    const topBar = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1.95, 10), materials.gold);
    topBar.rotation.z = Math.PI / 2;
    topBar.position.set(facing * 0.88, 3.26, 0);
    banner.add(topBar);

    const clothGeometry = new THREE.PlaneGeometry(1.72, 2.35, 12, 18);
    const clothPositions = clothGeometry.getAttribute('position') as THREE.BufferAttribute;
    for (let vertex = 0; vertex < clothPositions.count; vertex++) {
      const x = clothPositions.getX(vertex);
      const y = clothPositions.getY(vertex);
      const u = (x / 1.72) + 0.5;
      const sag = Math.sin(THREE.MathUtils.clamp(u, 0, 1) * Math.PI) * 0.07;
      clothPositions.setZ(vertex, sag + Math.cos(y * 2.2) * 0.008);
    }
    clothGeometry.computeVertexNormals();
    const cloth = new THREE.Mesh(clothGeometry, materials.cloth);
    cloth.position.set(facing * 0.88, 2.02, 0.06);
    cloth.castShadow = true;
    cloth.receiveShadow = true;
    cloths.push(cloth);
    banner.add(cloth);

    const lowerWeight = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.66, 8), materials.gold);
    lowerWeight.rotation.z = Math.PI / 2;
    lowerWeight.position.set(facing * 0.88, 0.84, 0.02);
    banner.add(lowerWeight);

    root.add(banner);
  }
  return cloths;
}

function addPlanters(root: THREE.Group, materials: StartBaseMaterials, basis: Basis) {
  const sites = [[-3.8, -5.18, 0.80], [-4.45, 4.55, 0.88], [0.1, 5.95, 0.72]] as const;
  for (const [forward, side, scale] of sites) {
    const position = basisOffset(basis, forward, side);
    const planter = new THREE.Group();
    planter.name = 'team-start-planter';
    planter.position.set(position.x, TEAM_START_BASE_LAYOUT.elevation + 0.06, position.z);
    planter.scale.setScalar(scale);
    planter.userData.collisionRadius = 0.72;
    planter.userData.structureKind = 'team-start-planter';

    const bowl = latheMesh([
      [0.86, 0.00], [0.94, 0.12], [0.88, 0.32], [0.78, 0.45], [0.72, 0.52],
    ], 24, materials.wallDark);
    bowl.castShadow = true;
    planter.add(bowl);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.065, 8, 28), materials.gold);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.47;
    planter.add(rim);

    const soil = new THREE.Mesh(new THREE.CircleGeometry(0.70, 24), materials.soil);
    soil.rotation.x = -Math.PI / 2;
    soil.position.y = 0.49;
    planter.add(soil);

    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.20, 1.15, 9), materials.trunk);
    trunk.position.y = 1.02;
    planter.add(trunk);
    for (let tier = 0; tier < 4; tier++) {
      const crown = new THREE.Mesh(
        new THREE.ConeGeometry(0.86 - tier * 0.12, 1.18, 10),
        materials.foliage,
      );
      crown.position.y = 1.42 + tier * 0.46;
      crown.rotation.y = tier * 0.42;
      crown.castShadow = true;
      planter.add(crown);
    }
    root.add(planter);
  }
}

function createChamferedBlockGeometry(width: number, height: number, depth: number, bevel: number) {
  const shape = new THREE.Shape();
  const hw = width / 2;
  const hh = height / 2;
  const b = Math.min(bevel, hw * 0.45, hh * 0.45);
  shape.moveTo(-hw + b, -hh);
  shape.lineTo(hw - b, -hh);
  shape.lineTo(hw, -hh + b);
  shape.lineTo(hw, hh - b);
  shape.lineTo(hw - b, hh);
  shape.lineTo(-hw + b, hh);
  shape.lineTo(-hw, hh - b);
  shape.lineTo(-hw, -hh + b);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: Math.min(bevel * 0.55, depth * 0.12),
    bevelThickness: Math.min(bevel * 0.50, depth * 0.10),
    curveSegments: 1,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return geometry;
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

function quadGeometry(
  angle: number,
  innerRadius: number,
  outerRadius: number,
  halfWidth: number,
  innerY: number,
  outerY: number,
) {
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
      selectionRadius: 1.54, maxHp: 0, showHealthBar: false,
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
