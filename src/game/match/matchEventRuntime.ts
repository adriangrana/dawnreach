import {
  getMostRecentAttackOnTarget,
  getWorldAttackEventsAfter,
  subscribeWorldCombatEvents,
  type WorldAttackEvent,
} from '../entities/worldCombatBridge';
import {
  buildDeathMatchEvent,
  publishMatchEvent,
  type MatchEventEntityKind,
  type MatchEventParticipant,
  type MatchEventTeam,
} from './matchEvents';
import {
  matchEventKindFromEntityId,
  matchEventLabelForEntityId,
  matchEventTeamFromEntityId,
} from './matchEventParticipants';

const HERO_ASSIST_WINDOW_MS = 10_000;
const KILL_SOURCE_LOOKBACK_MS = 3_000;
const processedDeaths = new Set<string>();
let installed = false;

function participant(
  entityId: string,
  kind?: MatchEventEntityKind,
  team?: MatchEventTeam,
): MatchEventParticipant {
  const resolvedKind = kind ?? matchEventKindFromEntityId(entityId);
  const resolvedTeam = team ?? matchEventTeamFromEntityId(entityId);
  return {
    entityId,
    kind: resolvedKind,
    team: resolvedTeam,
    label: matchEventLabelForEntityId(entityId, resolvedKind),
  };
}

function participantFromAttack(
  entityId: string,
  attack: WorldAttackEvent | undefined,
  role: 'attacker' | 'target',
): MatchEventParticipant {
  if (!attack) return participant(entityId);
  const kind = role === 'attacker' ? attack.attackerKind : attack.targetKind;
  const team = role === 'attacker' ? attack.attackerTeam : attack.targetTeam;
  return participant(entityId, kind, team);
}

function collectHeroAssists(
  targetId: string,
  atMs: number,
  killerId: string | null,
  victimTeam: MatchEventTeam,
): MatchEventParticipant[] {
  const seen = new Set<string>();
  const assists: MatchEventParticipant[] = [];
  const attacks = getWorldAttackEventsAfter(0);

  for (let index = attacks.length - 1; index >= 0; index--) {
    const attack = attacks[index];
    const ageMs = atMs - attack.atMs;
    if (ageMs > HERO_ASSIST_WINDOW_MS) break;
    if (ageMs < -4 || attack.targetId !== targetId) continue;
    if (attack.targetKind !== 'hero' || attack.attackerKind !== 'hero') continue;
    if (attack.attackerId === killerId || seen.has(attack.attackerId)) continue;
    if (attack.attackerTeam === attack.targetTeam || attack.attackerTeam === victimTeam) continue;
    seen.add(attack.attackerId);
    assists.push(participantFromAttack(attack.attackerId, attack, 'attacker'));
  }

  return assists;
}

/**
 * Bridges the current world-combat stream into semantic match events. When MatchState becomes
 * server-authoritative this bridge can be replaced without changing the feed/UI consumers.
 */
export function installMatchEventRuntime() {
  if (installed) return () => undefined;
  installed = true;

  const unsubscribe = subscribeWorldCombatEvents((event) => {
    if (event.reason !== 'death' || event.alive || event.currentHp > 0) return;
    const deathKey = `${event.entityId}:${event.atMs.toFixed(3)}`;
    if (processedDeaths.has(deathKey)) return;
    processedDeaths.add(deathKey);
    if (processedDeaths.size > 256) {
      const oldest = processedDeaths.values().next().value as string | undefined;
      if (oldest) processedDeaths.delete(oldest);
    }

    const recentAttack = getMostRecentAttackOnTarget(event.entityId, event.atMs, KILL_SOURCE_LOOKBACK_MS);
    const target = participantFromAttack(event.entityId, recentAttack, 'target');
    const killerId = event.sourceEntityId ?? recentAttack?.attackerId ?? null;
    const killer = killerId
      ? participantFromAttack(killerId, recentAttack?.attackerId === killerId ? recentAttack : undefined, 'attacker')
      : null;
    const assists = target.kind === 'hero'
      ? collectHeroAssists(target.entityId, event.atMs, killerId, target.team)
      : [];
    const matchEvent = buildDeathMatchEvent({ target, killer, assists, atMs: event.atMs });
    if (matchEvent) publishMatchEvent(matchEvent);
  });

  return () => {
    unsubscribe();
    processedDeaths.clear();
    installed = false;
  };
}
