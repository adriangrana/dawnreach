import { ALDEN } from '../heroes/alden/gameplay';
import { getHeroDefinition } from '../heroes/catalog';
import type {
  HeroAttributes,
  HeroDefinition,
  HeroStatKey,
  HeroStats,
  ItemStatModifier,
} from '../heroes/types';
import { getItemDefinition } from '../items/itemDatabase';
import { getRequiredHero } from './matchState';
import type { CombatStatsSnapshot, MatchHeroState, MatchState } from './types';

export interface HeroStatsContext {
  nowMs?: number;
  targetHeroEntityId?: string;
}

export interface HeroDamageBreakdown {
  baseDamage: number;
  itemBonusDamage: number;
  totalDamage: number;
}

export function calculateDefinitionStatsAtLevel(definition: HeroDefinition, level: number): HeroStats {
  if (!Number.isInteger(level) || level < 1 || level > definition.maxLevel) {
    throw new RangeError(`${definition.displayName} level must be an integer from 1 to ${definition.maxLevel}.`);
  }

  const levelsGained = level - 1;
  const result = {} as HeroStats;
  for (const key of Object.keys(definition.baseStats) as HeroStatKey[]) {
    const base = definition.baseStats[key];
    const progression = definition.statProgression[key];
    switch (progression.kind) {
      case 'fixed': result[key] = base; break;
      case 'linear': result[key] = base + progression.perLevel * levelsGained; break;
      case 'percentOfBase': result[key] = base * (1 + progression.percentPerLevel / 100 * levelsGained); break;
    }
  }
  return result;
}

export function calculateDefinitionAttributesAtLevel(definition: HeroDefinition, level: number): HeroAttributes {
  if (!Number.isInteger(level) || level < 1 || level > definition.maxLevel) {
    throw new RangeError(`${definition.displayName} level must be an integer from 1 to ${definition.maxLevel}.`);
  }

  const levelsGained = level - 1;
  return {
    strength: Math.max(0, definition.baseAttributes.strength + definition.attributeProgression.strength * levelsGained),
    agility: Math.max(0, definition.baseAttributes.agility + definition.attributeProgression.agility * levelsGained),
    intelligence: Math.max(0, definition.baseAttributes.intelligence + definition.attributeProgression.intelligence * levelsGained),
  };
}

export function calculateHeroAttributes(state: MatchState, heroEntityId: string): HeroAttributes {
  const hero = getRequiredHero(state, heroEntityId);
  const definition = getHeroDefinition(hero.definitionId);
  const result = calculateDefinitionAttributesAtLevel(definition, hero.level);

  for (const slot of hero.inventory) {
    const item = slot.item ? getItemDefinition(slot.item.definitionId) : null;
    if (!item) continue;
    result.strength += numeric(item.stats.strength);
    result.agility += numeric(item.stats.agility);
    result.intelligence += numeric(item.stats.intelligence);
  }

  result.strength = Math.max(0, result.strength);
  result.agility = Math.max(0, result.agility);
  result.intelligence = Math.max(0, result.intelligence);
  return result;
}

export function calculateHeroStats(
  state: MatchState,
  heroEntityId: string,
  context: HeroStatsContext = {},
): HeroStats {
  const hero = getRequiredHero(state, heroEntityId);
  const definition = getHeroDefinition(hero.definitionId);
  const definitionStats = calculateDefinitionStatsAtLevel(definition, hero.level);
  let stats = applyItemModifiers(definitionStats, hero);
  stats = applyTimedItemStatEffects(stats, hero, context.nowMs ?? 0);
  stats = applyPrimaryAttributeAttackDamage(
    stats,
    definitionStats,
    definition,
    calculateHeroAttributes(state, heroEntityId),
  );

  if (hero.definitionId === ALDEN.id) stats = applyAldenConditionalStatEffects(stats, hero, context);
  return stats;
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
  const baseDamage = Math.max(0, definition.baseAttackDamage + attributes[definition.primaryAttribute]);
  return {
    baseDamage,
    itemBonusDamage: Math.max(0, stats.attackDamage - baseDamage),
    totalDamage: stats.attackDamage,
  };
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

function applyPrimaryAttributeAttackDamage(
  stats: HeroStats,
  definitionStats: HeroStats,
  definition: HeroDefinition,
  attributes: HeroAttributes,
) {
  const result = { ...stats };
  const damageBeyondDefinition = result.attackDamage - definitionStats.attackDamage;
  result.attackDamage = definition.baseAttackDamage
    + attributes[definition.primaryAttribute]
    + damageBeyondDefinition;
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
    'maxHp', 'maxResource', 'attackDamage', 'attackSpeed', 'movementSpeed', 'hpRegenPerSecond',
    'resourceRegenPerSecond', 'attackRange', 'criticalChancePercent',
  ];
  for (const key of nonNegative) result[key] = Math.max(0, result[key]);
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
