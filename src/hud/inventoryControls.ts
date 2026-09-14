import { writeInventoryDragPayload } from '../game/items/itemDrag';

export const INVENTORY_SLOT_HOTKEYS = [
  { code: 'KeyQ', label: 'ALT+Q' },
  { code: 'KeyW', label: 'ALT+W' },
  { code: 'KeyE', label: 'ALT+E' },
  { code: 'KeyA', label: 'ALT+A' },
  { code: 'KeyS', label: 'ALT+S' },
  { code: 'KeyD', label: 'ALT+D' },
] as const;

const DRAG_THRESHOLD_PX = 6;
const INVENTORY_SLOT_SELECTOR = '.inventory-grid .inventory-slot';
const FILLED_SLOT_SELECTOR = '.inventory-slot--filled';
const SELL_ZONE_SELECTOR = '.shop-sell-dropzone';
const WORLD_DROP_SELECTOR = '.game-canvas, .game-host';

type PointerInventoryDrag = {
  pointerId: number;
  source: HTMLElement;
  slot: number;
  instanceId: string;
  itemId: string;
  startX: number;
  startY: number;
  dragging: boolean;
  ghost: HTMLElement | null;
  highlighted: HTMLElement | null;
};

function isTypingTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  return Boolean(
    element?.isContentEditable
    || element instanceof HTMLInputElement
    || element instanceof HTMLTextAreaElement
    || element instanceof HTMLSelectElement
  );
}

function closestHTMLElement(target: Element | null, selector: string) {
  return target?.closest<HTMLElement>(selector) ?? null;
}

function createDragGhost(source: HTMLElement) {
  const ghost = document.createElement('div');
  ghost.className = 'inventory-drag-ghost';

  const sourceImage = source.querySelector<HTMLImageElement>('.inventory-item-art');
  if (sourceImage) {
    const image = document.createElement('img');
    image.src = sourceImage.src;
    image.alt = '';
    image.draggable = false;
    ghost.appendChild(image);
  }

  document.body.appendChild(ghost);
  return ghost;
}

function positionGhost(ghost: HTMLElement | null, clientX: number, clientY: number) {
  if (!ghost) return;
  ghost.style.transform = `translate3d(${clientX + 14}px, ${clientY + 14}px, 0)`;
}

function clearHighlight(drag: PointerInventoryDrag) {
  if (!drag.highlighted) return;
  drag.highlighted.classList.remove('is-pointer-drop-target', 'is-hot', 'is-inventory-drop-target');
  drag.highlighted = null;
}

function getDropTarget(clientX: number, clientY: number) {
  const hit = document.elementFromPoint(clientX, clientY);
  if (!hit) return null;

  const inventorySlot = closestHTMLElement(hit, INVENTORY_SLOT_SELECTOR);
  if (inventorySlot) return inventorySlot;

  const sellZone = closestHTMLElement(hit, SELL_ZONE_SELECTOR);
  if (sellZone) return sellZone;

  const world = closestHTMLElement(hit, WORLD_DROP_SELECTOR);
  if (world) return world.classList.contains('game-canvas')
    ? world.closest<HTMLElement>('.game-host') ?? world
    : world;

  return null;
}

function highlightDropTarget(drag: PointerInventoryDrag, target: HTMLElement | null) {
  const normalizedTarget = target === drag.source ? null : target;
  if (drag.highlighted === normalizedTarget) return;
  clearHighlight(drag);
  if (!normalizedTarget) return;

  if (normalizedTarget.matches(INVENTORY_SLOT_SELECTOR)) {
    normalizedTarget.classList.add('is-pointer-drop-target');
  } else if (normalizedTarget.matches(SELL_ZONE_SELECTOR)) {
    normalizedTarget.classList.add('is-hot');
  } else if (normalizedTarget.matches('.game-host')) {
    normalizedTarget.classList.add('is-inventory-drop-target');
  }
  drag.highlighted = normalizedTarget;
}

function dispatchSyntheticDrop(drag: PointerInventoryDrag, target: HTMLElement, clientX: number, clientY: number) {
  const dataTransfer = new DataTransfer();
  writeInventoryDragPayload(dataTransfer, {
    slot: drag.slot,
    instanceId: drag.instanceId,
    itemId: drag.itemId,
  });

  target.dispatchEvent(new DragEvent('dragover', {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    dataTransfer,
  }));
  target.dispatchEvent(new DragEvent('drop', {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    dataTransfer,
  }));
}

export function mountInventoryControls() {
  let drag: PointerInventoryDrag | null = null;
  let suppressNextClick = false;
  let suppressResetTimer = 0;

  const cleanupDrag = () => {
    if (!drag) return;
    clearHighlight(drag);
    drag.source.classList.remove('is-dragging');
    drag.ghost?.remove();
    document.body.classList.remove('inventory-pointer-dragging');
    drag = null;
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || isTypingTarget(event.target)) return;
    const source = closestHTMLElement(event.target instanceof Element ? event.target : null, FILLED_SLOT_SELECTOR);
    if (!source) return;

    const slot = Number(source.dataset.slot);
    const instanceId = source.dataset.instanceId;
    const itemId = source.dataset.itemId;
    if (!Number.isInteger(slot) || !instanceId || !itemId) return;

    cleanupDrag();
    drag = {
      pointerId: event.pointerId,
      source,
      slot,
      instanceId,
      itemId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      ghost: null,
      highlighted: null,
    };
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;

    if (!drag.dragging) {
      const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
      if (distance < DRAG_THRESHOLD_PX) return;
      drag.dragging = true;
      drag.source.classList.add('is-dragging');
      drag.ghost = createDragGhost(drag.source);
      document.body.classList.add('inventory-pointer-dragging');
    }

    event.preventDefault();
    event.stopPropagation();
    positionGhost(drag.ghost, event.clientX, event.clientY);
    highlightDropTarget(drag, getDropTarget(event.clientX, event.clientY));
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const activeDrag = drag;

    if (activeDrag.dragging) {
      event.preventDefault();
      event.stopPropagation();
      suppressNextClick = true;
      window.clearTimeout(suppressResetTimer);
      suppressResetTimer = window.setTimeout(() => { suppressNextClick = false; }, 80);

      const target = getDropTarget(event.clientX, event.clientY);
      if (target && target !== activeDrag.source) {
        dispatchSyntheticDrop(activeDrag, target, event.clientX, event.clientY);
      }
    }

    cleanupDrag();
  };

  const onPointerCancel = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    cleanupDrag();
  };

  const onClick = (event: MouseEvent) => {
    if (!suppressNextClick) return;
    suppressNextClick = false;
    window.clearTimeout(suppressResetTimer);
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.repeat || isTypingTarget(event.target)) return;
    const hotkeyIndex = INVENTORY_SLOT_HOTKEYS.findIndex(hotkey => hotkey.code === event.code);
    if (hotkeyIndex < 0) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    const slots = Array.from(document.querySelectorAll<HTMLElement>(INVENTORY_SLOT_SELECTOR));
    slots[hotkeyIndex]?.click();
  };

  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('pointercancel', onPointerCancel, true);
  window.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKeyDown, true);

  return () => {
    cleanupDrag();
    window.clearTimeout(suppressResetTimer);
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('pointercancel', onPointerCancel, true);
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('keydown', onKeyDown, true);
  };
}
