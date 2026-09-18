import * as THREE from 'three';
import { TOWER_GAMEPLAY } from '../gameplay/towerConfig';
import { toMatchGameTimeMs } from '../match/matchPauseRuntime';
import { TEAM_START_BASE_LAYOUT, getTeamStartSpawnPosition } from '../map/mapLayout';
import { getGameEntity, type GameEntity, type GameEntityRegistry, type TeamId } from './gameEntities';
import { calculateTowerAuraAdjustedDamage, updateTowerGameplayAuras } from './towerAuras';
import {
  emitWorldCombatEvent,
  getWorldAttackEventsAfter,
  getWorldEntityRuntime,
  publishWorldAttackEvent,
  publishWorldEntityRuntime,
  type WorldAttackEvent,
} from './worldCombatBridge';

export const TOWER_COMBAT_TUNING = {
  attackIntervalSeconds: TOWER_GAMEPLAY.attack.intervalSeconds,
  acquireWindupSeconds: TOWER_GAMEPLAY.attack.acquireWindupSeconds,
  damage: TOWER_GAMEPLAY.attack.damage,
  projectileSpeed: TOWER_GAMEPLAY.attack.projectileSpeed,
  projectileArcHeight: TOWER_GAMEPLAY.attack.projectileArcHeight,
  aggroEventLifetimeMs: 1600,
  deaggroIgnoreMs: 1600,
  heroRespawnBaseSeconds: 6,
  heroRespawnSecondsPerLevel: 2,
  worldSyncHz: 30,
} as const;

const RESPAWN_AT_KEY = 'dawnreachRespawnAtSeconds';
const RESPAWN_HOLD_KEY = 'dawnreachRespawnHold';
const DEATH_COUNT_KEY = 'dawnreachDeaths';
const DEATH_POSITION_KEY = 'dawnreachDeathPosition';
const RESPAWN_POSITION_KEY = 'dawnreachRespawnPosition';
const LAST_WORLD_SYNC_KEY = 'dawnreachTowerWorldSyncAtSeconds';
const LAST_HERO_DEATH_PRESENTATION_KEY = 'dawnreachHeroDeathPresentationElapsed';
const TRAIL_POINTS = 6;
const PREWARMED_PROJECTILES_PER_TEAM = 4;
const PREWARMED_EFFECTS_PER_TEAM = 10;

type CombatTeam = 'blue' | 'red';
type TowerTargetPriority = 1 | 2 | 3 | 4;

interface TowerCombatState {
  currentTarget: GameEntity | null;
  nextShotAt: number;
  lastElapsed: number;
  lastAggroSequence: number;
  recentAttackByAttacker: Map<string, WorldAttackEvent>;
  deaggroIgnoreUntilByAttacker: Map<string, number>;
  projectiles: TowerProjectile[];
  effects: TowerPulseEffect[];
}

interface TowerProjectile {
  team: CombatTeam;
  root: THREE.Group;
  trail: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  trailPositions: Float32Array;
  source: GameEntity | null;
  target: GameEntity | null;
  initialDistance: number;
  travelled: number;
  spin: number;
}

interface TowerPulseEffect {
  team: CombatTeam;
  root: THREE.Group;
  flash: THREE.Mesh;
  ringMaterial: THREE.MeshBasicMaterial;
  flashMaterial: THREE.MeshBasicMaterial;
  age: number;
  duration: number;
  startScale: number;
  endScale: number;
  ringOpacity: number;
  flashOpacity: number;
}

interface ProjectileResources {
  coreMaterial: THREE.MeshBasicMaterial;
  haloMaterial: THREE.MeshBasicMaterial;
  ringMaterial: THREE.MeshBasicMaterial;
  trailMaterial: THREE.LineBasicMaterial;
}

const towerStates = new WeakMap<THREE.Object3D, TowerCombatState>();
const towerPosition = new THREE.Vector3();
const entityPosition = new THREE.Vector3();
const aimPosition = new THREE.Vector3();
const liftedAimPosition = new THREE.Vector3();
const projectileDirection = new THREE.Vector3();
const projectileOrigin = new THREE.Vector3();
const attackSourcePosition = new THREE.Vector3();
const attackTargetPosition = new THREE.Vector3();

const projectileCoreGeometry = new THREE.OctahedronGeometry(0.14, 0);
const projectileHaloGeometry = new THREE.IcosahedronGeometry(0.22, 1);
const projectileRingGeometry = new THREE.TorusGeometry(0.14, 0.018, 6, 20);
const pulseRingGeometry = new THREE.RingGeometry(0.12, 0.21, 28);
const pulseFlashGeometry = new THREE.IcosahedronGeometry(0.18, 1);

const projectileResources: Record<CombatTeam, ProjectileResources> = {
  blue: createProjectileResources('blue'),
  red: createProjectileResources('red'),
};
const projectilePools: Record<CombatTeam, TowerProjectile[]> = { blue: [], red: [] };
const effectPools: Record<CombatTeam, TowerPulseEffect[]> = { blue: [], red: [] };

for (const team of ['blue', 'red'] as const) {
  for (let index = 0; index < PREWARMED_PROJECTILES_PER_TEAM; index++) {
    projectilePools[team].push(createPooledProjectile(team));
  }
  for (let index = 0; index < PREWARMED_EFFECTS_PER_TEAM; index++) {
    effectPools[team].push(createPooledEffect(team));
  }
}

export function calculateHeroRespawnSeconds(level: number): number {
  const safeLevel = Math.max(1, Math.floor(Number.isFinite(level) ? level : 1));
  return TOWER_COMBAT_TUNING.heroRespawnBaseSeconds
    + safeLevel * TOWER_COMBAT_TUNING.heroRespawnSecondsPerLevel;
}

export function notifyGameEntityAttack(
  attacker: GameEntity,
  target: GameEntity,
  atMs = worldNowMs(),
): WorldAttackEvent {
  attacker.root.getWorldPosition(attackSourcePosition);
  target.root.getWorldPosition(attackTargetPosition);
  return publishWorldAttackEvent({
    attackerId: attacker.id,
    targetId: target.id,
    attackerTeam: attacker.team,
    targetTeam: target.team,
    attackerKind: attacker.kind,
    targetKind: target.kind,
    attackerPosition: { x: attackSourcePosition.x, z: attackSourcePosition.z },
    targetPosition: { x: attackTargetPosition.x, z: attackTargetPosition.z },
    atMs,
  });
}

export function notifyGameEntityAttackByObject(
  attackerObject: THREE.Object3D,
  targetObject: THREE.Object3D,
  atMs = worldNowMs(),
): WorldAttackEvent | null {
  const attacker = getGameEntity(attackerObject);
  const target = getGameEntity(targetObject);
  if (!attacker || !target) return null;
  return notifyGameEntityAttack(attacker, target, atMs);
}

export function updateDefenseTowerCombat(
  tower: THREE.Object3D,
  elapsed: number,
  authoredTeam: CombatTeam,
): void {
  const worldRoot = getWorldRoot(tower);
  const registry = worldRoot.userData.entityRegistry as GameEntityRegistry | undefined;
  if (!registry) return;

  synchronizeWorldRuntime(worldRoot, registry, elapsed);
  updateTowerGameplayAuras(worldRoot, registry, elapsed);
  updateHeroDeathPresentationOnce(worldRoot, registry, elapsed);

  const towerEntity = getGameEntity(tower);
  if (!towerEntity || towerEntity.kind !== 'tower') return;

  const state = getTowerState(tower, elapsed);
  const dt = THREE.MathUtils.clamp(elapsed - state.lastElapsed, 0, 0.05);
  state.lastElapsed = elapsed;

  updatePulseEffects(state, dt);
  updateProjectiles(worldRoot, state, dt, elapsed);

  if (!towerEntity.alive || towerEntity.currentHp <= 0 || towerEntity.attackRange <= 0) {
    state.currentTarget = null;
    return;
  }

  const team = towerEntity.team === 'blue' || towerEntity.team === 'red'
    ? towerEntity.team
    : authoredTeam;
  const nowMs = worldNowMs();

  processAggroEvents(towerEntity, state, team, nowMs);

  if (state.currentTarget && !isValidTowerTarget(towerEntity, state.currentTarget)) {
    state.currentTarget = null;
  }

  const bestTarget = findBestTowerTarget(towerEntity, registry, state, nowMs);
  if (bestTarget) {
    const currentPriority = state.currentTarget
      ? getTowerTargetPriority(towerEntity, state.currentTarget, state, nowMs)
      : null;
    if (
      !state.currentTarget
      || currentPriority === null
      || bestTarget.priority < currentPriority
    ) {
      const changedTarget = state.currentTarget?.id !== bestTarget.entity.id;
      state.currentTarget = bestTarget.entity;
      if (changedTarget) {
        state.nextShotAt = Math.max(
          state.nextShotAt,
          elapsed + TOWER_COMBAT_TUNING.acquireWindupSeconds,
        );
      }
    }
  } else if (!state.currentTarget) {
    state.currentTarget = null;
  }

  if (!state.currentTarget || elapsed < state.nextShotAt) return;

  launchProjectile(worldRoot, tower, team, state.currentTarget, state);
  state.nextShotAt = elapsed + TOWER_COMBAT_TUNING.attackIntervalSeconds;
}

function getTowerState(tower: THREE.Object3D, elapsed: number): TowerCombatState {
  let state = towerStates.get(tower);
  if (!state) {
    state = {
      currentTarget: null,
      nextShotAt: elapsed + TOWER_COMBAT_TUNING.acquireWindupSeconds,
      lastElapsed: elapsed,
      lastAggroSequence: 0,
      recentAttackByAttacker: new Map(),
      deaggroIgnoreUntilByAttacker: new Map(),
      projectiles: [],
      effects: [],
    };
    towerStates.set(tower, state);
  }
  return state;
}

function getWorldRoot(object: THREE.Object3D): THREE.Object3D {
  let current = object;
  while (current.parent) current = current.parent;
  return current;
}

function synchronizeWorldRuntime(
  worldRoot: THREE.Object3D,
  registry: GameEntityRegistry,
  elapsed: number,
): void {
  const lastSync = Number(worldRoot.userData[LAST_WORLD_SYNC_KEY] ?? Number.NEGATIVE_INFINITY);
  const minInterval = 1 / TOWER_COMBAT_TUNING.worldSyncHz;
  if (elapsed >= lastSync && elapsed - lastSync < minInterval) return;
  worldRoot.userData[LAST_WORLD_SYNC_KEY] = elapsed;

  for (const entity of registry.values()) {
    const snapshot = getWorldEntityRuntime(entity.id);

    if (snapshot) {
      entity.level = Math.max(1, Math.floor(snapshot.level));
      entity.maxHp = Math.max(0, snapshot.maxHp);
      entity.currentHp = THREE.MathUtils.clamp(snapshot.currentHp, 0, entity.maxHp);
      entity.maxResource = Math.max(0, snapshot.maxResource);
      entity.currentResource = THREE.MathUtils.clamp(snapshot.currentResource, 0, entity.maxResource);
      entity.alive = snapshot.alive && entity.currentHp > 0;
      entity.root.userData.maxHp = entity.maxHp;
      entity.root.userData.currentHp = entity.currentHp;
    }

    if (
      !entity.alive
      && entity.kind === 'hero'
      && entity.root.userData.networkRemoteHero !== true
      && !hasPendingRespawn(entity)
    ) {
      const respawnSeconds = scheduleHeroRespawn(entity, elapsed);
      emitWorldCombatEvent({
        entityId: entity.id,
        reason: 'death',
        currentHp: 0,
        currentResource: entity.currentResource,
        alive: false,
        atMs: worldNowMs(),
        respawnSeconds,
      });
    }

    if (entity.kind === 'hero') {
      // Remote network heroes are rendered through createDawnreachGame + VisionSystem.
      // Never force their root visible here or fog-of-war is bypassed every world-sync tick.
      if (entity.root.userData.networkRemoteHero === true) continue;
      if (entity.alive) {
        setHeroRenderVisible(entity);
        setHeroStatusOverlayVisible(entity, true);
      } else {
        setHeroRenderVisible(entity);
        setHeroStatusOverlayVisible(entity, false);
        setHeroCorpsePose(entity, true);
        holdDeadHeroAtDeathPosition(entity);
      }
    } else if (!entity.alive) {
      entity.root.visible = false;
    }
  }

  updateHeroRespawns(registry, elapsed);
}

function updateHeroDeathPresentationOnce(
  worldRoot: THREE.Object3D,
  registry: GameEntityRegistry,
  elapsed: number,
): void {
  if (worldRoot.userData[LAST_HERO_DEATH_PRESENTATION_KEY] === elapsed) return;
  worldRoot.userData[LAST_HERO_DEATH_PRESENTATION_KEY] = elapsed;

  for (const entity of registry.values()) {
    if (entity.kind !== 'hero' || entity.root.userData.networkRemoteHero === true) continue;
    if (!entity.alive) {
      holdDeadHeroAtDeathPosition(entity);
      setHeroRenderVisible(entity);
      setHeroStatusOverlayVisible(entity, false);
      setHeroCorpsePose(entity, true);
      continue;
    }

    setHeroRenderVisible(entity);
    setHeroStatusOverlayVisible(entity, true);
    setHeroCorpsePose(entity, false);
  }
}

function updateHeroRespawns(registry: GameEntityRegistry, elapsed: number): void {
  for (const entity of registry.values()) {
    if (entity.kind !== 'hero' || entity.alive || entity.root.userData.networkRemoteHero === true) continue;
    const respawnAt = Number(entity.root.userData[RESPAWN_AT_KEY] ?? Number.POSITIVE_INFINITY);
    if (!Number.isFinite(respawnAt) || elapsed < respawnAt) continue;

    const spawn = getTeamSpawn(entity);
    if (!spawn) continue;

    entity.root.position.set(spawn.x, spawn.y, spawn.z);
    entity.currentHp = entity.maxHp;
    entity.currentResource = entity.maxResource;
    entity.alive = true;
    entity.root.userData[RESPAWN_AT_KEY] = undefined;
    entity.root.userData[RESPAWN_HOLD_KEY] = false;
    entity.root.userData[DEATH_POSITION_KEY] = undefined;
    entity.root.userData.currentHp = entity.currentHp;
    setHeroRenderVisible(entity);
    setHeroStatusOverlayVisible(entity, true);
    setHeroCorpsePose(entity, false);

    publishWorldEntityRuntime(entity.id, {
      level: entity.level,
      maxHp: entity.maxHp,
      currentHp: entity.currentHp,
      maxResource: entity.maxResource,
      currentResource: entity.currentResource,
      alive: true,
    });

    emitWorldCombatEvent({
      entityId: entity.id,
      reason: 'respawn',
      currentHp: entity.currentHp,
      currentResource: entity.currentResource,
      alive: true,
      atMs: worldNowMs(),
    });
  }
}

function holdDeadHeroAtDeathPosition(entity: GameEntity): void {
  if (entity.kind !== 'hero' || entity.alive) return;
  let deathPosition = entity.root.userData[DEATH_POSITION_KEY] as THREE.Vector3 | undefined;
  if (!deathPosition) {
    deathPosition = entity.root.position.clone();
    entity.root.userData[DEATH_POSITION_KEY] = deathPosition;
  }
  entity.root.position.copy(deathPosition);
}

function getHeroModel(entity: GameEntity): THREE.Object3D | null {
  if (entity.kind !== 'hero') return null;
  const expectedModelName = `${entity.root.name}-model`;
  return entity.root.getObjectByName(expectedModelName)
    ?? entity.root.children.find(child => child.name.endsWith('-model'))
    ?? null;
}

function setHeroRenderVisible(entity: GameEntity): void {
  if (entity.kind !== 'hero') return;
  entity.root.visible = true;
  const model = getHeroModel(entity);
  if (model) model.visible = true;
}

function setHeroStatusOverlayVisible(entity: GameEntity, visible: boolean): void {
  if (entity.kind !== 'hero') return;
  const overlay = entity.root.getObjectByName('hero-status-overlay');
  if (!(overlay instanceof THREE.Sprite)) return;
  const material = overlay.material;
  if (material instanceof THREE.SpriteMaterial) {
    material.transparent = true;
    material.opacity = visible ? 1 : 0;
  }
}

function setHeroCorpsePose(entity: GameEntity, dead: boolean): void {
  const model = getHeroModel(entity);
  if (!model) return;
  model.rotation.x = dead ? -Math.PI * 0.48 : 0;
}

function getTeamSpawn(entity: GameEntity): { x: number; y: number; z: number } | null {
  const authored = entity.root.userData[RESPAWN_POSITION_KEY] as
    | { x?: unknown; y?: unknown; z?: unknown }
    | undefined;
  if (
    authored
    && Number.isFinite(Number(authored.x))
    && Number.isFinite(Number(authored.y))
    && Number.isFinite(Number(authored.z))
  ) {
    return {
      x: Number(authored.x),
      y: Number(authored.y),
      z: Number(authored.z),
    };
  }

  if (entity.team !== 'blue' && entity.team !== 'red') return null;
  const spawn = getTeamStartSpawnPosition(entity.team);
  return {
    x: spawn.x,
    y: TEAM_START_BASE_LAYOUT.elevation + 0.03,
    z: spawn.z,
  };
}

function scheduleHeroRespawn(entity: GameEntity, elapsed: number): number {
  const respawnSeconds = calculateHeroRespawnSeconds(entity.level);
  entity.root.userData[RESPAWN_AT_KEY] = elapsed + respawnSeconds;
  entity.root.userData[RESPAWN_HOLD_KEY] = false;
  entity.root.userData[DEATH_POSITION_KEY] = entity.root.position.clone();
  entity.root.userData[DEATH_COUNT_KEY] = Number(entity.root.userData[DEATH_COUNT_KEY] ?? 0) + 1;
  setHeroRenderVisible(entity);
  setHeroStatusOverlayVisible(entity, false);
  setHeroCorpsePose(entity, true);
  return respawnSeconds;
}

function hasPendingRespawn(entity: GameEntity): boolean {
  return Number.isFinite(Number(entity.root.userData[RESPAWN_AT_KEY]));
}

function processAggroEvents(
  tower: GameEntity,
  state: TowerCombatState,
  team: CombatTeam,
  nowMs: number,
): void {
  const events = getWorldAttackEventsAfter(state.lastAggroSequence);
  tower.root.getWorldPosition(towerPosition);

  for (const event of events) {
    state.lastAggroSequence = Math.max(state.lastAggroSequence, event.sequence);
    if (nowMs - event.atMs > TOWER_COMBAT_TUNING.aggroEventLifetimeMs) continue;
    if (event.attackerTeam === team || event.attackerTeam === 'neutral') continue;

    const attackerWasInRange = planarDistanceSquared(
      towerPosition.x,
      towerPosition.z,
      event.attackerPosition.x,
      event.attackerPosition.z,
    ) <= tower.attackRange * tower.attackRange;
    if (!attackerWasInRange) continue;

    state.recentAttackByAttacker.set(event.attackerId, event);

    // A hero that issues A + click on an allied unit requests de-aggro. The command
    // itself is enough; it does not need to deal damage to the ally.
    const requestedDeaggro = event.attackerKind === 'hero'
      && event.targetTeam === event.attackerTeam;
    if (requestedDeaggro) {
      state.deaggroIgnoreUntilByAttacker.set(
        event.attackerId,
        nowMs + TOWER_COMBAT_TUNING.deaggroIgnoreMs,
      );
      if (state.currentTarget?.id === event.attackerId) state.currentTarget = null;
    }
  }

  for (const [attackerId, event] of state.recentAttackByAttacker) {
    if (nowMs - event.atMs > TOWER_COMBAT_TUNING.aggroEventLifetimeMs) {
      state.recentAttackByAttacker.delete(attackerId);
    }
  }
  for (const [attackerId, ignoreUntil] of state.deaggroIgnoreUntilByAttacker) {
    if (nowMs >= ignoreUntil) state.deaggroIgnoreUntilByAttacker.delete(attackerId);
  }
}

function getTowerTargetPriority(
  tower: GameEntity,
  candidate: GameEntity,
  state: TowerCombatState,
  nowMs: number,
): TowerTargetPriority | null {
  if (!isValidTowerTarget(tower, candidate)) return null;
  if ((state.deaggroIgnoreUntilByAttacker.get(candidate.id) ?? 0) > nowMs) return null;

  const attack = state.recentAttackByAttacker.get(candidate.id);
  if (!attack || nowMs - attack.atMs > TOWER_COMBAT_TUNING.aggroEventLifetimeMs) return 4;

  // Priority 1: enemy actively attacking an allied hero.
  if (attack.targetTeam === tower.team && attack.targetKind === 'hero') return 1;
  // Priority 2: enemy actively attacking this tower.
  if (attack.targetId === tower.id) return 2;
  // Priority 3: enemy actively attacking any other allied unit.
  if (attack.targetTeam === tower.team) return 3;
  // Priority 4: nearest hostile unit in general.
  return 4;
}

function findBestTowerTarget(
  tower: GameEntity,
  registry: GameEntityRegistry,
  state: TowerCombatState,
  nowMs: number,
): { entity: GameEntity; priority: TowerTargetPriority; distanceSquared: number } | null {
  tower.root.getWorldPosition(towerPosition);
  let best: { entity: GameEntity; priority: TowerTargetPriority; distanceSquared: number } | null = null;

  for (const candidate of registry.values()) {
    const priority = getTowerTargetPriority(tower, candidate, state, nowMs);
    if (priority === null) continue;
    candidate.root.getWorldPosition(entityPosition);
    const distanceSquared = planarDistanceSquared(
      towerPosition.x,
      towerPosition.z,
      entityPosition.x,
      entityPosition.z,
    );
    if (
      best
      && (priority > best.priority || (priority === best.priority && distanceSquared >= best.distanceSquared))
    ) continue;
    best = { entity: candidate, priority, distanceSquared };
  }

  return best;
}

function isHostileUnitTarget(tower: GameEntity, target: GameEntity): boolean {
  if (!target.alive || target.currentHp <= 0 || target.maxHp <= 0) return false;
  if (target.team === tower.team || target.team === 'neutral') return false;
  return target.kind !== 'tower' && target.kind !== 'building' && target.kind !== 'shop';
}

function isValidTowerTarget(tower: GameEntity, target: GameEntity): boolean {
  if (!isHostileUnitTarget(tower, target)) return false;
  tower.root.getWorldPosition(towerPosition);
  target.root.getWorldPosition(entityPosition);
  return planarDistanceSquared(
    towerPosition.x,
    towerPosition.z,
    entityPosition.x,
    entityPosition.z,
  ) <= tower.attackRange * tower.attackRange;
}

function createProjectileResources(team: CombatTeam): ProjectileResources {
  const palette = projectilePalette(team);
  return {
    coreMaterial: new THREE.MeshBasicMaterial({
      color: palette.core,
      toneMapped: false,
    }),
    haloMaterial: new THREE.MeshBasicMaterial({
      color: palette.halo,
      transparent: true,
      opacity: 0.24,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
    ringMaterial: new THREE.MeshBasicMaterial({
      color: palette.trim,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
    trailMaterial: new THREE.LineBasicMaterial({
      color: palette.halo,
      transparent: true,
      opacity: 0.58,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  };
}

function createPooledProjectile(team: CombatTeam): TowerProjectile {
  const resources = projectileResources[team];
  const root = new THREE.Group();
  root.name = `${team}-tower-projectile`;

  const core = new THREE.Mesh(projectileCoreGeometry, resources.coreMaterial);
  core.scale.set(0.82, 0.82, 1.7);
  root.add(core);

  const halo = new THREE.Mesh(projectileHaloGeometry, resources.haloMaterial);
  halo.scale.set(0.78, 0.78, 1.42);
  root.add(halo);

  const ring = new THREE.Mesh(projectileRingGeometry, resources.ringMaterial);
  ring.position.z = -0.02;
  root.add(ring);

  const trailPositions = new Float32Array(TRAIL_POINTS * 3);
  const trailGeometry = new THREE.BufferGeometry();
  const trailAttribute = new THREE.BufferAttribute(trailPositions, 3);
  trailAttribute.setUsage(THREE.DynamicDrawUsage);
  trailGeometry.setAttribute('position', trailAttribute);
  const trail = new THREE.Line(trailGeometry, resources.trailMaterial);
  trail.frustumCulled = false;

  return {
    team,
    root,
    trail,
    trailPositions,
    source: null,
    target: null,
    initialDistance: 1,
    travelled: 0,
    spin: 0,
  };
}

function acquireProjectile(team: CombatTeam): TowerProjectile {
  return projectilePools[team].pop() ?? createPooledProjectile(team);
}

function releaseProjectile(projectile: TowerProjectile): void {
  projectile.root.removeFromParent();
  projectile.trail.removeFromParent();
  projectile.source = null;
  projectile.target = null;
  projectile.travelled = 0;
  projectile.spin = 0;
  projectilePools[projectile.team].push(projectile);
}

function launchProjectile(
  worldRoot: THREE.Object3D,
  tower: THREE.Object3D,
  team: CombatTeam,
  target: GameEntity,
  state: TowerCombatState,
): void {
  const source = tower.userData.projectileOrigin as THREE.Object3D | undefined;
  (source ?? tower).getWorldPosition(projectileOrigin);
  getEntityAimPosition(target, aimPosition);

  const projectile = acquireProjectile(team);
  projectile.source = getGameEntity(tower);
  projectile.target = target;
  projectile.root.position.copy(projectileOrigin);
  projectile.root.rotation.set(0, 0, 0);
  projectile.initialDistance = Math.max(0.25, projectileOrigin.distanceTo(aimPosition));
  projectile.travelled = 0;
  projectile.spin = 0;
  resetTrail(projectile, projectileOrigin);

  worldRoot.add(projectile.trail);
  worldRoot.add(projectile.root);
  state.projectiles.push(projectile);
  state.effects.push(acquirePulseEffect(worldRoot, projectileOrigin, team, false));
}

function updateProjectiles(
  worldRoot: THREE.Object3D,
  state: TowerCombatState,
  dt: number,
  elapsed: number,
): void {
  if (dt <= 0) return;
  const step = TOWER_COMBAT_TUNING.projectileSpeed * dt;

  for (let index = state.projectiles.length - 1; index >= 0; index--) {
    const projectile = state.projectiles[index];
    const target = projectile.target;
    if (!target || !target.alive || target.currentHp <= 0) {
      releaseProjectile(projectile);
      state.projectiles.splice(index, 1);
      continue;
    }

    getEntityAimPosition(target, aimPosition);
    const distance = projectile.root.position.distanceTo(aimPosition);

    if (distance <= Math.max(0.16, step)) {
      projectile.root.position.copy(aimPosition);
      const impactTeam: CombatTeam = target.team === 'blue' ? 'red' : 'blue';
      state.effects.push(acquirePulseEffect(worldRoot, aimPosition, impactTeam, true));
      applyTowerProjectileDamage(projectile.source, target, elapsed);
      if (state.currentTarget?.id === target.id && !target.alive) {
        state.currentTarget = null;
      }
      releaseProjectile(projectile);
      state.projectiles.splice(index, 1);
      continue;
    }

    projectile.travelled += step;
    const progress = THREE.MathUtils.clamp(projectile.travelled / projectile.initialDistance, 0, 1);
    liftedAimPosition.copy(aimPosition);
    liftedAimPosition.y += Math.sin(progress * Math.PI) * TOWER_COMBAT_TUNING.projectileArcHeight;
    projectileDirection.copy(liftedAimPosition).sub(projectile.root.position).normalize();
    projectile.root.position.addScaledVector(projectileDirection, step);
    projectile.root.lookAt(liftedAimPosition);
    projectile.spin += dt * 2.7;
    projectile.root.rotateZ(projectile.spin);
    pushTrailPoint(projectile, projectile.root.position);
  }
}

function resetTrail(projectile: TowerProjectile, point: THREE.Vector3): void {
  const positions = projectile.trailPositions;
  for (let index = 0; index < TRAIL_POINTS; index++) {
    const offset = index * 3;
    positions[offset] = point.x;
    positions[offset + 1] = point.y;
    positions[offset + 2] = point.z;
  }
  (projectile.trail.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
}

function pushTrailPoint(projectile: TowerProjectile, point: THREE.Vector3): void {
  const positions = projectile.trailPositions;
  for (let index = TRAIL_POINTS - 1; index > 0; index--) {
    const to = index * 3;
    const from = (index - 1) * 3;
    positions[to] = positions[from];
    positions[to + 1] = positions[from + 1];
    positions[to + 2] = positions[from + 2];
  }
  positions[0] = point.x;
  positions[1] = point.y;
  positions[2] = point.z;
  (projectile.trail.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
}

function applyTowerProjectileDamage(source: GameEntity | null, target: GameEntity, elapsed: number): void {
  if (!target.alive || target.currentHp <= 0) return;

  // Lane creeps are simulated by one multiplayer authority. A replica client may still render
  // the tower projectile, but mutating a replicated creep here causes the next authoritative
  // creep snapshot to "heal" it back to its previous HP.
  if (target.kind === 'creep' && target.root.userData.networkReplica === true) return;

  const damage = calculateTowerAuraAdjustedDamage(source, target, TOWER_COMBAT_TUNING.damage);
  target.currentHp = Math.max(0, target.currentHp - damage);
  target.alive = target.currentHp > 0;
  target.root.userData.currentHp = target.currentHp;
  target.root.userData.alive = target.alive;

  // Tower damage must immediately become the world-runtime truth. synchronizeWorldRuntime()
  // reads this bridge at 30 Hz; without publishing here it restores the pre-hit creep HP on
  // the very next tower update, producing the visible damage -> heal loop.
  publishWorldEntityRuntime(target.id, {
    level: target.level,
    maxHp: target.maxHp,
    currentHp: target.currentHp,
    maxResource: target.maxResource,
    currentResource: target.currentResource,
    alive: target.alive,
  });

  if (target.currentHp > 0) {
    emitWorldCombatEvent({
      entityId: target.id,
      reason: 'damage',
      currentHp: target.currentHp,
      alive: true,
      atMs: worldNowMs(),
      amount: damage,
      sourceEntityId: source?.id,
    });
    return;
  }

  if (target.kind === 'hero') {
    setHeroRenderVisible(target);
    setHeroStatusOverlayVisible(target, false);
    setHeroCorpsePose(target, true);
  } else {
    target.root.visible = false;
  }
  const respawnSeconds = target.kind === 'hero' ? scheduleHeroRespawn(target, elapsed) : undefined;

  emitWorldCombatEvent({
    entityId: target.id,
    reason: 'death',
    currentHp: 0,
    alive: false,
    atMs: worldNowMs(),
    respawnSeconds,
    amount: damage,
    sourceEntityId: source?.id,
  });
}

function createPooledEffect(team: CombatTeam): TowerPulseEffect {
  const palette = projectilePalette(team);
  const root = new THREE.Group();

  const ringMaterial = new THREE.MeshBasicMaterial({
    color: palette.trim,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const ring = new THREE.Mesh(pulseRingGeometry, ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  root.add(ring);

  const flashMaterial = new THREE.MeshBasicMaterial({
    color: palette.halo,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const flash = new THREE.Mesh(pulseFlashGeometry, flashMaterial);
  root.add(flash);

  return {
    team,
    root,
    flash,
    ringMaterial,
    flashMaterial,
    age: 0,
    duration: 0.2,
    startScale: 1,
    endScale: 2,
    ringOpacity: 0.72,
    flashOpacity: 0.4,
  };
}

function acquirePulseEffect(
  worldRoot: THREE.Object3D,
  position: THREE.Vector3,
  team: TeamId,
  impact: boolean,
): TowerPulseEffect {
  const visualTeam: CombatTeam = team === 'red' ? 'red' : 'blue';
  const effect = effectPools[visualTeam].pop() ?? createPooledEffect(visualTeam);
  effect.root.name = impact
    ? `${visualTeam}-tower-impact`
    : `${visualTeam}-tower-muzzle-flash`;
  effect.root.position.copy(position);
  effect.root.scale.setScalar(impact ? 0.8 : 0.65);
  effect.flash.scale.setScalar(impact ? 1 : 0.67);
  effect.age = 0;
  effect.duration = impact ? 0.30 : 0.18;
  effect.startScale = impact ? 0.8 : 0.65;
  effect.endScale = impact ? 2.8 : 2.0;
  effect.ringOpacity = 0.72;
  effect.flashOpacity = impact ? 0.52 : 0.38;
  effect.ringMaterial.opacity = effect.ringOpacity;
  effect.flashMaterial.opacity = effect.flashOpacity;
  worldRoot.add(effect.root);
  return effect;
}

function updatePulseEffects(state: TowerCombatState, dt: number): void {
  for (let index = state.effects.length - 1; index >= 0; index--) {
    const effect = state.effects[index];
    effect.age += dt;
    const progress = THREE.MathUtils.clamp(effect.age / effect.duration, 0, 1);
    const scale = THREE.MathUtils.lerp(effect.startScale, effect.endScale, progress);
    effect.root.scale.setScalar(scale);
    effect.ringMaterial.opacity = (1 - progress) * effect.ringOpacity;
    effect.flashMaterial.opacity = (1 - progress) * effect.flashOpacity;
    if (progress < 1) continue;
    releasePulseEffect(effect);
    state.effects.splice(index, 1);
  }
}

function releasePulseEffect(effect: TowerPulseEffect): void {
  effect.root.removeFromParent();
  effect.ringMaterial.opacity = 0;
  effect.flashMaterial.opacity = 0;
  effectPools[effect.team].push(effect);
}

function getEntityAimPosition(entity: GameEntity, out: THREE.Vector3): THREE.Vector3 {
  entity.root.getWorldPosition(out);
  const lift = entity.kind === 'hero'
    ? Math.max(0.72, entity.visionHeight * 0.54)
    : Math.max(0.42, entity.visionHeight * 0.42);
  out.y += lift;
  return out;
}

function projectilePalette(team: CombatTeam) {
  return team === 'blue'
    ? { core: 0x73def4, halo: 0xa9f2ff, trim: 0xe0c281 }
    : { core: 0xf26058, halo: 0xff9a8e, trim: 0xc98359 };
}

function planarDistanceSquared(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

function worldNowMs(): number {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return toMatchGameTimeMs(now);
}
