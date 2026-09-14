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

const WARD_TYPE_KEY = 'dawnreachWardType';
const WARD_OWNER_KEY = 'dawnreachWardOwnerEntityId';
const WARD_PLACED_AT_KEY = 'dawnreachWardPlacedAtMs';
const WARD_EXPIRES_AT_KEY = 'dawnreachWardExpiresAtMs';
const WARD_HITS_REMAINING_KEY = 'dawnreachWardHitsRemaining';
const WARD_COUNTER_INSTALLED_KEY = 'dawnreachWardHitCounterInstalled';
const REVEAL_CREDIT_BLUE_KEY = 'dawnreachWardRevealCreditBlue';
const REVEAL_CREDIT_RED_KEY = 'dawnreachWardRevealCreditRed';
const MATCH_EPOCH_MS = typeof performance !== 'undefined' ? performance.now() : Date.now();

type WardRuntime = {
  entity: GameEntity;
  registry: GameEntityRegistry;
  ownerEntityId: string;
  wardType: WardType;
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
  entity.root.userData[WARD_HITS_REMAINING_KEY] = entity.currentHp;
  publishWorldEntityRuntime(entity.id, {
    level: entity.level,
    maxHp: entity.maxHp,
    currentHp: entity.currentHp,
    maxResource: entity.maxResource,
    currentResource: entity.currentResource,
    alive: entity.alive,
  });
}

function installWardHitCounter(entity: GameEntity, charges: number) {
  if (entity.root.userData[WARD_COUNTER_INSTALLED_KEY] === true) return;
  const maximum = Math.max(1, Math.round(charges));
  let remaining = maximum;
  entity.maxHp = maximum;

  Object.defineProperty(entity, 'currentHp', {
    configurable: true,
    enumerable: true,
    get: () => remaining,
    set: (requested: number) => {
      const next = Number.isFinite(requested) ? requested : remaining;
      if (next < remaining) {
        // Any ordinary damaging attack consumes exactly one durability charge regardless
        // of raw damage. Hero attacks consume their extra charge in the combat listener.
        remaining = Math.max(0, remaining - 1);
      } else if (next > remaining) {
        // Used only to undo an illegal allied hit before the deny window opens.
        remaining = Math.min(maximum, next);
      }
      entity.root.userData.currentHp = remaining;
      entity.root.userData[WARD_HITS_REMAINING_KEY] = remaining;
    },
  });

  entity.root.userData[WARD_COUNTER_INSTALLED_KEY] = true;
  entity.root.userData.maxHp = maximum;
  entity.root.userData.currentHp = maximum;
  entity.root.userData[WARD_HITS_REMAINING_KEY] = maximum;
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
        entity.currentHp = Math.min(entity.maxHp, entity.currentHp + 1);
        publishWardRuntime(entity);
        return;
      }

      const rules = WARD_RULES[wardType];
      const heroChargeWeight = rules.nonHeroHitsToDestroy / rules.heroHitsToDestroy;
      const extraHeroCharges = source?.kind === 'hero'
        ? Math.max(0, Math.round(heroChargeWeight) - 1)
        : 0;

      for (let charge = 0; charge < extraHeroCharges && entity.currentHp > 0; charge++) {
        entity.currentHp = entity.currentHp - 1;
      }
      entity.root.userData[WARD_HITS_REMAINING_KEY] = entity.currentHp;

      if (entity.currentHp > 0) {
        if (extraHeroCharges > 0) publishWardRuntime(entity);
        return;
      }

      runtime.resolvingDeath = true;
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
  entity.root.userData.wardTrueSight = rules.trueSight;
  installWardHitCounter(entity, rules.nonHeroHitsToDestroy);
  entity.alive = true;
  publishWardRuntime(entity);
  activeWards.set(entity.id, {
    entity,
    registry,
    ownerEntityId: options.ownerEntityId,
    wardType: options.wardType,
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
