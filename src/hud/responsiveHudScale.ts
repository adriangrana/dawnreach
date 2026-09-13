const DESKTOP_BREAKPOINT_PX = 1201;
const COMMAND_DECK_BASE_WIDTH_PX = 721;
const COMMAND_DECK_VIEWPORT_FRACTION = 0.5;

export function mountResponsiveHudScale() {
  const root = document.documentElement;

  const updateScale = () => {
    if (window.innerWidth < DESKTOP_BREAKPOINT_PX) {
      root.style.removeProperty('--command-deck-scale');
      return;
    }

    const targetWidth = window.innerWidth * COMMAND_DECK_VIEWPORT_FRACTION;
    const scale = targetWidth / COMMAND_DECK_BASE_WIDTH_PX;
    root.style.setProperty('--command-deck-scale', scale.toFixed(5));
  };

  updateScale();
  window.addEventListener('resize', updateScale, { passive: true });

  return () => {
    window.removeEventListener('resize', updateScale);
    root.style.removeProperty('--command-deck-scale');
  };
}
