import * as THREE from 'three';
import { TOWER_GAMEPLAY, getTowerAbility } from '../gameplay/towerConfig';
import type { GameEntity, GameEntityKind, GameEntityRegistry } from './gameEntities';
import { emitWorldCombatEvent } from './worldCombatBridge';

const AURA_STATE_KEY = 'dawnreachTowerAuraState';
const LAST_AURA_UPDATE_KEY = 'dawnreachTowerAuraUpdateAt';
const AURA_UPDATE_INTERVAL_SECONDS = 0.1;

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
const REINFORCED = getTowerAbility('reinforced') as TowerAbilityWithEffects<ReinforcedEffects>;

export type TowerAuraState = Readonly<{
  /** Structural Reinforced passive. This belongs to the tower itself. */
  reinforced: boolean;
  /** Short allied-unit aura granted by a nearby tower. */
  towerProtection: boolean;
  towerProtectionExpiresAtMs: number | null;
  towerProtectionSourceTowerIds: readonly string[];
  /** Backdoor Protection belongs to the tower itself and is never shared. */
  backdoorProtection: boolean;
  backdoorActive: boolean;
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

export function getTowerAuraState(entity: GameEntity | null): TowerAuraState {
  if (!entity) return EMPTY_AURA_STATE;
  return (entity.root.userData[AURA_STATE_KEY] as TowerAuraState | undefined) ?? EMPTY_AURA_STATE;
}

export function updateTowerGameplayAuras(
  worldRoot: THREE.Object3D,
  registry: GameEntityRegistry,
  elapsed: number,
): void {
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

  const auraRadiusSquared = TOWER_GAMEPLAY.auraRadius * TOWER_GAMEPLAY.auraRadius;
  const protectionLingerMs = Math.max(0, REINFORCED.effects.aura.lingerDurationSeconds * 1000);

  for (const tower of entities) {
    if (tower.kind !== 'tower' || !tower.alive || tower.currentHp <= 0) continue;
    if (tower.team === 'neutral') continue;

    tower.root.getWorldPosition(towerPosition);
    const towerState = states.get(tower)!;

    // Reinforced is a structural passive of the tower itself. It is not copied to
    // nearby heroes or creeps; those units receive the distinct Tower Protection aura.
    if (isEligible(tower.kind, REINFORCED.eligibleKinds)) {
      towerState.reinforced = true;
      towerState.sourceTowerIds.push(tower.id);
    }

    // Backdoor Protection is self-only. Enemy creeps suppress this tower's own
    // reduction/regeneration but never create/remove a buff on nearby allies.
    if (isEligible(tower.kind, BACKDOOR.eligibleKinds)) {
      towerState.backdoorProtection = true;
      towerState.backdoorSourceTowerIds.push(tower.id);
      towerState.backdoorActive = !hasEnemyCreepNearTower(
        tower,
        registry,
        BACKDOOR.effects.disabledByEnemyCreepRadius,
      );
    }

    // Reforzado projects Protección de Torre to eligible allied units. Refreshing the
    // modifier every aura tick gives it the authored 0.5 s linger after leaving range.
    for (const ally of entities) {
      if (!ally.alive || ally.currentHp <= 0 || ally.team !== tower.team) continue;
      if (!isEligible(ally.kind, REINFORCED.effects.aura.eligibleKinds)) continue;
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

    entity.root.userData[AURA_STATE_KEY] = Object.freeze({
      reinforced: state.reinforced,
      towerProtection: state.towerProtection,
      towerProtectionExpiresAtMs: state.towerProtectionExpiresAtMs,
      towerProtectionSourceTowerIds: Object.freeze([...state.towerProtectionSourceTowerIds]),
      backdoorProtection: state.backdoorProtection,
      backdoorActive: state.backdoorActive,
      sourceTowerIds: Object.freeze([...state.sourceTowerIds]),
      backdoorSourceTowerIds: Object.freeze([...state.backdoorSourceTowerIds]),
    }) satisfies TowerAuraState;

    if (dt <= 0 || entity.maxHp <= 0 || entity.currentHp <= 0 || entity.currentHp >= entity.maxHp) continue;

    const regenPerSecond = (state.backdoorActive ? BACKDOOR.effects.healthRegenPerSecond : 0)
      + (state.towerProtection ? REINFORCED.effects.aura.healthRegenPerSecond : 0);
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
  let damage = Math.max(0, baseDamage);
  const sourceAura = getTowerAuraState(source);
  const targetAura = getTowerAuraState(target);

  // Reforzado remains a tower structural interaction only because only towers receive
  // the reinforced state now.
  if (sourceAura.reinforced && targetAura.reinforced) {
    damage *= 1 + REINFORCED.effects.bonusDamageVsReinforcedPercent / 100;
  }

  if (targetAura.reinforced) {
    const reductionPercent = source?.kind === 'hero'
      ? REINFORCED.effects.heroAttackDamageReductionPercent
      : REINFORCED.effects.nonHeroAttackDamageReductionPercent;
    damage *= Math.max(0, 1 - reductionPercent / 100);
  }

  if (target.kind === 'tower' && targetAura.backdoorActive) {
    damage *= Math.max(0, 1 - BACKDOOR.effects.damageReductionPercent / 100);
  }

  if (targetAura.towerProtection) {
    damage *= armorDamageMultiplier(REINFORCED.effects.aura.armorBonus);
  }

  return Math.max(0, damage);
}

export function getTowerBackdoorRegenPerSecond(entity: GameEntity): number {
  return entity.kind === 'tower' && getTowerAuraState(entity).backdoorActive
    ? BACKDOOR.effects.healthRegenPerSecond
    : 0;
}

export function getTowerProtectionArmorBonus(entity: GameEntity): number {
  return getTowerAuraState(entity).towerProtection ? REINFORCED.effects.aura.armorBonus : 0;
}

export function getTowerProtectionRegenPerSecond(entity: GameEntity): number {
  return getTowerAuraState(entity).towerProtection ? REINFORCED.effects.aura.healthRegenPerSecond : 0;
}
