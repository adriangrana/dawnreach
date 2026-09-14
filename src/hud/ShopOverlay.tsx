import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { Coins, Search, ShoppingBag, X } from 'lucide-react';
import { ITEM_BY_ID, ITEMS, type ItemDefinition, type ItemTier } from '../game/items/itemDatabase';
import { readInventoryDragPayload } from '../game/items/itemDrag';
import { getItemIconDataUrl } from '../game/items/itemVisuals';

const TIERS: readonly ItemTier[] = ['Básico', 'Intermedio', 'Avanzado'];

const STAT_LABELS: Record<string, string> = {
  strength: 'Fuerza', agility: 'Agilidad', intelligence: 'Inteligencia', damage: 'Daño físico',
  magic_power: 'Poder mágico', armor: 'Armadura', attack_speed_pct: 'Velocidad de ataque',
  move_speed_flat: 'Velocidad de movimiento', hp: 'Vida', hp_regen: 'Regeneración de vida',
  mana: 'Maná', mana_regen: 'Regeneración de maná', magic_resist_pct: 'Resistencia mágica',
};

function formatStat(stat: string, value: number) {
  const percent = stat === 'attack_speed_pct' || stat === 'magic_resist_pct';
  return `+${Number.isInteger(value) ? value : value.toFixed(1)}${percent ? '%' : ''} ${STAT_LABELS[stat] ?? stat}`;
}

function itemTierClass(tier: ItemTier) {
  if (tier === 'Avanzado') return 'shop-item-icon--advanced';
  if (tier === 'Intermedio') return 'shop-item-icon--intermediate';
  return 'shop-item-icon--basic';
}

function ItemArt({ id, className }: { id: string; className: string }) {
  return <img className={className} src={getItemIconDataUrl(id)} alt="" draggable={false} />;
}

function EffectBlock({ label, effect }: {
  label: string;
  effect: ItemDefinition['passive_effect'] | ItemDefinition['active_effect'];
}) {
  if (!effect) return null;
  const activeEffect = 'cooldown' in effect ? effect : null;
  return (
    <div className="shop-effect-block">
      <div className="shop-effect-title"><span>{label}</span><strong>{effect.name}</strong></div>
      <p>{effect.description}</p>
      {activeEffect && (
        <div className="shop-effect-meta">
          <span>CD {activeEffect.cooldown}s</span>
          <span>{activeEffect.mana_cost > 0 ? `${activeEffect.mana_cost} maná` : 'Sin coste de maná'}</span>
        </div>
      )}
    </div>
  );
}

export default function ShopOverlay({
  open,
  gold,
  inventoryFull,
  onClose,
  onBuy,
  onSell,
}: {
  open: boolean;
  gold: number;
  inventoryFull: boolean;
  onClose: () => void;
  onBuy: (itemId: string) => void;
  onSell: (instanceId: string) => void;
}) {
  const [tier, setTier] = useState<ItemTier>('Básico');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('item_001');
  const [sellHot, setSellHot] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const items = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('es');
    return ITEMS
      .filter(item => item.tier === tier)
      .filter(item => !normalized
        || item.name.toLocaleLowerCase('es').includes(normalized)
        || item.flavor_text.toLocaleLowerCase('es').includes(normalized));
  }, [query, tier]);

  const selected = ITEM_BY_ID.get(selectedId)
    ?? items[0]
    ?? ITEMS.find(item => item.tier === tier)
    ?? ITEMS[0];

  useEffect(() => {
    if (items.length === 0) return;
    if (!items.some(item => item.id === selectedId)) setSelectedId(items[0].id);
  }, [items, selectedId]);

  if (!open || !selected) return null;

  const components = selected.components.flatMap(component => {
    const definition = ITEM_BY_ID.get(component.id);
    return definition ? [{ definition, quantity: component.quantity }] : [];
  });
  const affordable = gold >= selected.cost;

  const onSellDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes('application/x-dawnreach-inventory-item')) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setSellHot(true);
  };
  const onSellDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setSellHot(false);
    const payload = readInventoryDragPayload(event.dataTransfer);
    if (payload) onSell(payload.instanceId);
  };

  return (
    <div className="shop-overlay" role="dialog" aria-modal="true" aria-label="Tienda de la base">
      <div className="shop-window" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
        <header className="shop-header">
          <div className="shop-title-mark"><ShoppingBag /></div>
          <div>
            <span className="shop-eyebrow">MERCADO DE LA CIUDADELA</span>
            <h2>Mercado del Alba</h2>
          </div>
          <div
            className={`shop-sell-dropzone${sellHot ? ' is-hot' : ''}`}
            onDragOver={onSellDragOver}
            onDragEnter={onSellDragOver}
            onDragLeave={() => setSellHot(false)}
            onDrop={onSellDrop}
            title="Arrastra un objeto del inventario para venderlo por la mitad de su precio"
          >
            <Coins />
            <span><b>VENDER</b><small>arrastra aquí · 50%</small></span>
          </div>
          <div className="shop-gold"><Coins /><strong>{Math.floor(gold)}</strong><span>oro</span></div>
          <button className="shop-close" type="button" onClick={onClose} aria-label="Cerrar tienda"><X /></button>
        </header>

        <div className="shop-body">
          <aside className="shop-categories">
            <div className="shop-search">
              <Search />
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar objeto" aria-label="Buscar objeto" />
            </div>
            <nav>
              {TIERS.map(candidate => {
                const count = ITEMS.filter(item => item.tier === candidate).length;
                return (
                  <button type="button" key={candidate} className={candidate === tier ? 'is-active' : ''} onClick={() => { setTier(candidate); setQuery(''); }}>
                    <span>{candidate}</span><b>{count}</b>
                  </button>
                );
              })}
            </nav>
            <div className="shop-category-note">
              <strong>{tier === 'Básico' ? 'Inicio y consumibles' : tier === 'Intermedio' ? 'Componentes de poder' : 'Objetos completos'}</strong>
              <span>{tier === 'Básico'
                ? 'Sustain, atributos y piezas de entrada.'
                : tier === 'Intermedio'
                  ? 'Estadísticas puras para construir tu ruta.'
                  : 'Recetas, pasivas y activas de alto impacto.'}</span>
            </div>
          </aside>

          <section className="shop-catalog">
            <div className="shop-catalog-heading">
              <div><span>{tier}</span><strong>{items.length} objetos disponibles</strong></div>
              {inventoryFull && <em>Inventario lleno: las compras caerán junto al héroe.</em>}
            </div>
            <div className="shop-item-grid">
              {items.map(item => {
                const canAfford = gold >= item.cost;
                return (
                  <button type="button" key={item.id} className={`shop-item-card ${item.id === selected.id ? 'is-selected' : ''}`} onClick={() => setSelectedId(item.id)}>
                    <span className={`shop-item-icon ${itemTierClass(item.tier)}`}><ItemArt id={item.id} className="shop-item-icon-art" /></span>
                    <span className="shop-item-copy">
                      <strong>{item.name}</strong>
                      <small>{Object.entries(item.stats).slice(0, 2).map(([stat, value]) => formatStat(stat, Number(value))).join(' · ') || 'Efecto utilitario'}</small>
                    </span>
                    <span className={`shop-item-cost ${canAfford ? '' : 'is-expensive'}`}><Coins />{item.cost}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <aside className="shop-details">
            <div className={`shop-detail-icon ${itemTierClass(selected.tier)}`}><ItemArt id={selected.id} className="shop-detail-icon-art" /></div>
            <span className="shop-detail-tier">{selected.tier} · {selected.phase}</span>
            <h3>{selected.name}</h3>
            <p className="shop-flavor">“{selected.flavor_text}”</p>

            {Object.keys(selected.stats).length > 0 && (
              <div className="shop-stat-list">
                {Object.entries(selected.stats).map(([stat, value]) => <span key={stat}>{formatStat(stat, Number(value))}</span>)}
              </div>
            )}

            <EffectBlock label="PASIVA" effect={selected.passive_effect} />
            <EffectBlock label="ACTIVA" effect={selected.active_effect} />

            {components.length > 0 && (
              <div className="shop-recipe">
                <span>RECETA</span>
                <div>
                  {components.map(({ definition, quantity }) => (
                    <button key={definition.id} type="button" onClick={() => { setTier(definition.tier); setSelectedId(definition.id); }}>
                      <b><ItemArt id={definition.id} className="shop-recipe-icon-art" /></b>
                      <span>{definition.name}{quantity > 1 ? ` ×${quantity}` : ''}</span>
                    </button>
                  ))}
                </div>
                {selected.recipe_cost > 0 && <small>Coste de combinación: {selected.recipe_cost} oro</small>}
              </div>
            )}

            <button type="button" className="shop-buy-button" disabled={!affordable} onClick={() => onBuy(selected.id)}>
              <Coins /><span>{affordable ? `Comprar por ${selected.cost}` : `Faltan ${selected.cost - gold} de oro`}</span>
            </button>
            {inventoryFull && affordable && <small className="shop-drop-warning">Se comprará igualmente y caerá al suelo junto a tu héroe.</small>}
          </aside>
        </div>
      </div>
    </div>
  );
}
