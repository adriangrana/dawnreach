const MENU_ROOT_ID = 'dawnreach-game-menu';
const MENU_OPEN_DATASET_KEY = 'dawnreachGameMenuOpen';

const MAIN_MENU_SHORTCUTS: Readonly<Record<string, string>> = {
  KeyP: 'resume',
  KeyO: 'options',
  KeyH: 'help',
  KeyS: 'support',
  KeyA: 'abandon',
  KeyX: 'exit',
};

function isEditableTarget(target: EventTarget | null) {
  return target instanceof Element
    && Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'));
}

/**
 * Main F10 menu accelerators. This listener must be installed before mountGameMenu so menu-owned
 * gameplay-key suppression (A/S/H) does not swallow the accelerators before they can activate.
 */
export function mountGameMenuQuickKeys() {
  const onKeyDownCapture = (event: KeyboardEvent) => {
    if (document.body.dataset[MENU_OPEN_DATASET_KEY] !== 'true') return;
    if (event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
    if (isEditableTarget(event.target)) return;

    const action = MAIN_MENU_SHORTCUTS[event.code];
    if (!action) return;

    const menu = document.getElementById(MENU_ROOT_ID);
    if (!menu?.querySelector('.game-menu-panel--main')) return;
    const button = menu.querySelector<HTMLButtonElement>(`.game-menu-primary-action[data-action="${action}"]`);
    if (!button || button.disabled) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    button.click();
  };

  window.addEventListener('keydown', onKeyDownCapture, true);
  return () => window.removeEventListener('keydown', onKeyDownCapture, true);
}
