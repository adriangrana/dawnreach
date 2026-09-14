const SELECTION_OVERLAY_SELECTOR = '.selected-entity-hud-overlay';
const LOCAL_HERO_ENTITY_ID = 'blue-hero-alden';

function localHeroIsSelected() {
  const overlay = document.querySelector<HTMLElement>(SELECTION_OVERLAY_SELECTOR);
  return overlay?.dataset.selectionKind === 'hero'
    && overlay.dataset.selectionId === LOCAL_HERO_ENTITY_ID;
}

export function mountHeroFunctionKeyControls() {
  let suppressSyntheticCameraFocus = false;
  let clearSuppressionTimer = 0;

  const clearSuppression = () => {
    suppressSyntheticCameraFocus = false;
    if (clearSuppressionTimer) {
      window.clearTimeout(clearSuppressionTimer);
      clearSuppressionTimer = 0;
    }
  };

  const onKeyDownCapture = (event: KeyboardEvent) => {
    if (event.code === 'F1') {
      if (event.repeat) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      // Snapshot the actual selected entity before the game's own F1 handler runs.
      // The selection HUD remains mounted even when Alden is selected, so `hidden`
      // cannot be used as a selection signal. The first F1 selects Alden without
      // moving the camera; subsequent F1 presses are allowed to recenter him.
      clearSuppression();
      suppressSyntheticCameraFocus = !localHeroIsSelected();
      if (suppressSyntheticCameraFocus) {
        clearSuppressionTimer = window.setTimeout(() => {
          suppressSyntheticCameraFocus = false;
          clearSuppressionTimer = 0;
        }, 0);
      }
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

  window.addEventListener('keydown', onKeyDownCapture, true);

  return () => {
    clearSuppression();
    window.removeEventListener('keydown', onKeyDownCapture, true);
  };
}
