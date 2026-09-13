import type { GameEntity, GameEntityKind, TeamId } from './gameEntities';

const STYLE_ID = 'dawnreach-selection-hud-style';
const OVERLAY_CLASS = 'selected-entity-hud-overlay';

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
      display: grid;
      grid-template-columns: 29% 45% 26%;
      overflow: hidden;
      pointer-events: auto;
      color: #edf5f4;
      font-family: Inter, ui-sans-serif, system-ui, sans-serif;
      background:
        linear-gradient(180deg, rgba(35,44,46,.985), rgba(7,12,16,.99) 24%),
        #0b1014;
      text-shadow: 0 1px 2px rgba(0,0,0,.9);
    }
    .${OVERLAY_CLASS}[hidden] { display: none !important; }
    .selected-entity-hud__identity,
    .selected-entity-hud__combat,
    .selected-entity-hud__details {
      min-width: 0;
      padding: 12px;
    }
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
      background:
        radial-gradient(circle at 50% 35%, color-mix(in srgb, var(--selection-accent) 28%, transparent), transparent 55%),
        linear-gradient(145deg, #243039, #0b1114 72%);
      clip-path: polygon(10% 0,90% 0,100% 10%,96% 100%,4% 100%,0 10%);
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
      letter-spacing: .03em;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .selected-entity-hud__identity-text > span {
      display: block;
      margin-top: 3px;
      color: #8fa29d;
      font-size: 9px;
      letter-spacing: .09em;
    }
    .selected-entity-hud__identity-stats {
      display: grid;
      gap: 5px;
      margin-top: 12px;
      color: #bdc9c5;
      font-size: 10px;
    }
    .selected-entity-hud__identity-stats b { color: #eef4ef; font-weight: 700; }
    .selected-entity-hud__combat {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 12px;
    }
    .selected-entity-hud__stat-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0,1fr));
      gap: 7px;
    }
    .selected-entity-hud__stat {
      min-width: 0;
      min-height: 64px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      border: 1px solid rgba(214,192,132,.23);
      background: linear-gradient(145deg, rgba(35,48,56,.94), rgba(9,14,18,.96));
      box-shadow: inset 0 0 12px rgba(0,0,0,.3);
    }
    .selected-entity-hud__stat span {
      color: #8fa29d;
      font-size: 8px;
      letter-spacing: .09em;
      text-transform: uppercase;
    }
    .selected-entity-hud__stat strong {
      margin-top: 5px;
      color: #f2e8c8;
      font-size: 15px;
      font-variant-numeric: tabular-nums;
    }
    .selected-entity-hud__health {
      position: relative;
      height: 16px;
      overflow: hidden;
      border: 1px solid rgba(0,0,0,.78);
      background: rgba(0,0,0,.68);
    }
    .selected-entity-hud__health > i {
      position: absolute;
      inset: 0 auto 0 0;
      display: block;
      background: linear-gradient(90deg, #159742, #55d83d);
    }
    .selected-entity-hud__health > b {
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      color: #f1f5ef;
      font-size: 9px;
      font-style: normal;
      font-variant-numeric: tabular-nums;
    }
    .selected-entity-hud__details {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 8px;
    }
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
      letter-spacing: .05em;
      text-transform: uppercase;
    }
    .selected-entity-hud__detail-row b {
      overflow: hidden;
      color: #dfd4ad;
      font-size: 10px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .selected-entity-hud__empty {
      grid-column: 1 / -1;
      display: grid;
      place-items: center;
      color: #899994;
      font-family: Georgia, serif;
      font-size: 16px;
      letter-spacing: .06em;
      text-transform: uppercase;
    }
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
  return [
    entity.id,
    entity.displayName,
    entity.kind,
    entity.team,
    entity.currentHp,
    entity.maxHp,
    entity.currentResource,
    entity.maxResource,
    entity.level,
    entity.attackRange,
    entity.visionRadius,
    entity.alive,
    entity.revealed,
  ].join('|');
}

function renderEntity(overlay: HTMLElement, entity: GameEntity | null, localHero: GameEntity | null) {
  const localHeroSelected = entity !== null && localHero !== null && entity === localHero;
  overlay.hidden = localHeroSelected;
  if (localHeroSelected) {
    overlay.replaceChildren();
    return;
  }

  if (!entity) {
    overlay.style.removeProperty('--selection-accent');
    overlay.innerHTML = '<div class="selected-entity-hud__empty">Sin selección</div>';
    return;
  }

  const accent = teamAccent(entity.team);
  overlay.style.setProperty('--selection-accent', accent);
  const hpFraction = entity.maxHp > 0 ? Math.max(0, Math.min(1, entity.currentHp / entity.maxHp)) : 0;
  const hpText = entity.maxHp > 0
    ? `${Math.floor(entity.currentHp)} / ${Math.floor(entity.maxHp)}`
    : '—';
  const resourceText = entity.maxResource > 0
    ? `${Math.floor(entity.currentResource)} / ${Math.floor(entity.maxResource)}`
    : '—';
  const levelText = entity.kind === 'hero' || entity.level > 1 ? String(entity.level) : '—';

  overlay.innerHTML = `
    <div class="selected-entity-hud__identity">
      <div class="selected-entity-hud__portrait">
        <span class="selected-entity-hud__glyph">${kindGlyph(entity.kind)}</span>
        <i class="selected-entity-hud__team-dot"></i>
      </div>
      <div class="selected-entity-hud__identity-text">
        <strong>${entity.displayName}</strong>
        <span>${kindLabel(entity.kind)} · ${teamLabel(entity.team)}</span>
        <div class="selected-entity-hud__identity-stats">
          <span>Estado <b>${entity.alive ? 'VIVO' : 'CAÍDO'}</b></span>
          <span>Nivel <b>${levelText}</b></span>
          <span>Recurso <b>${resourceText}</b></span>
        </div>
      </div>
    </div>
    <div class="selected-entity-hud__combat">
      <div class="selected-entity-hud__stat-grid">
        <div class="selected-entity-hud__stat"><span>Vida</span><strong>${hpText}</strong></div>
        <div class="selected-entity-hud__stat"><span>Rango ATQ</span><strong>${entity.attackRange > 0 ? formatNumber(entity.attackRange, 1) : '—'}</strong></div>
        <div class="selected-entity-hud__stat"><span>Visión</span><strong>${entity.visionRadius > 0 ? formatNumber(entity.visionRadius, 1) : '—'}</strong></div>
        <div class="selected-entity-hud__stat"><span>Equipo</span><strong style="color:${accent}">${teamLabel(entity.team)}</strong></div>
      </div>
      <div class="selected-entity-hud__health">
        <i style="width:${hpFraction * 100}%"></i>
        <b>${entity.maxHp > 0 ? hpText : 'Sin barra de vida'}</b>
      </div>
    </div>
    <div class="selected-entity-hud__details">
      <div class="selected-entity-hud__detail-row"><span>Tipo</span><b>${kindLabel(entity.kind)}</b></div>
      <div class="selected-entity-hud__detail-row"><span>Interacción</span><b>${entity.interaction}</b></div>
      <div class="selected-entity-hud__detail-row"><span>Selección</span><b>${entity.selectable ? 'SÍ' : 'NO'}</b></div>
      <div class="selected-entity-hud__detail-row"><span>Control</span><b>${entity === localHero ? 'PROPIO' : 'INSPECCIÓN'}</b></div>
    </div>
  `;
}

export type SelectionHudBridge = Readonly<{
  setSelection(entity: GameEntity | null): void;
  refresh(entity: GameEntity | null): void;
  isLocalHeroSelected(): boolean;
  dispose(): void;
}>;

export function createSelectionHudBridge(localHero: GameEntity | null): SelectionHudBridge {
  let selected: GameEntity | null = null;
  let lastSignature = '';
  let overlay = ensureOverlay();

  const render = (force = false) => {
    overlay ??= ensureOverlay();
    if (!overlay) return;
    const signature = entitySignature(selected);
    if (!force && signature === lastSignature) return;
    lastSignature = signature;
    renderEntity(overlay, selected, localHero);
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
      selected = entity;
      render(true);
    },
    refresh(entity) {
      selected = entity;
      render(false);
    },
    isLocalHeroSelected: () => selected !== null && selected === localHero && localHero.alive,
    dispose() {
      window.removeEventListener('pointerdown', onPointerDownCapture, true);
      window.removeEventListener('keydown', onKeyDownCapture, true);
      overlay?.remove();
      overlay = null;
    },
  };
}
