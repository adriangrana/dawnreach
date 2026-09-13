import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

const EDGE_SCROLL_ZONE_PX = 14;
const CAMERA_PAN_WORLD_UNITS_PER_SECOND = 18;
const MAP_WORLD_WIDTH = 150;
const MAP_WORLD_HEIGHT = 125;
const MINIMAP_SELECTOR = '.minimap-live';
const MINIMAP_VIEWPORT_SELECTOR = '.minimap-camera-viewport polygon';
const GAME_CANVAS_SELECTOR = '.game-canvas';
const SYNTHETIC_POINTER_ID = 7331;

type ViewportFootprint = {
  centerX: number;
  centerY: number;
  halfWidth: number;
  halfHeight: number;
};

function isEditableTarget(target: EventTarget | null) {
  return target instanceof Element
    && Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'));
}

function parseViewportFootprint(): ViewportFootprint | null {
  const polygon = document.querySelector<SVGPolygonElement>(MINIMAP_VIEWPORT_SELECTOR);
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

function fallbackViewportCenter() {
  const minimap = document.querySelector<HTMLElement>(MINIMAP_SELECTOR);
  const hero = document.querySelector<HTMLElement>('.minimap-hero-icon');
  if (!minimap || !hero) return { x: 0.5, y: 0.5 };

  const minimapRect = minimap.getBoundingClientRect();
  const heroRect = hero.getBoundingClientRect();
  if (minimapRect.width <= 0 || minimapRect.height <= 0) return { x: 0.5, y: 0.5 };

  return {
    x: (heroRect.left + heroRect.width / 2 - minimapRect.left) / minimapRect.width,
    y: (heroRect.top + heroRect.height / 2 - minimapRect.top) / minimapRect.height,
  };
}

function cameraTargetingModeActive() {
  const canvas = document.querySelector<HTMLCanvasElement>(GAME_CANVAS_SELECTOR);
  return canvas?.style.cursor === 'crosshair';
}

function dispatchMinimapCameraTarget(normalizedX: number, normalizedY: number) {
  const minimap = document.querySelector<HTMLElement>(MINIMAP_SELECTOR);
  if (!minimap || cameraTargetingModeActive()) return false;

  const rect = minimap.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  const clientX = rect.left + normalizedX * rect.width;
  const clientY = rect.top + normalizedY * rect.height;
  minimap.dispatchEvent(new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    pointerId: SYNTHETIC_POINTER_ID,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: 1,
    clientX,
    clientY,
  }));
  return true;
}

export function mountGameCameraControls() {
  const pressedArrows = new Set<string>();
  let pointerX = window.innerWidth / 2;
  let pointerY = window.innerHeight / 2;
  let pointerSeen = false;
  let frameId = 0;
  let previousTime = performance.now();
  let lastCameraDispatch = -Infinity;
  let target: { x: number; y: number } | null = null;
  let disposed = false;

  const tauriWindow = isTauri() ? getCurrentWindow() : null;
  const setCursorGrab = async (grab: boolean) => {
    if (!tauriWindow || disposed) return;
    try {
      await tauriWindow.setCursorGrab(grab);
    } catch (error) {
      // Browser preview and unsupported platforms retain edge scrolling even if
      // native confinement is unavailable.
      console.warn(`[Dawnreach] Cursor ${grab ? 'grab' : 'release'} unavailable`, error);
    }
  };

  const onFocus = () => { void setCursorGrab(true); };
  const onBlur = () => {
    pressedArrows.clear();
    target = null;
    void setCursorGrab(false);
  };

  const onPointerMove = (event: PointerEvent) => {
    pointerX = event.clientX;
    pointerY = event.clientY;
    pointerSeen = true;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (isEditableTarget(event.target)) return;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.code)) return;
    pressedArrows.add(event.code);
    event.preventDefault();
  };

  const onKeyUp = (event: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.code)) return;
    pressedArrows.delete(event.code);
    event.preventDefault();
  };

  const getDirection = () => {
    let x = 0;
    let y = 0;

    if (pressedArrows.has('ArrowLeft')) x -= 1;
    if (pressedArrows.has('ArrowRight')) x += 1;
    if (pressedArrows.has('ArrowUp')) y -= 1;
    if (pressedArrows.has('ArrowDown')) y += 1;

    if (pointerSeen && document.hasFocus()) {
      if (pointerX <= EDGE_SCROLL_ZONE_PX) x -= 1;
      else if (pointerX >= window.innerWidth - EDGE_SCROLL_ZONE_PX) x += 1;

      if (pointerY <= EDGE_SCROLL_ZONE_PX) y -= 1;
      else if (pointerY >= window.innerHeight - EDGE_SCROLL_ZONE_PX) y += 1;
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

    const direction = getDirection();
    const moving = Math.abs(direction.x) > 0.001 || Math.abs(direction.y) > 0.001;

    if (!moving || cameraTargetingModeActive()) {
      target = null;
    } else {
      const footprint = parseViewportFootprint();
      if (!target) {
        const fallback = fallbackViewportCenter();
        target = footprint
          ? { x: footprint.centerX, y: footprint.centerY }
          : fallback;
      }

      const deltaX = direction.x * CAMERA_PAN_WORLD_UNITS_PER_SECOND * dt / MAP_WORLD_WIDTH;
      const deltaY = direction.y * CAMERA_PAN_WORLD_UNITS_PER_SECOND * dt / MAP_WORLD_HEIGHT;
      target.x += deltaX;
      target.y += deltaY;

      const halfWidth = footprint?.halfWidth ?? 0.08;
      const halfHeight = footprint?.halfHeight ?? 0.08;
      const padding = 0.006;
      target.x = Math.min(1 - halfWidth - padding, Math.max(halfWidth + padding, target.x));
      target.y = Math.min(1 - halfHeight - padding, Math.max(halfHeight + padding, target.y));

      if (time - lastCameraDispatch >= 24 && dispatchMinimapCameraTarget(target.x, target.y)) {
        lastCameraDispatch = time;
      }
    }

    frameId = requestAnimationFrame(frame);
  };

  window.addEventListener('focus', onFocus);
  window.addEventListener('blur', onBlur);
  window.addEventListener('pointermove', onPointerMove, { capture: true, passive: true });
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);

  void setCursorGrab(true);
  frameId = requestAnimationFrame(frame);

  return () => {
    disposed = true;
    cancelAnimationFrame(frameId);
    pressedArrows.clear();
    target = null;
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    if (tauriWindow) {
      void tauriWindow.setCursorGrab(false).catch(() => undefined);
    }
  };
}
