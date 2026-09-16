import {
  useEffect,
  useReducer,
  useRef,
  type Dispatch,
  type DragEvent as ReactDragEvent,
  type RefObject,
  type SyntheticEvent,
} from 'react';
import { Coins, Crosshair, Diamond, Eye, Shield, Sparkles, Sword, Swords, ZoomIn } from 'lucide-react';
import { createDawnreachGame } from './game/createDawnreachGame';
import {
  publishWorldEntityRuntime,
  queueWorldDamageAdjustment,
  subscribeWorldAttackEvents,
  subscribeWorldCombatEvents,
  subscribeWorldHeroProgressionEvents,
  type WorldAttackEvent,
  type WorldCombatEvent,
  type WorldHeroProgressionEvent,
} from './game/entities/worldCombatBridge';
import { getItemDefinition } from './game/items/itemDatabase';
import { readInventoryDragPayload } from './game/items/itemDrag';
import {
  advanceItemActiveEffects,
  dropInventoryItem,
  heroHasInventorySpace,
  moveInventoryItem,
  pickUpGroundItem,
  purchaseShopItem,
  sellInventoryItem,
  useInventoryItem,
} from './game/items/shopRuntime';
import {
  ITEM_DROP_EVENT,
  ITEM_PICKUP_REQUEST_EVENT,
  ITEM_PICKUP_RESULT_EVENT,
  ITEM_USE_EVENT,
  SHOP_OPEN_EVENT,
  type ItemDropDetail,
  type ItemPickupRequestDetail,
  type ItemPickupResultDetail,
  type ItemUseDetail,
} from './game/items/shopEvents';
import AbilityButton from './hud/AbilityButton';
import HeroStatusBar from './hud/HeroStatusBar';
import InventoryItemSlot from './hud/InventoryItemSlot';
import ScoreboardOverlay from './hud/ScoreboardOverlay';
import ShopOverlay from './hud/ShopOverlay';
import { setCombatHudStats } from './hud/combatStatsOverlay';
import {
  ABILITY_KEYS, LOCAL_HERO_ENTITY_ID,
  advanceHeroPassiveGold, advanceHeroWorldEffects, applyHeroProgressionReward, applyHeroWorldDamageReaction,
  calculateHeroAttributes, calculateHeroDamageBreakdown, calculateHeroStats, calculateHeroWorldBasicAttackPreview,
  createPlayableMatch, getAbilityControl, getHeroDefinition, getHeroExperienceProgress,
  getRequiredHero, getUnspentHeroAbilityPoints,
  recoverHeroResource, resolveHeroWorldBasicAttackEffects, upgradeHeroAbility, useHeroAbility,
  type AbilityKey, type CombatTargetClass, type InventoryItem, type MatchState,
} from './game/match';

const ALDEN_PORTRAIT_SRC = new URL('./game/heroes/alden/images/H001.webp', import.meta.url).href;
const ALDEN_MINIMAP_SRC = new URL('./game/heroes/alden/images/H001I.webp', import.meta.url).href;
const HUD_ART_SRC = new URL('./assets/hud-art.svg', import.meta.url).href;
const LOCAL_WORLD_HERO_ENTITY_ID = 'blue-hero-alden';
const heroAbilityImages = import.meta.glob<string>('./game/heroes/*/images/*[QWER].webp', {
  eager: true, query: '?url', import: 'default',
});

type TeamHero = {
  initial: string;
  portrait?: string;
};

type RespawnPresentation = {
  dead: boolean;
  remainingMs: number;
  totalMs: number;
};

type PendingWorldDrop = {
  token: string;
  itemId: string;
  item: InventoryItem;
};

type PendingItemUse = {
  token: string;
  detail: ItemUseDetail;
};

const dawnTeam: TeamHero[] = [
  { initial: 'A', portrait: ALDEN_PORTRAIT_SRC },
  { initial: 'S' },
  { initial: 'K' },
  { initial: 'L' },
  { initial: 'M' },
];
const duskTeam: TeamHero[] = [
  { initial: 'V' },
  { initial: 'N' },
  { initial: 'D' },
  { initial: 'T' },
  { initial: 'R' },
];
const abilityArt: Record<AbilityKey, string> = { Q: 'blade', W: 'aegis', E: 'banner', R: 'sun' };
const heroImageCodes: Record<string, string> = { H001: 'H001' };
const heroAttributeDisplay = [
  { key: 'strength' as const, shortLabel: 'FUE', label: 'Fuerza' },
  { key: 'agility' as const, shortLabel: 'AGI', label: 'Agilidad' },
  { key: 'intelligence' as const, shortLabel: 'INT', label: 'Inteligencia' },
];

function worldTargetClass(kind: WorldAttackEvent['targetKind']): CombatTargetClass {
  if (kind === 'hero') return 'player';
  if (kind === 'creep') return 'normal';
  if (kind === 'jungle-creature') return 'boss';
  return 'elite';
}

type HudRuntime = {
  match: MatchState;
  nowMs: number;
  feedback: string;
  respawnReadyAtMs: number | null;
  respawnDurationMs: number;
  shopOpen: boolean;
  pendingDrops: readonly PendingWorldDrop[];
  groundItems: Readonly<Record<string, InventoryItem>>;
  pendingItemUses: readonly PendingItemUse[];
};

type HudAction =
  | { type: 'tick'; nowMs: number }
  | { type: 'cast'; key: AbilityKey; nowMs: number }
  | { type: 'upgrade'; key: AbilityKey; nowMs: number }
  | { type: 'world-hero-sync'; event: WorldCombatEvent }
  | { type: 'world-hero-attack'; event: WorldAttackEvent }
  | { type: 'world-progression'; event: WorldHeroProgressionEvent }
  | { type: 'shop-open'; nowMs: number }
  | { type: 'shop-close'; nowMs: number }
  | { type: 'shop-buy'; itemId: string; nowMs: number }
  | { type: 'shop-clear-drop'; token: string; nowMs: number }
  | { type: 'ground-item-pickup'; itemId: string; groundId: string; nowMs: number }
  | { type: 'inventory-move'; fromSlot: number; toSlot: number; nowMs: number }
  | { type: 'inventory-drop'; slot: number; nowMs: number }
  | { type: 'inventory-sell'; instanceId: string; nowMs: number }
  | { type: 'item-use'; slot: number; nowMs: number }
  | { type: 'item-use-clear'; token: string; nowMs: number }
  | { type: 'feedback'; message: string; nowMs: number };

function updateHudRuntime(runtime: HudRuntime, action: HudAction): HudRuntime {
  const actionNowMs = action.type === 'world-hero-sync'
    || action.type === 'world-hero-attack'
    || action.type === 'world-progression'
    ? action.event.atMs
    : action.nowMs;
  const nowMs = Math.max(runtime.nowMs, actionNowMs);
  const elapsedMs = Math.max(0, nowMs - runtime.nowMs);
  let match = recoverHeroResource(runtime.match, LOCAL_HERO_ENTITY_ID, elapsedMs, nowMs);
  match = advanceItemActiveEffects(match, LOCAL_HERO_ENTITY_ID, elapsedMs, nowMs);
  match = advanceHeroPassiveGold(match, LOCAL_HERO_ENTITY_ID, elapsedMs);
  match = advanceHeroWorldEffects(match, nowMs);

  if (action.type === 'tick') return { ...runtime, match, nowMs };

  if (action.type === 'shop-open') {
    return { ...runtime, match, nowMs, shopOpen: true, feedback: 'Mercado del Alba abierto.' };
  }

  if (action.type === 'shop-close') {
    return { ...runtime, match, nowMs, shopOpen: false };
  }

  if (action.type === 'shop-clear-drop') {
    return {
      ...runtime,
      match,
      nowMs,
      pendingDrops: runtime.pendingDrops.filter(drop => drop.token !== action.token),
    };
  }

  if (action.type === 'item-use-clear') {
    return {
      ...runtime,
      match,
      nowMs,
      pendingItemUses: runtime.pendingItemUses.filter(use => use.token !== action.token),
    };
  }

  if (action.type === 'feedback') {
    return { ...runtime, match, nowMs, feedback: action.message };
  }

  if (action.type === 'inventory-move') {
    return {
      ...runtime,
      match: moveInventoryItem(match, LOCAL_HERO_ENTITY_ID, action.fromSlot, action.toSlot),
      nowMs,
      feedback: 'Objeto movido.',
    };
  }

  if (action.type === 'inventory-drop') {
    const result = dropInventoryItem(match, LOCAL_HERO_ENTITY_ID, action.slot);
    if (!result.ok || !result.item || !result.definition) {
      return { ...runtime, match, nowMs, feedback: 'No hay ningún objeto que soltar en ese hueco.' };
    }
    const token = result.item.instanceId;
    return {
      ...runtime,
      match: result.match,
      nowMs,
      feedback: `${result.definition.name} cayó al suelo. Puedes recuperarlo con click derecho.`,
      pendingDrops: [...runtime.pendingDrops, { token, itemId: result.item.definitionId, item: result.item }],
      groundItems: { ...runtime.groundItems, [token]: result.item },
    };
  }

  if (action.type === 'inventory-sell') {
    const result = sellInventoryItem(match, LOCAL_HERO_ENTITY_ID, action.instanceId);
    if (!result.ok || !result.definition) {
      return { ...runtime, match, nowMs, feedback: 'No se pudo vender ese objeto.' };
    }
    return {
      ...runtime,
      match: result.match,
      nowMs,
      feedback: `Vendiste ${result.definition.name} por ${result.saleGold} de oro.`,
    };
  }

  if (action.type === 'item-use') {
    const result = useInventoryItem(match, LOCAL_HERO_ENTITY_ID, action.slot, nowMs);
    if (!result.ok || !result.definition || !result.item) {
      const feedback = result.reason === 'cooldown'
        ? 'Ese objeto todavía está en enfriamiento.'
        : result.reason === 'not-enough-resource'
          ? 'No tienes suficiente maná para activar ese objeto.'
          : result.reason === 'dead'
            ? 'No puedes activar objetos mientras estás muerto.'
            : result.reason === 'not-active'
              ? 'Ese objeto no tiene una habilidad activa.'
              : 'No se pudo activar el objeto.';
      return { ...runtime, match: result.match, nowMs, feedback };
    }

    const active = result.definition.active_effect;
    if (!active) return { ...runtime, match: result.match, nowMs, feedback: `${result.definition.name} no tiene activa.` };
    const detail: ItemUseDetail = {
      itemId: result.definition.id,
      instanceId: result.item.instanceId,
      effectId: active.id,
      values: active.values,
      activatedAtMs: nowMs,
    };
    const token = `${result.item.instanceId}:${nowMs}`;
    return {
      ...runtime,
      match: result.match,
      nowMs,
      feedback: `${active.name} activada${result.consumed ? ' · objeto consumido' : ` · CD ${active.cooldown}s`}.`,
      pendingItemUses: [...runtime.pendingItemUses, { token, detail }],
    };
  }

  if (action.type === 'shop-buy') {
    const instanceId = `${action.itemId}:shop:${Math.round(nowMs * 1000)}`;
    const result = purchaseShopItem(match, LOCAL_HERO_ENTITY_ID, action.itemId, instanceId);
    if (!result.ok || !result.definition) {
      const feedback = result.reason === 'not-enough-gold'
        ? `No tienes suficiente oro para ${result.definition?.name ?? 'este objeto'}.`
        : 'Ese objeto no existe en el catálogo.';
      return { ...runtime, match: result.match, nowMs, feedback };
    }

    const droppedItem = result.dropped ? result.item : null;
    const pendingDrops = droppedItem
      ? [...runtime.pendingDrops, { token: droppedItem.instanceId, itemId: droppedItem.definitionId, item: droppedItem }]
      : runtime.pendingDrops;
    const groundItems = droppedItem
      ? { ...runtime.groundItems, [droppedItem.instanceId]: droppedItem }
      : runtime.groundItems;
    const feedback = result.dropped
      ? `Compraste ${result.definition.name}. Inventario lleno: el objeto cayó junto a tu héroe.`
      : `Compraste ${result.definition.name} por ${result.definition.cost} de oro.`;
    return { ...runtime, match: result.match, nowMs, feedback, pendingDrops, groundItems };
  }

  if (action.type === 'ground-item-pickup') {
    const item = runtime.groundItems[action.groundId];
    if (!item || item.definitionId !== action.itemId) {
      return { ...runtime, match, nowMs, feedback: 'No se pudo recuperar el estado del objeto del suelo.' };
    }
    const result = pickUpGroundItem(match, LOCAL_HERO_ENTITY_ID, item);
    const feedback = result.ok && result.definition
      ? `Recogiste ${result.definition.name}.`
      : result.reason === 'inventory-full'
        ? 'No puedes recogerlo: tu inventario está lleno.'
        : 'No se pudo recoger el objeto.';
    if (!result.ok) return { ...runtime, match: result.match, nowMs, feedback };
    const groundItems = { ...runtime.groundItems };
    delete groundItems[action.groundId];
    return { ...runtime, match: result.match, nowMs, feedback, groundItems };
  }

  if (action.type === 'world-progression') {
    const before = getRequiredHero(match, LOCAL_HERO_ENTITY_ID);
    const nextMatch = applyHeroProgressionReward(match, LOCAL_HERO_ENTITY_ID, {
      experience: action.event.experienceDelta,
      gold: action.event.goldDelta,
      lastHits: action.event.lastHitsDelta,
      denies: action.event.deniesDelta,
    });
    const after = getRequiredHero(nextMatch, LOCAL_HERO_ENTITY_ID);
    const messages: string[] = [];
    if (action.event.lastHitsDelta > 0) messages.push(`LH +${action.event.lastHitsDelta}`);
    if (action.event.deniesDelta > 0) messages.push(`DN +${action.event.deniesDelta}`);
    if (action.event.goldDelta > 0) messages.push(`+${action.event.goldDelta} oro`);
    if (action.event.experienceDelta > 0) messages.push(`+${action.event.experienceDelta} XP`);
    if (after.level > before.level) messages.push(`Nivel ${after.level}`);
    return { ...runtime, match: nextMatch, nowMs, feedback: messages.join(' · ') };
  }

  if (action.type === 'world-hero-sync') {
    if ((action.event.reason === 'damage' || action.event.reason === 'death') && action.event.sourceEntityId) {
      match = applyHeroWorldDamageReaction(match, LOCAL_HERO_ENTITY_ID, {
        sourceEntityId: action.event.sourceEntityId,
        hostile: action.event.sourceEntityId !== LOCAL_WORLD_HERO_ENTITY_ID,
        isDirect: true,
        isFromFront: true,
        damageType: 'physical',
      }, nowMs);
    }

    const hero = getRequiredHero(match, LOCAL_HERO_ENTITY_ID);
    const stats = calculateHeroStats(match, hero.heroEntityId, { nowMs });
    const currentHp = Math.max(0, Math.min(stats.maxHp, action.event.currentHp));
    const currentResource = action.event.currentResource === undefined
      ? hero.currentResource
      : Math.max(0, Math.min(stats.maxResource, action.event.currentResource));
    const nextHero = { ...hero, currentHp, currentResource };
    const respawnDurationMs = action.event.reason === 'death'
      ? Math.max(0, (action.event.respawnSeconds ?? 0) * 1000)
      : action.event.reason === 'respawn'
        ? 0
        : runtime.respawnDurationMs;
    const respawnReadyAtMs = action.event.reason === 'death'
      ? action.event.atMs + respawnDurationMs
      : action.event.reason === 'respawn'
        ? null
        : runtime.respawnReadyAtMs;
    const feedback = action.event.reason === 'death'
      ? `${hero.heroName} ha caído. Reaparición en ${Math.ceil(action.event.respawnSeconds ?? 0)} s.`
      : action.event.reason === 'respawn'
        ? `${hero.heroName} ha reaparecido en la base.`
        : runtime.feedback;
    return {
      ...runtime,
      match: { ...match, heroes: { ...match.heroes, [LOCAL_HERO_ENTITY_ID]: nextHero } },
      nowMs,
      feedback,
      respawnReadyAtMs,
      respawnDurationMs,
    };
  }

  if (action.type === 'world-hero-attack') {
    const resolution = resolveHeroWorldBasicAttackEffects(
      match,
      LOCAL_HERO_ENTITY_ID,
      nowMs,
      worldTargetClass(action.event.targetKind),
    );
    const feedback = resolution.consumesInnate
      ? `Voto del Muro Vivo · +${formatHudNumber(resolution.bonusDamage)} daño · +${formatHudNumber(resolution.healing)} vida`
      : runtime.feedback;
    return { ...runtime, match: resolution.state, nowMs, feedback };
  }

  if (action.type === 'upgrade') {
    const hero = getRequiredHero(match, LOCAL_HERO_ENTITY_ID);
    const ability = getHeroDefinition(hero.definitionId).abilities[action.key];
    const currentRank = hero.abilityRanks[action.key];
    const requiredLevel = ability.unlockLevels[currentRank];
    const points = getUnspentHeroAbilityPoints(match, hero.heroEntityId);
    if (points <= 0) return { ...runtime, match, nowMs, feedback: 'No tienes puntos de habilidad disponibles.' };
    if (requiredLevel === undefined || hero.level < requiredLevel) {
      return { ...runtime, match, nowMs, feedback: `${ability.name}: requiere nivel ${requiredLevel ?? hero.level}.` };
    }
    const nextMatch = upgradeHeroAbility(match, LOCAL_HERO_ENTITY_ID, action.key);
    const nextRank = getRequiredHero(nextMatch, LOCAL_HERO_ENTITY_ID).abilityRanks[action.key];
    return { ...runtime, match: nextMatch, nowMs, feedback: `${ability.name} sube a rango ${nextRank}.` };
  }

  const control = getAbilityControl(match, LOCAL_HERO_ENTITY_ID, action.key, nowMs);
  const castingHero = getRequiredHero(match, LOCAL_HERO_ENTITY_ID);
  if (castingHero.currentHp <= 0) {
    return { ...runtime, match, nowMs, feedback: `${control.ability.name}: no disponible mientras estás muerto.` };
  }
  return {
    ...runtime,
    match: useHeroAbility(match, LOCAL_HERO_ENTITY_ID, action.key, nowMs),
    nowMs,
    feedback: `${control.ability.name}: ${control.blockedReason ?? 'activada'}`,
  };
}

function HudArt({ name }: { name: string }) {
  return <svg className="hud-art" viewBox="0 0 100 100" aria-hidden="true"><use href={`${HUD_ART_SRC}#${name}`} /></svg>;
}

function hideMissingImage(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.style.display = 'none';
}

function formatHudNumber(value: number) {
  if (!Number.isFinite(value)) return '0';
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
}

function RespawnCooldownOverlay({ presentation, compact = false }: { presentation: RespawnPresentation; compact?: boolean }) {
  if (!presentation.dead) return null;
  const safeTotal = Math.max(1, presentation.totalMs);
  const fraction = Math.min(1, Math.max(0, presentation.remainingMs / safeTotal));
  const seconds = Math.max(0, Math.ceil(presentation.remainingMs / 1000));
  return (
    <span
      aria-label={`Reaparición en ${seconds} segundos`}
      style={{
        position: 'absolute', inset: 0, zIndex: compact ? 3 : 4, display: 'grid', placeItems: 'center', pointerEvents: 'none',
        background: `conic-gradient(from 0deg, rgba(3, 8, 11, 0.94) ${fraction * 360}deg, rgba(7, 16, 24, 0.38) 0deg)`,
        boxShadow: 'inset 0 0 22px rgba(0, 0, 0, 0.82)', color: '#f4ead0',
        fontFamily: 'Trebuchet MS, Segoe UI, sans-serif', fontSize: compact ? 12 : 27, fontWeight: 800, lineHeight: 1,
        textShadow: '0 2px 4px #000, 0 0 9px rgba(191, 220, 235, 0.28)',
      }}
    >
      {seconds}
    </span>
  );
}

function TeamPortraits({ team, side, heroLevel = 1, localRespawn }: {
  team: TeamHero[];
  side: 'dawn' | 'dusk';
  heroLevel?: number;
  localRespawn?: RespawnPresentation;
}) {
  return (
    <div className={`team-portraits team-portraits--${side}`}>
      {team.map((hero, index) => {
        const localHero = index === 0 && side === 'dawn';
        const respawn = localHero && localRespawn?.dead ? localRespawn : undefined;
        return (
          <div className="top-hero-slot" key={`${side}-${index}`}>
            <div className="top-hero-face">
              <Shield className="top-hero-silhouette" />
              <span>{hero.initial}</span>
              {hero.portrait && (
                <img className="top-hero-image" src={hero.portrait} alt="" draggable={false} onError={hideMissingImage}
                  style={respawn ? { filter: 'grayscale(0.9) brightness(0.42)' } : undefined} />
              )}
              {respawn && <RespawnCooldownOverlay presentation={respawn} compact />}
            </div>
            <span className="top-hero-level" style={respawn ? { zIndex: 5 } : undefined}>{localHero ? heroLevel : 1}</span>
          </div>
        );
      })}
    </div>
  );
}

function GameHud({ minimapRef, minimapHeroRef, runtime, dispatch }: {
  minimapRef: RefObject<HTMLDivElement | null>;
  minimapHeroRef: RefObject<HTMLImageElement | null>;
  runtime: HudRuntime;
  dispatch: Dispatch<HudAction>;
}) {
  const hero = getRequiredHero(runtime.match, LOCAL_HERO_ENTITY_ID);
  const definition = getHeroDefinition(hero.definitionId);
  const stats = calculateHeroStats(runtime.match, hero.heroEntityId, { nowMs: runtime.nowMs });
  const attributes = calculateHeroAttributes(runtime.match, hero.heroEntityId);
  const damageBreakdown = calculateHeroDamageBreakdown(runtime.match, hero.heroEntityId, { nowMs: runtime.nowMs });
  const activeStatuses = Object.values(hero.runtime.statuses).filter(status => status.expiresAtMs > runtime.nowMs);
  const hasStatusEntries = Boolean(definition.innate || activeStatuses.length > 0);
  const experience = getHeroExperienceProgress(runtime.match, hero.heroEntityId);
  const unspentAbilityPoints = getUnspentHeroAbilityPoints(runtime.match, hero.heroEntityId);
  const heroDead = hero.currentHp <= 0;
  const respawnRemainingMs = runtime.respawnReadyAtMs === null ? 0 : Math.max(0, runtime.respawnReadyAtMs - runtime.nowMs);
  const respawnPresentation: RespawnPresentation = {
    dead: heroDead,
    remainingMs: respawnRemainingMs,
    totalMs: Math.max(1, runtime.respawnDurationMs || respawnRemainingMs),
  };

  useEffect(() => {
    setCombatHudStats({ lastHits: hero.lastHits, denies: hero.denies });
  }, [hero.lastHits, hero.denies]);

  useEffect(() => {
    const timer = window.setInterval(() => dispatch({ type: 'tick', nowMs: performance.now() }), 100);
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('.shop-overlay')) return;
      if (event.repeat || event.isComposing || event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;

      if (/^[1-6]$/.test(event.key)) {
        const slot = Number(event.key) - 1;
        const inventoryItem = hero.inventory[slot]?.item;
        const itemDefinition = inventoryItem ? getItemDefinition(inventoryItem.definitionId) : null;
        if (itemDefinition?.active_effect) {
          event.preventDefault();
          event.stopPropagation();
          dispatch({ type: 'item-use', slot, nowMs: performance.now() });
        }
        return;
      }

      const key = event.key.toUpperCase() as AbilityKey;
      if (!ABILITY_KEYS.includes(key)) return;
      event.preventDefault();
      dispatch({ type: 'cast', key, nowMs: performance.now() });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [hero.inventory]);

  return (
    <div className="game-hud">
      <section className="scoreboard">
        <TeamPortraits team={dawnTeam} side="dawn" heroLevel={hero.level} localRespawn={respawnPresentation} />
        <div className="match-score">
          <strong className="score score--dawn">0</strong>
          <div className="match-clock"><span>DAWNREACH</span><b>00:00</b></div>
          <strong className="score score--dusk">0</strong>
        </div>
        <TeamPortraits team={duskTeam} side="dusk" />
      </section>

      <section className="minimap-shell">
        <div className="minimap-field">
          <div ref={minimapRef} className="minimap-live"
            style={{ position: 'absolute', inset: 0, zIndex: 10, overflow: 'hidden', background: '#07100e' }} />
          <img ref={minimapHeroRef} className="minimap-hero-icon" src={ALDEN_MINIMAP_SRC} alt="" draggable={false}
            onError={hideMissingImage} style={{ opacity: heroDead ? 0 : 1 }} />
        </div>
        <div className="minimap-tools"><span><ZoomIn /></span><span><Eye /></span><span><Crosshair /></span></div>
        <Diamond className="minimap-ornament" />
      </section>

      <section className="command-deck">
        <div className="hero-panel">
          <div className="hero-portrait">
            <span className="hero-portrait__crest">A</span>
            <img className="hero-portrait__image" src={ALDEN_PORTRAIT_SRC} alt="" draggable={false} onError={hideMissingImage}
              style={heroDead ? { filter: 'grayscale(0.9) brightness(0.42)' } : undefined} />
            <RespawnCooldownOverlay presentation={respawnPresentation} />
            <span className="hero-level-ring"
              title={experience.maxLevel ? 'Nivel máximo' : `${Math.floor(experience.current)} / ${experience.required} XP`}
              style={{ background: `conic-gradient(#67d4ff ${experience.fraction * 360}deg, #263238 0deg)` }}>
              <span>{hero.level}</span>
            </span>
          </div>
          <div className="hero-identity">
            <strong>{definition.displayName}</strong>
            <span>{definition.className}</span>
            <div className="hero-attributes">
              <div className="hero-combat-stats">
                <b className="hero-combat-stat hero-combat-stat--damage" title="Daño base + daño directo de objetos">
                  <Sword />
                  {formatHudNumber(damageBreakdown.baseDamage)}
                  {damageBreakdown.itemBonusDamage > 0.001 && (
                    <em className="hero-damage-bonus">+ {formatHudNumber(damageBreakdown.itemBonusDamage)}</em>
                  )}
                </b>
                <b className="hero-combat-stat" title="Resistencia mágica"><Sparkles />{Math.round(stats.magicResistance)}</b>
                <b className="hero-combat-stat" title="Armadura"><Shield />{Math.round(stats.physicalArmor)}</b>
              </div>
              <div className="hero-core-attributes" aria-label="Atributos del héroe">
                {heroAttributeDisplay.map(attribute => (
                  <b
                    key={attribute.key}
                    className={`hero-core-attribute${definition.primaryAttribute === attribute.key ? ' is-primary' : ''}`}
                    title={`${attribute.label}${definition.primaryAttribute === attribute.key ? ' · atributo principal' : ''}`}
                  >
                    <small>{attribute.shortLabel}</small>
                    <span className="hero-core-attribute__value">{formatHudNumber(attributes[attribute.key])}</span>
                  </b>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="combat-panel">
          <div className="ability-row" data-unspent-points={unspentAbilityPoints}>
            {ABILITY_KEYS.map(key => {
              const control = getAbilityControl(runtime.match, hero.heroEntityId, key, runtime.nowMs);
              const ability = control.ability;
              const nextLevel = ability.unlockLevels[control.rank];
              const canUpgrade = unspentAbilityPoints > 0 && nextLevel !== undefined && hero.level >= nextLevel;
              return <AbilityButton
                key={key} hotkey={key} name={ability.name} kind={ability.type}
                description={ability.technicalDescription} lore={ability.lore}
                rank={control.rank} maxRank={ability.unlockLevels.length} nextLevel={nextLevel}
                remainingMs={control.remainingMs} cooldownSeconds={control.preview?.cooldownSeconds}
                resourceCost={control.preview?.resourceCost} resourceName={definition.resource.displayName}
                blockedReason={heroDead ? 'No disponible mientras estás muerto' : control.blockedReason} art={abilityArt[key]}
                image={heroAbilityImages[`./game/heroes/${hero.heroName?.toLowerCase()}/images/${heroImageCodes[hero.definitionId]}${key}.webp`]}
                onUse={() => dispatch({ type: 'cast', key, nowMs: performance.now() })}
                canUpgrade={canUpgrade}
                onUpgrade={() => dispatch({ type: 'upgrade', key, nowMs: performance.now() })}
              ><HudArt name={abilityArt[key]} /></AbilityButton>;
            })}
          </div>
          <div className={`combat-status-layout${hasStatusEntries ? '' : ' combat-status-layout--resources-only'}`}>
            {hasStatusEntries && (
              <HeroStatusBar
                heroEntityId={hero.heroEntityId}
                innate={definition.innate}
                timedStatuses={activeStatuses}
                runtimeCounters={hero.runtime.counters}
                nowMs={runtime.nowMs}
                renderArt={art => <HudArt name={art} />}
              />
            )}
            <div className="resource-bars">
              <div className="resource resource--health">
                <span style={{ width: `${hero.currentHp / stats.maxHp * 100}%` }} />
                <b>
                  {Math.floor(hero.currentHp)} / {Math.round(stats.maxHp)}
                  <em className="resource-regen" title="Regeneración de vida por segundo">+{formatHudNumber(stats.hpRegenPerSecond)}</em>
                </b>
              </div>
              <div className="resource resource--mana" data-current={hero.currentResource} data-max={stats.maxResource}>
                <span style={{ width: `${hero.currentResource / stats.maxResource * 100}%` }} />
                <b>
                  {Math.floor(hero.currentResource)} / {Math.round(stats.maxResource)}
                  <em className="resource-regen" title="Regeneración de maná por segundo">+{formatHudNumber(stats.resourceRegenPerSecond)}</em>
                </b>
              </div>
            </div>
          </div>
        </div>

        <div className="inventory-panel">
          <div className="inventory-grid">
            {hero.inventory.map((slot, index) => (
              <InventoryItemSlot
                key={slot.slot}
                slot={slot}
                index={index}
                nowMs={runtime.nowMs}
                onUse={slotIndex => dispatch({ type: 'item-use', slot: slotIndex, nowMs: performance.now() })}
                onMove={(fromSlot, toSlot) => dispatch({ type: 'inventory-move', fromSlot, toSlot, nowMs: performance.now() })}
              />
            ))}
          </div>
          <div className="gold-row"><Coins /><strong>{hero.gold}</strong></div>
        </div>
        <div className="deck-crest"><Swords /></div>
      </section>
      <div className="hud-feedback" role="status" aria-live="polite">{runtime.feedback}</div>
    </div>
  );
}

export default function App() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const minimapRef = useRef<HTMLDivElement | null>(null);
  const minimapHeroRef = useRef<HTMLImageElement | null>(null);
  const [runtime, dispatch] = useReducer(updateHudRuntime, undefined, () => {
    const nowMs = performance.now();
    return {
      match: createPlayableMatch('H001', 1, nowMs),
      nowMs,
      feedback: '',
      respawnReadyAtMs: null,
      respawnDurationMs: 0,
      shopOpen: false,
      pendingDrops: [],
      groundItems: {},
      pendingItemUses: [],
    };
  });

  const getOverlayState = () => ({
    hero: getRequiredHero(runtime.match, LOCAL_HERO_ENTITY_ID),
    stats: calculateHeroStats(runtime.match, LOCAL_HERO_ENTITY_ID, { nowMs: runtime.nowMs }),
  });
  const overlayStateRef = useRef<ReturnType<typeof getOverlayState> | null>(null);
  const runtimeStateRef = useRef(runtime);
  runtimeStateRef.current = runtime;
  const localHero = getRequiredHero(runtime.match, LOCAL_HERO_ENTITY_ID);
  const localHeroDead = localHero.currentHp <= 0;
  const inventoryFull = !localHero.inventory.some(slot => slot.item === null);

  useEffect(() => {
    const overlay = getOverlayState();
    overlayStateRef.current = overlay;
    publishWorldEntityRuntime(LOCAL_WORLD_HERO_ENTITY_ID, {
      level: overlay.hero.level,
      maxHp: overlay.stats.maxHp,
      currentHp: overlay.hero.currentHp,
      maxResource: overlay.stats.maxResource,
      currentResource: overlay.hero.currentResource,
      alive: overlay.hero.currentHp > 0,
      statuses: Object.values(overlay.hero.runtime.statuses)
        .filter(status => status.expiresAtMs > runtime.nowMs)
        .map(status => ({
          id: status.id,
          sourceEntityId: status.sourceHeroEntityId,
          rank: status.rank,
          stacks: status.stacks,
          expiresAtMs: status.expiresAtMs,
          data: status.data ? { ...status.data } : undefined,
        })),
    });
  }, [runtime]);

  useEffect(() => subscribeWorldCombatEvents((event) => {
    if (event.entityId !== LOCAL_WORLD_HERO_ENTITY_ID) return;
    dispatch({ type: 'world-hero-sync', event });
  }), []);

  useEffect(() => subscribeWorldAttackEvents((event) => {
    if (event.attackerId !== LOCAL_WORLD_HERO_ENTITY_ID) return;
    if (event.targetTeam === event.attackerTeam) return;

    const snapshot = runtimeStateRef.current;
    const targetClass = worldTargetClass(event.targetKind);
    const preview = calculateHeroWorldBasicAttackPreview(
      snapshot.match,
      LOCAL_HERO_ENTITY_ID,
      event.atMs,
      targetClass,
    );
    if (preview.consumesInnate && preview.bonusDamage > 0) {
      queueWorldDamageAdjustment(event.targetId, preview.bonusDamage);
    }
    dispatch({ type: 'world-hero-attack', event });
  }), []);

  useEffect(() => subscribeWorldHeroProgressionEvents((event) => {
    if (event.heroEntityId !== LOCAL_WORLD_HERO_ENTITY_ID) return;
    dispatch({ type: 'world-progression', event });
  }), []);

  useEffect(() => {
    const onShopOpen = () => dispatch({ type: 'shop-open', nowMs: performance.now() });
    window.addEventListener(SHOP_OPEN_EVENT, onShopOpen);
    return () => window.removeEventListener(SHOP_OPEN_EVENT, onShopOpen);
  }, []);

  useEffect(() => {
    const onPickupRequest = (event: Event) => {
      const detail = (event as CustomEvent<ItemPickupRequestDetail>).detail;
      if (!detail?.groundId || !detail.itemId) return;
      const snapshot = runtimeStateRef.current;
      const groundItem = snapshot.groundItems[detail.groundId];
      const accepted = Boolean(groundItem && groundItem.definitionId === detail.itemId && getItemDefinition(detail.itemId))
        && heroHasInventorySpace(snapshot.match, LOCAL_HERO_ENTITY_ID);

      if (accepted) {
        dispatch({ type: 'ground-item-pickup', itemId: detail.itemId, groundId: detail.groundId, nowMs: performance.now() });
      } else {
        dispatch({ type: 'feedback', message: 'No puedes recogerlo: tu inventario está lleno.', nowMs: performance.now() });
      }

      window.dispatchEvent(new CustomEvent<ItemPickupResultDetail>(ITEM_PICKUP_RESULT_EVENT, {
        detail: { groundId: detail.groundId, accepted },
      }));
    };
    window.addEventListener(ITEM_PICKUP_REQUEST_EVENT, onPickupRequest as EventListener);
    return () => window.removeEventListener(ITEM_PICKUP_REQUEST_EVENT, onPickupRequest as EventListener);
  }, []);

  useEffect(() => {
    const pending = runtime.pendingDrops[0];
    if (!pending) return;
    const detail: ItemDropDetail = { token: pending.token, itemId: pending.itemId };
    window.dispatchEvent(new CustomEvent<ItemDropDetail>(ITEM_DROP_EVENT, { detail }));
    dispatch({ type: 'shop-clear-drop', token: pending.token, nowMs: performance.now() });
  }, [runtime.pendingDrops]);

  useEffect(() => {
    const pending = runtime.pendingItemUses[0];
    if (!pending) return;
    window.dispatchEvent(new CustomEvent<ItemUseDetail>(ITEM_USE_EVENT, { detail: pending.detail }));
    dispatch({ type: 'item-use-clear', token: pending.token, nowMs: performance.now() });
  }, [runtime.pendingItemUses]);

  useEffect(() => {
    if (!localHeroDead) return;
    const belongsToGameSurface = (target: EventTarget | null) => (
      target instanceof Element && Boolean(target.closest('.game-canvas, .minimap-live'))
    );
    const blockDeadMove = (event: PointerEvent) => {
      if (event.button !== 2 || !belongsToGameSurface(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const blockDeadContextMenu = (event: MouseEvent) => {
      if (!belongsToGameSurface(event.target)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const blockDeadAttackCommand = (event: KeyboardEvent) => {
      if (event.code !== 'KeyA') return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener('pointerdown', blockDeadMove, true);
    window.addEventListener('contextmenu', blockDeadContextMenu, true);
    window.addEventListener('keydown', blockDeadAttackCommand, true);
    return () => {
      window.removeEventListener('pointerdown', blockDeadMove, true);
      window.removeEventListener('contextmenu', blockDeadContextMenu, true);
      window.removeEventListener('keydown', blockDeadAttackCommand, true);
    };
  }, [localHeroDead]);

  useEffect(() => {
    const host = hostRef.current;
    const minimapHost = minimapRef.current;
    const minimapHeroMarker = minimapHeroRef.current;
    if (!host || !minimapHost) return;

    let disposed = false;
    let destroy: (() => void) | undefined;
    void createDawnreachGame(host, minimapHost, minimapHeroMarker, () => overlayStateRef.current).then((game) => {
      if (disposed) {
        game.destroy();
        return;
      }
      destroy = game.destroy;
    });
    return () => {
      disposed = true;
      destroy?.();
    };
  }, []);

  const onWorldDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!Array.from(event.dataTransfer.types).includes('application/x-dawnreach-inventory-item')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const onWorldDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    const payload = readInventoryDragPayload(event.dataTransfer);
    if (!payload) return;
    event.preventDefault();
    event.stopPropagation();
    dispatch({ type: 'inventory-drop', slot: payload.slot, nowMs: performance.now() });
  };

  return (
    <main className="app-shell">
      <div ref={hostRef} className="game-host" onDragOver={onWorldDragOver} onDrop={onWorldDrop} />
      <GameHud minimapRef={minimapRef} minimapHeroRef={minimapHeroRef} runtime={runtime} dispatch={dispatch} />
      <ScoreboardOverlay
        match={runtime.match}
        nowMs={runtime.nowMs}
        respawnReadyAtMs={runtime.respawnReadyAtMs}
      />
      <ShopOverlay
        open={runtime.shopOpen}
        gold={localHero.gold}
        inventoryFull={inventoryFull}
        onClose={() => dispatch({ type: 'shop-close', nowMs: performance.now() })}
        onBuy={itemId => dispatch({ type: 'shop-buy', itemId, nowMs: performance.now() })}
        onSell={instanceId => dispatch({ type: 'inventory-sell', instanceId, nowMs: performance.now() })}
      />
    </main>
  );
}
