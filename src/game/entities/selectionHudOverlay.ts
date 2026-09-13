import * as THREE from 'three';
import { TOWER_GAMEPLAY, getTowerAbility } from '../gameplay/towerConfig';
import type { GameEntity, GameEntityKind, TeamId } from './gameEntities';
import { getTowerAuraState, getTowerBackdoorRegenPerSecond } from './towerAuras';

const STYLE_ID = 'dawnreach-selection-hud-style';
const OVERLAY_CLASS = 'selected-entity-hud-overlay';
let activeBridgeCount = 0;

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

function formatNumber(value: number, digits = 0) {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(digits);
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
      pointer-events: auto;
      color: #edf5f4;
      font-family: "Trebuchet MS", "Segoe UI", sans-serif;
      text-shadow: 0 1px 2px rgba(0,0,0,.9);
    }
    .${OVERLAY_CLASS}[hidden] { display: none !important; }

    .selected-entity-hud__generic {
      position: absolute;
      inset: 0;
      display: grid;
      grid-template-columns: 29% 45% 26%;
      overflow: hidden;
      background: linear-gradient(180deg, rgba(35,44,46,.985), rgba(7,12,16,.99) 24%), #0b1014;
    }
    .selected-entity-hud__identity,
    .selected-entity-hud__combat,
    .selected-entity-hud__details { min-width: 0; padding: 12px; }
    .selected-entity-hud__identity,
    .selected-entity-hud__combat { border-right: 1px solid rgba(255,255,255,.1); }
    .selected-entity-hud__identity {
      display: grid;
      grid-template-columns: 98px minmax(0,1fr);
      gap: 10px;
      align-items: center;
    }
    .selected-entity-hud__portrait {
      position: relative;
      width: 98px;
      height: 116px;
      display: grid;
      place-items: center;
      overflow: hidden;
      border: 1px solid rgba(211,190,137,.5);
      background: radial-gradient(circle at 50% 35%, color-mix(in srgb, var(--selection-accent) 28%, transparent), transparent 55%), linear-gradient(145deg, #243039, #0b1114 72%);
      box-shadow: inset 0 -18px 32px rgba(0,0,0,.55);
    }
    .selected-entity-hud__glyph {
      font-family: Georgia, serif;
      font-size: 52px;
      font-weight: 800;
      color: var(--selection-accent);
      text-shadow: 0 0 18px color-mix(in srgb, var(--selection-accent) 38%, transparent);
    }
    .selected-entity-hud__team-dot {
      position: absolute;
      left: 7px;
      bottom: 7px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--selection-accent);
      box-shadow: 0 0 8px var(--selection-accent);
    }
    .selected-entity-hud__identity-text strong {
      display: block;
      overflow: hidden;
      color: #f1e4ba;
      font-family: Georgia, serif;
      font-size: 17px;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .selected-entity-hud__identity-text > span { display: block; margin-top: 3px; color: #8fa29d; font-size: 9px; }
    .selected-entity-hud__identity-stats { display: grid; gap: 5px; margin-top: 12px; color: #bdc9c5; font-size: 10px; }
    .selected-entity-hud__identity-stats b { color: #eef4ef; font-weight: 700; }
    .selected-entity-hud__combat { display: flex; flex-direction: column; justify-content: center; gap: 12px; }
    .selected-entity-hud__stat-grid { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 7px; }
    .selected-entity-hud__stat {
      min-width: 0;
      min-height: 64px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      border: 1px solid rgba(214,192,132,.23);
      background: linear-gradient(145deg, rgba(35,48,56,.94), rgba(9,14,18,.96));
    }
    .selected-entity-hud__stat span { color: #8fa29d; font-size: 8px; text-transform: uppercase; }
    .selected-entity-hud__stat strong { margin-top: 5px; color: #f2e8c8; font-size: 15px; font-variant-numeric: tabular-nums; }
    .selected-entity-hud__health {
      position: relative;
      height: 16px;
      overflow: hidden;
      border: 1px solid rgba(0,0,0,.78);
      background: rgba(0,0,0,.68);
    }
    .selected-entity-hud__health > i { position: absolute; inset: 0 auto 0 0; display: block; background: linear-gradient(90deg, #159742, #55d83d); }
    .selected-entity-hud__health > b { position: absolute; inset: 0; display: grid; place-items: center; color: #f1f5ef; font-size: 9px; }
    .selected-entity-hud__details { display: flex; flex-direction: column; justify-content: center; gap: 8px; }
    .selected-entity-hud__detail-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-height: 25px;
      padding: 0 8px;
      border: 1px solid rgba(255,255,255,.07);
      background: rgba(4,8,10,.4);
      color: #8fa29d;
      font-size: 9px;
      text-transform: uppercase;
    }
    .selected-entity-hud__detail-row b { overflow: hidden; color: #dfd4ad; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
    .selected-entity-hud__empty { position: absolute; inset: 0; display: grid; place-items: center; color: #899994; background: #0b1014; font-family: Georgia, serif; font-size: 16px; }

    .tower-hud {
      position: absolute;
      inset: 0;
      display: grid;
      grid-template-columns: 31% 43% 26%;
      overflow: visible;
      background: linear-gradient(180deg, rgba(36,43,43,.995), rgba(7,12,15,.995) 24%), #0a1013;
      box-shadow: inset 0 1px rgba(255,255,255,.05);
    }
    .tower-hud__identity,
    .tower-hud__abilities,
    .tower-hud__inventory { min-width: 0; min-height: 0; }
    .tower-hud__identity,
    .tower-hud__abilities { border-right: 1px solid #57584077; }
    .tower-hud__identity {
      display: grid;
      grid-template-columns: 126px minmax(0,1fr);
      align-items: stretch;
      padding: 6px 8px 7px 5px;
      gap: 8px;
    }
    .tower-hud__portrait {
      position: relative;
      min-width: 0;
      overflow: hidden;
      border: 2px solid #8c7447;
      border-top-color: #dbc584;
      background: radial-gradient(circle at 50% 48%, color-mix(in srgb, var(--selection-accent) 22%, transparent), transparent 57%), linear-gradient(#223137, #081014 75%);
      box-shadow: 0 0 0 2px #070b0d, inset 0 -18px 28px #0008;
    }
    .tower-hud__portrait::after {
      content: "";
      position: absolute;
      inset: 0;
      z-index: 4;
      pointer-events: none;
      background: linear-gradient(180deg, rgba(255,255,255,.035), transparent 22% 72%, rgba(0,0,0,.25));
    }
    .tower-hud__portrait-title {
      position: absolute;
      z-index: 6;
      top: 0;
      left: 0;
      right: 0;
      height: 21px;
      display: grid;
      place-items: center;
      color: #f7f0d8;
      background: linear-gradient(#303938ee, #111719ee);
      border-bottom: 1px solid #88754d;
      font: 700 11px/1 Georgia, serif;
      letter-spacing: .12em;
    }
    .tower-hud__preview { position: absolute; inset: 17px 0 0; z-index: 2; }
    .tower-hud__preview canvas { display: block; width: 100% !important; height: 100% !important; }
    .tower-hud__level {
      position: absolute;
      z-index: 7;
      left: 7px;
      bottom: 6px;
      width: 29px;
      height: 29px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      border: 2px solid #b9954f;
      background: #0c1012e8;
      color: #f1d890;
      font: 800 12px/1 Georgia, serif;
      box-shadow: 0 0 0 2px #05090b;
    }
    .tower-hud__summary {
      min-width: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 7px;
      padding: 5px 0;
    }
    .tower-hud__name {
      overflow: hidden;
      color: #eadcb5;
      font: 700 13px/1.15 Georgia, serif;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .tower-hud__team { margin-top: -3px; color: var(--selection-accent); font-size: 8px; text-transform: uppercase; }
    .tower-hud__metric {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: 6px;
      color: #84989b;
      font-size: 8px;
      text-transform: uppercase;
    }
    .tower-hud__metric b { color: #e7e4d7; font-size: 10px; font-variant-numeric: tabular-nums; }
    .tower-hud__abilities {
      position: relative;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 9px;
      padding: 9px 12px 8px;
    }
    .tower-hud__ability-row { display: flex; align-items: flex-start; gap: 8px; min-height: 66px; }
    .tower-ability {
      position: relative;
      width: 60px;
      height: 60px;
      padding: 0;
      border: 2px solid #756a49;
      background: linear-gradient(145deg, #293131, #0d1316 64%);
      color: #e0c77b;
      cursor: help;
      box-shadow: inset 0 0 0 1px #080c0d, 0 2px 5px #0009;
    }
    .tower-ability.is-active { border-color: #d7bd6d; box-shadow: inset 0 0 11px color-mix(in srgb, var(--selection-accent) 22%, transparent), 0 0 6px color-mix(in srgb, var(--selection-accent) 28%, transparent); }
    .tower-ability svg { width: 100%; height: 100%; padding: 8px; stroke: currentColor; fill: none; stroke-width: 2.4; }
    .tower-ability__level {
      position: absolute;
      right: 2px;
      bottom: 1px;
      min-width: 15px;
      height: 14px;
      display: grid;
      place-items: center;
      padding: 0 2px;
      color: #e9e2c9;
      background: #070b0de8;
      font-size: 8px;
    }
    .tower-ability__tooltip {
      position: absolute;
      left: -16px;
      bottom: calc(100% + 12px);
      z-index: 250;
      width: 330px;
      padding: 13px 14px 14px;
      visibility: hidden;
      opacity: 0;
      transform: translateY(5px);
      transition: opacity .12s ease, transform .12s ease;
      pointer-events: none;
      text-align: left;
      text-transform: none;
      background: linear-gradient(135deg, #1d282d, #0b1216 62%);
      border: 2px solid #05090b;
      box-shadow: 0 8px 24px #000b, inset 0 1px rgba(255,255,255,.06);
    }
    .tower-ability:hover .tower-ability__tooltip,
    .tower-ability:focus-visible .tower-ability__tooltip { visibility: visible; opacity: 1; transform: translateY(0); }
    .tower-ability__tooltip strong { display: block; color: #f0eee8; font: 700 18px/1.2 Georgia, serif; text-transform: uppercase; }
    .tower-ability__tooltip em { position: absolute; top: 14px; right: 14px; color: #f1eee3; font-style: normal; font-size: 10px; }
    .tower-ability__tooltip small { display: block; margin: 8px 0 0; padding: 7px 0; border-top: 1px solid #2e3c41; border-bottom: 1px solid #2e3c41; color: #7f9ab4; font-size: 10px; }
    .tower-ability__tooltip p { margin: 10px 0 0; color: #b8cbe3; font-size: 11px; line-height: 1.35; }
    .tower-ability__tooltip p b { color: #f0ad4c; }
    .tower-ability__effects { margin-top: 9px; color: #7791ad; font-size: 10px; line-height: 1.35; }
    .tower-ability__effects b { color: #e3e5e5; }
    .tower-hud__health {
      position: relative;
      height: 23px;
      overflow: hidden;
      border: 2px solid #090d0e;
      background: #030706;
      box-shadow: inset 0 0 8px #000;
    }
    .tower-hud__health-fill { position: absolute; inset: 0 auto 0 0; background: linear-gradient(90deg, #12aa36, #62db45); box-shadow: inset 0 3px 7px #8dff8844; }
    .tower-hud__health-text { position: absolute; inset: 0; display: grid; place-items: center; color: #fff; font-size: 11px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .tower-hud__regen { position: absolute; z-index: 2; right: 7px; top: 4px; color: #7dff83; font-size: 9px; font-weight: 700; }
    .tower-hud__inventory {
      display: grid;
      grid-template-columns: minmax(0,1fr) 43px;
      gap: 6px;
      padding: 8px 7px 7px;
      background: rgba(4,8,10,.28);
    }
    .tower-hud__slots { display: grid; grid-template-columns: repeat(3, 1fr); grid-template-rows: repeat(2, 1fr); gap: 4px; }
    .tower-hud__slot { border: 1px solid #343a38; background: linear-gradient(#181d1d, #090d0e); box-shadow: inset 0 0 7px #000b; }
    .tower-hud__side-actions { display: flex; flex-direction: column; gap: 7px; justify-content: center; }
    .tower-hud__side-action { width: 39px; height: 39px; display: grid; place-items: center; border-radius: 50%; border: 1px solid #373c3b; background: linear-gradient(#222929, #090d0f); color: #606766; font-size: 17px; box-shadow: inset 0 0 8px #000c; }
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
  overlay.hidden = true;
  deck.appendChild(overlay);
  return overlay;
}

function entitySignature(entity: GameEntity | null) {
  if (!entity) return 'none';
  const aura = entity.kind === 'tower' ? getTowerAuraState(entity) : null;
  return [
    entity.id,
    entity.displayName,
    entity.kind,
    entity.team,
    entity.currentHp.toFixed(2),
    entity.maxHp,
    entity.currentResource,
    entity.maxResource,
    entity.level,
    entity.attackRange,
    entity.visionRadius,
    entity.alive,
    entity.revealed,
    aura?.reinforced ?? false,
    aura?.backdoorProtection ?? false,
    aura?.backdoorActive ?? false,
  ].join('|');
}

function abilityIcon(id: string) {
  if (id === 'backdoor-protection') {
    return `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 7 49 14v15c0 12-6.7 22-17 28C21.7 51 15 41 15 29V14Z"/><path d="M24 38V25h16v13M28 25v-7h8v7"/><path d="M21 42h22"/></svg>`;
  }
  return `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 6 48 14v15c0 12-6.4 21.5-16 28-9.6-6.5-16-16-16-28V14Z"/><path d="m32 18 7 8-7 15-7-15Z"/><path d="M10 31h8M46 31h8M32 8v7M18 15l6 6M46 15l-6 6"/></svg>`;
}

function abilityEffectsHtml(id: string) {
  const ability = getTowerAbility(id);
  if (!ability) return '';
  const effects = ability.effects;
  if (id === 'backdoor-protection') {
    return `
      <div class="tower-ability__effects">
        REDUCCIÓN DE DAÑO: <b>${effects.damageReductionPercent}%</b><br>
        REGENERACIÓN: <b>+${effects.healthRegenPerSecond} HP/s</b><br>
        SE DESACTIVA CON CREEPS EN: <b>${effects.disabledByEnemyCreepRadius}</b>
      </div>`;
  }
  return `
    <div class="tower-ability__effects">
      DAÑO ADICIONAL VS. REFORZADO: <b>${effects.bonusDamageVsReinforcedPercent}%</b><br>
      REDUCCIÓN DE DAÑO (HÉROES): <b>${effects.heroAttackDamageReductionPercent}%</b><br>
      REDUCCIÓN DE DAÑO (NO HÉROES): <b>${effects.nonHeroAttackDamageReductionPercent}%</b>
    </div>`;
}

function abilityButtonHtml(id: string, active: boolean) {
  const ability = getTowerAbility(id);
  if (!ability) return '';
  return `
    <button class="tower-ability${active ? ' is-active' : ''}" type="button" aria-label="${ability.name}">
      ${abilityIcon(id)}
      <span class="tower-ability__level">${ability.level}</span>
      <span class="tower-ability__tooltip" role="tooltip">
        <strong>${ability.name}</strong>
        <em>Nivel ${ability.level}</em>
        <small>HABILIDAD: Pasiva</small>
        <p>En inglés: <b>${ability.englishName}</b>.</p>
        <p>${ability.description}</p>
        ${abilityEffectsHtml(id)}
      </span>
    </button>`;
}

function updateTowerDynamicHud(overlay: HTMLElement, entity: GameEntity) {
  const hpFraction = entity.maxHp > 0 ? Math.max(0, Math.min(1, entity.currentHp / entity.maxHp)) : 0;
  const hpText = entity.maxHp > 0 ? `${Math.floor(entity.currentHp)} / ${Math.floor(entity.maxHp)}` : '—';
  const regen = getTowerBackdoorRegenPerSecond(entity);
  const aura = getTowerAuraState(entity);
  const fill = overlay.querySelector<HTMLElement>('.tower-hud__health-fill');
  const text = overlay.querySelector<HTMLElement>('.tower-hud__health-text');
  const regenLabel = overlay.querySelector<HTMLElement>('.tower-hud__regen');
  const backdoorButton = overlay.querySelector<HTMLElement>('[data-ability="backdoor-protection"]');
  const reinforcedButton = overlay.querySelector<HTMLElement>('[data-ability="reinforced"]');
  if (fill) fill.style.width = `${hpFraction * 100}%`;
  if (text) text.textContent = hpText;
  if (regenLabel) regenLabel.textContent = regen > 0 ? `+${formatNumber(regen, 0)}/s` : '';
  backdoorButton?.classList.toggle('is-active', aura.backdoorActive);
  reinforcedButton?.classList.toggle('is-active', aura.reinforced);
}

function renderTowerEntity(overlay: HTMLElement, entity: GameEntity) {
  const sameTower = overlay.dataset.selectionKind === 'tower'
    && overlay.dataset.selectionId === entity.id
    && Boolean(overlay.querySelector('.tower-hud'));
  if (!sameTower) {
    const aura = getTowerAuraState(entity);
    const accent = teamAccent(entity.team);
    overlay.style.setProperty('--selection-accent', accent);
    overlay.dataset.selectionKind = 'tower';
    overlay.dataset.selectionId = entity.id;
    overlay.innerHTML = `
      <div class="tower-hud">
        <div class="tower-hud__identity">
          <div class="tower-hud__portrait">
            <div class="tower-hud__portrait-title">TORRE</div>
            <div class="tower-hud__preview" data-tower-preview></div>
            <div class="tower-hud__level">${TOWER_GAMEPLAY.level}</div>
          </div>
          <div class="tower-hud__summary">
            <div class="tower-hud__name">${entity.displayName}</div>
            <div class="tower-hud__team">${teamLabel(entity.team)}</div>
            <div class="tower-hud__metric"><span>Daño</span><b>${TOWER_GAMEPLAY.attack.damage}</b></div>
            <div class="tower-hud__metric"><span>Intervalo</span><b>${formatNumber(TOWER_GAMEPLAY.attack.intervalSeconds, 2)}s</b></div>
            <div class="tower-hud__metric"><span>Rango</span><b>${formatNumber(entity.attackRange, 1)}</b></div>
            <div class="tower-hud__metric"><span>Visión</span><b>${formatNumber(entity.visionRadius, 1)}</b></div>
          </div>
        </div>
        <div class="tower-hud__abilities">
          <div class="tower-hud__ability-row">
            <div data-ability="backdoor-protection">${abilityButtonHtml('backdoor-protection', aura.backdoorActive)}</div>
            <div data-ability="reinforced">${abilityButtonHtml('reinforced', aura.reinforced)}</div>
          </div>
          <div class="tower-hud__health">
            <i class="tower-hud__health-fill"></i>
            <b class="tower-hud__health-text"></b>
            <span class="tower-hud__regen"></span>
          </div>
        </div>
        <div class="tower-hud__inventory">
          <div class="tower-hud__slots">
            <span class="tower-hud__slot"></span><span class="tower-hud__slot"></span><span class="tower-hud__slot"></span>
            <span class="tower-hud__slot"></span><span class="tower-hud__slot"></span><span class="tower-hud__slot"></span>
          </div>
          <div class="tower-hud__side-actions"><span class="tower-hud__side-action">◫</span><span class="tower-hud__side-action">▱</span></div>
        </div>
      </div>`;
  }
  updateTowerDynamicHud(overlay, entity);
  return !sameTower;
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
  const hpFraction = entity.maxHp > 0 ? Math.max(0, Math.min(1, entity.currentHp / entity.maxHp)) : 0;
  const hpText = entity.maxHp > 0 ? `${Math.floor(entity.currentHp)} / ${Math.floor(entity.maxHp)}` : '—';
  const resourceText = entity.maxResource > 0 ? `${Math.floor(entity.currentResource)} / ${Math.floor(entity.maxResource)}` : '—';
  const levelText = entity.kind === 'hero' || entity.level > 1 ? String(entity.level) : '—';

  overlay.innerHTML = `
    <div class="selected-entity-hud__generic">
      <div class="selected-entity-hud__identity">
        <div class="selected-entity-hud__portrait"><span class="selected-entity-hud__glyph">${kindGlyph(entity.kind)}</span><i class="selected-entity-hud__team-dot"></i></div>
        <div class="selected-entity-hud__identity-text">
          <strong>${entity.displayName}</strong><span>${kindLabel(entity.kind)} · ${teamLabel(entity.team)}</span>
          <div class="selected-entity-hud__identity-stats"><span>Estado <b>${entity.alive ? 'VIVO' : 'CAÍDO'}</b></span><span>Nivel <b>${levelText}</b></span><span>Recurso <b>${resourceText}</b></span></div>
        </div>
      </div>
      <div class="selected-entity-hud__combat">
        <div class="selected-entity-hud__stat-grid">
          <div class="selected-entity-hud__stat"><span>Vida</span><strong>${hpText}</strong></div>
          <div class="selected-entity-hud__stat"><span>Rango ATQ</span><strong>${entity.attackRange > 0 ? formatNumber(entity.attackRange, 1) : '—'}</strong></div>
          <div class="selected-entity-hud__stat"><span>Visión</span><strong>${entity.visionRadius > 0 ? formatNumber(entity.visionRadius, 1) : '—'}</strong></div>
          <div class="selected-entity-hud__stat"><span>Equipo</span><strong style="color:${accent}">${teamLabel(entity.team)}</strong></div>
        </div>
        <div class="selected-entity-hud__health"><i style="width:${hpFraction * 100}%"></i><b>${entity.maxHp > 0 ? hpText : 'Sin barra de vida'}</b></div>
      </div>
      <div class="selected-entity-hud__details">
        <div class="selected-entity-hud__detail-row"><span>Tipo</span><b>${kindLabel(entity.kind)}</b></div>
        <div class="selected-entity-hud__detail-row"><span>Interacción</span><b>${entity.interaction}</b></div>
        <div class="selected-entity-hud__detail-row"><span>Selección</span><b>${entity.selectable ? 'SÍ' : 'NO'}</b></div>
        <div class="selected-entity-hud__detail-row"><span>Control</span><b>${entity === localHero ? 'PROPIO' : 'INSPECCIÓN'}</b></div>
      </div>
    </div>`;
}

type TowerPreviewController = Readonly<{ dispose(): void }>;

function mountTowerPortraitPreview(container: HTMLElement, entity: GameEntity): TowerPreviewController {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(190, 170, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xcce8f5, 0x26332b, 1.65));
  const key = new THREE.DirectionalLight(0xffe8bd, 3.1);
  key.position.set(-4, 7, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(entity.team === 'red' ? 0xff625b : 0x5bdcff, 1.5);
  rim.position.set(5, 4, -4);
  scene.add(rim);

  const clone = entity.root.clone(true);
  clone.position.set(0, 0, 0);
  clone.rotation.set(0, 0, 0);
  const remove: THREE.Object3D[] = [];
  clone.traverse(object => {
    if (object instanceof THREE.Sprite || object.name.includes('overhead') || object.name.includes('health-bar')) {
      remove.push(object);
      return;
    }
    if (object instanceof THREE.Mesh) {
      object.castShadow = false;
      object.receiveShadow = false;
    }
  });
  for (const object of remove) object.removeFromParent();
  clone.updateMatrixWorld(true);

  const initialBox = new THREE.Box3().setFromObject(clone);
  const center = initialBox.getCenter(new THREE.Vector3());
  const size = initialBox.getSize(new THREE.Vector3());
  clone.position.x -= center.x;
  clone.position.z -= center.z;
  clone.position.y -= initialBox.min.y;
  scene.add(clone);
  clone.updateMatrixWorld(true);

  const target = new THREE.Vector3(0, Math.max(0.7, size.y * 0.46), 0);
  const camera = new THREE.PerspectiveCamera(31, 190 / 170, 0.05, 100);
  const distance = Math.max(4.2, size.y * 1.28);
  camera.position.set(distance * 0.76, target.y + distance * 0.26, distance * 0.95);
  camera.lookAt(target);

  const weapon = clone.getObjectByName(`${entity.team}-tower-weapon`);
  const weaponBaseY = weapon?.position.y ?? 0;
  const start = performance.now();
  let frame = 0;
  let disposed = false;
  const animate = (now: number) => {
    if (disposed) return;
    const elapsed = (now - start) * 0.001;
    if (weapon) {
      weapon.rotation.y = elapsed * (entity.team === 'red' ? -0.34 : 0.34);
      weapon.position.y = weaponBaseY + Math.sin(elapsed * 1.55 + (entity.team === 'red' ? 0.8 : 0)) * 0.045;
    }
    renderer.render(scene, camera);
    frame = requestAnimationFrame(animate);
  };
  frame = requestAnimationFrame(animate);

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      clone.removeFromParent();
    },
  };
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
  let preview: TowerPreviewController | null = null;
  let previewEntityId = '';
  let disposed = false;

  const disposePreview = () => {
    preview?.dispose();
    preview = null;
    previewEntityId = '';
  };

  const render = (force = false) => {
    if (overlay && !overlay.isConnected) {
      overlay = null;
      lastSignature = '';
      disposePreview();
    }
    overlay ??= ensureOverlay();
    if (!overlay) return;

    const localHeroSelected = selected !== null && localHero !== null && selected === localHero;
    overlay.hidden = localHeroSelected;
    if (localHeroSelected) {
      disposePreview();
      overlay.replaceChildren();
      overlay.dataset.selectionKind = 'hero';
      overlay.dataset.selectionId = selected?.id ?? '';
      lastSignature = entitySignature(selected);
      return;
    }

    const signature = entitySignature(selected);
    if (!force && signature === lastSignature) return;
    lastSignature = signature;

    if (selected?.kind === 'tower') {
      const rebuilt = renderTowerEntity(overlay, selected);
      if (rebuilt || previewEntityId !== selected.id || !preview) {
        disposePreview();
        const previewHost = overlay.querySelector<HTMLElement>('[data-tower-preview]');
        if (previewHost) {
          preview = mountTowerPortraitPreview(previewHost, selected);
          previewEntityId = selected.id;
        }
      }
      return;
    }

    disposePreview();
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
    if (code !== 'KeyA' && code !== 'KeyQ' && code !== 'KeyW' && code !== 'KeyE' && code !== 'KeyR') return;
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
      disposePreview();
      activeBridgeCount = Math.max(0, activeBridgeCount - 1);
      if (activeBridgeCount === 0) overlay?.remove();
      overlay = null;
    },
  };
}
