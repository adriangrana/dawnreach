import {
  getMostRecentAttackOnTarget,
  getWorldEntityRuntime,
  subscribeWorldCombatEvents,
  type WorldAttackEvent,
} from '../entities/worldCombatBridge';
import {
  buildPauseMatchEvent,
  MatchLifecycleTracker,
} from './matchEventLifecycle';
import {
  publishMatchEvent,
  type MatchEventEntityKind,
  type MatchEventParticipant,
  type MatchEventTeam,
} from './matchEvents';
import {
  MATCH_PAUSE_STATE_EVENT,
  toMatchGameTimeMs,
  type MatchPauseStateDetail,
} from './matchPauseRuntime';

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

function kindFromAttack(entityId: string, attack: WorldAttackEvent | undefined): MatchEventEntityKind {
  if (attack) {
    if (attack.attackerKind === 'hero') return 'hero';
    if (attack.attackerKind === 'creep') return 'creep';
    if (attack.attackerKind === 'tower') return 'tower';
    if (attack.attackerKind === 'building') return 'building';
    if (attack.attackerKind === 'shop') return 'shop';
  }
  if (entityId.includes('-hero-') || entityId.startsWith('hero-')) return 'hero';
  if (entityId.includes('-tower-') || entityId.startsWith('tower-')) return 'tower';
  if (entityId.includes('-creep-') || entityId.startsWith('creep-')) return 'creep';
  return 'unknown';
}

function labelFor(entityId: string, kind: MatchEventEntityKind) {
  const heroMarker = '-hero-';
  const heroIndex = entityId.indexOf(heroMarker);
  if (kind === 'hero' && heroIndex >= 0) return titleCase(entityId.slice(heroIndex + heroMarker.length));
  return titleCase(entityId.replace(/^(blue|red|neutral)-/, '')) || 'Entidad';
}

function attackerParticipant(entityId: string, attack: WorldAttackEvent | undefined): MatchEventParticipant {
  const kind = kindFromAttack(entityId, attack);
  return {
    entityId,
    team: attack?.attackerTeam ?? teamFromEntityId(entityId),
    kind,
    label: labelFor(entityId, kind),
  };
}

function throneParticipant(entityId: 'blue-throne' | 'red-throne'): MatchEventParticipant {
  return {
    entityId,
    team: entityId === 'blue-throne' ? 'blue' : 'red',
    kind: 'building',
    label: entityId === 'blue-throne' ? 'Trono del Alba' : 'Trono del Ocaso',
  };
}

/**
 * Publishes lifecycle events that are not deaths: pause/resume and throttled throne-pressure alerts.
 * Player disconnect/reconnect uses the same semantic event contract but is intentionally left to the
 * future authenticated multiplayer session, which is the only layer that can authoritatively know it.
 */
export function installMatchEventLifecycleRuntime() {
  if (installed) return () => undefined;
  installed = true;

  const tracker = new MatchLifecycleTracker();
  let lastPausedByPlayerId: string | null = null;

  const unsubscribeCombat = subscribeWorldCombatEvents((event) => {
    if (event.reason !== 'damage' || event.currentHp <= 0) return;
    if (event.entityId !== 'blue-throne' && event.entityId !== 'red-throne') return;

    const recentAttack = getMostRecentAttackOnTarget(event.entityId, event.atMs, 3_000);
    const attackerId = event.sourceEntityId ?? recentAttack?.attackerId ?? null;
    if (!attackerId) return;

    const runtime = getWorldEntityRuntime(event.entityId);
    const alert = tracker.consumeThroneDamage({
      throne: throneParticipant(event.entityId),
      attacker: attackerParticipant(attackerId, recentAttack?.attackerId === attackerId ? recentAttack : undefined),
      currentHp: event.currentHp,
      maxHp: runtime?.maxHp ?? Math.max(event.currentHp, 1),
      amount: event.amount ?? 0,
      atMs: event.atMs,
    });
    if (alert) publishMatchEvent(alert);
  });

  const onPauseState = (event: Event) => {
    const detail = (event as CustomEvent<MatchPauseStateDetail>).detail;
    if (!detail || typeof detail.paused !== 'boolean') return;
    const actorPlayerId = detail.paused ? detail.pausedByPlayerId : lastPausedByPlayerId;
    if (detail.paused) lastPausedByPlayerId = detail.pausedByPlayerId;
    publishMatchEvent(buildPauseMatchEvent(
      detail.paused,
      actorPlayerId,
      toMatchGameTimeMs(detail.changedAtMs),
    ));
    if (!detail.paused) lastPausedByPlayerId = null;
  };

  window.addEventListener(MATCH_PAUSE_STATE_EVENT, onPauseState as EventListener);

  return () => {
    installed = false;
    tracker.reset();
    lastPausedByPlayerId = null;
    unsubscribeCombat();
    window.removeEventListener(MATCH_PAUSE_STATE_EVENT, onPauseState as EventListener);
  };
}
