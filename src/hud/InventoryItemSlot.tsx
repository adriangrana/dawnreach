import { useEffect, type DragEvent, type MouseEvent, type PointerEvent } from 'react';
import type { InventorySlot } from '../game/heroes/types';
import { getItemDefinition } from '../game/items/itemDatabase';
import { readInventoryDragPayload } from '../game/items/itemDrag';
import {
  ITEM_TARGET_CONFIRM_EVENT,
  ITEM_TARGET_REQUEST_EVENT,
  type ItemTargetConfirmDetail,
  type ItemTargetRequestDetail,
} from '../game/items/shopEvents';
import { getItemIconDataUrl } from '../game/items/itemVisuals';
import { INVENTORY_SLOT_HOTKEYS } from './inventoryControls';

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
  const cooldownReadyAtMs = item?.cooldownReadyAtMs ?? 0;
  const remainingMs = Math.max(0, cooldownReadyAtMs - nowMs);
  const active = Boolean(definition?.active_effect);
  const disabled = remainingMs > 0;
  const cooldownSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const hotkey = INVENTORY_SLOT_HOTKEYS[index]?.label ?? `${index + 1}`;
  const requiresGroundTarget = definition?.active_effect?.id === 'place_vision_ward';

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

  const stopPointer = (event: PointerEvent<HTMLDivElement>) => event.stopPropagation();
  const stopMouse = (event: MouseEvent<HTMLDivElement>) => event.stopPropagation();

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!item || !definition?.active_effect || !active || disabled) return;

    if (requiresGroundTarget) {
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
    if (!Array.from(event.dataTransfer.types).includes('application/x-dawnreach-inventory-item')) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const payload = readInventoryDragPayload(event.dataTransfer);
    if (!payload || payload.slot === slot.slot) return;
    onMove(payload.slot, slot.slot);
  };

  return (
    <div
      className={`inventory-slot ${item ? 'inventory-slot--filled' : 'inventory-slot--empty'}${active ? ' inventory-slot--active' : ''}`}
      data-slot={slot.slot}
      data-instance-id={item?.instanceId}
      data-item-id={item?.definitionId}
      draggable={false}
      onPointerDown={stopPointer}
      onPointerUp={stopPointer}
      onContextMenu={stopMouse}
      onClick={handleClick}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      role={item ? 'button' : undefined}
      tabIndex={item ? 0 : -1}
      aria-label={item ? `${item.displayName}${active ? `, objeto activable con ${hotkey}` : ''}` : `Hueco de inventario ${index + 1}`}
    >
      {item && definition && (
        <>
          <img className="inventory-item-art" src={getItemIconDataUrl(item.definitionId)} alt="" draggable={false} />
          {remainingMs > 0 && (
            <span className="inventory-item-cooldown" aria-label={`${cooldownSeconds} segundos de enfriamiento`}>
              <b>{cooldownSeconds}</b>
            </span>
          )}
          {active && remainingMs <= 0 && <span className="inventory-item-active-pip" aria-hidden="true" />}
          <div className="inventory-item-tooltip" role="tooltip">
            <div className="inventory-tooltip-head">
              <img src={getItemIconDataUrl(item.definitionId)} alt="" />
              <div><strong>{definition.name}</strong><span>{definition.tier} · {definition.cost} oro · venta {Math.floor(definition.cost / 2)}</span></div>
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
          </div>
        </>
      )}
      <span className="item-key">{hotkey}</span>
    </div>
  );
}
