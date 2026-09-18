import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type DragEvent as ReactDragEvent,
  type RefObject,
  type SyntheticEvent,
} from 'react';
import { Coins, Crosshair, Diamond, Eye, Shield, Sparkles, Sword, Swords, ZoomIn } from 'lucide-react';
import {
  createDawnreachGame,
  type DawnreachCreepNetworkSnapshot,
  type DawnreachRemoteHeroState,
  type DawnreachStructureNetworkSnapshot,
} from './game/createDawnreachGame';
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
  itemStatsToHeroModifiers,
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
import { toMatchGameTimeMs } from './game/match/matchPauseRuntime';
import { publishMatchEvent } from './game/match/matchEvents';
import { setMatchEventHeroDeathServerAuthority } from './game/match/matchEventRuntime';
import {
  matchEventKindFromEntityId,
  matchEventLabelForEntityId,
  matchEventTeamFromEntityId,
} from './game/match/matchEventParticipants';
import { platformRealtime } from './platform/realtimeClient';
import type { MatchRuntimePlayerState, MatchSummary, PlatformRealtimeEvent, PlatformUser } from './platform/types';
import AbilityButton from './hud/AbilityButton';
import HeroStatusBar from './hud/HeroStatusBar';
import InventoryItemSlot from './hud/InventoryItemSlot';
import {
  HERO_SELECTION_CHANGED_EVENT,
  type HeroSelectionChangedDetail,
} from './game/entities/selectionHudOverlay';
import ScoreboardOverlay from './hud/ScoreboardOverlay';
import ShopOverlay from './hud/ShopOverlay';
import {
  getCombatHudStatsSnapshot,
  setCombatHudServerAuthority,
  setCombatHudStats,
} from './hud/combatStatsOverlay';
import {
  ABILITY_KEYS, LOCAL_HERO_ENTITY_ID,
  advanceHeroPassiveGold, advanceHeroWorldEffects, applyHeroProgressionReward, applyHeroWorldDamageReaction,
  calculateHeroAttributes, calculateHeroDamageBreakdown, calculateHeroStats, calculateHeroWorldBasicAttackPreview,
  createPlayableMatch, createPlayableRosterMatch, getAbilityControl, getHeroDefinition, getHeroExperienceProgress,
  getRequiredHero, getUnspentHeroAbilityPoints,
  recoverHeroResource, resolveHeroWorldBasicAttackEffects, upgradeHeroAbility, useHeroAbility,
  type AbilityKey, type CombatTargetClass, type HeroId, type InventoryItem, type MatchState,
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
  local?: boolean;
  level?: number;
  dead?: boolean;
  respawnRemainingMs?: number;
  respawnDurationMs?: number;
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

type PendingAbilityCast = {
  token: string;
  key: AbilityKey;
  rank: number;
  atMs: number;
};

function teamPortraitsFromMatch(match: MatchState, team: 'dawn' | 'dusk', nowMs: number): TeamHero[] {
  return match.slots
    .filter(slot => slot.team === team)
    .sort((a, b) => a.index - b.index)
    .map(slot => {
      const hero = slot.heroEntityId ? match.heroes[slot.heroEntityId] : null;
      if (!hero) return { initial: '' };
      const syncedRemainingMs = Math.max(0, Number(hero.runtime.counters['network.respawnRemainingMs'] ?? 0));
      const syncedAtMs = Math.max(0, Number(hero.runtime.counters['network.respawnSyncedAtMs'] ?? nowMs));
      const elapsedSinceSyncMs = Math.max(0, nowMs - syncedAtMs);
      return {
        initial: hero.heroName?.slice(0, 1).toUpperCase() || '?',
        portrait: hero.definitionId === 'H001' ? ALDEN_PORTRAIT_SRC : undefined,
        local: hero.heroEntityId === LOCAL_HERO_ENTITY_ID,
        level: hero.level,
        dead: hero.currentHp <= 0,
        respawnRemainingMs: Math.max(0, syncedRemainingMs - elapsedSinceSyncMs),
        respawnDurationMs: Math.max(0, Number(hero.runtime.counters['network.respawnDurationMs'] ?? 0)),
      };
    });
}

function formatMatchClock(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}
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

function matchCreepAuthorityUserId(match: MatchSummary | null | undefined) {
  if (!match) return null;
  const abandoned = new Set(match.abandonedUserIds ?? []);
  return [...match.players]
    .filter(player => !abandoned.has(player.userId))
    .sort((left, right) => {
      const teamOrder = (left.team === 'blue' ? 0 : 1) - (right.team === 'blue' ? 0 : 1);
      return teamOrder || left.slot - right.slot || left.userId.localeCompare(right.userId);
    })[0]?.userId ?? null;
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
  pendingAbilityCast: PendingAbilityCast | null;
};

type HudAction =
  | { type: 'tick'; nowMs: number }
  | { type: 'cast'; key: AbilityKey; nowMs: number }
  | { type: 'upgrade'; key: AbilityKey; nowMs: number }
  | { type: 'world-hero-sync'; event: WorldCombatEvent }
  | { type: 'world-hero-attack'; event: WorldAttackEvent }
  | { type: 'world-progression'; event: WorldHeroProgressionEvent }
  | { type: 'remote-player-sync'; state: MatchRuntimePlayerState; nowMs: number }
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
  | { type: 'ability-world-clear'; token: string; nowMs: number }
  | { type: 'feedback'; message: string; nowMs: number };

function updateHudRuntime(runtime: HudRuntime, action: HudAction): HudRuntime {
  const rawActionNowMs = action.type === 'world-hero-sync'
    || action.type === 'world-hero-attack'
    || action.type === 'world-progression'
    ? action.event.atMs
    : action.nowMs;
  const actionNowMs = toMatchGameTimeMs(rawActionNowMs);
  const nowMs = Math.max(runtime.nowMs, actionNowMs);
  const elapsedMs = Math.max(0, nowMs - runtime.nowMs);
  let match = recoverHeroResource(runtime.match, LOCAL_HERO_ENTITY_ID, elapsedMs, nowMs);
  match = advanceItemActiveEffects(match, LOCAL_HERO_ENTITY_ID, elapsedMs, nowMs);
  match = advanceHeroPassiveGold(match, LOCAL_HERO_ENTITY_ID, elapsedMs);
  match = advanceHeroWorldEffects(match, nowMs);

  if (action.type === 'tick') return { ...runtime, match, nowMs };

  if (action.type === 'remote-player-sync') {
    const player = match.players[action.state.userId];
    const heroEntityId = player?.ownedHeroEntityId ?? null;
    const hero = heroEntityId ? match.heroes[heroEntityId] ?? null : null;
    if (!player || !hero || heroEntityId === LOCAL_HERO_ENTITY_ID) return { ...runtime, match, nowMs };

    const remoteItems = new Map(
      (action.state.inventory ?? []).map(item => [item.slot, item] as const),
    );
    const inventory = hero.inventory.map(slot => {
      const item = remoteItems.get(slot.slot);
      const definition = item ? getItemDefinition(item.definitionId) : null;
      return {
        ...slot,
        item: item
          ? {
            instanceId: `remote:${action.state.userId}:${slot.slot}:${item.definitionId}`,
            definitionId: item.definitionId,
            displayName: item.displayName,
            quantity: Math.max(1, item.quantity),
            statModifiers: definition ? itemStatsToHeroModifiers(definition.stats) : [],
            cooldownReadyAtMs: nowMs + Math.max(0, item.cooldownRemainingMs ?? 0),
          }
          : null,
      };
    });

    const nextHero = {
      ...hero,
      level: Math.max(1, Math.floor(action.state.level)),
      experience: Math.max(0, Number(action.state.experience ?? hero.experience)),
      currentHp: Math.max(0, action.state.currentHp),
      currentResource: Math.max(0, action.state.currentResource),
      gold: Math.max(0, Math.floor(action.state.gold ?? hero.gold)),
      lastHits: Math.max(0, Math.floor(action.state.lastHits ?? hero.lastHits)),
      denies: Math.max(0, Math.floor(action.state.denies ?? hero.denies)),
      inventory,
      abilityRanks: action.state.abilityRanks
        ? {
          Q: Math.max(0, Math.floor(action.state.abilityRanks.Q ?? 0)),
          W: Math.max(0, Math.floor(action.state.abilityRanks.W ?? 0)),
          E: Math.max(0, Math.floor(action.state.abilityRanks.E ?? 0)),
          R: Math.max(0, Math.floor(action.state.abilityRanks.R ?? 0)),
        }
        : hero.abilityRanks,
      cooldownReadyAtMs: action.state.abilityCooldownRemainingMs
        ? {
          Q: nowMs + Math.max(0, action.state.abilityCooldownRemainingMs.Q ?? 0),
          W: nowMs + Math.max(0, action.state.abilityCooldownRemainingMs.W ?? 0),
          E: nowMs + Math.max(0, action.state.abilityCooldownRemainingMs.E ?? 0),
          R: nowMs + Math.max(0, action.state.abilityCooldownRemainingMs.R ?? 0),
        }
        : hero.cooldownReadyAtMs,
      runtime: {
        ...hero.runtime,
        counters: {
          ...hero.runtime.counters,
          'scoreboard.kills': Math.max(0, Math.floor(action.state.kills ?? 0)),
          'scoreboard.deaths': Math.max(0, Math.floor(action.state.deaths ?? 0)),
          'scoreboard.assists': Math.max(0, Math.floor(action.state.assists ?? 0)),
          'network.respawnRemainingMs': action.state.alive ? 0 : Math.max(0, action.state.respawnRemainingMs ?? 0),
          'network.respawnDurationMs': action.state.alive ? 0 : Math.max(0, action.state.respawnDurationMs ?? 0),
          'network.respawnSyncedAtMs': nowMs,
        },
      },
    };
    return {
      ...runtime,
      match: {
        ...match,
        players: {
          ...match.players,
          [player.playerId]: { ...player, connected: true },
        },
        heroes: {
          ...match.heroes,
          [heroEntityId]: nextHero,
        },
      },
      nowMs,
    };
  }

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

  if (action.type === 'ability-world-clear') {
    return runtime.pendingAbilityCast?.token === action.token
      ? { ...runtime, match, nowMs, pendingAbilityCast: null }
      : { ...runtime, match, nowMs };
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
      ? nowMs + respawnDurationMs
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
  if (!control.canUse || control.rank <= 0) {
    const unspent = getUnspentHeroAbilityPoints(match, castingHero.heroEntityId);
    const blocked = control.rank <= 0 && unspent > 0
      ? 'sin aprender · usa el botón + para asignarle un punto'
      : control.blockedReason ?? 'no disponible';
    return {
      ...runtime,
      match,
      nowMs,
      feedback: `${control.ability.name}: ${blocked}`,
    };
  }
  const nextMatch = useHeroAbility(match, LOCAL_HERO_ENTITY_ID, action.key, nowMs);
  return {
    ...runtime,
    match: nextMatch,
    nowMs,
    pendingAbilityCast: {
      token: `${action.key}:${action.nowMs}:${control.rank}`,
      key: action.key,
      rank: control.rank,
      atMs: action.nowMs,
    },
    feedback: `${control.ability.name}: activada`,
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

function TeamPortraits({ team, side, localRespawn }: {
  team: TeamHero[];
  side: 'dawn' | 'dusk';
  localRespawn?: RespawnPresentation;
}) {
  return (
    <div className={`team-portraits team-portraits--${side}`}>
      {team.map((hero, index) => {
        const localHero = Boolean(hero.local);
        const remoteRespawn = hero.dead
          ? {
            dead: true,
            remainingMs: Math.max(0, hero.respawnRemainingMs ?? 0),
            totalMs: Math.max(1, hero.respawnDurationMs || hero.respawnRemainingMs || 1),
          }
          : undefined;
        const respawn = localHero && localRespawn?.dead ? localRespawn : remoteRespawn;
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
            <span className="top-hero-level" style={respawn ? { zIndex: 5 } : undefined}>{hero.level ?? 1}</span>
          </div>
        );
      })}
    </div>
  );
}

function GameHud({ minimapRef, minimapHeroRef, runtime, dispatch, onlineStartedAt, inspectedHeroOwnerUserId }: {
  minimapRef: RefObject<HTMLDivElement | null>;
  minimapHeroRef: RefObject<HTMLImageElement | null>;
  runtime: HudRuntime;
  dispatch: Dispatch<HudAction>;
  onlineStartedAt?: string;
  inspectedHeroOwnerUserId?: string | null;
}) {
  const localHero = getRequiredHero(runtime.match, LOCAL_HERO_ENTITY_ID);
  const inspectedPlayer = inspectedHeroOwnerUserId
    ? runtime.match.players[inspectedHeroOwnerUserId] ?? null
    : null;
  const inspectedHeroEntityId = inspectedPlayer?.ownedHeroEntityId ?? null;
  const inspectedHero = inspectedHeroEntityId
    ? runtime.match.heroes[inspectedHeroEntityId] ?? null
    : null;
  const hero = inspectedHero ?? localHero;
  const readOnly = hero.heroEntityId !== LOCAL_HERO_ENTITY_ID;
  const definition = getHeroDefinition(hero.definitionId);
  const stats = calculateHeroStats(runtime.match, hero.heroEntityId, { nowMs: runtime.nowMs });
  const attributes = calculateHeroAttributes(runtime.match, hero.heroEntityId);
  const damageBreakdown = calculateHeroDamageBreakdown(runtime.match, hero.heroEntityId, { nowMs: runtime.nowMs });
  const activeStatuses = Object.values(hero.runtime.statuses).filter(status => status.expiresAtMs > runtime.nowMs);
  const hasStatusEntries = Boolean(definition.innate || activeStatuses.length > 0);
  const experience = getHeroExperienceProgress(runtime.match, hero.heroEntityId);
  const unspentAbilityPoints = readOnly ? 0 : getUnspentHeroAbilityPoints(runtime.match, hero.heroEntityId);
  const heroDead = hero.currentHp <= 0;
  const localHeroDead = localHero.currentHp <= 0;
  const localRespawnRemainingMs = runtime.respawnReadyAtMs === null ? 0 : Math.max(0, runtime.respawnReadyAtMs - runtime.nowMs);
  const localRespawnPresentation: RespawnPresentation = {
    dead: localHeroDead,
    remainingMs: localRespawnRemainingMs,
    totalMs: Math.max(1, runtime.respawnDurationMs || localRespawnRemainingMs),
  };
  const remoteRespawnSyncedRemainingMs = Math.max(0, Number(hero.runtime.counters['network.respawnRemainingMs'] ?? 0));
  const remoteRespawnSyncedAtMs = Math.max(0, Number(hero.runtime.counters['network.respawnSyncedAtMs'] ?? runtime.nowMs));
  const remoteRespawnRemainingMs = Math.max(0, remoteRespawnSyncedRemainingMs - Math.max(0, runtime.nowMs - remoteRespawnSyncedAtMs));
  const respawnPresentation: RespawnPresentation = readOnly
    ? {
      dead: heroDead,
      remainingMs: remoteRespawnRemainingMs,
      totalMs: Math.max(1, Number(hero.runtime.counters['network.respawnDurationMs'] ?? remoteRespawnRemainingMs) || remoteRespawnRemainingMs || 1),
    }
    : localRespawnPresentation;
  const dawnTeam = teamPortraitsFromMatch(runtime.match, 'dawn', runtime.nowMs);
  const duskTeam = teamPortraitsFromMatch(runtime.match, 'dusk', runtime.nowMs);

  // Anchor the global match clock once to the server start timestamp, then advance it only
  // with Dawnreach's monotonic match-time clock. This prevents Date.now()/performance.now()
  // sources from alternately rewriting the same DOM text once per second.
  const clockKey = `${runtime.match.matchId}|${onlineStartedAt ?? 'local'}`;
  const clockAnchorRef = useRef<{ key: string; matchTimeAtMs: number; elapsedAtMs: number } | null>(null);
  if (!clockAnchorRef.current || clockAnchorRef.current.key !== clockKey) {
    const onlineStartedMs = onlineStartedAt ? Date.parse(onlineStartedAt) : Number.NaN;
    clockAnchorRef.current = {
      key: clockKey,
      matchTimeAtMs: runtime.nowMs,
      elapsedAtMs: Number.isFinite(onlineStartedMs)
        ? Math.max(0, Date.now() - onlineStartedMs)
        : Math.max(0, runtime.nowMs - runtime.match.createdAtMs),
    };
  }
  const clockAnchor = clockAnchorRef.current!;
  const matchElapsedMs = Math.max(
    0,
    clockAnchor.elapsedAtMs + (runtime.nowMs - clockAnchor.matchTimeAtMs),
  );

  useEffect(() => {
    setCombatHudStats({ lastHits: localHero.lastHits, denies: localHero.denies });
  }, [localHero.lastHits, localHero.denies]);

  useEffect(() => {
    const timer = window.setInterval(() => dispatch({ type: 'tick', nowMs: performance.now() }), 100);
    const onKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('.shop-overlay')) return;
      if (readOnly) return;
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
  }, [hero.inventory, readOnly]);

  return (
    <div className="game-hud">
      <section className="scoreboard">
        <TeamPortraits team={dawnTeam} side="dawn" localRespawn={localRespawnPresentation} />
        <div className="match-score">
          <strong className="score score--dawn">0</strong>
          <div className="match-clock">
            <span>DAWNREACH</span>
            <b className="match-clock-legacy" aria-hidden="true" style={{ display: 'none' }} />
            <time className="match-clock-value">{formatMatchClock(matchElapsedMs)}</time>
          </div>
          <strong className="score score--dusk">0</strong>
        </div>
        <TeamPortraits team={duskTeam} side="dusk" localRespawn={localRespawnPresentation} />
      </section>

      <section className="minimap-shell">
        <div className="minimap-field">
          <div ref={minimapRef} className="minimap-live"
            style={{ position: 'absolute', inset: 0, zIndex: 10, overflow: 'hidden', background: '#07100e' }} />
          <img ref={minimapHeroRef} className="minimap-hero-icon" src={ALDEN_MINIMAP_SRC} alt="" draggable={false}
            onError={hideMissingImage} style={{ opacity: localHeroDead ? 0 : 1 }} />
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
            <span>{definition.className}{readOnly ? ' · INSPECCIÓN' : ''}</span>
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
              const canUpgrade = !readOnly && unspentAbilityPoints > 0 && nextLevel !== undefined && hero.level >= nextLevel;
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
                readOnly={readOnly}
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
                readOnly={readOnly}
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

export default function App({
  onlineMatch,
  localUser,
}: {
  onlineMatch?: MatchSummary | null;
  localUser?: PlatformUser | null;
} = {}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const minimapRef = useRef<HTMLDivElement | null>(null);
  const minimapHeroRef = useRef<HTMLImageElement | null>(null);
  const [runtime, dispatch] = useReducer(updateHudRuntime, undefined, () => {
    const nowMs = toMatchGameTimeMs();
    const match = onlineMatch && localUser
      ? createPlayableRosterMatch(
        onlineMatch.id,
        onlineMatch.players.map(player => {
          const teammates = onlineMatch.players
            .filter(candidate => candidate.team === player.team)
            .sort((a, b) => a.slot - b.slot);
          const teamIndex = Math.max(0, teammates.findIndex(candidate => candidate.userId === player.userId));
          return {
            playerId: player.userId,
            displayName: player.username,
            team: player.team === 'blue' ? 'dawn' : 'dusk',
            slotIndex: (Math.min(5, teamIndex + 1)) as 1 | 2 | 3 | 4 | 5,
            heroId: (onlineMatch.heroSelections?.[player.userId]?.heroId || 'H001') as HeroId,
          };
        }),
        localUser.id,
        nowMs,
      )
      : createPlayableMatch('H001', 1, nowMs);
    return {
      match,
      nowMs,
      feedback: '',
      respawnReadyAtMs: null,
      respawnDurationMs: 0,
      shopOpen: false,
      pendingDrops: [],
      groundItems: {},
      pendingItemUses: [],
      pendingAbilityCast: null,
    };
  });

  const getOverlayState = () => ({
    hero: getRequiredHero(runtime.match, LOCAL_HERO_ENTITY_ID),
    stats: calculateHeroStats(runtime.match, LOCAL_HERO_ENTITY_ID, { nowMs: runtime.nowMs }),
  });
  const [inspectedHeroOwnerUserId, setInspectedHeroOwnerUserId] = useState<string | null>(null);
  const overlayStateRef = useRef<ReturnType<typeof getOverlayState> | null>(null);
  const gameRef = useRef<Awaited<ReturnType<typeof createDawnreachGame>> | null>(null);
  const pendingRemoteStatesRef = useRef(new Map<string, MatchRuntimePlayerState>());
  const pendingCreepSnapshotRef = useRef<DawnreachCreepNetworkSnapshot | null>(null);
  const pendingCreepDamageRef = useRef<Array<{ creepId: string; amount: number; sourceUserId: string; atMs: number }>>([]);
  const pendingStructureSnapshotRef = useRef<DawnreachStructureNetworkSnapshot | null>(null);
  const pendingStructureDamageRef = useRef<Array<{ structureId: string; amount: number; sourceUserId: string; atMs: number }>>([]);
  const networkSequenceRef = useRef(0);
  const runtimeStateRef = useRef(runtime);
  runtimeStateRef.current = runtime;
  const localHero = getRequiredHero(runtime.match, LOCAL_HERO_ENTITY_ID);
  const localHeroDead = localHero.currentHp <= 0;
  const inventoryFull = !localHero.inventory.some(slot => slot.item === null);

  useEffect(() => {
    const onHeroSelectionChanged = (event: Event) => {
      const detail = (event as CustomEvent<HeroSelectionChangedDetail>).detail;
      if (!detail || detail.local || !detail.ownerUserId) {
        setInspectedHeroOwnerUserId(null);
        return;
      }
      setInspectedHeroOwnerUserId(
        runtimeStateRef.current.match.players[detail.ownerUserId]
          ? detail.ownerUserId
          : null,
      );
    };
    window.addEventListener(HERO_SELECTION_CHANGED_EVENT, onHeroSelectionChanged as EventListener);
    return () => window.removeEventListener(HERO_SELECTION_CHANGED_EVENT, onHeroSelectionChanged as EventListener);
  }, []);

  useEffect(() => {
    const online = Boolean(onlineMatch && localUser && onlineMatch.status === 'in_game');
    setCombatHudServerAuthority(online);
    setMatchEventHeroDeathServerAuthority(online);
    if (online) setCombatHudStats({ kills: 0, deaths: 0, assists: 0 });
    return () => {
      setCombatHudServerAuthority(false);
      setMatchEventHeroDeathServerAuthority(false);
    };
  }, [onlineMatch?.id, onlineMatch?.status, localUser?.id]);

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
    if (onlineMatch && localUser && event.entityId !== LOCAL_WORLD_HERO_ENTITY_ID) {
      const amount = Number(event.amount || 0);
      const authorityUserId = matchCreepAuthorityUserId(onlineMatch);
      const remoteMatch = /^player:(.+):hero$/.exec(event.entityId);

      if (remoteMatch && amount > 0) {
        const sourceEntityId = String(event.sourceEntityId || '');
        const localHeroDamage = sourceEntityId === LOCAL_WORLD_HERO_ENTITY_ID;
        const authoritativeCreepDamage = authorityUserId === localUser.id && sourceEntityId.startsWith('lane-creep:');
        if (localHeroDamage || authoritativeCreepDamage) {
          platformRealtime.send('match.runtime.combat', {
            matchId: onlineMatch.id,
            targetUserId: remoteMatch[1],
            reason: event.reason === 'heal' ? 'heal' : 'damage',
            amount,
            sourceEntityId,
          });
        }
      }

      if (
        authorityUserId !== localUser.id
        && event.entityId.startsWith('lane-creep:')
        && event.sourceEntityId === LOCAL_WORLD_HERO_ENTITY_ID
        && amount > 0
      ) {
        platformRealtime.send('match.runtime.creep.damage', {
          matchId: onlineMatch.id,
          creepId: event.entityId,
          amount,
        });
      }
      return;
    }
    if (event.entityId !== LOCAL_WORLD_HERO_ENTITY_ID) return;
    dispatch({ type: 'world-hero-sync', event: { ...event, atMs: toMatchGameTimeMs(event.atMs) } });
  }), [onlineMatch?.id, localUser?.id]);

  useEffect(() => subscribeWorldAttackEvents((event) => {
    if (event.attackerId !== LOCAL_WORLD_HERO_ENTITY_ID) return;
    if (event.targetTeam === event.attackerTeam) return;

    const snapshot = runtimeStateRef.current;
    const atMs = toMatchGameTimeMs(event.atMs);
    const normalizedEvent = { ...event, atMs };
    const targetClass = worldTargetClass(event.targetKind);
    const preview = calculateHeroWorldBasicAttackPreview(
      snapshot.match,
      LOCAL_HERO_ENTITY_ID,
      atMs,
      targetClass,
    );
    if (preview.consumesInnate && preview.bonusDamage > 0) {
      queueWorldDamageAdjustment(event.targetId, preview.bonusDamage);
    }
    dispatch({ type: 'world-hero-attack', event: normalizedEvent });
  }), []);

  useEffect(() => subscribeWorldHeroProgressionEvents((event) => {
    if (event.heroEntityId !== LOCAL_WORLD_HERO_ENTITY_ID) return;
    dispatch({ type: 'world-progression', event: { ...event, atMs: toMatchGameTimeMs(event.atMs) } });
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
    const pending = runtime.pendingAbilityCast;
    if (!pending) return;
    const game = gameRef.current;
    if (!game) return;
    game.castLocalAbility(pending.key, pending.rank, pending.atMs);
    dispatch({ type: 'ability-world-clear', token: pending.token, nowMs: performance.now() });
  }, [runtime.pendingAbilityCast?.token]);

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
    const localPlayer = onlineMatch && localUser
      ? onlineMatch.players.find(player => player.userId === localUser.id) ?? null
      : null;
    const sharedPlayers = onlineMatch?.players.map(player => ({
      userId: player.userId,
      username: player.username,
      team: player.team,
      slot: player.slot,
      heroId: onlineMatch.heroSelections?.[player.userId]?.heroId || 'H001',
    })) ?? [];

    void createDawnreachGame(
      host,
      minimapHost,
      minimapHeroMarker,
      () => overlayStateRef.current,
      {
        localPlayerId: localUser?.id,
        localTeam: localPlayer?.team,
        localWorldEntityId: LOCAL_WORLD_HERO_ENTITY_ID,
        players: sharedPlayers,
      },
    ).then((game) => {
      if (disposed) {
        game.destroy();
        return;
      }
      gameRef.current = game;
      for (const state of pendingRemoteStatesRef.current.values()) {
        game.applyRemoteNetworkState(state as DawnreachRemoteHeroState);
      }
      pendingRemoteStatesRef.current.clear();
      if (pendingCreepSnapshotRef.current) {
        game.applyRemoteCreepNetworkSnapshot(pendingCreepSnapshotRef.current);
        pendingCreepSnapshotRef.current = null;
      }
      for (const damage of pendingCreepDamageRef.current) game.applyRemoteCreepDamage(damage);
      pendingCreepDamageRef.current = [];
      const pendingAbility = runtimeStateRef.current.pendingAbilityCast;
      if (pendingAbility) {
        game.castLocalAbility(pendingAbility.key, pendingAbility.rank, pendingAbility.atMs);
        dispatch({ type: 'ability-world-clear', token: pendingAbility.token, nowMs: performance.now() });
      }
      destroy = game.destroy;
    });
    return () => {
      disposed = true;
      gameRef.current = null;
      destroy?.();
    };
  }, [onlineMatch?.id, localUser?.id]);

  useEffect(() => {
    if (!onlineMatch || !localUser || onlineMatch.status !== 'in_game') return;

    const applyRemote = (state: MatchRuntimePlayerState) => {
      if (state.userId === localUser.id) {
        // K/D is server-authoritative in online matches. Reconcile the local overlay from
        // the same state that every other client receives instead of trusting duplicate
        // world death events on this client.
        setCombatHudStats({
          kills: state.kills,
          deaths: state.deaths,
          assists: state.assists,
        });
        return;
      }
      dispatch({ type: 'remote-player-sync', state, nowMs: performance.now() });
      const game = gameRef.current;
      if (game) game.applyRemoteNetworkState(state as DawnreachRemoteHeroState);
      else pendingRemoteStatesRef.current.set(state.userId, state);
    };

    const unsubscribe = platformRealtime.subscribe((event: PlatformRealtimeEvent) => {
      const type = typeof event === 'object' && event !== null && 'type' in event ? String(event.type || '') : '';
      if (type === 'match.runtime.state' && 'matchId' in event && event.matchId === onlineMatch.id && 'state' in event) {
        applyRemote(event.state as MatchRuntimePlayerState);
      } else if (type === 'match.runtime.snapshot' && 'matchId' in event && event.matchId === onlineMatch.id && 'states' in event && Array.isArray(event.states)) {
        for (const state of event.states as readonly MatchRuntimePlayerState[]) applyRemote(state);
      } else if (
        type === 'match.runtime.hero.kill'
        && 'matchId' in event
        && event.matchId === onlineMatch.id
        && 'eventId' in event
        && 'victimUserId' in event
        && 'victimUsername' in event
        && 'victimTeam' in event
      ) {
        const victimTeam = event.victimTeam === 'red' ? 'red' : 'blue';
        const killerEntityId = 'killerEntityId' in event && event.killerEntityId
          ? String(event.killerEntityId)
          : null;
        const killerUserId = 'killerUserId' in event && event.killerUserId
          ? String(event.killerUserId)
          : null;
        const killerTeam = 'killerTeam' in event && event.killerTeam === 'red'
          ? 'red'
          : 'killerTeam' in event && event.killerTeam === 'blue'
            ? 'blue'
            : 'neutral';
        const killer = killerUserId
          ? {
            entityId: `player:${killerUserId}:hero`,
            team: killerTeam,
            kind: 'hero' as const,
            label: 'killerUsername' in event && event.killerUsername
              ? String(event.killerUsername)
              : 'Héroe',
            heroId: 'killerHeroId' in event && event.killerHeroId
              ? String(event.killerHeroId)
              : null,
          }
          : killerEntityId
            ? {
              entityId: killerEntityId,
              team: matchEventTeamFromEntityId(killerEntityId),
              kind: matchEventKindFromEntityId(killerEntityId),
              label: matchEventLabelForEntityId(
                killerEntityId,
                matchEventKindFromEntityId(killerEntityId),
              ),
            }
            : null;

        publishMatchEvent({
          type: 'hero_killed',
          eventId: String(event.eventId),
          atMs: 'at' in event ? Number(event.at || Date.now()) : Date.now(),
          killer,
          victim: {
            entityId: `player:${String(event.victimUserId)}:hero`,
            team: victimTeam,
            kind: 'hero',
            label: String(event.victimUsername),
            heroId: 'victimHeroId' in event && event.victimHeroId
              ? String(event.victimHeroId)
              : null,
          },
          assists: [],
        });
      } else if (
        type === 'match.runtime.creeps'
        && 'matchId' in event
        && event.matchId === onlineMatch.id
        && 'creeps' in event
        && Array.isArray(event.creeps)
      ) {
        const snapshot = event as unknown as DawnreachCreepNetworkSnapshot;
        const game = gameRef.current;
        if (game) game.applyRemoteCreepNetworkSnapshot(snapshot);
        else pendingCreepSnapshotRef.current = snapshot;
      } else if (
        type === 'match.runtime.creep.damage'
        && 'matchId' in event
        && event.matchId === onlineMatch.id
        && 'sourceUserId' in event
        && event.sourceUserId !== localUser.id
        && 'creepId' in event
        && 'amount' in event
      ) {
        const damage = {
          creepId: String(event.creepId || ''),
          amount: Number(event.amount || 0),
          sourceUserId: String(event.sourceUserId || ''),
          atMs: performance.now(),
        };
        const game = gameRef.current;
        if (game?.isCreepNetworkAuthority()) game.applyRemoteCreepDamage(damage);
        else if (!game) pendingCreepDamageRef.current.push(damage);
      } else if (
        type === 'match.runtime.combat'
        && 'matchId' in event
        && event.matchId === onlineMatch.id
        && 'targetUserId' in event
        && event.targetUserId === localUser.id
        && 'sourceUserId' in event
        && event.sourceUserId !== localUser.id
        && 'amount' in event
      ) {
        gameRef.current?.applyLocalNetworkCombat({
          reason: 'reason' in event && event.reason === 'heal' ? 'heal' : 'damage',
          amount: Number(event.amount || 0),
          sourceUserId: String(event.sourceUserId || ''),
          sourceEntityId: 'sourceEntityId' in event ? String(event.sourceEntityId || '') : undefined,
          respawnSeconds: 'respawnSeconds' in event && Number.isFinite(Number(event.respawnSeconds))
            ? Number(event.respawnSeconds)
            : undefined,
        });
      }
    });

    platformRealtime.send('match.runtime.snapshot', { matchId: onlineMatch.id });

    const publish = () => {
      const game = gameRef.current;
      if (!game) return;
      const state = game.getLocalNetworkState();
      const snapshot = runtimeStateRef.current;
      const hero = getRequiredHero(snapshot.match, LOCAL_HERO_ENTITY_ID);
      const combat = getCombatHudStatsSnapshot();
      networkSequenceRef.current += 1;
      platformRealtime.send('match.runtime.state', {
        matchId: onlineMatch.id,
        sequence: networkSequenceRef.current,
        ...state,
        experience: hero.experience,
        kills: combat.kills,
        deaths: combat.deaths,
        assists: combat.assists,
        lastHits: hero.lastHits,
        denies: hero.denies,
        gold: hero.gold,
        inventory: hero.inventory.flatMap(slot => slot.item ? [{
          slot: slot.slot,
          definitionId: slot.item.definitionId,
          displayName: slot.item.displayName,
          quantity: slot.item.quantity ?? 1,
          cooldownRemainingMs: Math.max(0, slot.item.cooldownReadyAtMs - snapshot.nowMs),
        }] : []),
        abilityRanks: { ...hero.abilityRanks },
        abilityCooldownRemainingMs: {
          Q: Math.max(0, hero.cooldownReadyAtMs.Q - snapshot.nowMs),
          W: Math.max(0, hero.cooldownReadyAtMs.W - snapshot.nowMs),
          E: Math.max(0, hero.cooldownReadyAtMs.E - snapshot.nowMs),
          R: Math.max(0, hero.cooldownReadyAtMs.R - snapshot.nowMs),
        },
        respawnRemainingMs: snapshot.respawnReadyAtMs === null
          ? 0
          : Math.max(0, snapshot.respawnReadyAtMs - snapshot.nowMs),
        respawnDurationMs: snapshot.respawnDurationMs,
      });

      const creeps = game.getCreepNetworkSnapshot();
      if (creeps) {
        platformRealtime.send('match.runtime.creeps', {
          matchId: onlineMatch.id,
          sequence: creeps.sequence,
          sentAt: creeps.sentAt,
          creeps: creeps.creeps,
        });
      }
    };

    publish();
    const timer = window.setInterval(publish, 80);
    return () => {
      window.clearInterval(timer);
      unsubscribe();
    };
  }, [onlineMatch?.id, onlineMatch?.status, localUser?.id]);

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
      <GameHud
        minimapRef={minimapRef}
        minimapHeroRef={minimapHeroRef}
        runtime={runtime}
        dispatch={dispatch}
        onlineStartedAt={onlineMatch?.startedAt}
        inspectedHeroOwnerUserId={inspectedHeroOwnerUserId}
      />
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
