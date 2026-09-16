import {
  GAME_SETTINGS_CHANGED_EVENT,
  getGameSettingsSnapshot,
  settingBindingMatchesEvent,
  type GameSettings,
  type GameSettingsChangedDetail,
} from '../game/settings/gameSettings';

const SELECTION_OVERLAY_SELECTOR = '.selected-entity-hud-overlay';
const LOCAL_HERO_ENTITY_ID = 'blue-hero-alden';

function localHeroIsSelected() {
  const overlay = document.querySelector<HTMLElement>(SELECTION_OVERLAY_SELECTOR);
  return overlay?.dataset.selectionKind === 'hero'
    && overlay.dataset.selectionId === LOCAL_HERO_ENTITY_ID;
}

export function mountHeroFunctionKeyControls() {
  let settings: GameSettings = getGameSettingsSnapshot();
  let suppressSyntheticCameraFocus = false;
  let clearSuppressionTimer = 0;
  let dispatchingMappedF1 = false;

  const clearSuppression = () => {
    suppressSyntheticCameraFocus = false;
    if (clearSuppressionTimer) {
      window.clearTimeout(clearSuppressionTimer);
      clearSuppressionTimer = 0;
    }
  };

  const primeSelectionSuppression = () => {
    clearSuppression();
    suppressSyntheticCameraFocus = !localHeroIsSelected();
    if (suppressSyntheticCameraFocus) {
      clearSuppressionTimer = window.setTimeout(() => {
        suppressSyntheticCameraFocus = false;
        clearSuppressionTimer = 0;
      }, 0);
    }
  };

  const onKeyDownCapture = (event: KeyboardEvent) => {
    if (dispatchingMappedF1 && event.code === 'F1') return;

    if (settingBindingMatchesEvent(event, 'controls.selectHero', settings)) {
      if (event.repeat) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      // Snapshot the actual selected entity before the game's own selection handler runs.
      // The first selection press selects Alden without moving the camera; later presses may
      // recenter him. Custom bindings are translated to the engine's legacy F1 command so the
      // underlying selection logic remains single-sourced.
      primeSelectionSuppression();
      if (event.code !== 'F1' || event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        dispatchingMappedF1 = true;
        window.dispatchEvent(new KeyboardEvent('keydown', {
          code: 'F1',
          key: 'F1',
          bubbles: true,
          cancelable: true,
        }));
        dispatchingMappedF1 = false;
      }
      return;
    }

    // Once F1 is remapped it must stop acting as a hidden second binding. Synthetic F1 events
    // emitted above are explicitly exempt while dispatchingMappedF1 is true.
    if (event.code === 'F1') {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    if (
      event.code !== 'Space'
      || !suppressSyntheticCameraFocus
      || event.isTrusted
    ) return;

    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const onSettingsChanged = (event: Event) => {
    settings = (event as CustomEvent<GameSettingsChangedDetail>).detail?.settings ?? getGameSettingsSnapshot();
    clearSuppression();
  };

  window.addEventListener('keydown', onKeyDownCapture, true);
  window.addEventListener(GAME_SETTINGS_CHANGED_EVENT, onSettingsChanged as EventListener);

  return () => {
    clearSuppression();
    window.removeEventListener('keydown', onKeyDownCapture, true);
    window.removeEventListener(GAME_SETTINGS_CHANGED_EVENT, onSettingsChanged as EventListener);
  };
}
