import type { InventorySlot } from '../heroes/types';
import { getItemDefinition, type ItemDefinition } from './itemDatabase';
import { TELEPORT_SCROLL_SLOT } from './teleportScrollEvents';

export type ShopPurchaseComponentUse = Readonly<{
  slot: InventorySlot['slot'];
  instanceId: string;
  definitionId: string;
  quantity: number;
}>;

export type ShopPurchasePlan = Readonly<{
  fullCost: number;
  remainingCost: number;
  recipeCost: number;
  componentCredit: number;
  componentUses: readonly ShopPurchaseComponentUse[];
  consumesComponents: boolean;
  freesInventorySlot: boolean;
}>;

/**
 * Prices a composite item against the components the hero already owns.
 *
 * The planner walks the complete recipe tree. An exact owned component is consumed before
 * descending into its own recipe, so advanced components are credited at their full value,
 * while lower-tier pieces can still reduce the price of a higher-tier purchase when the
 * intermediate item has not yet been assembled.
 */
export function planShopPurchase(
  inventory: readonly InventorySlot[],
  definition: ItemDefinition,
): ShopPurchasePlan {
  if (definition.components.length === 0) {
    return {
      fullCost: definition.cost,
      remainingCost: definition.cost,
      recipeCost: 0,
      componentCredit: 0,
      componentUses: [],
      consumesComponents: false,
      freesInventorySlot: false,
    };
  }

  const remainingBySlot = new Map<InventorySlot['slot'], number>();
  for (const slot of inventory) {
    if (slot.slot === TELEPORT_SCROLL_SLOT || !slot.item) continue;
    remainingBySlot.set(slot.slot, Math.max(0, slot.item.quantity));
  }

  const usesBySlot = new Map<InventorySlot['slot'], {
    slot: InventorySlot['slot'];
    instanceId: string;
    definitionId: string;
    quantity: number;
  }>();

  const consumeOwnedUnit = (definitionId: string) => {
    for (const slot of inventory) {
      const item = slot.item;
      if (slot.slot === TELEPORT_SCROLL_SLOT || !item || item.definitionId !== definitionId) continue;
      const available = remainingBySlot.get(slot.slot) ?? 0;
      if (available <= 0) continue;

      remainingBySlot.set(slot.slot, available - 1);
      const existing = usesBySlot.get(slot.slot);
      if (existing) existing.quantity += 1;
      else {
        usesBySlot.set(slot.slot, {
          slot: slot.slot,
          instanceId: item.instanceId,
          definitionId: item.definitionId,
          quantity: 1,
        });
      }
      return true;
    }
    return false;
  };

  const acquireComponentCost = (componentDefinition: ItemDefinition): number => {
    if (consumeOwnedUnit(componentDefinition.id)) return 0;
    if (componentDefinition.components.length === 0) return componentDefinition.cost;

    let cost = componentDefinition.recipe_cost;
    for (const component of componentDefinition.components) {
      const child = getItemDefinition(component.id);
      if (!child) continue;
      for (let quantity = 0; quantity < component.quantity; quantity++) {
        cost += acquireComponentCost(child);
      }
    }
    return cost;
  };

  let remainingCost = definition.recipe_cost;
  for (const component of definition.components) {
    const componentDefinition = getItemDefinition(component.id);
    if (!componentDefinition) continue;
    for (let quantity = 0; quantity < component.quantity; quantity++) {
      remainingCost += acquireComponentCost(componentDefinition);
    }
  }

  remainingCost = Math.max(definition.recipe_cost, Math.min(definition.cost, remainingCost));
  const componentUses = Array.from(usesBySlot.values());
  const freesInventorySlot = componentUses.some(use => (remainingBySlot.get(use.slot) ?? 0) <= 0);

  return {
    fullCost: definition.cost,
    remainingCost,
    recipeCost: definition.recipe_cost,
    componentCredit: Math.max(0, definition.cost - remainingCost),
    componentUses,
    consumesComponents: componentUses.length > 0,
    freesInventorySlot,
  };
}
