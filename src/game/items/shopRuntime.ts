import type { InventoryItem, ItemStatModifier } from '../heroes/types';
import { getRequiredHero } from '../match/matchState';
import type { MatchState } from '../match/types';
import { getItemDefinition, type ItemDefinition, type ItemStats } from './itemDatabase';

export type ShopTransactionReason = 'unknown-item' | 'not-enough-gold' | 'inventory-full' | null;

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

  if (emptySlot) {
    emptySlot.item = item;
    return { match: next, definition, item, ok: true, dropped: false, reason: null };
  }

  // Buying is still valid with a full inventory: the item is paid for and materializes
  // on the ground beside the hero, matching the world-pickup rules used by the shop.
  return { match: next, definition, item, ok: true, dropped: true, reason: 'inventory-full' };
}

export function pickUpGroundItem(
  state: MatchState,
  heroEntityId: string,
  itemId: string,
  instanceId: string,
): GroundPickupResult {
  const definition = getItemDefinition(itemId);
  if (!definition) return { match: state, definition: null, item: null, ok: false, reason: 'unknown-item' };

  const sourceHero = getRequiredHero(state, heroEntityId);
  const sourceSlot = sourceHero.inventory.find(slot => slot.item === null);
  if (!sourceSlot) return { match: state, definition, item: null, ok: false, reason: 'inventory-full' };

  const next = structuredClone(state);
  const hero = getRequiredHero(next, heroEntityId);
  const emptySlot = hero.inventory.find(slot => slot.item === null);
  if (!emptySlot) return { match: state, definition, item: null, ok: false, reason: 'inventory-full' };

  const item = createInventoryItem(definition, instanceId);
  emptySlot.item = item;
  return { match: next, definition, item, ok: true, reason: null };
}

export function createInventoryItem(definition: ItemDefinition, instanceId: string): InventoryItem {
  return {
    instanceId,
    definitionId: definition.id,
    displayName: definition.name,
    quantity: 1,
    statModifiers: itemStatsToHeroModifiers(definition.stats),
  };
}

/**
 * Converts the economy-facing item vocabulary to the combat-stat vocabulary already used
 * by MatchHeroState. Primary attributes use deliberately explicit Dawnreach conversion
 * rates so their derived value remains deterministic and can be tuned in one place later.
 *
 * magic_power is intentionally retained in the item definition but has no HeroStats field
 * yet; it will be consumed by the spell-damage pipeline when that stat is introduced.
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
