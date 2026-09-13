import { ALDEN } from '../heroes/alden/gameplay';
import { getHeroDefinition } from '../heroes/catalog';
import type { HeroDefinition, HeroStatKey, HeroStats, ItemStatModifier } from '../heroes/types';
import { getRequiredHero } from './matchState';
import type { CombatStatsSnapshot, MatchHeroState, MatchState } from './types';

export interface HeroStatsContext {
  nowMs?: number;
  targetHeroEntityId?: string;
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
      case 'fixed':
        result[key] = base;
        break;
      case 'linear':
        result[key] = base + progression.perLevel * levelsGained;
        break;
      case 'percentOfBase':
        result[key] = base * (1 + progression.percentPerLevel / 100 * levelsGained);
        break;
    }
  }
  return result;
}

export function calculateHeroStats(
  state: MatchState,
  heroEntityId: string,
  context: HeroStatsContext = {},
): HeroStats {
  const hero = getRequiredHero(state, heroEntityId);
  const definition = getHeroDefinition(hero.definitionId);
  let stats = calculateDefinitionStatsAtLevel(definition, hero.level);
  stats = applyItemModifiers(stats, hero);

  if (hero.definitionId === ALDEN.id) {
    stats = applyAldenConditionalStatEffects(stats, hero, context);
  }

  return stats;
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

  return {
    stats,
    tenacityPercent,
    globalDamageReductionPercent,
    frontalDamageReductionPercent,
  };
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
    const flat = statModifiers
      .filter(modifier => modifier.mode === 'flat')
      .reduce((sum, modifier) => sum + modifier.value, 0);
    const percent = statModifiers
      .filter(modifier => modifier.mode === 'percent')
      .reduce((sum, modifier) => sum + modifier.value, 0);
    result[key] = (result[key] + flat) * (1 + percent / 100);
  }

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
    'maxHp',
    'maxResource',
    'attackDamage',
    'attackSpeed',
    'movementSpeed',
    'hpRegenPerSecond',
    'resourceRegenPerSecond',
    'attackRange',
    'criticalChancePercent',
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

export function applyStatModifiersForPreview(stats: HeroStats, modifiers: readonly ItemStatModifier[]): HeroStats {
  const fakeHero = {
    inventory: [{ slot: 0, item: { statModifiers: modifiers } }],
  } as unknown as MatchHeroState;
  return applyItemModifiers(stats, fakeHero);
}
