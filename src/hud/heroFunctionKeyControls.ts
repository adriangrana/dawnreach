const SELECTION_OVERLAY_SELECTOR = '.selected-entity-hud-overlay';

function localHeroIsSelected() {
  const overlay = document.querySelector<HTMLElement>(SELECTION_OVERLAY_SELECTOR);
  return Boolean(overlay?.hidden);
}

export function mountHeroFunctionKeyControls() {
  let suppressNextSyntheticCameraFocus = false;

  const onKeyDownCapture = (event: KeyboardEvent) => {
    if (event.code === 'F1') {
      if (event.repeat) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }

      // The existing selection controller handles F1 by selecting Alden and then
      // dispatching a synthetic Space key to center the camera. Suppress only that
      // synthetic camera-focus step when Alden was not already selected.
      suppressNextSyntheticCameraFocus = !localHeroIsSelected();
      if (suppressNextSyntheticCameraFocus) {
        queueMicrotask(() => {
          suppressNextSyntheticCameraFocus = false;
        });
      }
      return;
    }

    if (
      event.code !== 'Space'
      || !suppressNextSyntheticCameraFocus
      || event.isTrusted
    ) return;

    suppressNextSyntheticCameraFocus = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  window.addEventListener('keydown', onKeyDownCapture, true);

  return () => {
    suppressNextSyntheticCameraFocus = false;
    window.removeEventListener('keydown', onKeyDownCapture, true);
  };
}
