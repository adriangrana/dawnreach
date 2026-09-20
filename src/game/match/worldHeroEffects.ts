import { ALDEN } from '../heroes/alden/gameplay';
import { SERYN } from '../heroes/seryn/gameplay';
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

function serynAlignedStatusId(targetEntityId: string) {
  return `seryn:aligned:${targetEntityId}`;
}

function serynLockoutKey(targetEntityId: string) {
  return `seryn:sightline-lockout:${targetEntityId}`;
}

function clearExpiredSerynSightline(hero: MatchHeroState, nowMs: number) {
  let changed = false;
  const bucket = hero.runtime.targetCounters['seryn:sightline'];
  if (bucket) {
    for (const [targetId, entry] of Object.entries(bucket)) {
      if (entry.expiresAtMs > nowMs) continue;
      delete bucket[targetId];
      delete hero.runtime.statuses[serynAlignedStatusId(targetId)];
      changed = true;
    }
  }
  for (const [id, status] of Object.entries(hero.runtime.statuses)) {
    if (!id.startsWith('seryn:aligned:') || status.expiresAtMs > nowMs) continue;
    delete hero.runtime.statuses[id];
    changed = true;
  }
  if (changed) hero.runtime.counters['seryn:sightline'] = 0;
  return changed;
}

function advanceSerynSightline(
  hero: MatchHeroState,
  targetEntityId: string,
  distance: number,
  nowMs: number,
) {
  clearExpiredSerynSightline(hero, nowMs);
  if (distance < SERYN.innate.minimumRange) return;

  const alignedId = serynAlignedStatusId(targetEntityId);
  if (getActiveStatus(hero, alignedId, nowMs)) return;
  if (nowMs < (hero.runtime.timestamps[serynLockoutKey(targetEntityId)] ?? 0)) return;

  const bucket = hero.runtime.targetCounters['seryn:sightline'] ??= {};
  const existing = bucket[targetEntityId];
  const current = existing && existing.expiresAtMs > nowMs ? existing.stacks : 0;
  const stacks = Math.min(SERYN.innate.maxStacks, current + 1);
  bucket[targetEntityId] = {
    stacks,
    expiresAtMs: nowMs + SERYN.innate.stackDurationSeconds * 1000,
  };
  hero.runtime.counters['seryn:sightline'] = stacks;

  if (stacks >= SERYN.innate.maxStacks) {
    hero.runtime.statuses[alignedId] = {
      id: alignedId,
      sourceHeroEntityId: hero.heroEntityId,
      stacks,
      expiresAtMs: nowMs + SERYN.innate.alignedWindowSeconds * 1000,
    };
  }
}

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
    if (hero.definitionId === ALDEN.id) {
      const ready = hero.runtime.statuses['alden:oath-ready'];
      if (!ready || ready.expiresAtMs > nowMs) continue;
      next ??= structuredClone(state);
      clearExpiredAldenInnateReady(getRequiredHero(next, hero.heroEntityId), nowMs);
      continue;
    }
    if (hero.definitionId === SERYN.id) {
      const hasExpiredTrace = Object.values(hero.runtime.targetCounters['seryn:sightline'] ?? {})
        .some(entry => entry.expiresAtMs <= nowMs);
      const hasExpiredAligned = Object.entries(hero.runtime.statuses)
        .some(([id, status]) => id.startsWith('seryn:aligned:') && status.expiresAtMs <= nowMs);
      if (!hasExpiredTrace && !hasExpiredAligned) continue;
      next ??= structuredClone(state);
      clearExpiredSerynSightline(getRequiredHero(next, hero.heroEntityId), nowMs);
    }
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
  targetEntityId = '',
  distance = 0,
): HeroWorldBasicAttackPreview {
  const hero = getRequiredHero(state, heroEntityId);
  if (hero.definitionId === ALDEN.id) {
    if (!getActiveStatus(hero, 'alden:oath-ready', nowMs)) {
      return { bonusDamage: 0, healing: 0, consumesInnate: false };
    }
    const innate = calculateAldenInnate(state, heroEntityId, targetClass);
    return {
      bonusDamage: innate.bonusDamage,
      healing: innate.healing,
      consumesInnate: true,
    };
  }

  if (hero.definitionId === SERYN.id && targetEntityId && distance >= SERYN.innate.minimumRange) {
    const aligned = getActiveStatus(hero, serynAlignedStatusId(targetEntityId), nowMs);
    if (aligned) {
      const stats = calculateHeroStats(state, heroEntityId, { nowMs });
      return {
        bonusDamage: SERYN.innate.bonusDamageBase
          + SERYN.innate.bonusDamagePerHeroLevel * (hero.level - 1)
          + SERYN.innate.totalAdRatio * stats.attackDamage,
        healing: 0,
        consumesInnate: true,
      };
    }
  }

  return { bonusDamage: 0, healing: 0, consumesInnate: false };
}

/** Consumes the ready innate on a real world basic attack and applies its self-heal. */
export function resolveHeroWorldBasicAttackEffects(
  state: MatchState,
  heroEntityId: string,
  nowMs: number,
  targetClass: CombatTargetClass = 'player',
  targetEntityId = '',
  distance = 0,
): HeroWorldBasicAttackResolution {
  const preview = calculateHeroWorldBasicAttackPreview(
    state,
    heroEntityId,
    nowMs,
    targetClass,
    targetEntityId,
    distance,
  );
  const current = getRequiredHero(state, heroEntityId);

  if (current.definitionId === SERYN.id) {
    const next = structuredClone(state);
    const hero = getRequiredHero(next, heroEntityId);
    if (preview.consumesInnate && targetEntityId) {
      delete hero.runtime.statuses[serynAlignedStatusId(targetEntityId)];
      delete hero.runtime.targetCounters['seryn:sightline']?.[targetEntityId];
      hero.runtime.counters['seryn:sightline'] = 0;
      hero.runtime.timestamps[serynLockoutKey(targetEntityId)] = nowMs + SERYN.innate.perTargetLockoutSeconds * 1000;
    } else if (targetEntityId) {
      advanceSerynSightline(hero, targetEntityId, distance, nowMs);
    }
    return { state: next, ...preview };
  }

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
