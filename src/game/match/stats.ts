import { ALDEN } from '../heroes/alden/gameplay';
import {
  HeroAttributes,
  applyHeroAttributeRules,
  calculateDefinitionAttributesAtLevel,
  calculateDefinitionBaseStatsAtLevel,
  calculateDefinitionStatsAtLevel,
} from '../heroes/heroAttributes';
import { getHeroDefinition } from '../heroes/catalog';
import type { HeroStatKey, HeroStats, ItemStatModifier } from '../heroes/types';
import { getItemDefinition } from '../items/itemDatabase';
import { getRequiredHero } from './matchState';
import type { CombatStatsSnapshot, MatchHeroState, MatchState } from './types';

export { calculateDefinitionAttributesAtLevel, calculateDefinitionStatsAtLevel } from '../heroes/heroAttributes';

export interface HeroStatsContext {
  nowMs?: number;
  targetHeroEntityId?: string;
}

export interface HeroDamageBreakdown {
  baseDamage: number;
  itemBonusDamage: number;
  totalDamage: number;
}

export function calculateHeroAttributes(state: MatchState, heroEntityId: string): HeroAttributes {
  const hero = getRequiredHero(state, heroEntityId);
  const definition = getHeroDefinition(hero.definitionId);
  const levelAttributes = calculateDefinitionAttributesAtLevel(definition, hero.level);
  let strength = levelAttributes.str;
  let agility = levelAttributes.agi;
  let intelligence = levelAttributes.int;

  for (const slot of hero.inventory) {
    const item = slot.item ? getItemDefinition(slot.item.definitionId) : null;
    if (!item) continue;
    strength += numeric(item.stats.strength);
    agility += numeric(item.stats.agility);
    intelligence += numeric(item.stats.intelligence);
  }

  return new HeroAttributes(definition.primaryAttribute, strength, agility, intelligence);
}

export function calculateHeroStats(
  state: MatchState,
  heroEntityId: string,
  context: HeroStatsContext = {},
): HeroStats {
  const hero = getRequiredHero(state, heroEntityId);
  const definition = getHeroDefinition(hero.definitionId);
  const attributes = calculateHeroAttributes(state, heroEntityId);
  let stats = applyHeroAttributeRules(
    calculateDefinitionBaseStatsAtLevel(definition, hero.level),
    definition,
    attributes,
  );
  stats = applyItemModifiers(stats, hero);
  stats = applyTimedItemStatEffects(stats, hero, context.nowMs ?? 0);

  if (hero.definitionId === ALDEN.id) stats = applyAldenConditionalStatEffects(stats, hero, context);
  return sanitizeStats(stats);
}

export function calculateHeroDamageBreakdown(
  state: MatchState,
  heroEntityId: string,
  context: HeroStatsContext = {},
): HeroDamageBreakdown {
  const hero = getRequiredHero(state, heroEntityId);
  const definition = getHeroDefinition(hero.definitionId);
  const attributes = calculateHeroAttributes(state, heroEntityId);
  const stats = calculateHeroStats(state, heroEntityId, context);
  const baseDamage = Math.max(0, attributes.CalculateAttackDamage(definition.baseAttackDamage));
  return {
    baseDamage,
    itemBonusDamage: Math.max(0, stats.attackDamage - baseDamage),
    totalDamage: stats.attackDamage,
  };
}

/** Applies the global INT ability-damage rule to a resolved ability damage amount. */
export function applyAbilityPowerToDamage(rawDamage: number, stats: Pick<HeroStats, 'abilityPowerPercent'>): number {
  if (!Number.isFinite(rawDamage) || rawDamage <= 0) return 0;
  return rawDamage * (1 + Math.max(0, stats.abilityPowerPercent) / 100);
}

export function calculateCombatStats(
  state: MatchState,
  heroEntityId: string,
  context: HeroStatsContext = {},
): CombatStatsSnapshot {
  const nowMs = context.nowMs ?? 0;
  const hero = getRequiredHero(state, heroEntityId);
  const stats = calculateHeroStats(state, heroEntityId, context);
  let tenacityPercent = 0;
  let globalDamageReductionPercent = 0;
  let frontalDamageReductionPercent = 0;

  if (hero.definitionId === ALDEN.id) {
    const majesty = getActiveStatus(hero, 'alden:majesty', nowMs);
    if (majesty?.rank) {
      const rank = ALDEN.r.ranks[majesty.rank - 1];
      tenacityPercent += rank.tenacityPercent;
      globalDamageReductionPercent = combineReductions(globalDamageReductionPercent, rank.damageReductionPercent);
    }

    const guard = getActiveStatus(hero, 'alden:guard', nowMs);
    if (guard?.rank) {
      const rank = ALDEN.w.ranks[guard.rank - 1];
      frontalDamageReductionPercent = combineReductions(frontalDamageReductionPercent, rank.frontDamageReductionPercent);
    }
  }

  return { stats, tenacityPercent, globalDamageReductionPercent, frontalDamageReductionPercent };
}

export function getActiveStatus(hero: MatchHeroState, statusId: string, nowMs: number) {
  const status = hero.runtime.statuses[statusId];
  return status && status.expiresAtMs > nowMs ? status : undefined;
}

function applyItemModifiers(stats: HeroStats, hero: MatchHeroState): HeroStats {
  const result = { ...stats };
  const modifiers = hero.inventory.flatMap(slot => slot.item?.statModifiers ?? []);

  for (const key of Object.keys(result) as HeroStatKey[]) {
    const statModifiers = modifiers.filter(modifier => modifier.stat === key);
    const flat = statModifiers.filter(modifier => modifier.mode === 'flat').reduce((sum, modifier) => sum + modifier.value, 0);
    const percent = statModifiers.filter(modifier => modifier.mode === 'percent').reduce((sum, modifier) => sum + modifier.value, 0);
    result[key] = (result[key] + flat) * (1 + percent / 100);
  }
  return sanitizeStats(result);
}

function applyTimedItemStatEffects(stats: HeroStats, hero: MatchHeroState, nowMs: number) {
  const result = { ...stats };
  let movementFlat = 0;
  let movementPercent = 0;

  for (const status of Object.values(hero.runtime.statuses)) {
    if (!status.id.startsWith('item:active:') || status.expiresAtMs <= nowMs) continue;
    const data = status.data;
    if (!data) continue;
    if (typeof data.movementSpeedFlat === 'number') movementFlat += data.movementSpeedFlat;
    if (typeof data.movementSpeedPercent === 'number') movementPercent += data.movementSpeedPercent;
  }

  result.movementSpeed = (result.movementSpeed + movementFlat) * (1 + movementPercent / 100);
  return sanitizeStats(result);
}

function applyAldenConditionalStatEffects(
  stats: HeroStats,
  hero: MatchHeroState,
  context: HeroStatsContext,
): HeroStats {
  const result = { ...stats };
  const nowMs = context.nowMs ?? 0;

  const guard = getActiveStatus(hero, 'alden:guard', nowMs);
  if (guard) result.movementSpeed *= 1 - ALDEN.w.movementPenaltyPercent / 100;

  const eRank = hero.abilityRanks.E;
  const targetId = context.targetHeroEntityId;
  if (eRank > 0 && targetId) {
    const cadence = hero.runtime.targetCounters['alden:cadence']?.[targetId];
    if (cadence && cadence.expiresAtMs > nowMs && cadence.stacks > 0) {
      const rank = ALDEN.e.ranks[eRank - 1];
      const stacks = Math.min(ALDEN.e.maxCadenceStacks, cadence.stacks);
      result.attackSpeed *= 1 + rank.attackSpeedPercentPerStack * stacks / 100;
    }
  }

  return sanitizeStats(result);
}

function sanitizeStats(stats: HeroStats): HeroStats {
  const result = { ...stats };
  const nonNegative: HeroStatKey[] = [
    'maxHp', 'maxResource', 'attackDamage', 'physicalDamageResistancePercent', 'attackSpeed', 'movementSpeed',
    'hpRegenPerSecond', 'resourceRegenPerSecond', 'magicPower', 'abilityPowerPercent', 'attackRange',
    'criticalChancePercent',
  ];
  for (const key of nonNegative) result[key] = Math.max(0, result[key]);
  result.physicalDamageResistancePercent = Math.min(100, result.physicalDamageResistancePercent);
  result.criticalChancePercent = Math.min(100, result.criticalChancePercent);
  return result;
}

function combineReductions(firstPercent: number, secondPercent: number): number {
  const firstMultiplier = 1 - firstPercent / 100;
  const secondMultiplier = 1 - secondPercent / 100;
  return (1 - firstMultiplier * secondMultiplier) * 100;
}

function numeric(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function applyStatModifiersForPreview(stats: HeroStats, modifiers: readonly ItemStatModifier[]): HeroStats {
  const fakeHero = { inventory: [{ slot: 0, item: { statModifiers: modifiers } }] } as unknown as MatchHeroState;
  return applyItemModifiers(stats, fakeHero);
}
