import * as THREE from 'three';
import type { GameEntity, GameEntityRegistry, TeamId } from '../entities/gameEntities';
import { DAWNREACH_LAYOUT, type MapPoint } from '../map/mapLayout';
import { getTowerTierConfig, normalizeTowerTier, type TowerTier } from './towerConfig';

export type TowerLane = 'top' | 'mid' | 'bot';

const CONFIGURED_TOWER_COUNT = new WeakMap<GameEntityRegistry, number>();
const worldPosition = new THREE.Vector3();

function distancePointToSegment(
  x: number,
  z: number,
  a: MapPoint,
  b: MapPoint,
): number {
  const vx = b[0] - a[0];
  const vz = b[1] - a[1];
  const lengthSquared = vx * vx + vz * vz;
  if (lengthSquared <= 1e-9) return Math.hypot(x - a[0], z - a[1]);
  const t = THREE.MathUtils.clamp(((x - a[0]) * vx + (z - a[1]) * vz) / lengthSquared, 0, 1);
  return Math.hypot(x - (a[0] + vx * t), z - (a[1] + vz * t));
}

function distanceToLane(x: number, z: number, lane: readonly MapPoint[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < lane.length - 1; index++) {
    best = Math.min(best, distancePointToSegment(x, z, lane[index], lane[index + 1]));
  }
  return best;
}

function inferLane(entity: GameEntity): TowerLane {
  const name = entity.root.name.toLowerCase();
  const named = name.match(/-(top|mid|bot)(?:-|$)/)?.[1] as TowerLane | undefined;
  if (named) return named;

  entity.root.getWorldPosition(worldPosition);
  const candidates = (Object.entries(DAWNREACH_LAYOUT.lanes) as Array<[TowerLane, readonly MapPoint[]]>)
    .map(([lane, points]) => ({ lane, distance: distanceToLane(worldPosition.x, worldPosition.z, points) }))
    .sort((a, b) => a.distance - b.distance);
  return candidates[0]?.lane ?? 'mid';
}

function teamBase(team: TeamId) {
  return team === 'red' ? DAWNREACH_LAYOUT.redBase : DAWNREACH_LAYOUT.blueBase;
}

function distanceToOwnBase(entity: GameEntity): number {
  const base = teamBase(entity.team);
  entity.root.getWorldPosition(worldPosition);
  return Math.hypot(worldPosition.x - base.x, worldPosition.z - base.z);
}

function applyTier(entity: GameEntity, tier: TowerTier, lane: TowerLane | null) {
  const config = getTowerTierConfig(tier);
  const previousMaxHp = Math.max(0, entity.maxHp);
  const hpFraction = previousMaxHp > 0
    ? THREE.MathUtils.clamp(entity.currentHp / previousMaxHp, 0, 1)
    : 1;

  entity.level = tier;
  entity.maxHp = config.maxHp;
  entity.currentHp = entity.alive ? config.maxHp * hpFraction : 0;
  entity.targetable = true;
  entity.root.userData.towerTier = tier;
  entity.root.userData.towerLane = lane;
  entity.root.userData.towerBaseArmor = config.baseArmor;
  entity.root.userData.towerDamageMin = config.damageMin;
  entity.root.userData.towerDamageMax = config.damageMax;
  entity.root.userData.towerDenyThresholdHp = Math.floor(config.maxHp * 0.1);
  entity.root.userData.maxHp = entity.maxHp;
  entity.root.userData.currentHp = entity.currentHp;

  const faction = entity.team === 'blue' ? 'Dawn' : entity.team === 'red' ? 'Dusk' : 'Neutral';
  const location = tier === 4 ? 'Throne' : lane ? lane.charAt(0).toUpperCase() + lane.slice(1) : 'Defense';
  entity.displayName = `${faction} ${location} Tier ${tier} Tower`;
}

export function configureTowerTiers(registry: GameEntityRegistry): void {
  const towers = registry.values().filter(entity => entity.kind === 'tower' && entity.team !== 'neutral');
  if (
    CONFIGURED_TOWER_COUNT.get(registry) === towers.length
    && towers.every(tower => Number.isInteger(tower.root.userData.towerTier))
  ) return;

  for (const team of ['blue', 'red'] as const) {
    const teamTowers = towers.filter(tower => tower.team === team);
    const laneTowers = new Map<TowerLane, GameEntity[]>();

    for (const tower of teamTowers) {
      const role = String(tower.root.userData.role ?? '');
      if (role === 'throne') {
        applyTier(tower, 4, null);
        continue;
      }
      if (role === 'gate') {
        applyTier(tower, 3, inferLane(tower));
        continue;
      }

      const lane = inferLane(tower);
      const bucket = laneTowers.get(lane) ?? [];
      bucket.push(tower);
      laneTowers.set(lane, bucket);
    }

    for (const [lane, candidates] of laneTowers) {
      candidates.sort((a, b) => distanceToOwnBase(a) - distanceToOwnBase(b));
      candidates.forEach((tower, index) => applyTier(tower, index === 0 ? 2 : 1, lane));
    }
  }

  CONFIGURED_TOWER_COUNT.set(registry, towers.length);
  refreshTowerVulnerabilityFlags(registry);
}

export function getTowerTier(entity: GameEntity): TowerTier {
  return normalizeTowerTier(Number(entity.root.userData.towerTier ?? entity.level));
}

export function getTowerLane(entity: GameEntity): TowerLane | null {
  const lane = entity.root.userData.towerLane;
  return lane === 'top' || lane === 'mid' || lane === 'bot' ? lane : null;
}

function sameLanePredecessor(
  tower: GameEntity,
  registry: GameEntityRegistry,
  predecessorTier: TowerTier,
): GameEntity | null {
  const lane = getTowerLane(tower);
  if (!lane) return null;
  return registry.values().find(candidate => (
    candidate.kind === 'tower'
    && candidate.team === tower.team
    && getTowerTier(candidate) === predecessorTier
    && getTowerLane(candidate) === lane
  )) ?? null;
}

export function isTowerTierVulnerable(tower: GameEntity, registry: GameEntityRegistry): boolean {
  if (tower.kind !== 'tower') return true;
  const tier = getTowerTier(tower);
  if (tier === 1) return true;

  if (tier === 2 || tier === 3) {
    const predecessor = sameLanePredecessor(tower, registry, (tier - 1) as TowerTier);
    return predecessor ? !predecessor.alive || predecessor.currentHp <= 0 : true;
  }

  // Tier 4 towers become vulnerable as soon as one lane has been opened by destroying
  // its Tier 3 tower. The other Tier 3 towers do not need to be destroyed first.
  const tierThreeTowers = registry.values().filter(candidate => (
    candidate.kind === 'tower'
    && candidate.team === tower.team
    && getTowerTier(candidate) === 3
  ));
  return tierThreeTowers.length === 0
    || tierThreeTowers.some(candidate => !candidate.alive || candidate.currentHp <= 0);
}

export function refreshTowerVulnerabilityFlags(registry: GameEntityRegistry): void {
  for (const tower of registry.values()) {
    if (tower.kind !== 'tower') continue;
    tower.root.userData.towerTierVulnerable = isTowerTierVulnerable(tower, registry);
  }
}

function isBarracks(entity: GameEntity) {
  const definition = entity.definitionId?.toLowerCase() ?? '';
  const role = String(entity.root.userData.role ?? '').toLowerCase();
  return definition.includes('barracks') || role.includes('barracks');
}

export function getTowerEffectiveArmor(tower: GameEntity, registry?: GameEntityRegistry): number {
  const tier = getTowerTier(tower);
  const config = getTowerTierConfig(tier);
  if (tier !== 4 || !registry || config.barracksArmorPerAliveBarracks <= 0) return config.baseArmor;

  const aliveBarracks = registry.values().filter(entity => (
    entity.team === tower.team
    && entity.kind === 'building'
    && entity.alive
    && entity.currentHp > 0
    && isBarracks(entity)
  )).length;
  return config.baseArmor + aliveBarracks * config.barracksArmorPerAliveBarracks;
}

export function getTowerDenyThresholdHp(tower: GameEntity): number {
  return Math.floor(getTowerTierConfig(getTowerTier(tower)).maxHp * 0.1);
}

export type TowerObjectiveProgressionState = {
  glyphResetRevision: Record<'blue' | 'red', number>;
  processedTierOneDeaths: Set<string>;
};

const OBJECTIVE_STATE_KEY = 'dawnreachTowerObjectiveProgression';

export function updateTowerObjectiveProgression(
  worldRoot: THREE.Object3D,
  registry: GameEntityRegistry,
): TowerObjectiveProgressionState {
  let state = worldRoot.userData[OBJECTIVE_STATE_KEY] as TowerObjectiveProgressionState | undefined;
  if (!state) {
    state = {
      glyphResetRevision: { blue: 0, red: 0 },
      processedTierOneDeaths: new Set<string>(),
    };
    worldRoot.userData[OBJECTIVE_STATE_KEY] = state;
  }

  for (const tower of registry.values()) {
    if (tower.kind !== 'tower' || getTowerTier(tower) !== 1 || tower.alive || tower.currentHp > 0) continue;
    if (state.processedTierOneDeaths.has(tower.id)) continue;
    state.processedTierOneDeaths.add(tower.id);
    if (tower.team === 'blue' || tower.team === 'red') {
      state.glyphResetRevision[tower.team] += 1;
      tower.root.userData.glyphFortificationResetTriggered = true;
    }
  }

  refreshTowerVulnerabilityFlags(registry);
  return state;
}
