import { ALDEN } from '../heroes/alden/gameplay';
import type { DamageType } from '../heroes/types';
import { calculateAldenInnate, type CombatTargetClass } from './combat';
import { getRequiredHero } from './matchState';
import { calculateHeroStats, getActiveStatus } from './stats';
import type { MatchHeroState, MatchState } from './types';

export type HeroWorldDamageReactionInput = Readonly<{
  sourceEntityId?: string;
  hostile: boolean;
  isDirect: boolean;
  isFromFront: boolean;
  damageType: DamageType;
}>;

export type HeroWorldBasicAttackPreview = Readonly<{
  bonusDamage: number;
  healing: number;
  consumesInnate: boolean;
}>;

export type HeroWorldBasicAttackResolution = HeroWorldBasicAttackPreview & Readonly<{
  state: MatchState;
}>;

function clearExpiredAldenInnateReady(hero: MatchHeroState, nowMs: number): void {
  const ready = hero.runtime.statuses['alden:oath-ready'];
  if (!ready || ready.expiresAtMs > nowMs) return;
  delete hero.runtime.statuses['alden:oath-ready'];
  hero.runtime.counters['alden:steel'] = 0;
}

function addAldenInnateStack(hero: MatchHeroState, nowMs: number): void {
  clearExpiredAldenInnateReady(hero, nowMs);
  if (getActiveStatus(hero, 'alden:oath-ready', nowMs)) return;

  const lockoutUntil = hero.runtime.timestamps['alden:steel-lockout-until'] ?? 0;
  const nextStackAt = hero.runtime.timestamps['alden:next-steel-stack-at'] ?? 0;
  if (nowMs < lockoutUntil || nowMs < nextStackAt) return;

  const current = hero.runtime.counters['alden:steel'] ?? 0;
  const nextStacks = Math.min(ALDEN.innate.maxStacks, current + 1);
  hero.runtime.counters['alden:steel'] = nextStacks;
  hero.runtime.timestamps['alden:next-steel-stack-at'] = nowMs + ALDEN.innate.stackInternalCooldownSeconds * 1000;

  if (nextStacks < ALDEN.innate.maxStacks) return;
  hero.runtime.statuses['alden:oath-ready'] = {
    id: 'alden:oath-ready',
    sourceHeroEntityId: hero.heroEntityId,
    stacks: ALDEN.innate.maxStacks,
    expiresAtMs: nowMs + ALDEN.innate.empoweredAttackWindowSeconds * 1000,
  };
}

/**
 * Advances definition-owned world effects that have runtime windows without inventing
 * fake infinite statuses for permanent passives.
 */
export function advanceHeroWorldEffects(state: MatchState, nowMs: number): MatchState {
  let next: MatchState | null = null;
  for (const hero of Object.values(state.heroes)) {
    if (hero.definitionId !== ALDEN.id) continue;
    const ready = hero.runtime.statuses['alden:oath-ready'];
    if (!ready || ready.expiresAtMs > nowMs) continue;
    next ??= structuredClone(state);
    clearExpiredAldenInnateReady(getRequiredHero(next, hero.heroEntityId), nowMs);
  }
  return next ?? state;
}

/**
 * Mirrors a real world hit into the match-owned innate runtime without re-applying HP
 * damage. The world simulation remains authoritative for the hit amount itself.
 */
export function applyHeroWorldDamageReaction(
  state: MatchState,
  heroEntityId: string,
  input: HeroWorldDamageReactionInput,
  nowMs: number,
): MatchState {
  const hero = getRequiredHero(state, heroEntityId);
  if (hero.definitionId !== ALDEN.id) return state;
  if (!input.hostile || !input.isDirect || !input.isFromFront || input.damageType === 'true') return state;

  const next = structuredClone(state);
  addAldenInnateStack(getRequiredHero(next, heroEntityId), nowMs);
  return next;
}

export function calculateHeroWorldBasicAttackPreview(
  state: MatchState,
  heroEntityId: string,
  nowMs: number,
  targetClass: CombatTargetClass = 'player',
): HeroWorldBasicAttackPreview {
  const hero = getRequiredHero(state, heroEntityId);
  if (hero.definitionId !== ALDEN.id || !getActiveStatus(hero, 'alden:oath-ready', nowMs)) {
    return { bonusDamage: 0, healing: 0, consumesInnate: false };
  }

  const innate = calculateAldenInnate(state, heroEntityId, targetClass);
  return {
    bonusDamage: innate.bonusDamage,
    healing: innate.healing,
    consumesInnate: true,
  };
}

/** Consumes the ready innate on a real world basic attack and applies its self-heal. */
export function resolveHeroWorldBasicAttackEffects(
  state: MatchState,
  heroEntityId: string,
  nowMs: number,
  targetClass: CombatTargetClass = 'player',
): HeroWorldBasicAttackResolution {
  const preview = calculateHeroWorldBasicAttackPreview(state, heroEntityId, nowMs, targetClass);
  if (!preview.consumesInnate) return { state, ...preview };

  const next = structuredClone(state);
  const hero = getRequiredHero(next, heroEntityId);
  delete hero.runtime.statuses['alden:oath-ready'];
  hero.runtime.counters['alden:steel'] = 0;
  hero.runtime.timestamps['alden:steel-lockout-until'] = nowMs + ALDEN.innate.procLockoutSeconds * 1000;

  const maxHp = calculateHeroStats(next, heroEntityId, { nowMs }).maxHp;
  const effectiveHealing = Math.min(preview.healing, Math.max(0, maxHp - hero.currentHp));
  hero.currentHp += effectiveHealing;

  return {
    state: next,
    bonusDamage: preview.bonusDamage,
    healing: effectiveHealing,
    consumesInnate: true,
  };
}
