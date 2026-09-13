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

type ReinforcedEffects = {
  bonusDamageVsReinforcedPercent: number;
  heroAttackDamageReductionPercent: number;
  nonHeroAttackDamageReductionPercent: number;
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
  reinforced: boolean;
  backdoorProtection: boolean;
  backdoorActive: boolean;
  sourceTowerIds: readonly string[];
  backdoorSourceTowerIds: readonly string[];
}>;

type MutableTowerAuraState = {
  reinforced: boolean;
  backdoorProtection: boolean;
  backdoorActive: boolean;
  sourceTowerIds: string[];
  backdoorSourceTowerIds: string[];
};

const EMPTY_AURA_STATE: TowerAuraState = Object.freeze({
  reinforced: false,
  backdoorProtection: false,
  backdoorActive: false,
  sourceTowerIds: Object.freeze([]) as readonly string[],
  backdoorSourceTowerIds: Object.freeze([]) as readonly string[],
});

function createMutableAuraState(): MutableTowerAuraState {
  return {
    reinforced: false,
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

  const entities = registry.values();
  const states = new Map<GameEntity, MutableTowerAuraState>();
  for (const entity of entities) states.set(entity, createMutableAuraState());

  const auraRadiusSquared = TOWER_GAMEPLAY.auraRadius * TOWER_GAMEPLAY.auraRadius;
  for (const tower of entities) {
    if (tower.kind !== 'tower' || !tower.alive || tower.currentHp <= 0) continue;
    if (tower.team === 'neutral') continue;

    tower.root.getWorldPosition(towerPosition);
    const backdoorEnabledForSource = !hasEnemyCreepNearTower(
      tower,
      registry,
      BACKDOOR.effects.disabledByEnemyCreepRadius,
    );

    for (const ally of entities) {
      if (!ally.alive || ally.currentHp <= 0 || ally.team !== tower.team) continue;
      ally.root.getWorldPosition(entityPosition);
      if (planarDistanceSquared(towerPosition, entityPosition) > auraRadiusSquared) continue;

      const state = states.get(ally)!;
      if (isEligible(ally.kind, REINFORCED.eligibleKinds)) {
        state.reinforced = true;
        if (!state.sourceTowerIds.includes(tower.id)) state.sourceTowerIds.push(tower.id);
      }

      if (isEligible(ally.kind, BACKDOOR.eligibleKinds)) {
        state.backdoorProtection = true;
        if (!state.backdoorSourceTowerIds.includes(tower.id)) state.backdoorSourceTowerIds.push(tower.id);
        if (backdoorEnabledForSource) state.backdoorActive = true;
      }
    }
  }

  for (const entity of entities) {
    const state = states.get(entity)!;
    entity.root.userData[AURA_STATE_KEY] = Object.freeze({
      reinforced: state.reinforced,
      backdoorProtection: state.backdoorProtection,
      backdoorActive: state.backdoorActive,
      sourceTowerIds: Object.freeze([...state.sourceTowerIds]),
      backdoorSourceTowerIds: Object.freeze([...state.backdoorSourceTowerIds]),
    }) satisfies TowerAuraState;

    if (!state.backdoorActive || dt <= 0 || entity.maxHp <= 0 || entity.currentHp <= 0 || entity.currentHp >= entity.maxHp) continue;
    const healedHp = Math.min(entity.maxHp, entity.currentHp + BACKDOOR.effects.healthRegenPerSecond * dt);
    if (healedHp <= entity.currentHp) continue;
    entity.currentHp = healedHp;
    entity.root.userData.currentHp = healedHp;
    emitWorldCombatEvent({
      entityId: entity.id,
      reason: 'heal',
      currentHp: healedHp,
      alive: true,
      atMs: typeof performance !== 'undefined' ? performance.now() : Date.now(),
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

  if (sourceAura.reinforced && targetAura.reinforced) {
    damage *= 1 + REINFORCED.effects.bonusDamageVsReinforcedPercent / 100;
  }

  if (targetAura.reinforced) {
    const reductionPercent = source?.kind === 'hero'
      ? REINFORCED.effects.heroAttackDamageReductionPercent
      : REINFORCED.effects.nonHeroAttackDamageReductionPercent;
    damage *= Math.max(0, 1 - reductionPercent / 100);
  }

  if (targetAura.backdoorActive) {
    damage *= Math.max(0, 1 - BACKDOOR.effects.damageReductionPercent / 100);
  }

  return Math.max(0, damage);
}

export function getTowerBackdoorRegenPerSecond(entity: GameEntity): number {
  return getTowerAuraState(entity).backdoorActive ? BACKDOOR.effects.healthRegenPerSecond : 0;
}
