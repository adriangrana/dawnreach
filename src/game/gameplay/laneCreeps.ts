import * as THREE from 'three';
import type { GameEntity, GameEntityRegistry, TeamId } from '../entities/gameEntities';
import { calculateTowerAuraAdjustedDamage } from '../entities/towerAuras';
import {
  emitWorldCombatEvent,
  getWorldAttackEventsAfter,
  publishWorldAttackEvent,
  publishWorldEntityRuntime,
  removeWorldEntityRuntime,
} from '../entities/worldCombatBridge';
import { createMapCollisionWorld, type CollisionWorld } from '../map/collisionWorld';
import { DAWNREACH_LAYOUT, MAP_BOUNDS, type MapPoint } from '../map/mapLayout';
import {
  createNavigationWorld,
  type NavigationPoint,
  type NavigationWorld,
} from '../navigation/navigationWorld';
import { toMatchGameTimeMs } from '../match/matchPauseRuntime';
import {
  animateLaneCreepVisual,
  buildLaneCreepVisual,
  createLaneCreepVisualResources,
  triggerLaneCreepAttack,
  type LaneCreepVisual,
} from './laneCreepVisuals';

export type LaneName = 'top' | 'mid' | 'bot';
export type LaneCreepType = 'melee' | 'ranged' | 'flagbearer' | 'siege';
export type LaneCreepState = 'ATTACK_MOVE' | 'COMBAT' | 'AGGRO' | 'RETURNING';

type CombatTeam = Extract<TeamId, 'blue' | 'red'>;

export type LaneCreepNetworkUnit = Readonly<{
  id: string;
  team: CombatTeam;
  lane: LaneName;
  type: LaneCreepType;
  position: Readonly<{ x: number; y: number; z: number }>;
  yaw: number;
  currentHp: number;
  maxHp: number;
  alive: boolean;
  state: LaneCreepState;
  moving: boolean;
  seed: number;
  attackSequence: number;
}>;

export type LaneCreepNetworkSnapshot = Readonly<{
  sequence: number;
  sentAt: number;
  creeps: readonly LaneCreepNetworkUnit[];
}>;

type CreepStats = Readonly<{
  maxHp: number;
  damage: number;
  attackRange: number;
  attackInterval: number;
  moveSpeed: number;
  selectionRadius: number;
  collisionRadius: number;
}>;

type AttackActivity = Readonly<{
  targetId: string;
  atSeconds: number;
}>;

type LaneCreepRuntime = {
  entity: GameEntity;
  visual: LaneCreepVisual;
  type: LaneCreepType;
  lane: LaneName;
  team: CombatTeam;
  route: readonly MapPoint[];
  routeIndex: number;
  state: LaneCreepState;
  target: GameEntity | null;
  targetAcquiredAt: number;
  stats: CreepStats;
  nextAttackAt: number;
  nextScanAt: number;
  aggroLockUntil: number;
  returnNodeIndex: number;
  reachedEndAt: number | null;
  spawnedAt: number;
  seed: number;
  spatialX: number;
  spatialZ: number;
  heightCellKey: number;
  targetY: number;
  moving: boolean;
  navWaypoints: NavigationPoint[];
  navIndex: number;
  navTargetX: number;
  navTargetZ: number;
  navPartial: boolean;
  blockedForSeconds: number;
  nextRepathAt: number;
  avoidanceSide: -1 | 1;
  attackSequence: number;
};

type LaneTeamBucket = Record<CombatTeam, Set<LaneCreepRuntime>>;

const GAME_UNIT_TO_WORLD = 0.01;
const WORLD_UNITS = (gameUnits: number) => gameUnits * GAME_UNIT_TO_WORLD;
const ACQUISITION_RANGE_SQ = WORLD_UNITS(500) ** 2;
const LEASH_DISTANCE_SQ = WORLD_UNITS(400) ** 2;
const HERO_COLLISION_RADIUS = 0.48;
const UNIT_SEPARATION_PADDING = 0.045;
const CREEP_NAV_REPATH_STUCK_SECONDS = 0.28;
const CREEP_NAV_REPATH_INTERVAL_SECONDS = 0.55;
const CREEP_NAV_TARGET_DRIFT_SQ = 0.8 ** 2;
const CREEP_NAV_WAYPOINT_ARRIVAL_SQ = 0.24 ** 2;
const CREEP_NAV_MAX_EXPANDED_NODES = 1100;
const CREEP_MOVE_PROGRESS_EPSILON = 0.0025;
const CREEP_AVOIDANCE_ANGLES = [0.42, 0.78, 1.08] as const;
const SPATIAL_CELL_SIZE = 1.25;
const SPATIAL_STRIDE = 4096;
const SPATIAL_OFFSET = 1024;
const HEIGHT_CACHE_STEP = 0.18;
const HEIGHT_STRIDE = 8192;
const HEIGHT_OFFSET = 2048;
const HEIGHT_DAMPING = 30;
const LANE_CREEP_MOVE_SPEED = 3;
const RANGED_FORMATION_TRAILING_OFFSET = 3.75;
const SIEGE_FORMATION_TRAILING_OFFSET = 4.8;
// Spawn the wave across the actual three citadel ramps, not on the inner plaza rings.
// The ramp begins at about radius 19.68. Anchoring the frontline at 24.48 means the
// furthest trailing unit (siege, -4.8) still appears at the inner edge of the ramp,
// while ranged creeps appear at 20.73 and melee/frontline units at 24.48.
const LANE_CREEP_SPAWN_ANCHOR_DISTANCE = 24.48;
const TEMP_A = new THREE.Vector3();
const TEMP_B = new THREE.Vector3();
const SURFACE_RAY = new THREE.Raycaster();
SURFACE_RAY.ray.direction.set(0, -1, 0);

export const LANE_CREEP_TUNING = {
  waveIntervalSeconds: 30,
  flagbearerStartSeconds: 120,
  flagbearerEveryWaves: 2,
  siegeStartSeconds: 300,
  siegeEveryWaves: 10,
  acquisitionRange: WORLD_UNITS(500),
  leashDistance: WORLD_UNITS(400),
  aggroLockSeconds: 2.3,
  outOfLaneAttackGraceSeconds: 3,
  activeAttackWindowSeconds: 1.6,
  scanIntervalSeconds: 0.2,
  laneReturnThreshold: 0.55,
  laneNodeArrivalDistance: 0.32,
  endOfLaneCleanupSeconds: 4,
  maximumLifetimeSeconds: 120,
  visionLeaderRebalanceSeconds: 0.45,
  candidateRefreshSeconds: 1,
  moveSpeed: LANE_CREEP_MOVE_SPEED,
} as const;

const CREEP_STATS: Record<LaneCreepType, CreepStats> = {
  melee: {
    maxHp: 550,
    damage: 24,
    attackRange: 1.2,
    attackInterval: 1,
    moveSpeed: LANE_CREEP_MOVE_SPEED,
    selectionRadius: 0.56,
    collisionRadius: 0.34,
  },
  flagbearer: {
    maxHp: 550,
    damage: 24,
    attackRange: 1.2,
    attackInterval: 1,
    moveSpeed: LANE_CREEP_MOVE_SPEED,
    selectionRadius: 0.58,
    collisionRadius: 0.35,
  },
  ranged: {
    maxHp: 360,
    damage: 28,
    attackRange: 4.35,
    attackInterval: 1.2,
    moveSpeed: LANE_CREEP_MOVE_SPEED,
    selectionRadius: 0.54,
    collisionRadius: 0.32,
  },
  siege: {
    maxHp: 900,
    damage: 58,
    attackRange: 5,
    attackInterval: 2,
    moveSpeed: LANE_CREEP_MOVE_SPEED,
    selectionRadius: 0.82,
    collisionRadius: 0.48,
  },
};

const LANES: readonly LaneName[] = ['top', 'mid', 'bot'];
const TEAMS: readonly CombatTeam[] = ['blue', 'red'];
const managerByScene = new WeakMap<THREE.Scene, LaneCreepManager>();

export function getLaneWaveComposition(waveIndex: number): LaneCreepType[] {
  const safeWaveIndex = Math.max(0, Math.floor(waveIndex));
  const waveSeconds = safeWaveIndex * LANE_CREEP_TUNING.waveIntervalSeconds;
  const composition: LaneCreepType[] = ['melee', 'melee', 'melee', 'ranged'];

  if (
    waveSeconds >= LANE_CREEP_TUNING.flagbearerStartSeconds
    && safeWaveIndex % LANE_CREEP_TUNING.flagbearerEveryWaves === 0
  ) {
    composition[0] = 'flagbearer';
  }

  if (
    waveSeconds >= LANE_CREEP_TUNING.siegeStartSeconds
    && safeWaveIndex % LANE_CREEP_TUNING.siegeEveryWaves === 0
  ) {
    composition.push('siege');
  }

  return composition;
}

export function ensureLaneCreepSystem(scene: THREE.Scene, registry: GameEntityRegistry) {
  const existing = managerByScene.get(scene);
  if (existing) return existing;

  const manager = new LaneCreepManager(scene, registry);
  managerByScene.set(scene, manager);
  manager.start();
  return manager;
}

class LaneCreepManager {
  private readonly creeps: LaneCreepRuntime[] = [];
  private readonly creepById = new Map<string, LaneCreepRuntime>();
  private readonly attackActivity = new Map<string, AttackActivity>();
  private readonly commandSurfaces: THREE.Mesh[] = [];
  private readonly visualResources = createLaneCreepVisualResources();
  private readonly collisionWorld: CollisionWorld;
  private readonly creepNavigation: NavigationWorld;
  private readonly siegeNavigation: NavigationWorld;
  private readonly spatialCells = new Map<number, Set<LaneCreepRuntime>>();
  private readonly heightCache = new Map<number, number>();
  private readonly buckets: Record<LaneName, LaneTeamBucket> = {
    top: { blue: new Set(), red: new Set() },
    mid: { blue: new Set(), red: new Set() },
    bot: { blue: new Set(), red: new Set() },
  };
  private readonly staticCandidates: GameEntity[] = [];
  private readonly staticById = new Map<string, GameEntity>();
  private readonly gameCanvas: HTMLCanvasElement | null;
  private readonly networkMode: 'authority' | 'replica';
  private readonly replicaTargets = new Map<string, {
    position: THREE.Vector3;
    yaw: number;
    moving: boolean;
  }>();
  private readonly startedAtMs = toMatchGameTimeMs(performance.now());
  private lastFrameMs = this.startedAtMs;
  private nextWaveIndex = 0;
  private lastAttackSequence = 0;
  private animationFrame = 0;
  private disposed = false;
  private serial = 0;
  private nextVisionRebalanceAt = 0;
  private nextCandidateRefreshAt = 0;
  private networkSequence = 0;
  private lastReplicaSequence = -1;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly registry: GameEntityRegistry,
  ) {
    this.networkMode = scene.userData.laneCreepNetworkMode === 'replica' ? 'replica' : 'authority';
    const battlefield = scene.getObjectByName('dawnreach-map');
    if (!battlefield) throw new Error('Lane creep system requires dawnreach-map');

    scene.traverse((object) => {
      if (object instanceof THREE.Mesh && object.userData.commandSurface) this.commandSurfaces.push(object);
    });

    // The hero bootstrap already created collision data and opened the authored camp
    // entrances. Mark those entrances before creating the creep-side static solver so
    // this second collision world stays idempotent and never removes extra scenery.
    battlefield.traverse((object) => {
      if (object instanceof THREE.Group && object.name.startsWith('jungle-camp-')) {
        object.userData.authoredEntrance = true;
      }
    });
    this.collisionWorld = createMapCollisionWorld(battlefield);
    this.creepNavigation = createNavigationWorld({
      bounds: MAP_BOUNDS,
      collisionWorld: this.collisionWorld,
      agentRadius: 0.36,
      cellSize: 0.45,
      clearance: 0.02,
      nearestSearchRadius: 4.5,
    });
    this.siegeNavigation = createNavigationWorld({
      bounds: MAP_BOUNDS,
      collisionWorld: this.collisionWorld,
      agentRadius: CREEP_STATS.siege.collisionRadius,
      cellSize: 0.48,
      clearance: 0.025,
      nearestSearchRadius: 5,
    });

    this.refreshStaticCandidates();
    const canvases = document.querySelectorAll<HTMLCanvasElement>('.game-canvas');
    this.gameCanvas = canvases.length > 0 ? canvases[canvases.length - 1] : null;
  }

  start() {
    if (this.networkMode === 'authority') {
      this.spawnWave(0, 0);
      this.nextWaveIndex = 1;
      this.rebalanceVisionLeaders();
    }
    this.animationFrame = requestAnimationFrame(this.frame);
  }

  isNetworkAuthority() {
    return this.networkMode === 'authority';
  }

  getNetworkSnapshot(): LaneCreepNetworkSnapshot | null {
    if (this.networkMode !== 'authority' || this.disposed) return null;
    this.networkSequence += 1;
    return {
      sequence: this.networkSequence,
      sentAt: Date.now(),
      creeps: this.creeps.map(creep => ({
        id: creep.entity.id,
        team: creep.team,
        lane: creep.lane,
        type: creep.type,
        position: {
          x: creep.entity.root.position.x,
          y: creep.entity.root.position.y,
          z: creep.entity.root.position.z,
        },
        yaw: creep.entity.root.rotation.y,
        currentHp: creep.entity.currentHp,
        maxHp: creep.entity.maxHp,
        alive: creep.entity.alive,
        state: creep.state,
        moving: creep.moving,
        seed: creep.seed,
        attackSequence: creep.attackSequence,
      })),
    };
  }

  applyNetworkSnapshot(snapshot: LaneCreepNetworkSnapshot) {
    if (this.networkMode !== 'replica' || this.disposed) return;
    if (!Number.isFinite(snapshot.sequence) || snapshot.sequence <= this.lastReplicaSequence) return;
    this.lastReplicaSequence = snapshot.sequence;

    const present = new Set<string>();
    for (const unit of snapshot.creeps) {
      if (!unit?.id || (unit.team !== 'blue' && unit.team !== 'red')) continue;
      if (!LANES.includes(unit.lane) || !Object.prototype.hasOwnProperty.call(CREEP_STATS, unit.type)) continue;
      present.add(unit.id);

      let creep = this.creepById.get(unit.id);
      if (!creep) creep = this.spawnReplicaCreep(unit);

      creep.entity.maxHp = Math.max(1, Number(unit.maxHp) || creep.stats.maxHp);
      creep.entity.currentHp = THREE.MathUtils.clamp(Number(unit.currentHp) || 0, 0, creep.entity.maxHp);
      creep.entity.alive = unit.alive !== false && creep.entity.currentHp > 0;
      creep.state = unit.state;
      creep.moving = Boolean(unit.moving);
      const nextAttackSequence = Math.max(0, Math.floor(Number(unit.attackSequence) || 0));
      if (nextAttackSequence > creep.attackSequence) {
        creep.attackSequence = nextAttackSequence;
        triggerLaneCreepAttack(creep.visual, toMatchGameTimeMs(performance.now()) / 1000);
      }
      creep.entity.root.userData.currentHp = creep.entity.currentHp;
      creep.entity.root.userData.maxHp = creep.entity.maxHp;
      creep.entity.root.userData.alive = creep.entity.alive;
      creep.entity.root.userData.laneCreepState = creep.state;
      creep.entity.root.visible = creep.entity.alive;
      publishWorldEntityRuntime(creep.entity.id, runtimeSnapshot(creep.entity));

      const target = this.replicaTargets.get(unit.id);
      if (target) {
        target.position.set(unit.position.x, unit.position.y, unit.position.z);
        target.yaw = unit.yaw;
        target.moving = Boolean(unit.moving);
      }
    }

    for (let index = this.creeps.length - 1; index >= 0; index--) {
      if (!present.has(this.creeps[index].entity.id)) this.cleanupCreep(index);
    }
    this.rebalanceVisionLeaders();
  }

  applyRemoteDamage(creepId: string, amount: number, sourceEntityId: string, atMs = toMatchGameTimeMs(performance.now())) {
    if (this.networkMode !== 'authority' || this.disposed) return false;
    const creep = this.creepById.get(creepId);
    if (!creep || !creep.entity.alive || creep.entity.currentHp <= 0) return false;
    const damage = Math.max(0, Number(amount) || 0);
    if (damage <= 0) return false;

    const attacker = this.registry.values().find(entity => entity.id === sourceEntityId) ?? null;
    if (attacker) {
      const attackerPosition = attacker.root.getWorldPosition(new THREE.Vector3());
      const targetPosition = creep.entity.root.getWorldPosition(new THREE.Vector3());
      publishWorldAttackEvent({
        attackerId: attacker.id,
        targetId: creep.entity.id,
        attackerTeam: attacker.team,
        targetTeam: creep.entity.team,
        attackerKind: attacker.kind,
        targetKind: creep.entity.kind,
        attackerPosition: { x: attackerPosition.x, z: attackerPosition.z },
        targetPosition: { x: targetPosition.x, z: targetPosition.z },
        atMs,
      });
    }

    const before = creep.entity.currentHp;
    creep.entity.currentHp = Math.max(0, before - damage);
    creep.entity.alive = creep.entity.currentHp > 0;
    creep.entity.root.userData.currentHp = creep.entity.currentHp;
    creep.entity.root.userData.alive = creep.entity.alive;
    creep.entity.root.visible = creep.entity.alive;
    publishWorldEntityRuntime(creep.entity.id, runtimeSnapshot(creep.entity));
    emitWorldCombatEvent({
      entityId: creep.entity.id,
      reason: creep.entity.alive ? 'damage' : 'death',
      currentHp: creep.entity.currentHp,
      currentResource: creep.entity.currentResource,
      alive: creep.entity.alive,
      amount: Math.max(0, before - creep.entity.currentHp),
      sourceEntityId,
      damageType: 'physical',
      isDirect: true,
      isFromFront: true,
      atMs,
    });
    return true;
  }

  private frame = (nowMs: number) => {
    if (this.disposed) return;
    if (this.gameCanvas && !this.gameCanvas.isConnected) {
      this.dispose();
      return;
    }

    const gameNowMs = toMatchGameTimeMs(nowMs);
    const dt = Math.min(0.05, Math.max(0, (gameNowMs - this.lastFrameMs) / 1000));
    this.lastFrameMs = gameNowMs;
    const elapsed = Math.max(0, (gameNowMs - this.startedAtMs) / 1000);

    if (this.networkMode === 'replica') {
      this.updateReplicaCreeps(gameNowMs / 1000, dt);
      this.animationFrame = requestAnimationFrame(this.frame);
      return;
    }

    this.spawnDueWaves(elapsed);
    this.consumeAttackEvents(elapsed);

    if (elapsed >= this.nextCandidateRefreshAt) {
      this.nextCandidateRefreshAt = elapsed + LANE_CREEP_TUNING.candidateRefreshSeconds;
      this.refreshStaticCandidates();
      this.pruneAttackActivity(elapsed);
    }

    if (elapsed >= this.nextVisionRebalanceAt) {
      this.nextVisionRebalanceAt = elapsed + LANE_CREEP_TUNING.visionLeaderRebalanceSeconds;
      this.rebalanceVisionLeaders();
    }

    for (let index = this.creeps.length - 1; index >= 0; index--) {
      if (!this.updateCreep(this.creeps[index], elapsed, dt)) this.cleanupCreep(index);
    }

    this.animationFrame = requestAnimationFrame(this.frame);
  };

  private spawnReplicaCreep(unit: LaneCreepNetworkUnit) {
    const stats = CREEP_STATS[unit.type];
    const route = unit.team === 'blue'
      ? DAWNREACH_LAYOUT.lanes[unit.lane]
      : [...DAWNREACH_LAYOUT.lanes[unit.lane]].reverse();
    const visual = buildLaneCreepVisual(this.visualResources, unit.team, unit.type, unit.seed);
    const { root } = visual;
    root.name = unit.id;
    root.position.set(unit.position.x, unit.position.y, unit.position.z);
    root.rotation.y = unit.yaw;
    root.userData.collisionRadius = stats.collisionRadius;
    root.userData.networkReplica = true;
    this.scene.add(root);

    const entity = this.registry.register(root, {
      id: unit.id,
      displayName: creepDisplayName(unit.team, unit.type),
      kind: 'creep',
      team: unit.team,
      selectable: true,
      targetable: true,
      grantsVision: false,
      visionRadius: 8,
      visionHeight: unit.type === 'siege' ? 1.45 : 1.15,
      attackRange: stats.attackRange,
      visibilityPolicy: 'vision-only',
      interaction: 'unit',
      selectionRadius: stats.selectionRadius,
      maxHp: Math.max(1, unit.maxHp),
      currentHp: Math.max(0, unit.currentHp),
      showHealthBar: true,
      definitionId: `lane-creep-${unit.type}`,
      level: 1,
      alive: unit.alive,
    });
    entity.root.userData.lane = unit.lane;
    entity.root.userData.laneCreepType = unit.type;
    entity.root.userData.laneCreepState = unit.state;

    const spatial = spatialCoords(root.position.x, root.position.z);
    const routeIndex = Math.min(route.length - 1, nearestNodeIndex(root.position.x, root.position.z, route) + 1);
    const runtime: LaneCreepRuntime = {
      entity,
      visual,
      type: unit.type,
      lane: unit.lane,
      team: unit.team,
      route,
      routeIndex,
      state: unit.state,
      target: null,
      targetAcquiredAt: 0,
      stats,
      nextAttackAt: Number.POSITIVE_INFINITY,
      nextScanAt: Number.POSITIVE_INFINITY,
      aggroLockUntil: 0,
      returnNodeIndex: 0,
      reachedEndAt: null,
      spawnedAt: 0,
      seed: unit.seed,
      spatialX: spatial.x,
      spatialZ: spatial.z,
      heightCellKey: heightKey(root.position.x, root.position.z),
      targetY: root.position.y,
      moving: Boolean(unit.moving),
      navWaypoints: [],
      navIndex: 0,
      navTargetX: unit.position.x,
      navTargetZ: unit.position.z,
      navPartial: false,
      blockedForSeconds: 0,
      nextRepathAt: 0,
      avoidanceSide: unit.seed % 2 === 0 ? 1 : -1,
      attackSequence: Math.max(0, Math.floor(Number(unit.attackSequence) || 0)),
    };
    this.creeps.push(runtime);
    this.creepById.set(entity.id, runtime);
    this.buckets[unit.lane][unit.team].add(runtime);
    this.addToSpatialCell(runtime);
    this.replicaTargets.set(entity.id, {
      position: new THREE.Vector3(unit.position.x, unit.position.y, unit.position.z),
      yaw: unit.yaw,
      moving: Boolean(unit.moving),
    });
    return runtime;
  }

  private updateReplicaCreeps(nowSeconds: number, dt: number) {
    const blend = 1 - Math.exp(-18 * dt);
    for (const creep of this.creeps) {
      const target = this.replicaTargets.get(creep.entity.id);
      if (!target) continue;
      const root = creep.entity.root;
      const distance = root.position.distanceTo(target.position);
      root.position.lerp(target.position, blend);
      const yawDelta = Math.atan2(
        Math.sin(target.yaw - root.rotation.y),
        Math.cos(target.yaw - root.rotation.y),
      );
      root.rotation.y += yawDelta * Math.min(1, dt * 18);
      this.updateSpatialCell(creep);
      this.animateCreep(creep, nowSeconds, target.moving || distance > 0.015);
    }
  }

  private spawnDueWaves(elapsed: number) {
    while (this.nextWaveIndex * LANE_CREEP_TUNING.waveIntervalSeconds <= elapsed + 1e-6) {
      this.spawnWave(this.nextWaveIndex, elapsed);
      this.nextWaveIndex += 1;
    }
  }

  private spawnWave(waveIndex: number, now: number) {
    const composition = getLaneWaveComposition(waveIndex);
    for (const lane of LANES) {
      for (const team of TEAMS) {
        composition.forEach((type, formationIndex) => {
          this.spawnCreep(team, lane, type, waveIndex, formationIndex, composition.length, now);
        });
      }
    }
  }

  private spawnCreep(
    team: CombatTeam,
    lane: LaneName,
    type: LaneCreepType,
    waveIndex: number,
    formationIndex: number,
    formationSize: number,
    now: number,
  ) {
    const authoredLane = DAWNREACH_LAYOUT.lanes[lane];
    const route = team === 'blue' ? authoredLane : [...authoredLane].reverse();
    const start = route[0];
    const next = route[1] ?? route[0];
    const dx = next[0] - start[0];
    const dz = next[1] - start[1];
    const length = Math.max(1e-6, Math.hypot(dx, dz));
    const dirX = dx / length;
    const dirZ = dz / length;
    const sideX = -dirZ;
    const sideZ = dirX;
    const lateralSlot = formationIndex < 3
      ? (formationIndex - 1) * 0.78
      : formationIndex === 3
        ? 0
        : (formationIndex - (formationSize - 1) / 2) * 0.66;
    // The ranged creep has over three world units more attack reach than the melee row.
    // Giving the rear line a matching lane offset prevents it from entering attack range
    // before the three frontline creeps reach the same objective.
    const trailingOffset = formationIndex < 3
      ? 0
      : formationIndex === 3
        ? RANGED_FORMATION_TRAILING_OFFSET
        : SIEGE_FORMATION_TRAILING_OFFSET;
    const stats = CREEP_STATS[type];

    // Spawn on the actual three base ramps. `route` remains throne-to-throne, so only the
    // physical wave origin changes and the final waypoint is still the enemy throne.
    const spawnOriginX = start[0] + dirX * LANE_CREEP_SPAWN_ANCHOR_DISTANCE;
    const spawnOriginZ = start[1] + dirZ * LANE_CREEP_SPAWN_ANCHOR_DISTANCE;
    const rawSpawnX = spawnOriginX + sideX * lateralSlot - dirX * trailingOffset;
    const rawSpawnZ = spawnOriginZ + sideZ * lateralSlot - dirZ * trailingOffset;
    const spawn = this.findFreeSpawnPoint(rawSpawnX, rawSpawnZ, dirX, dirZ, stats.collisionRadius);

    const seed = this.serial;
    const visual = buildLaneCreepVisual(this.visualResources, team, type, seed);
    const { root } = visual;
    root.name = `${team}-${lane}-${type}-wave-${waveIndex}-${this.serial}`;
    const initialSurface = this.surfaceHeightAt(spawn.x, spawn.z) + 0.03;
    root.position.set(spawn.x, initialSurface, spawn.z);
    root.rotation.y = Math.atan2(dirX, dirZ);
    root.userData.collisionRadius = stats.collisionRadius;
    this.scene.add(root);

    const id = `lane-creep:${team}:${lane}:${waveIndex}:${this.serial++}`;
    const entity = this.registry.register(root, {
      id,
      displayName: creepDisplayName(team, type),
      kind: 'creep',
      team,
      selectable: true,
      targetable: true,
      grantsVision: false,
      visionRadius: 8,
      visionHeight: type === 'siege' ? 1.45 : 1.15,
      attackRange: stats.attackRange,
      visibilityPolicy: 'vision-only',
      interaction: 'unit',
      selectionRadius: stats.selectionRadius,
      maxHp: stats.maxHp,
      currentHp: stats.maxHp,
      showHealthBar: true,
      definitionId: `lane-creep-${type}`,
      level: 1,
      alive: true,
    });

    entity.root.userData.lane = lane;
    entity.root.userData.laneCreepType = type;
    entity.root.userData.laneCreepState = 'ATTACK_MOVE' satisfies LaneCreepState;
    publishWorldEntityRuntime(entity.id, runtimeSnapshot(entity));

    const spatial = spatialCoords(root.position.x, root.position.z);
    const runtime: LaneCreepRuntime = {
      entity,
      visual,
      type,
      lane,
      team,
      route,
      routeIndex: 1,
      state: 'ATTACK_MOVE',
      target: null,
      targetAcquiredAt: 0,
      stats,
      nextAttackAt: now,
      nextScanAt: now + (this.serial % 10) * (LANE_CREEP_TUNING.scanIntervalSeconds / 10),
      aggroLockUntil: 0,
      returnNodeIndex: 0,
      reachedEndAt: null,
      spawnedAt: now,
      seed,
      spatialX: spatial.x,
      spatialZ: spatial.z,
      heightCellKey: heightKey(root.position.x, root.position.z),
      targetY: initialSurface,
      moving: false,
      navWaypoints: [],
      navIndex: 0,
      navTargetX: spawn.x,
      navTargetZ: spawn.z,
      navPartial: false,
      blockedForSeconds: 0,
      nextRepathAt: 0,
      avoidanceSide: seed % 2 === 0 ? 1 : -1,
      attackSequence: 0,
    };

    this.creeps.push(runtime);
    this.creepById.set(entity.id, runtime);
    this.buckets[lane][team].add(runtime);
    this.addToSpatialCell(runtime);
  }

  private findFreeSpawnPoint(
    x: number,
    z: number,
    dirX: number,
    dirZ: number,
    radius: number,
  ) {
    const step = 0.28;
    for (let index = 0; index <= 36; index++) {
      const candidate = { x: x + dirX * step * index, z: z + dirZ * step * index };
      if (this.collisionWorld.isBlocked(candidate, radius)) continue;
      if (this.hasDynamicOverlapAt(null, candidate.x, candidate.z, radius)) continue;
      return candidate;
    }

    const fallback = { x: x + dirX * 6, z: z + dirZ * 6 };
    return this.collisionWorld.move({ x, z }, fallback, radius);
  }

  private refreshStaticCandidates() {
    this.staticCandidates.length = 0;
    this.staticById.clear();
    for (const entity of this.registry.values()) {
      if (entity.kind === 'creep') continue;
      this.staticCandidates.push(entity);
      this.staticById.set(entity.id, entity);
    }
  }

  private consumeAttackEvents(nowSeconds: number) {
    const events = getWorldAttackEventsAfter(this.lastAttackSequence);
    if (events.length === 0) return;

    for (const event of events) {
      this.lastAttackSequence = Math.max(this.lastAttackSequence, event.sequence);
      const eventSeconds = Math.max(0, (event.atMs - this.startedAtMs) / 1000);
      this.attackActivity.set(event.attackerId, { targetId: event.targetId, atSeconds: eventSeconds });

      if (event.attackerKind !== 'hero' || event.targetKind !== 'hero') continue;
      if (event.attackerTeam === event.targetTeam || event.targetTeam === 'neutral') continue;
      const attacker = this.findEntityById(event.attackerId);
      if (!attacker || !attacker.alive) continue;

      for (const lane of LANES) {
        const bucket = this.buckets[lane][event.targetTeam as CombatTeam];
        for (const creep of bucket) {
          if (!creep.entity.alive || creep.state === 'RETURNING' || nowSeconds < creep.aggroLockUntil) continue;
          const cx = creep.entity.root.position.x - event.attackerPosition.x;
          const cz = creep.entity.root.position.z - event.attackerPosition.z;
          if (cx * cx + cz * cz > ACQUISITION_RANGE_SQ) continue;
          if (!this.isVisibleToCreep(creep, attacker)) continue;

          creep.target = attacker;
          creep.targetAcquiredAt = nowSeconds;
          creep.state = 'AGGRO';
          creep.aggroLockUntil = nowSeconds + LANE_CREEP_TUNING.aggroLockSeconds;
          creep.nextScanAt = creep.aggroLockUntil;
          this.writeState(creep);
        }
      }
    }
  }

  private updateCreep(creep: LaneCreepRuntime, now: number, dt: number) {
    const { entity } = creep;

    if (!entity.alive || entity.currentHp <= 0) {
      entity.alive = false;
      entity.currentHp = 0;
      entity.root.visible = false;
      entity.root.userData.currentHp = 0;
      return false;
    }

    if (now - creep.spawnedAt >= LANE_CREEP_TUNING.maximumLifetimeSeconds) return false;

    if (creep.state === 'AGGRO' && now >= creep.aggroLockUntil) this.clearTarget(creep);

    if (creep.state === 'RETURNING') {
      const moving = this.updateReturning(creep, dt, now);
      this.updateSurfaceHeight(creep, dt, moving);
      this.animateCreep(creep, now, moving);
      return true;
    }

    if (creep.target && !this.isTargetValid(creep, creep.target)) this.clearTarget(creep);

    if (creep.target) {
      const laneDistanceSq = distanceToPolylineSquared(
        entity.root.position.x,
        entity.root.position.z,
        creep.route,
      );
      if (laneDistanceSq > LEASH_DISTANCE_SQ) {
        this.beginReturning(creep);
        this.updateSurfaceHeight(creep, dt, false);
        this.animateCreep(creep, now, false);
        return true;
      }

      if (laneDistanceSq > LANE_CREEP_TUNING.laneReturnThreshold ** 2) {
        const lastAttackAt = this.attackActivity.get(creep.target.id)?.atSeconds ?? creep.targetAcquiredAt;
        if (now - Math.max(creep.targetAcquiredAt, lastAttackAt) > LANE_CREEP_TUNING.outOfLaneAttackGraceSeconds) {
          this.beginReturning(creep);
          this.updateSurfaceHeight(creep, dt, false);
          this.animateCreep(creep, now, false);
          return true;
        }
      }
    }

    if (creep.state !== 'AGGRO' && now >= creep.nextScanAt) {
      creep.nextScanAt = now + LANE_CREEP_TUNING.scanIntervalSeconds;
      const previousTarget = creep.target;
      const nextTarget = this.choosePriorityTarget(creep, now);
      creep.target = nextTarget;
      if (nextTarget !== previousTarget) {
        this.clearNavigation(creep);
        creep.blockedForSeconds = 0;
        creep.targetAcquiredAt = nextTarget ? now : 0;
      } else if (!nextTarget) {
        creep.targetAcquiredAt = 0;
      }
      creep.state = nextTarget ? 'COMBAT' : 'ATTACK_MOVE';
      this.writeState(creep);
    }

    let moving = false;
    if (creep.target) {
      const targetPosition = this.getEntityPosition(creep.target, TEMP_A);
      const dx = targetPosition.x - entity.root.position.x;
      const dz = targetPosition.z - entity.root.position.z;
      const distanceSq = dx * dx + dz * dz;
      const reach = this.combatReach(creep, creep.target);
      if (distanceSq <= reach * reach) {
        this.faceVector(creep, dx, dz);
        if (now >= creep.nextAttackAt) this.attackTarget(creep, creep.target, now);
      } else {
        moving = this.moveToward(creep, targetPosition.x, targetPosition.z, dt, true, now);
      }
      creep.reachedEndAt = null;
    } else {
      moving = this.followLane(creep, dt, now);
    }

    this.updateSurfaceHeight(creep, dt, moving);
    this.animateCreep(creep, now, moving);
    return creep.reachedEndAt === null
      || now - creep.reachedEndAt < LANE_CREEP_TUNING.endOfLaneCleanupSeconds;
  }

  private choosePriorityTarget(creep: LaneCreepRuntime, now: number): GameEntity | null {
    const originX = creep.entity.root.position.x;
    const originZ = creep.entity.root.position.z;
    let best: GameEntity | null = null;
    let bestPriority = Number.POSITIVE_INFINITY;
    let bestDistanceSq = Number.POSITIVE_INFINITY;
    let bestHpFraction = Number.POSITIVE_INFINITY;

    // Keep an already valid target unless something with a genuinely higher combat priority
    // appears. Re-picking the "best" creep every 200 ms made entire waves oscillate between
    // wounded targets and repeatedly try to walk through their own frontline.
    if (creep.target && this.isTargetValid(creep, creep.target)) {
      const currentPosition = this.getEntityPosition(creep.target, TEMP_B);
      const currentDx = currentPosition.x - originX;
      const currentDz = currentPosition.z - originZ;
      const currentDistanceSq = currentDx * currentDx + currentDz * currentDz;
      if (currentDistanceSq <= ACQUISITION_RANGE_SQ * 1.25) {
        const currentPriority = this.targetPriority(creep, creep.target, currentDistanceSq, now);
        if (currentPriority !== null) {
          best = creep.target;
          bestPriority = currentPriority;
          bestDistanceSq = currentDistanceSq;
          bestHpFraction = creep.target.maxHp > 0
            ? THREE.MathUtils.clamp(creep.target.currentHp / creep.target.maxHp, 0, 1)
            : 1;
        }
      }
    }

    const consider = (candidate: GameEntity) => {
      if (!this.isHostileCombatTarget(creep, candidate) || !this.isVisibleToCreep(creep, candidate)) return;
      const position = this.getEntityPosition(candidate, TEMP_B);
      const dx = position.x - originX;
      const dz = position.z - originZ;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq > ACQUISITION_RANGE_SQ) return;

      const priority = this.targetPriority(creep, candidate, distanceSq, now);
      if (priority === null) return;
      const hpFraction = candidate.maxHp > 0
        ? THREE.MathUtils.clamp(candidate.currentHp / candidate.maxHp, 0, 1)
        : 1;

      const currentTargetPinned = best === creep.target && priority === bestPriority;
      const significantlyCloserThanPinnedTarget = currentTargetPinned
        && distanceSq + 0.64 < bestDistanceSq;
      if (
        priority < bestPriority
        || (priority === bestPriority
          && (!currentTargetPinned || significantlyCloserThanPinnedTarget)
          && distanceSq < bestDistanceSq - 0.04)
        || (priority === bestPriority
          && !currentTargetPinned
          && Math.abs(distanceSq - bestDistanceSq) <= 0.04
          && hpFraction < bestHpFraction - 1e-6)
      ) {
        best = candidate;
        bestPriority = priority;
        bestDistanceSq = distanceSq;
        bestHpFraction = hpFraction;
      }
    };

    const enemyTeam: CombatTeam = creep.team === 'blue' ? 'red' : 'blue';
    for (const enemyCreep of this.buckets[creep.lane][enemyTeam]) consider(enemyCreep.entity);
    for (const candidate of this.staticCandidates) consider(candidate);
    return best;
  }

  private targetPriority(
    creep: LaneCreepRuntime,
    candidate: GameEntity,
    distanceSq: number,
    now: number,
  ): number | null {
    const activity = this.attackActivity.get(candidate.id);
    const attacked = activity && now - activity.atSeconds <= LANE_CREEP_TUNING.activeAttackWindowSeconds
      ? this.findEntityById(activity.targetId)
      : null;
    const attackingAlly = attacked !== null && attacked.team === creep.team && attacked.alive;

    if (candidate.kind === 'hero' && attackingAlly && attacked?.kind === 'hero') return 1;
    if (candidate.kind === 'creep' && attackingAlly) return 2;
    if (candidate.kind === 'hero' && attackingAlly) return 3;
    if ((candidate.kind === 'tower' || candidate.kind === 'building') && attackingAlly) return 4;

    // Attack-move acquisition is intentionally wider than attack range. Creeps must acquire
    // an enemy before their collision circles meet, then walk into range and fight. Restricting
    // this to combat reach was the main cause of opposing waves physically blocking each other
    // without ever committing to an attack.
    if (distanceSq > ACQUISITION_RANGE_SQ) return null;
    if (candidate.kind === 'creep') return 5;
    if (candidate.kind === 'hero') return 6;
    if (candidate.kind === 'tower' || candidate.kind === 'building') return 7;
    return null;
  }

  private combatReach(creep: LaneCreepRuntime, target: GameEntity) {
    const targetCreep = this.creepById.get(target.id);
    const targetRadius = targetCreep?.stats.collisionRadius
      ?? (target.kind === 'hero'
        ? HERO_COLLISION_RADIUS
        : (target.kind === 'tower' || target.kind === 'building')
          ? target.selectionRadius * 0.62
          : 0.25);
    return creep.stats.attackRange + targetRadius;
  }

  private isHostileCombatTarget(creep: LaneCreepRuntime, target: GameEntity) {
    if (target === creep.entity || !target.alive || target.currentHp <= 0 || target.maxHp <= 0) return false;
    if (target.team === creep.team || target.team === 'neutral') return false;
    if (target.kind === 'shop' || target.kind === 'jungle-creature') return false;
    if (target.kind === 'tower' || target.kind === 'building') {
      return target.interaction === 'attackable-structure';
    }
    return target.targetable;
  }

  private isTargetValid(creep: LaneCreepRuntime, target: GameEntity) {
    return target.root.parent !== null
      && this.isHostileCombatTarget(creep, target)
      && this.isVisibleToCreep(creep, target);
  }

  private isVisibleToCreep(creep: LaneCreepRuntime, target: GameEntity) {
    if (target.root.userData.invisible === true) return false;
    if (creep.team === 'blue' && target.team === 'red' && target.revealed === false) return false;
    if (creep.team === 'red' && target.team === 'blue' && target.root.userData.revealedToRed === false) return false;
    return true;
  }

  private attackTarget(creep: LaneCreepRuntime, target: GameEntity, now: number) {
    if (!this.isTargetValid(creep, target)) return;
    creep.nextAttackAt = now + creep.stats.attackInterval;
    creep.attackSequence += 1;
    triggerLaneCreepAttack(creep.visual, now);

    const attackerPosition = this.getEntityPosition(creep.entity, TEMP_A);
    const targetPosition = this.getEntityPosition(target, TEMP_B);
    const eventNow = performance.now();
    publishWorldAttackEvent({
      attackerId: creep.entity.id,
      targetId: target.id,
      attackerTeam: creep.entity.team,
      targetTeam: target.team,
      attackerKind: creep.entity.kind,
      targetKind: target.kind,
      attackerPosition: { x: attackerPosition.x, z: attackerPosition.z },
      targetPosition: { x: targetPosition.x, z: targetPosition.z },
      atMs: eventNow,
    });

    const damage = calculateTowerAuraAdjustedDamage(creep.entity, target, creep.stats.damage);
    if (target.kind === 'hero' && target.root.userData.networkRemoteHero === true) {
      emitWorldCombatEvent({
        entityId: target.id,
        reason: 'damage',
        currentHp: target.currentHp,
        currentResource: target.currentResource,
        alive: target.alive,
        amount: damage,
        sourceEntityId: creep.entity.id,
        damageType: 'physical',
        isDirect: true,
        isFromFront: true,
        atMs: eventNow,
      });
      return;
    }

    target.currentHp = Math.max(0, target.currentHp - damage);
    target.root.userData.currentHp = target.currentHp;
    if (target.currentHp <= 0) {
      target.alive = false;
      if (target.kind === 'creep') target.root.visible = false;
    }

    publishWorldEntityRuntime(target.id, runtimeSnapshot(target));
    emitWorldCombatEvent({
      entityId: target.id,
      reason: target.alive ? 'damage' : 'death',
      currentHp: target.currentHp,
      currentResource: target.currentResource,
      alive: target.alive,
      amount: damage,
      sourceEntityId: creep.entity.id,
      damageType: 'physical',
      isDirect: true,
      isFromFront: true,
      atMs: eventNow,
    });

    if (!target.alive) this.clearTarget(creep);
  }

  private followLane(creep: LaneCreepRuntime, dt: number, now: number) {
    if (creep.route.length < 2) return false;
    if (creep.routeIndex >= creep.route.length) creep.routeIndex = creep.route.length - 1;

    const arrivalSq = LANE_CREEP_TUNING.laneNodeArrivalDistance ** 2;
    while (
      creep.routeIndex < creep.route.length - 1
      && this.routeNodeReachedOrPassed(creep, creep.routeIndex, arrivalSq)
    ) {
      creep.routeIndex += 1;
      this.clearNavigation(creep);
    }

    const waypoint = creep.route[creep.routeIndex];
    const dx = waypoint[0] - creep.entity.root.position.x;
    const dz = waypoint[1] - creep.entity.root.position.z;
    const distanceSq = dx * dx + dz * dz;

    if (
      creep.routeIndex === creep.route.length - 1
      && this.routeNodeReachedOrPassed(creep, creep.routeIndex, arrivalSq)
    ) {
      if (creep.reachedEndAt === null) creep.reachedEndAt = now;
      return false;
    }

    creep.reachedEndAt = null;
    return this.moveToward(creep, waypoint[0], waypoint[1], dt, false, now);
  }

  private routeNodeReachedOrPassed(
    creep: LaneCreepRuntime,
    nodeIndex: number,
    arrivalSq: number,
  ) {
    const node = creep.route[nodeIndex];
    if (!node) return true;
    const px = creep.entity.root.position.x;
    const pz = creep.entity.root.position.z;
    const dx = node[0] - px;
    const dz = node[1] - pz;
    if (dx * dx + dz * dz <= arrivalSq) return true;
    if (nodeIndex <= 0) return false;

    const previous = creep.route[nodeIndex - 1];
    const vx = node[0] - previous[0];
    const vz = node[1] - previous[1];
    const lengthSq = vx * vx + vz * vz;
    if (lengthSq <= 1e-9) return true;

    // A creep can be pushed around a waypoint by collision avoidance. Once it crosses the
    // perpendicular plane beyond that waypoint, continuing forward is correct; forcing it to
    // turn around and touch the exact authored point creates loops and traffic jams.
    const progress = ((px - previous[0]) * vx + (pz - previous[1]) * vz) / lengthSq;
    return progress >= 1;
  }

  private beginReturning(creep: LaneCreepRuntime) {
    this.clearNavigation(creep);
    creep.blockedForSeconds = 0;
    creep.target = null;
    creep.targetAcquiredAt = 0;
    creep.state = 'RETURNING';
    creep.aggroLockUntil = 0;
    creep.returnNodeIndex = nearestNodeIndex(
      creep.entity.root.position.x,
      creep.entity.root.position.z,
      creep.route,
    );
    this.writeState(creep);
  }

  private updateReturning(creep: LaneCreepRuntime, dt: number, now: number) {
    const node = creep.route[creep.returnNodeIndex] ?? creep.route[0];
    const dx = node[0] - creep.entity.root.position.x;
    const dz = node[1] - creep.entity.root.position.z;
    if (dx * dx + dz * dz <= LANE_CREEP_TUNING.laneNodeArrivalDistance ** 2) {
      creep.routeIndex = Math.min(creep.route.length - 1, creep.returnNodeIndex + 1);
      creep.state = 'ATTACK_MOVE';
      creep.nextScanAt = 0;
      this.writeState(creep);
      return false;
    }
    return this.moveToward(creep, node[0], node[1], dt, false, now);
  }

  private navigationFor(creep: LaneCreepRuntime) {
    return creep.type === 'siege' ? this.siegeNavigation : this.creepNavigation;
  }

  private clearNavigation(creep: LaneCreepRuntime) {
    creep.navWaypoints.length = 0;
    creep.navIndex = 0;
    creep.navPartial = false;
  }

  private planNavigation(creep: LaneCreepRuntime, targetX: number, targetZ: number, now: number) {
    creep.nextRepathAt = now + CREEP_NAV_REPATH_INTERVAL_SECONDS;
    const root = creep.entity.root;
    const navigation = this.navigationFor(creep);
    const start = { x: root.position.x, z: root.position.z };
    const target = { x: targetX, z: targetZ };

    // If the static map has a clear line, A* cannot solve the blockage: another unit is in
    // the way. Leave that case to deterministic local avoidance and avoid an A* storm when
    // several waves are queued behind the same frontline.
    if (navigation.segmentIsWalkable(start, target)) {
      this.clearNavigation(creep);
      return false;
    }

    const path = navigation.findPath(
      start,
      target,
      {
        allowPartial: true,
        nearestSearchRadius: 4.5,
        maxExpandedNodes: CREEP_NAV_MAX_EXPANDED_NODES,
      },
    );

    if (!path || path.waypoints.length === 0) {
      this.clearNavigation(creep);
      return false;
    }

    creep.navWaypoints = path.waypoints.map(point => ({ x: point.x, z: point.z }));
    creep.navIndex = 0;
    creep.navTargetX = targetX;
    creep.navTargetZ = targetZ;
    creep.navPartial = path.partial;
    return true;
  }

  private movementCandidate(
    creep: LaneCreepRuntime,
    from: NavigationPoint,
    directionX: number,
    directionZ: number,
    travel: number,
    enforceLeash: boolean,
  ) {
    const desired = {
      x: from.x + directionX * travel,
      z: from.z + directionZ * travel,
    };
    if (enforceLeash && distanceToPolylineSquared(desired.x, desired.z, creep.route) > LEASH_DISTANCE_SQ) {
      return { x: from.x, z: from.z };
    }

    let resolved = this.collisionWorld.isBlocked(desired, creep.stats.collisionRadius)
      ? this.collisionWorld.move(from, desired, creep.stats.collisionRadius)
      : desired;

    const separated = this.resolveDynamicCollision(creep, resolved.x, resolved.z);
    if (!this.collisionWorld.isBlocked(separated, creep.stats.collisionRadius)) {
      resolved = separated;
    } else {
      resolved = this.collisionWorld.move(from, separated, creep.stats.collisionRadius);
    }

    if (this.hasDynamicOverlapAt(creep, resolved.x, resolved.z, creep.stats.collisionRadius)) {
      const retry = this.resolveDynamicCollision(creep, resolved.x, resolved.z);
      if (!this.collisionWorld.isBlocked(retry, creep.stats.collisionRadius)
        && !this.hasDynamicOverlapAt(creep, retry.x, retry.z, creep.stats.collisionRadius)) {
        resolved = retry;
      } else {
        resolved = { x: from.x, z: from.z };
      }
    }

    return resolved;
  }

  private moveToward(
    creep: LaneCreepRuntime,
    x: number,
    z: number,
    dt: number,
    enforceLeash: boolean,
    now: number,
  ) {
    const root = creep.entity.root;
    const ultimateTarget = { x, z };

    if (
      creep.navWaypoints.length > 0
      && ((creep.navTargetX - x) ** 2 + (creep.navTargetZ - z) ** 2 > CREEP_NAV_TARGET_DRIFT_SQ)
    ) {
      this.clearNavigation(creep);
    }

    let steeringTarget: NavigationPoint = ultimateTarget;
    if (creep.navWaypoints.length > 0) {
      while (creep.navIndex < creep.navWaypoints.length) {
        const waypoint = creep.navWaypoints[creep.navIndex];
        const wx = waypoint.x - root.position.x;
        const wz = waypoint.z - root.position.z;
        if (wx * wx + wz * wz > CREEP_NAV_WAYPOINT_ARRIVAL_SQ) {
          steeringTarget = waypoint;
          break;
        }
        creep.navIndex += 1;
      }

      if (creep.navIndex >= creep.navWaypoints.length) {
        const wasPartial = creep.navPartial;
        this.clearNavigation(creep);
        if (wasPartial && now >= creep.nextRepathAt) {
          this.planNavigation(creep, x, z, now);
          if (creep.navWaypoints.length > 0) steeringTarget = creep.navWaypoints[0];
        }
      }
    }

    let dx = steeringTarget.x - root.position.x;
    let dz = steeringTarget.z - root.position.z;
    let distanceSq = dx * dx + dz * dz;
    if (distanceSq <= 1e-12) return false;

    let distance = Math.sqrt(distanceSq);
    const travel = Math.min(distance, creep.stats.moveSpeed * dt);
    const nx = dx / distance;
    const nz = dz / distance;
    const from = { x: root.position.x, z: root.position.z };
    const beforeDistance = distance;

    let best = this.movementCandidate(creep, from, nx, nz, travel, enforceLeash);
    let bestDistance = Math.hypot(steeringTarget.x - best.x, steeringTarget.z - best.z);
    let bestProgress = beforeDistance - bestDistance;
    let bestMoved = Math.hypot(best.x - from.x, best.z - from.z);

    // Dynamic unit blocking is not static pathfinding. If the direct step is being cancelled
    // by a hero or another creep, probe deterministic side-steering directions before waiting.
    // A persistent preferred side prevents left/right oscillation and lets following waves
    // flow around a congested frontline instead of walking in place.
    if (bestProgress < Math.max(CREEP_MOVE_PROGRESS_EPSILON, travel * 0.06)) {
      const preferred = creep.avoidanceSide;
      const avoidanceSigns: readonly (-1 | 1)[] = [
        preferred,
        preferred === 1 ? -1 : 1,
      ];
      for (const magnitude of CREEP_AVOIDANCE_ANGLES) {
        for (const sign of avoidanceSigns) {
          const angle = magnitude * sign;
          const cos = Math.cos(angle);
          const sin = Math.sin(angle);
          const candidateDirX = nx * cos - nz * sin;
          const candidateDirZ = nx * sin + nz * cos;
          const candidate = this.movementCandidate(
            creep,
            from,
            candidateDirX,
            candidateDirZ,
            travel,
            enforceLeash,
          );
          const moved = Math.hypot(candidate.x - from.x, candidate.z - from.z);
          if (moved <= 0.0005) continue;
          const remaining = Math.hypot(
            steeringTarget.x - candidate.x,
            steeringTarget.z - candidate.z,
          );
          const progress = beforeDistance - remaining;
          // Permit a tiny temporary sideways cost, but never select a move that materially
          // retreats from the current steering waypoint.
          if (progress < -0.035) continue;
          const score = progress * 3.2 + moved * 0.28 - magnitude * 0.006;
          const bestScore = bestProgress * 3.2 + bestMoved * 0.28;
          if (score <= bestScore + 1e-6) continue;
          best = candidate;
          bestDistance = remaining;
          bestProgress = progress;
          bestMoved = moved;
          creep.avoidanceSide = sign;
        }
      }
    }

    if (
      enforceLeash
      && distanceToPolylineSquared(best.x, best.z, creep.route) > LEASH_DISTANCE_SQ
    ) {
      this.beginReturning(creep);
      return false;
    }

    root.position.x = best.x;
    root.position.z = best.z;
    const actualDx = best.x - from.x;
    const actualDz = best.z - from.z;
    if (actualDx * actualDx + actualDz * actualDz > 1e-8) {
      root.rotation.y = Math.atan2(actualDx, actualDz);
    } else {
      root.rotation.y = Math.atan2(nx, nz);
    }
    this.updateSpatialCell(creep);

    const meaningfulProgress = bestProgress >= Math.max(
      CREEP_MOVE_PROGRESS_EPSILON,
      travel * 0.055,
    );
    if (meaningfulProgress) {
      creep.blockedForSeconds = Math.max(0, creep.blockedForSeconds - dt * 2.5);
    } else {
      creep.blockedForSeconds += dt;
    }

    if (
      creep.blockedForSeconds >= CREEP_NAV_REPATH_STUCK_SECONDS
      && now >= creep.nextRepathAt
    ) {
      this.planNavigation(creep, ultimateTarget.x, ultimateTarget.z, now);
      // Do not clear the stuck timer immediately: a direct A* result means the blocker is
      // another unit, so local steering must keep working rather than declaring success.
      creep.blockedForSeconds = Math.min(
        creep.blockedForSeconds,
        CREEP_NAV_REPATH_STUCK_SECONDS + 0.15,
      );
    }

    // Animation follows real translation, not route-direction heuristics. This is team
    // agnostic: if the unit actually changed world position, its locomotion animation runs.
    return bestMoved > Math.max(0.003, travel * 0.08);
  }

  private resolveDynamicCollision(creep: LaneCreepRuntime, startX: number, startZ: number) {
    let x = startX;
    let z = startZ;

    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      const cell = spatialCoords(x, z);

      for (let cellX = cell.x - 1; cellX <= cell.x + 1; cellX++) {
        for (let cellZ = cell.z - 1; cellZ <= cell.z + 1; cellZ++) {
          const occupants = this.spatialCells.get(spatialKey(cellX, cellZ));
          if (!occupants) continue;
          for (const other of occupants) {
            if (other === creep || !other.entity.alive) continue;
            const required = creep.stats.collisionRadius + other.stats.collisionRadius + UNIT_SEPARATION_PADDING;
            let dx = x - other.entity.root.position.x;
            let dz = z - other.entity.root.position.z;
            let distanceSq = dx * dx + dz * dz;
            if (distanceSq >= required * required) continue;

            if (distanceSq <= 1e-10) {
              const angle = ((creep.seed * 37 + other.seed * 17) % 360) * Math.PI / 180;
              dx = Math.cos(angle);
              dz = Math.sin(angle);
              distanceSq = 1;
            }

            const distance = Math.sqrt(distanceSq);
            const push = required - distance + 0.002;
            x += dx / distance * push;
            z += dz / distance * push;
            changed = true;
          }
        }
      }

      for (const candidate of this.staticCandidates) {
        if (candidate.kind !== 'hero' || !candidate.alive) continue;
        const position = this.getEntityPosition(candidate, TEMP_B);
        const required = creep.stats.collisionRadius + HERO_COLLISION_RADIUS + UNIT_SEPARATION_PADDING;
        let dx = x - position.x;
        let dz = z - position.z;
        let distanceSq = dx * dx + dz * dz;
        if (distanceSq >= required * required) continue;
        if (distanceSq <= 1e-10) {
          const angle = (creep.seed % 360) * Math.PI / 180;
          dx = Math.cos(angle);
          dz = Math.sin(angle);
          distanceSq = 1;
        }
        const distance = Math.sqrt(distanceSq);
        const push = required - distance + 0.002;
        x += dx / distance * push;
        z += dz / distance * push;
        changed = true;
      }

      if (!changed) break;
    }

    return { x, z };
  }

  private hasDynamicOverlapAt(
    creep: LaneCreepRuntime | null,
    x: number,
    z: number,
    radius: number,
  ) {
    const cell = spatialCoords(x, z);
    for (let cellX = cell.x - 1; cellX <= cell.x + 1; cellX++) {
      for (let cellZ = cell.z - 1; cellZ <= cell.z + 1; cellZ++) {
        const occupants = this.spatialCells.get(spatialKey(cellX, cellZ));
        if (!occupants) continue;
        for (const other of occupants) {
          if (other === creep || !other.entity.alive) continue;
          const required = radius + other.stats.collisionRadius + UNIT_SEPARATION_PADDING * 0.5;
          const dx = x - other.entity.root.position.x;
          const dz = z - other.entity.root.position.z;
          if (dx * dx + dz * dz < required * required) return true;
        }
      }
    }
    return false;
  }

  private updateSurfaceHeight(creep: LaneCreepRuntime, dt: number, moving: boolean) {
    if (moving) {
      const key = heightKey(creep.entity.root.position.x, creep.entity.root.position.z);
      if (key !== creep.heightCellKey) {
        creep.heightCellKey = key;
        creep.targetY = this.surfaceHeightAt(
          creep.entity.root.position.x,
          creep.entity.root.position.z,
        ) + 0.03;
      }
    }

    const blend = 1 - Math.exp(-HEIGHT_DAMPING * dt);
    creep.entity.root.position.y = THREE.MathUtils.lerp(
      creep.entity.root.position.y,
      creep.targetY,
      blend,
    );
  }

  private surfaceHeightAt(x: number, z: number) {
    const key = heightKey(x, z);
    const cached = this.heightCache.get(key);
    if (cached !== undefined) return cached;

    SURFACE_RAY.ray.origin.set(x, 64, z);
    const hit = SURFACE_RAY.intersectObjects(this.commandSurfaces, false)[0];
    const height = hit?.point.y ?? 0;
    this.heightCache.set(key, height);
    return height;
  }

  private faceVector(creep: LaneCreepRuntime, dx: number, dz: number) {
    if (dx * dx + dz * dz > 1e-12) creep.entity.root.rotation.y = Math.atan2(dx, dz);
  }

  private animateCreep(creep: LaneCreepRuntime, now: number, moving: boolean) {
    creep.moving = moving;
    animateLaneCreepVisual(creep.visual, now, moving);
  }

  private clearTarget(creep: LaneCreepRuntime) {
    this.clearNavigation(creep);
    creep.blockedForSeconds = 0;
    creep.target = null;
    creep.targetAcquiredAt = 0;
    creep.state = 'ATTACK_MOVE';
    creep.nextScanAt = 0;
    this.writeState(creep);
  }

  private writeState(creep: LaneCreepRuntime) {
    creep.entity.root.userData.laneCreepState = creep.state;
    creep.entity.root.userData.laneCreepTargetId = creep.target?.id ?? null;
  }

  private getEntityPosition(entity: GameEntity, out: THREE.Vector3) {
    const runtime = this.creepById.get(entity.id);
    if (runtime) return out.copy(runtime.entity.root.position);
    return entity.root.getWorldPosition(out);
  }

  private findEntityById(id: string): GameEntity | null {
    return this.creepById.get(id)?.entity ?? this.staticById.get(id) ?? null;
  }

  private rebalanceVisionLeaders() {
    for (const creep of this.creeps) creep.entity.grantsVision = false;

    for (const lane of LANES) {
      for (const team of TEAMS) {
        let leader: LaneCreepRuntime | null = null;
        let leaderProgress = Number.NEGATIVE_INFINITY;
        for (const creep of this.buckets[lane][team]) {
          if (!creep.entity.alive) continue;
          const progress = creep.routeIndex * 1000 - distanceToNextWaypointSquared(creep);
          if (progress > leaderProgress) {
            leaderProgress = progress;
            leader = creep;
          }
        }
        if (leader) leader.entity.grantsVision = true;
      }
    }
  }

  private pruneAttackActivity(now: number) {
    const cutoff = now - Math.max(
      LANE_CREEP_TUNING.outOfLaneAttackGraceSeconds,
      LANE_CREEP_TUNING.activeAttackWindowSeconds,
    ) - 1;
    for (const [id, activity] of this.attackActivity) {
      if (activity.atSeconds < cutoff && !this.creepById.has(id) && !this.staticById.has(id)) {
        this.attackActivity.delete(id);
      }
    }
  }

  private addToSpatialCell(creep: LaneCreepRuntime) {
    const key = spatialKey(creep.spatialX, creep.spatialZ);
    let bucket = this.spatialCells.get(key);
    if (!bucket) {
      bucket = new Set();
      this.spatialCells.set(key, bucket);
    }
    bucket.add(creep);
  }

  private updateSpatialCell(creep: LaneCreepRuntime) {
    const next = spatialCoords(creep.entity.root.position.x, creep.entity.root.position.z);
    if (next.x === creep.spatialX && next.z === creep.spatialZ) return;

    const previousKey = spatialKey(creep.spatialX, creep.spatialZ);
    const previous = this.spatialCells.get(previousKey);
    previous?.delete(creep);
    if (previous?.size === 0) this.spatialCells.delete(previousKey);

    creep.spatialX = next.x;
    creep.spatialZ = next.z;
    this.addToSpatialCell(creep);
  }

  private removeFromSpatialCell(creep: LaneCreepRuntime) {
    const key = spatialKey(creep.spatialX, creep.spatialZ);
    const bucket = this.spatialCells.get(key);
    bucket?.delete(creep);
    if (bucket?.size === 0) this.spatialCells.delete(key);
  }

  private cleanupCreep(index: number) {
    const creep = this.creeps[index];
    this.removeFromSpatialCell(creep);
    this.buckets[creep.lane][creep.team].delete(creep);
    this.creepById.delete(creep.entity.id);
    this.replicaTargets.delete(creep.entity.id);
    this.attackActivity.delete(creep.entity.id);
    creep.entity.grantsVision = false;
    disposeEntityOverhead(creep.entity.root);
    this.registry.unregister(creep.entity.root);
    removeWorldEntityRuntime(creep.entity.id);
    this.scene.remove(creep.entity.root);
    this.creeps.splice(index, 1);
  }

  private dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    for (let index = this.creeps.length - 1; index >= 0; index--) this.cleanupCreep(index);
    this.visualResources.dispose();
    this.heightCache.clear();
    this.spatialCells.clear();
    managerByScene.delete(this.scene);
  }
}

function runtimeSnapshot(entity: GameEntity) {
  return {
    level: entity.level,
    maxHp: entity.maxHp,
    currentHp: entity.currentHp,
    maxResource: entity.maxResource,
    currentResource: entity.currentResource,
    alive: entity.alive,
  };
}

function creepDisplayName(team: CombatTeam, type: LaneCreepType) {
  const teamName = team === 'blue' ? 'Dawn' : 'Dusk';
  switch (type) {
    case 'flagbearer': return `${teamName} Flagbearer`;
    case 'ranged': return `${teamName} Ranged Creep`;
    case 'siege': return `${teamName} Siege Creep`;
    case 'melee': return `${teamName} Melee Creep`;
  }
}

function spatialCoords(x: number, z: number) {
  return {
    x: Math.floor(x / SPATIAL_CELL_SIZE),
    z: Math.floor(z / SPATIAL_CELL_SIZE),
  };
}

function spatialKey(x: number, z: number) {
  return (x + SPATIAL_OFFSET) * SPATIAL_STRIDE + z + SPATIAL_OFFSET;
}

function heightKey(x: number, z: number) {
  const cellX = Math.round(x / HEIGHT_CACHE_STEP);
  const cellZ = Math.round(z / HEIGHT_CACHE_STEP);
  return (cellX + HEIGHT_OFFSET) * HEIGHT_STRIDE + cellZ + HEIGHT_OFFSET;
}

function nearestNodeIndex(x: number, z: number, route: readonly MapPoint[]) {
  let bestIndex = 0;
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  for (let index = 0; index < route.length; index++) {
    const dx = x - route[index][0];
    const dz = z - route[index][1];
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function distanceToNextWaypointSquared(creep: LaneCreepRuntime) {
  const waypoint = creep.route[Math.min(creep.routeIndex, creep.route.length - 1)];
  const dx = waypoint[0] - creep.entity.root.position.x;
  const dz = waypoint[1] - creep.entity.root.position.z;
  return dx * dx + dz * dz;
}

function distanceToPolylineSquared(x: number, z: number, route: readonly MapPoint[]) {
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  for (let index = 0; index < route.length - 1; index++) {
    const a = route[index];
    const b = route[index + 1];
    const vx = b[0] - a[0];
    const vz = b[1] - a[1];
    const lengthSq = vx * vx + vz * vz;
    const t = lengthSq <= 1e-9
      ? 0
      : THREE.MathUtils.clamp(((x - a[0]) * vx + (z - a[1]) * vz) / lengthSq, 0, 1);
    const px = a[0] + vx * t;
    const pz = a[1] + vz * t;
    const dx = x - px;
    const dz = z - pz;
    bestDistanceSq = Math.min(bestDistanceSq, dx * dx + dz * dz);
  }
  return Number.isFinite(bestDistanceSq) ? bestDistanceSq : 0;
}

function disposeEntityOverhead(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Sprite) || !object.name.endsWith('-overhead')) return;
    const material = object.material;
    material.map?.dispose();
    material.dispose();
  });
}
