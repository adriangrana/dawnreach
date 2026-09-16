import {
  GAME_SETTINGS_CHANGED_EVENT,
  getGameSettingsSnapshot,
  type GameSettingsChangedDetail,
} from '../game/settings/gameSettings';

const MINIMAP_SELECTOR = '.minimap-live';

export function mountMinimapDragCamera() {
  let settings = getGameSettingsSnapshot();
  let activePointerId: number | null = null;
  let minimap: HTMLElement | null = null;
  let pendingPointer: PointerEvent | null = null;
  let animationFrame = 0;

  const stopDragging = () => {
    activePointerId = null;
    minimap = null;
    pendingPointer = null;
    if (animationFrame) {
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
  };

  const dispatchCameraFocus = () => {
    animationFrame = 0;
    const event = pendingPointer;
    pendingPointer = null;
    if (!event || !minimap || activePointerId === null || settings['camera.minimapDrag'] === false) return;

    const rect = minimap.getBoundingClientRect();
    const inside = event.clientX >= rect.left
      && event.clientX <= rect.right
      && event.clientY >= rect.top
      && event.clientY <= rect.bottom;
    if (!inside) return;

    // The game already owns minimap click-to-focus behaviour. Reuse that exact projection
    // logic while dragging. Synthetic drag samples bypass the trusted-event click blocker below
    // so dragging can stay enabled independently from one-click camera jumps.
    minimap.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      pointerId: activePointerId,
      pointerType: event.pointerType,
      clientX: event.clientX,
      clientY: event.clientY,
      button: 0,
      buttons: 1,
    }));
  };

  const onPointerDown = (event: PointerEvent) => {
    if (!event.isTrusted || event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;

    const candidate = target.closest<HTMLElement>(MINIMAP_SELECTOR);
    if (!candidate) return;

    // Crosshair means the game has armed an attack command. In that state the left button
    // belongs to targeting, not camera navigation, regardless of camera settings.
    if (candidate.style.cursor === 'crosshair' || getComputedStyle(candidate).cursor === 'crosshair') return;

    if (settings['camera.minimapDrag'] !== false) {
      activePointerId = event.pointerId;
      minimap = candidate;
    }

    if (settings['camera.minimapClick'] === false) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (settings['camera.minimapDrag'] === false) {
      stopDragging();
      return;
    }
    if (activePointerId === null || event.pointerId !== activePointerId) return;
    if ((event.buttons & 1) === 0) {
      stopDragging();
      return;
    }
    if (!minimap) return;

    if (minimap.style.cursor === 'crosshair' || getComputedStyle(minimap).cursor === 'crosshair') {
      stopDragging();
      return;
    }

    pendingPointer = event;
    if (!animationFrame) animationFrame = requestAnimationFrame(dispatchCameraFocus);
  };

  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerId === activePointerId) stopDragging();
  };

  const onSettingsChanged = (event: Event) => {
    settings = (event as CustomEvent<GameSettingsChangedDetail>).detail?.settings ?? getGameSettingsSnapshot();
    if (settings['camera.minimapDrag'] === false) stopDragging();
  };

  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointermove', onPointerMove, true);
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('pointercancel', onPointerUp, true);
  window.addEventListener('blur', stopDragging);
  window.addEventListener(GAME_SETTINGS_CHANGED_EVENT, onSettingsChanged as EventListener);

  return () => {
    stopDragging();
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('pointermove', onPointerMove, true);
    document.removeEventListener('pointerup', onPointerUp, true);
    document.removeEventListener('pointercancel', onPointerUp, true);
    window.removeEventListener('blur', stopDragging);
    window.removeEventListener(GAME_SETTINGS_CHANGED_EVENT, onSettingsChanged as EventListener);
  };
}
