function belongsToDawnreach(target: EventTarget | null) {
  if (!(target instanceof Node)) return false;
  if (document.getElementById('root')?.contains(target)) return true;

  // Some game-owned overlays (notably the F10 menu and the global pause treatment) are mounted
  // directly under <body> instead of inside the React root. They are still part of the game
  // surface and must never expose browser/WebView chrome.
  if (target instanceof Element) {
    return Boolean(target.closest(
      '#dawnreach-game-menu, #dawnreach-match-pause-overlay, .match-scoreboard-overlay',
    ));
  }

  return false;
}

function modalGameSurfaceActive() {
  return document.body.dataset.dawnreachGameMenuOpen === 'true'
    || document.body.dataset.dawnreachMatchPaused === 'true'
    || document.querySelector('.match-scoreboard-overlay') !== null;
}

/**
 * Dawnreach runs as a game surface even when hosted by a browser/WebView. Native browser
 * interactions must not leak into gameplay: context menus cover the HUD, Tab would otherwise
 * walk focus through every HUD button, and refresh shortcuts can destroy the current match
 * state.
 */
export function mountBrowserInteractionGuards() {
  const onContextMenu = (event: MouseEvent) => {
    // F10 and TAB are game-owned modal surfaces. While either is visible, suppress the native
    // browser menu regardless of which underlying element receives the right click (the TAB
    // scoreboard intentionally uses pointer-events:none, so its target can be the world below).
    const modalSurface = modalGameSurfaceActive();
    if (!modalSurface && !belongsToDawnreach(event.target)) return;
    event.preventDefault();
    if (modalSurface) event.stopImmediatePropagation();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // TAB is a gameplay key in Dawnreach: it belongs exclusively to the match scoreboard.
    // Prevent the WebView/browser from moving focus between abilities, inventory slots, shop
    // controls, menu buttons, etc. Do NOT stop propagation here: ScoreboardOverlay still needs
    // to receive the same event and decide whether the configured scoreboard binding opens it.
    if (event.code === 'Tab') {
      event.preventDefault();

      // Mouse interaction can leave a HUD button focused. Clearing that focus avoids carrying a
      // browser-style focus ring underneath the scoreboard while still leaving text fields alone
      // when the F10 options menu is intentionally being edited.
      const active = document.activeElement;
      if (
        active instanceof HTMLElement
        && belongsToDawnreach(active)
        && !(active instanceof HTMLInputElement)
        && !(active instanceof HTMLTextAreaElement)
        && !(active instanceof HTMLSelectElement)
        && !active.isContentEditable
      ) {
        active.blur();
      }
      return;
    }

    const browserRefresh = (
      event.code === 'F5'
      || (event.code === 'KeyR' && (event.ctrlKey || event.metaKey))
    );
    if (!browserRefresh) return;

    event.preventDefault();
    event.stopImmediatePropagation();
  };

  // Keyup itself has no native focus traversal, but cancelling Tab here as well keeps the event
  // fully game-owned for host WebViews that attach their own keyup accelerator handling.
  const onKeyUp = (event: KeyboardEvent) => {
    if (event.code === 'Tab') event.preventDefault();
  };

  window.addEventListener('contextmenu', onContextMenu, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);

  return () => {
    window.removeEventListener('contextmenu', onContextMenu, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
  };
}
