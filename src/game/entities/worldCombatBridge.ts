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
  physicalArmor?: number;
  magicResistance?: number;
  movementSpeed?: number;
  magicPower?: number;
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
  /** Original unmitigated amount when the server already resolved defensive reductions. */
  rawAmount?: number;
  /** True when HP/death was canonically resolved by the multiplayer server. */
  serverResolved?: boolean;
  sourceEntityId?: string;
  critical?: boolean;
  /** Optional metadata for hero reactions. Existing direct world attacks default to physical/front. */
  damageType?: 'physical' | 'magic' | 'true';
  isDirect?: boolean;
  isFromFront?: boolean;
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
  reason: 'creep-death' | 'objective-kill' | 'ward-kill';
}>;

type WorldCombatListener = (event: WorldCombatEvent) => void;
type WorldAttackListener = (event: WorldAttackEvent) => void;
type WorldCombatEventGuard = (event: WorldCombatEvent) => boolean;
type WorldAttackEventGuard = (event: WorldAttackEvent) => boolean;
type WorldCreepDeathListener = (event: WorldCreepDeathEvent) => void;
type WorldHeroProgressionListener = (event: WorldHeroProgressionEvent) => void;

type PendingHpChange = Readonly<{
  amount: number;
  kind: 'damage' | 'heal';
}>;

const runtimeSnapshots = new Map<string, WorldEntityRuntimeSnapshot>();
const pendingHpChanges = new Map<string, PendingHpChange>();
const pendingDamageAdjustments = new Map<string, number>();
const appliedDamageAdjustments = new Map<string, number>();
const combatListeners = new Set<WorldCombatListener>();
const attackListeners = new Set<WorldAttackListener>();
const combatEventGuards = new Map<string, WorldCombatEventGuard>();
const attackEventGuards = new Map<string, WorldAttackEventGuard>();
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

function applyPendingDamageAdjustment(entityId: string, snapshot: WorldEntityRuntimeSnapshot) {
  // Only an adjustment consumed by this exact publication may augment the next explicit
  // combat event. Clear any stale marker before evaluating the new publication.
  appliedDamageAdjustments.delete(entityId);
  const adjustment = pendingDamageAdjustments.get(entityId) ?? 0;
  if (adjustment <= 0) return snapshot;
  pendingDamageAdjustments.delete(entityId);
  appliedDamageAdjustments.set(entityId, adjustment);
  const currentHp = Math.max(0, snapshot.currentHp - adjustment);
  return {
    ...snapshot,
    currentHp,
    alive: snapshot.alive && currentHp > 0,
  };
}

export function publishWorldEntityRuntime(entityId: string, snapshot: WorldEntityRuntimeSnapshot): void {
  const adjustedSnapshot = applyPendingDamageAdjustment(entityId, snapshot);
  const previous = runtimeSnapshots.get(entityId);
  if (previous) {
    const hpDelta = adjustedSnapshot.currentHp - previous.currentHp;
    if (Math.abs(hpDelta) > 0.001) {
      pendingHpChanges.set(entityId, {
        amount: Math.abs(hpDelta),
        kind: hpDelta < 0 ? 'damage' : 'heal',
      });
    }
  }
  runtimeSnapshots.set(entityId, cloneRuntimeSnapshot(adjustedSnapshot));
}

export function getWorldEntityRuntime(entityId: string): WorldEntityRuntimeSnapshot | undefined {
  return runtimeSnapshots.get(entityId);
}

/**
 * Queues extra damage to be folded into the target's next authoritative world-runtime
 * publication. Used by match-owned passives so the 3D combat path and match formulas stay
 * in sync without duplicating direct HP mutation in React.
 */
export function queueWorldDamageAdjustment(entityId: string, amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  pendingDamageAdjustments.set(entityId, (pendingDamageAdjustments.get(entityId) ?? 0) + amount);
}

export function removeWorldEntityRuntime(entityId: string): void {
  runtimeSnapshots.delete(entityId);
  pendingHpChanges.delete(entityId);
  pendingDamageAdjustments.delete(entityId);
  appliedDamageAdjustments.delete(entityId);
}

export function subscribeWorldCombatEvents(listener: WorldCombatListener): () => void {
  combatListeners.add(listener);
  return () => combatListeners.delete(listener);
}

export function subscribeWorldAttackEvents(listener: WorldAttackListener): () => void {
  attackListeners.add(listener);
  return () => attackListeners.delete(listener);
}

export function registerWorldCombatEventGuard(key: string, guard: WorldCombatEventGuard): () => void {
  combatEventGuards.set(key, guard);
  return () => {
    if (combatEventGuards.get(key) === guard) combatEventGuards.delete(key);
  };
}

export function registerWorldAttackEventGuard(key: string, guard: WorldAttackEventGuard): () => void {
  attackEventGuards.set(key, guard);
  return () => {
    if (attackEventGuards.get(key) === guard) attackEventGuards.delete(key);
  };
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
  const damageLike = event.reason === 'damage' || event.reason === 'death';
  const effectiveCurrentHp = damageLike && snapshot
    ? Math.min(event.currentHp, snapshot.currentHp)
    : event.currentHp;
  const effectiveAlive = event.alive && effectiveCurrentHp > 0;
  const effectiveReason: WorldCombatEventReason = damageLike && effectiveCurrentHp <= 0
    ? 'death'
    : event.reason;
  const expectedKind = effectiveReason === 'heal' || effectiveReason === 'respawn' ? 'heal' : 'damage';
  const snapshotAmount = snapshot
    ? expectedKind === 'damage'
      ? Math.max(0, snapshot.currentHp - effectiveCurrentHp)
      : Math.max(0, effectiveCurrentHp - snapshot.currentHp)
    : 0;
  const explicitAmount = Number.isFinite(Number(event.amount))
    ? Math.max(0, Number(event.amount))
    : undefined;
  // Generic HP deltas are inference only. They can belong to another creep hit or to a
  // network reconciliation and must never replace an explicitly authored combat amount.
  // Match-owned bonuses queued by queueWorldDamageAdjustment are the only augmentation.
  const explicitDamageAdjustment = damageLike
    ? Math.max(
      0,
      appliedDamageAdjustments.get(event.entityId)
        ?? pendingDamageAdjustments.get(event.entityId)
        ?? 0,
    )
    : 0;
  if (damageLike && explicitDamageAdjustment > 0) {
    pendingDamageAdjustments.delete(event.entityId);
    appliedDamageAdjustments.delete(event.entityId);
  }
  const inferredAmount = explicitAmount !== undefined
    ? explicitAmount + explicitDamageAdjustment
    : (pending?.kind === expectedKind ? pending.amount : undefined)
      ?? (snapshotAmount > 0.001 ? snapshotAmount : undefined);
  const sourceEntityId = event.sourceEntityId ?? inferRecentAttackSource(event);
  const published: WorldCombatEvent = {
    ...event,
    reason: effectiveReason,
    currentHp: effectiveCurrentHp,
    alive: effectiveAlive,
    amount: inferredAmount,
    sourceEntityId,
  };

  for (const guard of combatEventGuards.values()) {
    if (guard(published)) continue;
    pendingHpChanges.delete(event.entityId);
    appliedDamageAdjustments.delete(event.entityId);
    return;
  }

  pendingHpChanges.delete(event.entityId);
  appliedDamageAdjustments.delete(event.entityId);

  if (snapshot) {
    runtimeSnapshots.set(event.entityId, {
      ...snapshot,
      currentHp: effectiveCurrentHp,
      currentResource: event.currentResource ?? snapshot.currentResource,
      alive: effectiveAlive,
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
  const accepted = Array.from(attackEventGuards.values()).every(guard => guard(published));
  if (accepted) {
    for (const listener of attackListeners) listener(published);
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
