import type { InventoryItem, ItemStatModifier } from '../heroes/types';
import { getHeroDefinition } from '../heroes/catalog';
import { getRequiredHero } from '../match/matchState';
import { calculateDefinitionStatsAtLevel, calculateHeroStats } from '../match/stats';
import type { MatchHeroState, MatchState } from '../match/types';
import { isLocalHeroNearShop } from './shopAccess';
import { getItemDefinition, type ItemDefinition, type ItemStats } from './itemDatabase';

export type ShopTransactionReason = 'unknown-item' | 'not-enough-gold' | 'inventory-full' | 'out-of-shop-range' | null;
export type ItemUseReason = 'missing-item' | 'not-active' | 'cooldown' | 'not-enough-resource' | 'dead' | null;

export type HeroItemRuntimeContext = Readonly<{
  heroEntityId: string;
  definitionId: string;
  heroName: string;
  team: MatchHeroState['team'];
  movementSpeed: number;
  baseMovementSpeed: number;
  maxResource: number;
  magicPower: number;
  updatedAtMs: number;
}>;

export type ItemActivationOwnerContext = HeroItemRuntimeContext & Readonly<{
  activatedAtMs: number;
}>;

export type ShopPurchaseResult = Readonly<{
  match: MatchState;
  definition: ItemDefinition | null;
  item: InventoryItem | null;
  ok: boolean;
  dropped: boolean;
  reason: ShopTransactionReason;
}>;

export type GroundPickupResult = Readonly<{
  match: MatchState;
  definition: ItemDefinition | null;
  item: InventoryItem | null;
  ok: boolean;
  reason: ShopTransactionReason;
}>;

export type InventoryMutationResult = Readonly<{
  match: MatchState;
  item: InventoryItem | null;
  definition: ItemDefinition | null;
  ok: boolean;
}>;

export type ItemUseResult = Readonly<{
  match: MatchState;
  item: InventoryItem | null;
  definition: ItemDefinition | null;
  ok: boolean;
  reason: ItemUseReason;
  consumed: boolean;
}>;

const heroItemRuntimeContexts = new Map<string, HeroItemRuntimeContext>();
const itemActivationOwners = new Map<string, ItemActivationOwnerContext>();

function runtimeNowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function getInventoryMagicPower(hero: MatchHeroState) {
  let total = 0;
  for (const slot of hero.inventory) {
    const definition = slot.item ? getItemDefinition(slot.item.definitionId) : null;
    total += numeric(definition?.stats.magic_power, 0);
  }
  return total;
}

export function syncHeroItemRuntime(
  state: MatchState,
  heroEntityId: string,
  nowMs = runtimeNowMs(),
): HeroItemRuntimeContext {
  const hero = getRequiredHero(state, heroEntityId);
  const definition = getHeroDefinition(hero.definitionId);
  const baseStats = calculateDefinitionStatsAtLevel(definition, hero.level);
  const stats = calculateHeroStats(state, heroEntityId, { nowMs });
  const context: HeroItemRuntimeContext = {
    heroEntityId,
    definitionId: hero.definitionId,
    heroName: hero.heroName,
    team: hero.team,
    movementSpeed: stats.movementSpeed,
    baseMovementSpeed: Math.max(1, baseStats.movementSpeed),
    maxResource: stats.maxResource,
    magicPower: getInventoryMagicPower(hero),
    updatedAtMs: nowMs,
  };
  heroItemRuntimeContexts.set(heroEntityId, context);
  return context;
}

export function getHeroItemRuntimeContexts(): readonly HeroItemRuntimeContext[] {
  return Array.from(heroItemRuntimeContexts.values());
}

export function getItemActivationOwnerContext(instanceId: string): ItemActivationOwnerContext | null {
  return itemActivationOwners.get(instanceId) ?? null;
}

export function heroHasInventorySpace(state: MatchState, heroEntityId: string) {
  return getRequiredHero(state, heroEntityId).inventory.some(slot => slot.item === null);
}

export function purchaseShopItem(
  state: MatchState,
  heroEntityId: string,
  itemId: string,
  instanceId: string,
): ShopPurchaseResult {
  const definition = getItemDefinition(itemId);
  if (!definition) {
    return { match: state, definition: null, item: null, ok: false, dropped: false, reason: 'unknown-item' };
  }

  const sourceHero = getRequiredHero(state, heroEntityId);
  if (sourceHero.gold < definition.cost) {
    return { match: state, definition, item: null, ok: false, dropped: false, reason: 'not-enough-gold' };
  }

  const next = structuredClone(state);
  const hero = getRequiredHero(next, heroEntityId);
  hero.gold = Math.max(0, hero.gold - definition.cost);
  const item = createInventoryItem(definition, instanceId);
  const emptySlot = hero.inventory.find(slot => slot.item === null);
  const nearShop = isLocalHeroNearShop();

  if (nearShop && emptySlot) {
    emptySlot.item = item;
    syncHeroItemRuntime(next, heroEntityId);
    return { match: next, definition, item, ok: true, dropped: false, reason: null };
  }

  syncHeroItemRuntime(next, heroEntityId);
  return {
    match: next,
    definition,
    item,
    ok: true,
    dropped: true,
    reason: nearShop ? 'inventory-full' : 'out-of-shop-range',
  };
}

export function pickUpGroundItem(
  state: MatchState,
  heroEntityId: string,
  item: InventoryItem,
): GroundPickupResult {
  const definition = getItemDefinition(item.definitionId);
  if (!definition) return { match: state, definition: null, item: null, ok: false, reason: 'unknown-item' };

  if (!heroHasInventorySpace(state, heroEntityId)) {
    return { match: state, definition, item, ok: false, reason: 'inventory-full' };
  }

  const next = structuredClone(state);
  const hero = getRequiredHero(next, heroEntityId);
  const emptySlot = hero.inventory.find(slot => slot.item === null);
  if (!emptySlot) return { match: state, definition, item, ok: false, reason: 'inventory-full' };
  emptySlot.item = structuredClone(item);
  syncHeroItemRuntime(next, heroEntityId);
  return { match: next, definition, item, ok: true, reason: null };
}

export function moveInventoryItem(
  state: MatchState,
  heroEntityId: string,
  fromSlotIndex: number,
  toSlotIndex: number,
): MatchState {
  if (fromSlotIndex === toSlotIndex) return state;
  const sourceHero = getRequiredHero(state, heroEntityId);
  const from = sourceHero.inventory.find(slot => slot.slot === fromSlotIndex);
  const to = sourceHero.inventory.find(slot => slot.slot === toSlotIndex);
  if (!from || !to || !from.item) return state;

  const next = structuredClone(state);
  const hero = getRequiredHero(next, heroEntityId);
  const nextFrom = hero.inventory.find(slot => slot.slot === fromSlotIndex)!;
  const nextTo = hero.inventory.find(slot => slot.slot === toSlotIndex)!;
  const moving = nextFrom.item;
  nextFrom.item = nextTo.item;
  nextTo.item = moving;
  syncHeroItemRuntime(next, heroEntityId);
  return next;
}

export function dropInventoryItem(
  state: MatchState,
  heroEntityId: string,
  slotIndex: number,
): InventoryMutationResult {
  const sourceHero = getRequiredHero(state, heroEntityId);
  const sourceSlot = sourceHero.inventory.find(slot => slot.slot === slotIndex);
  if (!sourceSlot?.item) return { match: state, item: null, definition: null, ok: false };

  const item = structuredClone(sourceSlot.item);
  const definition = getItemDefinition(item.definitionId);
  const next = structuredClone(state);
  const hero = getRequiredHero(next, heroEntityId);
  const slot = hero.inventory.find(candidate => candidate.slot === slotIndex)!;
  slot.item = null;
  syncHeroItemRuntime(next, heroEntityId);
  return { match: next, item, definition, ok: true };
}

export function sellInventoryItem(
  state: MatchState,
  heroEntityId: string,
  instanceId: string,
): InventoryMutationResult & Readonly<{ saleGold: number }> {
  const sourceHero = getRequiredHero(state, heroEntityId);
  const sourceSlot = sourceHero.inventory.find(slot => slot.item?.instanceId === instanceId);
  const item = sourceSlot?.item ?? null;
  const definition = item ? getItemDefinition(item.definitionId) : null;
  if (!sourceSlot || !item || !definition) return { match: state, item: null, definition: null, ok: false, saleGold: 0 };

  const saleGold = Math.floor(definition.cost / 2);
  const next = structuredClone(state);
  const hero = getRequiredHero(next, heroEntityId);
  const slot = hero.inventory.find(candidate => candidate.item?.instanceId === instanceId);
  if (!slot) return { match: state, item: null, definition: null, ok: false, saleGold: 0 };
  slot.item = null;
  hero.gold += saleGold;
  syncHeroItemRuntime(next, heroEntityId);
  return { match: next, item: structuredClone(item), definition, ok: true, saleGold };
}

function cleanseSlowStatuses(hero: MatchHeroState, nowMs: number) {
  for (const [id, status] of Object.entries(hero.runtime.statuses)) {
    if (status.expiresAtMs <= nowMs) continue;
    const slowPercent = numeric(status.data?.slowPercent, 0);
    if (slowPercent > 0 || id.toLowerCase().includes('slow')) delete hero.runtime.statuses[id];
  }
}

export function useInventoryItem(
  state: MatchState,
  heroEntityId: string,
  slotIndex: number,
  nowMs: number,
): ItemUseResult {
  const sourceHero = getRequiredHero(state, heroEntityId);
  const sourceSlot = sourceHero.inventory.find(slot => slot.slot === slotIndex);
  const sourceItem = sourceSlot?.item ?? null;
  const definition = sourceItem ? getItemDefinition(sourceItem.definitionId) : null;
  if (!sourceItem || !definition) return { match: state, item: null, definition, ok: false, reason: 'missing-item', consumed: false };
  if (!definition.active_effect) return { match: state, item: sourceItem, definition, ok: false, reason: 'not-active', consumed: false };
  if (sourceHero.currentHp <= 0) return { match: state, item: sourceItem, definition, ok: false, reason: 'dead', consumed: false };
  if ((sourceItem.cooldownReadyAtMs ?? 0) > nowMs) return { match: state, item: sourceItem, definition, ok: false, reason: 'cooldown', consumed: false };
  if (sourceHero.currentResource < definition.active_effect.mana_cost) {
    return { match: state, item: sourceItem, definition, ok: false, reason: 'not-enough-resource', consumed: false };
  }

  const next = structuredClone(state);
  const hero = getRequiredHero(next, heroEntityId);
  const slot = hero.inventory.find(candidate => candidate.slot === slotIndex)!;
  const item = slot.item!;
  const effect = definition.active_effect;
  const values = effect.values;
  hero.currentResource = Math.max(0, hero.currentResource - effect.mana_cost);
  item.cooldownReadyAtMs = nowMs + effect.cooldown * 1000;

  if (values.remove_slow === true || effect.id === 'cleanse_slow_and_haste' || effect.id === 'short_blink_cleanse_slow') {
    cleanseSlowStatuses(hero, nowMs);
  }

  const durationSeconds = numeric(values.duration, 0);
  const statusDurationMs = Math.max(0, durationSeconds * 1000);
  const statusData: Record<string, number | string | boolean> = {
    itemEffect: effect.id,
    startedAtMs: nowMs,
  };

  switch (effect.id) {
    case 'restore_health_over_time':
      statusData.healPerSecond = numeric(values.heal_total) / Math.max(0.001, durationSeconds);
      break;
    case 'restore_mana_over_time':
      statusData.manaPerSecond = numeric(values.mana_restore) / Math.max(0.001, durationSeconds);
      break;
    case 'restore_health_and_mana_ooc':
      statusData.healPerSecond = numeric(values.heal_total) / Math.max(0.001, durationSeconds);
      statusData.manaPerSecond = numeric(values.mana_restore) / Math.max(0.001, durationSeconds);
      statusData.requiresOutOfCombat = true;
      break;
    case 'temporary_move_speed_flat':
      statusData.movementSpeedFlat = numeric(values.move_speed_flat);
      break;
    case 'phase_movement':
    case 'temporary_move_speed_pct':
    case 'cleanse_slow_and_haste':
      statusData.movementSpeedPercent = numeric(values.move_speed_pct);
      if (values.ignore_unit_collision === true) statusData.ignoreUnitCollision = true;
      break;
    case 'mana_restore_and_shield': {
      const stats = calculateHeroStats(next, heroEntityId, { nowMs });
      hero.currentResource = Math.min(
        stats.maxResource,
        hero.currentResource + stats.maxResource * numeric(values.mana_restore_pct_max) / 100,
      );
      statusData.shieldAmount = stats.maxResource * numeric(values.shield_pct_max_mana) / 100;
      break;
    }
    default:
      break;
  }

  if (statusDurationMs > 0 && Object.keys(statusData).length > 2) {
    const statusId = `item:active:${item.instanceId}:${effect.id}`;
    hero.runtime.statuses[statusId] = {
      id: statusId,
      sourceHeroEntityId: heroEntityId,
      expiresAtMs: nowMs + statusDurationMs,
      data: statusData,
    };
  }

  const ownerContext = syncHeroItemRuntime(next, heroEntityId, nowMs);
  itemActivationOwners.set(item.instanceId, { ...ownerContext, activatedAtMs: nowMs });

  const consumed = values.consumes_item === true;
  const resultItem = structuredClone(item);
  if (consumed) {
    slot.item = null;
    syncHeroItemRuntime(next, heroEntityId, nowMs);
  }
  return { match: next, item: resultItem, definition, ok: true, reason: null, consumed };
}

/** Applies restorative item statuses between simulation ticks and republishes item-derived movement. */
export function advanceItemActiveEffects(
  state: MatchState,
  heroEntityId: string,
  elapsedMs: number,
  nowMs: number,
): MatchState {
  if (elapsedMs <= 0) {
    syncHeroItemRuntime(state, heroEntityId, nowMs);
    return state;
  }
  const sourceHero = getRequiredHero(state, heroEntityId);
  const statuses = Object.values(sourceHero.runtime.statuses).filter(status => status.id.startsWith('item:active:'));
  if (statuses.length === 0) {
    syncHeroItemRuntime(state, heroEntityId, nowMs);
    return state;
  }

  const next = structuredClone(state);
  const hero = getRequiredHero(next, heroEntityId);
  const stats = calculateHeroStats(next, heroEntityId, { nowMs });
  const tickStart = nowMs - elapsedMs;

  for (const status of Object.values(hero.runtime.statuses)) {
    if (!status.id.startsWith('item:active:')) continue;
    const startedAtMs = numeric(status.data?.startedAtMs, tickStart);
    const activeStart = Math.max(tickStart, startedAtMs);
    const activeEnd = Math.min(nowMs, status.expiresAtMs);
    const seconds = Math.max(0, activeEnd - activeStart) / 1000;
    if (seconds > 0) {
      const requiresOutOfCombat = status.data?.requiresOutOfCombat === true;
      const lastDamageAtMs = numeric(hero.runtime.timestamps['combat:last-damage-at-ms'], Number.NEGATIVE_INFINITY);
      const canRestore = !requiresOutOfCombat || lastDamageAtMs < startedAtMs;
      if (canRestore) {
        hero.currentHp = Math.min(stats.maxHp, hero.currentHp + numeric(status.data?.healPerSecond) * seconds);
        hero.currentResource = Math.min(stats.maxResource, hero.currentResource + numeric(status.data?.manaPerSecond) * seconds);
      }
    }
    if (status.expiresAtMs <= nowMs) delete hero.runtime.statuses[status.id];
  }

  syncHeroItemRuntime(next, heroEntityId, nowMs);
  return next;
}

export function createInventoryItem(definition: ItemDefinition, instanceId: string): InventoryItem {
  return {
    instanceId,
    definitionId: definition.id,
    displayName: definition.name,
    quantity: 1,
    statModifiers: itemStatsToHeroModifiers(definition.stats),
    cooldownReadyAtMs: 0,
  };
}

function numeric(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Converts the economy-facing item vocabulary to the combat-stat vocabulary already used
 * by MatchHeroState. Primary attributes use deliberately explicit Dawnreach conversion
 * rates so their derived value remains deterministic and can be tuned in one place later.
 * Magic power deliberately stays in the item vocabulary; active-item spell formulas read
 * it directly so the item system remains independent from any one hero implementation.
 */
export function itemStatsToHeroModifiers(stats: ItemStats): ItemStatModifier[] {
  const modifiers: ItemStatModifier[] = [];
  const addFlat = (stat: ItemStatModifier['stat'], value: number | undefined) => {
    if (!value) return;
    modifiers.push({ stat, mode: 'flat', value });
  };
  const addPercent = (stat: ItemStatModifier['stat'], value: number | undefined) => {
    if (!value) return;
    modifiers.push({ stat, mode: 'percent', value });
  };

  if (stats.strength) {
    addFlat('maxHp', stats.strength * 20);
    addFlat('hpRegenPerSecond', stats.strength * 0.1);
  }
  if (stats.agility) {
    addPercent('attackSpeed', stats.agility);
    addFlat('physicalArmor', stats.agility * 0.15);
  }
  if (stats.intelligence) {
    addFlat('maxResource', stats.intelligence * 12);
    addFlat('resourceRegenPerSecond', stats.intelligence * 0.05);
  }

  addFlat('attackDamage', stats.damage);
  addFlat('physicalArmor', stats.armor);
  addPercent('attackSpeed', stats.attack_speed_pct);
  addFlat('movementSpeed', stats.move_speed_flat);
  addFlat('maxHp', stats.hp);
  addFlat('hpRegenPerSecond', stats.hp_regen);
  addFlat('maxResource', stats.mana);
  addFlat('resourceRegenPerSecond', stats.mana_regen);
  addFlat('magicResistance', stats.magic_resist_pct);

  return modifiers;
}