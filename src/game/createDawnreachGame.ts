import * as THREE from 'three';
import { animateHumanoid, HUMANOID_DEFAULT_MOVE_SPEED } from './characters/animateHumanoid';
import { buildHumanoidBody } from './characters/buildHumanoidBody';
import { createEntitySelectionController } from './entities/entitySelection';
import {
  GameEntityRegistry,
  getGameEntity,
  registerAuthoredMapEntities,
  VISION_RANGES,
  type GameEntity,
} from './entities/gameEntities';
import { calculateTowerAuraAdjustedDamage } from './entities/towerAuras';
import {
  emitWorldCombatEvent,
  getWorldEntityRuntime,
  publishWorldAttackEvent,
  publishWorldEntityRuntime,
} from './entities/worldCombatBridge';
import { connectLocalLaneProgression } from './gameplay/localLaneProgression';
import { ensureLaneCreepSystem, type LaneCreepNetworkSnapshot } from './gameplay/laneCreeps';
import { animateAlden } from './heroes/alden/animateAlden';
import { buildAlden, type AldenRig } from './heroes/alden/buildAlden';
import { createAldenMaterials } from './heroes/alden/materials';
import { ensureAldenAbilityPresentation } from './heroes/alden/abilityPresentation';
import { ensureAldenAbilityEdgePolish } from './heroes/alden/abilityEdgePolish';
import { ensureWorldLineVfxPolish } from './heroes/alden/lineVfxPolish';
import { ensureAldenWorldAbilityRuntime, triggerAldenWorldAbility } from './heroes/alden/worldAbilityRuntime';
import { upgradeBasePresentation } from './map/basePresentation';
import { animateRiverSurface, buildDawnreachMap } from './map/buildDawnreachMap';
import { createMapCollisionWorld } from './map/collisionWorld';
import { DAWNREACH_LAYOUT, MAP_BOUNDS, getTeamStartSpawnPosition } from './map/mapLayout';
import { polishRiverBridges } from './map/polishRiverBridges';
import { createWaterEffects } from './map/waterEffects';
import {
  createDawnreachNavigationWorld,
  createNavigationDebugGroup,
  NAVIGATION_DEBUG,
  updateNavigationDebugPath,
} from './navigation/dawnreachNavigation';
import type { NavigationPath } from './navigation/navigationWorld';
import { prepareHeavyRevealAssets } from './shared/prepareHeavyRevealAssets';
import { createProceduralTextures } from './shared/textures';
import { HERO_PROGRESSION_TUNING, type AbilityKey, type HeroStats, type MatchHeroState } from './match';
import { toMatchGameTimeMs } from './match/matchPauseRuntime';
import { createVisionSystem } from './vision/visionSystem';

type HeroOverlayState = {
  hero: MatchHeroState;
  stats: Pick<HeroStats, 'maxHp' | 'maxResource' | 'attackDamage' | 'attackSpeed'>;
};

export type DawnreachSharedPlayer = Readonly<{
  userId: string;
  username: string;
  team: 'blue' | 'red';
  slot: number;
  heroId: string;
}>;

export type DawnreachRemoteHeroState = Readonly<{
  userId: string;
  sequence: number;
  position: Readonly<{ x: number; y: number; z: number }>;
  yaw: number;
  moving: boolean;
  currentHp: number;
  maxHp: number;
  currentResource: number;
  maxResource: number;
  level: number;
  alive: boolean;
}>;

export type DawnreachGameOptions = Readonly<{
  localPlayerId?: string;
  localTeam?: 'blue' | 'red';
  localWorldEntityId?: string;
  players?: readonly DawnreachSharedPlayer[];
}>;

export type DawnreachCreepNetworkSnapshot = LaneCreepNetworkSnapshot;

export type DawnreachStructureNetworkState = Readonly<{
  id: string;
  team: 'blue' | 'red';
  kind: 'tower' | 'building';
  currentHp: number;
  maxHp: number;
  alive: boolean;
}>;

export type DawnreachStructureNetworkSnapshot = Readonly<{
  sequence: number;
  sentAt: number;
  structures: readonly DawnreachStructureNetworkState[];
}>;

function creepAuthorityPlayerId(players: readonly DawnreachSharedPlayer[], fallback: string) {
  if (players.length === 0) return fallback;
  return [...players]
    .sort((left, right) => {
      const teamOrder = (left.team === 'blue' ? 0 : 1) - (right.team === 'blue' ? 0 : 1);
      return teamOrder || left.slot - right.slot || left.userId.localeCompare(right.userId);
    })[0]?.userId ?? fallback;
}

const heroIcons = import.meta.glob<string>('./heroes/*/images/*I.webp', {
  eager: true, query: '?url', import: 'default',
});

type Point3 = { x: number; z: number };
type AttackOrder =
  | { kind: 'ground'; point: Point3 }
  | { kind: 'target'; target: GameEntity };
type AttackMovePriorityMode = 'nearest-hero' | 'nearest-cursor';
type CommandMarkerKind = 'move' | 'attack';

const VIEW_HEIGHT = 18;
const MAP_EDGE_PADDING = 1.25;
const CAMERA_OFFSET = new THREE.Vector3(0, 34, 16.3);
const CAMERA_PAN_SPEED = 8.5;
const MINIMAP_PADDING = 1.0;
const MINIMAP_CAMERA_HEIGHT = 90;
const MINIMAP_RENDER_INTERVAL = 0.16;
const MINIMAP_FORCE_REFRESH_INTERVAL = 0.45;
const MINIMAP_MAIN_RENDER_BUDGET_MS = 10;
const GAME_HERO_SCALE = 0.68;
const GAME_MOVE_SPEED = HUMANOID_DEFAULT_MOVE_SPEED * 0.68;
const HERO_COLLISION_RADIUS = 0.48;
const HERO_GROUND_OFFSET = 0.03;
const SURFACE_RAY_HEIGHT = 64;
const ATTACK_RANGE = 1.35;
// Kept deliberately separate from attack range. At Dawnreach's current world scale this
// mirrors the classic ~800 acquisition / ~150 melee attack-range relationship from Dota.
const ATTACK_MOVE_ACQUISITION_RANGE = 7.2;
const ATTACK_MOVE_SCAN_INTERVAL = 0.08;
const ATTACK_MOVE_PRIORITY_STORAGE_KEY = 'dawnreach.attackMovePriority';
const FALLBACK_ATTACK_COOLDOWN = 0.72;
const ATTACK_SWING_RATE = 3.4;
const ATTACK_IMPACT_SWING_PROGRESS = 0.38;
const ATTACK_WINDUP_SECONDS = ATTACK_IMPACT_SWING_PROGRESS / ATTACK_SWING_RATE;
const COMMAND_MARKER_Y = 0.12;
const WAYPOINT_REACHED_DISTANCE = 0.22;
const STUCK_REPATH_DELAY = 0.42;
const REPATH_COOLDOWN = 0.7;
const PARTIAL_ROUTE_REPATH_INTERVAL = 0.24;
const BLOCKED_ROUTE_REPATH_COOLDOWN = 0.12;
const TARGET_REPATH_DISTANCE = 0.75;
const TARGET_REPATH_COOLDOWN = 0.35;
const VISION_UPDATE_INTERVAL = 0.1;
const RESPAWN_HOLD_KEY = 'dawnreachRespawnHold';
const ATTACK_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='10' fill='none' stroke='%23ff625b' stroke-width='2'/%3E%3Cpath d='M16 2v6M16 24v6M2 16h6M24 16h6' stroke='%23ffd2a4' stroke-width='2' stroke-linecap='round'/%3E%3Cpath d='M10 22L22 10M19 8l5 5M9 23l-1 3 3-1' fill='none' stroke='%23ffffff' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") 16 16, crosshair`;

function readAttackMovePriorityMode(): AttackMovePriorityMode {
  try {
    const stored = window.localStorage.getItem(ATTACK_MOVE_PRIORITY_STORAGE_KEY);
    return stored === 'nearest-cursor' || stored === 'smart'
      ? 'nearest-cursor'
      : 'nearest-hero';
  } catch {
    return 'nearest-hero';
  }
}

if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}

export async function createDawnreachGame(
  host: HTMLDivElement,
  minimapHost?: HTMLDivElement | null,
  minimapHeroMarker?: HTMLImageElement | null,
  getHeroState?: () => HeroOverlayState | null,
  options: DawnreachGameOptions = {},
) {
  const localTeam: 'blue' | 'red' = options.localTeam ?? 'blue';
  const localPlayerId = options.localPlayerId ?? 'local-player';
  const localWorldEntityId = options.localWorldEntityId ?? 'blue-hero-alden';
  const sharedPlayers = options.players ?? [];
  const localSharedPlayer = sharedPlayers.find(player => player.userId === localPlayerId) ?? null;
  const playerSpawn = (team: 'blue' | 'red', slot = 0) => {
    const base = getTeamStartSpawnPosition(team);
    const centeredSlot = THREE.MathUtils.clamp(slot, 0, 4) - 2;
    const sign = team === 'blue' ? 1 : -1;
    return {
      x: base.x + centeredSlot * 0.72,
      z: base.z + centeredSlot * 0.46 * sign,
    };
  };
  const localSpawn = playerSpawn(localTeam, localSharedPlayer?.slot ?? 0);
  const creepAuthorityId = creepAuthorityPlayerId(sharedPlayers, localPlayerId);
  const creepNetworkMode = sharedPlayers.length > 1 && creepAuthorityId !== localPlayerId
    ? 'replica'
    : 'authority';

  const scene = new THREE.Scene();
  scene.userData.laneCreepNetworkMode = creepNetworkMode;
  scene.userData.laneCreepAuthorityPlayerId = creepAuthorityId;
  // Team-relative presentation (health bars, fog/overheads) must know the viewer's side
  // before authored entities are registered and their overheads are attached.
  scene.userData.localTeam = localTeam;
  scene.background = new THREE.Color(0x758994);
  scene.fog = new THREE.Fog(0x758994, 42, 100);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.domElement.className = 'game-canvas';
  renderer.domElement.dataset.dawnreachReady = 'false';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  host.appendChild(renderer.domElement);

  const camera = new THREE.OrthographicCamera(-10, 10, 9, -9, 0.1, 120);

  const minimapRenderer = minimapHost
    ? new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' })
    : null;
  const minimapCamera = minimapRenderer
    ? new THREE.OrthographicCamera(-48, 48, 48, -48, 0.1, 180)
    : null;
  const minimapBackground = new THREE.Color(0x07100e);

  if (minimapRenderer && minimapCamera && minimapHost) {
    minimapRenderer.setPixelRatio(1);
    minimapRenderer.shadowMap.enabled = false;
    minimapRenderer.outputColorSpace = THREE.SRGBColorSpace;
    minimapRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    minimapRenderer.toneMappingExposure = 1.08;
    minimapRenderer.domElement.className = 'minimap-canvas';
    minimapRenderer.domElement.style.display = 'block';
    minimapRenderer.domElement.style.width = '100%';
    minimapRenderer.domElement.style.height = '100%';
    minimapRenderer.domElement.style.pointerEvents = 'none';
    minimapHost.appendChild(minimapRenderer.domElement);

    minimapCamera.position.set(0, MINIMAP_CAMERA_HEIGHT, 0);
    minimapCamera.up.set(0, 0, -1);
    minimapCamera.lookAt(0, 0, 0);
    minimapCamera.updateMatrixWorld();
  }

  if (minimapHeroMarker) minimapHeroMarker.style.pointerEvents = 'none';

  const minimapViewportSvg = minimapHost
    ? document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    : null;
  const minimapViewportPolygon = minimapViewportSvg
    ? document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
    : null;
  if (minimapHost && minimapViewportSvg && minimapViewportPolygon) {
    minimapViewportSvg.classList.add('minimap-camera-viewport');
    minimapViewportSvg.setAttribute('viewBox', '0 0 100 100');
    minimapViewportSvg.setAttribute('preserveAspectRatio', 'none');
    minimapViewportSvg.setAttribute('aria-hidden', 'true');
    minimapViewportSvg.appendChild(minimapViewportPolygon);
    minimapHost.appendChild(minimapViewportSvg);
  }

  const sunlight = addLighting(scene);

  const textures = createProceduralTextures();
  const battlefield = buildDawnreachMap(textures);
  const radiantDrake = battlefield.getObjectByName('radiant-drake');
  upgradeBasePresentation(battlefield, 'blue', DAWNREACH_LAYOUT.blueBase);
  upgradeBasePresentation(battlefield, 'red', DAWNREACH_LAYOUT.redBase);
  polishRiverBridges(battlefield);
  scene.add(battlefield);

  const commandSurfaces: THREE.Mesh[] = [];
  battlefield.traverse(object => {
    if (object instanceof THREE.Mesh && object.userData.commandSurface) commandSurfaces.push(object);
  });
  battlefield.updateMatrixWorld(true);

  const mapAnimations: Array<(elapsed: number) => void> = [];
  battlefield.traverse(object => {
    if (typeof object.userData.animate === 'function') mapAnimations.push(object.userData.animate);
  });
  const collisionWorld = createMapCollisionWorld(battlefield);
  battlefield.userData.collisionCounts = collisionWorld.counts;
  const navigation = createDawnreachNavigationWorld(battlefield, collisionWorld, HERO_COLLISION_RADIUS);
  const navigationDebug = NAVIGATION_DEBUG ? createNavigationDebugGroup(navigation) : null;
  if (navigationDebug) scene.add(navigationDebug);

  const waterSurfaces: THREE.Mesh<THREE.BufferGeometry>[] = [];
  battlefield.traverse(object => {
    if (object instanceof THREE.Mesh && object.userData.waterSurface) waterSurfaces.push(object);
  });
  const waterEffects = createWaterEffects(battlefield);
  scene.add(waterEffects.group);

  const previewHumanoid = new URLSearchParams(window.location.search).get('rig') === 'humanoid';
  const alden = previewHumanoid ? null : buildAlden(createAldenMaterials());
  const hero = alden ?? buildHumanoidBody();
  const heroPresentationScale = alden ? GAME_HERO_SCALE : 1;
  const heroMoveSpeed = alden ? GAME_MOVE_SPEED : HUMANOID_DEFAULT_MOVE_SPEED;
  const heroAnimationSpeed = alden ? heroMoveSpeed / heroPresentationScale : heroMoveSpeed;

  hero.root.scale.setScalar(heroPresentationScale);
  const heroOverlay = addHeroOverlay(
    hero.root,
    1,
    localSharedPlayer?.username || (sharedPlayers.length > 0 ? localPlayerId : 'Player'),
  );
  hero.root.position.set(localSpawn.x, HERO_GROUND_OFFSET, localSpawn.z);
  scene.add(hero.root);

  const entityRegistry = new GameEntityRegistry();
  registerAuthoredMapEntities(entityRegistry, battlefield, localTeam);
  const localHeroEntity = entityRegistry.register(hero.root, {
    id: localWorldEntityId,
    displayName: alden ? 'Alden' : 'Humanoid Preview',
    kind: 'hero',
    team: localTeam,
    selectable: true,
    targetable: true,
    grantsVision: true,
    visionRadius: VISION_RANGES.hero,
    visionHeight: 1.8,
    visibilityPolicy: 'vision-only',
    interaction: 'unit',
    selectionRadius: 0.78,
  });

  // The React match state owns the authoritative local HP/resource/level. Keep the world
  // GameEntity hydrated as well: Alden's world ability runtime uses this entity for healing,
  // guard/mitigation, death checks and combat events.
  let localVitalOverride: {
    currentHp: number;
    currentResource: number;
    alive: boolean;
  } | null = null;
  let lastLocalAuthoritativeSequence = -1;

  const syncLocalHeroEntityState = () => {
    const overlay = getHeroState?.() ?? null;
    if (!overlay) return null;

    const maxHp = Math.max(1, overlay.stats.maxHp);
    const maxResource = Math.max(0, overlay.stats.maxResource);
    localHeroEntity.maxHp = maxHp;
    localHeroEntity.maxResource = maxResource;

    if (localVitalOverride) {
      const overlayMatches = Math.abs(overlay.hero.currentHp - localVitalOverride.currentHp) <= 0.001
        && Math.abs(overlay.hero.currentResource - localVitalOverride.currentResource) <= 0.001;
      if (overlayMatches) localVitalOverride = null;
    }

    localHeroEntity.currentHp = THREE.MathUtils.clamp(
      localVitalOverride?.currentHp ?? overlay.hero.currentHp,
      0,
      maxHp,
    );
    localHeroEntity.currentResource = THREE.MathUtils.clamp(
      localVitalOverride?.currentResource ?? overlay.hero.currentResource,
      0,
      Math.max(maxResource, overlay.hero.currentResource),
    );
    localHeroEntity.level = Math.max(1, Math.floor(overlay.hero.level));
    localHeroEntity.alive = localVitalOverride
      ? localVitalOverride.alive && localHeroEntity.currentHp > 0
      : localHeroEntity.currentHp > 0;
    localHeroEntity.root.userData.maxHp = localHeroEntity.maxHp;
    localHeroEntity.root.userData.currentHp = localHeroEntity.currentHp;
    localHeroEntity.root.userData.maxResource = localHeroEntity.maxResource;
    localHeroEntity.root.userData.currentResource = localHeroEntity.currentResource;
    localHeroEntity.root.userData.level = localHeroEntity.level;
    localHeroEntity.root.userData.alive = localHeroEntity.alive;
    return overlay;
  };
  syncLocalHeroEntityState();

  type RemoteHeroRuntime = {
    player: DawnreachSharedPlayer;
    rig: AldenRig;
    entity: GameEntity;
    targetPosition: THREE.Vector3;
    targetYaw: number;
    moving: boolean;
    lastSequence: number;
  };
  const remoteHeroes = new Map<string, RemoteHeroRuntime>();
  for (const player of sharedPlayers) {
    if (player.userId === localPlayerId) continue;
    const remoteRig = buildAlden(createAldenMaterials());
    remoteRig.root.scale.setScalar(GAME_HERO_SCALE);
    remoteRig.root.userData.networkRemoteHero = true;
    remoteRig.root.userData.networkOwnerUserId = player.userId;
    const spawn = playerSpawn(player.team, player.slot);
    remoteRig.root.position.set(spawn.x, HERO_GROUND_OFFSET, spawn.z);
    scene.add(remoteRig.root);
    const entity = entityRegistry.register(remoteRig.root, {
      id: `player:${player.userId}:hero`,
      displayName: player.username || 'Hero',
      kind: 'hero',
      team: player.team,
      selectable: true,
      targetable: true,
      grantsVision: true,
      visionRadius: VISION_RANGES.hero,
      visionHeight: 1.8,
      visibilityPolicy: 'vision-only',
      interaction: 'unit',
      selectionRadius: 0.78,
      maxHp: 700,
      currentHp: 700,
      maxResource: 300,
      currentResource: 300,
      definitionId: player.heroId,
      level: 1,
      alive: true,
    });
    remoteHeroes.set(player.userId, {
      player,
      rig: remoteRig,
      entity,
      targetPosition: remoteRig.root.position.clone(),
      targetYaw: 0,
      moving: false,
      lastSequence: -1,
    });
    publishWorldEntityRuntime(entity.id, {
      level: entity.level,
      maxHp: entity.maxHp,
      currentHp: entity.currentHp,
      maxResource: entity.maxResource,
      currentResource: entity.currentResource,
      alive: entity.alive,
    });
  }

  const laneCreepSystem = ensureLaneCreepSystem(scene, entityRegistry);
  let structureNetworkSequence = 0;
  let lastStructureReplicaSequence = -1;

  const networkStructures = () => entityRegistry.values().filter(entity => (
    (entity.kind === 'tower' || entity.kind === 'building')
    && entity.interaction === 'attackable-structure'
    && entity.maxHp > 0
    && (entity.team === 'blue' || entity.team === 'red')
  ));

  const applyStructureState = (state: DawnreachStructureNetworkState) => {
    const entity = entityRegistry.values().find(candidate => candidate.id === state.id) ?? null;
    if (
      !entity
      || (entity.kind !== 'tower' && entity.kind !== 'building')
      || entity.interaction !== 'attackable-structure'
    ) return false;

    entity.maxHp = Math.max(1, Number(state.maxHp) || entity.maxHp);
    entity.currentHp = THREE.MathUtils.clamp(Number(state.currentHp) || 0, 0, entity.maxHp);
    entity.alive = state.alive !== false && entity.currentHp > 0;
    entity.root.userData.maxHp = entity.maxHp;
    entity.root.userData.currentHp = entity.currentHp;
    entity.root.userData.alive = entity.alive;
    if (!entity.alive) {
      entity.revealed = false;
      entity.root.userData.inVision = false;
      entity.root.visible = false;
    }

    publishWorldEntityRuntime(entity.id, {
      level: entity.level,
      maxHp: entity.maxHp,
      currentHp: entity.currentHp,
      maxResource: entity.maxResource,
      currentResource: entity.currentResource,
      alive: entity.alive,
    });
    return true;
  };

  const disconnectLaneProgression = connectLocalLaneProgression(entityRegistry, localHeroEntity);
  const vision = createVisionSystem(entityRegistry, localTeam);
  scene.userData.entityRegistry = entityRegistry;
  scene.userData.visionSystem = vision;
  scene.userData.localHeroEntityId = localWorldEntityId;
  scene.userData.localPlayerId = localPlayerId;
  scene.userData.localTeam = localTeam;

  const targetMarker = buildTargetMarker('move', 0x79ff71, 0xc3ffab);
  targetMarker.visible = false;
  scene.add(targetMarker);

  const attackMarker = buildTargetMarker('attack', 0xff5f58, 0xffc27c);
  attackMarker.visible = false;
  scene.add(attackMarker);

  const raycaster = new THREE.Raycaster();
  const selection = createEntitySelectionController(
    scene,
    entityRegistry,
    entity => entity.team === localTeam || entity.revealed,
    localTeam,
  );
  vision.updateEntityVisibility();

  // worldAbilityRuntime no longer auto-discovers a renderer. It must be mounted against
  // this exact scene/registry/hero; otherwise HUD casts only start cooldowns and never reach
  // Alden's animation, FX, damage, CC or healing implementation.
  const aldenAbilityRuntime = alden
    ? ensureAldenWorldAbilityRuntime(scene, entityRegistry, localHeroEntity, renderer.domElement, camera)
    : null;
  const aldenAbilityPresentation = alden
    ? ensureAldenAbilityPresentation(scene, entityRegistry, localHeroEntity, renderer.domElement, camera)
    : null;
  const aldenAbilityEdgePolish = alden
    ? ensureAldenAbilityEdgePolish(scene)
    : null;
  const aldenLineVfxPolish = alden
    ? ensureWorldLineVfxPolish(scene)
    : null;

  // The game scene now owns Alden's complete ability presentation explicitly. The older
  // renderer bootstrap still handles generic graphics settings, but must not become the
  // owner of ability mechanics/VFX for this scene or casts can fall back to legacy effects.
  scene.userData.dawnreachExplicitAbilityRuntime = true;

  const surfaceRay = new THREE.Raycaster();
  surfaceRay.ray.direction.set(0, -1, 0);
  const pointer = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();
  const minimapHeroPosition = new THREE.Vector3();
  const attackTargetPosition = new THREE.Vector3();
  const attackMoveCandidatePosition = new THREE.Vector3();
  const basicAttackSourcePosition = new THREE.Vector3();
  const basicAttackTargetPosition = new THREE.Vector3();
  const minimapViewportRaycaster = new THREE.Raycaster();
  const minimapViewportPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const minimapViewportHit = new THREE.Vector3();
  const minimapViewportProjected = new THREE.Vector3();
  const minimapViewportCorners = [
    new THREE.Vector2(-1, 1),
    new THREE.Vector2(1, 1),
    new THREE.Vector2(1, -1),
    new THREE.Vector2(-1, -1),
  ] as const;
  const swordRestRotation = alden ? alden.sword.rotation.clone() : null;
  const attackMovePriorityMode = readAttackMovePriorityMode();

  const sampleSurfaceHeight = (x: number, z: number, fallback = 0) => {
    surfaceRay.ray.origin.set(x, SURFACE_RAY_HEIGHT, z);
    const hit = surfaceRay.intersectObjects(commandSurfaces, false)[0];
    return hit?.point.y ?? fallback;
  };

  hero.root.position.y = sampleSurfaceHeight(
    hero.root.position.x,
    hero.root.position.z,
    0,
  ) + HERO_GROUND_OFFSET;
  for (const remote of remoteHeroes.values()) {
    remote.rig.root.position.y = sampleSurfaceHeight(
      remote.rig.root.position.x,
      remote.rig.root.position.z,
      0,
    ) + HERO_GROUND_OFFSET;
    remote.targetPosition.copy(remote.rig.root.position);
  }
  const heroSpawnSurfaceY = hero.root.position.y;
  localHeroEntity.root.userData.dawnreachRespawnPosition = {
    x: hero.root.position.x,
    y: hero.root.position.y,
    z: hero.root.position.z,
  };

  let destination: Point3 | null = null;
  let currentPath: Point3[] = [];
  let currentWaypointIndex = 0;
  let currentPathPartial = false;
  let routeRequest: Point3 | null = null;
  let stuckDuration = 0;
  let lastRepathAt = -Infinity;
  let lastRoutePlanAt = -Infinity;
  let lastRouteValidationAt = -Infinity;
  let lastAttackPathTarget: Point3 | null = null;
  let lastTargetRepathAt = -Infinity;
  let attackOrder: AttackOrder | null = null;
  let attackMoveTarget: GameEntity | null = null;
  let lastAttackMoveScanAt = -Infinity;
  let attackArmed = false;
  let attackCooldown = 0;
  let attackSwing = 0;
  let openingAttackReady = true;
  let pendingAttackTarget: GameEntity | null = null;
  let attackImpactApplied = false;
  let holdPositionActive = false;
  let holdPositionTarget: GameEntity | null = null;
  let lastHoldPositionScanAt = -Infinity;
  let targetYaw = 0;
  let currentYaw = 0;
  let elapsed = 0;
  let localHeroMoving = false;
  let animationFrame = 0;
  let lastMinimapRender = -Infinity;
  let lastVisionUpdate = -Infinity;
  let cameraFocus: Point3 | null = null;
  let movementWasLocked = false;
  const cameraAnchor = hero.root.position.clone();

  const heroPoint = (): Point3 => ({ x: hero.root.position.x, z: hero.root.position.z });

  const clearCurrentPath = () => {
    destination = null;
    currentPath = [];
    currentWaypointIndex = 0;
    currentPathPartial = false;
    stuckDuration = 0;
    updateNavigationDebugPath(navigationDebug, null, heroPoint());
  };

  const clearMovementRoute = () => {
    clearCurrentPath();
    routeRequest = null;
  };

  const resetHeroLocomotionPose = () => {
    hero.gait.phase = 0;
    hero.gait.weight = 0;
    hero.leftLeg.rotation.x = 0;
    hero.rightLeg.rotation.x = 0;
    hero.leftShin.rotation.x = 0;
    hero.rightShin.rotation.x = 0;
    hero.leftFoot.rotation.x = 0;
    hero.rightFoot.rotation.x = 0;
    hero.leftArm.rotation.x = 0;
    hero.rightArm.rotation.x = 0;
    hero.leftForearm.rotation.x = -0.35;
    hero.rightForearm.rotation.x = -0.35;
    hero.leftForearm.rotation.z = 0;
    hero.rightForearm.rotation.z = 0;
    hero.pelvis.rotation.y = 0;
    hero.pelvis.rotation.z = 0;
    hero.pelvis.position.x = 0;
    hero.torso.rotation.y = 0;
    hero.torso.rotation.z = 0;
    hero.torso.position.x = 0;
    hero.torso.position.y = hero.torsoRestY;
    hero.head.quaternion.identity();
    hero.model.position.y = 0;
    hero.model.rotation.z = 0;
    if (alden) {
      alden.capeMotion = 0;
      alden.cape.rotation.x = 0.025;
      alden.cape.rotation.z = 0;
    }
  };

  const isHeroMovementLocked = () => {
    const overlay = getHeroState?.() ?? null;
    const entity = getGameEntity(hero.root);
    return (overlay?.hero.currentHp ?? 1) <= 0
      || entity?.alive === false
      || hero.root.userData[RESPAWN_HOLD_KEY] === true;
  };

  const isLocalHeroSelected = () => selection.getSelected() === localHeroEntity;
  const canControlLocalHero = () => isLocalHeroSelected() && !isHeroMovementLocked();

  const clearHeroOrdersForLock = () => {
    clearMovementRoute();
    attackOrder = null;
    attackMoveTarget = null;
    lastAttackPathTarget = null;
    attackCooldown = 0;
    attackSwing = 0;
    openingAttackReady = true;
    pendingAttackTarget = null;
    attackImpactApplied = false;
    holdPositionActive = false;
    holdPositionTarget = null;
    hero.root.userData.dawnreachHoldPosition = false;
    targetMarker.visible = false;
    attackMarker.visible = false;
    disarmAttack();
    if (alden && swordRestRotation) alden.sword.rotation.copy(swordRestRotation);
  };

  const applyNavigationPath = (path: NavigationPath, requested: Point3) => {
    destination = { x: path.resolvedTarget.x, z: path.resolvedTarget.z };
    routeRequest = { x: requested.x, z: requested.z };
    currentPath = path.waypoints.map(point => ({ x: point.x, z: point.z }));
    currentWaypointIndex = 0;
    currentPathPartial = path.partial;
    stuckDuration = 0;
    lastRoutePlanAt = elapsed;
    updateNavigationDebugPath(navigationDebug, path, heroPoint());
  };

  const planMovementRoute = (point: Point3, allowPartial = true, keepCurrentOnFailure = false) => {
    const requested = { x: point.x, z: point.z };
    routeRequest = requested;
    const path = navigation.findPath(heroPoint(), requested, { allowPartial });
    lastRoutePlanAt = elapsed;
    if (!path) {
      if (!keepCurrentOnFailure) {
        clearCurrentPath();
        currentPathPartial = true;
      }
      routeRequest = requested;
      return null;
    }
    applyNavigationPath(path, requested);
    return path;
  };

  const clampMapPoint = (point: THREE.Vector3): Point3 => ({
    x: THREE.MathUtils.clamp(point.x, MAP_BOUNDS.minX + MAP_EDGE_PADDING, MAP_BOUNDS.maxX - MAP_EDGE_PADDING),
    z: THREE.MathUtils.clamp(point.z, MAP_BOUNDS.minZ + MAP_EDGE_PADDING, MAP_BOUNDS.maxZ - MAP_EDGE_PADDING),
  });

  const setPointerFromEvent = (event: PointerEvent, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
  };

  const isHostileAttackTarget = (entity: GameEntity | null): entity is GameEntity => {
    if (!entity || entity === localHeroEntity) return false;
    if (!entity.targetable || !entity.alive || entity.currentHp <= 0 || entity.maxHp <= 0) return false;
    if (entity.team === localHeroEntity.team) {
      if (entity.kind !== 'creep') return false;
      if (entity.currentHp / entity.maxHp > HERO_PROGRESSION_TUNING.denyHealthFraction) return false;
      return true;
    }
    if ((entity.kind === 'tower' || entity.kind === 'building') && entity.interaction !== 'attackable-structure') return false;
    if (!vision.isEntityVisible(entity)) return false;
    return true;
  };

  const isAutomaticAttackMoveTarget = (entity: GameEntity | null): entity is GameEntity => (
    Boolean(entity && entity.team !== localHeroEntity.team && isHostileAttackTarget(entity))
  );

  const pickAttackable = () => {
    const candidates = entityRegistry.values().filter(isHostileAttackTarget);
    if (candidates.length === 0) return null;
    const hits = raycaster.intersectObjects(candidates.map(entity => entity.root), true);
    for (const hit of hits) {
      const entity = getGameEntity(hit.object);
      if (isHostileAttackTarget(entity)) return entity;
    }
    return null;
  };

  const pickGround = () => {
    const surface = raycaster.intersectObjects(commandSurfaces, false)[0];
    if (surface) return clampMapPoint(surface.point);
    if (!raycaster.ray.intersectPlane(groundPlane, hitPoint)) return null;
    return clampMapPoint(hitPoint);
  };

  const setCommandCursor = (armed: boolean) => {
    renderer.domElement.style.cursor = armed ? ATTACK_CURSOR : '';
    if (minimapHost) minimapHost.style.cursor = armed ? ATTACK_CURSOR : 'default';
  };

  const disarmAttack = () => {
    attackArmed = false;
    setCommandCursor(false);
  };

  const clearAttackSwing = () => {
    attackSwing = 0;
    pendingAttackTarget = null;
    attackImpactApplied = false;
    if (alden && swordRestRotation) alden.sword.rotation.copy(swordRestRotation);
  };

  const leaveHoldPosition = () => {
    holdPositionActive = false;
    holdPositionTarget = null;
    hero.root.userData.dawnreachHoldPosition = false;
  };

  const showCommandMarker = (marker: THREE.Group, point: Point3) => {
    marker.userData.surfaceHeight = sampleSurfaceHeight(point.x, point.z, 0);
    marker.position.set(point.x, marker.userData.surfaceHeight + COMMAND_MARKER_Y, point.z);
    marker.rotation.set(0, 0, 0);
    marker.scale.setScalar(0.72);
    marker.userData.spawnTime = elapsed;
    marker.visible = true;
  };

  const issueStopCommand = () => {
    leaveHoldPosition();
    clearMovementRoute();
    attackOrder = null;
    attackMoveTarget = null;
    lastAttackPathTarget = null;
    lastTargetRepathAt = -Infinity;
    targetMarker.visible = false;
    attackMarker.visible = false;
    disarmAttack();
    clearAttackSwing();
    openingAttackReady = attackCooldown <= 0;
  };

  const issueHoldPositionCommand = () => {
    clearMovementRoute();
    attackOrder = null;
    attackMoveTarget = null;
    lastAttackPathTarget = null;
    lastTargetRepathAt = -Infinity;
    targetMarker.visible = false;
    attackMarker.visible = false;
    disarmAttack();
    clearAttackSwing();
    holdPositionActive = true;
    holdPositionTarget = null;
    lastHoldPositionScanAt = -Infinity;
    hero.root.userData.dawnreachHoldPosition = true;
    openingAttackReady = attackCooldown <= 0;
  };

  const issueMoveCommand = (point: Point3) => {
    leaveHoldPosition();
    attackOrder = null;
    attackMoveTarget = null;
    lastAttackPathTarget = null;
    pendingAttackTarget = null;
    attackImpactApplied = false;
    disarmAttack();
    attackMarker.visible = false;
    planMovementRoute(point, true);
    showCommandMarker(targetMarker, point);
  };

  const issueGroundAttack = (point: Point3) => {
    leaveHoldPosition();
    attackOrder = { kind: 'ground', point };
    attackMoveTarget = null;
    lastAttackMoveScanAt = -Infinity;
    lastAttackPathTarget = null;
    pendingAttackTarget = null;
    attackImpactApplied = false;
    planMovementRoute(point, true);
    disarmAttack();
    targetMarker.visible = false;
    showCommandMarker(attackMarker, point);
  };

  const issueTargetAttack = (target: GameEntity) => {
    leaveHoldPosition();
    attackOrder = { kind: 'target', target };
    attackMoveTarget = null;
    pendingAttackTarget = null;
    attackImpactApplied = false;
    disarmAttack();
    targetMarker.visible = false;
    target.root.getWorldPosition(attackTargetPosition);
    const targetPoint = { x: attackTargetPosition.x, z: attackTargetPosition.z };
    lastAttackPathTarget = targetPoint;
    lastTargetRepathAt = elapsed;
    planMovementRoute(targetPoint, true);
    showCommandMarker(attackMarker, targetPoint);
  };

  const getTargetAttackReach = (target: GameEntity) => {
    // Large jungle creatures use their complete selection halo as their physical combat hull.
    // This keeps Aurelios attackable from the edge of his visible footprint instead of
    // forcing melee heroes to path deep into the dragon model before a swing can begin.
    const combatHullRadius = target.kind === 'jungle-creature'
      ? Math.max(0, target.selectionRadius)
      : Math.max(0, target.selectionRadius) * 0.45;
    return ATTACK_RANGE + combatHullRadius;
  };

  const findAttackMoveTarget = (commandPoint: Point3) => {
    let best: GameEntity | null = null;
    let bestPrimaryDistance = Infinity;
    let bestSecondaryDistance = Infinity;

    for (const entity of entityRegistry.values()) {
      if (!isAutomaticAttackMoveTarget(entity)) continue;
      entity.root.getWorldPosition(attackMoveCandidatePosition);

      const heroDistance = Math.hypot(
        attackMoveCandidatePosition.x - hero.root.position.x,
        attackMoveCandidatePosition.z - hero.root.position.z,
      );
      const acquisitionRange = Math.max(ATTACK_MOVE_ACQUISITION_RANGE, getTargetAttackReach(entity));
      if (heroDistance > acquisitionRange) continue;

      const cursorDistance = Math.hypot(
        attackMoveCandidatePosition.x - commandPoint.x,
        attackMoveCandidatePosition.z - commandPoint.z,
      );
      const primaryDistance = attackMovePriorityMode === 'nearest-cursor' ? cursorDistance : heroDistance;
      const secondaryDistance = attackMovePriorityMode === 'nearest-cursor' ? heroDistance : cursorDistance;

      if (primaryDistance < bestPrimaryDistance - 1e-4
        || (Math.abs(primaryDistance - bestPrimaryDistance) <= 1e-4 && secondaryDistance < bestSecondaryDistance)) {
        best = entity;
        bestPrimaryDistance = primaryDistance;
        bestSecondaryDistance = secondaryDistance;
      }
    }

    return best;
  };

  const findNearestAcquisitionTarget = (exclude: GameEntity | null = null) => {
    let best: GameEntity | null = null;
    let bestDistance = Infinity;

    for (const entity of entityRegistry.values()) {
      if (entity === exclude || !isAutomaticAttackMoveTarget(entity)) continue;
      entity.root.getWorldPosition(attackMoveCandidatePosition);
      const distance = Math.hypot(
        attackMoveCandidatePosition.x - hero.root.position.x,
        attackMoveCandidatePosition.z - hero.root.position.z,
      );
      const acquisitionRange = Math.max(ATTACK_MOVE_ACQUISITION_RANGE, getTargetAttackReach(entity));
      if (distance > acquisitionRange || distance >= bestDistance) continue;
      best = entity;
      bestDistance = distance;
    }

    return best;
  };

  const getAttackCooldownSeconds = () => {
    const speed = getHeroState?.()?.stats.attackSpeed;
    if (!Number.isFinite(speed) || !speed || speed <= 0) return FALLBACK_ATTACK_COOLDOWN;
    return THREE.MathUtils.clamp(1 / speed, 0.28, 2.5);
  };

  const triggerAttack = (target: GameEntity | null = null, openingStrike = false) => {
    const attackInterval = getAttackCooldownSeconds();
    // The opening strike skips only the pre-impact wind-up. Shorten the first cooldown by
    // exactly that skipped time so the second impact still lands one full attack interval
    // after the opener; target switching cannot manufacture extra attack speed.
    attackCooldown = openingStrike
      ? Math.max(0, attackInterval - ATTACK_WINDUP_SECONDS)
      : attackInterval;
    attackSwing = openingStrike ? ATTACK_IMPACT_SWING_PROGRESS : 0.0001;
    pendingAttackTarget = target;
    attackImpactApplied = false;
  };

  const pursueAttackTarget = (target: GameEntity, followCommandMarker: boolean) => {
    target.root.getWorldPosition(attackTargetPosition);
    if (followCommandMarker
      && (attackMarker.position.x !== attackTargetPosition.x || attackMarker.position.z !== attackTargetPosition.z)) {
      attackMarker.position.x = attackTargetPosition.x;
      attackMarker.position.z = attackTargetPosition.z;
      attackMarker.userData.surfaceHeight = sampleSurfaceHeight(attackTargetPosition.x, attackTargetPosition.z, 0);
    }

    const dx = attackTargetPosition.x - hero.root.position.x;
    const dz = attackTargetPosition.z - hero.root.position.z;
    const distance = Math.hypot(dx, dz);
    const attackReach = getTargetAttackReach(target);
    if (distance > attackReach) {
      const targetPoint = { x: attackTargetPosition.x, z: attackTargetPosition.z };
      const targetMoved = !lastAttackPathTarget
        || Math.hypot(targetPoint.x - lastAttackPathTarget.x, targetPoint.z - lastAttackPathTarget.z) >= TARGET_REPATH_DISTANCE;
      const retryPartial = currentPathPartial && elapsed - lastRoutePlanAt >= PARTIAL_ROUTE_REPATH_INTERVAL;
      if ((targetMoved || !destination || retryPartial) && elapsed - lastTargetRepathAt >= TARGET_REPATH_COOLDOWN) {
        planMovementRoute(targetPoint, true, true);
        lastAttackPathTarget = targetPoint;
        lastTargetRepathAt = elapsed;
      }
    } else {
      clearMovementRoute();
      targetYaw = Math.atan2(dx, dz);
      if (attackCooldown <= 0 && attackSwing <= 0) {
        const openingStrike = openingAttackReady;
        openingAttackReady = false;
        triggerAttack(target, openingStrike);
      }
    }
  };

  const resumeGroundAttackMove = (point: Point3) => {
    lastAttackPathTarget = null;
    lastTargetRepathAt = -Infinity;
    clearMovementRoute();
    planMovementRoute(point, true);
  };

  const continueTargetAttackChain = (finishedTarget: GameEntity) => {
    pendingAttackTarget = null;
    lastAttackPathTarget = null;
    lastTargetRepathAt = -Infinity;
    clearMovementRoute();

    const nextTarget = findNearestAcquisitionTarget(finishedTarget);
    if (!nextTarget) {
      attackOrder = null;
      attackMarker.visible = false;
      return false;
    }

    attackOrder = { kind: 'target', target: nextTarget };
    // This target was acquired automatically, not clicked by the player, so do not create
    // another command marker. The thin hostile-target indicator is handled independently.
    attackMarker.visible = false;
    return true;
  };

  const applyBasicAttackImpact = (target: GameEntity) => {
    if (!isHostileAttackTarget(target)) return;
    const overlay = getHeroState?.() ?? null;
    const baseDamage = Math.max(1, overlay?.stats.attackDamage ?? 66);
    const damage = calculateTowerAuraAdjustedDamage(localHeroEntity, target, baseDamage);
    const nowMs = performance.now();

    localHeroEntity.root.getWorldPosition(basicAttackSourcePosition);
    target.root.getWorldPosition(basicAttackTargetPosition);
    publishWorldAttackEvent({
      attackerId: localHeroEntity.id,
      targetId: target.id,
      attackerTeam: localHeroEntity.team,
      targetTeam: target.team,
      attackerKind: localHeroEntity.kind,
      targetKind: target.kind,
      attackerPosition: { x: basicAttackSourcePosition.x, z: basicAttackSourcePosition.z },
      targetPosition: { x: basicAttackTargetPosition.x, z: basicAttackTargetPosition.z },
      atMs: nowMs,
    });

    const networkRemoteHero = target.kind === 'hero' && target.root.userData.networkRemoteHero === true;
    const networkRemoteCreep = target.kind === 'creep' && target.root.userData.networkReplica === true;
    const networkRemoteStructure = creepNetworkMode === 'replica'
      && (target.kind === 'tower' || target.kind === 'building')
      && target.interaction === 'attackable-structure';

    if (networkRemoteHero || networkRemoteCreep || networkRemoteStructure) {
      // Remote heroes and shared world units are reconciled by server canonical state.
      // Emit the requested damage, but do not predict HP/death locally or a later
      // authoritative snapshot can visibly resurrect the target.
      emitWorldCombatEvent({
        entityId: target.id,
        reason: 'damage',
        currentHp: target.currentHp,
        currentResource: target.currentResource,
        alive: target.alive,
        amount: damage,
        sourceEntityId: localHeroEntity.id,
        damageType: 'physical',
        isDirect: true,
        isFromFront: true,
        atMs: nowMs,
      });
      return;
    }

    target.currentHp = Math.max(0, target.currentHp - damage);
    target.root.userData.currentHp = target.currentHp;
    const aliveAfterHit = target.currentHp > 0;
    if (!aliveAfterHit && target.kind !== 'hero') target.alive = false;

    publishWorldEntityRuntime(target.id, {
      level: target.level,
      maxHp: target.maxHp,
      currentHp: target.currentHp,
      maxResource: target.maxResource,
      currentResource: target.currentResource,
      alive: aliveAfterHit,
    });
    emitWorldCombatEvent({
      entityId: target.id,
      reason: aliveAfterHit ? 'damage' : 'death',
      currentHp: target.currentHp,
      currentResource: target.currentResource,
      alive: aliveAfterHit,
      amount: damage,
      sourceEntityId: localHeroEntity.id,
      damageType: 'physical',
      isDirect: true,
      isFromFront: true,
      atMs: nowMs,
    });

    if (!aliveAfterHit && attackOrder?.kind === 'target' && attackOrder.target === target) {
      continueTargetAttackChain(target);
    }
  };

  const onContextMenu = (event: MouseEvent) => event.preventDefault();

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 && event.button !== 2) return;
    const movementLocked = isHeroMovementLocked();
    setPointerFromEvent(event, renderer.domElement);
    raycaster.setFromCamera(pointer, camera);

    if (event.button === 2) {
      if (!canControlLocalHero()) {
        event.preventDefault();
        return;
      }
      const target = pickAttackable();
      if (target) {
        issueTargetAttack(target);
        return;
      }
      const ground = pickGround();
      if (ground) issueMoveCommand(ground);
      return;
    }

    if (movementLocked) {
      disarmAttack();
      selection.pick(raycaster);
      return;
    }

    if (!attackArmed) {
      selection.pick(raycaster);
      return;
    }

    if (!isLocalHeroSelected()) {
      disarmAttack();
      selection.pick(raycaster);
      return;
    }

    const target = pickAttackable();
    if (target) {
      issueTargetAttack(target);
      return;
    }
    const ground = pickGround();
    if (ground) issueGroundAttack(ground);
  };

  const onMinimapPointerDown = (event: PointerEvent) => {
    if (!minimapHost || !minimapCamera || (event.button !== 0 && event.button !== 2)) return;
    event.preventDefault();
    event.stopPropagation();
    const movementLocked = isHeroMovementLocked();
    setPointerFromEvent(event, minimapHost);
    raycaster.setFromCamera(pointer, minimapCamera);

    if (event.button === 2) {
      if (!canControlLocalHero()) return;
      const target = pickAttackable();
      if (target) {
        issueTargetAttack(target);
        return;
      }
      const ground = pickGround();
      if (ground) issueMoveCommand(ground);
      return;
    }

    if (movementLocked) {
      disarmAttack();
      const ground = pickGround();
      if (ground) cameraFocus = { x: ground.x, z: ground.z };
      return;
    }

    if (!attackArmed) {
      const ground = pickGround();
      if (ground) cameraFocus = { x: ground.x, z: ground.z };
      return;
    }

    if (!isLocalHeroSelected()) {
      disarmAttack();
      return;
    }

    const target = pickAttackable();
    if (target) {
      issueTargetAttack(target);
      return;
    }
    const ground = pickGround();
    if (ground) issueGroundAttack(ground);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) return;
    const target = event.target as HTMLElement | null;
    if (target?.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;

    if (event.code === 'KeyA') {
      if (!canControlLocalHero()) return;
      event.preventDefault();
      attackArmed = true;
      setCommandCursor(true);
      return;
    }

    if (event.code === 'KeyS') {
      if (!canControlLocalHero()) return;
      event.preventDefault();
      issueStopCommand();
      return;
    }

    if (event.code === 'KeyH') {
      if (!canControlLocalHero()) return;
      event.preventDefault();
      issueHoldPositionCommand();
      return;
    }

    if (event.code === 'Space') {
      event.preventDefault();
      cameraFocus = null;
      return;
    }

    if (event.code === 'Escape' && attackArmed) {
      event.preventDefault();
      disarmAttack();
    }
  };

  renderer.domElement.addEventListener('contextmenu', onContextMenu);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  minimapHost?.addEventListener('contextmenu', onContextMenu);
  minimapHost?.addEventListener('pointerdown', onMinimapPointerDown);
  window.addEventListener('keydown', onKeyDown);

  const resizeMinimap = () => {
    if (!minimapRenderer || !minimapCamera || !minimapHost) return;

    const width = Math.max(1, minimapHost.clientWidth);
    const height = Math.max(1, minimapHost.clientHeight);
    const viewportAspect = width / height;
    const mapWidth = MAP_BOUNDS.maxX - MAP_BOUNDS.minX;
    const mapHeight = MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ;
    const mapAspect = mapWidth / mapHeight;

    let halfWidth: number;
    let halfHeight: number;

    if (viewportAspect >= mapAspect) {
      halfHeight = (mapHeight / 2) * MINIMAP_PADDING;
      halfWidth = halfHeight * viewportAspect;
    } else {
      halfWidth = (mapWidth / 2) * MINIMAP_PADDING;
      halfHeight = halfWidth / viewportAspect;
    }

    minimapCamera.left = -halfWidth;
    minimapCamera.right = halfWidth;
    minimapCamera.top = halfHeight;
    minimapCamera.bottom = -halfHeight;
    minimapCamera.updateProjectionMatrix();
    minimapRenderer.setSize(width, height, false);
  };

  const resize = () => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    const aspect = width / height;
    const halfH = VIEW_HEIGHT / 2;
    const halfW = halfH * aspect;

    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    resizeMinimap();
  };

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  if (minimapHost) resizeObserver.observe(minimapHost);
  resize();

  const clock = new THREE.Clock();

  const updateCamera = (dt = 1 / 60) => {
    if (cameraFocus) {
      const targetY = sampleSurfaceHeight(cameraFocus.x, cameraFocus.z, 0) + HERO_GROUND_OFFSET;
      const blend = 1 - Math.exp(-CAMERA_PAN_SPEED * dt);
      cameraAnchor.x = THREE.MathUtils.lerp(cameraAnchor.x, cameraFocus.x, blend);
      cameraAnchor.y = THREE.MathUtils.lerp(cameraAnchor.y, targetY, blend);
      cameraAnchor.z = THREE.MathUtils.lerp(cameraAnchor.z, cameraFocus.z, blend);
    } else {
      cameraAnchor.copy(hero.root.position);
    }

    const target = cameraAnchor;
    sunlight.position.set(target.x - 16, target.y + 32, target.z + 14);
    sunlight.target.position.set(target.x, target.y, target.z);
    sunlight.target.updateMatrixWorld(true);
    camera.position.set(
      target.x + CAMERA_OFFSET.x,
      target.y + CAMERA_OFFSET.y,
      target.z + CAMERA_OFFSET.z,
    );
    camera.lookAt(target.x, target.y, target.z);
    camera.updateMatrixWorld();
  };

  const updateMinimapCameraViewport = () => {
    if (!minimapCamera || !minimapViewportPolygon) return;

    minimapViewportPlane.constant = -cameraAnchor.y;
    const points: string[] = [];
    for (const corner of minimapViewportCorners) {
      minimapViewportRaycaster.setFromCamera(corner, camera);
      const intersection = minimapViewportRaycaster.ray.intersectPlane(minimapViewportPlane, minimapViewportHit);
      if (!intersection) {
        minimapViewportPolygon.setAttribute('points', '');
        return;
      }

      minimapViewportProjected
        .set(intersection.x, 0, intersection.z)
        .project(minimapCamera);
      const x = (minimapViewportProjected.x * 0.5 + 0.5) * 100;
      const y = (-minimapViewportProjected.y * 0.5 + 0.5) * 100;
      points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    }
    minimapViewportPolygon.setAttribute('points', points.join(' '));
  };

  const updateMinimapHeroMarker = () => {
    if (!minimapCamera || !minimapHeroMarker) return;

    minimapHeroPosition
      .set(hero.root.position.x, 0, hero.root.position.z)
      .project(minimapCamera);

    const left = (minimapHeroPosition.x * 0.5 + 0.5) * 100;
    const top = (-minimapHeroPosition.y * 0.5 + 0.5) * 100;

    minimapHeroMarker.style.left = `${left}%`;
    minimapHeroMarker.style.top = `${top}%`;
  };

  const renderMinimap = () => {
    if (!minimapRenderer || !minimapCamera) return;

    const fog = scene.fog;
    const background = scene.background;
    const heroWasVisible = hero.root.visible;
    const drakeWasVisible = radiantDrake?.visible ?? false;
    scene.fog = null;
    scene.background = minimapBackground;
    hero.root.visible = false;
    if (radiantDrake) radiantDrake.visible = false;
    try {
      minimapRenderer.render(scene, minimapCamera);
    } finally {
      hero.root.visible = heroWasVisible;
      if (radiantDrake) radiantDrake.visible = drakeWasVisible;
      scene.background = background;
      scene.fog = fog;
    }
    updateMinimapHeroMarker();
  };

  updateCamera();
  await prepareHeavyRevealAssets(renderer, scene, camera, sunlight, CAMERA_OFFSET);
  renderer.domElement.dataset.dawnreachReady = 'true';
  updateMinimapCameraViewport();
  updateMinimapHeroMarker();

  const animate = () => {
    animationFrame = requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;
    attackCooldown = Math.max(0, attackCooldown - dt);

    if (!attackOrder && !attackMoveTarget && !holdPositionActive && attackCooldown <= 0 && attackSwing <= 0) {
      openingAttackReady = true;
    }

    syncLocalHeroEntityState();

    if (elapsed - lastVisionUpdate >= VISION_UPDATE_INTERVAL) {
      vision.updateEntityVisibility();
      lastVisionUpdate = elapsed;
    }
    selection.update();

    const worldHeroEntity = getGameEntity(hero.root);
    if (worldHeroEntity?.alive && movementWasLocked) {
      const atSpawn = Math.hypot(
        hero.root.position.x - localSpawn.x,
        hero.root.position.z - localSpawn.z,
      ) <= 0.08;
      if (atSpawn) hero.root.position.y = heroSpawnSurfaceY;
      hero.root.visible = true;
      hero.model.visible = true;
    }

    const movementLocked = isHeroMovementLocked();
    if (movementLocked) {
      if (!movementWasLocked) clearHeroOrdersForLock();
      resetHeroLocomotionPose();
    }
    movementWasLocked = movementLocked;

    if (!movementLocked && holdPositionActive) {
      clearMovementRoute();

      if (holdPositionTarget && (!holdPositionTarget.root.parent || !isAutomaticAttackMoveTarget(holdPositionTarget))) {
        if (pendingAttackTarget === holdPositionTarget) pendingAttackTarget = null;
        holdPositionTarget = null;
      }

      if ((!holdPositionTarget || elapsed - lastHoldPositionScanAt >= ATTACK_MOVE_SCAN_INTERVAL) && attackSwing <= 0) {
        lastHoldPositionScanAt = elapsed;
        const candidate = findNearestAcquisitionTarget();
        if (candidate) {
          candidate.root.getWorldPosition(attackTargetPosition);
          const distance = Math.hypot(
            attackTargetPosition.x - hero.root.position.x,
            attackTargetPosition.z - hero.root.position.z,
          );
          holdPositionTarget = distance <= getTargetAttackReach(candidate) ? candidate : null;
        } else {
          holdPositionTarget = null;
        }
      }

      if (holdPositionTarget) {
        holdPositionTarget.root.getWorldPosition(attackTargetPosition);
        const dx = attackTargetPosition.x - hero.root.position.x;
        const dz = attackTargetPosition.z - hero.root.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance > getTargetAttackReach(holdPositionTarget)) {
          if (pendingAttackTarget === holdPositionTarget) pendingAttackTarget = null;
          holdPositionTarget = null;
        } else {
          targetYaw = Math.atan2(dx, dz);
          if (attackCooldown <= 0 && attackSwing <= 0) {
            const openingStrike = openingAttackReady;
            openingAttackReady = false;
            triggerAttack(holdPositionTarget, openingStrike);
          }
        }
      }
    }

    if (!movementLocked && !holdPositionActive && attackOrder?.kind === 'ground') {
      const groundOrder = attackOrder;

      if (attackMoveTarget && (!attackMoveTarget.root.parent || !isAutomaticAttackMoveTarget(attackMoveTarget))) {
        if (pendingAttackTarget === attackMoveTarget) pendingAttackTarget = null;
        attackMoveTarget = null;
        resumeGroundAttackMove(groundOrder.point);
      }

      if (!attackMoveTarget && elapsed - lastAttackMoveScanAt >= ATTACK_MOVE_SCAN_INTERVAL) {
        lastAttackMoveScanAt = elapsed;
        const acquired = findAttackMoveTarget(groundOrder.point);
        if (acquired) {
          attackMoveTarget = acquired;
          lastAttackPathTarget = null;
          lastTargetRepathAt = -Infinity;
          clearMovementRoute();
        }
      }

      if (attackMoveTarget) pursueAttackTarget(attackMoveTarget, false);
    }

    if (!movementLocked && !holdPositionActive && attackOrder?.kind === 'target') {
      const target = attackOrder.target;
      if (!target.root.parent || !isHostileAttackTarget(target)) {
        const targetWasDefeated = target.currentHp <= 0 || target.alive === false;
        if (targetWasDefeated) continueTargetAttackChain(target);
        else {
          attackOrder = null;
          pendingAttackTarget = null;
          clearMovementRoute();
          attackMarker.visible = false;
        }
      } else {
        pursueAttackTarget(target, true);
      }
    }

    if (!movementLocked && !holdPositionActive && routeRequest && attackOrder?.kind !== 'target' && !attackMoveTarget) {
      const nextWaypoint = destination && currentWaypointIndex < currentPath.length
        ? currentPath[currentWaypointIndex]
        : null;
      let segmentBlocked = false;
      if (nextWaypoint && elapsed - lastRouteValidationAt >= BLOCKED_ROUTE_REPATH_COOLDOWN) {
        lastRouteValidationAt = elapsed;
        segmentBlocked = !navigation.segmentIsWalkable(heroPoint(), nextWaypoint);
      }

      const routeMissing = !destination || currentPath.length === 0 || currentWaypointIndex >= currentPath.length;
      const retryPartial = (routeMissing || currentPathPartial)
        && elapsed - lastRoutePlanAt >= PARTIAL_ROUTE_REPATH_INTERVAL;

      if (retryPartial || segmentBlocked) {
        const requested = { ...routeRequest };
        lastRepathAt = elapsed;
        planMovementRoute(requested, true, !routeMissing && !segmentBlocked);
      }
    }

    let moving = false;
    let reachedDestination = false;

    if (!movementLocked && !holdPositionActive && destination && currentPath.length > 0) {
      while (currentWaypointIndex < currentPath.length) {
        const waypoint = currentPath[currentWaypointIndex];
        if (Math.hypot(waypoint.x - hero.root.position.x, waypoint.z - hero.root.position.z) > WAYPOINT_REACHED_DISTANCE) break;
        currentWaypointIndex++;
      }

      if (currentWaypointIndex >= currentPath.length) {
        if (currentPathPartial && routeRequest) {
          const requested = { ...routeRequest };
          clearCurrentPath();
          routeRequest = requested;
          currentPathPartial = true;
          lastRoutePlanAt = -Infinity;
        } else {
          clearMovementRoute();
          reachedDestination = true;
          targetMarker.visible = false;
        }
      } else {
        const waypoint = currentPath[currentWaypointIndex];
        const dx = waypoint.x - hero.root.position.x;
        const dz = waypoint.z - hero.root.position.z;
        const distance = Math.hypot(dx, dz);
        const step = heroMoveSpeed * dt;
        const nx = distance > 1e-8 ? dx / distance : 0;
        const nz = distance > 1e-8 ? dz / distance : 0;
        const travel = Math.min(step, distance);
        const from = heroPoint();
        const desired = { x: from.x + nx * travel, z: from.z + nz * travel };
        const resolved = collisionWorld.move(from, desired, HERO_COLLISION_RADIUS);
        const movedDistance = Math.hypot(resolved.x - from.x, resolved.z - from.z);

        hero.root.position.x = resolved.x;
        hero.root.position.z = resolved.z;
        hero.root.position.y = sampleSurfaceHeight(
          resolved.x,
          resolved.z,
          Math.max(0, hero.root.position.y - HERO_GROUND_OFFSET),
        ) + HERO_GROUND_OFFSET;
        targetYaw = Math.atan2(nx, nz);
        moving = movedDistance > 0.001;
        stuckDuration = movedDistance <= 0.0005 && travel > 0.001 ? stuckDuration + dt : 0;

        const waypointRemaining = Math.hypot(waypoint.x - resolved.x, waypoint.z - resolved.z);
        if (waypointRemaining <= WAYPOINT_REACHED_DISTANCE) currentWaypointIndex++;
        if (currentWaypointIndex >= currentPath.length) {
          if (currentPathPartial && routeRequest) {
            const requested = { ...routeRequest };
            clearCurrentPath();
            routeRequest = requested;
            currentPathPartial = true;
            lastRoutePlanAt = -Infinity;
          } else {
            clearMovementRoute();
            reachedDestination = true;
            targetMarker.visible = false;
          }
        } else if (stuckDuration >= STUCK_REPATH_DELAY && routeRequest && elapsed - lastRepathAt >= REPATH_COOLDOWN) {
          const requested = { ...routeRequest };
          lastRepathAt = elapsed;
          planMovementRoute(requested, true);
        }
      }
    }

    if (!movementLocked && !holdPositionActive && reachedDestination && attackOrder?.kind === 'ground' && !attackMoveTarget) {
      attackOrder = null;
      attackMarker.visible = false;
    }

    if (!movementLocked) {
      const yawDelta = Math.atan2(
        Math.sin(targetYaw - currentYaw),
        Math.cos(targetYaw - currentYaw),
      );
      currentYaw += yawDelta * Math.min(1, dt * 11);
      hero.model.rotation.y = currentYaw;

      localHeroMoving = moving;
      if (alden) animateAlden(alden, elapsed, moving, dt, heroAnimationSpeed);
      else animateHumanoid(hero, elapsed, moving, dt, heroAnimationSpeed);

      if (attackSwing > 0) {
        attackSwing = Math.min(1, attackSwing + dt * ATTACK_SWING_RATE);
        if (!attackImpactApplied && attackSwing >= ATTACK_IMPACT_SWING_PROGRESS) {
          attackImpactApplied = true;
          if (pendingAttackTarget) applyBasicAttackImpact(pendingAttackTarget);
        }

        if (alden && swordRestRotation) {
          const slash = Math.sin(attackSwing * Math.PI);
          alden.sword.rotation.set(
            swordRestRotation.x - slash * 0.95,
            swordRestRotation.y + slash * 0.12,
            swordRestRotation.z + slash * 0.34,
          );
        }

        if (attackSwing >= 1) {
          attackSwing = 0;
          pendingAttackTarget = null;
          attackImpactApplied = false;
          if (alden && swordRestRotation) alden.sword.rotation.copy(swordRestRotation);
        }
      }
    }

    for (const remote of remoteHeroes.values()) {
      const root = remote.rig.root;
      // Network packets must never bypass fog-of-war. The vision system owns "revealed";
      // the render loop enforces it every frame so a remote state/respawn packet cannot
      // make an enemy visible outside allied vision.
      root.visible = !remote.entity.alive
        || remote.entity.team === localTeam
        || remote.entity.revealed;

      if (!remote.entity.alive || remote.entity.currentHp <= 0) {
        remote.moving = false;
        remote.rig.model.visible = true;
        remote.rig.model.rotation.x = -Math.PI * 0.48;
        remote.entity.root.userData.currentHp = remote.entity.currentHp;
        remote.entity.root.userData.maxHp = remote.entity.maxHp;
        continue;
      }

      remote.rig.model.visible = true;
      remote.rig.model.rotation.x = 0;
      const dx = remote.targetPosition.x - root.position.x;
      const dy = remote.targetPosition.y - root.position.y;
      const dz = remote.targetPosition.z - root.position.z;
      const distance = Math.hypot(dx, dz);
      const blend = 1 - Math.exp(-dt * 13);
      root.position.x = THREE.MathUtils.lerp(root.position.x, remote.targetPosition.x, blend);
      root.position.y = THREE.MathUtils.lerp(root.position.y, remote.targetPosition.y, blend);
      root.position.z = THREE.MathUtils.lerp(root.position.z, remote.targetPosition.z, blend);
      const yawDelta = Math.atan2(
        Math.sin(remote.targetYaw - remote.rig.model.rotation.y),
        Math.cos(remote.targetYaw - remote.rig.model.rotation.y),
      );
      remote.rig.model.rotation.y += yawDelta * Math.min(1, dt * 12);
      const remoteMoving = remote.moving || distance > 0.035 || Math.abs(dy) > 0.05;
      animateAlden(remote.rig, elapsed, remoteMoving, dt, heroAnimationSpeed);
      remote.entity.root.userData.currentHp = remote.entity.currentHp;
      remote.entity.root.userData.maxHp = remote.entity.maxHp;
    }

    // Apply authoritative ability mechanics/poses after locomotion so Q/R transforms are not
    // overwritten by the generic walk/attack animation. Remote hero transforms are exclusively
    // network-owned: preserve the freshly interpolated positions across every local ability/VFX
    // layer so Alden's Q dash (or any future presentation code) can never drag another player's
    // replica on this client.
    const remotePositionsBeforeAbilityFx = Array.from(remoteHeroes.values(), remote => [
      remote,
      remote.rig.root.position.clone(),
    ] as const);
    const abilityFrameNowMs = toMatchGameTimeMs(performance.now());
    aldenAbilityRuntime?.update(abilityFrameNowMs);
    aldenAbilityPresentation?.update(abilityFrameNowMs, false);
    aldenAbilityEdgePolish?.update();
    aldenLineVfxPolish?.update();
    for (const [remote, position] of remotePositionsBeforeAbilityFx) {
      if (remote.rig.root.parent) remote.rig.root.position.copy(position);
    }

    for (const marker of [targetMarker, attackMarker]) {
      if (!marker.visible) continue;
      const kind = marker.userData.kind as CommandMarkerKind;
      const age = Math.max(0, elapsed - Number(marker.userData.spawnTime ?? elapsed));
      const intro = THREE.MathUtils.smoothstep(age, 0, 0.16);
      const pulse = 1 + Math.sin(age * (kind === 'attack' ? 4.5 : 3.5)) * 0.035;
      marker.scale.setScalar((0.72 + intro * 0.28) * pulse);
      marker.rotation.y = age * (kind === 'attack' ? 1.05 : 0.65);
      marker.position.y = Number(marker.userData.surfaceHeight ?? 0) + COMMAND_MARKER_Y
        + Math.sin(age * 5 + (kind === 'attack' ? 0.8 : 0)) * 0.006;

      const accentMaterial = marker.userData.accentMaterial as THREE.MeshBasicMaterial | undefined;
      const glowMaterial = marker.userData.glowMaterial as THREE.MeshBasicMaterial | undefined;
      if (accentMaterial) accentMaterial.opacity = (kind === 'attack' ? 0.92 : 0.86) + Math.sin(elapsed * 7) * 0.07;
      if (glowMaterial) glowMaterial.opacity = 0.16 + (Math.sin(elapsed * 5) + 1) * 0.055;
    }

    updateCamera(dt);
    updateMinimapCameraViewport();
    textures.water.offset.set(Math.sin(elapsed * 0.12) * 0.025, -elapsed * 0.055);
    textures.waterFlow.offset.set(Math.sin(elapsed * 0.17) * 0.035, -elapsed * 0.07);
    for (const surface of waterSurfaces) animateRiverSurface(surface, elapsed);
    waterEffects.update(elapsed, [hero.root, ...Array.from(remoteHeroes.values(), remote => remote.rig.root)]);
    for (const animateMapObject of mapAnimations) animateMapObject(elapsed);
    heroOverlay.update(getHeroState?.() ?? null);

    const mainRenderStartedAt = performance.now();
    renderer.render(scene, camera);
    const mainRenderCostMs = performance.now() - mainRenderStartedAt;
    const minimapAge = elapsed - lastMinimapRender;
    const minimapDue = minimapAge >= MINIMAP_RENDER_INTERVAL;
    const minimapOverdue = minimapAge >= MINIMAP_FORCE_REFRESH_INTERVAL;
    if (minimapDue && (mainRenderCostMs < MINIMAP_MAIN_RENDER_BUDGET_MS || minimapOverdue)) {
      renderMinimap();
      lastMinimapRender = elapsed;
    } else {
      updateMinimapHeroMarker();
    }
  };

  animate();

  return {
    getLocalNetworkState() {
      const overlay = syncLocalHeroEntityState();
      return {
        position: {
          x: hero.root.position.x,
          y: hero.root.position.y,
          z: hero.root.position.z,
        },
        yaw: currentYaw,
        moving: localHeroMoving,
        currentHp: localHeroEntity.currentHp,
        maxHp: overlay?.stats.maxHp ?? Math.max(1, localHeroEntity.maxHp),
        currentResource: localHeroEntity.currentResource,
        maxResource: overlay?.stats.maxResource ?? localHeroEntity.maxResource,
        level: overlay?.hero.level ?? localHeroEntity.level,
        alive: localHeroEntity.alive && localHeroEntity.currentHp > 0,
      };
    },
    castLocalAbility(key: AbilityKey, rank: number, nowMs = toMatchGameTimeMs(performance.now())) {
      syncLocalHeroEntityState();
      return triggerAldenWorldAbility(scene, key, rank, nowMs);
    },
    isCreepNetworkAuthority() {
      return laneCreepSystem.isNetworkAuthority();
    },
    setNetworkAuthority(authority: boolean) {
      laneCreepSystem.setNetworkAuthority(authority);
      scene.userData.laneCreepNetworkMode = authority ? 'authority' : 'replica';
    },
    getCreepNetworkSnapshot() {
      return laneCreepSystem.getNetworkSnapshot();
    },
    getStructureNetworkSnapshot(): DawnreachStructureNetworkSnapshot | null {
      if (!laneCreepSystem.isNetworkAuthority()) return null;
      structureNetworkSequence += 1;
      return {
        sequence: structureNetworkSequence,
        sentAt: Date.now(),
        structures: networkStructures().map(entity => ({
          id: entity.id,
          team: entity.team as 'blue' | 'red',
          kind: entity.kind as 'tower' | 'building',
          currentHp: entity.currentHp,
          maxHp: entity.maxHp,
          alive: entity.alive && entity.currentHp > 0,
        })),
      };
    },
    applyRemoteCreepNetworkSnapshot(snapshot: DawnreachCreepNetworkSnapshot) {
      laneCreepSystem.applyNetworkSnapshot(snapshot);
    },
    applyRemoteStructureNetworkSnapshot(snapshot: DawnreachStructureNetworkSnapshot) {
      if (laneCreepSystem.isNetworkAuthority()) return;
      if (!Number.isFinite(snapshot.sequence) || snapshot.sequence <= lastStructureReplicaSequence) return;
      lastStructureReplicaSequence = snapshot.sequence;
      for (const state of snapshot.structures) applyStructureState(state);
      vision.updateEntityVisibility();
    },
    applyRemoteStructureDamage(input: {
      structureId: string;
      amount: number;
      sourceUserId: string;
      atMs?: number;
    }) {
      if (!laneCreepSystem.isNetworkAuthority()) return false;
      const target = networkStructures().find(entity => entity.id === input.structureId) ?? null;
      if (!target || !target.alive || target.currentHp <= 0) return false;

      const amount = Math.max(0, Number(input.amount) || 0);
      if (amount <= 0) return false;

      const atMs = input.atMs ?? toMatchGameTimeMs(performance.now());
      const source = entityRegistry.values().find(
        entity => entity.id === `player:${input.sourceUserId}:hero`,
      ) ?? null;
      if (source) {
        source.root.getWorldPosition(basicAttackSourcePosition);
        target.root.getWorldPosition(basicAttackTargetPosition);
        publishWorldAttackEvent({
          attackerId: source.id,
          targetId: target.id,
          attackerTeam: source.team,
          targetTeam: target.team,
          attackerKind: source.kind,
          targetKind: target.kind,
          attackerPosition: { x: basicAttackSourcePosition.x, z: basicAttackSourcePosition.z },
          targetPosition: { x: basicAttackTargetPosition.x, z: basicAttackTargetPosition.z },
          atMs,
        });
      }

      const before = target.currentHp;
      const currentHp = Math.max(0, before - amount);
      applyStructureState({
        id: target.id,
        team: target.team as 'blue' | 'red',
        kind: target.kind as 'tower' | 'building',
        currentHp,
        maxHp: target.maxHp,
        alive: currentHp > 0,
      });
      const dealt = Math.max(0, before - currentHp);
      emitWorldCombatEvent({
        entityId: target.id,
        reason: currentHp > 0 ? 'damage' : 'death',
        currentHp,
        currentResource: target.currentResource,
        alive: currentHp > 0,
        amount: dealt,
        sourceEntityId: source?.id ?? `player:${input.sourceUserId}:hero`,
        damageType: 'physical',
        isDirect: true,
        isFromFront: true,
        atMs,
      });
      if (currentHp <= 0) vision.updateEntityVisibility();
      return true;
    },
    applyRemoteCreepDamage(input: { creepId: string; amount: number; sourceUserId: string; atMs?: number }) {
      return laneCreepSystem.applyRemoteDamage(
        input.creepId,
        input.amount,
        `player:${input.sourceUserId}:hero`,
        input.atMs ?? toMatchGameTimeMs(performance.now()),
      );
    },
    applyLocalAuthoritativeNetworkState(state: DawnreachRemoteHeroState) {
      if (state.userId !== localPlayerId || state.sequence <= lastLocalAuthoritativeSequence) return false;
      const firstAuthoritativeState = lastLocalAuthoritativeSequence < 0;
      lastLocalAuthoritativeSequence = state.sequence;

      const wasAlive = localHeroEntity.alive && localHeroEntity.currentHp > 0;
      localHeroEntity.maxHp = Math.max(1, state.maxHp);
      localHeroEntity.currentHp = THREE.MathUtils.clamp(state.currentHp, 0, localHeroEntity.maxHp);
      localHeroEntity.maxResource = Math.max(0, state.maxResource);
      localHeroEntity.currentResource = THREE.MathUtils.clamp(
        state.currentResource,
        0,
        localHeroEntity.maxResource || state.currentResource,
      );
      localHeroEntity.level = Math.max(1, Math.floor(state.level));
      localHeroEntity.alive = Boolean(state.alive) && localHeroEntity.currentHp > 0;
      localVitalOverride = {
        currentHp: localHeroEntity.currentHp,
        currentResource: localHeroEntity.currentResource,
        alive: localHeroEntity.alive,
      };

      localHeroEntity.root.userData.maxHp = localHeroEntity.maxHp;
      localHeroEntity.root.userData.currentHp = localHeroEntity.currentHp;
      localHeroEntity.root.userData.maxResource = localHeroEntity.maxResource;
      localHeroEntity.root.userData.currentResource = localHeroEntity.currentResource;
      localHeroEntity.root.userData.level = localHeroEntity.level;
      localHeroEntity.root.userData.alive = localHeroEntity.alive;

      if (!localHeroEntity.alive) {
        hero.root.userData[RESPAWN_HOLD_KEY] = true;
        clearHeroOrdersForLock();
        hero.root.visible = true;
        hero.model.visible = true;
        hero.model.rotation.x = -Math.PI * 0.48;
      } else {
        hero.root.userData[RESPAWN_HOLD_KEY] = false;
        hero.root.visible = true;
        hero.model.visible = true;
        hero.model.rotation.x = 0;
        if (!wasAlive || firstAuthoritativeState) {
          // A dead -> alive transition respawns at the server position. The first state after
          // mounting also restores a reconnecting player's last world position. Later normal
          // echoes never correct movement, avoiding self rubber-banding.
          hero.root.position.set(state.position.x, state.position.y, state.position.z);
          currentYaw = state.yaw;
          targetYaw = state.yaw;
          hero.model.rotation.y = state.yaw;
          resetHeroLocomotionPose();
          cameraAnchor.copy(hero.root.position);
          clearHeroOrdersForLock();
        }
      }

      publishWorldEntityRuntime(localWorldEntityId, {
        level: localHeroEntity.level,
        maxHp: localHeroEntity.maxHp,
        currentHp: localHeroEntity.currentHp,
        maxResource: localHeroEntity.maxResource,
        currentResource: localHeroEntity.currentResource,
        alive: localHeroEntity.alive,
      });
      return true;
    },
    applyRemoteNetworkState(state: DawnreachRemoteHeroState) {
      if (state.userId === localPlayerId) return;
      const remote = remoteHeroes.get(state.userId);
      if (!remote || state.sequence <= remote.lastSequence) return;
      const wasAlive = remote.entity.alive;
      remote.lastSequence = state.sequence;
      remote.targetPosition.set(state.position.x, state.position.y, state.position.z);
      remote.targetYaw = state.yaw;
      remote.moving = state.moving;
      remote.entity.maxHp = Math.max(1, state.maxHp);
      remote.entity.currentHp = THREE.MathUtils.clamp(state.currentHp, 0, remote.entity.maxHp);
      remote.entity.maxResource = Math.max(0, state.maxResource);
      remote.entity.currentResource = THREE.MathUtils.clamp(state.currentResource, 0, remote.entity.maxResource || state.currentResource);
      remote.entity.level = Math.max(1, Math.floor(state.level));
      remote.entity.alive = state.alive && remote.entity.currentHp > 0;
      remote.entity.root.userData.maxHp = remote.entity.maxHp;
      remote.entity.root.userData.currentHp = remote.entity.currentHp;
      remote.entity.root.userData.maxResource = remote.entity.maxResource;
      remote.entity.root.userData.currentResource = remote.entity.currentResource;
      remote.entity.root.userData.level = remote.entity.level;
      remote.entity.root.userData.alive = remote.entity.alive;

      if (!remote.entity.alive) {
        // Corpses are public world information: once a hero is confirmed dead, every
        // player keeps the body rendered at the authoritative death position until respawn.
        remote.entity.root.visible = true;
        remote.rig.model.visible = true;
        remote.rig.model.rotation.x = -Math.PI * 0.48;
      } else {
        // Replica heroes do not own their respawn lifecycle. When the owner's authoritative
        // state becomes alive again, restore the render state immediately instead of waiting
        // for locomotion/animation to touch the model on the next movement command.
        remote.entity.root.visible = remote.entity.team === localTeam || remote.entity.revealed;
        remote.rig.model.visible = true;
        remote.rig.model.rotation.x = 0;
        remote.entity.root.userData.dawnreachRespawnAtSeconds = undefined;
        remote.entity.root.userData.dawnreachRespawnHold = false;
        remote.entity.root.userData.dawnreachDeathPosition = undefined;
        if (!wasAlive) {
          remote.entity.root.position.copy(remote.targetPosition);
          remote.rig.gait.phase = 0;
          remote.rig.gait.weight = 0;
        }
      }

      publishWorldEntityRuntime(remote.entity.id, {
        level: remote.entity.level,
        maxHp: remote.entity.maxHp,
        currentHp: remote.entity.currentHp,
        maxResource: remote.entity.maxResource,
        currentResource: remote.entity.currentResource,
        alive: remote.entity.alive,
      });

      if (!wasAlive && remote.entity.alive) {
        emitWorldCombatEvent({
          entityId: remote.entity.id,
          reason: 'respawn',
          currentHp: remote.entity.currentHp,
          currentResource: remote.entity.currentResource,
          alive: true,
          atMs: toMatchGameTimeMs(performance.now()),
        });
      }
    },
    applyLocalNetworkCombat(input: {
      reason: 'damage' | 'heal';
      amount: number;
      sourceUserId: string;
      sourceEntityId?: string;
      respawnSeconds?: number;
    }) {
      const overlay = syncLocalHeroEntityState();
      if (!overlay || !Number.isFinite(input.amount) || input.amount <= 0) return null;
      const maxHp = Math.max(1, overlay.stats.maxHp);
      const beforeHp = THREE.MathUtils.clamp(localHeroEntity.currentHp, 0, maxHp);
      const currentHp = input.reason === 'heal'
        ? Math.min(maxHp, beforeHp + input.amount)
        : Math.max(0, beforeHp - input.amount);
      localHeroEntity.maxHp = maxHp;
      localHeroEntity.currentHp = currentHp;
      localHeroEntity.alive = currentHp > 0;
      localHeroEntity.root.userData.maxHp = maxHp;
      localHeroEntity.root.userData.currentHp = currentHp;
      publishWorldEntityRuntime(localWorldEntityId, {
        level: overlay.hero.level,
        maxHp,
        currentHp,
        maxResource: overlay.stats.maxResource,
        currentResource: localHeroEntity.currentResource,
        alive: currentHp > 0,
      });
      emitWorldCombatEvent({
        entityId: localWorldEntityId,
        reason: input.reason === 'heal' ? 'heal' : (currentHp > 0 ? 'damage' : 'death'),
        currentHp,
        currentResource: localHeroEntity.currentResource,
        alive: currentHp > 0,
        respawnSeconds: currentHp <= 0 && Number.isFinite(input.respawnSeconds)
          ? Math.max(0, Number(input.respawnSeconds))
          : undefined,
        amount: input.amount,
        sourceEntityId: input.sourceEntityId || `player:${input.sourceUserId}:hero`,
        damageType: 'physical',
        isDirect: true,
        isFromFront: true,
        atMs: toMatchGameTimeMs(performance.now()),
      });

      // Defensive abilities may have rewritten the incoming event through a combat guard.
      // Resolve from the shared world snapshot after all guards ran, not from the raw hit.
      const resolved = getWorldEntityRuntime(localWorldEntityId);
      if (!resolved) return null;
      localHeroEntity.currentHp = THREE.MathUtils.clamp(resolved.currentHp, 0, maxHp);
      localHeroEntity.currentResource = resolved.currentResource;
      localHeroEntity.alive = resolved.alive && localHeroEntity.currentHp > 0;
      localVitalOverride = {
        currentHp: localHeroEntity.currentHp,
        currentResource: localHeroEntity.currentResource,
        alive: localHeroEntity.alive,
      };
      return {
        currentHp: localHeroEntity.currentHp,
        currentResource: localHeroEntity.currentResource,
        alive: localHeroEntity.alive,
        position: {
          x: hero.root.position.x,
          y: hero.root.position.y,
          z: hero.root.position.z,
        },
        yaw: currentYaw,
      };
    },
    destroy() {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      minimapHost?.removeEventListener('contextmenu', onContextMenu);
      minimapHost?.removeEventListener('pointerdown', onMinimapPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      disconnectLaneProgression();
      aldenLineVfxPolish?.dispose();
      aldenAbilityEdgePolish?.dispose();
      aldenAbilityPresentation?.dispose();
      aldenAbilityRuntime?.dispose();
      selection.dispose();
      heroOverlay.dispose();
      disposeScene(scene);
      renderer.dispose();
      minimapRenderer?.dispose();
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
      if (minimapRenderer && minimapHost && minimapRenderer.domElement.parentElement === minimapHost) {
        minimapHost.removeChild(minimapRenderer.domElement);
      }
      if (minimapViewportSvg && minimapHost && minimapViewportSvg.parentElement === minimapHost) {
        minimapHost.removeChild(minimapViewportSvg);
      }
    },
  };
}

function addLighting(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xc7deed, 0x384632, 1.05));

  const sun = new THREE.DirectionalLight(0xffeed2, 3.0);
  sun.position.set(-8, 22, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.00012;
  sun.shadow.normalBias = 0.025;
  sun.shadow.camera.left = -24;
  sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  scene.add(sun, sun.target);

  const fill = new THREE.DirectionalLight(0x6f91ff, 0.72);
  fill.position.set(12, 7, -10);
  scene.add(fill);
  return sun;
}

const LOCAL_HERO_OVERHEAD_FRAME_Y = 30;
const LOCAL_HERO_OVERHEAD_CANVAS_HEIGHT = 116;

function addHeroOverlay(root: THREE.Group, scale = 1, playerName = 'Player') {
  const selection = new THREE.Mesh(
    new THREE.RingGeometry(0.62 * scale, 0.72 * scale, 64),
    new THREE.MeshBasicMaterial({
      color: 0x63f0c2,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
    }),
  );
  selection.rotation.x = -Math.PI / 2;
  selection.position.y = 0.025;
  root.add(selection);

  const canvas = document.createElement('canvas');
  canvas.width = 440;
  canvas.height = LOCAL_HERO_OVERHEAD_CANVAS_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const material = new THREE.SpriteMaterial({
    map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.name = 'hero-status-overlay';
  sprite.scale.set(4.8 * scale, 4.8 * canvas.height / canvas.width * scale, 1);
  sprite.position.set(0, 5.91 * scale, 0);
  sprite.renderOrder = 10;
  sprite.visible = false;
  root.add(sprite);

  let icon: HTMLImageElement | null = null;
  let iconPath: string | undefined;
  let lastValues: (string | number)[] = [];
  let dirty = true;

  return {
    update(state: HeroOverlayState | null) {
      sprite.visible = state !== null && state.hero.currentHp > 0;
      if (!state) return;
      const { hero, stats } = state;
      const nextIconPath = heroIcons[`./heroes/${hero.heroName?.toLowerCase()}/images/${hero.definitionId}I.webp`];
      if (nextIconPath !== iconPath) {
        if (icon) icon.onload = icon.onerror = null;
        iconPath = nextIconPath;
        icon = null;
        dirty = true;
        if (iconPath) {
          icon = new Image();
          icon.onload = icon.onerror = () => { dirty = true; };
          icon.src = iconPath;
        }
      }
      const values = [playerName, hero.heroName, hero.definitionId, hero.level,
        hero.currentHp, stats.maxHp, hero.currentResource, stats.maxResource];
      if (!dirty && values.every((value, index) => value === lastValues[index])) return;
      lastValues = values;
      dirty = false;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawLocalPlayerName(ctx, playerName);
      const frame = ctx.createLinearGradient(0, LOCAL_HERO_OVERHEAD_FRAME_Y, 0, LOCAL_HERO_OVERHEAD_FRAME_Y + 64);
      frame.addColorStop(0, '#fafafa');
      frame.addColorStop(1, '#9caaa7');
      ctx.fillStyle = frame;
      ctx.beginPath();
      ctx.moveTo(48, LOCAL_HERO_OVERHEAD_FRAME_Y);
      ctx.lineTo(436, LOCAL_HERO_OVERHEAD_FRAME_Y);
      ctx.lineTo(436, LOCAL_HERO_OVERHEAD_FRAME_Y + 60);
      ctx.lineTo(276, LOCAL_HERO_OVERHEAD_FRAME_Y + 60);
      ctx.lineTo(canvas.width / 2, LOCAL_HERO_OVERHEAD_FRAME_Y + 74);
      ctx.lineTo(164, LOCAL_HERO_OVERHEAD_FRAME_Y + 60);
      ctx.lineTo(48, LOCAL_HERO_OVERHEAD_FRAME_Y + 60);
      ctx.closePath();
      ctx.fill();

      buildHeroLabel(ctx, hero.currentHp, stats.maxHp);
      buildManaLabel(ctx, hero.currentResource, stats.maxResource);
      buildLevelLabel(ctx, hero.level);
      if (icon?.complete && icon.naturalWidth > 0) {
        const size = Math.min(80 / icon.naturalWidth, 80 / icon.naturalHeight);
        const width = icon.naturalWidth * size;
        const height = icon.naturalHeight * size;
        ctx.drawImage(icon, (80 - width) / 2, LOCAL_HERO_OVERHEAD_FRAME_Y + (80 - height) / 2, width, height);
      } else {
        ctx.font = 'bold 38px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(hero.heroName?.charAt(0) ?? '?', 38, LOCAL_HERO_OVERHEAD_FRAME_Y + 40);
      }
      texture.needsUpdate = true;
    },
    dispose() {
      if (icon) icon.onload = icon.onerror = null;
      icon = null;
    },
  };
}

function drawLocalPlayerName(ctx: CanvasRenderingContext2D, playerName: string) {
  const safeName = playerName.trim() || 'Player';
  ctx.save();
  ctx.font = '700 22px "Trebuchet MS", "Segoe UI", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(2, 5, 7, 0.96)';
  ctx.lineWidth = 5;
  ctx.strokeText(safeName, 229, 15, 300);
  ctx.fillStyle = '#f2ead5';
  ctx.fillText(safeName, 229, 15, 300);
  ctx.restore();
}

function buildLevelLabel(ctx: CanvasRenderingContext2D, level: number) {
  ctx.font = 'bold 38px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#080b09';
  ctx.fillText(String(level), 406, LOCAL_HERO_OVERHEAD_FRAME_Y + 32, 50);
}

function resourceFraction(current: number, maximum: number) {
  if (!Number.isFinite(current) || !Number.isFinite(maximum) || maximum <= 0) return 0;
  return THREE.MathUtils.clamp(current / maximum, 0, 1);
}

function buildManaLabel(ctx: CanvasRenderingContext2D, mana: number, maxMana: number) {
  ctx.fillStyle = '#050805';
  ctx.fillRect(78, LOCAL_HERO_OVERHEAD_FRAME_Y + 38, 302, 18);
  ctx.fillStyle = '#14213a';
  ctx.fillRect(82, LOCAL_HERO_OVERHEAD_FRAME_Y + 41, 294, 11);
  ctx.fillStyle = '#367eff';
  ctx.fillRect(82, LOCAL_HERO_OVERHEAD_FRAME_Y + 41, 294 * resourceFraction(mana, maxMana), 11);
}

function buildHeroLabel(ctx: CanvasRenderingContext2D, hp: number, maxHp: number) {
  ctx.fillStyle = '#050805';
  ctx.fillRect(78, LOCAL_HERO_OVERHEAD_FRAME_Y + 4, 302, 37);
  ctx.fillStyle = '#1c2916';
  ctx.fillRect(82, LOCAL_HERO_OVERHEAD_FRAME_Y + 8, 294, 29);
  const health = ctx.createLinearGradient(0, LOCAL_HERO_OVERHEAD_FRAME_Y + 8, 0, LOCAL_HERO_OVERHEAD_FRAME_Y + 37);
  health.addColorStop(0, '#83e844');
  health.addColorStop(1, '#46c526');
  ctx.fillStyle = health;
  ctx.fillRect(82, LOCAL_HERO_OVERHEAD_FRAME_Y + 8, 294 * resourceFraction(hp, maxHp), 29);
  ctx.fillStyle = 'rgba(5, 30, 4, 0.4)';
  for (let segment = 1; segment < 3; segment++) {
    ctx.fillRect(82 + 294 * segment / 3, LOCAL_HERO_OVERHEAD_FRAME_Y + 8, 2, 29);
  }
}

function buildTargetMarker(kind: CommandMarkerKind, color: number, innerColor: number) {
  const group = new THREE.Group();
  group.userData.kind = kind;
  group.userData.spawnTime = 0;

  const glowMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const accentMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const coreMaterial = new THREE.MeshBasicMaterial({
    color: innerColor,
    transparent: true,
    opacity: 0.96,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });

  group.userData.glowMaterial = glowMaterial;
  group.userData.accentMaterial = accentMaterial;

  const halo = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.53, 64), glowMaterial);
  halo.rotation.x = -Math.PI / 2;
  halo.renderOrder = 30;
  group.add(halo);

  for (let segment = 0; segment < 4; segment++) {
    const start = segment * Math.PI / 2 + 0.14;
    const arc = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.43, 28, 1, start, Math.PI / 2 - 0.28),
      accentMaterial,
    );
    arc.rotation.x = -Math.PI / 2;
    arc.position.y = 0.004;
    arc.renderOrder = 31;
    group.add(arc);
  }

  const innerRing = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.215, 40), coreMaterial);
  innerRing.rotation.x = -Math.PI / 2;
  innerRing.position.y = 0.007;
  innerRing.renderOrder = 32;
  group.add(innerRing);

  const coreGeometry = new THREE.CircleGeometry(kind === 'attack' ? 0.09 : 0.072, 4);
  coreGeometry.rotateZ(Math.PI / 4);
  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  core.rotation.x = -Math.PI / 2;
  core.position.y = 0.01;
  core.renderOrder = 33;
  group.add(core);

  if (kind === 'attack') {
    for (let spokeIndex = 0; spokeIndex < 4; spokeIndex++) {
      const spokeGeometry = new THREE.PlaneGeometry(0.035, 0.13);
      spokeGeometry.rotateZ(spokeIndex * Math.PI / 2);
      const spoke = new THREE.Mesh(spokeGeometry, coreMaterial);
      spoke.rotation.x = -Math.PI / 2;
      const angle = spokeIndex * Math.PI / 2;
      spoke.position.set(Math.sin(angle) * 0.27, 0.009, Math.cos(angle) * 0.27);
      spoke.renderOrder = 33;
      group.add(spoke);
    }
  }

  return group;
}

function disposeScene(scene: THREE.Scene) {
  const disposedTextures = new Set<THREE.Texture>();
  const disposedMaterials = new Set<THREE.Material>();
  const disposedGeometries = new Set<THREE.BufferGeometry>();

  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh || obj instanceof THREE.Sprite || obj instanceof THREE.Points)) return;
    if ((obj instanceof THREE.Mesh || obj instanceof THREE.Points) && !disposedGeometries.has(obj.geometry)) {
      disposedGeometries.add(obj.geometry);
      obj.geometry.dispose();
    }

    const material = obj.material;
    const disposeMaterial = (mat: THREE.Material) => {
      if (disposedMaterials.has(mat)) return;
      disposedMaterials.add(mat);
      for (const value of Object.values(mat)) {
        if (value instanceof THREE.Texture && !disposedTextures.has(value)) {
          disposedTextures.add(value);
          value.dispose();
        }
      }
      mat.dispose();
    };

    if (Array.isArray(material)) material.forEach(disposeMaterial);
    else disposeMaterial(material);
  });
}
