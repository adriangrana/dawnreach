import {
  publishMatchEvent,
  subscribeMatchEvents,
  type FirstBloodMatchEvent,
  type HeroKilledMatchEvent,
  type KillStreakMatchEvent,
  type MatchEvent,
  type MatchEventParticipant,
  type MultiKillMatchEvent,
  type ShutdownMatchEvent,
} from './matchEvents';

export const MULTI_KILL_WINDOW_MS = 10_000;
export const MAX_MULTI_KILL_COUNT = 5;
export const KILL_STREAK_THRESHOLD = 3;

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
  private readonly killStreaks = new Map<string, number>();

  consume(event: MatchEvent): readonly MatchEvent[] {
    if (event.type !== 'hero_killed') return [];

    const victimStreak = this.killStreaks.get(event.victim.entityId) ?? 0;
    if (event.victim.kind === 'hero') {
      // Death always ends both a long-form kill streak and any rapid multi-kill chain, even when
      // the death is environmental or self-inflicted. Only a valid enemy killer earns derived credit.
      this.killStreaks.delete(event.victim.entityId);
      this.killSeries.delete(event.victim.entityId);
    }

    if (!validEnemyKill(event) || !event.killer) return [];

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

    if (victimStreak >= KILL_STREAK_THRESHOLD) {
      const shutdown: ShutdownMatchEvent = {
        type: 'shutdown',
        eventId: `shutdown:${event.victim.entityId}:${event.eventId}`,
        atMs: event.atMs,
        killer: event.killer,
        victim: event.victim,
        endedStreak: victimStreak,
      };
      derived.push(shutdown);
    }

    const nextKillStreak = (this.killStreaks.get(event.killer.entityId) ?? 0) + 1;
    this.killStreaks.set(event.killer.entityId, nextKillStreak);
    if (nextKillStreak >= KILL_STREAK_THRESHOLD) {
      const killStreak: KillStreakMatchEvent = {
        type: 'kill_streak',
        eventId: `kill_streak:${event.killer.entityId}:${nextKillStreak}:${event.eventId}`,
        atMs: event.atMs,
        killer: event.killer,
        count: nextKillStreak,
      };
      derived.push(killStreak);
    }

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
    this.killStreaks.clear();
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
