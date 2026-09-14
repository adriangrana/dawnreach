import * as THREE from 'three';
import { TOWER_GAMEPLAY, getTowerAbility, getTowerTierConfig, rollTowerAttackDamage } from '../gameplay/towerConfig';
import {
  configureTowerTiers,
  getTowerEffectiveArmor,
  getTowerTier,
  isTowerTierVulnerable,
  updateTowerObjectiveProgression,
} from '../gameplay/towerRules';
import type { GameEntity, GameEntityKind, GameEntityRegistry, TeamId } from './gameEntities';
import { emitWorldCombatEvent, getWorldEntityRuntime } from './worldCombatBridge';

const AURA_STATE_KEY = 'dawnreachTowerAuraState';
const LAST_AURA_UPDATE_KEY = 'dawnreachTowerAuraUpdateAt';
const LAST_DAMAGE_AT_KEY = 'dawnreachTowerLastDamageAtMs';
const AURA_UPDATE_INTERVAL_SECONDS = 0.1;
const TRUE_SIGHT_BLUE_KEY = 'dawnreachTrueSightBlue';
const TRUE_SIGHT_RED_KEY = 'dawnreachTrueSightRed';

const towerPosition = new THREE.Vector3();
const entityPosition = new THREE.Vector3();
const creepPosition = new THREE.Vector3();

type BackdoorEffects = {
  damageReductionPercent: number;
  healthRegenPerSecond: number;
  disabledByEnemyCreepRadius: number;
};

type TowerProtectionAuraEffects = {
  statusName: string;
  eligibleKinds: string[];
  armorBonus: number;
  healthRegenPerSecond: number;
  lingerDurationSeconds: number;
};

type ReinforcedEffects = {
  bonusDamageVsReinforcedPercent: number;
  heroAttackDamageReductionPercent: number;
  nonHeroAttackDamageReductionPercent: number;
  aura: TowerProtectionAuraEffects;
};

type TowerAbilityWithEffects<T> = {
  id: string;
  name: string;
  englishName: string;
  type: string;
  level: number;
  description: string;
  eligibleKinds: string[];
  effects: T;
};

const BACKDOOR = getTowerAbility('backdoor-protection') as TowerAbilityWithEffects<BackdoorEffects>;
const TOWER_PROTECTION = getTowerAbility('reinforced') as TowerAbilityWithEffects<ReinforcedEffects>;

export type TowerAuraState = Readonly<{
  /** Structural marker retained for compatibility with existing HUD/status views. */
  reinforced: boolean;
  /** Allied-unit aura granted by a nearby tower. */
  towerProtection: boolean;
  towerProtectionExpiresAtMs: number | null;
  towerProtectionSourceTowerIds: readonly string[];
  /** Backdoor Protection belongs to Tier 2-4 towers only. */
  backdoorProtection: boolean;
  backdoorActive: boolean;
  /** Every living tower projects True Sight. */
  trueSight: boolean;
  trueSightRadius: number;
  sourceTowerIds: readonly string[];
  backdoorSourceTowerIds: readonly string[];
}>;

type MutableTowerAuraState = {
  reinforced: boolean;
  towerProtection: boolean;
  towerProtectionExpiresAtMs: number | null;
  towerProtectionSourceTowerIds: string[];
  backdoorProtection: boolean;
  backdoorActive: boolean;
  trueSight: boolean;
  trueSightRadius: number;
  sourceTowerIds: string[];
  backdoorSourceTowerIds: string[];
};

const EMPTY_AURA_STATE: TowerAuraState = Object.freeze({
  reinforced: false,
  towerProtection: false,
  towerProtectionExpiresAtMs: null,
  towerProtectionSourceTowerIds: Object.freeze([]) as readonly string[],
  backdoorProtection: false,
  backdoorActive: false,
  trueSight: false,
  trueSightRadius: 0,
  sourceTowerIds: Object.freeze([]) as readonly string[],
  backdoorSourceTowerIds: Object.freeze([]) as readonly string[],
});

function worldNowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function createMutableAuraState(entity: GameEntity, atMs: number): MutableTowerAuraState {
  const previous = getTowerAuraState(entity);
  const lingeringProtection = previous.towerProtection
    && previous.towerProtectionExpiresAtMs != null
    && previous.towerProtectionExpiresAtMs > atMs;

  return {
    reinforced: false,
    towerProtection: lingeringProtection,
    towerProtectionExpiresAtMs: lingeringProtection ? previous.towerProtectionExpiresAtMs : null,
    towerProtectionSourceTowerIds: lingeringProtection ? [...previous.towerProtectionSourceTowerIds] : [],
    backdoorProtection: false,
    backdoorActive: false,
    trueSight: false,
    trueSightRadius: 0,
    sourceTowerIds: [],
    backdoorSourceTowerIds: [],
  };
}

function isEligible(kind: GameEntityKind, eligibleKinds: readonly string[]) {
  return eligibleKinds.includes(kind);
}

function planarDistanceSquared(a: THREE.Vector3, b: THREE.Vector3) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function hasEnemyCreepNearTower(
  tower: GameEntity,
  registry: GameEntityRegistry,
  radius: number,
): boolean {
  tower.root.getWorldPosition(towerPosition);
  const radiusSquared = radius * radius;
  for (const candidate of registry.values()) {
    if (candidate.kind !== 'creep' || !candidate.alive || candidate.currentHp <= 0) continue;
    if (candidate.team === tower.team || candidate.team === 'neutral') continue;
    candidate.root.getWorldPosition(creepPosition);
    if (planarDistanceSquared(towerPosition, creepPosition) <= radiusSquared) return true;
  }
  return false;
}

function armorDamageMultiplier(armor: number): number {
  if (!Number.isFinite(armor) || armor === 0) return 1;
  const reduction = (0.06 * armor) / (1 + 0.06 * Math.abs(armor));
  return Math.max(0, 1 - reduction);
}

function getWorldRoot(object: THREE.Object3D): THREE.Object3D {
  let current = object;
  while (current.parent) current = current.parent;
  return current;
}

function registryFor(entity: GameEntity): GameEntityRegistry | undefined {
  return getWorldRoot(entity.root).userData.entityRegistry as GameEntityRegistry | undefined;
}

function isEthereal(entity: GameEntity): boolean {
  if (entity.root.userData.ethereal === true) return true;
  const runtime = getWorldEntityRuntime(entity.id);
  return runtime?.statuses?.some(status => (
    status.id.toLowerCase().includes('ethereal')
    || status.data?.ethereal === true
    || status.data?.ghostForm === true
  )) ?? false;
}

function towerSelfRegenPerSecond(entity: GameEntity, state: TowerAuraState, atMs: number): number {
  if (entity.kind !== 'tower') return 0;
  const tierConfig = getTowerTierConfig(getTowerTier(entity));
  let regen = state.backdoorActive ? BACKDOOR.effects.healthRegenPerSecond : 0;
  if (tierConfig.outOfCombatRegenPerSecond > 0) {
    const lastDamageAt = Number(entity.root.userData[LAST_DAMAGE_AT_KEY] ?? Number.NEGATIVE_INFINITY);
    const outOfCombatMs = TOWER_GAMEPLAY.outOfCombatDelaySeconds * 1000;
    if (!Number.isFinite(lastDamageAt) || atMs - lastDamageAt >= outOfCombatMs) {
      regen += tierConfig.outOfCombatRegenPerSecond;
    }
  }
  return regen;
}

function clearTrueSightFlags(entities: readonly GameEntity[]) {
  for (const entity of entities) {
    entity.root.userData[TRUE_SIGHT_BLUE_KEY] = false;
    entity.root.userData[TRUE_SIGHT_RED_KEY] = false;
  }
}

function projectTrueSight(tower: GameEntity, entities: readonly GameEntity[]) {
  const radius = TOWER_GAMEPLAY.vision.trueSightRadius;
  const radiusSquared = radius * radius;
  tower.root.getWorldPosition(towerPosition);
  const key = tower.team === 'blue' ? TRUE_SIGHT_BLUE_KEY : TRUE_SIGHT_RED_KEY;
  for (const candidate of entities) {
    if (!candidate.alive || candidate.team === tower.team || candidate.team === 'neutral') continue;
    candidate.root.getWorldPosition(entityPosition);
    if (planarDistanceSquared(towerPosition, entityPosition) <= radiusSquared) {
      candidate.root.userData[key] = true;
    }
  }
}

export function getTowerAuraState(entity: GameEntity | null): TowerAuraState {
  if (!entity) return EMPTY_AURA_STATE;
  return (entity.root.userData[AURA_STATE_KEY] as TowerAuraState | undefined) ?? EMPTY_AURA_STATE;
}

export function isEntityRevealedByTowerTrueSight(entity: GameEntity, team: TeamId): boolean {
  if (team === 'blue') return entity.root.userData[TRUE_SIGHT_BLUE_KEY] === true;
  if (team === 'red') return entity.root.userData[TRUE_SIGHT_RED_KEY] === true;
  return false;
}

export function updateTowerGameplayAuras(
  worldRoot: THREE.Object3D,
  registry: GameEntityRegistry,
  elapsed: number,
): void {
  configureTowerTiers(registry);
  updateTowerObjectiveProgression(worldRoot, registry);

  const previousUpdate = Number(worldRoot.userData[LAST_AURA_UPDATE_KEY] ?? Number.NEGATIVE_INFINITY);
  if (Number.isFinite(previousUpdate) && elapsed >= previousUpdate && elapsed - previousUpdate < AURA_UPDATE_INTERVAL_SECONDS) {
    return;
  }

  const dt = Number.isFinite(previousUpdate)
    ? THREE.MathUtils.clamp(elapsed - previousUpdate, 0, 0.25)
    : 0;
  worldRoot.userData[LAST_AURA_UPDATE_KEY] = elapsed;

  const atMs = worldNowMs();
  const entities = registry.values();
  const states = new Map<GameEntity, MutableTowerAuraState>();
  for (const entity of entities) states.set(entity, createMutableAuraState(entity, atMs));
  clearTrueSightFlags(entities);

  const auraRadiusSquared = TOWER_GAMEPLAY.auraRadius * TOWER_GAMEPLAY.auraRadius;
  const protectionLingerMs = Math.max(0, TOWER_PROTECTION.effects.aura.lingerDurationSeconds * 1000);

  for (const tower of entities) {
    if (tower.kind !== 'tower' || !tower.alive || tower.currentHp <= 0) continue;
    if (tower.team === 'neutral') continue;

    tower.root.getWorldPosition(towerPosition);
    const towerState = states.get(tower)!;
    const tierConfig = getTowerTierConfig(getTowerTier(tower));

    towerState.reinforced = true;
    towerState.sourceTowerIds.push(tower.id);
    towerState.trueSight = true;
    towerState.trueSightRadius = TOWER_GAMEPLAY.vision.trueSightRadius;
    tower.root.userData.trueSightRadius = TOWER_GAMEPLAY.vision.trueSightRadius;
    projectTrueSight(tower, entities);

    if (tierConfig.backdoorProtection && isEligible(tower.kind, BACKDOOR.eligibleKinds)) {
      towerState.backdoorProtection = true;
      towerState.backdoorSourceTowerIds.push(tower.id);
      towerState.backdoorActive = !hasEnemyCreepNearTower(
        tower,
        registry,
        BACKDOOR.effects.disabledByEnemyCreepRadius,
      );
    }

    for (const ally of entities) {
      if (!ally.alive || ally.currentHp <= 0 || ally.team !== tower.team) continue;
      if (!isEligible(ally.kind, TOWER_PROTECTION.effects.aura.eligibleKinds)) continue;
      ally.root.getWorldPosition(entityPosition);
      if (planarDistanceSquared(towerPosition, entityPosition) > auraRadiusSquared) continue;

      const state = states.get(ally)!;
      state.towerProtection = true;
      state.towerProtectionExpiresAtMs = atMs + protectionLingerMs;
      if (!state.towerProtectionSourceTowerIds.includes(tower.id)) {
        state.towerProtectionSourceTowerIds.push(tower.id);
      }
    }
  }

  for (const entity of entities) {
    const state = states.get(entity)!;
    if (state.towerProtectionExpiresAtMs != null && state.towerProtectionExpiresAtMs <= atMs) {
      state.towerProtection = false;
      state.towerProtectionExpiresAtMs = null;
      state.towerProtectionSourceTowerIds.length = 0;
    }

    const frozenState = Object.freeze({
      reinforced: state.reinforced,
      towerProtection: state.towerProtection,
      towerProtectionExpiresAtMs: state.towerProtectionExpiresAtMs,
      towerProtectionSourceTowerIds: Object.freeze([...state.towerProtectionSourceTowerIds]),
      backdoorProtection: state.backdoorProtection,
      backdoorActive: state.backdoorActive,
      trueSight: state.trueSight,
      trueSightRadius: state.trueSightRadius,
      sourceTowerIds: Object.freeze([...state.sourceTowerIds]),
      backdoorSourceTowerIds: Object.freeze([...state.backdoorSourceTowerIds]),
    }) satisfies TowerAuraState;
    entity.root.userData[AURA_STATE_KEY] = frozenState;

    if (dt <= 0 || entity.maxHp <= 0 || entity.currentHp <= 0 || entity.currentHp >= entity.maxHp) continue;

    const regenPerSecond = towerSelfRegenPerSecond(entity, frozenState, atMs)
      + (frozenState.towerProtection ? TOWER_PROTECTION.effects.aura.healthRegenPerSecond : 0);
    if (regenPerSecond <= 0) continue;

    const healedHp = Math.min(entity.maxHp, entity.currentHp + regenPerSecond * dt);
    if (healedHp <= entity.currentHp) continue;
    entity.currentHp = healedHp;
    entity.root.userData.currentHp = healedHp;
    emitWorldCombatEvent({
      entityId: entity.id,
      reason: 'heal',
      currentHp: healedHp,
      alive: true,
      atMs,
    });
  }
}

export function calculateTowerAuraAdjustedDamage(
  source: GameEntity | null,
  target: GameEntity,
  baseDamage: number,
): number {
  const registry = registryFor(target);
  if (registry) configureTowerTiers(registry);

  if (target.kind === 'tower' && registry && !isTowerTierVulnerable(target, registry)) {
    target.root.userData.towerTierVulnerable = false;
    return 0;
  }

  let damage = source?.kind === 'tower'
    ? rollTowerAttackDamage(getTowerTier(source))
    : Math.max(0, baseDamage);

  const targetAura = getTowerAuraState(target);

  // Tower shots are physical and pierce debuff/magic immunity. Ethereal targets are the
  // intentional exception and take no physical tower damage.
  if (source?.kind === 'tower') {
    if (isEthereal(target)) return 0;
    const authoredArmor = Number(target.root.userData.physicalArmor ?? 0);
    const auraArmor = targetAura.towerProtection ? TOWER_PROTECTION.effects.aura.armorBonus : 0;
    damage *= armorDamageMultiplier(authoredArmor + auraArmor);
  } else if (targetAura.towerProtection) {
    damage *= armorDamageMultiplier(TOWER_PROTECTION.effects.aura.armorBonus);
  }

  if (target.kind === 'tower') {
    const effectiveArmor = getTowerEffectiveArmor(target, registry);
    damage *= armorDamageMultiplier(effectiveArmor);
    if (targetAura.backdoorActive) {
      damage *= Math.max(0, 1 - BACKDOOR.effects.damageReductionPercent / 100);
    }
    if (damage > 0) target.root.userData[LAST_DAMAGE_AT_KEY] = worldNowMs();
  }

  return Math.max(0, damage);
}

export function getTowerBackdoorRegenPerSecond(entity: GameEntity): number {
  if (entity.kind !== 'tower') return 0;
  return towerSelfRegenPerSecond(entity, getTowerAuraState(entity), worldNowMs());
}

export function getTowerProtectionArmorBonus(entity: GameEntity): number {
  return getTowerAuraState(entity).towerProtection ? TOWER_PROTECTION.effects.aura.armorBonus : 0;
}

export function getTowerProtectionRegenPerSecond(entity: GameEntity): number {
  return getTowerAuraState(entity).towerProtection ? TOWER_PROTECTION.effects.aura.healthRegenPerSecond : 0;
}
