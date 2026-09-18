import { getHeroDefinition } from '../heroes/catalog';
import type { AbilityKey, HeroId } from '../heroes/types';
import { calculateAldenAbilityAtRank, performAbilityAction } from './combat';
import {
    addPlayerToMatch, assignSelectedHeroToPlayer, createMatchState, getRequiredHero,
    selectHeroForPlayer, setHeroLevel, setMatchPhase,
} from './matchState';
import type { MatchState, TeamId, TeamSlotIndex } from './types';
import { calculateHeroStats } from './stats';

export const ABILITY_KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];
export const LOCAL_HERO_ENTITY_ID = 'local-player:hero';

// Live-world effects (currently Alden's R) can shorten an ability that is already cooling
// down even though the authoritative HUD/mana state lives in React's MatchState. Keep the
// reduction outside MatchState until the next cast: getAbilityControl exposes the effective
// remaining time immediately, and useHeroAbility folds the reduction into the cloned hero
// just before performAbilityAction validates/starts the next cooldown. Reductions never bank
// into a future cast because they are cleared as soon as that ability is successfully used.
const worldCooldownReductionMs = new Map<string, Partial<Record<AbilityKey, number>>>();

function cooldownReductionsFor(heroEntityId: string) {
    let reductions = worldCooldownReductionMs.get(heroEntityId);
    if (!reductions) {
        reductions = {};
        worldCooldownReductionMs.set(heroEntityId, reductions);
    }
    return reductions;
}

function getWorldCooldownReductionMs(heroEntityId: string, key: AbilityKey) {
    return Math.max(0, cooldownReductionsFor(heroEntityId)[key] ?? 0);
}

export function reduceHeroAbilityCooldown(
    heroEntityId: string,
    key: AbilityKey,
    amountMs: number,
) {
    if (!Number.isFinite(amountMs) || amountMs <= 0) return;
    const reductions = cooldownReductionsFor(heroEntityId);
    reductions[key] = Math.max(0, (reductions[key] ?? 0) + amountMs);
}

function clearWorldCooldownReduction(heroEntityId: string, key: AbilityKey) {
    const reductions = worldCooldownReductionMs.get(heroEntityId);
    if (!reductions) return;
    delete reductions[key];
    if (Object.keys(reductions).length === 0) worldCooldownReductionMs.delete(heroEntityId);
}

export type PlayableRosterEntry = Readonly<{
    playerId: string;
    displayName: string;
    team: TeamId;
    slotIndex: TeamSlotIndex;
    heroId: HeroId;
}>;

export function createPlayableRosterMatch(
    matchId: string,
    roster: readonly PlayableRosterEntry[],
    localPlayerId: string,
    nowMs = 0,
): MatchState {
    let state = createMatchState(matchId || 'online-match', nowMs);

    for (const entry of roster) {
        state = addPlayerToMatch(state, {
            playerId: entry.playerId,
            displayName: entry.displayName,
            team: entry.team,
            slotIndex: entry.slotIndex,
        });
        state = selectHeroForPlayer(state, entry.playerId, entry.heroId);
        state = assignSelectedHeroToPlayer(
            state,
            entry.playerId,
            entry.playerId === localPlayerId ? LOCAL_HERO_ENTITY_ID : `remote:${entry.playerId}:hero`,
        );
    }

    return setMatchPhase(state, 'in_progress');
}

export function createPlayableMatch(
    heroId = 'H001',
    level = 1,
    nowMs = 0,
): MatchState {
    let state = createMatchState('local-match', nowMs);

    state = addPlayerToMatch(state, {
        playerId: 'local-player',
        displayName: 'Player',
        team: 'dawn',
        slotIndex: 1,
    });

    state = selectHeroForPlayer(state, 'local-player', heroId);
    state = assignSelectedHeroToPlayer(
        state,
        'local-player',
        LOCAL_HERO_ENTITY_ID,
    );

    // Ability ranks intentionally remain at zero. Hero levels grant unspent points;
    // the player decides which eligible ability receives each point.
    if (level !== 1) state = setHeroLevel(state, LOCAL_HERO_ENTITY_ID, level);

    return setMatchPhase(state, 'in_progress');
}

export function getAbilityControl(state: MatchState, heroEntityId: string, key: AbilityKey, nowMs: number) {
    const hero = getRequiredHero(state, heroEntityId);
    const definition = getHeroDefinition(hero.definitionId);
    const ability = definition.abilities[key];
    const rank = hero.abilityRanks[key];
    const passive = ability.type === 'passive';
    const preview = hero.definitionId === 'H001' && !passive
        ? calculateAldenAbilityAtRank(state, heroEntityId, key, Math.max(1, rank) as 1 | 2 | 3 | 4)
        : null;
    const effectiveReadyAtMs = hero.cooldownReadyAtMs[key] - getWorldCooldownReductionMs(heroEntityId, key);
    const remainingMs = Math.max(0, effectiveReadyAtMs - nowMs);
    const firstUnlockLevel = ability.unlockLevels[0];
    const blockedReason = passive ? 'Pasiva'
        : rank === 0 ? (hero.level >= firstUnlockLevel ? 'Sin aprender' : `Se desbloquea en nivel ${firstUnlockLevel}`)
            : hero.currentHp <= 0 ? 'Heroe derrotado'
                : state.phase !== 'in_progress' ? 'Partida inactiva'
                    : !preview ? 'Habilidad no disponible'
                        : remainingMs > 0 ? 'En recarga'
                            : hero.currentResource < preview.resourceCost ? `${definition.resource.displayName} insuficiente`
                                : null;
    return { ability, rank, passive, preview, remainingMs, blockedReason, canUse: blockedReason === null };
}

export function useHeroAbility(state: MatchState, heroEntityId: string, key: AbilityKey, nowMs: number): MatchState {
    if (!getAbilityControl(state, heroEntityId, key, nowMs).canUse) return state;

    const reductionMs = getWorldCooldownReductionMs(heroEntityId, key);
    let effectiveState = state;
    if (reductionMs > 0) {
        const hero = getRequiredHero(state, heroEntityId);
        effectiveState = {
            ...state,
            heroes: {
                ...state.heroes,
                [heroEntityId]: {
                    ...hero,
                    cooldownReadyAtMs: {
                        ...hero.cooldownReadyAtMs,
                        [key]: Math.max(0, hero.cooldownReadyAtMs[key] - reductionMs),
                    },
                },
            },
        };
    }

    const result = performAbilityAction(effectiveState, { actorHeroEntityId: heroEntityId, key, nowMs }).state;
    clearWorldCooldownReduction(heroEntityId, key);
    return result;
}

export function recoverHeroResource(state: MatchState, heroEntityId: string, elapsedMs: number, nowMs: number): MatchState {
    const hero = getRequiredHero(state, heroEntityId);
    if (hero.currentHp <= 0 || state.phase !== 'in_progress' || elapsedMs <= 0) return state;
    const stats = calculateHeroStats(state, heroEntityId, { nowMs });
    const elapsedSeconds = elapsedMs / 1000;
    const currentHp = Math.min(stats.maxHp, hero.currentHp + stats.hpRegenPerSecond * elapsedSeconds);
    const currentResource = Math.min(stats.maxResource, hero.currentResource + stats.resourceRegenPerSecond * elapsedSeconds);
    if (currentHp === hero.currentHp && currentResource === hero.currentResource) return state;
    return {
        ...state,
        heroes: {
            ...state.heroes,
            [heroEntityId]: { ...hero, currentHp, currentResource },
        },
    };
}
