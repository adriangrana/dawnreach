import type { GameEntity, GameEntityKind, GameEntityRegistry, TeamId } from '../entities/gameEntities';
import {
  emitWorldHeroProgressionEvent,
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
const REVEAL_CREDIT_BLUE_KEY = 'dawnreachWardRevealCreditBlue';
const REVEAL_CREDIT_RED_KEY = 'dawnreachWardRevealCreditRed';
const MATCH_EPOCH_MS = typeof performance !== 'undefined' ? performance.now() : Date.now();

type WardRuntime = {
  entity: GameEntity;
  registry: GameEntityRegistry;
  ownerEntityId: string;
  wardType: WardType;
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

function ensureCombatSubscription() {
  if (unsubscribeCombat) return;
  unsubscribeCombat = subscribeWorldCombatEvents(event => {
    if (event.reason !== 'death') return;
    const runtime = activeWards.get(event.entityId);
    if (!runtime) return;

    const { entity, registry, wardType } = runtime;
    const source = event.sourceEntityId
      ? registry.values().find(candidate => candidate.id === event.sourceEntityId) ?? null
      : null;

    if (wardType === 'observer' && source?.kind === 'hero' && source.team !== entity.team) {
      const elapsedMinutes = Math.max(0, (event.atMs - MATCH_EPOCH_MS) / 60_000);
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
          atMs: event.atMs,
          experienceDelta: experience,
          goldDelta: gold,
          lastHitsDelta: 0,
          deniesDelta: 0,
          reason: 'ward-kill',
        });
      } else {
        emitWorldHeroProgressionEvent({
          heroEntityId: source.id,
          atMs: event.atMs,
          experienceDelta: experience,
          goldDelta: 0,
          lastHitsDelta: 0,
          deniesDelta: 0,
          reason: 'ward-kill',
        });
        emitWorldHeroProgressionEvent({
          heroEntityId: creditedHeroId,
          atMs: event.atMs,
          experienceDelta: 0,
          goldDelta: gold,
          lastHitsDelta: 0,
          deniesDelta: 0,
          reason: 'ward-kill',
        });
      }
    }

    activeWards.delete(event.entityId);
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

export function getWardAttackDamage(attackerKind: GameEntityKind | null | undefined, target: GameEntity) {
  const rules = getWardRules(target);
  if (!rules) return null;
  if (attackerKind === 'hero') {
    return rules.nonHeroHitsToDestroy / rules.heroHitsToDestroy;
  }
  return 1;
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
  activeWards.set(entity.id, {
    entity,
    registry,
    ownerEntityId: options.ownerEntityId,
    wardType: options.wardType,
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
