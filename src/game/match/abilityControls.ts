import { getHeroDefinition } from '../heroes/catalog';
import type { AbilityKey } from '../heroes/types';
import { calculateAldenAbilityAtRank, performAbilityAction } from './combat';
import {
    addPlayerToMatch, assignSelectedHeroToPlayer, createMatchState, getRequiredHero,
    selectHeroForPlayer, setHeroLevel, setMatchPhase,
} from './matchState';
import type { MatchState } from './types';
import { calculateHeroStats } from './stats';

export const ABILITY_KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];
export const LOCAL_HERO_ENTITY_ID = 'local-player:hero';

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
    const remainingMs = Math.max(0, hero.cooldownReadyAtMs[key] - nowMs);
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
    return performAbilityAction(state, { actorHeroEntityId: heroEntityId, key, nowMs }).state;
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
