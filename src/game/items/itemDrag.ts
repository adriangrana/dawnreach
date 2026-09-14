export const ITEM_DRAG_MIME = 'application/x-dawnreach-inventory-item';

export type InventoryDragPayload = Readonly<{
  slot: number;
  instanceId: string;
  itemId: string;
}>;

export function writeInventoryDragPayload(dataTransfer: DataTransfer, payload: InventoryDragPayload) {
  dataTransfer.effectAllowed = 'move';
  dataTransfer.setData(ITEM_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.setData('text/plain', payload.itemId);
}

export function readInventoryDragPayload(dataTransfer: DataTransfer): InventoryDragPayload | null {
  const raw = dataTransfer.getData(ITEM_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<InventoryDragPayload>;
    if (!Number.isInteger(parsed.slot) || typeof parsed.instanceId !== 'string' || typeof parsed.itemId !== 'string') return null;
    return { slot: Number(parsed.slot), instanceId: parsed.instanceId, itemId: parsed.itemId };
  } catch {
    return null;
  }
}
