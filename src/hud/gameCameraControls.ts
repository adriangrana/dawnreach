import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  GAME_SETTINGS_CHANGED_EVENT,
  getGameSettingsSnapshot,
  settingBindingMatchesEvent,
  type GameSettings,
  type GameSettingsChangedDetail,
} from '../game/settings/gameSettings';
import { GAME_MENU_STATE_EVENT, isGameMenuOpen } from './gameMenu';

const MAP_WORLD_WIDTH = 150;
const MAP_WORLD_HEIGHT = 125;
const MINIMAP_SELECTOR = '.minimap-live';
const MINIMAP_HERO_SELECTOR = '.minimap-hero-icon';
const MINIMAP_VIEWPORT_SELECTOR = '.minimap-camera-viewport polygon';
const GAME_CANVAS_SELECTOR = '.game-canvas';
const SYNTHETIC_POINTER_ID = 7331;
const LAYOUT_CACHE_MS = 120;

type ViewportFootprint = {
  centerX: number;
  centerY: number;
  halfWidth: number;
  halfHeight: number;
};

type CachedLayout = {
  minimap: HTMLElement | null;
  minimapRect: DOMRect | null;
  hero: HTMLElement | null;
  polygon: SVGPolygonElement | null;
  footprint: ViewportFootprint | null;
  refreshedAt: number;
};

type CameraDirection = 'left' | 'right' | 'up' | 'down';

function isEditableTarget(target: EventTarget | null) {
  return target instanceof Element
    && Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'));
}

function parseViewportFootprint(polygon: SVGPolygonElement | null): ViewportFootprint | null {
  const rawPoints = polygon?.getAttribute('points')?.trim();
  if (!rawPoints) return null;

  const points = rawPoints
    .split(/\s+/)
    .map(pair => pair.split(',').map(Number))
    .filter((pair): pair is [number, number] => pair.length === 2 && pair.every(Number.isFinite));

  if (points.length < 3) return null;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let sumX = 0;
  let sumY = 0;

  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    sumX += x;
    sumY += y;
  }

  return {
    centerX: sumX / points.length / 100,
    centerY: sumY / points.length / 100,
    halfWidth: Math.max(0.01, (maxX - minX) / 200),
    halfHeight: Math.max(0.01, (maxY - minY) / 200),
  };
}

function cameraTargetingModeActive(canvas: HTMLCanvasElement | null) {
  return canvas?.style.cursor === 'crosshair';
}

function numericSetting(settings: GameSettings, key: string, fallback: number) {
  const value = Number(settings[key]);
  return Number.isFinite(value) ? value : fallback;
}

export function mountGameCameraControls() {
  const pressedDirections = new Set<CameraDirection>();
  let settings = getGameSettingsSnapshot();
  let pointerX = window.innerWidth / 2;
  let pointerY = window.innerHeight / 2;
  let pointerSeen = false;
  let frameId = 0;
  let previousTime = performance.now();
  let target: { x: number; y: number } | null = null;
  let initialHeroCenterPending = true;
  let recenterHeroOnNextFrame = false;
  let disposed = false;
  let gameCanvas: HTMLCanvasElement | null = null;
  let layout: CachedLayout = {
    minimap: null,
    minimapRect: null,
    hero: null,
    polygon: null,
    footprint: null,
    refreshedAt: -Infinity,
  };

  const tauriWindow = isTauri() ? getCurrentWindow() : null;
  const setCursorGrab = async (grab: boolean) => {
    if (!tauriWindow || disposed) return;
    const shouldGrab = grab && settings['gameplay.cursorConfine'] !== false;
    try {
      await tauriWindow.setCursorGrab(shouldGrab);
    } catch (error) {
      console.warn(`[Dawnreach] Cursor ${shouldGrab ? 'grab' : 'release'} unavailable`, error);
    }
  };

  const refreshLayout = (time: number, force = false) => {
    if (!force && time - layout.refreshedAt < LAYOUT_CACHE_MS) return;
    const minimap = document.querySelector<HTMLElement>(MINIMAP_SELECTOR);
    const hero = document.querySelector<HTMLElement>(MINIMAP_HERO_SELECTOR);
    const polygon = document.querySelector<SVGPolygonElement>(MINIMAP_VIEWPORT_SELECTOR);
    layout = {
      minimap,
      minimapRect: minimap?.getBoundingClientRect() ?? null,
      hero,
      polygon,
      footprint: parseViewportFootprint(polygon),
      refreshedAt: time,
    };
    gameCanvas = document.querySelector<HTMLCanvasElement>(GAME_CANVAS_SELECTOR);
  };

  const fallbackViewportCenter = () => {
    const { minimapRect, hero } = layout;
    if (!minimapRect || !hero || minimapRect.width <= 0 || minimapRect.height <= 0) {
      return { x: 0.5, y: 0.5 };
    }
    const heroRect = hero.getBoundingClientRect();
    return {
      x: (heroRect.left + heroRect.width / 2 - minimapRect.left) / minimapRect.width,
      y: (heroRect.top + heroRect.height / 2 - minimapRect.top) / minimapRect.height,
    };
  };

  const heroMinimapPosition = () => {
    const { minimapRect, hero } = layout;
    if (!minimapRect || !hero || minimapRect.width <= 0 || minimapRect.height <= 0) return null;
    const heroRect = hero.getBoundingClientRect();
    if (heroRect.width <= 0 || heroRect.height <= 0) return null;
    return {
      x: (heroRect.left + heroRect.width / 2 - minimapRect.left) / minimapRect.width,
      y: (heroRect.top + heroRect.height / 2 - minimapRect.top) / minimapRect.height,
    };
  };

  const dispatchMinimapCameraTarget = (normalizedX: number, normalizedY: number) => {
    const { minimap, minimapRect } = layout;
    if (!minimap || !minimapRect || cameraTargetingModeActive(gameCanvas) || isGameMenuOpen()) return false;
    if (minimapRect.width <= 0 || minimapRect.height <= 0) return false;

    minimap.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      pointerId: SYNTHETIC_POINTER_ID,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: minimapRect.left + normalizedX * minimapRect.width,
      clientY: minimapRect.top + normalizedY * minimapRect.height,
    }));
    return true;
  };

  const dispatchHeroCameraTarget = () => {
    const hero = heroMinimapPosition();
    return hero ? dispatchMinimapCameraTarget(hero.x, hero.y) : false;
  };

  const clearMotion = () => {
    pressedDirections.clear();
    target = null;
    recenterHeroOnNextFrame = false;
  };

  const onFocus = () => { void setCursorGrab(!isGameMenuOpen()); };
  const onBlur = () => {
    clearMotion();
    void setCursorGrab(false);
  };

  const onGameMenuState = (event: Event) => {
    const menuOpen = Boolean((event as CustomEvent<{ open?: boolean }>).detail?.open);
    clearMotion();
    // gameMenu also adjusts cursor grab after dispatching this event. Re-apply the gameplay
    // preference in a microtask so "Confinar cursor" remains authoritative after F10 closes.
    queueMicrotask(() => { void setCursorGrab(!menuOpen); });
  };

  const onSettingsChanged = (event: Event) => {
    settings = (event as CustomEvent<GameSettingsChangedDetail>).detail?.settings ?? getGameSettingsSnapshot();
    clearMotion();
    void setCursorGrab(!isGameMenuOpen());
  };

  const onPointerMove = (event: PointerEvent) => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    pointerSeen = true;
  };

  const directionForEvent = (event: KeyboardEvent): CameraDirection | null => {
    if (settingBindingMatchesEvent(event, 'controls.cameraLeft', settings)) return 'left';
    if (settingBindingMatchesEvent(event, 'controls.cameraRight', settings)) return 'right';
    if (settingBindingMatchesEvent(event, 'controls.cameraUp', settings)) return 'up';
    if (settingBindingMatchesEvent(event, 'controls.cameraDown', settings)) return 'down';
    return null;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (isGameMenuOpen() || isEditableTarget(event.target)) return;

    if (settingBindingMatchesEvent(event, 'controls.centerHero', settings) && !event.repeat) {
      recenterHeroOnNextFrame = true;
      event.preventDefault();
      return;
    }

    if (settings['camera.keyboardPan'] === false) return;
    const direction = directionForEvent(event);
    if (!direction) return;
    pressedDirections.add(direction);
    event.preventDefault();
  };

  const onKeyUp = (event: KeyboardEvent) => {
    const direction = directionForEvent(event);
    if (!direction) return;
    pressedDirections.delete(direction);
    if (!isGameMenuOpen()) event.preventDefault();
  };

  const getDirection = () => {
    if (isGameMenuOpen()) return { x: 0, y: 0 };

    let x = 0;
    let y = 0;

    if (settings['camera.keyboardPan'] !== false) {
      if (pressedDirections.has('left')) x -= 1;
      if (pressedDirections.has('right')) x += 1;
      if (pressedDirections.has('up')) y -= 1;
      if (pressedDirections.has('down')) y += 1;
    }

    if (settings['camera.edgePan'] !== false && pointerSeen && document.hasFocus()) {
      const edgeSize = Math.max(2, numericSetting(settings, 'camera.edgeSize', 14));
      if (pointerX <= edgeSize) x -= 1;
      else if (pointerX >= window.innerWidth - edgeSize) x += 1;

      if (pointerY <= edgeSize) y -= 1;
      else if (pointerY >= window.innerHeight - edgeSize) y += 1;
    }

    const length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
    }
    return { x, y };
  };

  const frame = (time: number) => {
    if (disposed) return;
    const dt = Math.min(0.05, Math.max(0, (time - previousTime) / 1000));
    previousTime = time;
    refreshLayout(time);

    if (!isGameMenuOpen() && initialHeroCenterPending && gameCanvas?.dataset.dawnreachReady === 'true' && dispatchHeroCameraTarget()) {
      initialHeroCenterPending = false;
      target = null;
    }

    if (!isGameMenuOpen() && recenterHeroOnNextFrame && dispatchHeroCameraTarget()) {
      recenterHeroOnNextFrame = false;
      target = null;
    }

    const direction = getDirection();
    const moving = Math.abs(direction.x) > 0.001 || Math.abs(direction.y) > 0.001;

    if (!moving || cameraTargetingModeActive(gameCanvas) || isGameMenuOpen()) {
      target = null;
    } else {
      const footprint = layout.footprint;
      if (!target) {
        const fallback = fallbackViewportCenter();
        target = footprint
          ? { x: footprint.centerX, y: footprint.centerY }
          : fallback;
      }

      const panSpeed = Math.max(1, numericSetting(settings, 'camera.panSpeed', 18));
      target.x += direction.x * panSpeed * dt / MAP_WORLD_WIDTH;
      target.y += direction.y * panSpeed * dt / MAP_WORLD_HEIGHT;

      const halfWidth = footprint?.halfWidth ?? 0.08;
      const halfHeight = footprint?.halfHeight ?? 0.08;
      const padding = 0.006;
      target.x = Math.min(1 - halfWidth - padding, Math.max(halfWidth + padding, target.x));
      target.y = Math.min(1 - halfHeight - padding, Math.max(halfHeight + padding, target.y));

      dispatchMinimapCameraTarget(target.x, target.y);
    }

    frameId = requestAnimationFrame(frame);
  };

  window.addEventListener('focus', onFocus);
  window.addEventListener('blur', onBlur);
  window.addEventListener(GAME_MENU_STATE_EVENT, onGameMenuState as EventListener);
  window.addEventListener(GAME_SETTINGS_CHANGED_EVENT, onSettingsChanged as EventListener);
  window.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);

  void setCursorGrab(!isGameMenuOpen());
  refreshLayout(performance.now(), true);
  frameId = requestAnimationFrame(frame);

  return () => {
    disposed = true;
    cancelAnimationFrame(frameId);
    clearMotion();
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener(GAME_MENU_STATE_EVENT, onGameMenuState as EventListener);
    window.removeEventListener(GAME_SETTINGS_CHANGED_EVENT, onSettingsChanged as EventListener);
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    if (tauriWindow) void tauriWindow.setCursorGrab(false).catch(() => undefined);
  };
}
