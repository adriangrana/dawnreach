import { TOWER_GAMEPLAY, getTowerAbility, getTowerTierConfig } from '../gameplay/towerConfig';
import { getTowerTier } from '../gameplay/towerRules';
import type { GameEntity, GameEntityKind, TeamId } from './gameEntities';
import {
  getEntityStatusSignature,
  getEntityStatusViews,
  type EntityStatusTone,
  type EntityStatusView,
} from './entityStatusViews';
import { getTowerAuraState, getTowerBackdoorRegenPerSecond } from './towerAuras';

const STYLE_ID = 'dawnreach-selection-hud-style';
const OVERLAY_CLASS = 'selected-entity-hud-overlay';
export const HERO_SELECTION_CHANGED_EVENT = 'dawnreach:hero-selection-changed';

export type HeroSelectionChangedDetail = Readonly<{
  worldEntityId: string | null;
  ownerUserId: string | null;
  local: boolean;
}>;
const MAX_VISIBLE_STATUS_ICONS = 8;
let activeBridgeCount = 0;

type DisplayCombatStats = Readonly<{
  attack: string;
  armor: string;
  interval: string;
  range: string;
}>;

type AuthoredHudAbility = Readonly<{
  id?: string;
  name?: string;
  description?: string;
  level?: number;
  type?: string;
}>;

const CREEP_HUD_STATS = {
  melee: { damage: 24, interval: 1 },
  flagbearer: { damage: 24, interval: 1 },
  ranged: { damage: 28, interval: 1.2 },
  siege: { damage: 58, interval: 2 },
} as const;

function kindLabel(kind: GameEntityKind) {
  switch (kind) {
    case 'hero': return 'HÉROE';
    case 'creep': return 'SÚBDITO';
    case 'tower': return 'TORRE';
    case 'building': return 'ESTRUCTURA';
    case 'shop': return 'TIENDA';
    case 'jungle-creature': return 'FAUNA';
  }
}

function kindGlyph(kind: GameEntityKind) {
  switch (kind) {
    case 'hero': return 'H';
    case 'creep': return 'C';
    case 'tower': return 'T';
    case 'building': return 'B';
    case 'shop': return '$';
    case 'jungle-creature': return 'F';
  }
}

function teamLabel(team: TeamId) {
  switch (team) {
    case 'blue': return 'DAWN';
    case 'red': return 'DUSK';
    case 'neutral': return 'NEUTRAL';
  }
}

function teamAccent(team: TeamId) {
  switch (team) {
    case 'blue': return '#58c9ff';
    case 'red': return '#ff6a61';
    case 'neutral': return '#e4bd55';
  }
}

function healthAccent(entity: GameEntity, localHero: GameEntity | null) {
  if (entity.team === 'neutral') return { start: '#b78d24', end: '#e5c84e' };
  const allied = localHero ? entity.team === localHero.team : entity.team === 'blue';
  return allied
    ? { start: '#159742', end: '#55d83d' }
    : { start: '#b52f2a', end: '#f05b50' };
}

function applyHealthAccent(overlay: HTMLElement, entity: GameEntity, localHero: GameEntity | null) {
  const accent = healthAccent(entity, localHero);
  overlay.style.setProperty('--selection-health-start', accent.start);
  overlay.style.setProperty('--selection-health-end', accent.end);
}

function formatNumber(value: number, digits = 0) {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function combatStatsFor(entity: GameEntity): DisplayCombatStats {
  if (entity.kind === 'tower') {
    const tier = getTowerTier(entity);
    const config = getTowerTierConfig(tier);
    const damageMin = finiteNumber(entity.root.userData.towerDamageMin) ?? config.damageMin;
    const damageMax = finiteNumber(entity.root.userData.towerDamageMax) ?? config.damageMax;
    const armor = finiteNumber(entity.root.userData.towerBaseArmor) ?? config.baseArmor;
    return {
      attack: `${Math.round(damageMin)}–${Math.round(damageMax)}`,
      armor: formatNumber(armor, 0),
      interval: `${formatNumber(TOWER_GAMEPLAY.attack.intervalSeconds, 2)}s`,
      range: entity.attackRange > 0 ? formatNumber(entity.attackRange, 1) : '—',
    };
  }

  if (entity.kind === 'creep') {
    const type = String(entity.root.userData.laneCreepType ?? '') as keyof typeof CREEP_HUD_STATS;
    const stats = CREEP_HUD_STATS[type];
    const armor = finiteNumber(entity.root.userData.armor) ?? 0;
    return {
      attack: stats ? String(stats.damage) : '—',
      armor: formatNumber(armor, 0),
      interval: stats ? `${formatNumber(stats.interval, 2)}s` : '—',
      range: entity.attackRange > 0 ? formatNumber(entity.attackRange, 1) : '—',
    };
  }

  if (entity.kind === 'jungle-creature') {
    const gameplay = entity.root.userData.bossGameplay as {
      attackDamage?: number;
      attackIntervalSeconds?: number;
    } | undefined;
    const damage = finiteNumber(gameplay?.attackDamage) ?? finiteNumber(entity.root.userData.attackDamage);
    const interval = finiteNumber(gameplay?.attackIntervalSeconds) ?? finiteNumber(entity.root.userData.attackIntervalSeconds);
    const armor = finiteNumber(entity.root.userData.armor) ?? 0;
    return {
      attack: damage === null ? '—' : formatNumber(damage, 0),
      armor: formatNumber(armor, 0),
      interval: interval === null ? '—' : `${formatNumber(interval, 2)}s`,
      range: entity.attackRange > 0 ? formatNumber(entity.attackRange, 1) : '—',
    };
  }

  const damage = finiteNumber(entity.root.userData.attackDamage);
  const armor = finiteNumber(entity.root.userData.armor);
  const interval = finiteNumber(entity.root.userData.attackIntervalSeconds);
  return {
    attack: damage === null ? '—' : formatNumber(damage, 0),
    armor: armor === null ? '—' : formatNumber(armor, 0),
    interval: interval === null ? '—' : `${formatNumber(interval, 2)}s`,
    range: entity.attackRange > 0 ? formatNumber(entity.attackRange, 1) : '—',
  };
}

function installStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .${OVERLAY_CLASS} {
      position: absolute;
      inset: 0;
      z-index: 80;
      overflow: visible;
      pointer-events: none;
      color: #edf5f4;
      font-family: "Trebuchet MS", "Segoe UI", sans-serif;
      text-shadow: 0 1px 2px rgba(0,0,0,.9);
    }
    .${OVERLAY_CLASS}[hidden] { display: none !important; }

    .selected-entity-hud__status-tray {
      position: absolute;
      z-index: 180;
      left: 50%;
      bottom: calc(100% + 8px);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      max-width: 92%;
      transform: translateX(-50%);
      pointer-events: auto;
    }
    .selected-entity-hud__status-icon {
      --status-ring: #d2b96d;
      --status-glow: rgba(210,185,109,.28);
      --status-art: #eedb9c;
      position: relative;
      width: 38px;
      height: 38px;
      flex: 0 0 38px;
      display: grid;
      place-items: center;
      padding: 0;
      border: 2px solid var(--status-ring);
      border-radius: 50%;
      outline: 1px solid rgba(5,8,10,.96);
      background: radial-gradient(circle at 38% 31%, color-mix(in srgb, var(--status-ring) 34%, transparent), transparent 36%), radial-gradient(circle at 50% 55%, #263337 0 28%, #111719 66%, #070b0d 100%);
      box-shadow: 0 0 0 2px rgba(13,17,18,.88), 0 0 9px var(--status-glow), inset 0 0 8px rgba(0,0,0,.72), inset 0 1px rgba(255,255,255,.12);
      color: var(--status-art);
      cursor: help;
      font: inherit;
    }
    .selected-entity-hud__status-icon--positive { --status-ring:#70d96b; --status-glow:rgba(90,220,83,.32); --status-art:#efe4a9; }
    .selected-entity-hud__status-icon--negative { --status-ring:#e06660; --status-glow:rgba(224,83,75,.34); --status-art:#ffd0c6; }
    .selected-entity-hud__status-icon--neutral { --status-ring:#cfb66d; --status-glow:rgba(207,182,109,.26); --status-art:#eadcae; }
    .selected-entity-hud__status-icon:hover,
    .selected-entity-hud__status-icon:focus-visible { filter: brightness(1.12); outline: 2px solid rgba(244,232,191,.76); outline-offset: 2px; }
    .selected-entity-hud__status-icon svg { width:25px; height:25px; overflow:visible; fill:none; stroke:currentColor; stroke-width:2.35; stroke-linecap:round; stroke-linejoin:round; filter:drop-shadow(0 1px 1px #000b); }
    .selected-entity-hud__status-badge { position:absolute; z-index:3; right:-3px; bottom:-3px; min-width:15px; height:15px; display:grid; place-items:center; padding:0 3px; border:1px solid #e0c983; border-radius:8px; background:#0a0f11; color:#f6e8bb; font-size:8px; font-weight:800; line-height:1; box-shadow:0 1px 3px #000b; }
    .selected-entity-hud__status-time { position:absolute; z-index:3; left:50%; bottom:-16px; transform:translateX(-50%); color:#e8ece8; font-size:8px; font-weight:800; line-height:1; white-space:nowrap; text-shadow:0 1px 2px #000,0 0 5px #000; }
    .selected-entity-hud__status-tooltip {
      position:absolute; z-index:260; left:50%; bottom:calc(100% + 11px); width:274px; padding:11px 12px 12px; visibility:hidden; opacity:0; transform:translate(-50%,5px); transition:opacity .12s ease,transform .12s ease; pointer-events:none; text-align:left; text-transform:none; background:linear-gradient(135deg,#1d282d,#0b1216 64%); border:2px solid #05090b; box-shadow:0 8px 24px #000c,inset 0 1px rgba(255,255,255,.06);
    }
    .selected-entity-hud__status-icon:hover .selected-entity-hud__status-tooltip,
    .selected-entity-hud__status-icon:focus-visible .selected-entity-hud__status-tooltip { visibility:visible; opacity:1; transform:translate(-50%,0); }
    .selected-entity-hud__status-tooltip strong { display:block; padding-right:34px; color:#f1efe8; font:700 14px/1.2 Georgia,serif; text-transform:uppercase; }
    .selected-entity-hud__status-tooltip small { display:block; margin-top:6px; padding-top:6px; border-top:1px solid #2c3b40; color:#88a3bd; font-size:9px; text-transform:uppercase; }
    .selected-entity-hud__status-tooltip p { margin:8px 0 0; color:#bdcde0; font-size:10px; line-height:1.38; }
    .selected-entity-hud__status-tooltip em { position:absolute; top:11px; right:11px; color:var(--status-ring); font-style:normal; font-size:9px; font-weight:800; text-transform:uppercase; }
    .selected-entity-hud__status-more { color:#e7ddb9; font-size:10px; font-weight:800; }

    .selected-entity-hud__generic,
    .tower-hud {
      position:absolute;
      inset:0;
      display:grid;
      grid-template-columns:29% 45% 26%;
      overflow:hidden;
      pointer-events:auto;
      background:linear-gradient(180deg,rgba(35,44,46,.985),rgba(7,12,16,.99) 24%),#0b1014;
    }
    .selected-entity-hud__identity,
    .selected-entity-hud__combat,
    .selected-entity-hud__details { min-width:0; padding:12px; }
    .selected-entity-hud__identity,
    .selected-entity-hud__combat { border-right:1px solid rgba(255,255,255,.1); }
    .selected-entity-hud__identity { display:grid; grid-template-columns:98px minmax(0,1fr); gap:10px; align-items:center; }
    .selected-entity-hud__portrait { position:relative; width:98px; height:116px; display:grid; place-items:center; overflow:hidden; border:1px solid rgba(211,190,137,.5); background:radial-gradient(circle at 50% 35%,color-mix(in srgb,var(--selection-accent) 28%,transparent),transparent 55%),linear-gradient(145deg,#243039,#0b1114 72%); box-shadow:inset 0 -18px 32px rgba(0,0,0,.55); }
    .selected-entity-hud__glyph { font-family:Georgia,serif; font-size:52px; font-weight:800; color:var(--selection-accent); text-shadow:0 0 18px color-mix(in srgb,var(--selection-accent) 38%,transparent); }
    .selected-entity-hud__team-dot { position:absolute; left:7px; bottom:7px; width:10px; height:10px; border-radius:50%; background:var(--selection-accent); box-shadow:0 0 8px var(--selection-accent); }
    .selected-entity-hud__identity-text strong { display:block; overflow:hidden; color:#f1e4ba; font-family:Georgia,serif; font-size:17px; white-space:nowrap; text-overflow:ellipsis; }
    .selected-entity-hud__identity-text > span { display:block; margin-top:3px; color:#8fa29d; font-size:9px; }
    .selected-entity-hud__identity-stats { display:grid; gap:4px; margin-top:10px; color:#bdc9c5; font-size:9px; }
    .selected-entity-hud__identity-stats span { display:flex; justify-content:space-between; gap:7px; }
    .selected-entity-hud__identity-stats b { color:#eef4ef; font-weight:700; font-variant-numeric:tabular-nums; }
    .selected-entity-hud__combat { display:flex; flex-direction:column; justify-content:center; gap:9px; }
    .selected-entity-hud__stat-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:7px; }
    .selected-entity-hud__stat { min-width:0; min-height:64px; display:flex; flex-direction:column; align-items:center; justify-content:center; border:1px solid rgba(214,192,132,.23); background:linear-gradient(145deg,rgba(35,48,56,.94),rgba(9,14,18,.96)); }
    .selected-entity-hud__stat span { color:#8fa29d; font-size:8px; text-transform:uppercase; }
    .selected-entity-hud__stat strong { margin-top:5px; color:#f2e8c8; font-size:15px; font-variant-numeric:tabular-nums; }
    .selected-entity-hud__abilities { min-height:68px; display:flex; align-items:center; justify-content:center; }
    .selected-entity-hud__ability-row { width:100%; display:flex; align-items:flex-start; justify-content:center; gap:8px; }
    .selected-entity-hud__no-abilities { width:100%; min-height:62px; display:grid; place-items:center; border:1px dashed rgba(143,162,157,.22); background:linear-gradient(145deg,rgba(25,35,40,.46),rgba(5,9,12,.62)); color:#788985; font:700 11px/1 Georgia,serif; letter-spacing:.08em; text-transform:uppercase; }
    .selected-entity-hud__health { position:relative; height:16px; overflow:hidden; border:1px solid rgba(0,0,0,.78); background:rgba(0,0,0,.68); }
    .selected-entity-hud__health > i { position:absolute; inset:0 auto 0 0; display:block; background:linear-gradient(90deg,var(--selection-health-start,#159742),var(--selection-health-end,#55d83d)); }
    .selected-entity-hud__health > b { position:absolute; inset:0; display:grid; place-items:center; color:#f1f5ef; font-size:9px; }
    .selected-entity-hud__details { display:flex; flex-direction:column; justify-content:center; gap:8px; }
    .selected-entity-hud__detail-row { display:flex; align-items:center; justify-content:space-between; gap:10px; min-height:25px; padding:0 8px; border:1px solid rgba(255,255,255,.07); background:rgba(4,8,10,.4); color:#8fa29d; font-size:9px; text-transform:uppercase; }
    .selected-entity-hud__detail-row b { overflow:hidden; color:#dfd4ad; font-size:10px; text-overflow:ellipsis; white-space:nowrap; }
    .selected-entity-hud__empty { position:absolute; inset:0; display:grid; place-items:center; color:#899994; background:#0b1014; font-family:Georgia,serif; font-size:16px; pointer-events:auto; }

    .unit-ability,
    .tower-ability { position:relative; width:60px; height:60px; padding:0; border:2px solid #756a49; background:linear-gradient(145deg,#293131,#0d1316 64%); color:#e0c77b; cursor:help; box-shadow:inset 0 0 0 1px #080c0d,0 2px 5px #0009; }
    .unit-ability { display:grid; place-items:center; font:800 23px/1 Georgia,serif; }
    .tower-ability.is-active { border-color:#d7bd6d; box-shadow:inset 0 0 11px color-mix(in srgb,var(--selection-accent) 22%,transparent),0 0 6px color-mix(in srgb,var(--selection-accent) 28%,transparent); }
    .tower-ability svg { width:100%; height:100%; padding:8px; stroke:currentColor; fill:none; stroke-width:2.4; }
    .tower-ability__level { position:absolute; right:2px; bottom:1px; min-width:15px; height:14px; display:grid; place-items:center; padding:0 2px; color:#e9e2c9; background:#070b0de8; font-size:8px; }
    .tower-ability__tooltip,
    .unit-ability__tooltip { position:absolute; left:-16px; bottom:calc(100% + 12px); z-index:250; width:330px; padding:13px 14px 14px; visibility:hidden; opacity:0; transform:translateY(5px); transition:opacity .12s ease,transform .12s ease; pointer-events:none; text-align:left; text-transform:none; background:linear-gradient(135deg,#1d282d,#0b1216 62%); border:2px solid #05090b; box-shadow:0 8px 24px #000b,inset 0 1px rgba(255,255,255,.06); }
    .tower-ability:hover .tower-ability__tooltip,
    .tower-ability:focus-visible .tower-ability__tooltip,
    .unit-ability:hover .unit-ability__tooltip,
    .unit-ability:focus-visible .unit-ability__tooltip { visibility:visible; opacity:1; transform:translateY(0); }
    .tower-ability__tooltip strong,
    .unit-ability__tooltip strong { display:block; color:#f0eee8; font:700 18px/1.2 Georgia,serif; text-transform:uppercase; }
    .tower-ability__tooltip em,
    .unit-ability__tooltip em { position:absolute; top:14px; right:14px; color:#f1eee3; font-style:normal; font-size:10px; }
    .tower-ability__tooltip small,
    .unit-ability__tooltip small { display:block; margin:8px 0 0; padding:7px 0; border-top:1px solid #2e3c41; border-bottom:1px solid #2e3c41; color:#7f9ab4; font-size:10px; }
    .tower-ability__tooltip p,
    .unit-ability__tooltip p { margin:10px 0 0; color:#b8cbe3; font-size:11px; line-height:1.35; }
    .tower-ability__tooltip p b { color:#f0ad4c; }
    .tower-ability__effects { margin-top:9px; color:#7791ad; font-size:10px; line-height:1.35; }
    .tower-ability__effects b { color:#e3e5e5; }

    .tower-hud { grid-template-columns:31% 43% 26%; overflow:visible; box-shadow:inset 0 1px rgba(255,255,255,.05); }
    .tower-hud__identity,
    .tower-hud__abilities,
    .tower-hud__details { min-width:0; min-height:0; }
    .tower-hud__identity,
    .tower-hud__abilities { border-right:1px solid #57584077; }
    .tower-hud__identity { display:grid; grid-template-columns:126px minmax(0,1fr); align-items:stretch; padding:6px 8px 7px 5px; gap:8px; }
    .tower-hud__portrait { position:relative; min-width:0; overflow:hidden; border:2px solid #8c7447; border-top-color:#dbc584; background:radial-gradient(circle at 50% 48%,color-mix(in srgb,var(--selection-accent) 22%,transparent),transparent 57%),linear-gradient(#223137,#081014 75%); box-shadow:0 0 0 2px #070b0d,inset 0 -18px 28px #0008; }
    .tower-hud__portrait::after { content:""; position:absolute; inset:0; z-index:4; pointer-events:none; background:linear-gradient(180deg,rgba(255,255,255,.035),transparent 22% 72%,rgba(0,0,0,.25)); }
    .tower-hud__portrait-title { position:absolute; z-index:6; top:0; left:0; right:0; height:21px; display:grid; place-items:center; color:#f7f0d8; background:linear-gradient(#303938ee,#111719ee); border-bottom:1px solid #88754d; font:700 11px/1 Georgia,serif; letter-spacing:.12em; }
    .tower-hud__preview { position:absolute; inset:17px 0 0; z-index:2; }
    .tower-hud__level { position:absolute; z-index:7; left:7px; bottom:6px; width:29px; height:29px; display:grid; place-items:center; border-radius:50%; border:2px solid #b9954f; background:#0c1012e8; color:#f1d890; font:800 12px/1 Georgia,serif; box-shadow:0 0 0 2px #05090b; }
    .tower-hud__summary { min-width:0; display:flex; flex-direction:column; justify-content:center; gap:7px; padding:5px 0; }
    .tower-hud__name { overflow:hidden; color:#eadcb5; font:700 13px/1.15 Georgia,serif; white-space:nowrap; text-overflow:ellipsis; }
    .tower-hud__team { margin-top:-3px; color:var(--selection-accent); font-size:8px; text-transform:uppercase; }
    .tower-hud__metric { display:grid; grid-template-columns:1fr auto; align-items:center; gap:6px; color:#84989b; font-size:8px; text-transform:uppercase; }
    .tower-hud__metric b { color:#e7e4d7; font-size:10px; font-variant-numeric:tabular-nums; }
    .tower-hud__abilities { position:relative; display:flex; flex-direction:column; justify-content:center; gap:9px; padding:9px 12px 8px; }
    .tower-hud__ability-row { display:flex; align-items:flex-start; justify-content:center; gap:8px; min-height:66px; }
    .tower-hud__health { position:relative; height:23px; overflow:hidden; border:2px solid #090d0e; background:#030706; box-shadow:inset 0 0 8px #000; }
    .tower-hud__health-fill { position:absolute; inset:0 auto 0 0; background:linear-gradient(90deg,var(--selection-health-start,#12aa36),var(--selection-health-end,#62db45)); box-shadow:inset 0 3px 7px #8dff8844; }
    .tower-hud__health-text { position:absolute; inset:0; display:grid; place-items:center; color:#fff; font-size:11px; font-weight:800; font-variant-numeric:tabular-nums; }
    .tower-hud__regen { position:absolute; z-index:2; right:7px; top:4px; color:#7dff83; font-size:9px; font-weight:700; }
    .tower-hud__details { padding:8px 7px 7px; background:rgba(4,8,10,.28); }
  `;
  document.head.appendChild(style);
}

function getCommandDeck() {
  return document.querySelector<HTMLElement>('.command-deck');
}

function ensureOverlay() {
  installStyles();
  const deck = getCommandDeck();
  if (!deck) return null;
  const existing = deck.querySelector<HTMLElement>(`:scope > .${OVERLAY_CLASS}`);
  if (existing) return existing;
  if (getComputedStyle(deck).position === 'static') deck.style.position = 'relative';
  const overlay = document.createElement('div');
  overlay.className = OVERLAY_CLASS;
  overlay.hidden = false;
  deck.appendChild(overlay);
  return overlay;
}

function statusToneLabel(tone: EntityStatusTone) {
  if (tone === 'positive') return 'Mejora';
  if (tone === 'negative') return 'Perjuicio';
  return 'Estado';
}

function statusIconSvg(icon: string) {
  switch (icon) {
    case 'backdoor-protection': return '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 7 49 14v15c0 12-6.7 22-17 28C21.7 51 15 41 15 29V14Z"/><path d="M24 39V26h16v13M28 26v-8h8v8"/><path d="M21 43h22"/></svg>';
    case 'backdoor-suppressed': return '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 7 49 14v15c0 12-6.7 22-17 28C21.7 51 15 41 15 29V14Z"/><path d="M19 19 45 45"/><path d="M45 19 19 45"/></svg>';
    case 'reinforced': return '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 7 48 14v15c0 12-6.4 21.5-16 28-9.6-6.5-16-16-16-28V14Z"/><path d="m32 18 7 8-7 16-7-16Z"/><path d="M10 31h8M46 31h8M32 8v7M18 15l6 6M46 15l-6 6"/></svg>';
    case 'slow': return '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M15 18h34M15 30h26M15 42h18"/><path d="m39 38 8 8 8-8"/><path d="M47 27v19"/></svg>';
    case 'stun': return '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M35 6 20 34h13l-5 24 18-31H34Z"/><path d="M12 15l6 5M52 15l-6 5M10 39l8-2M54 39l-8-2"/></svg>';
    case 'taunt': return '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M14 18h36v25H31l-10 8v-8h-7Z"/><path d="M24 28h16M24 35h11"/></svg>';
    case 'guard': return '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 7 49 14v15c0 12-6.7 22-17 28C21.7 51 15 41 15 29V14Z"/><path d="M23 34h18M32 18v27"/></svg>';
    case 'reprisal': return '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M15 43 45 13M38 12l8 1-1 8"/><path d="M49 42 19 22M26 20l-8 2 2 8"/><circle cx="32" cy="32" r="22"/></svg>';
    case 'majesty': return '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="m12 23 10 9 10-17 10 17 10-9-4 25H16Z"/><path d="M16 48h32"/><circle cx="12" cy="21" r="2"/><circle cx="32" cy="13" r="2"/><circle cx="52" cy="21" r="2"/></svg>';
    case 'judged': return '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="21"/><path d="M32 14v36M14 32h36"/><path d="m24 24 16 16M40 24 24 40"/></svg>';
    case 'debuff': return '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="21"/><path d="M21 21l22 22M43 21 21 43"/></svg>';
    default: return '<svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="20"/><path d="M32 20v13l8 6"/></svg>';
  }
}

function statusTooltipHtml(status: EntityStatusView) {
  const meta = [statusToneLabel(status.tone), status.rank ? `Nivel ${status.rank}` : '', status.sourceLabel ?? ''].filter(Boolean).join(' · ');
  return `<span class="selected-entity-hud__status-tooltip" role="tooltip"><strong>${escapeHtml(status.name)}</strong><em>${status.tone === 'positive' ? 'BUFF' : status.tone === 'negative' ? 'DEBUFF' : 'ESTADO'}</em><small>${escapeHtml(meta)}</small><p>${escapeHtml(status.description)}</p></span>`;
}

function statusIconHtml(status: EntityStatusView) {
  const seconds = status.durationLeftMs == null ? null : Math.max(0, Math.ceil(status.durationLeftMs / 1000));
  const stacks = status.stacks && status.stacks > 1 ? `<span class="selected-entity-hud__status-badge">${status.stacks}</span>` : '';
  const timer = seconds === null ? '' : `<span class="selected-entity-hud__status-time">${seconds}s</span>`;
  return `<button type="button" class="selected-entity-hud__status-icon selected-entity-hud__status-icon--${status.tone}" aria-label="${escapeHtml(status.name)}">${statusIconSvg(status.icon)}${stacks}${timer}${statusTooltipHtml(status)}</button>`;
}

function statusTrayHtml(entity: GameEntity | null) {
  const statuses = getEntityStatusViews(entity);
  if (statuses.length === 0) return '';
  const visible = statuses.slice(0, MAX_VISIBLE_STATUS_ICONS);
  const hidden = statuses.slice(MAX_VISIBLE_STATUS_ICONS);
  const hiddenTooltip = hidden.length === 0 ? '' : `<button type="button" class="selected-entity-hud__status-icon selected-entity-hud__status-icon--neutral selected-entity-hud__status-more" aria-label="${hidden.length} estados adicionales">+${hidden.length}<span class="selected-entity-hud__status-tooltip" role="tooltip"><strong>Estados adicionales</strong><em>+${hidden.length}</em><small>Más efectos activos</small><p>${hidden.map(status => escapeHtml(status.name)).join(' · ')}</p></span></button>`;
  return `<div class="selected-entity-hud__status-tray" data-status-tray>${visible.map(statusIconHtml).join('')}${hiddenTooltip}</div>`;
}

function syncStatusTray(overlay: HTMLElement, entity: GameEntity | null) {
  const current = overlay.querySelector<HTMLElement>('[data-status-tray]');
  const nextHtml = statusTrayHtml(entity);
  if (!nextHtml) {
    current?.remove();
    return;
  }
  if (current) current.outerHTML = nextHtml;
  else overlay.insertAdjacentHTML('afterbegin', nextHtml);
}

function entitySignature(entity: GameEntity | null) {
  if (!entity) return 'none';
  const aura = entity.kind === 'tower' ? getTowerAuraState(entity) : null;
  const stats = entity.kind === 'hero' ? null : combatStatsFor(entity);
  return [
    entity.id, entity.displayName, entity.kind, entity.team,
    entity.currentHp.toFixed(2), entity.maxHp, entity.currentResource, entity.maxResource,
    entity.level, entity.attackRange, entity.visionRadius, entity.alive, entity.revealed,
    stats?.attack ?? '', stats?.armor ?? '', stats?.interval ?? '', stats?.range ?? '',
    getEntityStatusSignature(entity),
    aura?.reinforced ?? false, aura?.backdoorProtection ?? false, aura?.backdoorActive ?? false,
  ].join('|');
}

function abilityIcon(id: string) {
  if (id === 'backdoor-protection') return '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 7 49 14v15c0 12-6.7 22-17 28C21.7 51 15 41 15 29V14Z"/><path d="M24 38V25h16v13M28 25v-7h8v7"/><path d="M21 42h22"/></svg>';
  return '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 6 48 14v15c0 12-6.4 21.5-16 28-9.6-6.5-16-16-16-28V14Z"/><path d="m32 18 7 8-7 15-7-15Z"/><path d="M10 31h8M46 31h8M32 8v7M18 15l6 6M46 15l-6 6"/></svg>';
}

function abilityEffectsHtml(id: string) {
  const ability = getTowerAbility(id);
  if (!ability) return '';
  const effects = ability.effects;
  if (id === 'backdoor-protection') {
    return `<div class="tower-ability__effects">REDUCCIÓN DE DAÑO: <b>${effects.damageReductionPercent}%</b><br>REGENERACIÓN: <b>+${effects.healthRegenPerSecond} HP/s</b><br>SE DESACTIVA CON CREEPS EN: <b>${effects.disabledByEnemyCreepRadius}</b></div>`;
  }
  return `<div class="tower-ability__effects">DAÑO ADICIONAL VS. REFORZADO: <b>${effects.bonusDamageVsReinforcedPercent}%</b><br>REDUCCIÓN DE DAÑO (HÉROES): <b>${effects.heroAttackDamageReductionPercent}%</b><br>REDUCCIÓN DE DAÑO (NO HÉROES): <b>${effects.nonHeroAttackDamageReductionPercent}%</b></div>`;
}

function abilityButtonHtml(id: string, active: boolean) {
  const ability = getTowerAbility(id);
  if (!ability) return '';
  return `<button class="tower-ability${active ? ' is-active' : ''}" type="button" aria-label="${escapeHtml(ability.name)}">${abilityIcon(id)}<span class="tower-ability__level">${ability.level}</span><span class="tower-ability__tooltip" role="tooltip"><strong>${escapeHtml(ability.name)}</strong><em>Nivel ${ability.level}</em><small>HABILIDAD: Pasiva</small><p>En inglés: <b>${escapeHtml(ability.englishName)}</b>.</p><p>${escapeHtml(ability.description)}</p>${abilityEffectsHtml(id)}</span></button>`;
}

function authoredAbilitiesHtml(entity: GameEntity) {
  const raw = entity.root.userData.hudAbilities;
  if (!Array.isArray(raw) || raw.length === 0) return '<div class="selected-entity-hud__no-abilities">SIN HABILIDADES</div>';
  const buttons = (raw as AuthoredHudAbility[]).map((ability, index) => {
    const name = ability.name?.trim() || `Habilidad ${index + 1}`;
    const description = ability.description?.trim() || 'Habilidad de la unidad.';
    const level = Math.max(1, Math.floor(ability.level ?? 1));
    const type = ability.type?.trim() || 'Habilidad';
    return `<button class="unit-ability" type="button" aria-label="${escapeHtml(name)}">${escapeHtml(name.charAt(0).toUpperCase())}<span class="tower-ability__level">${level}</span><span class="unit-ability__tooltip" role="tooltip"><strong>${escapeHtml(name)}</strong><em>Nivel ${level}</em><small>${escapeHtml(type)}</small><p>${escapeHtml(description)}</p></span></button>`;
  }).join('');
  return `<div class="selected-entity-hud__ability-row">${buttons}</div>`;
}

function nonHeroIdentityStatsHtml(entity: GameEntity) {
  const stats = combatStatsFor(entity);
  return `<div class="selected-entity-hud__identity-stats"><span>Ataque <b>${stats.attack}</b></span><span>Armadura <b>${stats.armor}</b></span><span>Intervalo <b>${stats.interval}</b></span><span>Rango <b>${stats.range}</b></span></div>`;
}

function detailRowsHtml(entity: GameEntity, localHero: GameEntity | null) {
  return `<div class="selected-entity-hud__detail-row"><span>Tipo</span><b>${kindLabel(entity.kind)}</b></div><div class="selected-entity-hud__detail-row"><span>Interacción</span><b>${escapeHtml(entity.interaction)}</b></div><div class="selected-entity-hud__detail-row"><span>Selección</span><b>${entity.selectable ? 'SÍ' : 'NO'}</b></div><div class="selected-entity-hud__detail-row"><span>Control</span><b>${entity === localHero ? 'PROPIO' : 'INSPECCIÓN'}</b></div>`;
}

function updateTowerDynamicHud(overlay: HTMLElement, entity: GameEntity) {
  const hpFraction = entity.maxHp > 0 ? Math.max(0, Math.min(1, entity.currentHp / entity.maxHp)) : 0;
  const hpText = entity.maxHp > 0 ? `${Math.floor(entity.currentHp)} / ${Math.floor(entity.maxHp)}` : '—';
  const regen = getTowerBackdoorRegenPerSecond(entity);
  const aura = getTowerAuraState(entity);
  const fill = overlay.querySelector<HTMLElement>('.tower-hud__health-fill');
  const text = overlay.querySelector<HTMLElement>('.tower-hud__health-text');
  const regenLabel = overlay.querySelector<HTMLElement>('.tower-hud__regen');
  const backdoorButton = overlay.querySelector<HTMLElement>('[data-ability="backdoor-protection"] .tower-ability');
  const reinforcedButton = overlay.querySelector<HTMLElement>('[data-ability="reinforced"] .tower-ability');
  if (fill) fill.style.width = `${hpFraction * 100}%`;
  if (text) text.textContent = hpText;
  if (regenLabel) regenLabel.textContent = regen > 0 ? `+${formatNumber(regen, 0)}/s` : '';
  backdoorButton?.classList.toggle('is-active', aura.backdoorActive);
  reinforcedButton?.classList.toggle('is-active', aura.reinforced);
  syncStatusTray(overlay, entity);
}

function renderTowerEntity(overlay: HTMLElement, entity: GameEntity, localHero: GameEntity | null) {
  applyHealthAccent(overlay, entity, localHero);
  const sameTower = overlay.dataset.selectionKind === 'tower'
    && overlay.dataset.selectionId === entity.id
    && Boolean(overlay.querySelector('.tower-hud'));
  if (!sameTower) {
    const aura = getTowerAuraState(entity);
    const tier = getTowerTier(entity);
    const stats = combatStatsFor(entity);
    const accent = teamAccent(entity.team);
    const towerAbilities = [
      tier > 1 ? `<div data-ability="backdoor-protection">${abilityButtonHtml('backdoor-protection', aura.backdoorActive)}</div>` : '',
      `<div data-ability="reinforced">${abilityButtonHtml('reinforced', aura.reinforced)}</div>`,
    ].filter(Boolean).join('');
    overlay.style.setProperty('--selection-accent', accent);
    overlay.dataset.selectionKind = 'tower';
    overlay.dataset.selectionId = entity.id;
    overlay.innerHTML = `${statusTrayHtml(entity)}<div class="tower-hud" data-tower-tier="${tier}"><div class="tower-hud__identity"><div class="tower-hud__portrait"><div class="tower-hud__portrait-title">TORRE · TIER ${tier}</div><div class="tower-hud__preview" data-tower-preview></div><div class="tower-hud__level">${tier}</div></div><div class="tower-hud__summary"><div class="tower-hud__name">${escapeHtml(entity.displayName)}</div><div class="tower-hud__team">${teamLabel(entity.team)}</div><div class="tower-hud__metric"><span>Ataque</span><b>${stats.attack}</b></div><div class="tower-hud__metric"><span>Armadura</span><b>${stats.armor}</b></div><div class="tower-hud__metric"><span>Intervalo</span><b>${stats.interval}</b></div><div class="tower-hud__metric"><span>Rango</span><b>${stats.range}</b></div></div></div><div class="tower-hud__abilities"><div class="tower-hud__ability-row">${towerAbilities || '<div class="selected-entity-hud__no-abilities">SIN HABILIDADES</div>'}</div><div class="tower-hud__health"><i class="tower-hud__health-fill"></i><b class="tower-hud__health-text"></b><span class="tower-hud__regen"></span></div></div><div class="selected-entity-hud__details tower-hud__details">${detailRowsHtml(entity, localHero)}</div></div>`;
  }
  updateTowerDynamicHud(overlay, entity);
}

function renderGenericEntity(overlay: HTMLElement, entity: GameEntity | null, localHero: GameEntity | null) {
  overlay.dataset.selectionKind = entity?.kind ?? 'none';
  overlay.dataset.selectionId = entity?.id ?? '';
  if (!entity) {
    overlay.style.removeProperty('--selection-accent');
    overlay.innerHTML = '<div class="selected-entity-hud__empty">Sin selección</div>';
    return;
  }

  const accent = teamAccent(entity.team);
  overlay.style.setProperty('--selection-accent', accent);
  applyHealthAccent(overlay, entity, localHero);
  const hpFraction = entity.maxHp > 0 ? Math.max(0, Math.min(1, entity.currentHp / entity.maxHp)) : 0;
  const hpText = entity.maxHp > 0 ? `${Math.floor(entity.currentHp)} / ${Math.floor(entity.maxHp)}` : '—';
  const isHero = entity.kind === 'hero';
  const resourceText = entity.maxResource > 0 ? `${Math.floor(entity.currentResource)} / ${Math.floor(entity.maxResource)}` : '—';
  const heroIdentityStats = `<div class="selected-entity-hud__identity-stats"><span>Estado <b>${entity.alive ? 'VIVO' : 'CAÍDO'}</b></span><span>Nivel <b>${entity.level}</b></span><span>Recurso <b>${resourceText}</b></span></div>`;
  const centerContent = isHero
    ? `<div class="selected-entity-hud__stat-grid"><div class="selected-entity-hud__stat"><span>Vida</span><strong>${hpText}</strong></div><div class="selected-entity-hud__stat"><span>Rango ATQ</span><strong>${entity.attackRange > 0 ? formatNumber(entity.attackRange, 1) : '—'}</strong></div><div class="selected-entity-hud__stat"><span>Visión</span><strong>${entity.visionRadius > 0 ? formatNumber(entity.visionRadius, 1) : '—'}</strong></div><div class="selected-entity-hud__stat"><span>Equipo</span><strong style="color:${accent}">${teamLabel(entity.team)}</strong></div></div>`
    : `<div class="selected-entity-hud__abilities">${authoredAbilitiesHtml(entity)}</div>`;

  overlay.innerHTML = `${statusTrayHtml(entity)}<div class="selected-entity-hud__generic"><div class="selected-entity-hud__identity"><div class="selected-entity-hud__portrait"><span class="selected-entity-hud__glyph">${kindGlyph(entity.kind)}</span><i class="selected-entity-hud__team-dot"></i></div><div class="selected-entity-hud__identity-text"><strong>${escapeHtml(entity.displayName)}</strong><span>${kindLabel(entity.kind)} · ${teamLabel(entity.team)}</span>${isHero ? heroIdentityStats : nonHeroIdentityStatsHtml(entity)}</div></div><div class="selected-entity-hud__combat">${centerContent}<div class="selected-entity-hud__health"><i style="width:${hpFraction * 100}%"></i><b>${entity.maxHp > 0 ? hpText : 'Sin barra de vida'}</b></div></div><div class="selected-entity-hud__details">${detailRowsHtml(entity, localHero)}</div></div>`;
}

function renderLocalHeroStatusLayer(overlay: HTMLElement, entity: GameEntity) {
  overlay.style.setProperty('--selection-accent', teamAccent(entity.team));
  overlay.dataset.selectionKind = 'hero';
  overlay.dataset.selectionId = entity.id;
  overlay.innerHTML = statusTrayHtml(entity);
}

export type SelectionHudBridge = Readonly<{
  setSelection(entity: GameEntity | null): void;
  refresh(entity: GameEntity | null): void;
  isLocalHeroSelected(): boolean;
  dispose(): void;
}>;

export function createSelectionHudBridge(localHero: GameEntity | null): SelectionHudBridge {
  activeBridgeCount += 1;
  let selected: GameEntity | null = null;
  let lastSignature = '';
  let overlay = ensureOverlay();
  let disposed = false;

  const render = (force = false) => {
    if (overlay && !overlay.isConnected) {
      overlay = null;
      lastSignature = '';
    }
    overlay ??= ensureOverlay();
    if (!overlay) return;
    overlay.hidden = false;

    const signature = entitySignature(selected);
    if (!force && signature === lastSignature) return;
    lastSignature = signature;

    const localHeroSelected = selected !== null && localHero !== null && selected === localHero;
    if (selected?.kind === 'hero') {
      // Hero inspection uses the real React command deck. Keep this imperative layer only
      // for world/status adornments so enemy heroes get the same HUD structure as the owner.
      renderLocalHeroStatusLayer(overlay, selected);
      return;
    }

    if (selected?.kind === 'tower') {
      renderTowerEntity(overlay, selected, localHero);
      return;
    }

    renderGenericEntity(overlay, selected, localHero);
  };

  const onPointerDownCapture = (event: PointerEvent) => {
    if (event.button !== 2) return;
    if (selected === localHero && localHero?.alive) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const onKeyDownCapture = (event: KeyboardEvent) => {
    if (selected === localHero && localHero?.alive) return;
    const code = event.code;
    const blocked = code === 'KeyA'
      || code === 'KeyQ'
      || code === 'KeyW'
      || code === 'KeyE'
      || code === 'KeyR'
      || code === 'KeyT'
      || /^Digit[1-6]$/.test(code);
    if (!blocked) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  window.addEventListener('pointerdown', onPointerDownCapture, true);
  window.addEventListener('keydown', onKeyDownCapture, true);

  return {
    setSelection(entity) {
      if (selected?.id !== entity?.id) lastSignature = '';
      selected = entity;
      render(true);
      const hero = selected?.kind === 'hero' ? selected : null;
      window.dispatchEvent(new CustomEvent<HeroSelectionChangedDetail>(HERO_SELECTION_CHANGED_EVENT, {
        detail: {
          worldEntityId: hero?.id ?? null,
          ownerUserId: hero && hero !== localHero
            ? String(hero.root.userData.networkOwnerUserId || '') || null
            : null,
          local: Boolean(hero && localHero && hero === localHero),
        },
      }));
    },
    refresh(entity) {
      selected = entity;
      render(false);
    },
    isLocalHeroSelected: () => selected !== null && selected === localHero && localHero.alive,
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener('pointerdown', onPointerDownCapture, true);
      window.removeEventListener('keydown', onKeyDownCapture, true);
      activeBridgeCount = Math.max(0, activeBridgeCount - 1);
      if (activeBridgeCount === 0) overlay?.remove();
      overlay = null;
    },
  };
}
