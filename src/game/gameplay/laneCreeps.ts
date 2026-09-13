import * as THREE from 'three';
import type { GameEntity, GameEntityRegistry, TeamId } from '../entities/gameEntities';
import {
  emitWorldCombatEvent,
  getWorldAttackEventsAfter,
  publishWorldAttackEvent,
  publishWorldEntityRuntime,
} from '../entities/worldCombatBridge';
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
}>;

type AttackActivity = Readonly<{
  targetId: string;
  atSeconds: number;
}>;

type LaneCreepRuntime = {
  entity: GameEntity;
  type: LaneCreepType;
  lane: LaneName;
  team: CombatTeam;
  route: readonly MapPoint[];
  routeIndex: number;
  state: LaneCreepState;
  target: GameEntity | null;
  stats: CreepStats;
  nextAttackAt: number;
  nextScanAt: number;
  aggroLockUntil: number;
  returnNodeIndex: number;
  deathAt: number | null;
  phase: number;
};

const GAME_UNIT_TO_WORLD = 0.01;
const WORLD_UNITS = (gameUnits: number) => gameUnits * GAME_UNIT_TO_WORLD;

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
  scanIntervalSeconds: 0.12,
  laneReturnThreshold: 0.55,
  laneNodeArrivalDistance: 0.32,
  corpseLifetimeSeconds: 0.85,
} as const;

const CREEP_STATS: Record<LaneCreepType, CreepStats> = {
  melee: {
    maxHp: 550,
    damage: 24,
    attackRange: 1.2,
    attackInterval: 1.0,
    moveSpeed: 3.0,
    selectionRadius: 0.56,
  },
  flagbearer: {
    maxHp: 550,
    damage: 24,
    attackRange: 1.2,
    attackInterval: 1.0,
    moveSpeed: 3.0,
    selectionRadius: 0.58,
  },
  ranged: {
    maxHp: 360,
    damage: 28,
    attackRange: 4.35,
    attackInterval: 1.2,
    moveSpeed: 3.0,
    selectionRadius: 0.54,
  },
  siege: {
    maxHp: 900,
    damage: 58,
    attackRange: 5.0,
    attackInterval: 2.0,
    moveSpeed: 2.45,
    selectionRadius: 0.82,
  },
};

const LANES: readonly LaneName[] = ['top', 'mid', 'bot'];
const TEAMS: readonly CombatTeam[] = ['blue', 'red'];
const managerByScene = new WeakMap<THREE.Scene, LaneCreepManager>();

const worldPositionA = new THREE.Vector3();
const worldPositionB = new THREE.Vector3();
const surfaceRay = new THREE.Raycaster();
surfaceRay.ray.direction.set(0, -1, 0);

export function getLaneWaveComposition(waveIndex: number): LaneCreepType[] {
  const safeWaveIndex = Math.max(0, Math.floor(waveIndex));
  const waveSeconds = safeWaveIndex * LANE_CREEP_TUNING.waveIntervalSeconds;
  const composition: LaneCreepType[] = ['melee', 'melee', 'melee', 'ranged'];

  const hasFlagbearer = waveSeconds >= LANE_CREEP_TUNING.flagbearerStartSeconds
    && safeWaveIndex % LANE_CREEP_TUNING.flagbearerEveryWaves === 0;
  if (hasFlagbearer) composition[0] = 'flagbearer';

  const hasSiege = waveSeconds >= LANE_CREEP_TUNING.siegeStartSeconds
    && safeWaveIndex % LANE_CREEP_TUNING.siegeEveryWaves === 0;
  if (hasSiege) composition.push('siege');

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
  private readonly attackActivity = new Map<string, AttackActivity>();
  private readonly commandSurfaces: THREE.Mesh[] = [];
  private readonly resources = createVisualResources();
  private readonly gameCanvas: HTMLCanvasElement | null;
  private readonly startedAtMs = performance.now();
  private lastFrameMs = this.startedAtMs;
  private nextWaveIndex = 0;
  private lastAttackSequence = 0;
  private animationFrame = 0;
  private disposed = false;
  private serial = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly registry: GameEntityRegistry,
  ) {
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh && object.userData.commandSurface) this.commandSurfaces.push(object);
    });
    const canvases = document.querySelectorAll<HTMLCanvasElement>('.game-canvas');
    this.gameCanvas = canvases.length > 0 ? canvases[canvases.length - 1] : null;
  }

  start() {
    // Wave zero is a real 00:00 wave, not a delayed first spawn.
    this.spawnWave(0);
    this.nextWaveIndex = 1;
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

    for (let index = this.creeps.length - 1; index >= 0; index--) {
      const creep = this.creeps[index];
      if (!this.updateCreep(creep, elapsed, dt)) {
        this.cleanupCreep(index);
      }
    }

    this.animationFrame = requestAnimationFrame(this.frame);
  };

  private spawnDueWaves(elapsed: number) {
    while (this.nextWaveIndex * LANE_CREEP_TUNING.waveIntervalSeconds <= elapsed + 1e-6) {
      this.spawnWave(this.nextWaveIndex);
      this.nextWaveIndex += 1;
    }
  }

  private spawnWave(waveIndex: number) {
    const composition = getLaneWaveComposition(waveIndex);
    for (const lane of LANES) {
      for (const team of TEAMS) {
        composition.forEach((type, formationIndex) => {
          this.spawnCreep(team, lane, type, waveIndex, formationIndex, composition.length);
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
      ? (formationIndex - 1) * 0.72
      : formationIndex === 3
        ? 0
        : (formationIndex - (formationSize - 1) / 2) * 0.58;
    const trailingOffset = formationIndex < 3 ? 0 : formationIndex === 3 ? 0.92 : 1.65;

    const root = buildCreepVisual(this.resources, team, type);
    root.name = `${team}-${lane}-${type}-wave-${waveIndex}-${this.serial}`;
    root.position.set(
      start[0] + sideX * lateralSlot - dirX * trailingOffset,
      0,
      start[1] + sideZ * lateralSlot - dirZ * trailingOffset,
    );
    root.position.y = this.sampleSurfaceHeight(root.position.x, root.position.z) + 0.03;
    root.rotation.y = Math.atan2(dirX, dirZ);
    this.scene.add(root);

    const stats = CREEP_STATS[type];
    const entity = this.registry.register(root, {
      id: `lane-creep:${team}:${lane}:${waveIndex}:${this.serial++}`,
      displayName: creepDisplayName(team, type),
      kind: 'creep',
      team,
      selectable: true,
      targetable: true,
      grantsVision: true,
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

    this.creeps.push({
      entity,
      type,
      lane,
      team,
      route,
      routeIndex: 1,
      state: 'ATTACK_MOVE',
      target: null,
      stats,
      nextAttackAt: 0,
      nextScanAt: 0,
      aggroLockUntil: 0,
      returnNodeIndex: 0,
      deathAt: null,
      phase: Math.random() * Math.PI * 2,
    });
  }

  private consumeAttackEvents(nowSeconds: number) {
    const events = getWorldAttackEventsAfter(this.lastAttackSequence);
    if (events.length === 0) return;

    for (const event of events) {
      this.lastAttackSequence = Math.max(this.lastAttackSequence, event.sequence);
      const eventSeconds = event.atMs / 1000;
      this.attackActivity.set(event.attackerId, {
        targetId: event.targetId,
        atSeconds: eventSeconds,
      });

      if (event.attackerKind !== 'hero' || event.targetKind !== 'hero') continue;
      if (event.attackerTeam === event.targetTeam || event.targetTeam === 'neutral') continue;
      const attacker = this.findEntityById(event.attackerId);
      if (!attacker || !attacker.alive) continue;

      for (const creep of this.creeps) {
        if (!creep.entity.alive || creep.team !== event.targetTeam || creep.state === 'RETURNING') continue;
        if (nowSeconds < creep.aggroLockUntil) continue;
        const distance = planarDistanceToPoint(creep.entity.root, event.attackerPosition.x, event.attackerPosition.z);
        if (distance > LANE_CREEP_TUNING.acquisitionRange) continue;
        if (!this.isVisibleToCreep(creep, attacker)) continue;

        creep.target = attacker;
        creep.state = 'AGGRO';
        creep.aggroLockUntil = nowSeconds + LANE_CREEP_TUNING.aggroLockSeconds;
        creep.nextScanAt = creep.aggroLockUntil;
        this.writeState(creep);
      }
    }
  }

  private updateCreep(creep: LaneCreepRuntime, now: number, dt: number) {
    const { entity } = creep;
    if (!entity.alive || entity.currentHp <= 0) {
      if (creep.deathAt === null) creep.deathAt = now;
      entity.alive = false;
      entity.currentHp = 0;
      entity.root.userData.currentHp = 0;
      entity.root.userData.laneCreepState = 'DEAD';
      return now - creep.deathAt < LANE_CREEP_TUNING.corpseLifetimeSeconds;
    }

    if (creep.state === 'AGGRO' && now >= creep.aggroLockUntil) {
      creep.target = null;
      creep.state = 'ATTACK_MOVE';
      creep.nextScanAt = 0;
      this.writeState(creep);
    }

    if (creep.state === 'RETURNING') {
      this.updateReturning(creep, dt);
      this.animateCreep(creep, now, true);
      return true;
    }

    if (creep.target && !this.isTargetValid(creep, creep.target)) {
      creep.target = null;
      creep.state = 'ATTACK_MOVE';
      creep.nextScanAt = 0;
      this.writeState(creep);
    }

    if (creep.target) {
      const laneDistance = distanceToPolyline(
        entity.root.position.x,
        entity.root.position.z,
        creep.route,
      );
      if (laneDistance > LANE_CREEP_TUNING.leashDistance) {
        this.beginReturning(creep);
        this.animateCreep(creep, now, false);
        return true;
      }

      if (laneDistance > LANE_CREEP_TUNING.laneReturnThreshold) {
        const lastAttackAt = this.attackActivity.get(creep.target.id)?.atSeconds ?? Number.NEGATIVE_INFINITY;
        if (now - lastAttackAt > LANE_CREEP_TUNING.outOfLaneAttackGraceSeconds) {
          this.beginReturning(creep);
          this.animateCreep(creep, now, false);
          return true;
        }
      }
    }

    if (creep.state !== 'AGGRO' && now >= creep.nextScanAt) {
      creep.nextScanAt = now + LANE_CREEP_TUNING.scanIntervalSeconds;
      const target = this.choosePriorityTarget(creep, now);
      creep.target = target;
      creep.state = target ? 'COMBAT' : 'ATTACK_MOVE';
      this.writeState(creep);
    }

    let moving = false;
    if (creep.target) {
      const targetPosition = creep.target.root.getWorldPosition(worldPositionA);
      const distance = Math.hypot(
        targetPosition.x - entity.root.position.x,
        targetPosition.z - entity.root.position.z,
      );
      if (distance <= creep.stats.attackRange) {
        this.facePoint(creep, targetPosition.x, targetPosition.z);
        if (now >= creep.nextAttackAt) this.attackTarget(creep, creep.target, now);
      } else {
        moving = this.moveToward(creep, targetPosition.x, targetPosition.z, dt, true);
      }
    } else {
      moving = this.followLane(creep, dt);
    }

    this.animateCreep(creep, now, moving);
    return true;
  }

  private choosePriorityTarget(creep: LaneCreepRuntime, now: number): GameEntity | null {
    const origin = creep.entity.root.getWorldPosition(worldPositionA);
    let best: { entity: GameEntity; priority: number; hpFraction: number; distance: number } | null = null;

    for (const candidate of this.registry.values()) {
      if (!this.isHostileCombatTarget(creep, candidate)) continue;
      if (!this.isVisibleToCreep(creep, candidate)) continue;

      const position = candidate.root.getWorldPosition(worldPositionB);
      const distance = Math.hypot(position.x - origin.x, position.z - origin.z);
      if (distance > LANE_CREEP_TUNING.acquisitionRange) continue;

      const priority = this.targetPriority(creep, candidate, distance, now);
      if (priority === null) continue;

      const hpFraction = candidate.maxHp > 0
        ? THREE.MathUtils.clamp(candidate.currentHp / candidate.maxHp, 0, 1)
        : 1;
      const score = { entity: candidate, priority, hpFraction, distance };
      if (!best
        || score.priority < best.priority
        || (score.priority === best.priority && score.hpFraction < best.hpFraction - 1e-6)
        || (score.priority === best.priority
          && Math.abs(score.hpFraction - best.hpFraction) <= 1e-6
          && score.distance < best.distance)) {
        best = score;
      }
    }

    return best?.entity ?? null;
  }

  private targetPriority(
    creep: LaneCreepRuntime,
    candidate: GameEntity,
    distance: number,
    now: number,
  ): number | null {
    const activity = this.attackActivity.get(candidate.id);
    const attacked = activity && now - activity.atSeconds <= LANE_CREEP_TUNING.activeAttackWindowSeconds
      ? this.findEntityById(activity.targetId)
      : null;
    const attackingAlly = attacked !== null && attacked.team === creep.team && attacked.alive;

    // Strict priority order from the gameplay specification.
    if (candidate.kind === 'hero' && attackingAlly && attacked?.kind === 'hero') return 1;
    if (candidate.kind === 'creep' && attackingAlly) return 2;
    if (candidate.kind === 'hero' && attackingAlly) return 3;
    if ((candidate.kind === 'tower' || candidate.kind === 'building') && attackingAlly) return 4;

    if (distance > creep.stats.attackRange) return null;
    if (candidate.kind === 'creep') return 5;
    if (candidate.kind === 'hero') return 6;
    if (candidate.kind === 'tower' || candidate.kind === 'building') return 7;
    return null;
  }

  private isHostileCombatTarget(creep: LaneCreepRuntime, target: GameEntity) {
    if (target === creep.entity || !target.alive || target.currentHp <= 0 || target.maxHp <= 0) return false;
    if (target.team === creep.team || target.team === 'neutral') return false;
    if (target.kind === 'shop' || target.kind === 'jungle-creature') return false;

    // `targetable` is player-facing in the current authored map (blue structures are
    // intentionally non-clickable by the blue player). Creeps still need symmetrical
    // combat, so attackable structures are accepted from either faction.
    if (target.kind === 'tower' || target.kind === 'building') {
      return target.interaction === 'attackable-structure';
    }
    return target.targetable;
  }

  private isTargetValid(creep: LaneCreepRuntime, target: GameEntity) {
    return this.isHostileCombatTarget(creep, target)
      && target.root.parent !== null
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

    const attackerPosition = creep.entity.root.getWorldPosition(worldPositionA);
    const targetPosition = target.root.getWorldPosition(worldPositionB);
    publishWorldAttackEvent({
      attackerId: creep.entity.id,
      targetId: target.id,
      attackerTeam: creep.entity.team,
      targetTeam: target.team,
      attackerKind: creep.entity.kind,
      targetKind: target.kind,
      attackerPosition: { x: attackerPosition.x, z: attackerPosition.z },
      targetPosition: { x: targetPosition.x, z: targetPosition.z },
      atMs: performance.now(),
    });

    target.currentHp = Math.max(0, target.currentHp - creep.stats.damage);
    target.root.userData.currentHp = target.currentHp;
    if (target.currentHp <= 0) target.alive = false;

    publishWorldEntityRuntime(target.id, runtimeSnapshot(target));
    emitWorldCombatEvent({
      entityId: target.id,
      reason: target.alive ? 'damage' : 'death',
      currentHp: target.currentHp,
      currentResource: target.currentResource,
      alive: target.alive,
      atMs: performance.now(),
    });

    const model = creep.entity.root.getObjectByName('lane-creep-model');
    if (model) model.scale.set(1.08, 0.94, 1.08);

    if (!target.alive) {
      creep.target = null;
      creep.state = 'ATTACK_MOVE';
      creep.nextScanAt = 0;
      this.writeState(creep);
    }
  }

  private followLane(creep: LaneCreepRuntime, dt: number) {
    if (creep.route.length < 2) return false;
    if (creep.routeIndex >= creep.route.length) creep.routeIndex = creep.route.length - 1;

    let waypoint = creep.route[creep.routeIndex];
    let distance = Math.hypot(
      waypoint[0] - creep.entity.root.position.x,
      waypoint[1] - creep.entity.root.position.z,
    );

    if (distance <= LANE_CREEP_TUNING.laneNodeArrivalDistance && creep.routeIndex < creep.route.length - 1) {
      creep.routeIndex += 1;
      waypoint = creep.route[creep.routeIndex];
      distance = Math.hypot(
        waypoint[0] - creep.entity.root.position.x,
        waypoint[1] - creep.entity.root.position.z,
      );
    }

    if (creep.routeIndex === creep.route.length - 1 && distance <= LANE_CREEP_TUNING.laneNodeArrivalDistance) {
      return false;
    }
    return this.moveToward(creep, waypoint[0], waypoint[1], dt, false);
  }

  private beginReturning(creep: LaneCreepRuntime) {
    creep.target = null;
    creep.state = 'RETURNING';
    creep.aggroLockUntil = 0;
    creep.returnNodeIndex = nearestNodeIndex(
      creep.entity.root.position.x,
      creep.entity.root.position.z,
      creep.route,
    );
    this.writeState(creep);
  }

  private updateReturning(creep: LaneCreepRuntime, dt: number) {
    const node = creep.route[creep.returnNodeIndex] ?? creep.route[0];
    const distance = Math.hypot(
      node[0] - creep.entity.root.position.x,
      node[1] - creep.entity.root.position.z,
    );
    if (distance <= LANE_CREEP_TUNING.laneNodeArrivalDistance) {
      creep.routeIndex = Math.min(creep.route.length - 1, creep.returnNodeIndex + 1);
      creep.state = 'ATTACK_MOVE';
      creep.nextScanAt = 0;
      this.writeState(creep);
      return;
    }
    this.moveToward(creep, node[0], node[1], dt, false);
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
    const distance = Math.hypot(dx, dz);
    if (distance <= 1e-6) return false;

    const travel = Math.min(distance, creep.stats.moveSpeed * dt);
    const nx = dx / distance;
    const nz = dz / distance;
    const nextX = root.position.x + nx * travel;
    const nextZ = root.position.z + nz * travel;

    if (enforceLeash
      && distanceToPolyline(nextX, nextZ, creep.route) > LANE_CREEP_TUNING.leashDistance) {
      this.beginReturning(creep);
      return false;
    }

    root.position.x = nextX;
    root.position.z = nextZ;
    root.position.y = this.sampleSurfaceHeight(nextX, nextZ) + 0.03;
    root.rotation.y = Math.atan2(nx, nz);
    return true;
  }

  private facePoint(creep: LaneCreepRuntime, x: number, z: number) {
    const dx = x - creep.entity.root.position.x;
    const dz = z - creep.entity.root.position.z;
    if (Math.hypot(dx, dz) > 1e-6) creep.entity.root.rotation.y = Math.atan2(dx, dz);
  }

  private animateCreep(creep: LaneCreepRuntime, now: number, moving: boolean) {
    const model = creep.entity.root.getObjectByName('lane-creep-model');
    if (!model) return;
    const desired = moving ? 1 + Math.sin(now * 10 + creep.phase) * 0.035 : 1;
    model.position.y = moving ? Math.abs(Math.sin(now * 8 + creep.phase)) * 0.045 : 0;
    model.scale.x = THREE.MathUtils.lerp(model.scale.x, desired, 0.2);
    model.scale.y = THREE.MathUtils.lerp(model.scale.y, 1, 0.2);
    model.scale.z = THREE.MathUtils.lerp(model.scale.z, desired, 0.2);
  }

  private writeState(creep: LaneCreepRuntime) {
    creep.entity.root.userData.laneCreepState = creep.state;
    creep.entity.root.userData.laneCreepTargetId = creep.target?.id ?? null;
  }

  private sampleSurfaceHeight(x: number, z: number) {
    surfaceRay.ray.origin.set(x, 64, z);
    const hit = surfaceRay.intersectObjects(this.commandSurfaces, false)[0];
    return hit?.point.y ?? 0;
  }

  private findEntityById(id: string) {
    return this.registry.values().find(entity => entity.id === id) ?? null;
  }

  private cleanupCreep(index: number) {
    const creep = this.creeps[index];
    this.registry.unregister(creep.entity.root);
    this.scene.remove(creep.entity.root);
    this.attackActivity.delete(creep.entity.id);
    this.creeps.splice(index, 1);
  }

  private dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    for (let index = this.creeps.length - 1; index >= 0; index--) this.cleanupCreep(index);
    this.resources.dispose();
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

function planarDistanceToPoint(root: THREE.Object3D, x: number, z: number) {
  const position = root.getWorldPosition(worldPositionA);
  return Math.hypot(position.x - x, position.z - z);
}

function nearestNodeIndex(x: number, z: number, route: readonly MapPoint[]) {
  let bestIndex = 0;
  let bestDistance = Infinity;
  route.forEach((point, index) => {
    const distance = Math.hypot(x - point[0], z - point[1]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function distanceToPolyline(x: number, z: number, route: readonly MapPoint[]) {
  let best = Infinity;
  for (let index = 0; index < route.length - 1; index++) {
    const a = route[index];
    const b = route[index + 1];
    const vx = b[0] - a[0];
    const vz = b[1] - a[1];
    const lengthSquared = vx * vx + vz * vz;
    const t = lengthSquared <= 1e-9
      ? 0
      : THREE.MathUtils.clamp(((x - a[0]) * vx + (z - a[1]) * vz) / lengthSquared, 0, 1);
    const px = a[0] + vx * t;
    const pz = a[1] + vz * t;
    best = Math.min(best, Math.hypot(x - px, z - pz));
  }
  return Number.isFinite(best) ? best : 0;
}

type VisualResources = ReturnType<typeof createVisualResources>;

function createVisualResources() {
  const geometries = {
    body: new THREE.CapsuleGeometry(0.28, 0.46, 4, 8),
    head: new THREE.SphereGeometry(0.22, 12, 8),
    shoulder: new THREE.BoxGeometry(0.58, 0.13, 0.22),
    blade: new THREE.BoxGeometry(0.07, 0.06, 0.68),
    staff: new THREE.CylinderGeometry(0.035, 0.035, 0.92, 8),
    flag: new THREE.PlaneGeometry(0.58, 0.38),
    wheel: new THREE.CylinderGeometry(0.22, 0.22, 0.09, 12),
    siegeBody: new THREE.BoxGeometry(0.72, 0.34, 0.92),
    siegeArm: new THREE.BoxGeometry(0.11, 0.11, 0.95),
  };

  const blue = new THREE.MeshStandardMaterial({ color: 0x356fd6, roughness: 0.5, metalness: 0.28 });
  const red = new THREE.MeshStandardMaterial({ color: 0xb84b46, roughness: 0.5, metalness: 0.28 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xb9c4ca, roughness: 0.38, metalness: 0.68 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x22272d, roughness: 0.68, metalness: 0.18 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x69503a, roughness: 0.82, metalness: 0.02 });
  const blueFlag = new THREE.MeshStandardMaterial({ color: 0x4f8cff, side: THREE.DoubleSide, roughness: 0.7 });
  const redFlag = new THREE.MeshStandardMaterial({ color: 0xe0645c, side: THREE.DoubleSide, roughness: 0.7 });
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
  const body = new THREE.Mesh(resources.geometries.body, teamMaterial);
  body.position.y = 0.64;
  body.castShadow = true;
  body.receiveShadow = true;
  model.add(body);

  const head = new THREE.Mesh(resources.geometries.head, resources.materials.steel);
  head.position.y = 1.23;
  head.castShadow = true;
  model.add(head);

  const shoulder = new THREE.Mesh(resources.geometries.shoulder, resources.materials.steel);
  shoulder.position.y = 0.95;
  shoulder.castShadow = true;
  model.add(shoulder);

  if (type === 'melee' || type === 'flagbearer') {
    const blade = new THREE.Mesh(resources.geometries.blade, resources.materials.steel);
    blade.position.set(0.38, 0.72, 0.04);
    blade.rotation.x = Math.PI / 2.7;
    blade.rotation.z = -0.16;
    blade.castShadow = true;
    model.add(blade);
  }

  if (type === 'ranged') {
    const staff = new THREE.Mesh(resources.geometries.staff, resources.materials.wood);
    staff.position.set(0.34, 0.73, 0.02);
    staff.rotation.z = -0.2;
    staff.castShadow = true;
    model.add(staff);
    const focus = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), teamMaterial);
    focus.position.set(0.34, 1.2, 0.02);
    model.add(focus);
  }

  if (type === 'flagbearer') {
    const pole = new THREE.Mesh(resources.geometries.staff, resources.materials.wood);
    pole.scale.y = 1.75;
    pole.position.set(-0.34, 1.05, 0.02);
    pole.castShadow = true;
    model.add(pole);
    const flag = new THREE.Mesh(
      resources.geometries.flag,
      team === 'blue' ? resources.materials.blueFlag : resources.materials.redFlag,
    );
    flag.position.set(-0.05, 1.62, 0.02);
    flag.rotation.y = Math.PI / 2;
    flag.castShadow = true;
    model.add(flag);
  }

  if (type === 'siege') {
    model.remove(body, head, shoulder);
    const chassis = new THREE.Mesh(resources.geometries.siegeBody, resources.materials.wood);
    chassis.position.y = 0.42;
    chassis.castShadow = true;
    chassis.receiveShadow = true;
    model.add(chassis);

    for (const side of [-1, 1]) {
      for (const forward of [-1, 1]) {
        const wheel = new THREE.Mesh(resources.geometries.wheel, resources.materials.dark);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(side * 0.39, 0.26, forward * 0.28);
        wheel.castShadow = true;
        model.add(wheel);
      }
    }

    const arm = new THREE.Mesh(resources.geometries.siegeArm, resources.materials.steel);
    arm.position.set(0, 0.74, -0.18);
    arm.rotation.x = -0.38;
    arm.castShadow = true;
    model.add(arm);

    const crest = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, 0.08), teamMaterial);
    crest.position.set(0, 0.67, 0.49);
    model.add(crest);
  }

  model.scale.setScalar(type === 'siege' ? 0.92 : 0.82);
  return root;
}
