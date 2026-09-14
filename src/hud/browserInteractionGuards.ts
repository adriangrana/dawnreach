function belongsToDawnreach(target: EventTarget | null) {
  return target instanceof Node && Boolean(document.getElementById('root')?.contains(target));
}

/**
 * Dawnreach runs as a game surface even when hosted by a browser/WebView. Native browser
 * interactions must not leak into gameplay: context menus cover the HUD and refresh shortcuts
 * can destroy the current match state.
 */
export function mountBrowserInteractionGuards() {
  const onContextMenu = (event: MouseEvent) => {
    if (!belongsToDawnreach(event.target)) return;
    event.preventDefault();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const browserRefresh = (
      event.code === 'F5'
      || (event.code === 'KeyR' && (event.ctrlKey || event.metaKey))
    );
    if (!browserRefresh) return;

    event.preventDefault();
    event.stopImmediatePropagation();
  };

  window.addEventListener('contextmenu', onContextMenu, true);
  window.addEventListener('keydown', onKeyDown, true);

  return () => {
    window.removeEventListener('contextmenu', onContextMenu, true);
    window.removeEventListener('keydown', onKeyDown, true);
  };
}
