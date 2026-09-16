import {
  getGameSettingsSnapshot,
  settingBindingMatchesEvent,
} from '../game/settings/gameSettings';
import { isGameMenuOpen } from './gameMenu';

export const DAWNREACH_PING_EVENT = 'dawnreach:ping';

type PingType = 'attention' | 'danger' | 'assist' | 'on-my-way' | 'retreat' | 'missing' | 'attack';
type PingSurface = 'world' | 'minimap';

type PingDefinition = Readonly<{
  type: Exclude<PingType, 'attention'>;
  label: string;
  glyph: string;
  color: string;
  angle: number;
}>;

export type DawnreachPingDetail = Readonly<{
  type: PingType;
  label: string;
  surface: PingSurface;
  clientX: number;
  clientY: number;
  normalizedX: number;
  normalizedY: number;
  playerId: string;
  team: 'dawn';
  createdAtMs: number;
}>;

const WHEEL_ID = 'dawnreach-ping-wheel';
const DEAD_ZONE = 38;
const MARKER_LIFETIME_MS = 2300;
const DIRECT_PING_COOLDOWN_MS = 280;

const PINGS: readonly PingDefinition[] = [
  { type: 'danger', label: 'PELIGRO', glyph: '!', color: '#ff625f', angle: -90 },
  { type: 'assist', label: 'AYUDA', glyph: '+', color: '#f4c96b', angle: -30 },
  { type: 'on-my-way', label: 'EN CAMINO', glyph: '➜', color: '#61cfff', angle: 30 },
  { type: 'retreat', label: 'RETIRADA', glyph: '↶', color: '#ff9b57', angle: 90 },
  { type: 'missing', label: 'FALTA ENEMIGO', glyph: '?', color: '#c58bff', angle: 150 },
  { type: 'attack', label: 'ATACAR', glyph: '◆', color: '#7fe5d0', angle: 210 },
];

const ATTENTION = { type: 'attention' as const, label: 'ATENCIÓN', glyph: '•', color: '#7adfff' };

function isEditableTarget(target: EventTarget | null) {
  return target instanceof Element
    && Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'));
}

function pingDefinition(type: PingType) {
  return type === 'attention' ? ATTENTION : PINGS.find(candidate => candidate.type === type) ?? ATTENTION;
}

function normalizeAngle(degrees: number) {
  let value = degrees % 360;
  if (value < -180) value += 360;
  if (value >= 180) value -= 360;
  return value;
}

function angularDistance(a: number, b: number) {
  return Math.abs(normalizeAngle(a - b));
}

function surfaceAt(clientX: number, clientY: number) {
  const minimap = document.querySelector<HTMLElement>('.minimap-field');
  const world = document.querySelector<HTMLElement>('.game-canvas');
  const minimapRect = minimap?.getBoundingClientRect();
  const worldRect = world?.getBoundingClientRect();

  if (minimap && minimapRect
    && clientX >= minimapRect.left && clientX <= minimapRect.right
    && clientY >= minimapRect.top && clientY <= minimapRect.bottom) {
    return {
      surface: 'minimap' as const,
      element: minimap,
      rect: minimapRect,
    };
  }

  if (world && worldRect
    && clientX >= worldRect.left && clientX <= worldRect.right
    && clientY >= worldRect.top && clientY <= worldRect.bottom) {
    return {
      surface: 'world' as const,
      element: world,
      rect: worldRect,
    };
  }

  return null;
}

function renderPingMarker(detail: DawnreachPingDetail) {
  const definition = pingDefinition(detail.type);
  const reduced = !Boolean(getGameSettingsSnapshot()['accessibility.visualPings']);
  const marker = document.createElement('div');
  marker.className = `dawnreach-ping-marker dawnreach-ping-marker--${detail.type}${reduced ? ' is-reduced' : ''}`;
  marker.style.setProperty('--ping-color', definition.color);
  marker.innerHTML = `<i>${definition.glyph}</i><span>${definition.label}</span>`;

  if (detail.surface === 'minimap') {
    const minimap = document.querySelector<HTMLElement>('.minimap-field');
    if (!minimap) return;
    marker.classList.add('is-minimap');
    marker.style.left = `${detail.normalizedX * 100}%`;
    marker.style.top = `${detail.normalizedY * 100}%`;
    minimap.appendChild(marker);
  } else {
    marker.style.left = `${detail.clientX}px`;
    marker.style.top = `${detail.clientY}px`;
    document.body.appendChild(marker);
  }

  window.setTimeout(() => marker.classList.add('is-expiring'), MARKER_LIFETIME_MS - 420);
  window.setTimeout(() => marker.remove(), MARKER_LIFETIME_MS);
}

function publishPing(type: PingType, clientX: number, clientY: number) {
  const surface = surfaceAt(clientX, clientY);
  if (!surface) return false;
  const definition = pingDefinition(type);
  const normalizedX = Math.min(1, Math.max(0, (clientX - surface.rect.left) / Math.max(1, surface.rect.width)));
  const normalizedY = Math.min(1, Math.max(0, (clientY - surface.rect.top) / Math.max(1, surface.rect.height)));
  const detail: DawnreachPingDetail = {
    type,
    label: definition.label,
    surface: surface.surface,
    clientX,
    clientY,
    normalizedX,
    normalizedY,
    playerId: 'local-player',
    team: 'dawn',
    createdAtMs: performance.now(),
  };
  renderPingMarker(detail);
  window.dispatchEvent(new CustomEvent<DawnreachPingDetail>(DAWNREACH_PING_EVENT, { detail }));
  return true;
}

export function mountPingWheel() {
  let pointerX = window.innerWidth * 0.5;
  let pointerY = window.innerHeight * 0.5;
  let centerX = pointerX;
  let centerY = pointerY;
  let open = false;
  let selected: PingType = 'attention';
  let lastDirectPingAt = -Infinity;
  let root: HTMLDivElement | null = null;

  const blocked = () => isGameMenuOpen() || document.body.dataset.dawnreachMatchPaused === 'true';

  const ensureRoot = () => {
    if (root?.isConnected) return root;
    root = document.createElement('div');
    root.id = WHEEL_ID;
    root.className = 'dawnreach-ping-wheel';
    root.hidden = true;
    root.innerHTML = `
      <div class="dawnreach-ping-wheel__ring" aria-hidden="true"></div>
      <div class="dawnreach-ping-wheel__center"><i>•</i><span>ATENCIÓN</span></div>
      ${PINGS.map(ping => `
        <div class="dawnreach-ping-wheel__item" data-ping-type="${ping.type}"
          style="--angle:${ping.angle}deg;--ping-color:${ping.color}">
          <i>${ping.glyph}</i><span>${ping.label}</span>
        </div>`).join('')}`;
    document.body.appendChild(root);
    return root;
  };

  const refreshSelection = () => {
    if (!open || !root) return;
    const dx = pointerX - centerX;
    const dy = pointerY - centerY;
    const distance = Math.hypot(dx, dy);
    if (distance < DEAD_ZONE) selected = 'attention';
    else {
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      let best = PINGS[0];
      let bestDistance = Infinity;
      for (const candidate of PINGS) {
        const distanceToSector = angularDistance(angle, candidate.angle);
        if (distanceToSector < bestDistance) {
          best = candidate;
          bestDistance = distanceToSector;
        }
      }
      selected = best.type;
    }

    root.dataset.selectedPing = selected;
    root.querySelectorAll<HTMLElement>('[data-ping-type]').forEach(item => {
      item.classList.toggle('is-selected', item.dataset.pingType === selected);
    });
    root.querySelector<HTMLElement>('.dawnreach-ping-wheel__center')?.classList.toggle('is-selected', selected === 'attention');
  };

  const openWheel = () => {
    const surface = surfaceAt(pointerX, pointerY);
    if (!surface || blocked()) return false;
    const wheel = ensureRoot();
    centerX = Math.min(window.innerWidth - 150, Math.max(150, pointerX));
    centerY = Math.min(window.innerHeight - 150, Math.max(150, pointerY));
    selected = 'attention';
    open = true;
    wheel.hidden = false;
    wheel.classList.add('is-open');
    wheel.style.left = `${centerX}px`;
    wheel.style.top = `${centerY}px`;
    document.body.dataset.dawnreachPingWheelOpen = 'true';
    refreshSelection();
    return true;
  };

  const closeWheel = (commit: boolean) => {
    if (!open) return;
    if (commit) publishPing(selected, pointerX, pointerY);
    open = false;
    document.body.dataset.dawnreachPingWheelOpen = 'false';
    root?.classList.remove('is-open');
    if (root) root.hidden = true;
  };

  const onPointerMove = (event: PointerEvent) => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    refreshSelection();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || isEditableTarget(event.target) || blocked()) return;
    const settings = getGameSettingsSnapshot();

    if (settingBindingMatchesEvent(event, 'controls.pingWheel', settings)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) openWheel();
      return;
    }

    if (settingBindingMatchesEvent(event, 'controls.dangerPing', settings)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat || performance.now() - lastDirectPingAt < DIRECT_PING_COOLDOWN_MS) return;
      if (publishPing('danger', pointerX, pointerY)) lastDirectPingAt = performance.now();
      return;
    }

    if (open && event.code === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      closeWheel(false);
    }
  };

  const onKeyUp = (event: KeyboardEvent) => {
    if (!open) return;
    const settings = getGameSettingsSnapshot();
    if (!settingBindingMatchesEvent(event, 'controls.pingWheel', settings)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeWheel(true);
  };

  const onContextMenu = (event: MouseEvent) => {
    if (!open) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const onBlur = () => closeWheel(false);

  document.body.dataset.dawnreachPingWheelOpen = 'false';
  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('contextmenu', onContextMenu, true);
  window.addEventListener('blur', onBlur);

  return () => {
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('contextmenu', onContextMenu, true);
    window.removeEventListener('blur', onBlur);
    document.body.dataset.dawnreachPingWheelOpen = 'false';
    root?.remove();
    root = null;
  };
}
