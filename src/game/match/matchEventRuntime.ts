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

const HERO_ASSIST_WINDOW_MS = 10_000;
const KILL_SOURCE_LOOKBACK_MS = 3_000;
const processedDeaths = new Set<string>();
let installed = false;

function titleCase(value: string) {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function teamFromEntityId(entityId: string): MatchEventTeam {
  if (entityId.startsWith('blue-')) return 'blue';
  if (entityId.startsWith('red-')) return 'red';
  return 'neutral';
}

function kindFromEntityId(entityId: string): MatchEventEntityKind {
  if (entityId === 'blue-throne' || entityId === 'red-throne') return 'building';
  if (entityId.includes('-hero-') || entityId.startsWith('hero-')) return 'hero';
  if (entityId.includes('-tower-') || entityId.startsWith('tower-')) return 'tower';
  if (entityId.includes('-creep-') || entityId.startsWith('creep-')) return 'creep';
  if (entityId.includes('drake') || entityId.includes('aurelios') || entityId.includes('jungle')) return 'jungle-creature';
  return 'unknown';
}

function labelFromEntityId(entityId: string, kind: MatchEventEntityKind) {
  if (entityId === 'blue-throne') return 'Trono del Alba';
  if (entityId === 'red-throne') return 'Trono del Ocaso';
  if (entityId.toLowerCase().includes('radiant-drake') || entityId.toLowerCase().includes('aurelios')) return 'Aurelios';

  const heroMarker = '-hero-';
  const heroIndex = entityId.indexOf(heroMarker);
  if (kind === 'hero' && heroIndex >= 0) return titleCase(entityId.slice(heroIndex + heroMarker.length));

  if (kind === 'tower') {
    const withoutTeam = entityId.replace(/^(blue|red)-/, '').replace(/^tower-/, '');
    return `Torre ${titleCase(withoutTeam.replace(/^tower-/, ''))}`.trim();
  }

  return titleCase(entityId.replace(/^(blue|red|neutral)-/, '')) || 'Entidad';
}

function participant(
  entityId: string,
  kind?: MatchEventEntityKind,
  team?: MatchEventTeam,
): MatchEventParticipant {
  const resolvedKind = kind ?? kindFromEntityId(entityId);
  const resolvedTeam = team ?? teamFromEntityId(entityId);
  return {
    entityId,
    kind: resolvedKind,
    team: resolvedTeam,
    label: labelFromEntityId(entityId, resolvedKind),
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
