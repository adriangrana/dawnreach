import { getHeroDefinition } from '../heroes/catalog';
import type { AbilityKey } from '../heroes/types';
import { calculateAldenAbilityAtRank, performAbilityAction } from './combat';
import {
    addPlayerToMatch, assignSelectedHeroToPlayer, createMatchState, getRequiredHero,
    selectHeroForPlayer, setHeroLevel, setMatchPhase, upgradeHeroAbility,
} from './matchState';
import type { MatchState } from './types';
import { calculateHeroStats } from './stats';

export const ABILITY_KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];
export const LOCAL_HERO_ENTITY_ID = 'local-player:hero';

export function createPlayableMatch(
    heroId = 'H001',
    level = 11,
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

    state = setHeroLevel(state, LOCAL_HERO_ENTITY_ID, level);

    const definition = getHeroDefinition(heroId);

    let pointsRemaining = level;

    // Prioridad para el héroe de prueba:
    // ultimate primero cuando esté disponible,
    // después Q, W y E.
    const priority: AbilityKey[] = ['R', 'Q', 'W', 'E'];

    while (pointsRemaining > 0) {
        let upgraded = false;

        for (const key of priority) {
            const currentRank =
                state.heroes[LOCAL_HERO_ENTITY_ID].abilityRanks[key];

            const unlockLevels = definition.abilities[key].unlockLevels;

            if (currentRank >= unlockLevels.length) continue;

            const requiredLevel = unlockLevels[currentRank];

            if (requiredLevel > level) continue;

            state = upgradeHeroAbility(
                state,
                LOCAL_HERO_ENTITY_ID,
                key,
            );

            pointsRemaining--;
            upgraded = true;

            if (pointsRemaining === 0) break;
        }

        if (!upgraded) break;
    }

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
    const blockedReason = passive ? 'Pasiva'
        : rank === 0 ? `Se desbloquea en nivel ${ability.unlockLevels[0]}`
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
    const currentResource = Math.min(stats.maxResource, hero.currentResource + stats.resourceRegenPerSecond * elapsedMs / 1000);
    if (currentResource === hero.currentResource) return state;
    return { ...state, heroes: { ...state.heroes, [heroEntityId]: { ...hero, currentResource } } };
}