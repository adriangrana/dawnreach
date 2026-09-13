import type { GameEntityKind, TeamId } from './gameEntities';

export type WorldEntityRuntimeSnapshot = Readonly<{
  level: number;
  maxHp: number;
  currentHp: number;
  maxResource: number;
  currentResource: number;
  alive: boolean;
}>;

export type WorldCombatEventReason = 'damage' | 'death' | 'respawn';

export type WorldCombatEvent = Readonly<{
  entityId: string;
  reason: WorldCombatEventReason;
  currentHp: number;
  currentResource?: number;
  alive: boolean;
  atMs: number;
  respawnSeconds?: number;
}>;

export type WorldAttackEvent = Readonly<{
  sequence: number;
  attackerId: string;
  targetId: string;
  attackerTeam: TeamId;
  targetTeam: TeamId;
  attackerKind: GameEntityKind;
  targetKind: GameEntityKind;
  attackerPosition: Readonly<{ x: number; z: number }>;
  targetPosition: Readonly<{ x: number; z: number }>;
  atMs: number;
}>;

type WorldCombatListener = (event: WorldCombatEvent) => void;

const runtimeSnapshots = new Map<string, WorldEntityRuntimeSnapshot>();
const combatListeners = new Set<WorldCombatListener>();
const attackEvents: WorldAttackEvent[] = [];
let attackSequence = 0;

const MAX_ATTACK_EVENTS = 160;

export function publishWorldEntityRuntime(entityId: string, snapshot: WorldEntityRuntimeSnapshot): void {
  runtimeSnapshots.set(entityId, { ...snapshot });
}

export function getWorldEntityRuntime(entityId: string): WorldEntityRuntimeSnapshot | undefined {
  return runtimeSnapshots.get(entityId);
}

export function subscribeWorldCombatEvents(listener: WorldCombatListener): () => void {
  combatListeners.add(listener);
  return () => combatListeners.delete(listener);
}

export function emitWorldCombatEvent(event: WorldCombatEvent): void {
  const snapshot = runtimeSnapshots.get(event.entityId);
  if (snapshot) {
    runtimeSnapshots.set(event.entityId, {
      ...snapshot,
      currentHp: event.currentHp,
      currentResource: event.currentResource ?? snapshot.currentResource,
      alive: event.alive,
    });
  }

  for (const listener of combatListeners) listener(event);
}

export function publishWorldAttackEvent(
  event: Omit<WorldAttackEvent, 'sequence'>,
): WorldAttackEvent {
  const published: WorldAttackEvent = {
    ...event,
    sequence: ++attackSequence,
  };
  attackEvents.push(published);
  if (attackEvents.length > MAX_ATTACK_EVENTS) {
    attackEvents.splice(0, attackEvents.length - MAX_ATTACK_EVENTS);
  }
  return published;
}

export function getWorldAttackEventsAfter(sequence: number): readonly WorldAttackEvent[] {
  if (attackEvents.length === 0) return [];
  return attackEvents.filter(event => event.sequence > sequence);
}
