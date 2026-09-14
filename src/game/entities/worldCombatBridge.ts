import type { GameEntityKind, TeamId } from './gameEntities';

export type WorldStatusRuntimeSnapshot = Readonly<{
  id: string;
  sourceEntityId: string | null;
  rank?: number;
  stacks?: number;
  expiresAtMs?: number | null;
  data?: Readonly<Record<string, number | string | boolean>>;
}>;

export type WorldEntityRuntimeSnapshot = Readonly<{
  level: number;
  maxHp: number;
  currentHp: number;
  maxResource: number;
  currentResource: number;
  alive: boolean;
  statuses?: readonly WorldStatusRuntimeSnapshot[];
}>;

export type WorldCombatEventReason = 'damage' | 'heal' | 'death' | 'respawn';

export type WorldCombatEvent = Readonly<{
  entityId: string;
  reason: WorldCombatEventReason;
  currentHp: number;
  currentResource?: number;
  alive: boolean;
  atMs: number;
  respawnSeconds?: number;
  amount?: number;
  sourceEntityId?: string;
  critical?: boolean;
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

export type WorldCreepType = 'melee' | 'ranged' | 'flagbearer' | 'siege';

export type WorldCreepDeathEvent = Readonly<{
  creepEntityId: string;
  creepType: WorldCreepType;
  creepTeam: TeamId;
  killerEntityId: string | null;
  killerTeam: TeamId | null;
  killerKind: GameEntityKind | null;
  position: Readonly<{ x: number; z: number }>;
  atMs: number;
}>;

export type WorldHeroProgressionEvent = Readonly<{
  heroEntityId: string;
  atMs: number;
  experienceDelta: number;
  goldDelta: number;
  lastHitsDelta: number;
  deniesDelta: number;
  reason: 'creep-death' | 'objective-kill';
}>;

type WorldCombatListener = (event: WorldCombatEvent) => void;
type WorldCreepDeathListener = (event: WorldCreepDeathEvent) => void;
type WorldHeroProgressionListener = (event: WorldHeroProgressionEvent) => void;

type PendingHpChange = Readonly<{
  amount: number;
  kind: 'damage' | 'heal';
}>;

const runtimeSnapshots = new Map<string, WorldEntityRuntimeSnapshot>();
const pendingHpChanges = new Map<string, PendingHpChange>();
const combatListeners = new Set<WorldCombatListener>();
const creepDeathListeners = new Set<WorldCreepDeathListener>();
const heroProgressionListeners = new Set<WorldHeroProgressionListener>();
const attackEvents: WorldAttackEvent[] = [];
let attackSequence = 0;

const MAX_ATTACK_EVENTS = 160;
const ATTACK_SOURCE_MATCH_WINDOW_MS = 160;

function cloneRuntimeSnapshot(snapshot: WorldEntityRuntimeSnapshot): WorldEntityRuntimeSnapshot {
  return {
    ...snapshot,
    statuses: snapshot.statuses?.map(status => ({
      ...status,
      data: status.data ? { ...status.data } : undefined,
    })),
  };
}

export function publishWorldEntityRuntime(entityId: string, snapshot: WorldEntityRuntimeSnapshot): void {
  const previous = runtimeSnapshots.get(entityId);
  if (previous) {
    const hpDelta = snapshot.currentHp - previous.currentHp;
    if (Math.abs(hpDelta) > 0.001) {
      pendingHpChanges.set(entityId, {
        amount: Math.abs(hpDelta),
        kind: hpDelta < 0 ? 'damage' : 'heal',
      });
    }
  }
  runtimeSnapshots.set(entityId, cloneRuntimeSnapshot(snapshot));
}

export function getWorldEntityRuntime(entityId: string): WorldEntityRuntimeSnapshot | undefined {
  return runtimeSnapshots.get(entityId);
}

export function removeWorldEntityRuntime(entityId: string): void {
  runtimeSnapshots.delete(entityId);
  pendingHpChanges.delete(entityId);
}

export function subscribeWorldCombatEvents(listener: WorldCombatListener): () => void {
  combatListeners.add(listener);
  return () => combatListeners.delete(listener);
}

export function subscribeWorldCreepDeathEvents(listener: WorldCreepDeathListener): () => void {
  creepDeathListeners.add(listener);
  return () => creepDeathListeners.delete(listener);
}

export function emitWorldCreepDeathEvent(event: WorldCreepDeathEvent): void {
  for (const listener of creepDeathListeners) listener(event);
}

export function subscribeWorldHeroProgressionEvents(listener: WorldHeroProgressionListener): () => void {
  heroProgressionListeners.add(listener);
  return () => heroProgressionListeners.delete(listener);
}

export function emitWorldHeroProgressionEvent(event: WorldHeroProgressionEvent): void {
  for (const listener of heroProgressionListeners) listener(event);
}

export function emitWorldCombatEvent(event: WorldCombatEvent): void {
  const snapshot = runtimeSnapshots.get(event.entityId);
  const pending = pendingHpChanges.get(event.entityId);
  const expectedKind = event.reason === 'heal' || event.reason === 'respawn' ? 'heal' : 'damage';
  const snapshotAmount = snapshot
    ? expectedKind === 'damage'
      ? Math.max(0, snapshot.currentHp - event.currentHp)
      : Math.max(0, event.currentHp - snapshot.currentHp)
    : 0;
  const inferredAmount = event.amount
    ?? (pending?.kind === expectedKind ? pending.amount : undefined)
    ?? (snapshotAmount > 0.001 ? snapshotAmount : undefined);
  const sourceEntityId = event.sourceEntityId ?? inferRecentAttackSource(event);
  const published: WorldCombatEvent = {
    ...event,
    amount: inferredAmount,
    sourceEntityId,
  };

  pendingHpChanges.delete(event.entityId);

  if (snapshot) {
    runtimeSnapshots.set(event.entityId, {
      ...snapshot,
      currentHp: event.currentHp,
      currentResource: event.currentResource ?? snapshot.currentResource,
      alive: event.alive,
    });
  }

  for (const listener of combatListeners) listener(published);
}

function inferRecentAttackSource(event: WorldCombatEvent): string | undefined {
  if (event.reason !== 'damage' && event.reason !== 'death') return undefined;
  return getMostRecentAttackOnTarget(event.entityId, event.atMs, ATTACK_SOURCE_MATCH_WINDOW_MS)?.attackerId;
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

export function getMostRecentAttackOnTarget(
  targetId: string,
  atMs = performance.now(),
  maxAgeMs = 3_000,
): WorldAttackEvent | undefined {
  for (let index = attackEvents.length - 1; index >= 0; index--) {
    const attack = attackEvents[index];
    const ageMs = atMs - attack.atMs;
    if (ageMs > maxAgeMs) break;
    if (ageMs < -4 || attack.targetId !== targetId) continue;
    return attack;
  }
  return undefined;
}
