function belongsToDawnreach(target: EventTarget | null) {
  return target instanceof Node && Boolean(document.getElementById('root')?.contains(target));
}

/**
 * Dawnreach runs as a game surface even when hosted by a browser/WebView. Native browser
 * interactions must not leak into gameplay: context menus cover the HUD, Tab would otherwise
 * walk focus through every HUD button, and refresh shortcuts can destroy the current match
 * state.
 */
export function mountBrowserInteractionGuards() {
  const onContextMenu = (event: MouseEvent) => {
    if (!belongsToDawnreach(event.target)) return;
    event.preventDefault();
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
