const MENU_ROOT_ID = 'dawnreach-game-menu';
const MENU_OPEN_DATASET_KEY = 'dawnreachGameMenuOpen';

/**
 * Menu accelerators are deliberately chosen from letters already present in each label. The
 * same letter is highlighted inline, so the player never has to decode a separate key badge.
 */
const MAIN_MENU_SHORTCUTS: Readonly<Record<string, string>> = {
  KeyA: 'resume',
  KeyO: 'options',
  KeyY: 'help',
  KeyS: 'support',
  KeyB: 'abandon',
  KeyL: 'exit',
};

const ACTION_MNEMONICS: Readonly<Record<string, string>> = {
  resume: 'a', // P[a]usar / Re[a]nudar
  options: 'o',
  help: 'y',
  support: 's',
  abandon: 'b',
  exit: 'l',
};

function isEditableTarget(target: EventTarget | null) {
  return target instanceof Element
    && Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'));
}

function decorateMnemonic(button: HTMLButtonElement) {
  const action = button.dataset.action;
  if (!action) return;
  const mnemonic = ACTION_MNEMONICS[action];
  if (!mnemonic) return;

  const label = button.querySelector<HTMLElement>('strong');
  if (!label || label.querySelector('.game-menu-inline-shortcut')) return;

  const text = label.textContent ?? '';
  const index = text.toLocaleLowerCase('es').indexOf(mnemonic.toLocaleLowerCase('es'));
  if (index < 0) return;

  const before = text.slice(0, index);
  const highlighted = text.slice(index, index + 1);
  const after = text.slice(index + 1);
  label.replaceChildren(
    document.createTextNode(before),
    Object.assign(document.createElement('span'), {
      className: 'game-menu-inline-shortcut',
      textContent: highlighted,
    }),
    document.createTextNode(after),
  );
  button.dataset.menuShortcut = mnemonic.toUpperCase();
}

function decorateMainMenu() {
  const menu = document.getElementById(MENU_ROOT_ID);
  if (!menu?.querySelector('.game-menu-panel--main')) return;
  menu.querySelectorAll<HTMLButtonElement>('.game-menu-primary-action[data-action]')
    .forEach(decorateMnemonic);
}

/**
 * Main F10 menu accelerators. This listener must be installed before mountGameMenu so menu-owned
 * gameplay-key suppression (A/S/etc.) does not swallow the accelerators before they can activate.
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

  // gameMenu redraws its DOM when changing views and matchPauseRuntime changes Pausar/Reanudar
  // in-place. Reapply the inline mnemonic after either kind of mutation without coupling the menu
  // renderer to the shortcut system.
  const observer = new MutationObserver(() => decorateMainMenu());
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });

  window.addEventListener('keydown', onKeyDownCapture, true);
  decorateMainMenu();
  return () => {
    observer.disconnect();
    window.removeEventListener('keydown', onKeyDownCapture, true);
  };
}
