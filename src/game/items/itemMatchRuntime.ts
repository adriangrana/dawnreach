import type { MatchState } from '../match/types';
import { advanceItemActiveEffects, syncHeroItemRuntime } from './shopRuntime';

/**
 * Advances item-owned timed effects for every hero currently instantiated in the match.
 * This is the authoritative 5v5 entry point: callers do not need to know which hero is
 * Alden (or any other definition), only the heroEntityIds present in MatchState.heroes.
 */
export function advanceAllHeroItemEffects(
  state: MatchState,
  elapsedMs: number,
  nowMs: number,
): MatchState {
  let next = state;
  for (const heroEntityId of Object.keys(next.heroes)) {
    next = advanceItemActiveEffects(next, heroEntityId, elapsedMs, nowMs);
  }
  return next;
}

/** Publishes item-derived runtime stats for every hero without advancing time. */
export function syncAllHeroItemRuntimes(state: MatchState, nowMs: number): void {
  for (const heroEntityId of Object.keys(state.heroes)) {
    syncHeroItemRuntime(state, heroEntityId, nowMs);
  }
}
