import { ALDEN, type AldenGameplayDefinition } from '../heroes/alden/gameplay';
import { getHeroDefinition } from '../heroes/catalog';
import { SERYN } from '../heroes/seryn/gameplay';
import type { AbilityKey, DamageType } from '../heroes/types';
import { getRequiredHero } from './matchState';
import { applyAbilityPowerToDamage, calculateCombatStats, calculateHeroStats, getActiveStatus } from './stats';
import type {
  ActionTargetResult,
  DamagePacket,
  DamageResult,
  HeroActionResult,
  MatchHeroState,
  MatchState,
  TimedStatusState,
} from './types';

export type CombatTargetClass = 'normal' | 'elite' | 'boss' | 'player';

export interface AldenAbilityPreview {
  heroEntityId: string;
  key: AbilityKey;
  rank: 1 | 2 | 3 | 4;
  resourceCost: number;
  cooldownSeconds: number;
  damageType: DamageType | null;
  rawDamage: number;
  healing: number;
  effects: Record<string, number | string | boolean>;
}

export interface AldenInnatePreview {
  bonusDamage: number;
  healing: number;
  requiredStacks: number;
  stackInternalCooldownSeconds: number;
  procLockoutSeconds: number;
  empoweredAttackWindowSeconds: number;
}

export interface AbilityActionInput {
  actorHeroEntityId: string;
  key: AbilityKey;
  targetHeroEntityIds?: readonly string[];
  nowMs: number;
}

export interface BasicAttackInput {
  actorHeroEntityId: string;
  targetHeroEntityId: string;
  nowMs: number;
  critical?: boolean;
  /** Distance in Dawnreach gameplay units. Required for distance-gated passives such as Seryn's innate. */
  distance?: number;
}

export interface ActionResolution {
  state: MatchState;
  result: HeroActionResult;
}

export interface DamageResolution {
  state: MatchState;
  result: DamageResult;
}

export function calculateAldenAbilityAtRank(
  state: MatchState,
  heroEntityId: string,
  key: AbilityKey,
  rank: 1 | 2 | 3 | 4,
  options: {
    cadenceStacks?: number;
    targetClass?: CombatTargetClass;
  } = {},
): AldenAbilityPreview {
  const hero = getRequiredHero(state, heroEntityId);
  if (hero.definitionId !== ALDEN.id) throw new Error(`${heroEntityId} is not Alden.`);
  const stats = calculateHeroStats(state, heroEntityId);
  const rankIndex = rank - 1;

  if (key === 'Q') {
    const data = ALDEN.q.ranks[rankIndex];
    return {
      heroEntityId,
      key,
      rank,
      resourceCost: data.manaCost,
      cooldownSeconds: data.cooldownSeconds,
      damageType: 'physical',
      rawDamage: applyAbilityPowerToDamage(data.baseDamage + ALDEN.q.totalAdRatio * stats.attackDamage, stats),
      healing: 0,
      effects: {
        dashRange: ALDEN.q.dashRange,
        cleaveRange: ALDEN.q.cleaveRange,
        cleaveAngleDegrees: ALDEN.q.cleaveAngleDegrees,
        castTimeSeconds: ALDEN.q.castTimeSeconds,
        slowPercent: data.slowPercent,
        slowDurationSeconds: data.slowDurationSeconds,
        cadenceStacksApplied: ALDEN.q.cadenceStacksAppliedToFirstPriorityTarget,
      },
    };
  }

  if (key === 'W') {
    const data = ALDEN.w.ranks[rankIndex];
    return {
      heroEntityId,
      key,
      rank,
      resourceCost: data.manaCost,
      cooldownSeconds: data.cooldownSeconds,
      damageType: 'physical',
      rawDamage: applyAbilityPowerToDamage(data.reprisalBaseDamage + ALDEN.w.reprisalTotalAdRatio * stats.attackDamage, stats),
      healing: 0,
      effects: {
        guardDurationSeconds: ALDEN.w.guardDurationSeconds,
        guardArcDegrees: ALDEN.w.guardArcDegrees,
        movementPenaltyPercent: ALDEN.w.movementPenaltyPercent,
        frontDamageReductionPercent: data.frontDamageReductionPercent,
        reprisalTriggerPreventedDamagePercentMaxHp: ALDEN.w.reprisalTriggerPreventedDamagePercentMaxHp,
        reprisalWindowSeconds: ALDEN.w.reprisalWindowSeconds,
        reprisalBonusAttackRange: ALDEN.w.reprisalBonusAttackRange,
        reprisalStunDurationSeconds: data.stunDurationSeconds,
      },
    };
  }

  if (key === 'E') {
    const data = ALDEN.e.ranks[rankIndex];
    const stacks = clampInteger(options.cadenceStacks ?? 0, 0, ALDEN.e.maxCadenceStacks);
    const targetClass = options.targetClass ?? 'player';
    const healingMultiplier = targetClass === 'normal'
      ? ALDEN.e.normalEnemyHealingMultiplier
      : ALDEN.e.eliteBossPlayerHealingMultiplier;
    return {
      heroEntityId,
      key,
      rank,
      resourceCost: data.manaCost,
      cooldownSeconds: data.cooldownSeconds,
      damageType: 'physical',
      rawDamage: applyAbilityPowerToDamage(
        data.activeBaseDamage
          + ALDEN.e.activeTotalAdRatio * stats.attackDamage
          + data.bonusDamagePerConsumedStack * stacks,
        stats,
      ),
      healing: stats.maxHp * (data.healingPercentMaxHpPerStack / 100) * stacks * healingMultiplier,
      effects: {
        radius: ALDEN.e.activeRadius,
        maxCadenceStacks: ALDEN.e.maxCadenceStacks,
        cadenceDurationSeconds: ALDEN.e.cadenceDurationSeconds,
        consumedCadenceStacks: stacks,
        attackSpeedPercentPerStack: data.attackSpeedPercentPerStack,
        bonusDamagePerConsumedStack: data.bonusDamagePerConsumedStack,
        healingPercentMaxHpPerStack: data.healingPercentMaxHpPerStack,
      },
    };
  }

  const data = ALDEN.r.ranks[rankIndex];
  const targetClass = options.targetClass ?? 'player';
  const tauntDurationSeconds = targetClass === 'elite' ? data.eliteTauntDurationSeconds
    : targetClass === 'boss' ? 0
      : data.pvpTauntDurationSeconds;
  return {
    heroEntityId,
    key,
    rank,
    resourceCost: data.manaCost,
    cooldownSeconds: data.cooldownSeconds,
    damageType: 'physical',
    rawDamage: applyAbilityPowerToDamage(data.baseDamage + ALDEN.r.totalAdRatio * stats.attackDamage, stats),
    healing: 0,
    effects: {
      radius: ALDEN.r.radius,
      castTimeSeconds: ALDEN.r.castTimeSeconds,
      tauntDurationSeconds,
      majestyDurationSeconds: ALDEN.r.majestyDurationSeconds,
      damageReductionPercent: data.damageReductionPercent,
      tenacityPercent: data.tenacityPercent,
      cadenceStacksApplied: 1,
      qwCooldownReductionPerBasicAttackSeconds: ALDEN.r.qwCooldownReductionPerBasicAttackSeconds,
      cooldownReductionInternalCooldownSeconds: ALDEN.r.cooldownReductionInternalCooldownSeconds,
      bossThreatMultiplier: ALDEN.r.bossThreatMultiplier,
    },
  };
}


export function calculateSerynAbilityAtRank(
  state: MatchState,
  heroEntityId: string,
  key: AbilityKey,
  rank: 1 | 2 | 3 | 4,
): AldenAbilityPreview {
  const hero = getRequiredHero(state, heroEntityId);
  if (hero.definitionId !== SERYN.id) throw new Error(`${heroEntityId} is not Seryn.`);
  const stats = calculateHeroStats(state, heroEntityId);
  const rankIndex = rank - 1;

  if (key === 'Q') {
    const data = SERYN.q.ranks[Math.min(rankIndex, SERYN.q.ranks.length - 1)];
    return {
      heroEntityId,
      key,
      rank,
      resourceCost: data.manaCost,
      cooldownSeconds: data.cooldownSeconds,
      damageType: 'physical',
      rawDamage: applyAbilityPowerToDamage(data.baseDamage + SERYN.q.totalAdRatio * stats.attackDamage, stats),
      healing: 0,
      effects: {
        range: SERYN.q.range,
        width: SERYN.q.width,
        castTimeSeconds: SERYN.q.castTimeSeconds,
        normalEnemyPierceDamageMultiplier: SERYN.q.normalEnemyPierceDamageMultiplier,
      },
    };
  }

  if (key === 'W') {
    const data = SERYN.w.ranks[Math.min(rankIndex, SERYN.w.ranks.length - 1)];
    return {
      heroEntityId,
      key,
      rank,
      resourceCost: data.manaCost,
      cooldownSeconds: data.cooldownSeconds,
      damageType: null,
      rawDamage: 0,
      healing: 0,
      effects: {
        dashRange: SERYN.w.dashRange,
        dashDurationSeconds: SERYN.w.dashDurationSeconds,
        buffDurationSeconds: SERYN.w.buffDurationSeconds,
        attackSpeedPercent: data.attackSpeedPercent,
      },
    };
  }

  if (key === 'E') {
    const data = SERYN.e.ranks[Math.min(rankIndex, SERYN.e.ranks.length - 1)];
    return {
      heroEntityId,
      key,
      rank,
      resourceCost: data.manaCost,
      cooldownSeconds: data.cooldownSeconds,
      damageType: 'magic',
      rawDamage: applyAbilityPowerToDamage(data.baseDamage + SERYN.e.totalAdRatio * stats.attackDamage, stats),
      healing: 0,
      effects: {
        castRange: SERYN.e.castRange,
        radius: SERYN.e.radius,
        centerRadius: SERYN.e.centerRadius,
        armDelaySeconds: SERYN.e.armDelaySeconds,
        slowPercent: data.slowPercent,
        slowDurationSeconds: SERYN.e.slowDurationSeconds,
        rootDurationSeconds: data.rootDurationSeconds,
      },
    };
  }

  const data = SERYN.r.ranks[Math.min(rankIndex, SERYN.r.ranks.length - 1)];
  const firstShot = applyAbilityPowerToDamage(data.shotBaseDamage + SERYN.r.totalAdRatioPerShot * stats.attackDamage, stats);
  const fullSequenceDamage = firstShot * (1 + (SERYN.r.shotCount - 1) * SERYN.r.repeatedHitDamageMultiplier);
  return {
    heroEntityId,
    key,
    rank,
    resourceCost: data.manaCost,
    cooldownSeconds: data.cooldownSeconds,
    damageType: 'physical',
    rawDamage: fullSequenceDamage,
    healing: 0,
    effects: {
      range: SERYN.r.range,
      width: SERYN.r.width,
      shotCount: SERYN.r.shotCount,
      startupSeconds: SERYN.r.startupSeconds,
      shotIntervalSeconds: SERYN.r.shotIntervalSeconds,
      repeatedHitDamageMultiplier: SERYN.r.repeatedHitDamageMultiplier,
      slowPercent: data.slowPercent,
      slowDurationSeconds: SERYN.r.slowDurationSeconds,
    },
  };
}

export function calculateHeroAbilityAtRank(
  state: MatchState,
  heroEntityId: string,
  key: AbilityKey,
  rank: 1 | 2 | 3 | 4,
): AldenAbilityPreview {
  const hero = getRequiredHero(state, heroEntityId);
  if (hero.definitionId === ALDEN.id) return calculateAldenAbilityAtRank(state, heroEntityId, key, rank);
  if (hero.definitionId === SERYN.id) return calculateSerynAbilityAtRank(state, heroEntityId, key, rank);
  throw new Error(`No ability preview resolver is registered for ${hero.definitionId}.`);
}

export function calculateAldenInnate(
  state: MatchState,
  heroEntityId: string,
  targetClass: CombatTargetClass = 'player',
): AldenInnatePreview {
  const hero = getRequiredHero(state, heroEntityId);
  if (hero.definitionId !== ALDEN.id) throw new Error(`${heroEntityId} is not Alden.`);
  const stats = calculateHeroStats(state, heroEntityId);
  const multiplier = targetClass === 'normal'
    ? ALDEN.innate.normalEnemyHealingMultiplier
    : ALDEN.innate.eliteBossPlayerHealingMultiplier;
  const healingPercent = ALDEN.innate.healingBasePercentMaxHp
    + ALDEN.innate.healingPercentMaxHpPerHeroLevel * (hero.level - 1);
  return {
    bonusDamage: ALDEN.innate.bonusDamageBase
      + ALDEN.innate.bonusDamagePerHeroLevel * (hero.level - 1)
      + ALDEN.innate.totalAdRatio * stats.attackDamage,
    healing: stats.maxHp * healingPercent / 100 * multiplier,
    requiredStacks: ALDEN.innate.maxStacks,
    stackInternalCooldownSeconds: ALDEN.innate.stackInternalCooldownSeconds,
    procLockoutSeconds: ALDEN.innate.procLockoutSeconds,
    empoweredAttackWindowSeconds: ALDEN.innate.empoweredAttackWindowSeconds,
  };
}

export function performAbilityAction(state: MatchState, input: AbilityActionInput): ActionResolution {
  const actor = getRequiredHero(state, input.actorHeroEntityId);
  if (getHeroDefinition(actor.definitionId).abilities[input.key].type === 'passive') {
    throw new Error(`${input.key} is passive and cannot be cast.`);
  }
  if (actor.definitionId === SERYN.id) return performSerynAbilityAction(state, input);
  if (actor.definitionId !== ALDEN.id) throw new Error(`No combat resolver is registered for ${actor.definitionId}.`);
  const rank = actor.abilityRanks[input.key];
  if (rank < 1 || rank > 4) throw new Error(`${input.key} has not been learned by ${actor.heroEntityId}.`);
  if (actor.cooldownReadyAtMs[input.key] > input.nowMs) {
    throw new Error(`${input.key} is on cooldown for ${(actor.cooldownReadyAtMs[input.key] - input.nowMs) / 1000}s.`);
  }

  const preview = calculateAldenAbilityAtRank(
    state,
    actor.heroEntityId,
    input.key,
    rank as 1 | 2 | 3 | 4,
  );
  if (actor.currentResource < preview.resourceCost) {
    throw new Error(`${actor.heroEntityId} does not have enough ${ALDEN.resource.displayName}.`);
  }

  const next = structuredClone(state);
  const nextActor = getRequiredHero(next, actor.heroEntityId);
  const actorHpBefore = nextActor.currentHp;
  nextActor.currentResource -= preview.resourceCost;
  nextActor.cooldownReadyAtMs[input.key] = input.nowMs + preview.cooldownSeconds * 1000;

  const targets = [...(input.targetHeroEntityIds ?? [])];
  const targetResults: ActionTargetResult[] = [];
  let actorHealing = 0;
  const notes: string[] = [];

  if (input.key === 'W') {
    nextActor.runtime.statuses['alden:guard'] = {
      id: 'alden:guard',
      sourceHeroEntityId: nextActor.heroEntityId,
      rank,
      expiresAtMs: input.nowMs + ALDEN.w.guardDurationSeconds * 1000,
      data: { preventedDamage: 0 },
    };
    notes.push('Alden enters frontal guard; W deals damage only if Represalia is later consumed by a basic attack.');
  } else if (input.key === 'Q') {
    targets.forEach((targetId, index) => {
      const target = getRequiredHero(next, targetId);
      const rankData = ALDEN.q.ranks[rank - 1];
      const actorStats = calculateHeroStats(next, nextActor.heroEntityId);
      const rawDamage = applyAbilityPowerToDamage(
        rankData.baseDamage + ALDEN.q.totalAdRatio * actorStats.attackDamage,
        actorStats,
      );
      const damage = applyDamageMutable(next, {
        sourceHeroEntityId: nextActor.heroEntityId,
        targetHeroEntityId: targetId,
        rawDamage,
        damageType: 'physical',
        isDirect: true,
        isFromFront: true,
      }, input.nowMs);
      const duration = applyTenacityToDuration(next, targetId, rankData.slowDurationSeconds, input.nowMs);
      const statusId = `cc:slow:${nextActor.heroEntityId}`;
      target.runtime.statuses[statusId] = timedStatus(statusId, nextActor.heroEntityId, input.nowMs, duration, {
        slowPercent: rankData.slowPercent,
      });
      if (index === 0) addCadenceStack(nextActor, targetId, input.nowMs, 1);
      targetResults.push(toTargetResult(targetId, rawDamage, damage, [statusId], 0));
    });
  } else if (input.key === 'E') {
    for (const targetId of targets) {
      const target = getRequiredHero(next, targetId);
      const stacks = getCadenceStacks(nextActor, targetId, input.nowMs);
      const rankData = ALDEN.e.ranks[rank - 1];
      const actorStats = calculateHeroStats(next, nextActor.heroEntityId);
      const rawDamage = applyAbilityPowerToDamage(
        rankData.activeBaseDamage
          + ALDEN.e.activeTotalAdRatio * actorStats.attackDamage
          + rankData.bonusDamagePerConsumedStack * stacks,
        actorStats,
      );
      const damage = applyDamageMutable(next, {
        sourceHeroEntityId: nextActor.heroEntityId,
        targetHeroEntityId: targetId,
        rawDamage,
        damageType: 'physical',
        isDirect: true,
        isFromFront: true,
      }, input.nowMs);
      const healing = actorStats.maxHp * (rankData.healingPercentMaxHpPerStack / 100) * stacks;
      actorHealing += healing;
      clearCadence(nextActor, targetId);
      targetResults.push(toTargetResult(targetId, rawDamage, damage, [], stacks));
      void target;
    }
  } else if (input.key === 'R') {
    const rankData = ALDEN.r.ranks[rank - 1];
    const actorStats = calculateHeroStats(next, nextActor.heroEntityId);
    nextActor.runtime.statuses['alden:majesty'] = {
      id: 'alden:majesty',
      sourceHeroEntityId: nextActor.heroEntityId,
      rank,
      expiresAtMs: input.nowMs + ALDEN.r.majestyDurationSeconds * 1000,
      data: {},
    };
    nextActor.runtime.timestamps['alden:last-majesty-cdr-proc'] = Number.NEGATIVE_INFINITY;

    for (const targetId of targets) {
      const target = getRequiredHero(next, targetId);
      const rawDamage = applyAbilityPowerToDamage(
        rankData.baseDamage + ALDEN.r.totalAdRatio * actorStats.attackDamage,
        actorStats,
      );
      const damage = applyDamageMutable(next, {
        sourceHeroEntityId: nextActor.heroEntityId,
        targetHeroEntityId: targetId,
        rawDamage,
        damageType: 'physical',
        isDirect: true,
        isFromFront: true,
      }, input.nowMs);
      const tauntDuration = applyTenacityToDuration(next, targetId, rankData.pvpTauntDurationSeconds, input.nowMs);
      const tauntStatusId = `cc:taunt:${nextActor.heroEntityId}`;
      target.runtime.statuses[tauntStatusId] = timedStatus(tauntStatusId, nextActor.heroEntityId, input.nowMs, tauntDuration);
      const judgedStatusId = `alden:judged:${nextActor.heroEntityId}`;
      target.runtime.statuses[judgedStatusId] = timedStatus(
        judgedStatusId,
        nextActor.heroEntityId,
        input.nowMs,
        ALDEN.r.majestyDurationSeconds,
      );
      addCadenceStack(nextActor, targetId, input.nowMs, 1);
      targetResults.push(toTargetResult(targetId, rawDamage, damage, [tauntStatusId, judgedStatusId], 0));
    }
  }

  if (actorHealing > 0) {
    const maxHp = calculateHeroStats(next, nextActor.heroEntityId).maxHp;
    const missingHp = Math.max(0, maxHp - nextActor.currentHp);
    const effectiveHealing = Math.min(actorHealing, missingHp);
    nextActor.currentHp += effectiveHealing;
    actorHealing = effectiveHealing;
  }

  return {
    state: next,
    result: {
      action: input.key,
      actorHeroEntityId: nextActor.heroEntityId,
      resourceSpent: preview.resourceCost,
      actorHealing,
      actorHpBefore,
      actorHpAfter: nextActor.currentHp,
      cooldownReadyAtMs: nextActor.cooldownReadyAtMs[input.key],
      targets: targetResults,
      notes,
    },
  };
}


function performSerynAbilityAction(state: MatchState, input: AbilityActionInput): ActionResolution {
  const actor = getRequiredHero(state, input.actorHeroEntityId);
  const rank = actor.abilityRanks[input.key];
  const maxRank = input.key === 'R' ? 3 : 4;
  if (rank < 1 || rank > maxRank) throw new Error(`${input.key} has not been learned by ${actor.heroEntityId}.`);
  if (actor.cooldownReadyAtMs[input.key] > input.nowMs) {
    throw new Error(`${input.key} is on cooldown for ${(actor.cooldownReadyAtMs[input.key] - input.nowMs) / 1000}s.`);
  }

  const preview = calculateSerynAbilityAtRank(
    state,
    actor.heroEntityId,
    input.key,
    rank as 1 | 2 | 3 | 4,
  );
  if (actor.currentResource < preview.resourceCost) {
    throw new Error(`${actor.heroEntityId} does not have enough ${SERYN.resource.displayName}.`);
  }

  const next = structuredClone(state);
  const nextActor = getRequiredHero(next, actor.heroEntityId);
  const actorHpBefore = nextActor.currentHp;
  nextActor.currentResource -= preview.resourceCost;
  nextActor.cooldownReadyAtMs[input.key] = input.nowMs + preview.cooldownSeconds * 1000;

  const targets = [...(input.targetHeroEntityIds ?? [])];
  const targetResults: ActionTargetResult[] = [];
  const notes: string[] = [];

  if (input.key === 'W') {
    nextActor.runtime.statuses['seryn:vector-step'] = {
      id: 'seryn:vector-step',
      sourceHeroEntityId: nextActor.heroEntityId,
      rank,
      expiresAtMs: input.nowMs + SERYN.w.buffDurationSeconds * 1000,
      data: { attackSpeedPercent: SERYN.w.ranks[rank - 1].attackSpeedPercent },
    };
    notes.push(`Paso de Vector: ${SERYN.w.dashRange} units dash and attack-speed buff armed.`);
  } else if (input.key === 'Q') {
    const targetId = targets[0];
    if (targetId) {
      const damage = applyDamageMutable(next, {
        sourceHeroEntityId: nextActor.heroEntityId,
        targetHeroEntityId: targetId,
        rawDamage: preview.rawDamage,
        damageType: 'physical',
        isDirect: true,
        isFromFront: true,
      }, input.nowMs);
      targetResults.push(toTargetResult(targetId, preview.rawDamage, damage, [], 0));
    }
  } else if (input.key === 'E') {
    const data = SERYN.e.ranks[rank - 1];
    targets.forEach((targetId, index) => {
      const target = getRequiredHero(next, targetId);
      const damage = applyDamageMutable(next, {
        sourceHeroEntityId: nextActor.heroEntityId,
        targetHeroEntityId: targetId,
        rawDamage: preview.rawDamage,
        damageType: 'magic',
        isDirect: true,
        isFromFront: true,
      }, input.nowMs);
      const statuses: string[] = [];
      const slowId = `cc:slow:${nextActor.heroEntityId}:seryn-e`;
      target.runtime.statuses[slowId] = timedStatus(
        slowId,
        nextActor.heroEntityId,
        input.nowMs,
        SERYN.e.slowDurationSeconds,
        { slowPercent: data.slowPercent },
      );
      statuses.push(slowId);
      // MatchState has no spatial coordinates. The first supplied target represents the
      // center hit; the live-world resolver performs the real 95-unit center-radius check.
      if (index === 0) {
        const rootId = `cc:root:${nextActor.heroEntityId}:seryn-e`;
        const rootDuration = applyTenacityToDuration(next, targetId, data.rootDurationSeconds, input.nowMs);
        target.runtime.statuses[rootId] = timedStatus(rootId, nextActor.heroEntityId, input.nowMs, rootDuration);
        statuses.push(rootId);
      }
      targetResults.push(toTargetResult(targetId, preview.rawDamage, damage, statuses, 0));
    });
  } else if (input.key === 'R') {
    const data = SERYN.r.ranks[rank - 1];
    targets.forEach(targetId => {
      const target = getRequiredHero(next, targetId);
      const damage = applyDamageMutable(next, {
        sourceHeroEntityId: nextActor.heroEntityId,
        targetHeroEntityId: targetId,
        rawDamage: preview.rawDamage,
        damageType: 'physical',
        isDirect: true,
        isFromFront: true,
      }, input.nowMs);
      const slowId = `cc:slow:${nextActor.heroEntityId}:seryn-r`;
      target.runtime.statuses[slowId] = timedStatus(
        slowId,
        nextActor.heroEntityId,
        input.nowMs,
        SERYN.r.slowDurationSeconds,
        { slowPercent: data.slowPercent },
      );
      targetResults.push(toTargetResult(targetId, preview.rawDamage, damage, [slowId], 0));
    });
    notes.push(`Meridiano Partido resolves ${SERYN.r.shotCount} shots; repeated hits use ${Math.round(SERYN.r.repeatedHitDamageMultiplier * 100)}% damage.`);
  }

  return {
    state: next,
    result: {
      action: input.key,
      actorHeroEntityId: nextActor.heroEntityId,
      resourceSpent: preview.resourceCost,
      actorHealing: 0,
      actorHpBefore,
      actorHpAfter: nextActor.currentHp,
      cooldownReadyAtMs: nextActor.cooldownReadyAtMs[input.key],
      targets: targetResults,
      notes,
    },
  };
}

export function performBasicAttackAction(state: MatchState, input: BasicAttackInput): ActionResolution {
  const actor = getRequiredHero(state, input.actorHeroEntityId);
  const target = getRequiredHero(state, input.targetHeroEntityId);
  const next = structuredClone(state);
  const nextActor = getRequiredHero(next, actor.heroEntityId);
  const nextTarget = getRequiredHero(next, target.heroEntityId);
  const stats = calculateHeroStats(next, nextActor.heroEntityId, {
    nowMs: input.nowMs,
    targetHeroEntityId: nextTarget.heroEntityId,
  });
  const actorHpBefore = nextActor.currentHp;
  const appliedStatuses: string[] = [];
  const notes: string[] = [];
  let rawDamage = stats.attackDamage * (input.critical ? 2 : 1);
  let actorHealing = 0;

  if (nextActor.definitionId === ALDEN.id) {
    const reprisal = getActiveStatus(nextActor, 'alden:reprisal', input.nowMs);
    if (reprisal?.rank) {
      const rankData = ALDEN.w.ranks[reprisal.rank - 1];
      rawDamage += applyAbilityPowerToDamage(
        rankData.reprisalBaseDamage + ALDEN.w.reprisalTotalAdRatio * stats.attackDamage,
        stats,
      );
      const stunDuration = applyTenacityToDuration(next, nextTarget.heroEntityId, rankData.stunDurationSeconds, input.nowMs);
      const statusId = `cc:stun:${nextActor.heroEntityId}`;
      nextTarget.runtime.statuses[statusId] = timedStatus(statusId, nextActor.heroEntityId, input.nowMs, stunDuration);
      appliedStatuses.push(statusId);
      delete nextActor.runtime.statuses['alden:reprisal'];
      notes.push('Represalia consumed.');
    }

    const oathReady = getActiveStatus(nextActor, 'alden:oath-ready', input.nowMs);
    if (oathReady) {
      const innate = calculateAldenInnate(next, nextActor.heroEntityId, 'player');
      rawDamage += innate.bonusDamage;
      actorHealing += innate.healing;
      delete nextActor.runtime.statuses['alden:oath-ready'];
      nextActor.runtime.counters['alden:steel'] = 0;
      nextActor.runtime.timestamps['alden:steel-lockout-until'] = input.nowMs + innate.procLockoutSeconds * 1000;
      notes.push('Voto del Muro Vivo consumed.');
    }
  }

  if (nextActor.definitionId === SERYN.id) {
    const distance = Math.max(0, input.distance ?? 0);
    const alignedId = `seryn:aligned:${nextTarget.heroEntityId}`;
    const aligned = getActiveStatus(nextActor, alignedId, input.nowMs);
    const lockoutKey = `seryn:sightline-lockout:${nextTarget.heroEntityId}`;
    const lockoutUntil = nextActor.runtime.timestamps[lockoutKey] ?? 0;

    if (aligned && distance >= SERYN.innate.minimumRange) {
      const bonusDamage = SERYN.innate.bonusDamageBase
        + SERYN.innate.bonusDamagePerHeroLevel * (nextActor.level - 1)
        + SERYN.innate.totalAdRatio * stats.attackDamage;
      rawDamage += bonusDamage;
      delete nextActor.runtime.statuses[alignedId];
      delete nextActor.runtime.targetCounters['seryn:sightline']?.[nextTarget.heroEntityId];
      nextActor.runtime.counters['seryn:sightline'] = 0;
      nextActor.runtime.timestamps[lockoutKey] = input.nowMs + SERYN.innate.perTargetLockoutSeconds * 1000;
      notes.push('Línea de Horizonte consumed.');
    } else if (distance >= SERYN.innate.minimumRange && input.nowMs >= lockoutUntil) {
      const bucket = nextActor.runtime.targetCounters['seryn:sightline'] ??= {};
      const existing = bucket[nextTarget.heroEntityId];
      const current = existing && existing.expiresAtMs > input.nowMs ? existing.stacks : 0;
      const stacks = Math.min(SERYN.innate.maxStacks, current + 1);
      bucket[nextTarget.heroEntityId] = {
        stacks,
        expiresAtMs: input.nowMs + SERYN.innate.stackDurationSeconds * 1000,
      };
      nextActor.runtime.counters['seryn:sightline'] = stacks;
      if (stacks >= SERYN.innate.maxStacks) {
        nextActor.runtime.statuses[alignedId] = timedStatus(
          alignedId,
          nextActor.heroEntityId,
          input.nowMs,
          SERYN.innate.alignedWindowSeconds,
        );
      }
    }
  }

  const damage = applyDamageMutable(next, {
    sourceHeroEntityId: nextActor.heroEntityId,
    targetHeroEntityId: nextTarget.heroEntityId,
    rawDamage,
    damageType: 'physical',
    isDirect: true,
    isFromFront: true,
  }, input.nowMs);

  if (nextActor.definitionId === ALDEN.id && nextActor.abilityRanks.E > 0) {
    addCadenceStack(nextActor, nextTarget.heroEntityId, input.nowMs, 1);
  }

  if (nextActor.definitionId === ALDEN.id) {
    maybeReduceAldenQwCooldowns(nextActor, nextTarget, input.nowMs);
  }

  if (actorHealing > 0) {
    const maxHp = calculateHeroStats(next, nextActor.heroEntityId).maxHp;
    const missingHp = Math.max(0, maxHp - nextActor.currentHp);
    const effectiveHealing = Math.min(actorHealing, missingHp);
    nextActor.currentHp += effectiveHealing;
    actorHealing = effectiveHealing;
  }

  return {
    state: next,
    result: {
      action: 'basic_attack',
      actorHeroEntityId: nextActor.heroEntityId,
      resourceSpent: 0,
      actorHealing,
      actorHpBefore,
      actorHpAfter: nextActor.currentHp,
      cooldownReadyAtMs: null,
      targets: [toTargetResult(nextTarget.heroEntityId, rawDamage, damage, appliedStatuses, 0)],
      notes,
    },
  };
}

export function applyDamagePacket(state: MatchState, packet: DamagePacket, nowMs: number): DamageResolution {
  const next = structuredClone(state);
  const result = applyDamageMutable(next, packet, nowMs);
  return { state: next, result };
}

export function calculateDamageAfterResistance(
  rawDamage: number,
  damageType: DamageType,
  physicalArmor: number,
  magicResistance: number,
  physicalDamageResistancePercent = 0,
): number {
  if (rawDamage <= 0) return 0;
  if (damageType === 'true') return rawDamage;
  const resistance = damageType === 'physical' ? physicalArmor : magicResistance;
  const resistanceMultiplier = resistance >= 0
    ? 100 / (100 + resistance)
    : 2 - 100 / (100 - resistance);
  const afterResistance = rawDamage * resistanceMultiplier;
  if (damageType !== 'physical') return afterResistance;
  const strengthReduction = Math.min(100, Math.max(0, physicalDamageResistancePercent));
  return afterResistance * (1 - strengthReduction / 100);
}

function applyDamageMutable(state: MatchState, packet: DamagePacket, nowMs: number): DamageResult {
  const target = getRequiredHero(state, packet.targetHeroEntityId);
  const snapshot = calculateCombatStats(state, target.heroEntityId, { nowMs });
  const hpBefore = target.currentHp;
  const afterResistance = calculateDamageAfterResistance(
    packet.rawDamage,
    packet.damageType,
    snapshot.stats.physicalArmor,
    snapshot.stats.magicResistance,
    snapshot.stats.physicalDamageResistancePercent,
  );

  let remaining = afterResistance;
  let preventedByGuard = 0;
  let preventedByGlobalReduction = 0;

  const guardApplies = packet.damageType !== 'true'
    && packet.isDirect
    && packet.isFromFront
    && snapshot.frontalDamageReductionPercent > 0;
  if (guardApplies) {
    preventedByGuard = remaining * snapshot.frontalDamageReductionPercent / 100;
    remaining -= preventedByGuard;
  }

  if (packet.damageType !== 'true' && snapshot.globalDamageReductionPercent > 0) {
    preventedByGlobalReduction = remaining * snapshot.globalDamageReductionPercent / 100;
    remaining -= preventedByGlobalReduction;
  }

  const finalDamage = Math.max(0, remaining);
  target.currentHp = Math.max(0, target.currentHp - finalDamage);

  if (target.definitionId === ALDEN.id) {
    processAldenDamageReaction(
      state,
      target,
      packet,
      nowMs,
      preventedByGuard,
      snapshot.stats.maxHp,
    );
  }

  return {
    rawDamage: packet.rawDamage,
    mitigatedByResistances: Math.max(0, packet.rawDamage - afterResistance),
    preventedByGuard,
    preventedByGlobalReduction,
    finalDamage,
    targetHpBefore: hpBefore,
    targetHpAfter: target.currentHp,
  };
}

function processAldenDamageReaction(
  state: MatchState,
  target: MatchHeroState,
  packet: DamagePacket,
  nowMs: number,
  preventedByGuard: number,
  maxHp: number,
): void {
  const guard = getActiveStatus(target, 'alden:guard', nowMs);
  if (guard?.rank && packet.isFromFront) {
    const accumulated = Number(guard.data?.preventedDamage ?? 0) + preventedByGuard;
    guard.data = { ...(guard.data ?? {}), preventedDamage: accumulated };
    const triggerDamage = maxHp * ALDEN.w.reprisalTriggerPreventedDamagePercentMaxHp / 100;
    if (accumulated >= triggerDamage || packet.includesHardCrowdControl) {
      target.runtime.statuses['alden:reprisal'] = {
        id: 'alden:reprisal',
        sourceHeroEntityId: target.heroEntityId,
        rank: guard.rank,
        expiresAtMs: nowMs + ALDEN.w.reprisalWindowSeconds * 1000,
      };
    }
  }

  if (!packet.sourceHeroEntityId || !packet.isDirect || !packet.isFromFront) return;
  if (packet.damageType === 'true') return;
  const source = state.heroes[packet.sourceHeroEntityId];
  if (!source || source.team === target.team) return;

  const existingReady = target.runtime.statuses['alden:oath-ready'];
  if (existingReady && existingReady.expiresAtMs <= nowMs) {
    delete target.runtime.statuses['alden:oath-ready'];
    target.runtime.counters['alden:steel'] = 0;
  }

  const lockoutUntil = target.runtime.timestamps['alden:steel-lockout-until'] ?? 0;
  const nextStackAt = target.runtime.timestamps['alden:next-steel-stack-at'] ?? 0;
  if (nowMs < lockoutUntil || nowMs < nextStackAt) return;

  const current = target.runtime.counters['alden:steel'] ?? 0;
  const nextStacks = Math.min(ALDEN.innate.maxStacks, current + 1);
  target.runtime.counters['alden:steel'] = nextStacks;
  target.runtime.timestamps['alden:next-steel-stack-at'] = nowMs + ALDEN.innate.stackInternalCooldownSeconds * 1000;

  if (nextStacks >= ALDEN.innate.maxStacks) {
    target.runtime.statuses['alden:oath-ready'] = {
      id: 'alden:oath-ready',
      sourceHeroEntityId: target.heroEntityId,
      stacks: ALDEN.innate.maxStacks,
      expiresAtMs: nowMs + ALDEN.innate.empoweredAttackWindowSeconds * 1000,
    };
  }
}

function addCadenceStack(actor: MatchHeroState, targetHeroEntityId: string, nowMs: number, amount: number): void {
  const bucket = actor.runtime.targetCounters['alden:cadence'] ??= {};
  const existing = bucket[targetHeroEntityId];
  const currentStacks = existing && existing.expiresAtMs > nowMs ? existing.stacks : 0;
  bucket[targetHeroEntityId] = {
    stacks: Math.min(ALDEN.e.maxCadenceStacks, currentStacks + amount),
    expiresAtMs: nowMs + ALDEN.e.cadenceDurationSeconds * 1000,
  };
}

function getCadenceStacks(actor: MatchHeroState, targetHeroEntityId: string, nowMs: number): number {
  const cadence = actor.runtime.targetCounters['alden:cadence']?.[targetHeroEntityId];
  if (!cadence || cadence.expiresAtMs <= nowMs) return 0;
  return Math.min(ALDEN.e.maxCadenceStacks, cadence.stacks);
}

function clearCadence(actor: MatchHeroState, targetHeroEntityId: string): void {
  delete actor.runtime.targetCounters['alden:cadence']?.[targetHeroEntityId];
}

function maybeReduceAldenQwCooldowns(actor: MatchHeroState, target: MatchHeroState, nowMs: number): void {
  const majesty = getActiveStatus(actor, 'alden:majesty', nowMs);
  const judged = getActiveStatus(target, `alden:judged:${actor.heroEntityId}`, nowMs);
  if (!majesty || !judged) return;
  const lastProc = actor.runtime.timestamps['alden:last-majesty-cdr-proc'] ?? Number.NEGATIVE_INFINITY;
  if (nowMs - lastProc < ALDEN.r.cooldownReductionInternalCooldownSeconds * 1000) return;

  const reductionMs = ALDEN.r.qwCooldownReductionPerBasicAttackSeconds * 1000;
  actor.cooldownReadyAtMs.Q = Math.max(nowMs, actor.cooldownReadyAtMs.Q - reductionMs);
  actor.cooldownReadyAtMs.W = Math.max(nowMs, actor.cooldownReadyAtMs.W - reductionMs);
  actor.runtime.timestamps['alden:last-majesty-cdr-proc'] = nowMs;
}

function applyTenacityToDuration(state: MatchState, targetHeroEntityId: string, durationSeconds: number, nowMs: number): number {
  const tenacity = calculateCombatStats(state, targetHeroEntityId, { nowMs }).tenacityPercent;
  return Math.max(0, durationSeconds * (1 - Math.min(100, Math.max(0, tenacity)) / 100));
}

function timedStatus(
  id: string,
  sourceHeroEntityId: string,
  nowMs: number,
  durationSeconds: number,
  data?: Record<string, number | string | boolean>,
): TimedStatusState {
  return {
    id,
    sourceHeroEntityId,
    expiresAtMs: nowMs + durationSeconds * 1000,
    data,
  };
}

function toTargetResult(
  targetHeroEntityId: string,
  rawDamage: number,
  damage: DamageResult,
  appliedStatuses: string[],
  consumedCadenceStacks: number,
): ActionTargetResult {
  return {
    targetHeroEntityId,
    rawDamage,
    finalDamage: damage.finalDamage,
    hpBefore: damage.targetHpBefore,
    hpAfter: damage.targetHpAfter,
    appliedStatuses,
    consumedCadenceStacks,
  };
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function getAldenDefinition(): AldenGameplayDefinition {
  return ALDEN;
}
