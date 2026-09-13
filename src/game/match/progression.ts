import { getHeroDefinition } from '../heroes/catalog';
import { getRequiredHero, setHeroLevel } from './matchState';
import type { MatchState } from './types';

export type LaneCreepRewardType = 'melee' | 'ranged' | 'flagbearer' | 'siege';

export const HERO_PROGRESSION_TUNING = {
  startingGold: 600,
  passiveGoldPerTick: 1,
  passiveGoldIntervalMs: 2_000,
  experienceRadiusWorld: 13,
  denyHealthFraction: 0.5,
  creepRewards: {
    melee: { experience: 55, gold: 40 },
    flagbearer: { experience: 55, gold: 40 },
    ranged: { experience: 75, gold: 50 },
    siege: { experience: 100, gold: 70 },
  },
} as const;

const PASSIVE_GOLD_REMAINDER_COUNTER = 'economy:passive-gold-remainder-ms';

export type HeroProgressionReward = Readonly<{
  experience?: number;
  gold?: number;
  lastHits?: number;
  denies?: number;
}>;

export function getExperienceRequiredForNextLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1) throw new RangeError('Hero level must be a positive integer.');
  // 240 XP to level 2; then a predictable 120 XP increase for every following level.
  return 240 + (level - 1) * 120;
}

export function getCreepReward(type: LaneCreepRewardType) {
  return HERO_PROGRESSION_TUNING.creepRewards[type];
}

export function getHeroExperienceProgress(state: MatchState, heroEntityId: string) {
  const hero = getRequiredHero(state, heroEntityId);
  const definition = getHeroDefinition(hero.definitionId);
  if (hero.level >= definition.maxLevel) {
    return {
      current: hero.experience,
      required: 0,
      fraction: 1,
      maxLevel: true,
    } as const;
  }
  const required = getExperienceRequiredForNextLevel(hero.level);
  return {
    current: hero.experience,
    required,
    fraction: Math.min(1, Math.max(0, hero.experience / required)),
    maxLevel: false,
  } as const;
}

export function applyHeroProgressionReward(
  state: MatchState,
  heroEntityId: string,
  reward: HeroProgressionReward,
): MatchState {
  const source = getRequiredHero(state, heroEntityId);
  const definition = getHeroDefinition(source.definitionId);
  let next = state;
  let level = source.level;
  let experience = Math.max(0, source.experience + Math.max(0, reward.experience ?? 0));

  while (level < definition.maxLevel) {
    const required = getExperienceRequiredForNextLevel(level);
    if (experience < required) break;
    experience -= required;
    level += 1;
    next = setHeroLevel(next, heroEntityId, level);
  }

  const hero = getRequiredHero(next, heroEntityId);
  const nextHero = {
    ...hero,
    experience: level >= definition.maxLevel ? 0 : experience,
    gold: Math.max(0, hero.gold + Math.max(0, Math.trunc(reward.gold ?? 0))),
    lastHits: Math.max(0, hero.lastHits + Math.max(0, Math.trunc(reward.lastHits ?? 0))),
    denies: Math.max(0, hero.denies + Math.max(0, Math.trunc(reward.denies ?? 0))),
  };

  return {
    ...next,
    heroes: {
      ...next.heroes,
      [heroEntityId]: nextHero,
    },
  };
}

export function advanceHeroPassiveGold(
  state: MatchState,
  heroEntityId: string,
  elapsedMs: number,
): MatchState {
  if (state.phase !== 'in_progress' || elapsedMs <= 0) return state;
  const source = getRequiredHero(state, heroEntityId);
  const previousRemainder = Math.max(0, source.runtime.counters[PASSIVE_GOLD_REMAINDER_COUNTER] ?? 0);
  const totalMs = previousRemainder + elapsedMs;
  const ticks = Math.floor(totalMs / HERO_PROGRESSION_TUNING.passiveGoldIntervalMs);
  const remainder = totalMs - ticks * HERO_PROGRESSION_TUNING.passiveGoldIntervalMs;

  if (ticks === 0 && Math.abs(remainder - previousRemainder) < 0.001) return state;

  const nextHero = structuredClone(source);
  nextHero.runtime.counters[PASSIVE_GOLD_REMAINDER_COUNTER] = remainder;
  if (ticks > 0) nextHero.gold += ticks * HERO_PROGRESSION_TUNING.passiveGoldPerTick;

  return {
    ...state,
    heroes: {
      ...state.heroes,
      [heroEntityId]: nextHero,
    },
  };
}
