import type { InventoryItem } from '../heroes/types';

const ITEM_STACK_LIMITS: Readonly<Record<string, number>> = {
  item_004: 99,
  item_059: 99,
};

export function getItemStackLimit(definitionId: string) {
  return Math.max(1, Math.floor(ITEM_STACK_LIMITS[definitionId] ?? 1));
}

export function isStackableItem(definitionId: string) {
  return getItemStackLimit(definitionId) > 1;
}

export function canMergeItemStacks(first: InventoryItem | null | undefined, second: InventoryItem | null | undefined) {
  if (!first || !second || first.definitionId !== second.definitionId) return false;
  return isStackableItem(first.definitionId);
}
