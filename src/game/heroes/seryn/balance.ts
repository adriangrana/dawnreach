import type { AbilityKey, DamageType, HeroStats } from '../types';
import {
  SERYN,
  getSerynStatsAtLevel,
  type SerynERank,
  type SerynQRank,
  type SerynRRank,
  type SerynWRank,
} from './gameplay';

export const SERYN_BALANCE_GUARDRAILS = Object.freeze({
  identity: 'High sustained ranged damage with deliberate spacing; medium burst; low durability.',
  level1MaxHp: 540,
  level1AttackDamage: 54,
  level1AttackRange: 575,
  maxDashRange: 300,
  maxHardControlSeconds: 1,
  ultimateShots: 3,
  repeatedUltimateHitMultiplier: 0.65,
  /**
   * Raw pre-resistance budget for a level-18 max-rank Q + E + all R shots +
   * one basic attack + one innate proc, without item stats.
   * This is a regression ceiling, not a promise of real match damage.
   */
  level18FullComboRawDamageCeiling: 1450,
} as const);

export type SerynAbilityPreview = Readonly<{
  key: AbilityKey;
  rank: number;
  resourceCost: number;
  cooldownSeconds: number;
  damageType: DamageType | null;
  rawDamage: number;
}>;

function amplified(rawDamage: number, stats: Pick<HeroStats, 'abilityPowerPercent'>) {
  return Math.max(0, rawDamage) * (1 + Math.max(0, stats.abilityPowerPercent) / 100);
}

function basicRank<T>(ranks: readonly [T, T, T, T], rank: number): T {
  if (!Number.isInteger(rank) || rank < 1 || rank > 4) throw new RangeError('Basic ability rank must be 1 to 4.');
  return ranks[rank - 1];
}

function ultimateRank<T>(ranks: readonly [T, T, T], rank: number): T {
  if (!Number.isInteger(rank) || rank < 1 || rank > 3) throw new RangeError('Ultimate rank must be 1 to 3.');
  return ranks[rank - 1];
}

export function calculateSerynInnateBonusDamageAtLevel(level: number) {
  const stats = getSerynStatsAtLevel(level);
  return SERYN.innate.bonusDamageBase
    + SERYN.innate.bonusDamagePerHeroLevel * (level - 1)
    + SERYN.innate.totalAdRatio * stats.attackDamage;
}

export function calculateSerynAbilityAtLevel(
  key: AbilityKey,
  rank: number,
  level: number,
  options: { ultimateHits?: number } = {},
): SerynAbilityPreview {
  const stats = getSerynStatsAtLevel(level);

  if (key === 'Q') {
    const data: SerynQRank = basicRank(SERYN.q.ranks, rank);
    return {
      key,
      rank,
      resourceCost: data.manaCost,
      cooldownSeconds: data.cooldownSeconds,
      damageType: 'physical',
      rawDamage: amplified(data.baseDamage + SERYN.q.totalAdRatio * stats.attackDamage, stats),
    };
  }

  if (key === 'W') {
    const data: SerynWRank = basicRank(SERYN.w.ranks, rank);
    return {
      key,
      rank,
      resourceCost: data.manaCost,
      cooldownSeconds: data.cooldownSeconds,
      damageType: null,
      rawDamage: 0,
    };
  }

  if (key === 'E') {
    const data: SerynERank = basicRank(SERYN.e.ranks, rank);
    return {
      key,
      rank,
      resourceCost: data.manaCost,
      cooldownSeconds: data.cooldownSeconds,
      damageType: 'magic',
      rawDamage: amplified(data.baseDamage + SERYN.e.totalAdRatio * stats.attackDamage, stats),
    };
  }

  const data: SerynRRank = ultimateRank(SERYN.r.ranks, rank);
  const requestedHits = Math.floor(options.ultimateHits ?? 1);
  const hits = Math.min(SERYN.r.shotCount, Math.max(1, requestedHits));
  const firstShot = amplified(data.shotBaseDamage + SERYN.r.totalAdRatioPerShot * stats.attackDamage, stats);
  const repeatedShots = Math.max(0, hits - 1) * firstShot * SERYN.r.repeatedHitDamageMultiplier;
  return {
    key,
    rank,
    resourceCost: data.manaCost,
    cooldownSeconds: data.cooldownSeconds,
    damageType: 'physical',
    rawDamage: firstShot + repeatedShots,
  };
}

export function calculateSerynFullComboBudget(level = 18) {
  const stats = getSerynStatsAtLevel(level);
  const q = calculateSerynAbilityAtLevel('Q', 4, level).rawDamage;
  const e = calculateSerynAbilityAtLevel('E', 4, level).rawDamage;
  const r = calculateSerynAbilityAtLevel('R', 3, level, { ultimateHits: 3 }).rawDamage;
  const innate = calculateSerynInnateBonusDamageAtLevel(level);
  const basicAttack = stats.attackDamage;
  return {
    level,
    q,
    e,
    r,
    innate,
    basicAttack,
    totalRawDamage: q + e + r + innate + basicAttack,
  };
}
