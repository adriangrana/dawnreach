import {
  publishMatchEvent,
  subscribeMatchEvents,
  type FirstBloodMatchEvent,
  type HeroKilledMatchEvent,
  type MatchEvent,
  type MatchEventParticipant,
  type MultiKillMatchEvent,
} from './matchEvents';

export const MULTI_KILL_WINDOW_MS = 10_000;
export const MAX_MULTI_KILL_COUNT = 5;

type KillSeries = {
  lastKillAtMs: number;
  victims: MatchEventParticipant[];
};

function validEnemyKill(event: HeroKilledMatchEvent) {
  const killer = event.killer;
  return Boolean(
    killer
    && killer.team !== 'neutral'
    && event.victim.team !== 'neutral'
    && killer.team !== event.victim.team,
  );
}

export class MatchAnnouncementTracker {
  private firstBloodEmitted = false;
  private readonly killSeries = new Map<string, KillSeries>();

  consume(event: MatchEvent): readonly MatchEvent[] {
    if (event.type !== 'hero_killed' || !validEnemyKill(event) || !event.killer) return [];

    const derived: MatchEvent[] = [];
    if (!this.firstBloodEmitted) {
      this.firstBloodEmitted = true;
      const firstBlood: FirstBloodMatchEvent = {
        type: 'first_blood',
        eventId: `first_blood:${event.eventId}`,
        atMs: event.atMs,
        killer: event.killer,
        victim: event.victim,
      };
      derived.push(firstBlood);
    }

    if (event.killer.kind !== 'hero') return derived;

    const previous = this.killSeries.get(event.killer.entityId);
    const withinWindow = Boolean(
      previous
      && event.atMs >= previous.lastKillAtMs
      && event.atMs - previous.lastKillAtMs <= MULTI_KILL_WINDOW_MS,
    );
    const victims = withinWindow
      ? [...(previous?.victims ?? []), event.victim]
      : [event.victim];
    const boundedVictims = victims.slice(-MAX_MULTI_KILL_COUNT);
    this.killSeries.set(event.killer.entityId, {
      lastKillAtMs: event.atMs,
      victims: boundedVictims,
    });

    if (boundedVictims.length >= 2) {
      const multiKill: MultiKillMatchEvent = {
        type: 'multi_kill',
        eventId: `multi_kill:${event.killer.entityId}:${boundedVictims.length}:${event.eventId}`,
        atMs: event.atMs,
        killer: event.killer,
        victim: event.victim,
        victims: [...boundedVictims],
        count: boundedVictims.length,
      };
      derived.push(multiKill);
    }

    return derived;
  }

  reset() {
    this.firstBloodEmitted = false;
    this.killSeries.clear();
  }
}

let installed = false;

/** Derives presentation-level match milestones from authoritative semantic gameplay events. */
export function installMatchEventAnnouncementRuntime() {
  if (installed) return () => undefined;
  installed = true;
  const tracker = new MatchAnnouncementTracker();
  const unsubscribe = subscribeMatchEvents((event) => {
    if (event.type !== 'hero_killed') return;
    for (const derived of tracker.consume(event)) publishMatchEvent(derived);
  });

  return () => {
    installed = false;
    unsubscribe();
    tracker.reset();
  };
}
