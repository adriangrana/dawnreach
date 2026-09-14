import type { DragEvent, MouseEvent, PointerEvent } from 'react';
import type { InventorySlot } from '../game/heroes/types';
import { getItemDefinition } from '../game/items/itemDatabase';
import { readInventoryDragPayload, writeInventoryDragPayload } from '../game/items/itemDrag';
import { getItemIconDataUrl } from '../game/items/itemVisuals';

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

  const stopPointer = (event: PointerEvent<HTMLDivElement>) => event.stopPropagation();
  const stopMouse = (event: MouseEvent<HTMLDivElement>) => event.stopPropagation();

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!item || !active || disabled) return;
    onUse(slot.slot);
  };

  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (!item) {
      event.preventDefault();
      return;
    }
    writeInventoryDragPayload(event.dataTransfer, {
      slot: slot.slot,
      instanceId: item.instanceId,
      itemId: item.definitionId,
    });
    event.currentTarget.classList.add('is-dragging');
  };

  const handleDragEnd = (event: DragEvent<HTMLDivElement>) => {
    event.stopPropagation();
    event.currentTarget.classList.remove('is-dragging');
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
      draggable={Boolean(item)}
      onPointerDown={stopPointer}
      onPointerUp={stopPointer}
      onContextMenu={stopMouse}
      onClick={handleClick}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      role={item ? 'button' : undefined}
      tabIndex={item ? 0 : -1}
      aria-label={item ? `${item.displayName}${active ? ', objeto activable' : ''}` : `Hueco de inventario ${index + 1}`}
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
            {definition.active_effect && <i>{remainingMs > 0 ? `Disponible en ${cooldownSeconds}s` : 'Click o tecla del slot para activar'}</i>}
          </div>
        </>
      )}
      <span className="item-key">{index + 1}</span>
    </div>
  );
}
