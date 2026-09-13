import * as THREE from 'three';
import type { GameEntity, GameEntityRegistry, TeamId } from '../entities/gameEntities';
import {
  emitWorldCombatEvent,
  getWorldAttackEventsAfter,
  publishWorldAttackEvent,
  publishWorldEntityRuntime,
  removeWorldEntityRuntime,
} from '../entities/worldCombatBridge';
import { createMapCollisionWorld, type CollisionWorld } from '../map/collisionWorld';
import { DAWNREACH_LAYOUT, type MapPoint } from '../map/mapLayout';

export type LaneName = 'top' | 'mid' | 'bot';
export type LaneCreepType = 'melee' | 'ranged' | 'flagbearer' | 'siege';
export type LaneCreepState = 'ATTACK_MOVE' | 'COMBAT' | 'AGGRO' | 'RETURNING';

type CombatTeam = Extract<TeamId, 'blue' | 'red'>;

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
  model: THREE.Group;
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
  phase: number;
  seed: number;
  spatialX: number;
  spatialZ: number;
  heightCellKey: number;
  targetY: number;
};

type LaneTeamBucket = Record<CombatTeam, Set<LaneCreepRuntime>>;
type VisualResources = ReturnType<typeof createVisualResources>;

const GAME_UNIT_TO_WORLD = 0.01;
const WORLD_UNITS = (gameUnits: number) => gameUnits * GAME_UNIT_TO_WORLD;
const ACQUISITION_RANGE_SQ = WORLD_UNITS(500) ** 2;
const LEASH_DISTANCE_SQ = WORLD_UNITS(400) ** 2;
const HERO_COLLISION_RADIUS = 0.48;
const UNIT_SEPARATION_PADDING = 0.045;
const SPATIAL_CELL_SIZE = 1.25;
const SPATIAL_STRIDE = 4096;
const SPATIAL_OFFSET = 1024;
const HEIGHT_CACHE_STEP = 0.18;
const HEIGHT_STRIDE = 8192;
const HEIGHT_OFFSET = 2048;
const HEIGHT_DAMPING = 30;
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
} as const;

const CREEP_STATS: Record<LaneCreepType, CreepStats> = {
  melee: {
    maxHp: 550,
    damage: 24,
    attackRange: 1.2,
    attackInterval: 1,
    moveSpeed: 3,
    selectionRadius: 0.56,
    collisionRadius: 0.34,
  },
  flagbearer: {
    maxHp: 550,
    damage: 24,
    attackRange: 1.2,
    attackInterval: 1,
    moveSpeed: 3,
    selectionRadius: 0.58,
    collisionRadius: 0.35,
  },
  ranged: {
    maxHp: 360,
    damage: 28,
    attackRange: 4.35,
    attackInterval: 1.2,
    moveSpeed: 3,
    selectionRadius: 0.54,
    collisionRadius: 0.32,
  },
  siege: {
    maxHp: 900,
    damage: 58,
    attackRange: 5,
    attackInterval: 2,
    moveSpeed: 2.45,
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
  private readonly resources: VisualResources = createVisualResources();
  private readonly collisionWorld: CollisionWorld;
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
  private readonly startedAtMs = performance.now();
  private lastFrameMs = this.startedAtMs;
  private nextWaveIndex = 0;
  private lastAttackSequence = 0;
  private animationFrame = 0;
  private disposed = false;
  private serial = 0;
  private nextVisionRebalanceAt = 0;
  private nextCandidateRefreshAt = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly registry: GameEntityRegistry,
  ) {
    const battlefield = scene.getObjectByName('dawnreach-map');
    if (!battlefield) throw new Error('Lane creep system requires dawnreach-map');

    scene.traverse((object) => {
      if (object instanceof THREE.Mesh && object.userData.commandSurface) this.commandSurfaces.push(object);
    });

    // The gameplay bootstrap already builds the hero collision world before the first hero
    // registration. createMapCollisionWorld also opens camp entrances, so mark those groups
    // as already authored before constructing the creep-side static solver to keep that step
    // idempotent instead of removing another pair of rocks from every camp.
    battlefield.traverse((object) => {
      if (object instanceof THREE.Group && object.name.startsWith('jungle-camp-')) {
        object.userData.authoredEntrance = true;
      }
    });
    this.collisionWorld = createMapCollisionWorld(battlefield);

    this.refreshStaticCandidates();
    const canvases = document.querySelectorAll<HTMLCanvasElement>('.game-canvas');
    this.gameCanvas = canvases.length > 0 ? canvases[canvases.length - 1] : null;
  }

  start() {
    this.spawnWave(0, 0);
    this.nextWaveIndex = 1;
    this.rebalanceVisionLeaders();
    this.animationFrame = requestAnimationFrame(this.frame);
  }

  private frame = (nowMs: number) => {
    if (this.disposed) return;
    if (this.gameCanvas && !this.gameCanvas.isConnected) {
      this.dispose();
      return;
    }

    const dt = Math.min(0.05, Math.max(0, (nowMs - this.lastFrameMs) / 1000));
    this.lastFrameMs = nowMs;
    const elapsed = Math.max(0, (nowMs - this.startedAtMs) / 1000);

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
    const trailingOffset = formationIndex < 3 ? 0 : formationIndex === 3 ? 1 : 1.8;
    const stats = CREEP_STATS[type];

    const rawSpawnX = start[0] + sideX * lateralSlot - dirX * trailingOffset;
    const rawSpawnZ = start[1] + sideZ * lateralSlot - dirZ * trailingOffset;
    const spawn = this.findFreeSpawnPoint(rawSpawnX, rawSpawnZ, dirX, dirZ, stats.collisionRadius);

    const { root, model } = buildCreepVisual(this.resources, team, type);
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
      model,
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
      phase: (this.serial % 17) / 17 * Math.PI * 2,
      seed: this.serial,
      spatialX: spatial.x,
      spatialZ: spatial.z,
      heightCellKey: heightKey(root.position.x, root.position.z),
      targetY: initialSurface,
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
      if (nextTarget && nextTarget !== previousTarget) creep.targetAcquiredAt = now;
      if (!nextTarget) creep.targetAcquiredAt = 0;
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
        moving = this.moveToward(creep, targetPosition.x, targetPosition.z, dt, true);
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
    let bestHpFraction = Number.POSITIVE_INFINITY;
    let bestDistanceSq = Number.POSITIVE_INFINITY;

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

      if (
        priority < bestPriority
        || (priority === bestPriority && hpFraction < bestHpFraction - 1e-6)
        || (priority === bestPriority && Math.abs(hpFraction - bestHpFraction) <= 1e-6 && distanceSq < bestDistanceSq)
      ) {
        best = candidate;
        bestPriority = priority;
        bestHpFraction = hpFraction;
        bestDistanceSq = distanceSq;
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

    const reach = this.combatReach(creep, candidate);
    if (distanceSq > reach * reach) return null;
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

    target.currentHp = Math.max(0, target.currentHp - creep.stats.damage);
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
      atMs: eventNow,
    });

    creep.model.scale.set(1.06, 0.95, 1.06);
    if (!target.alive) this.clearTarget(creep);
  }

  private followLane(creep: LaneCreepRuntime, dt: number, now: number) {
    if (creep.route.length < 2) return false;
    if (creep.routeIndex >= creep.route.length) creep.routeIndex = creep.route.length - 1;

    let waypoint = creep.route[creep.routeIndex];
    let dx = waypoint[0] - creep.entity.root.position.x;
    let dz = waypoint[1] - creep.entity.root.position.z;
    let distanceSq = dx * dx + dz * dz;
    const arrivalSq = LANE_CREEP_TUNING.laneNodeArrivalDistance ** 2;

    if (distanceSq <= arrivalSq && creep.routeIndex < creep.route.length - 1) {
      creep.routeIndex += 1;
      waypoint = creep.route[creep.routeIndex];
      dx = waypoint[0] - creep.entity.root.position.x;
      dz = waypoint[1] - creep.entity.root.position.z;
      distanceSq = dx * dx + dz * dz;
    }

    if (creep.routeIndex === creep.route.length - 1 && distanceSq <= arrivalSq) {
      if (creep.reachedEndAt === null) creep.reachedEndAt = now;
      return false;
    }

    creep.reachedEndAt = null;
    return this.moveToward(creep, waypoint[0], waypoint[1], dt, false);
  }

  private beginReturning(creep: LaneCreepRuntime) {
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

  private updateReturning(creep: LaneCreepRuntime, dt: number, _now: number) {
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
    return this.moveToward(creep, node[0], node[1], dt, false);
  }

  private moveToward(
    creep: LaneCreepRuntime,
    x: number,
    z: number,
    dt: number,
    enforceLeash: boolean,
  ) {
    const root = creep.entity.root;
    const dx = x - root.position.x;
    const dz = z - root.position.z;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq <= 1e-12) return false;

    const distance = Math.sqrt(distanceSq);
    const travel = Math.min(distance, creep.stats.moveSpeed * dt);
    const nx = dx / distance;
    const nz = dz / distance;
    const from = { x: root.position.x, z: root.position.z };
    const desired = {
      x: root.position.x + nx * travel,
      z: root.position.z + nz * travel,
    };

    if (enforceLeash && distanceToPolylineSquared(desired.x, desired.z, creep.route) > LEASH_DISTANCE_SQ) {
      this.beginReturning(creep);
      return false;
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
        resolved = from;
      }
    }

    root.position.x = resolved.x;
    root.position.z = resolved.z;
    root.rotation.y = Math.atan2(nx, nz);
    this.updateSpatialCell(creep);
    return Math.hypot(resolved.x - from.x, resolved.z - from.z) > 0.0005;
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
    const desired = moving ? 1 + Math.sin(now * 9 + creep.phase) * 0.025 : 1;
    creep.model.position.y = moving ? Math.abs(Math.sin(now * 7 + creep.phase)) * 0.028 : 0;
    creep.model.scale.x += (desired - creep.model.scale.x) * 0.16;
    creep.model.scale.y += (1 - creep.model.scale.y) * 0.16;
    creep.model.scale.z += (desired - creep.model.scale.z) * 0.16;
  }

  private clearTarget(creep: LaneCreepRuntime) {
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
      let leader: LaneCreepRuntime | null = null;
      let leaderProgress = Number.NEGATIVE_INFINITY;
      for (const creep of this.buckets[lane].blue) {
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
    this.resources.dispose();
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

function createVisualResources() {
  const geometries = {
    body: new THREE.CapsuleGeometry(0.28, 0.46, 3, 7),
    head: new THREE.SphereGeometry(0.22, 9, 6),
    shoulder: new THREE.BoxGeometry(0.58, 0.13, 0.22),
    blade: new THREE.BoxGeometry(0.07, 0.06, 0.68),
    staff: new THREE.CylinderGeometry(0.035, 0.035, 0.92, 6),
    flag: new THREE.PlaneGeometry(0.58, 0.38),
    focus: new THREE.SphereGeometry(0.09, 7, 5),
    wheel: new THREE.CylinderGeometry(0.22, 0.22, 0.09, 8),
    siegeBody: new THREE.BoxGeometry(0.72, 0.34, 0.92),
    siegeArm: new THREE.BoxGeometry(0.11, 0.11, 0.95),
    siegeCrest: new THREE.BoxGeometry(0.36, 0.2, 0.08),
  };

  const blue = new THREE.MeshStandardMaterial({ color: 0x356fd6, roughness: 0.55, metalness: 0.24 });
  const red = new THREE.MeshStandardMaterial({ color: 0xb84b46, roughness: 0.55, metalness: 0.24 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xb9c4ca, roughness: 0.42, metalness: 0.62 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x22272d, roughness: 0.7, metalness: 0.14 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x69503a, roughness: 0.84, metalness: 0.02 });
  const blueFlag = new THREE.MeshStandardMaterial({ color: 0x4f8cff, side: THREE.DoubleSide, roughness: 0.72 });
  const redFlag = new THREE.MeshStandardMaterial({ color: 0xe0645c, side: THREE.DoubleSide, roughness: 0.72 });
  const materials = { blue, red, steel, dark, wood, blueFlag, redFlag };

  return {
    geometries,
    materials,
    dispose() {
      Object.values(geometries).forEach(geometry => geometry.dispose());
      Object.values(materials).forEach(material => material.dispose());
    },
  };
}

function buildCreepVisual(resources: VisualResources, team: CombatTeam, type: LaneCreepType) {
  const root = new THREE.Group();
  const model = new THREE.Group();
  model.name = 'lane-creep-model';
  root.add(model);

  const teamMaterial = team === 'blue' ? resources.materials.blue : resources.materials.red;

  if (type === 'siege') {
    const chassis = new THREE.Mesh(resources.geometries.siegeBody, resources.materials.wood);
    chassis.position.y = 0.42;
    model.add(chassis);

    const leftWheel = new THREE.Mesh(resources.geometries.wheel, resources.materials.dark);
    leftWheel.rotation.z = Math.PI / 2;
    leftWheel.position.set(-0.39, 0.26, 0);
    model.add(leftWheel);

    const rightWheel = new THREE.Mesh(resources.geometries.wheel, resources.materials.dark);
    rightWheel.rotation.z = Math.PI / 2;
    rightWheel.position.set(0.39, 0.26, 0);
    model.add(rightWheel);

    const arm = new THREE.Mesh(resources.geometries.siegeArm, resources.materials.steel);
    arm.position.set(0, 0.74, -0.18);
    arm.rotation.x = -0.38;
    model.add(arm);

    const crest = new THREE.Mesh(resources.geometries.siegeCrest, teamMaterial);
    crest.position.set(0, 0.67, 0.49);
    model.add(crest);
    model.scale.setScalar(0.92);
    return { root, model };
  }

  const body = new THREE.Mesh(resources.geometries.body, teamMaterial);
  body.position.y = 0.64;
  model.add(body);

  const head = new THREE.Mesh(resources.geometries.head, resources.materials.steel);
  head.position.y = 1.23;
  model.add(head);

  const shoulder = new THREE.Mesh(resources.geometries.shoulder, resources.materials.steel);
  shoulder.position.y = 0.95;
  model.add(shoulder);

  if (type === 'melee' || type === 'flagbearer') {
    const blade = new THREE.Mesh(resources.geometries.blade, resources.materials.steel);
    blade.position.set(0.38, 0.72, 0.04);
    blade.rotation.x = Math.PI / 2.7;
    blade.rotation.z = -0.16;
    model.add(blade);
  }

  if (type === 'ranged') {
    const staff = new THREE.Mesh(resources.geometries.staff, resources.materials.wood);
    staff.position.set(0.34, 0.73, 0.02);
    staff.rotation.z = -0.2;
    model.add(staff);
    const focus = new THREE.Mesh(resources.geometries.focus, teamMaterial);
    focus.position.set(0.34, 1.2, 0.02);
    model.add(focus);
  }

  if (type === 'flagbearer') {
    const pole = new THREE.Mesh(resources.geometries.staff, resources.materials.wood);
    pole.scale.y = 1.75;
    pole.position.set(-0.34, 1.05, 0.02);
    model.add(pole);
    const flag = new THREE.Mesh(
      resources.geometries.flag,
      team === 'blue' ? resources.materials.blueFlag : resources.materials.redFlag,
    );
    flag.position.set(-0.05, 1.62, 0.02);
    flag.rotation.y = Math.PI / 2;
    model.add(flag);
  }

  model.scale.setScalar(0.82);
  return { root, model };
}
