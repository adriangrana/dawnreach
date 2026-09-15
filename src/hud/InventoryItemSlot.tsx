import { useEffect, useId, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import type { InventorySlot } from '../game/heroes/types';
import { getItemDefinition } from '../game/items/itemDatabase';
import { readInventoryDragPayload } from '../game/items/itemDrag';
import {
  ITEM_TARGET_CONFIRM_EVENT,
  ITEM_TARGET_REQUEST_EVENT,
  type ItemTargetConfirmDetail,
  type ItemTargetRequestDetail,
} from '../game/items/shopEvents';
import {
  TELEPORT_CAST_REQUEST_EVENT,
  TELEPORT_SCROLL_ITEM_ID,
  TELEPORT_SCROLL_SLOT,
  TELEPORT_TARGET_REQUEST_EVENT,
  TELEPORT_TARGETING_STATE_EVENT,
  type TeleportCastRequestDetail,
  type TeleportTargetRequestDetail,
  type TeleportTargetingStateDetail,
} from '../game/items/teleportScrollEvents';
import { isWardPlacementEffect } from '../game/items/wardGameplay';
import { getItemIconDataUrl } from '../game/items/itemVisuals';
import { INVENTORY_SLOT_HOTKEYS } from './inventoryControls';

const LOCAL_HERO_ENTITY_ID = 'blue-hero-alden';
const SELECTION_OVERLAY_SELECTOR = '.selected-entity-hud-overlay';

const STAT_LABELS: Record<string, string> = {
  strength: 'Fuerza', agility: 'Agilidad', intelligence: 'Inteligencia', damage: 'Daño físico',
  magic_power: 'Poder mágico', armor: 'Armadura', attack_speed_pct: 'Vel. ataque',
  move_speed_flat: 'Vel. movimiento', hp: 'Vida', hp_regen: 'Regen. vida', mana: 'Maná',
  mana_regen: 'Regen. maná', magic_resist_pct: 'Res. mágica',
};

function formatStat(stat: string, amount: number) {
  const pct = stat === 'attack_speed_pct' || stat === 'magic_resist_pct';
  return `+${Number.isInteger(amount) ? amount : amount.toFixed(1)}${pct ? '%' : ''} ${STAT_LABELS[stat] ?? stat}`;
}

function ensureLocalHeroSelectedForTargeting() {
  const overlay = document.querySelector<HTMLElement>(SELECTION_OVERLAY_SELECTOR);
  if (overlay?.dataset.selectionKind === 'hero' && overlay.dataset.selectionId === LOCAL_HERO_ENTITY_ID) return;
  window.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'F1',
    code: 'F1',
    bubbles: true,
    cancelable: true,
  }));
}

function isTypingTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  return Boolean(
    element?.isContentEditable
    || element instanceof HTMLInputElement
    || element instanceof HTMLTextAreaElement
    || element instanceof HTMLSelectElement
  );
}

export default function InventoryItemSlot({
  slot,
  index,
  nowMs,
  onUse,
  onMove,
}: {
  slot: InventorySlot;
  index: number;
  nowMs: number;
  onUse: (slot: number) => void;
  onMove: (fromSlot: number, toSlot: number) => void;
}) {
  const item = slot.item;
  const definition = item ? getItemDefinition(item.definitionId) : null;
  const teleportSlot = slot.slot === TELEPORT_SCROLL_SLOT;
  const validTeleportItem = teleportSlot && item?.definitionId === TELEPORT_SCROLL_ITEM_ID;
  const cooldownReadyAtMs = item?.cooldownReadyAtMs ?? 0;
  const remainingMs = Math.max(0, cooldownReadyAtMs - nowMs);
  const active = Boolean(definition?.active_effect);
  const disabled = remainingMs > 0;
  const cooldownSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const hotkey = teleportSlot ? 'T' : (INVENTORY_SLOT_HOTKEYS[index]?.label ?? `${index + 1}`);
  const requiresGroundTarget = Boolean(definition?.active_effect && isWardPlacementEffect(definition.active_effect.id));
  const slotRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties | null>(null);
  const [teleportHost, setTeleportHost] = useState<HTMLElement | null>(null);
  const [teleportTargeting, setTeleportTargeting] = useState(false);

  useEffect(() => {
    if (!teleportSlot) return;
    setTeleportHost(document.querySelector<HTMLElement>('.inventory-panel'));
  }, [teleportSlot]);

  useEffect(() => {
    if (!item || !requiresGroundTarget) return;

    const onTargetConfirm = (event: Event) => {
      const detail = (event as CustomEvent<ItemTargetConfirmDetail>).detail;
      if (!detail || detail.instanceId !== item.instanceId) return;
      onUse(slot.slot);
    };

    window.addEventListener(ITEM_TARGET_CONFIRM_EVENT, onTargetConfirm as EventListener);
    return () => window.removeEventListener(ITEM_TARGET_CONFIRM_EVENT, onTargetConfirm as EventListener);
  }, [item?.instanceId, onUse, requiresGroundTarget, slot.slot]);

  useEffect(() => {
    if (!validTeleportItem || !item) return;
    const instanceId = item.instanceId;

    const onCastRequest = (event: Event) => {
      const detail = (event as CustomEvent<TeleportCastRequestDetail>).detail;
      if (!detail || detail.instanceId !== instanceId) return;
      setTeleportTargeting(false);
      onUse(TELEPORT_SCROLL_SLOT);
    };
    const onTargetingState = (event: Event) => {
      const detail = (event as CustomEvent<TeleportTargetingStateDetail>).detail;
      if (!detail || detail.instanceId !== instanceId) return;
      setTeleportTargeting(detail.active);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'KeyT' || event.repeat || event.isComposing || isTypingTarget(event.target)) return;
      if (event.ctrlKey || event.altKey || event.metaKey || disabled) return;
      if (document.querySelector('.shop-overlay')) return;
      event.preventDefault();
      event.stopPropagation();
      ensureLocalHeroSelectedForTargeting();
      const detail: TeleportTargetRequestDetail = {
        itemId: TELEPORT_SCROLL_ITEM_ID,
        instanceId,
        source: 'hotkey',
        requestedAtMs: performance.now(),
      };
      window.dispatchEvent(new CustomEvent<TeleportTargetRequestDetail>(TELEPORT_TARGET_REQUEST_EVENT, { detail }));
    };

    window.addEventListener(TELEPORT_CAST_REQUEST_EVENT, onCastRequest as EventListener);
    window.addEventListener(TELEPORT_TARGETING_STATE_EVENT, onTargetingState as EventListener);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener(TELEPORT_CAST_REQUEST_EVENT, onCastRequest as EventListener);
      window.removeEventListener(TELEPORT_TARGETING_STATE_EVENT, onTargetingState as EventListener);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [disabled, item?.instanceId, onUse, validTeleportItem]);

  useEffect(() => {
    const close = () => setTooltipStyle(null);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, []);

  const showTooltip = () => {
    if (!item || !definition) return;
    const rect = slotRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(286, window.innerWidth - 24);
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.right - width + 4));
    const bottom = Math.max(12, window.innerHeight - rect.top + 12);
    setTooltipStyle({ width, left, bottom, maxHeight: Math.max(120, Math.min(430, rect.top - 24)) });
  };

  const hideTooltip = () => setTooltipStyle(null);
  const stopPointer = (event: PointerEvent<HTMLDivElement>) => event.stopPropagation();
  const stopMouse = (event: MouseEvent<HTMLDivElement>) => event.stopPropagation();

  const requestTeleportTarget = (source: TeleportTargetRequestDetail['source']) => {
    if (!validTeleportItem || !item || disabled) return;
    ensureLocalHeroSelectedForTargeting();
    const detail: TeleportTargetRequestDetail = {
      itemId: TELEPORT_SCROLL_ITEM_ID,
      instanceId: item.instanceId,
      source,
      requestedAtMs: performance.now(),
    };
    window.dispatchEvent(new CustomEvent<TeleportTargetRequestDetail>(TELEPORT_TARGET_REQUEST_EVENT, { detail }));
  };

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!item || !definition?.active_effect || !active || disabled) return;

    if (teleportSlot) {
      requestTeleportTarget('slot');
      return;
    }

    if (requiresGroundTarget) {
      ensureLocalHeroSelectedForTargeting();
      const detail: ItemTargetRequestDetail = {
        itemId: item.definitionId,
        instanceId: item.instanceId,
        effectId: definition.active_effect.id,
        values: definition.active_effect.values,
      };
      window.dispatchEvent(new CustomEvent<ItemTargetRequestDetail>(ITEM_TARGET_REQUEST_EVENT, { detail }));
      return;
    }

    onUse(slot.slot);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (teleportSlot) return;
    if (!Array.from(event.dataTransfer.types).includes('application/x-dawnreach-inventory-item')) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (teleportSlot) return;
    event.preventDefault();
    event.stopPropagation();
    const payload = readInventoryDragPayload(event.dataTransfer);
    if (!payload || payload.slot === slot.slot) return;
    onMove(payload.slot, slot.slot);
  };

  const tooltipOpen = Boolean(item && definition && tooltipStyle);
  const quantity = Math.max(1, item?.quantity ?? 1);
  const saleGold = definition ? Math.floor(definition.cost / 2) * quantity : 0;
  const filledClass = item
    ? teleportSlot ? 'inventory-slot--teleport-filled' : 'inventory-slot--filled'
    : 'inventory-slot--empty';

  const slotElement = (
    <div
      ref={slotRef}
      className={`inventory-slot ${filledClass}${active ? ' inventory-slot--active' : ''}${teleportSlot ? ' inventory-slot--teleport' : ''}`}
      data-slot={slot.slot}
      data-instance-id={item?.instanceId}
      data-item-id={item?.definitionId}
      draggable={false}
      onPointerDown={stopPointer}
      onPointerUp={stopPointer}
      onPointerEnter={showTooltip}
      onPointerLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
      onContextMenu={stopMouse}
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      role={item ? 'button' : undefined}
      tabIndex={item ? 0 : -1}
      aria-describedby={tooltipOpen ? tooltipId : undefined}
      aria-label={item
        ? `${item.displayName}${quantity > 1 ? `, ${quantity} unidades` : ''}${active ? `, objeto activable con ${hotkey}` : ''}`
        : teleportSlot ? 'Ranura exclusiva de Pergamino de Teletransporte' : `Hueco de inventario ${index + 1}`}
    >
      {item && definition && (
        <>
          <img className="inventory-item-art" src={getItemIconDataUrl(item.definitionId)} alt="" draggable={false} />
          {quantity > 1 && <span className="inventory-item-quantity" aria-label={`${quantity} unidades`}>{quantity}</span>}
          {remainingMs > 0 && (
            <span className="inventory-item-cooldown" aria-label={`${cooldownSeconds} segundos de enfriamiento`}>
              <b>{cooldownSeconds}</b>
            </span>
          )}
          {active && remainingMs <= 0 && <span className="inventory-item-active-pip" aria-hidden="true" />}
        </>
      )}
      <span className="item-key">{hotkey}</span>

      {tooltipOpen && item && definition && createPortal(
        <div id={tooltipId} className="inventory-item-tooltip inventory-item-tooltip--portal" role="tooltip" style={tooltipStyle ?? undefined}>
          <div className="inventory-tooltip-head">
            <img src={getItemIconDataUrl(item.definitionId)} alt="" />
            <div>
              <strong>{definition.name}{quantity > 1 ? ` ×${quantity}` : ''}</strong>
              <span>{definition.tier} · {definition.cost} oro c/u · venta {saleGold}</span>
            </div>
          </div>
          {Object.keys(definition.stats).length > 0 && (
            <div className="inventory-tooltip-stats">
              {Object.entries(definition.stats).map(([stat, amount]) => <span key={stat}>{formatStat(stat, Number(amount))}</span>)}
            </div>
          )}
          {definition.passive_effect && <p><b>Pasiva — {definition.passive_effect.name}:</b> {definition.passive_effect.description}</p>}
          {definition.active_effect && (
            <p><b>Activa — {definition.active_effect.name}:</b> {definition.active_effect.description}<em>CD {definition.active_effect.cooldown}s{definition.active_effect.mana_cost ? ` · ${definition.active_effect.mana_cost} maná` : ''}</em></p>
          )}
          <small>{definition.flavor_text}</small>
          {definition.active_effect && <i>{remainingMs > 0 ? `Disponible en ${cooldownSeconds}s` : `Click o ${hotkey} para activar`}</i>}
        </div>,
        document.body,
      )}
    </div>
  );

  if (teleportSlot) {
    if (!teleportHost) return null;
    return createPortal(
      <div className={`teleport-slot-shell${teleportTargeting ? ' is-targeting' : ''}`}>
        <span className="teleport-slot-label">TP</span>
        {slotElement}
      </div>,
      teleportHost,
    );
  }

  return slotElement;
}
