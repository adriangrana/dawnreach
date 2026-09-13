import * as THREE from 'three';
import { DAWNREACH_LAYOUT } from '../map/mapLayout';
import { getGameEntity, type GameEntity, type GameEntityRegistry, type TeamId } from './gameEntities';
import {
  emitWorldCombatEvent,
  getWorldAttackEventsAfter,
  getWorldEntityRuntime,
  publishWorldAttackEvent,
  type WorldAttackEvent,
} from './worldCombatBridge';

export const TOWER_COMBAT_TUNING = {
  attackIntervalSeconds: 1.0,
  acquireWindupSeconds: 0.18,
  damage: 165,
  projectileSpeed: 13.5,
  projectileArcHeight: 0.72,
  aggroEventLifetimeMs: 1600,
  heroRespawnBaseSeconds: 6,
  heroRespawnSecondsPerLevel: 2,
} as const;

const RESPAWN_AT_KEY = 'dawnreachRespawnAtSeconds';
const RESPAWN_HOLD_KEY = 'dawnreachRespawnHold';
const RESPAWN_RELEASE_KEY = 'dawnreachRespawnReleaseInstalled';
const DEATH_COUNT_KEY = 'dawnreachDeaths';
const LAST_WORLD_SYNC_KEY = 'dawnreachTowerWorldSyncElapsed';

const towerStates = new WeakMap<THREE.Object3D, TowerCombatState>();
const towerPosition = new THREE.Vector3();
const entityPosition = new THREE.Vector3();
const aimPosition = new THREE.Vector3();
const projectileDirection = new THREE.Vector3();

interface TowerCombatState {
  currentTarget: GameEntity | null;
  pendingPriorityTargetIds: string[];
  nextShotAt: number;
  lastElapsed: number;
  lastAggroSequence: number;
  projectiles: TowerProjectile[];
  effects: TowerPulseEffect[];
}

interface TowerProjectile {
  root: THREE.Group;
  trail: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  target: GameEntity;
  history: THREE.Vector3[];
  initialDistance: number;
  travelled: number;
  spin: number;
}

interface TowerPulseEffect {
  root: THREE.Group;
  materials: THREE.MeshBasicMaterial[];
  age: number;
  duration: number;
  startScale: number;
  endScale: number;
}

export function calculateHeroRespawnSeconds(level: number): number {
  const safeLevel = Math.max(1, Math.floor(Number.isFinite(level) ? level : 1));
  return TOWER_COMBAT_TUNING.heroRespawnBaseSeconds
    + safeLevel * TOWER_COMBAT_TUNING.heroRespawnSecondsPerLevel;
}

/**
 * Unit combat should call this whenever an entity commits an attack. Tower aggro consumes
 * these world-space events without coupling the tower AI to a specific hero implementation.
 */
export function notifyGameEntityAttack(
  attacker: GameEntity,
  target: GameEntity,
  atMs = worldNowMs(),
): WorldAttackEvent {
  const attackerWorld = attacker.root.getWorldPosition(new THREE.Vector3());
  const targetWorld = target.root.getWorldPosition(new THREE.Vector3());
  return publishWorldAttackEvent({
    attackerId: attacker.id,
    targetId: target.id,
    attackerTeam: attacker.team,
    targetTeam: target.team,
    attackerKind: attacker.kind,
    targetKind: target.kind,
    attackerPosition: { x: attackerWorld.x, z: attackerWorld.z },
    targetPosition: { x: targetWorld.x, z: targetWorld.z },
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
  authoredTeam: 'blue' | 'red',
): void {
  const worldRoot = getWorldRoot(tower);
  const registry = worldRoot.userData.entityRegistry as GameEntityRegistry | undefined;
  if (!registry) return;

  synchronizeWorldRuntimeOnce(worldRoot, registry, elapsed);

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

  processAggroEvents(towerEntity, registry, state, team);

  if (state.currentTarget && !isValidTowerTarget(towerEntity, state.currentTarget)) {
    state.currentTarget = null;
  }

  if (!state.currentTarget) {
    state.currentTarget = takePriorityTarget(towerEntity, registry, state)
      ?? findNearestTowerTarget(towerEntity, registry);
    if (state.currentTarget) {
      state.nextShotAt = Math.max(state.nextShotAt, elapsed + TOWER_COMBAT_TUNING.acquireWindupSeconds);
    }
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
      pendingPriorityTargetIds: [],
      nextShotAt: elapsed + TOWER_COMBAT_TUNING.acquireWindupSeconds,
      lastElapsed: elapsed,
      lastAggroSequence: 0,
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

function synchronizeWorldRuntimeOnce(
  worldRoot: THREE.Object3D,
  registry: GameEntityRegistry,
  elapsed: number,
): void {
  if (worldRoot.userData[LAST_WORLD_SYNC_KEY] === elapsed) return;
  worldRoot.userData[LAST_WORLD_SYNC_KEY] = elapsed;

  for (const entity of registry.values()) {
    const snapshot = getWorldEntityRuntime(entity.id);
    const wasAlive = entity.alive;

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

    if (wasAlive && !entity.alive && entity.kind === 'hero' && !hasPendingRespawn(entity)) {
      scheduleHeroRespawn(entity, elapsed);
    }

    if (!entity.alive) entity.root.visible = false;
  }

  updateHeroRespawns(registry, elapsed);
  enforceRespawnHolds(registry);
}

function updateHeroRespawns(registry: GameEntityRegistry, elapsed: number): void {
  for (const entity of registry.values()) {
    if (entity.kind !== 'hero' || entity.alive) continue;
    const respawnAt = Number(entity.root.userData[RESPAWN_AT_KEY] ?? Number.POSITIVE_INFINITY);
    if (!Number.isFinite(respawnAt) || elapsed < respawnAt) continue;

    const spawn = getTeamSpawn(entity.team);
    if (!spawn) continue;

    entity.root.position.set(spawn.x, 0.03, spawn.z);
    entity.currentHp = entity.maxHp;
    entity.currentResource = entity.maxResource;
    entity.alive = true;
    entity.root.visible = true;
    entity.root.userData[RESPAWN_AT_KEY] = undefined;
    entity.root.userData[RESPAWN_HOLD_KEY] = true;
    entity.root.userData.currentHp = entity.currentHp;
    installRespawnCommandRelease(entity);

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

function enforceRespawnHolds(registry: GameEntityRegistry): void {
  for (const entity of registry.values()) {
    if (entity.kind !== 'hero' || !entity.alive || entity.root.userData[RESPAWN_HOLD_KEY] !== true) continue;
    const spawn = getTeamSpawn(entity.team);
    if (!spawn) continue;
    entity.root.position.set(spawn.x, 0.03, spawn.z);
    entity.root.visible = true;
  }
}

function installRespawnCommandRelease(entity: GameEntity): void {
  if (typeof window === 'undefined' || entity.root.userData[RESPAWN_RELEASE_KEY] === true) return;
  entity.root.userData[RESPAWN_RELEASE_KEY] = true;

  const release = (event: PointerEvent) => {
    if (event.button !== 0 && event.button !== 2) return;
    const target = event.target;
    if (!(target instanceof Element) || !target.closest('.game-canvas, .minimap-live')) return;
    entity.root.userData[RESPAWN_HOLD_KEY] = false;
    entity.root.userData[RESPAWN_RELEASE_KEY] = false;
    window.removeEventListener('pointerdown', release, true);
  };

  window.addEventListener('pointerdown', release, true);
}

function getTeamSpawn(team: TeamId): { x: number; z: number } | null {
  if (team === 'blue') return DAWNREACH_LAYOUT.blueSpawn;
  if (team === 'red') return DAWNREACH_LAYOUT.redSpawn;
  return null;
}

function scheduleHeroRespawn(entity: GameEntity, elapsed: number): number {
  const respawnSeconds = calculateHeroRespawnSeconds(entity.level);
  entity.root.userData[RESPAWN_AT_KEY] = elapsed + respawnSeconds;
  entity.root.userData[RESPAWN_HOLD_KEY] = false;
  entity.root.userData[DEATH_COUNT_KEY] = Number(entity.root.userData[DEATH_COUNT_KEY] ?? 0) + 1;
  return respawnSeconds;
}

function hasPendingRespawn(entity: GameEntity): boolean {
  return Number.isFinite(Number(entity.root.userData[RESPAWN_AT_KEY]));
}

function processAggroEvents(
  tower: GameEntity,
  registry: GameEntityRegistry,
  state: TowerCombatState,
  team: 'blue' | 'red',
): void {
  const events = getWorldAttackEventsAfter(state.lastAggroSequence);
  if (events.length === 0) return;

  tower.root.getWorldPosition(towerPosition);
  const nowMs = worldNowMs();

  for (const event of events) {
    state.lastAggroSequence = Math.max(state.lastAggroSequence, event.sequence);
    if (nowMs - event.atMs > TOWER_COMBAT_TUNING.aggroEventLifetimeMs) continue;

    const attackerWasInRange = planarDistanceSquared(
      towerPosition.x,
      towerPosition.z,
      event.attackerPosition.x,
      event.attackerPosition.z,
    ) <= tower.attackRange * tower.attackRange;
    if (!attackerWasInRange) continue;

    const hostileHeroAttackedAlliedHero = event.attackerKind === 'hero'
      && event.targetKind === 'hero'
      && event.attackerTeam !== team
      && event.attackerTeam !== 'neutral'
      && event.targetTeam === team
      && planarDistanceSquared(
        towerPosition.x,
        towerPosition.z,
        event.targetPosition.x,
        event.targetPosition.z,
      ) <= tower.attackRange * tower.attackRange;

    if (hostileHeroAttackedAlliedHero && state.currentTarget?.id !== event.attackerId) {
      if (!state.pendingPriorityTargetIds.includes(event.attackerId)) {
        state.pendingPriorityTargetIds.push(event.attackerId);
      }
    }

    const currentHeroRequestedDeaggro = state.currentTarget?.id === event.attackerId
      && event.attackerKind === 'hero'
      && event.attackerTeam !== team
      && event.attackerTeam !== 'neutral'
      && event.targetTeam === event.attackerTeam;

    if (!currentHeroRequestedDeaggro) continue;

    state.pendingPriorityTargetIds = state.pendingPriorityTargetIds.filter(id => id !== event.attackerId);
    const replacement = takePriorityTarget(tower, registry, state, event.attackerId)
      ?? findNearestTowerTarget(tower, registry, event.attackerId);
    if (replacement) state.currentTarget = replacement;
  }
}

function takePriorityTarget(
  tower: GameEntity,
  registry: GameEntityRegistry,
  state: TowerCombatState,
  excludedId?: string,
): GameEntity | null {
  while (state.pendingPriorityTargetIds.length > 0) {
    const id = state.pendingPriorityTargetIds.shift()!;
    if (id === excludedId) continue;
    const entity = registry.values().find(candidate => candidate.id === id);
    if (entity && isValidTowerTarget(tower, entity)) return entity;
  }
  return null;
}

function findNearestTowerTarget(
  tower: GameEntity,
  registry: GameEntityRegistry,
  excludedId?: string,
): GameEntity | null {
  tower.root.getWorldPosition(towerPosition);
  let nearest: GameEntity | null = null;
  let nearestDistanceSquared = Number.POSITIVE_INFINITY;

  for (const candidate of registry.values()) {
    if (candidate.id === excludedId || !isValidTowerTarget(tower, candidate)) continue;
    candidate.root.getWorldPosition(entityPosition);
    const distanceSquared = planarDistanceSquared(
      towerPosition.x,
      towerPosition.z,
      entityPosition.x,
      entityPosition.z,
    );
    if (distanceSquared < nearestDistanceSquared) {
      nearest = candidate;
      nearestDistanceSquared = distanceSquared;
    }
  }
  return nearest;
}

function isValidTowerTarget(tower: GameEntity, target: GameEntity): boolean {
  if (!target.alive || target.currentHp <= 0 || target.maxHp <= 0) return false;
  if (target.team === tower.team || target.team === 'neutral') return false;
  if (target.kind === 'tower' || target.kind === 'building' || target.kind === 'shop') return false;

  tower.root.getWorldPosition(towerPosition);
  target.root.getWorldPosition(entityPosition);
  return planarDistanceSquared(
    towerPosition.x,
    towerPosition.z,
    entityPosition.x,
    entityPosition.z,
  ) <= tower.attackRange * tower.attackRange;
}

function launchProjectile(
  worldRoot: THREE.Object3D,
  tower: THREE.Object3D,
  team: 'blue' | 'red',
  target: GameEntity,
  state: TowerCombatState,
): void {
  const source = tower.userData.projectileOrigin as THREE.Object3D | undefined;
  const origin = (source ?? tower).getWorldPosition(new THREE.Vector3());
  const targetAim = getEntityAimPosition(target, new THREE.Vector3());
  const palette = projectilePalette(team);

  const root = new THREE.Group();
  root.name = `${team}-tower-projectile`;
  root.position.copy(origin);

  const coreMaterial = new THREE.MeshPhysicalMaterial({
    color: palette.core,
    emissive: palette.emissive,
    emissiveIntensity: 1.75,
    roughness: 0.14,
    metalness: 0.04,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    toneMapped: false,
  });
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.14, 0), coreMaterial);
  core.scale.set(0.82, 0.82, 1.7);
  root.add(core);

  const haloMaterial = new THREE.MeshBasicMaterial({
    color: palette.halo,
    transparent: true,
    opacity: 0.24,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const halo = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), haloMaterial);
  halo.scale.set(0.78, 0.78, 1.42);
  root.add(halo);

  const ringMaterial = new THREE.MeshBasicMaterial({
    color: palette.trim,
    transparent: true,
    opacity: 0.72,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.018, 6, 20), ringMaterial);
  ring.position.z = -0.02;
  root.add(ring);

  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6 * 3), 3));
  const trailMaterial = new THREE.LineBasicMaterial({
    color: palette.halo,
    transparent: true,
    opacity: 0.58,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const trail = new THREE.Line(trailGeometry, trailMaterial);
  trail.frustumCulled = false;
  worldRoot.add(trail);
  worldRoot.add(root);

  const history = Array.from({ length: 6 }, () => origin.clone());
  writeTrail(trail, history);

  state.projectiles.push({
    root,
    trail,
    target,
    history,
    initialDistance: Math.max(0.25, origin.distanceTo(targetAim)),
    travelled: 0,
    spin: 0,
  });

  state.effects.push(createPulseEffect(worldRoot, origin, team, false));
}

function updateProjectiles(
  worldRoot: THREE.Object3D,
  state: TowerCombatState,
  dt: number,
  elapsed: number,
): void {
  for (let index = state.projectiles.length - 1; index >= 0; index--) {
    const projectile = state.projectiles[index];
    if (!projectile.target.alive || projectile.target.currentHp <= 0) {
      disposeProjectile(projectile);
      state.projectiles.splice(index, 1);
      continue;
    }

    const targetAim = getEntityAimPosition(projectile.target, aimPosition);
    const distance = projectile.root.position.distanceTo(targetAim);
    const step = TOWER_COMBAT_TUNING.projectileSpeed * dt;

    if (distance <= Math.max(0.16, step)) {
      projectile.root.position.copy(targetAim);
      const impactTeam = projectile.target.team === 'blue' ? 'red' : 'blue';
      state.effects.push(createPulseEffect(worldRoot, targetAim, impactTeam, true));
      applyTowerProjectileDamage(projectile.target, elapsed);
      if (state.currentTarget?.id === projectile.target.id && !projectile.target.alive) {
        state.currentTarget = null;
      }
      disposeProjectile(projectile);
      state.projectiles.splice(index, 1);
      continue;
    }

    projectile.travelled += step;
    const progress = THREE.MathUtils.clamp(projectile.travelled / projectile.initialDistance, 0, 1);
    const liftedAim = targetAim.clone();
    liftedAim.y += Math.sin(progress * Math.PI) * TOWER_COMBAT_TUNING.projectileArcHeight;
    projectileDirection.copy(liftedAim).sub(projectile.root.position).normalize();
    projectile.root.position.addScaledVector(projectileDirection, step);
    projectile.root.lookAt(liftedAim);
    projectile.spin += dt * 7.5;
    projectile.root.rotateZ(projectile.spin * 0.035);

    projectile.history.unshift(projectile.root.position.clone());
    projectile.history.length = 6;
    writeTrail(projectile.trail, projectile.history);
  }
}

function applyTowerProjectileDamage(target: GameEntity, elapsed: number): void {
  if (!target.alive || target.currentHp <= 0) return;

  target.currentHp = Math.max(0, target.currentHp - TOWER_COMBAT_TUNING.damage);
  target.root.userData.currentHp = target.currentHp;

  if (target.currentHp > 0) {
    emitWorldCombatEvent({
      entityId: target.id,
      reason: 'damage',
      currentHp: target.currentHp,
      alive: true,
      atMs: worldNowMs(),
    });
    return;
  }

  target.alive = false;
  target.root.visible = false;
  const respawnSeconds = target.kind === 'hero' ? scheduleHeroRespawn(target, elapsed) : undefined;

  emitWorldCombatEvent({
    entityId: target.id,
    reason: 'death',
    currentHp: 0,
    alive: false,
    atMs: worldNowMs(),
    respawnSeconds,
  });
}

function updatePulseEffects(state: TowerCombatState, dt: number): void {
  for (let index = state.effects.length - 1; index >= 0; index--) {
    const effect = state.effects[index];
    effect.age += dt;
    const progress = THREE.MathUtils.clamp(effect.age / effect.duration, 0, 1);
    const scale = THREE.MathUtils.lerp(effect.startScale, effect.endScale, progress);
    effect.root.scale.setScalar(scale);
    for (const material of effect.materials) material.opacity = (1 - progress) * 0.72;
    if (progress < 1) continue;
    disposeObject(effect.root);
    state.effects.splice(index, 1);
  }
}

function createPulseEffect(
  worldRoot: THREE.Object3D,
  position: THREE.Vector3,
  team: TeamId,
  impact: boolean,
): TowerPulseEffect {
  const visualTeam = team === 'red' ? 'red' : 'blue';
  const palette = projectilePalette(visualTeam);
  const root = new THREE.Group();
  root.name = impact ? `${visualTeam}-tower-impact` : `${visualTeam}-tower-muzzle-flash`;
  root.position.copy(position);

  const ringMaterial = new THREE.MeshBasicMaterial({
    color: palette.trim,
    transparent: true,
    opacity: 0.72,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.21, 28), ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  root.add(ring);

  const flashMaterial = new THREE.MeshBasicMaterial({
    color: palette.halo,
    transparent: true,
    opacity: impact ? 0.52 : 0.38,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const flash = new THREE.Mesh(new THREE.IcosahedronGeometry(impact ? 0.18 : 0.12, 1), flashMaterial);
  root.add(flash);
  worldRoot.add(root);

  return {
    root,
    materials: [ringMaterial, flashMaterial],
    age: 0,
    duration: impact ? 0.30 : 0.18,
    startScale: impact ? 0.8 : 0.65,
    endScale: impact ? 2.8 : 2.0,
  };
}

function writeTrail(
  trail: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>,
  history: readonly THREE.Vector3[],
): void {
  const attribute = trail.geometry.getAttribute('position') as THREE.BufferAttribute;
  for (let index = 0; index < 6; index++) {
    const point = history[Math.min(index, history.length - 1)] ?? history[0];
    attribute.setXYZ(index, point.x, point.y, point.z);
  }
  attribute.needsUpdate = true;
  trail.geometry.computeBoundingSphere();
}

function disposeProjectile(projectile: TowerProjectile): void {
  disposeObject(projectile.root);
  projectile.trail.removeFromParent();
  projectile.trail.geometry.dispose();
  projectile.trail.material.dispose();
}

function disposeObject(root: THREE.Object3D): void {
  root.removeFromParent();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
}

function getEntityAimPosition(entity: GameEntity, out: THREE.Vector3): THREE.Vector3 {
  entity.root.getWorldPosition(out);
  const lift = entity.kind === 'hero'
    ? Math.max(0.72, entity.visionHeight * 0.54)
    : Math.max(0.42, entity.visionHeight * 0.42);
  out.y += lift;
  return out;
}

function projectilePalette(team: 'blue' | 'red') {
  return team === 'blue'
    ? { core: 0x73def4, emissive: 0x1d93b8, halo: 0xa9f2ff, trim: 0xe0c281 }
    : { core: 0xf26058, emissive: 0xb62b25, halo: 0xff9a8e, trim: 0xc98359 };
}

function planarDistanceSquared(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
}

function worldNowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
