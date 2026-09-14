import type { GameEntity, GameEntityRegistry, TeamId } from '../entities/gameEntities';
import {
  emitWorldCombatEvent,
  emitWorldHeroProgressionEvent,
  publishWorldEntityRuntime,
  subscribeWorldCombatEvents,
} from '../entities/worldCombatBridge';

export type WardType = 'observer' | 'sentry';

export const WARD_EFFECT_IDS = {
  observer: 'place_vision_ward',
  sentry: 'place_true_sight_ward',
} as const;

export const WARD_RULES = {
  observer: {
    displayName: 'Ojo del Vigía',
    durationSeconds: 360,
    heroHitsToDestroy: 2,
    nonHeroHitsToDestroy: 4,
    grantsVision: true,
    trueSight: false,
    baseGoldReward: 100,
    goldPerMinute: 4,
    baseExperienceReward: 70,
    experiencePerMinute: 8,
  },
  sentry: {
    displayName: 'Ojo del Águila',
    durationSeconds: 420,
    heroHitsToDestroy: 1,
    nonHeroHitsToDestroy: 2,
    grantsVision: false,
    trueSight: true,
    baseGoldReward: 0,
    goldPerMinute: 0,
    baseExperienceReward: 0,
    experiencePerMinute: 0,
  },
} as const;

// The generic combat layer subtracts ordinary attack damage before publishing its event.
// Wards intentionally do not use HP damage, so keep a large hidden sentinel HP value and
// normalize it after each attack event. The visible durability is tracked as hit charges.
export const WARD_INTERNAL_HP = 1_000_000;

const WARD_TYPE_KEY = 'dawnreachWardType';
const WARD_OWNER_KEY = 'dawnreachWardOwnerEntityId';
const WARD_PLACED_AT_KEY = 'dawnreachWardPlacedAtMs';
const WARD_EXPIRES_AT_KEY = 'dawnreachWardExpiresAtMs';
const WARD_HITS_REMAINING_KEY = 'dawnreachWardHitsRemaining';
const REVEAL_CREDIT_BLUE_KEY = 'dawnreachWardRevealCreditBlue';
const REVEAL_CREDIT_RED_KEY = 'dawnreachWardRevealCreditRed';
const MATCH_EPOCH_MS = typeof performance !== 'undefined' ? performance.now() : Date.now();

type WardRuntime = {
  entity: GameEntity;
  registry: GameEntityRegistry;
  ownerEntityId: string;
  wardType: WardType;
  durabilityDamage: number;
  resolvingDeath: boolean;
};

const activeWards = new Map<string, WardRuntime>();
let unsubscribeCombat: (() => void) | null = null;

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function revealCreditKey(team: TeamId) {
  if (team === 'blue') return REVEAL_CREDIT_BLUE_KEY;
  if (team === 'red') return REVEAL_CREDIT_RED_KEY;
  return '';
}

function publishWardRuntime(entity: GameEntity) {
  entity.root.userData.maxHp = entity.maxHp;
  entity.root.userData.currentHp = entity.currentHp;
  publishWorldEntityRuntime(entity.id, {
    level: entity.level,
    maxHp: entity.maxHp,
    currentHp: entity.currentHp,
    maxResource: entity.maxResource,
    currentResource: entity.currentResource,
    alive: entity.alive,
  });
}

function grantObserverWardReward(runtime: WardRuntime, source: GameEntity | null, atMs: number) {
  const { entity } = runtime;
  if (runtime.wardType !== 'observer' || source?.kind !== 'hero' || source.team === entity.team) return;

  const elapsedMinutes = Math.max(0, (atMs - MATCH_EPOCH_MS) / 60_000);
  const rules = WARD_RULES.observer;
  const experience = Math.floor(rules.baseExperienceReward + rules.experiencePerMinute * elapsedMinutes);
  const gold = Math.floor(rules.baseGoldReward + rules.goldPerMinute * elapsedMinutes);
  const creditKey = revealCreditKey(source.team);
  const creditedHeroId = creditKey
    ? String(entity.root.userData[creditKey] ?? source.id)
    : source.id;

  if (creditedHeroId === source.id) {
    emitWorldHeroProgressionEvent({
      heroEntityId: source.id,
      atMs,
      experienceDelta: experience,
      goldDelta: gold,
      lastHitsDelta: 0,
      deniesDelta: 0,
      reason: 'ward-kill',
    });
    return;
  }

  emitWorldHeroProgressionEvent({
    heroEntityId: source.id,
    atMs,
    experienceDelta: experience,
    goldDelta: 0,
    lastHitsDelta: 0,
    deniesDelta: 0,
    reason: 'ward-kill',
  });
  emitWorldHeroProgressionEvent({
    heroEntityId: creditedHeroId,
    atMs,
    experienceDelta: 0,
    goldDelta: gold,
    lastHitsDelta: 0,
    deniesDelta: 0,
    reason: 'ward-kill',
  });
}

function ensureCombatSubscription() {
  if (unsubscribeCombat) return;
  unsubscribeCombat = subscribeWorldCombatEvents(event => {
    const runtime = activeWards.get(event.entityId);
    if (!runtime) return;

    const { entity, registry, wardType } = runtime;
    const source = event.sourceEntityId
      ? registry.values().find(candidate => candidate.id === event.sourceEntityId) ?? null
      : null;

    if (event.reason === 'damage' && entity.alive && !runtime.resolvingDeath) {
      if (source?.team === entity.team && !isWardDeniable(entity, source.team, event.atMs)) {
        // Defensive guard for future allied-damage paths. Ordinary command targeting already
        // refuses this attack, but the ward rules remain authoritative if another system hits it.
        entity.currentHp = WARD_INTERNAL_HP;
        entity.maxHp = WARD_INTERNAL_HP;
        publishWardRuntime(entity);
        return;
      }

      const rules = WARD_RULES[wardType];
      const hitWeight = source?.kind === 'hero'
        ? rules.nonHeroHitsToDestroy / rules.heroHitsToDestroy
        : 1;
      runtime.durabilityDamage += hitWeight;
      const remaining = Math.max(0, rules.nonHeroHitsToDestroy - runtime.durabilityDamage);
      entity.root.userData[WARD_HITS_REMAINING_KEY] = remaining;

      if (remaining > 0) {
        // Undo ordinary HP damage: wards die by hit count, not by attack damage magnitude.
        entity.maxHp = WARD_INTERNAL_HP;
        entity.currentHp = WARD_INTERNAL_HP;
        entity.alive = true;
        publishWardRuntime(entity);
        return;
      }

      runtime.resolvingDeath = true;
      entity.currentHp = 0;
      entity.alive = false;
      publishWardRuntime(entity);
      emitWorldCombatEvent({
        entityId: entity.id,
        reason: 'death',
        currentHp: 0,
        currentResource: entity.currentResource,
        alive: false,
        atMs: event.atMs,
        sourceEntityId: source?.id,
      });
      return;
    }

    if (event.reason === 'death') {
      grantObserverWardReward(runtime, source, event.atMs);
      activeWards.delete(event.entityId);
    }
  });
}

export function isWardPlacementEffect(effectId: string) {
  return effectId === WARD_EFFECT_IDS.observer || effectId === WARD_EFFECT_IDS.sentry;
}

export function wardTypeFromEffect(effectId: string): WardType | null {
  if (effectId === WARD_EFFECT_IDS.observer) return 'observer';
  if (effectId === WARD_EFFECT_IDS.sentry) return 'sentry';
  return null;
}

export function getWardType(entity: GameEntity | null | undefined): WardType | null {
  const value = entity?.root.userData[WARD_TYPE_KEY];
  return value === 'observer' || value === 'sentry' ? value : null;
}

export function getWardRules(entity: GameEntity | null | undefined) {
  const type = getWardType(entity);
  return type ? WARD_RULES[type] : null;
}

export function getWardDurability(wardType: WardType) {
  return WARD_RULES[wardType].nonHeroHitsToDestroy;
}

export function configureWardEntity(
  entity: GameEntity,
  registry: GameEntityRegistry,
  options: {
    wardType: WardType;
    ownerEntityId: string;
    placedAtMs: number;
    expiresAtMs: number;
  },
) {
  const rules = WARD_RULES[options.wardType];
  entity.root.userData.itemWard = true;
  entity.root.userData[WARD_TYPE_KEY] = options.wardType;
  entity.root.userData[WARD_OWNER_KEY] = options.ownerEntityId;
  entity.root.userData[WARD_PLACED_AT_KEY] = options.placedAtMs;
  entity.root.userData[WARD_EXPIRES_AT_KEY] = options.expiresAtMs;
  entity.root.userData[WARD_HITS_REMAINING_KEY] = rules.nonHeroHitsToDestroy;
  entity.root.userData.wardTrueSight = rules.trueSight;
  entity.maxHp = WARD_INTERNAL_HP;
  entity.currentHp = WARD_INTERNAL_HP;
  publishWardRuntime(entity);
  activeWards.set(entity.id, {
    entity,
    registry,
    ownerEntityId: options.ownerEntityId,
    wardType: options.wardType,
    durabilityDamage: 0,
    resolvingDeath: false,
  });
  ensureCombatSubscription();
}

export function unregisterWardEntity(entityId: string) {
  activeWards.delete(entityId);
}

export function getWardOwnerEntityId(entity: GameEntity) {
  const value = entity.root.userData[WARD_OWNER_KEY];
  return typeof value === 'string' ? value : null;
}

export function getWardHitsRemaining(entity: GameEntity) {
  const value = Number(entity.root.userData[WARD_HITS_REMAINING_KEY]);
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

export function isWardDeniable(entity: GameEntity, byTeam: TeamId, atMs = nowMs()) {
  if (entity.team !== byTeam || !getWardType(entity) || !entity.alive) return false;
  const placedAtMs = Number(entity.root.userData[WARD_PLACED_AT_KEY]);
  const expiresAtMs = Number(entity.root.userData[WARD_EXPIRES_AT_KEY]);
  if (!Number.isFinite(placedAtMs) || !Number.isFinite(expiresAtMs) || expiresAtMs <= placedAtMs) return false;
  const durationMs = expiresAtMs - placedAtMs;
  return expiresAtMs - atMs <= durationMs * 0.10;
}

export function markWardRevealCredit(target: GameEntity, detectingTeam: TeamId, heroEntityId: string) {
  const key = revealCreditKey(detectingTeam);
  if (!key) return;
  target.root.userData[key] = heroEntityId;
}
