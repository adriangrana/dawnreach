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
const TRIANGLE_BUDGET = 90_000;
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
  const bridgeAngle = Math.atan2(basis.inwardZ, basis.inwardX);
  const stairAngle = bridgeAngle + Math.PI;
  const openingHalfAngle = Math.asin(Math.min(
    0.98,
    (TEAM_START_BASE_LAYOUT.rampWidth * 0.5 + 0.86) / (TEAM_START_BASE_LAYOUT.radius - 0.08),
  ));
  const fountainOffset = basisOffset(
    basis,
    TEAM_START_BASE_LAYOUT.fountainForward,
    TEAM_START_BASE_LAYOUT.fountainSide,
  );

  addTerraceBody(root, materials, [bridgeAngle, stairAngle], openingHalfAngle);
  addPlaza(root, materials, basis, bridgeAngle);
  addCitadelBridge(root, materials, bridgeAngle);
  addGrandStair(root, materials, stairAngle);
  addCliffVisionRing(root, [bridgeAngle, stairAngle], openingHalfAngle);
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
    if (bump) bump.offset.set(elapsed * 0.012, elapsed * 0.008);
    materials.water.opacity = 0.50 + Math.sin(elapsed * 0.8) * 0.025;
    materials.waterStream.opacity = 0.76 + Math.sin(elapsed * 3.1) * 0.035;
    healingPool.rotation.z = Math.sin(elapsed * 0.12) * 0.001;
    animateFountain?.(elapsed);
    bannerCloths.forEach((cloth, clothIndex) => {
      const positions = cloth.geometry.getAttribute('position') as THREE.BufferAttribute;
      const base = clothBases[clothIndex];
      for (let vertex = 0; vertex < positions.count; vertex++) {
        const x = base.getX(vertex);
        const y = base.getY(vertex);
        const z = base.getZ(vertex);
        const normalizedX = THREE.MathUtils.clamp((x + 0.92) / 1.84, 0, 1);
        const flutter = Math.sin(elapsed * 1.55 + y * 2.45 + normalizedX * 2.8 + clothIndex) * 0.065;
        const secondary = Math.sin(elapsed * 0.72 + y * 5.4 + clothIndex * 0.67) * 0.022;
        positions.setXYZ(vertex, x, y, z + (flutter + secondary) * normalizedX);
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
    ctx.fillStyle = '#77776f';
    ctx.fillRect(0, 0, size, size);
    const rows = 9;
    const cellH = size / rows;
    for (let row = 0; row < rows; row++) {
      const cols = row % 2 === 0 ? 8 : 9;
      const cellW = size / cols;
      const offset = row % 2 === 0 ? -cellW * 0.28 : cellW * 0.08;
      for (let col = -1; col <= cols; col++) {
        const x = col * cellW + offset;
        const y = row * cellH;
        const seed = row * 43 + col * 23;
        const warm = pseudo(seed + 2) > 0.48;
        const base = 112 + Math.floor(pseudo(seed + 7) * 30);
        ctx.fillStyle = warm
          ? `rgb(${base + 17},${base + 11},${base - 3})`
          : `rgb(${base + 2},${base + 6},${base + 5})`;
        ctx.fillRect(x + 6, y + 6, cellW - 12, cellH - 12);
        ctx.strokeStyle = 'rgba(35,38,36,0.50)';
        ctx.lineWidth = 5;
        ctx.strokeRect(x + 6, y + 6, cellW - 12, cellH - 12);
        if (pseudo(seed + 13) > 0.56) {
          ctx.strokeStyle = 'rgba(45,43,38,0.36)';
          ctx.lineWidth = 2.4;
          ctx.beginPath();
          ctx.moveTo(x + cellW * 0.16, y + cellH * 0.28);
          ctx.lineTo(x + cellW * 0.44, y + cellH * 0.51);
          ctx.lineTo(x + cellW * 0.69, y + cellH * 0.39);
          ctx.stroke();
        }
      }
    }
    for (let i = 0; i < 850; i++) {
      const x = pseudo(i * 37 + 8) * size;
      const y = pseudo(i * 73 + 17) * size;
      const alpha = 0.025 + pseudo(i * 19) * 0.055;
      ctx.fillStyle = i % 2 ? `rgba(22,25,24,${alpha})` : `rgba(224,215,189,${alpha})`;
      ctx.fillRect(x, y, 2 + pseudo(i * 29) * 6, 2 + pseudo(i * 31) * 5);
    }
  }, 3.1, 3.1);

  const wallTexture = makeCanvasTexture(2048, (ctx, size) => {
    ctx.fillStyle = '#505551';
    ctx.fillRect(0, 0, size, size);
    const courses = 14;
    const courseH = size / courses;
    for (let row = 0; row < courses; row++) {
      const blockW = size / (row % 3 === 0 ? 7 : 8);
      const offset = row % 2 ? blockW * 0.5 : 0;
      for (let col = -1; col < 10; col++) {
        const x = col * blockW - offset;
        const y = row * courseH;
        const seed = row * 47 + col * 23;
        const shade = 72 + Math.floor(pseudo(seed + 5) * 43);
        ctx.fillStyle = `rgb(${shade + 8},${shade + 9},${shade + 6})`;
        ctx.fillRect(x + 4, y + 5, blockW - 8, courseH - 10);
        ctx.strokeStyle = 'rgba(24,27,27,0.70)';
        ctx.lineWidth = 5;
        ctx.strokeRect(x + 4, y + 5, blockW - 8, courseH - 10);
      }
    }
    for (let i = 0; i < 850; i++) {
      const x = pseudo(i * 31 + 7) * size;
      const y = pseudo(i * 67 + 11) * size;
      ctx.fillStyle = i % 2 ? 'rgba(25,28,27,0.10)' : 'rgba(196,191,170,0.055)';
      ctx.fillRect(x, y, 2 + pseudo(i * 13) * 7, 2 + pseudo(i * 17) * 4);
    }
  }, 4.4, 3.0);

  const waterBump = makeCanvasTexture(1024, (ctx, size) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 78; i++) {
      const y = i / 78 * size;
      ctx.strokeStyle = `rgba(228,228,228,${0.04 + (i % 5) * 0.010})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x <= size; x += 16) {
        const wave = Math.sin(x * 0.027 + i * 0.81) * (3.5 + i % 6);
        if (x === 0) ctx.moveTo(x, y + wave);
        else ctx.lineTo(x, y + wave);
      }
      ctx.stroke();
    }
  }, 2.6, 2.6);
  waterBump.colorSpace = THREE.NoColorSpace;

  const clothTexture = makeCanvasTexture(1024, (ctx, size) => {
    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, blue ? '#0d3157' : '#552127');
    gradient.addColorStop(0.48, blue ? '#1b5f91' : '#853940');
    gradient.addColorStop(1, blue ? '#092842' : '#43191e');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    ctx.globalAlpha = 0.13;
    for (let x = 0; x < size; x += 6) {
      ctx.strokeStyle = x % 12 === 0 ? '#ecf2ef' : '#06131e';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }
    for (let y = 0; y < size; y += 6) {
      ctx.strokeStyle = y % 12 === 0 ? '#ecf2ef' : '#06131e';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#c9a95f';
    ctx.lineWidth = 30;
    ctx.strokeRect(32, 32, size - 64, size - 64);
    ctx.lineWidth = 8;
    ctx.strokeRect(70, 70, size - 140, size - 140);
    ctx.fillStyle = '#c9a95f';
    ctx.beginPath();
    ctx.moveTo(size * 0.50, size * 0.22);
    ctx.lineTo(size * 0.66, size * 0.48);
    ctx.lineTo(size * 0.50, size * 0.76);
    ctx.lineTo(size * 0.34, size * 0.48);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = blue ? '#3ca8dc' : '#c2534f';
    ctx.beginPath();
    ctx.moveTo(size * 0.50, size * 0.31);
    ctx.lineTo(size * 0.59, size * 0.48);
    ctx.lineTo(size * 0.50, size * 0.66);
    ctx.lineTo(size * 0.41, size * 0.48);
    ctx.closePath();
    ctx.fill();
  });

  return {
    plaza: new THREE.MeshStandardMaterial({
      map: plazaTexture, bumpMap: plazaTexture, bumpScale: 0.070,
      color: 0xb2aa93, roughness: 0.96, metalness: 0.01,
    }),
    plazaInset: new THREE.MeshStandardMaterial({
      map: plazaTexture, bumpMap: plazaTexture, bumpScale: 0.060,
      color: 0x70736e, roughness: 0.98, metalness: 0.01,
    }),
    wall: new THREE.MeshStandardMaterial({
      map: wallTexture, bumpMap: wallTexture, bumpScale: 0.115,
      color: 0x727771, roughness: 0.99, metalness: 0.01,
    }),
    wallDark: new THREE.MeshStandardMaterial({
      map: wallTexture, bumpMap: wallTexture, bumpScale: 0.135,
      color: 0x424949, roughness: 0.99, metalness: 0.015,
    }),
    wallLight: new THREE.MeshStandardMaterial({
      map: wallTexture, bumpMap: wallTexture, bumpScale: 0.085,
      color: 0xa7a18b, roughness: 0.95, metalness: 0.015,
    }),
    gold: new THREE.MeshStandardMaterial({ color: 0xc7a65a, roughness: 0.32, metalness: 0.72 }),
    team: new THREE.MeshStandardMaterial({ color: blue ? 0x1b638f : 0x8c3734, roughness: 0.48, metalness: 0.38 }),
    glow: new THREE.MeshStandardMaterial({
      color: blue ? 0x57c9f4 : 0xf17a70,
      emissive: blue ? 0x0878af : 0x9b241d,
      emissiveIntensity: 1.15,
      roughness: 0.30,
      metalness: 0.14,
    }),
    crystal: new THREE.MeshPhysicalMaterial({
      color: blue ? 0x4dc7ff : 0xff6a61,
      emissive: blue ? 0x087fc4 : 0xb52a22,
      emissiveIntensity: 1.75,
      roughness: 0.07,
      metalness: 0.02,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      transparent: true,
      opacity: 0.96,
    }),
    water: new THREE.MeshPhysicalMaterial({
      color: blue ? 0x168bd1 : 0xca5c5b,
      emissive: blue ? 0x052b45 : 0x471312,
      emissiveIntensity: 0.15,
      roughness: 0.12,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.05,
      ior: 1.333,
      bumpMap: waterBump,
      bumpScale: 0.034,
      transparent: true,
      opacity: 0.50,
      depthWrite: false,
    }),
    waterStream: new THREE.MeshPhysicalMaterial({
      color: blue ? 0x45b9f3 : 0xff9d96,
      emissive: blue ? 0x075178 : 0x651815,
      emissiveIntensity: 0.25,
      roughness: 0.06,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
      transparent: true,
      opacity: 0.76,
      depthWrite: false,
    }),
    cloth: new THREE.MeshStandardMaterial({
      map: clothTexture,
      bumpMap: clothTexture,
      bumpScale: 0.032,
      color: 0xffffff,
      roughness: 0.99,
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
  openingAngles: readonly number[],
  openingHalfAngle: number,
) {
  const radius = TEAM_START_BASE_LAYOUT.radius;
  const segmentCount = 64;
  const step = Math.PI * 2 / segmentCount;
  const courseCount = 5;
  const courseHeight = TEAM_START_BASE_LAYOUT.elevation / courseCount;

  for (let index = 0; index < segmentCount; index++) {
    const angle = (index + 0.5) * step;
    if (openingAngles.some(opening => angularDistance(angle, opening) < openingHalfAngle)) continue;
    const width = 2 * radius * Math.sin(step / 2) * 1.12;

    for (let course = 0; course < courseCount; course++) {
      const outward = (courseCount - course - 1) * 0.09;
      const localRadius = radius + outward;
      const material = course === 0 || (index + course) % 8 === 0
        ? materials.wallDark
        : course === courseCount - 1 && index % 5 === 1
          ? materials.wallLight
          : materials.wall;
      const block = new THREE.Mesh(
        createChamferedBlockGeometry(
          width * (0.94 + pseudo(index * 19 + course * 7) * 0.10),
          courseHeight - 0.038,
          0.94,
          0.065,
        ),
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
      createChamferedBlockGeometry(width * 1.03, 0.20, 1.05, 0.05),
      index % 5 === 1 ? materials.wallLight : materials.wallDark,
    );
    cap.position.set(
      Math.cos(angle) * (radius - 0.01),
      TEAM_START_BASE_LAYOUT.elevation + 0.10,
      Math.sin(angle) * (radius - 0.01),
    );
    cap.rotation.y = Math.PI / 2 - angle;
    cap.castShadow = true;
    cap.receiveShadow = true;
    root.add(cap);

    if (index % 4 === 0) {
      const parapet = new THREE.Mesh(
        createChamferedBlockGeometry(width * 0.72, 0.34, 0.62, 0.045),
        index % 8 === 0 ? materials.wallLight : materials.wall,
      );
      parapet.position.set(
        Math.cos(angle) * (radius - 0.08),
        TEAM_START_BASE_LAYOUT.elevation + 0.36,
        Math.sin(angle) * (radius - 0.08),
      );
      parapet.rotation.y = Math.PI / 2 - angle;
      parapet.castShadow = true;
      root.add(parapet);
    }

    if (index % 7 === 2) {
      const buttress = new THREE.Group();
      buttress.name = 'team-start-buttress';
      buttress.position.set(Math.cos(angle) * (radius + 0.58), 0, Math.sin(angle) * (radius + 0.58));
      buttress.rotation.y = Math.PI / 2 - angle;
      const lower = new THREE.Mesh(createChamferedBlockGeometry(0.96, 1.28, 0.84, 0.08), materials.wallDark);
      lower.position.y = 0.64;
      lower.castShadow = true;
      buttress.add(lower);
      const mid = new THREE.Mesh(createChamferedBlockGeometry(0.78, 0.82, 0.70, 0.07), materials.wall);
      mid.position.y = 1.69;
      mid.castShadow = true;
      buttress.add(mid);
      const upper = new THREE.Mesh(createChamferedBlockGeometry(0.62, 0.52, 0.58, 0.06), materials.wallLight);
      upper.position.y = 2.34;
      upper.castShadow = true;
      buttress.add(upper);
      const crest = new THREE.Mesh(new THREE.OctahedronGeometry(0.21, 1), materials.gold);
      crest.position.set(0, 2.77, 0.34);
      crest.scale.set(1, 0.66, 0.46);
      buttress.add(crest);
      root.add(buttress);
    }
  }

  const foundationSegments = 48;
  for (let index = 0; index < foundationSegments; index++) {
    const angle = (index + 0.5) / foundationSegments * Math.PI * 2;
    if (openingAngles.some(opening => angularDistance(angle, opening) < openingHalfAngle * 0.82)) continue;
    const width = 2 * (radius + 0.54) * Math.sin(Math.PI / foundationSegments) * 1.11;
    const footing = new THREE.Mesh(
      createChamferedBlockGeometry(width, 0.28, 1.16, 0.06),
      materials.wallDark,
    );
    footing.position.set(
      Math.cos(angle) * (radius + 0.54),
      0.14,
      Math.sin(angle) * (radius + 0.54),
    );
    footing.rotation.y = Math.PI / 2 - angle;
    footing.receiveShadow = true;
    root.add(footing);
  }
}

function addPlaza(root: THREE.Group, materials: StartBaseMaterials, basis: Basis, bridgeAngle: number) {
  const plaza = new THREE.Mesh(
    new THREE.CircleGeometry(TEAM_START_BASE_LAYOUT.radius - 0.34, 112),
    materials.plaza,
  );
  plaza.name = 'team-start-plaza';
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = TEAM_START_BASE_LAYOUT.elevation + 0.018;
  plaza.userData.commandSurface = true;
  plaza.receiveShadow = true;
  root.add(plaza);

  const border = new THREE.Mesh(
    new THREE.RingGeometry(TEAM_START_BASE_LAYOUT.radius - 0.92, TEAM_START_BASE_LAYOUT.radius - 0.34, 112),
    materials.plazaInset,
  );
  border.rotation.x = -Math.PI / 2;
  border.position.y = TEAM_START_BASE_LAYOUT.elevation + 0.030;
  border.receiveShadow = true;
  root.add(border);

  const inset = new THREE.Mesh(
    new THREE.PlaneGeometry(2.25, 5.1, 1, 1),
    materials.plazaInset,
  );
  inset.name = 'team-start-entry-inlay';
  inset.rotation.x = -Math.PI / 2;
  inset.rotation.z = -bridgeAngle + Math.PI / 2;
  const position = basisOffset(basis, 3.40, 0);
  inset.position.set(position.x, TEAM_START_BASE_LAYOUT.elevation + 0.034, position.z);
  inset.receiveShadow = true;
  root.add(inset);

  for (let index = 0; index < 10; index++) {
    const forward = 1.20 + index * 0.50;
    const markerPosition = basisOffset(basis, forward, 0);
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.030, 0.58),
      index === 4 || index === 5 ? materials.glow : materials.gold,
    );
    marker.position.set(markerPosition.x, TEAM_START_BASE_LAYOUT.elevation + 0.052, markerPosition.z);
    marker.rotation.y = -bridgeAngle;
    root.add(marker);
  }
}

function addCitadelBridge(root: THREE.Group, materials: StartBaseMaterials, angle: number) {
  const halfWidth = TEAM_START_BASE_LAYOUT.rampWidth * 0.50;
  const innerRadius = TEAM_START_BASE_LAYOUT.radius - 0.95;
  const outerRadius = TEAM_START_BASE_LAYOUT.radius + 2.30;
  const y = TEAM_START_BASE_LAYOUT.elevation + 0.045;
  const deck = new THREE.Mesh(
    quadGeometry(angle, innerRadius, outerRadius, halfWidth, y, y),
    materials.plaza,
  );
  deck.name = 'team-start-citadel-bridge';
  deck.userData.commandSurface = true;
  deck.receiveShadow = true;
  root.add(deck);

  const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
  const tangent = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
  for (const side of [-1, 1]) {
    const lateral = side * (halfWidth + 0.28);
    const rail = new THREE.Group();
    rail.name = 'base-ramp-architectural-edge';
    const start = radial.clone().multiplyScalar(innerRadius).addScaledVector(tangent, lateral);
    const end = radial.clone().multiplyScalar(outerRadius).addScaledVector(tangent, lateral);
    start.y = y + 0.36;
    end.y = y + 0.36;
    rail.add(slopeBeam(start, end, 0.50, 0.42, materials.wallDark));
    const trimStart = start.clone();
    const trimEnd = end.clone();
    trimStart.y += 0.30;
    trimEnd.y += 0.30;
    rail.add(slopeBeam(trimStart, trimEnd, 0.08, 0.18, materials.gold));
    root.add(rail);

    const pylonPosition = radial.clone().multiplyScalar(TEAM_START_BASE_LAYOUT.radius - 0.56)
      .addScaledVector(tangent, side * (halfWidth + 0.56));
    const pylon = buildGatePylon(materials, side);
    pylon.position.set(pylonPosition.x, TEAM_START_BASE_LAYOUT.elevation, pylonPosition.z);
    pylon.rotation.y = Math.PI / 2 - angle;
    root.add(pylon);
  }

  for (let index = 0; index < 5; index++) {
    const radius = innerRadius + 0.55 + index * 0.56;
    const inlay = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.028, halfWidth * 1.65), index === 2 ? materials.glow : materials.gold);
    inlay.position.set(Math.cos(angle) * radius, y + 0.025, Math.sin(angle) * radius);
    inlay.rotation.y = -angle;
    root.add(inlay);
  }
}

function addGrandStair(root: THREE.Group, materials: StartBaseMaterials, angle: number) {
  const halfWidth = (TEAM_START_BASE_LAYOUT.rampWidth + 1.15) / 2;
  const stairWidth = halfWidth * 2;
  const innerRadius = TEAM_START_BASE_LAYOUT.radius - 0.72;
  const outerRadius = TEAM_START_BASE_LAYOUT.radius + TEAM_START_BASE_LAYOUT.rampLength + 0.72;
  const highY = TEAM_START_BASE_LAYOUT.elevation + 0.04;
  const lowY = 0.055;
  const stepCount = 14;
  const stepDepth = (outerRadius - innerRadius) / stepCount;

  const commandMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    colorWrite: false,
  });
  const commandRamp = new THREE.Mesh(
    quadGeometry(angle, innerRadius, outerRadius, halfWidth - 0.16, highY, lowY),
    commandMaterial,
  );
  commandRamp.name = 'team-start-ramp';
  commandRamp.userData.commandSurface = true;
  root.add(commandRamp);

  for (let index = 0; index < stepCount; index++) {
    const r0 = innerRadius + index * stepDepth;
    const r1 = r0 + stepDepth + 0.04;
    const centerRadius = (r0 + r1) * 0.5;
    const topY = THREE.MathUtils.lerp(highY, lowY + 0.11, (index + 0.55) / stepCount);
    const blockHeight = Math.max(0.12, topY - 0.02);
    const step = new THREE.Mesh(
      createChamferedBlockGeometry(stepDepth + 0.09, blockHeight, stairWidth, 0.045),
      index % 4 === 2 ? materials.plazaInset : materials.plaza,
    );
    step.position.set(
      Math.cos(angle) * centerRadius,
      blockHeight * 0.5,
      Math.sin(angle) * centerRadius,
    );
    step.rotation.y = -angle;
    step.castShadow = true;
    step.receiveShadow = true;
    root.add(step);

    const tread = new THREE.Mesh(
      new THREE.BoxGeometry(stepDepth * 0.84, 0.055, stairWidth - 0.20),
      index % 5 === 0 ? materials.wallLight : materials.plaza,
    );
    tread.position.set(
      Math.cos(angle) * centerRadius,
      topY + 0.025,
      Math.sin(angle) * centerRadius,
    );
    tread.rotation.y = -angle;
    tread.receiveShadow = true;
    root.add(tread);

    if (index % 2 === 0) {
      const centerInlay = new THREE.Mesh(new THREE.BoxGeometry(stepDepth * 0.74, 0.035, 0.18), materials.gold);
      centerInlay.position.set(
        Math.cos(angle) * centerRadius,
        topY + 0.060,
        Math.sin(angle) * centerRadius,
      );
      centerInlay.rotation.y = -angle;
      root.add(centerInlay);
    }
  }

  const radial = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
  const tangent = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle));
  for (const side of [-1, 1]) {
    const lateral = side * (halfWidth + 0.34);
    const edge = new THREE.Group();
    edge.name = 'base-ramp-architectural-edge';
    const start = radial.clone().multiplyScalar(innerRadius).addScaledVector(tangent, lateral);
    const end = radial.clone().multiplyScalar(outerRadius).addScaledVector(tangent, lateral);
    start.y = highY + 0.42;
    end.y = lowY + 0.32;
    edge.add(slopeBeam(start, end, 0.62, 0.54, materials.wallDark));
    const upperStart = start.clone();
    const upperEnd = end.clone();
    upperStart.y += 0.37;
    upperEnd.y += 0.37;
    edge.add(slopeBeam(upperStart, upperEnd, 0.095, 0.24, materials.gold));
    root.add(edge);

    for (let index = 0; index < 6; index++) {
      const t = index / 5;
      const radius = THREE.MathUtils.lerp(innerRadius + 0.12, outerRadius - 0.22, t);
      const surfaceY = THREE.MathUtils.lerp(highY, lowY, t);
      const position = radial.clone().multiplyScalar(radius).addScaledVector(tangent, lateral);
      const post = new THREE.Group();
      post.position.set(position.x, surfaceY, position.z);
      const foot = new THREE.Mesh(createChamferedBlockGeometry(0.46, 0.24, 0.46, 0.04), materials.wallDark);
      foot.position.y = 0.12;
      post.add(foot);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.17, 0.74, 10), materials.wallLight);
      shaft.position.y = 0.60;
      post.add(shaft);
      const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.15, 1), index === 0 ? materials.glow : materials.gold);
      cap.position.y = 1.02;
      cap.scale.y = 1.18;
      post.add(cap);
      root.add(post);
    }
  }

  const topRadius = innerRadius + 0.18;
  for (const side of [-1, 1]) {
    const position = radial.clone().multiplyScalar(topRadius)
      .addScaledVector(tangent, side * (halfWidth + 0.62));
    const pylon = buildGatePylon(materials, side);
    pylon.position.set(position.x, TEAM_START_BASE_LAYOUT.elevation, position.z);
    pylon.rotation.y = Math.PI / 2 - angle;
    root.add(pylon);
  }

  const landingRadius = outerRadius + 0.42;
  const landing = new THREE.Mesh(
    quadGeometry(angle, outerRadius - 0.20, landingRadius + 0.75, halfWidth - 0.12, lowY + 0.02, lowY + 0.02),
    materials.plazaInset,
  );
  landing.name = 'team-start-stair-landing';
  landing.userData.commandSurface = true;
  landing.receiveShadow = true;
  root.add(landing);
}

function buildGatePylon(materials: StartBaseMaterials, side: number) {
  const group = new THREE.Group();
  group.name = 'team-start-gate-pylon';
  group.userData.collisionRadius = 0.58;
  group.userData.structureKind = 'team-start-gate-pylon';

  const base = new THREE.Mesh(createChamferedBlockGeometry(1.08, 0.44, 1.08, 0.08), materials.wallDark);
  base.position.y = 0.22;
  base.castShadow = true;
  group.add(base);

  const lowerShaft = new THREE.Mesh(createChamferedBlockGeometry(0.80, 1.20, 0.80, 0.07), materials.wall);
  lowerShaft.position.y = 1.02;
  lowerShaft.castShadow = true;
  group.add(lowerShaft);

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.50, 0.50, 0.18, 12), materials.gold);
  collar.position.y = 1.66;
  group.add(collar);

  const upperShaft = new THREE.Mesh(createChamferedBlockGeometry(0.64, 0.78, 0.64, 0.06), materials.wallLight);
  upperShaft.position.y = 2.12;
  upperShaft.castShadow = true;
  group.add(upperShaft);

  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.50, 0.38, 0.30, 12), materials.gold);
  crown.position.y = 2.58;
  group.add(crown);

  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.35, 1), materials.crystal);
  crystal.position.y = 3.05;
  crystal.scale.set(0.72, 1.30, 0.72);
  group.add(crystal);

  for (const vertical of [-0.24, 0.24]) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.11, 1.24, 0.14), materials.gold);
    rib.position.set(side * 0.44, 1.76 + vertical, 0);
    rib.rotation.z = side * 0.10;
    group.add(rib);
  }

  const light = new THREE.PointLight(0x4bc7ff, 3.9, 4.6, 2);
  light.position.y = 3.05;
  group.add(light);
  return group;
}

function addCliffVisionRing(
  root: THREE.Group,
  openingAngles: readonly number[],
  openingHalfAngle: number,
) {
  const material = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0, depthWrite: false, colorWrite: false,
  });
  const segments = 56;
  const radius = TEAM_START_BASE_LAYOUT.radius - 0.18;
  const step = Math.PI * 2 / segments;
  const width = 2 * radius * Math.sin(step / 2) * 1.20;
  const height = TEAM_START_BASE_LAYOUT.elevation + 1.45;
  for (let index = 0; index < segments; index++) {
    const angle = (index + 0.5) * step;
    if (openingAngles.some(opening => angularDistance(angle, opening) < openingHalfAngle)) continue;
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
  const apron = new THREE.Mesh(new THREE.CylinderGeometry(2.16, 2.28, 0.18, 16), materials.plazaInset);
  apron.name = 'team-start-shop-apron';
  apron.position.y = TEAM_START_BASE_LAYOUT.elevation + 0.09;
  apron.receiveShadow = true;
  root.add(apron);

  const border = new THREE.Mesh(new THREE.TorusGeometry(2.17, 0.082, 8, 32), materials.gold);
  border.rotation.x = Math.PI / 2;
  border.position.y = TEAM_START_BASE_LAYOUT.elevation + 0.19;
  root.add(border);

  for (let index = 0; index < 8; index++) {
    const angle = index / 8 * Math.PI * 2 + Math.PI / 8;
    const plate = new THREE.Mesh(createChamferedBlockGeometry(0.46, 0.12, 0.28, 0.035), materials.wallLight);
    plate.position.set(
      Math.cos(angle) * 2.12,
      TEAM_START_BASE_LAYOUT.elevation + 0.16,
      Math.sin(angle) * 2.12,
    );
    plate.rotation.y = Math.PI / 2 - angle;
    root.add(plate);
  }
}

function addHealingPool(
  root: THREE.Group,
  materials: StartBaseMaterials,
  fountainOffset: Readonly<{ x: number; z: number }>,
) {
  const points: Array<[number, number]> = [
    [-2.80, -0.20], [-2.54, -1.25], [-1.76, -2.12], [-0.62, -2.55],
    [0.66, -2.48], [1.82, -1.96], [2.56, -1.02], [2.78, 0.14],
    [2.42, 1.23], [1.53, 1.98], [0.28, 2.31], [-1.02, 2.12],
    [-2.14, 1.51], [-2.72, 0.66],
  ];
  const shape = new THREE.Shape();
  points.forEach(([x, y], index) => {
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();

  const basin = new THREE.Mesh(new THREE.ShapeGeometry(shape, 12), materials.wallDark);
  basin.rotation.x = -Math.PI / 2;
  basin.position.set(
    fountainOffset.x + 0.14,
    TEAM_START_BASE_LAYOUT.elevation + 0.045,
    fountainOffset.z + 0.02,
  );
  basin.scale.set(1.10, 0.94, 1);
  root.add(basin);

  const pool = new THREE.Mesh(new THREE.ShapeGeometry(shape, 12), materials.water);
  pool.name = 'team-start-healing-water';
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(
    fountainOffset.x + 0.14,
    TEAM_START_BASE_LAYOUT.elevation + 0.118,
    fountainOffset.z + 0.02,
  );
  pool.scale.set(1.04, 0.88, 1);
  pool.userData.waterSurfaceType = 'healing-pool';
  pool.userData.waterEffectsSurface = true;
  pool.userData.teamHealingWater = true;
  pool.renderOrder = 4;
  pool.receiveShadow = true;
  root.add(pool);

  const rimPoints = points.map(([x, y]) => new THREE.Vector3(
    fountainOffset.x + 0.14 + x * 1.10,
    TEAM_START_BASE_LAYOUT.elevation + 0.15,
    fountainOffset.z + 0.02 - y * 0.94,
  ));
  rimPoints.push(rimPoints[0].clone());
  const rimCurve = new THREE.CatmullRomCurve3(rimPoints, false, 'centripetal');
  const lowerRim = new THREE.Mesh(new THREE.TubeGeometry(rimCurve, 112, 0.17, 9, false), materials.wallDark);
  lowerRim.name = 'team-start-pool-lower-rim';
  lowerRim.castShadow = true;
  root.add(lowerRim);
  const upperRim = new THREE.Mesh(new THREE.TubeGeometry(rimCurve, 112, 0.095, 9, false), materials.wallLight);
  upperRim.name = 'team-start-pool-upper-rim';
  upperRim.position.y = 0.055;
  upperRim.castShadow = true;
  root.add(upperRim);

  for (let index = 0; index < 7; index++) {
    const angle = index / 7 * Math.PI * 2 + 0.18;
    const stone = new THREE.Mesh(
      createChamferedBlockGeometry(0.55, 0.18, 0.34, 0.035),
      index % 2 ? materials.wall : materials.wallLight,
    );
    stone.position.set(
      fountainOffset.x + Math.cos(angle) * 2.96,
      TEAM_START_BASE_LAYOUT.elevation + 0.11,
      fountainOffset.z + Math.sin(angle) * 2.56,
    );
    stone.rotation.y = Math.PI / 2 - angle;
    root.add(stone);
  }
  return pool;
}

function addRuneInlays(
  root: THREE.Group,
  materials: StartBaseMaterials,
  fountainOffset: Readonly<{ x: number; z: number }>,
) {
  const glow = materials.glow.clone();
  glow.transparent = true;
  glow.opacity = 0.62;
  for (let index = 0; index < 9; index++) {
    const angle = index / 9 * Math.PI * 2 + 0.20;
    const rune = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.020, 0.52), glow);
    rune.position.set(
      fountainOffset.x + Math.cos(angle) * 3.18,
      TEAM_START_BASE_LAYOUT.elevation + 0.056,
      fountainOffset.z + Math.sin(angle) * 2.78,
    );
    rune.rotation.y = Math.PI / 2 - angle;
    root.add(rune);
  }
}

function buildFountain(team: CombatTeam, materials: StartBaseMaterials) {
  const fountain = new THREE.Group();
  fountain.name = `${team}-team-start-fountain`;
  fountain.userData.collisionRadius = 1.58;
  fountain.userData.structureKind = 'team-start-fountain';

  const plinthProfile = [
    [1.86, 0.00], [1.94, 0.10], [1.90, 0.20], [1.72, 0.27],
    [1.64, 0.39], [1.74, 0.48], [1.68, 0.57],
  ] as const;
  const plinth = latheMesh(plinthProfile, 72, materials.wallDark);
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  fountain.add(plinth);

  for (let index = 0; index < 12; index++) {
    const angle = index / 12 * Math.PI * 2;
    const brace = new THREE.Mesh(createChamferedBlockGeometry(0.44, 0.42, 0.34, 0.04), index % 3 === 0 ? materials.gold : materials.wallLight);
    brace.position.set(Math.cos(angle) * 1.64, 0.46, Math.sin(angle) * 1.64);
    brace.rotation.y = Math.PI / 2 - angle;
    brace.rotation.z = -0.10;
    fountain.add(brace);
  }

  const basinProfile = [
    [1.58, 0.55], [1.73, 0.63], [1.70, 0.75], [1.49, 0.84],
    [1.20, 0.88], [0.95, 0.94], [0.86, 1.06],
  ] as const;
  const lowerBasin = latheMesh(basinProfile, 72, materials.wallLight);
  lowerBasin.castShadow = true;
  fountain.add(lowerBasin);

  const lowerGold = new THREE.Mesh(new THREE.TorusGeometry(1.69, 0.078, 9, 64), materials.gold);
  lowerGold.rotation.x = Math.PI / 2;
  lowerGold.position.y = 0.74;
  fountain.add(lowerGold);

  const lowerWater = new THREE.Mesh(new THREE.CircleGeometry(1.48, 64), materials.water);
  lowerWater.rotation.x = -Math.PI / 2;
  lowerWater.position.y = 0.88;
  lowerWater.renderOrder = 7;
  fountain.add(lowerWater);

  const columnProfile = [
    [0.75, 0.88], [0.70, 1.08], [0.57, 1.20], [0.51, 1.49],
    [0.62, 1.59], [0.68, 1.70],
  ] as const;
  const column = latheMesh(columnProfile, 56, materials.wall);
  column.castShadow = true;
  fountain.add(column);

  for (let index = 0; index < 8; index++) {
    const angle = index / 8 * Math.PI * 2 + Math.PI / 8;
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.72, 0.14), materials.gold);
    rib.position.set(Math.cos(angle) * 0.61, 1.36, Math.sin(angle) * 0.61);
    rib.rotation.y = -angle;
    rib.rotation.z = 0.10;
    fountain.add(rib);
  }

  const middleProfile = [
    [1.00, 1.62], [1.12, 1.69], [1.08, 1.81], [0.88, 1.90],
    [0.65, 1.95], [0.52, 2.02], [0.47, 2.14],
  ] as const;
  const middleBasin = latheMesh(middleProfile, 64, materials.wallLight);
  middleBasin.castShadow = true;
  fountain.add(middleBasin);

  const middleGold = new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.068, 9, 56), materials.gold);
  middleGold.rotation.x = Math.PI / 2;
  middleGold.position.y = 1.80;
  fountain.add(middleGold);

  const middleWater = new THREE.Mesh(new THREE.CircleGeometry(0.94, 52), materials.water);
  middleWater.rotation.x = -Math.PI / 2;
  middleWater.position.y = 1.91;
  middleWater.renderOrder = 8;
  fountain.add(middleWater);

  const upperProfile = [
    [0.45, 2.04], [0.42, 2.28], [0.34, 2.39], [0.31, 2.56],
    [0.42, 2.64], [0.47, 2.72],
  ] as const;
  const upper = latheMesh(upperProfile, 48, materials.wallLight);
  upper.castShadow = true;
  fountain.add(upper);

  const upperBand = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.052, 8, 40), materials.gold);
  upperBand.rotation.x = Math.PI / 2;
  upperBand.position.y = 2.59;
  fountain.add(upperBand);

  const crystalPivot = new THREE.Group();
  crystalPivot.name = 'team-start-fountain-crystal';
  crystalPivot.position.y = FOUNTAIN_BEAM_ORIGIN_Y;
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.44, 2), materials.crystal);
  crystal.scale.set(0.72, 1.36, 0.72);
  crystal.castShadow = true;
  crystalPivot.add(crystal);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.034, 8, 48), materials.glow);
  halo.rotation.x = Math.PI / 2;
  halo.position.y = -0.02;
  crystalPivot.add(halo);
  fountain.add(crystalPivot);

  const light = new THREE.PointLight(team === 'blue' ? 0x42bfff : 0xff655d, 7.2, 7.8, 2);
  light.position.y = 2.76;
  fountain.add(light);

  const centralStreams: THREE.Mesh[] = [];
  for (let strand = 0; strand < 3; strand++) {
    const offset = (strand - 1) * 0.045;
    const jetCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(offset, 2.92, -offset * 0.5),
      new THREE.Vector3(offset * 0.7, 3.54, -0.02),
      new THREE.Vector3(-offset * 0.4, 4.18, 0.02),
      new THREE.Vector3(offset * 0.25, 4.74, 0),
    ], false, 'catmullrom', 0.4);
    const stream = new THREE.Mesh(
      new THREE.TubeGeometry(jetCurve, 38, strand === 1 ? 0.050 : 0.035, 8, false),
      materials.waterStream,
    );
    stream.name = 'team-start-fountain-central-stream';
    stream.renderOrder = 9;
    centralStreams.push(stream);
    fountain.add(stream);
  }

  const crownDrop = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 10), materials.waterStream);
  crownDrop.position.y = 4.74;
  crownDrop.scale.set(0.78, 1.25, 0.78);
  fountain.add(crownDrop);

  const arcStreams: THREE.Mesh[] = [];
  for (let index = 0; index < 10; index++) {
    const angle = index / 10 * Math.PI * 2 + 0.16;
    const start = new THREE.Vector3(Math.cos(angle) * 0.09, 4.66, Math.sin(angle) * 0.09);
    const control = new THREE.Vector3(Math.cos(angle) * 0.90, 4.38, Math.sin(angle) * 0.90);
    const end = new THREE.Vector3(Math.cos(angle) * 1.26, 1.02, Math.sin(angle) * 1.26);
    const curve = new THREE.QuadraticBezierCurve3(start, control, end);
    const stream = new THREE.Mesh(new THREE.TubeGeometry(curve, 36, 0.035, 7, false), materials.waterStream);
    stream.name = 'team-start-fountain-arc-stream';
    stream.renderOrder = 9;
    arcStreams.push(stream);
    fountain.add(stream);
  }

  const cascadeStreams: THREE.Mesh[] = [];
  for (let index = 0; index < 12; index++) {
    const angle = index / 12 * Math.PI * 2;
    const start = new THREE.Vector3(Math.cos(angle) * 0.86, 1.96, Math.sin(angle) * 0.86);
    const control = new THREE.Vector3(Math.cos(angle) * 1.10, 1.66, Math.sin(angle) * 1.10);
    const end = new THREE.Vector3(Math.cos(angle) * 1.36, 1.00, Math.sin(angle) * 1.36);
    const stream = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(start, control, end), 24, 0.024, 6, false),
      materials.waterStream,
    );
    stream.renderOrder = 9;
    cascadeStreams.push(stream);
    fountain.add(stream);
  }

  const waterCurtains: THREE.Mesh<THREE.PlaneGeometry>[] = [];
  for (let index = 0; index < 8; index++) {
    const angle = index / 8 * Math.PI * 2 + Math.PI / 8;
    const curtain = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.72, 5, 10), materials.waterStream);
    curtain.position.set(Math.cos(angle) * 1.04, 1.44, Math.sin(angle) * 1.04);
    curtain.rotation.y = Math.PI / 2 - angle;
    curtain.rotation.x = -0.05;
    curtain.renderOrder = 8;
    waterCurtains.push(curtain);
    fountain.add(curtain);
  }

  const beamGeometry = new THREE.BufferGeometry();
  beamGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const beam = new THREE.Line(beamGeometry, new THREE.LineBasicMaterial({
    color: team === 'blue' ? 0x63d6ff : 0xff746b,
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
    crystalPivot.rotation.y = elapsed * 0.56;
    crystalPivot.position.y = FOUNTAIN_BEAM_ORIGIN_Y + Math.sin(elapsed * 1.52) * 0.055;
    halo.rotation.z = -elapsed * 0.23;
    crownDrop.scale.y = 1.22 + Math.sin(elapsed * 4.4) * 0.09;
    centralStreams.forEach((stream, index) => {
      stream.scale.x = stream.scale.z = 0.98 + Math.sin(elapsed * 3.5 + index) * 0.025;
    });
    [...arcStreams, ...cascadeStreams].forEach((stream, index) => {
      stream.scale.x = stream.scale.z = 0.985 + Math.sin(elapsed * 3.0 + index * 0.43) * 0.025;
    });
    waterCurtains.forEach((curtain, index) => {
      const position = curtain.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let vertex = 0; vertex < position.count; vertex++) {
        const x = position.getX(vertex);
        const y = position.getY(vertex);
        const row = (y + 0.36) / 0.72;
        position.setZ(vertex, Math.sin(elapsed * 5.0 + row * 5.8 + index) * 0.018 + x * 0.008);
      }
      position.needsUpdate = true;
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
    [-1.0, -5.72, -1, 0.06],
    [-1.40, 5.60, 1, -0.10],
    [-5.05, -3.45, -1, 0.15],
    [-5.20, 3.25, 1, -0.15],
  ] as const;
  for (const [forward, side, facing, yaw] of sites) {
    const position = basisOffset(basis, forward, side);
    const banner = new THREE.Group();
    banner.name = 'team-start-banner';
    banner.position.set(position.x, TEAM_START_BASE_LAYOUT.elevation + 0.08, position.z);
    banner.rotation.y = yaw;

    const pedestal = new THREE.Mesh(createChamferedBlockGeometry(0.42, 0.30, 0.42, 0.04), materials.wallDark);
    pedestal.position.y = 0.15;
    banner.add(pedestal);

    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.070, 0.105, 4.15, 14), materials.gold);
    pole.position.y = 2.22;
    pole.castShadow = true;
    banner.add(pole);

    const finialBase = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.14, 0.16, 12), materials.wallLight);
    finialBase.position.y = 4.32;
    banner.add(finialBase);
    const finial = new THREE.Mesh(new THREE.OctahedronGeometry(0.19, 1), materials.gold);
    finial.position.y = 4.56;
    finial.scale.y = 1.45;
    banner.add(finial);

    const topBar = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.055, 2.10, 12), materials.gold);
    topBar.rotation.z = Math.PI / 2;
    topBar.position.set(facing * 0.96, 3.73, 0);
    banner.add(topBar);

    const clothGeometry = new THREE.PlaneGeometry(1.84, 2.62, 16, 24);
    const clothPositions = clothGeometry.getAttribute('position') as THREE.BufferAttribute;
    for (let vertex = 0; vertex < clothPositions.count; vertex++) {
      const x = clothPositions.getX(vertex);
      const y = clothPositions.getY(vertex);
      const u = THREE.MathUtils.clamp((x / 1.84) + 0.5, 0, 1);
      const v = THREE.MathUtils.clamp((y / 2.62) + 0.5, 0, 1);
      const sag = Math.sin(u * Math.PI) * 0.085;
      const fold = Math.sin(u * Math.PI * 5.0) * (0.020 + v * 0.012);
      clothPositions.setZ(vertex, sag + fold);
    }
    clothGeometry.computeVertexNormals();
    const cloth = new THREE.Mesh(clothGeometry, materials.cloth);
    cloth.position.set(facing * 0.96, 2.39, 0.065);
    cloth.castShadow = true;
    cloth.receiveShadow = true;
    cloths.push(cloth);
    banner.add(cloth);

    const bottomWeight = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 1.78, 10), materials.gold);
    bottomWeight.rotation.z = Math.PI / 2;
    bottomWeight.position.set(facing * 0.96, 1.08, 0.02);
    banner.add(bottomWeight);

    for (const sideTrim of [-0.89, 0.89]) {
      const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 2.52, 8), materials.gold);
      cord.position.set(facing * (0.96 + sideTrim * 0.02), 2.40, 0.085 + sideTrim * 0.012);
      banner.add(cord);
    }

    root.add(banner);
  }
  return cloths;
}

function addPlanters(root: THREE.Group, materials: StartBaseMaterials, basis: Basis) {
  const sites = [[-3.85, -5.18, 0.84], [-4.45, 4.58, 0.90], [0.15, 5.98, 0.76]] as const;
  for (const [forward, side, scale] of sites) {
    const position = basisOffset(basis, forward, side);
    const planter = new THREE.Group();
    planter.name = 'team-start-planter';
    planter.position.set(position.x, TEAM_START_BASE_LAYOUT.elevation + 0.06, position.z);
    planter.scale.setScalar(scale);
    planter.userData.collisionRadius = 0.72;
    planter.userData.structureKind = 'team-start-planter';

    const bowl = latheMesh([
      [0.90, 0.00], [0.98, 0.11], [0.94, 0.26], [0.86, 0.40], [0.76, 0.53], [0.72, 0.58],
    ], 32, materials.wallDark);
    bowl.castShadow = true;
    planter.add(bowl);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.78, 0.070, 9, 32), materials.gold);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.52;
    planter.add(rim);

    const soil = new THREE.Mesh(new THREE.CircleGeometry(0.70, 32), materials.soil);
    soil.rotation.x = -Math.PI / 2;
    soil.position.y = 0.55;
    planter.add(soil);

    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.20, 1.18, 10), materials.trunk);
    trunk.position.y = 1.10;
    planter.add(trunk);
    for (let tier = 0; tier < 5; tier++) {
      const crown = new THREE.Mesh(
        new THREE.ConeGeometry(0.90 - tier * 0.115, 1.15, 12),
        materials.foliage,
      );
      crown.position.y = 1.48 + tier * 0.43;
      crown.rotation.y = tier * 0.37;
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
      selectionRadius: 1.58, maxHp: 0, showHealthBar: false,
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
