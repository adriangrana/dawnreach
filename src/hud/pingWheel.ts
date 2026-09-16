import {
  getGameSettingsSnapshot,
  settingBindingMatchesEvent,
} from '../game/settings/gameSettings';
import { isGameMenuOpen } from './gameMenu';

export const DAWNREACH_PING_EVENT = 'dawnreach:ping';

export type PingType = 'attention' | 'danger' | 'assist' | 'on-my-way' | 'retreat' | 'missing' | 'attack';
type PingSurface = 'world' | 'minimap';

type PingDefinition = Readonly<{
  type: Exclude<PingType, 'attention'>;
  label: string;
  glyph: string;
  color: string;
  angle: number;
}>;

type ViewportPoint = Readonly<{ x: number; y: number }>;

type PingAnchor = Readonly<{
  surface: PingSurface;
  clientX: number;
  clientY: number;
  normalizedX: number;
  normalizedY: number;
  mapX: number;
  mapY: number;
}>;

export type DawnreachPingDetail = Readonly<{
  pingId: string;
  type: PingType;
  label: string;
  surface: PingSurface;
  clientX: number;
  clientY: number;
  normalizedX: number;
  normalizedY: number;
  mapX: number;
  mapY: number;
  playerId: string;
  team: 'dawn' | 'dusk';
  audience: 'all';
  createdAtMs: number;
}>;

const WHEEL_ID = 'dawnreach-ping-wheel';
const DEAD_ZONE = 40;
const MARKER_LIFETIME_MS = 3000;
const DIRECT_PING_COOLDOWN_MS = 280;
const PING_CHANNEL_NAME = 'dawnreach-match-pings-v1';

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

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
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

function readViewportPolygon(): readonly ViewportPoint[] | null {
  const polygon = document.querySelector<SVGPolygonElement>('.minimap-camera-viewport polygon');
  const raw = polygon?.getAttribute('points')?.trim();
  if (!raw) return null;

  const points = raw.split(/\s+/).map(token => {
    const [x, y] = token.split(',').map(Number);
    return { x, y };
  }).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));

  return points.length === 4 ? points : null;
}

function screenPointToMap(normalizedX: number, normalizedY: number) {
  const viewport = readViewportPolygon();
  if (!viewport) return null;
  const [topLeft, topRight, bottomRight, bottomLeft] = viewport;
  const u = clamp01(normalizedX);
  const v = clamp01(normalizedY);

  // The minimap viewport polygon is generated from the four main-camera corners. Bilinear
  // interpolation therefore converts a point on the screen into the same fixed minimap/map
  // coordinate system, independent of where the camera moves afterwards.
  const topX = topLeft.x + (topRight.x - topLeft.x) * u;
  const topY = topLeft.y + (topRight.y - topLeft.y) * u;
  const bottomX = bottomLeft.x + (bottomRight.x - bottomLeft.x) * u;
  const bottomY = bottomLeft.y + (bottomRight.y - bottomLeft.y) * u;
  return {
    x: clamp01((topX + (bottomX - topX) * v) / 100),
    y: clamp01((topY + (bottomY - topY) * v) / 100),
  };
}

function mapPointToScreen(mapX: number, mapY: number) {
  const viewport = readViewportPolygon();
  const world = document.querySelector<HTMLElement>('.game-canvas');
  const rect = world?.getBoundingClientRect();
  if (!viewport || !world || !rect) return null;

  const [topLeft, topRight, , bottomLeft] = viewport;
  const ax = topRight.x - topLeft.x;
  const ay = topRight.y - topLeft.y;
  const bx = bottomLeft.x - topLeft.x;
  const by = bottomLeft.y - topLeft.y;
  const cx = mapX * 100 - topLeft.x;
  const cy = mapY * 100 - topLeft.y;
  const determinant = ax * by - ay * bx;
  if (Math.abs(determinant) < 1e-5) return null;

  const u = (cx * by - cy * bx) / determinant;
  const v = (ax * cy - ay * cx) / determinant;
  return {
    visible: u >= -0.03 && u <= 1.03 && v >= -0.03 && v <= 1.03,
    clientX: rect.left + u * rect.width,
    clientY: rect.top + v * rect.height,
  };
}

function resolvePingAnchor(clientX: number, clientY: number): PingAnchor | null {
  const surface = surfaceAt(clientX, clientY);
  if (!surface) return null;

  const normalizedX = clamp01((clientX - surface.rect.left) / Math.max(1, surface.rect.width));
  const normalizedY = clamp01((clientY - surface.rect.top) / Math.max(1, surface.rect.height));
  const mapPoint = surface.surface === 'minimap'
    ? { x: normalizedX, y: normalizedY }
    : screenPointToMap(normalizedX, normalizedY);
  if (!mapPoint) return null;

  return {
    surface: surface.surface,
    clientX,
    clientY,
    normalizedX,
    normalizedY,
    mapX: mapPoint.x,
    mapY: mapPoint.y,
  };
}

function buildPingMarker(detail: DawnreachPingDetail, minimap: boolean) {
  const definition = pingDefinition(detail.type);
  const reduced = !Boolean(getGameSettingsSnapshot()['accessibility.visualPings']);
  const marker = document.createElement('div');
  marker.className = `dawnreach-ping-marker dawnreach-ping-marker--${detail.type}${minimap ? ' is-minimap' : ' is-world-map'}${reduced ? ' is-reduced' : ''}`;
  marker.dataset.pingId = detail.pingId;
  marker.style.setProperty('--ping-color', definition.color);
  marker.innerHTML = `<i>${definition.glyph}</i><span>${definition.label}</span>`;
  return marker;
}

function renderAnchoredPing(detail: DawnreachPingDetail) {
  const minimap = document.querySelector<HTMLElement>('.minimap-field');
  if (!minimap) return () => undefined;

  const minimapMarker = buildPingMarker(detail, true);
  minimapMarker.style.left = `${clamp01(detail.mapX) * 100}%`;
  minimapMarker.style.top = `${clamp01(detail.mapY) * 100}%`;
  minimap.appendChild(minimapMarker);

  const worldMarker = buildPingMarker(detail, false);
  document.body.appendChild(worldMarker);

  let animationFrame = 0;
  let disposed = false;
  const updateWorldMarker = () => {
    if (disposed) return;
    const projected = mapPointToScreen(detail.mapX, detail.mapY);
    if (!projected) {
      worldMarker.style.visibility = 'hidden';
    } else {
      worldMarker.style.visibility = projected.visible ? 'visible' : 'hidden';
      worldMarker.style.left = `${projected.clientX}px`;
      worldMarker.style.top = `${projected.clientY}px`;
    }
    animationFrame = requestAnimationFrame(updateWorldMarker);
  };
  updateWorldMarker();

  const expireTimer = window.setTimeout(() => {
    minimapMarker.classList.add('is-expiring');
    worldMarker.classList.add('is-expiring');
  }, MARKER_LIFETIME_MS - 420);
  const removeTimer = window.setTimeout(() => dispose(), MARKER_LIFETIME_MS);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(animationFrame);
    window.clearTimeout(expireTimer);
    window.clearTimeout(removeTimer);
    minimapMarker.remove();
    worldMarker.remove();
  };

  return dispose;
}

function createPingId(playerId: string, createdAtMs: number) {
  return `${playerId}:${Math.round(createdAtMs * 1000)}:${Math.random().toString(36).slice(2, 8)}`;
}

function publishPing(type: PingType, anchor: PingAnchor, channel: BroadcastChannel | null) {
  const definition = pingDefinition(type);
  const createdAtMs = performance.now();
  const detail: DawnreachPingDetail = {
    pingId: createPingId('local-player', createdAtMs),
    type,
    label: definition.label,
    surface: anchor.surface,
    clientX: anchor.clientX,
    clientY: anchor.clientY,
    normalizedX: anchor.normalizedX,
    normalizedY: anchor.normalizedY,
    mapX: anchor.mapX,
    mapY: anchor.mapY,
    playerId: 'local-player',
    team: 'dawn',
    audience: 'all',
    createdAtMs,
  };

  window.dispatchEvent(new CustomEvent<DawnreachPingDetail>(DAWNREACH_PING_EVENT, { detail }));
  // This mirrors pings to other Dawnreach views on the same origin. The event payload is also
  // deliberately transport-neutral so the future multiplayer server can replicate the exact
  // same detail to every remote client without changing the renderer.
  channel?.postMessage(detail);
  return true;
}

function isPingDetail(value: unknown): value is DawnreachPingDetail {
  if (!value || typeof value !== 'object') return false;
  const detail = value as Partial<DawnreachPingDetail>;
  return typeof detail.pingId === 'string'
    && typeof detail.type === 'string'
    && typeof detail.mapX === 'number'
    && typeof detail.mapY === 'number'
    && Number.isFinite(detail.mapX)
    && Number.isFinite(detail.mapY);
}

export function mountPingWheel() {
  let pointerX = window.innerWidth * 0.5;
  let pointerY = window.innerHeight * 0.5;
  let centerX = pointerX;
  let centerY = pointerY;
  let wheelAnchor: PingAnchor | null = null;
  let open = false;
  let selected: PingType = 'attention';
  let lastDirectPingAt = -Infinity;
  let root: HTMLDivElement | null = null;
  const activePingDisposers = new Map<string, () => void>();
  const renderedPingIds = new Set<string>();
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(PING_CHANNEL_NAME) : null;

  const blocked = () => isGameMenuOpen() || document.body.dataset.dawnreachMatchPaused === 'true';

  const ensureRoot = () => {
    if (root?.isConnected) return root;
    root = document.createElement('div');
    root.id = WHEEL_ID;
    root.className = 'dawnreach-ping-wheel';
    root.hidden = true;
    root.innerHTML = `
      <div class="dawnreach-ping-wheel__ring" aria-hidden="true"></div>
      <div class="dawnreach-ping-wheel__center" style="--ping-color:${ATTENTION.color}"><i aria-hidden="true"></i><span>ATENCIÓN</span></div>
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
    if (blocked()) return false;
    const anchor = resolvePingAnchor(pointerX, pointerY);
    if (!anchor) return false;

    // Lock the target at the exact map point under the cursor when G is pressed. From this
    // moment on the cursor is only a radial selector; moving it must never move the ping target.
    wheelAnchor = anchor;

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
    if (commit && wheelAnchor) publishPing(selected, wheelAnchor, channel);
    open = false;
    wheelAnchor = null;
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
      const anchor = resolvePingAnchor(pointerX, pointerY);
      if (anchor && publishPing('danger', anchor, channel)) lastDirectPingAt = performance.now();
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

  const onPing = (event: Event) => {
    const detail = (event as CustomEvent<DawnreachPingDetail>).detail;
    if (!isPingDetail(detail) || renderedPingIds.has(detail.pingId)) return;
    renderedPingIds.add(detail.pingId);
    const dispose = renderAnchoredPing(detail);
    activePingDisposers.set(detail.pingId, dispose);
    window.setTimeout(() => {
      activePingDisposers.delete(detail.pingId);
      renderedPingIds.delete(detail.pingId);
    }, MARKER_LIFETIME_MS + 250);
  };

  const onChannelMessage = (event: MessageEvent<unknown>) => {
    if (!isPingDetail(event.data)) return;
    window.dispatchEvent(new CustomEvent<DawnreachPingDetail>(DAWNREACH_PING_EVENT, { detail: event.data }));
  };

  const onBlur = () => closeWheel(false);

  document.body.dataset.dawnreachPingWheelOpen = 'false';
  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('contextmenu', onContextMenu, true);
  window.addEventListener(DAWNREACH_PING_EVENT, onPing as EventListener);
  window.addEventListener('blur', onBlur);
  if (channel) channel.onmessage = onChannelMessage;

  return () => {
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    window.removeEventListener('contextmenu', onContextMenu, true);
    window.removeEventListener(DAWNREACH_PING_EVENT, onPing as EventListener);
    window.removeEventListener('blur', onBlur);
    document.body.dataset.dawnreachPingWheelOpen = 'false';
    activePingDisposers.forEach(dispose => dispose());
    activePingDisposers.clear();
    renderedPingIds.clear();
    channel?.close();
    root?.remove();
    root = null;
  };
}
