export type MatchEventTeam = 'blue' | 'red' | 'neutral';
export type MatchEventEntityKind =
  | 'hero'
  | 'creep'
  | 'tower'
  | 'building'
  | 'shop'
  | 'jungle-creature'
  | 'unknown';

export type MatchEventParticipant = Readonly<{
  entityId: string;
  team: MatchEventTeam;
  kind: MatchEventEntityKind;
  label: string;
  heroId?: string | null;
}>;

type MatchEventBase = Readonly<{
  eventId: string;
  atMs: number;
}>;

export type HeroKilledMatchEvent = MatchEventBase & Readonly<{
  type: 'hero_killed';
  killer: MatchEventParticipant | null;
  victim: MatchEventParticipant;
  assists: readonly MatchEventParticipant[];
}>;

export type TowerDestroyedMatchEvent = MatchEventBase & Readonly<{
  type: 'tower_destroyed';
  destroyer: MatchEventParticipant | null;
  tower: MatchEventParticipant;
}>;

export type ObjectiveKilledMatchEvent = MatchEventBase & Readonly<{
  type: 'objective_killed';
  killer: MatchEventParticipant | null;
  objective: MatchEventParticipant;
}>;

export type ThroneDestroyedMatchEvent = MatchEventBase & Readonly<{
  type: 'throne_destroyed';
  destroyer: MatchEventParticipant | null;
  throne: MatchEventParticipant;
  winnerTeam: Exclude<MatchEventTeam, 'neutral'> | 'neutral';
}>;

export type ThroneUnderAttackMatchEvent = MatchEventBase & Readonly<{
  type: 'throne_under_attack';
  throne: MatchEventParticipant;
  attacker: MatchEventParticipant;
  currentHp: number;
  maxHp: number;
}>;

export type FirstBloodMatchEvent = MatchEventBase & Readonly<{
  type: 'first_blood';
  killer: MatchEventParticipant;
  victim: MatchEventParticipant;
}>;

export type MultiKillMatchEvent = MatchEventBase & Readonly<{
  type: 'multi_kill';
  killer: MatchEventParticipant;
  victim: MatchEventParticipant;
  victims: readonly MatchEventParticipant[];
  count: number;
}>;

export type KillStreakMatchEvent = MatchEventBase & Readonly<{
  type: 'kill_streak';
  killer: MatchEventParticipant;
  count: number;
}>;

export type ShutdownMatchEvent = MatchEventBase & Readonly<{
  type: 'shutdown';
  killer: MatchEventParticipant;
  victim: MatchEventParticipant;
  endedStreak: number;
}>;

export type MatchPauseMatchEvent = MatchEventBase & Readonly<{
  type: 'match_paused' | 'match_resumed';
  actorPlayerId: string | null;
}>;

export type PlayerConnectionMatchEvent = MatchEventBase & Readonly<{
  type: 'player_disconnected' | 'player_reconnected';
  playerId: string;
  displayName: string;
  team: Exclude<MatchEventTeam, 'neutral'>;
}>;

export type MatchEvent =
  | HeroKilledMatchEvent
  | TowerDestroyedMatchEvent
  | ObjectiveKilledMatchEvent
  | ThroneDestroyedMatchEvent
  | ThroneUnderAttackMatchEvent
  | FirstBloodMatchEvent
  | MultiKillMatchEvent
  | KillStreakMatchEvent
  | ShutdownMatchEvent
  | MatchPauseMatchEvent
  | PlayerConnectionMatchEvent;

export type MatchDeathEventContext = Readonly<{
  target: MatchEventParticipant;
  killer: MatchEventParticipant | null;
  assists?: readonly MatchEventParticipant[];
  atMs: number;
}>;

type MatchEventListener = (event: MatchEvent) => void;

export class MatchEventBus {
  private readonly listeners = new Set<MatchEventListener>();

  subscribe(listener: MatchEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: MatchEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  listenerCount(): number {
    return this.listeners.size;
  }
}

const matchEventBus = new MatchEventBus();

export function subscribeMatchEvents(listener: MatchEventListener): () => void {
  return matchEventBus.subscribe(listener);
}

export function publishMatchEvent(event: MatchEvent): void {
  matchEventBus.publish(event);
}

function eventId(type: MatchEvent['type'], targetEntityId: string, atMs: number) {
  return `${type}:${targetEntityId}:${Number.isFinite(atMs) ? atMs.toFixed(3) : '0'}`;
}

function oppositePlayableTeam(team: MatchEventTeam): ThroneDestroyedMatchEvent['winnerTeam'] {
  if (team === 'blue') return 'red';
  if (team === 'red') return 'blue';
  return 'neutral';
}

/**
 * Converts one authoritative world death into a semantic match event. The builder is intentionally
 * presentation-free: it carries entity/team data and never embeds a rendered sentence such as
 * "A mató a B". That keeps localization, replay and multiplayer consumers independent from combat.
 */
export function buildDeathMatchEvent(context: MatchDeathEventContext): MatchEvent | null {
  const { target, killer, atMs } = context;
  const base = { atMs } as const;

  if (target.entityId === 'blue-throne' || target.entityId === 'red-throne') {
    return {
      ...base,
      eventId: eventId('throne_destroyed', target.entityId, atMs),
      type: 'throne_destroyed',
      destroyer: killer,
      throne: target,
      winnerTeam: oppositePlayableTeam(target.team),
    };
  }

  if (target.kind === 'hero') {
    return {
      ...base,
      eventId: eventId('hero_killed', target.entityId, atMs),
      type: 'hero_killed',
      killer,
      victim: target,
      assists: [...(context.assists ?? [])],
    };
  }

  if (target.kind === 'tower') {
    return {
      ...base,
      eventId: eventId('tower_destroyed', target.entityId, atMs),
      type: 'tower_destroyed',
      destroyer: killer,
      tower: target,
    };
  }

  if (target.kind === 'jungle-creature') {
    return {
      ...base,
      eventId: eventId('objective_killed', target.entityId, atMs),
      type: 'objective_killed',
      killer,
      objective: target,
    };
  }

  return null;
}
