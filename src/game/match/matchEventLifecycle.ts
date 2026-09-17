import type {
  MatchEventParticipant,
  MatchPauseMatchEvent,
  PlayerConnectionMatchEvent,
  ThroneUnderAttackMatchEvent,
} from './matchEvents';

export const THRONE_ATTACK_ALERT_COOLDOWN_MS = 12_000;

export type ThroneDamageContext = Readonly<{
  throne: MatchEventParticipant;
  attacker: MatchEventParticipant | null;
  currentHp: number;
  maxHp: number;
  amount: number;
  atMs: number;
}>;

function finiteTime(atMs: number) {
  return Number.isFinite(atMs) ? atMs : 0;
}

export class MatchLifecycleTracker {
  private readonly lastThroneAlertAtMs = new Map<string, number>();

  consumeThroneDamage(context: ThroneDamageContext): ThroneUnderAttackMatchEvent | null {
    const { throne, attacker, currentHp, maxHp, amount } = context;
    const atMs = finiteTime(context.atMs);
    if (throne.entityId !== 'blue-throne' && throne.entityId !== 'red-throne') return null;
    if (throne.team === 'neutral' || currentHp <= 0 || maxHp <= 0 || amount <= 0) return null;
    if (!attacker || attacker.team === 'neutral' || attacker.team === throne.team) return null;

    const previous = this.lastThroneAlertAtMs.get(throne.entityId);
    if (previous !== undefined && atMs >= previous && atMs - previous < THRONE_ATTACK_ALERT_COOLDOWN_MS) {
      return null;
    }

    this.lastThroneAlertAtMs.set(throne.entityId, atMs);
    return {
      type: 'throne_under_attack',
      eventId: `throne_under_attack:${throne.entityId}:${atMs.toFixed(3)}`,
      atMs,
      throne,
      attacker,
      currentHp: Math.max(0, currentHp),
      maxHp,
    };
  }

  reset() {
    this.lastThroneAlertAtMs.clear();
  }
}

export function buildPauseMatchEvent(
  paused: boolean,
  actorPlayerId: string | null,
  atMs: number,
): MatchPauseMatchEvent {
  const type = paused ? 'match_paused' : 'match_resumed';
  const resolvedAtMs = finiteTime(atMs);
  return {
    type,
    eventId: `${type}:${actorPlayerId ?? 'system'}:${resolvedAtMs.toFixed(3)}`,
    atMs: resolvedAtMs,
    actorPlayerId,
  };
}

export function buildPlayerConnectionMatchEvent(
  connected: boolean,
  playerId: string,
  displayName: string,
  team: PlayerConnectionMatchEvent['team'],
  atMs: number,
): PlayerConnectionMatchEvent {
  const type = connected ? 'player_reconnected' : 'player_disconnected';
  const resolvedAtMs = finiteTime(atMs);
  return {
    type,
    eventId: `${type}:${playerId}:${resolvedAtMs.toFixed(3)}`,
    atMs: resolvedAtMs,
    playerId,
    displayName,
    team,
  };
}
