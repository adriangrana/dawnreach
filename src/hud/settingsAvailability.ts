import {
  IMPLEMENTED_GAME_SETTINGS,
  isGameSettingImplemented,
} from '../game/settings/gameSettings';

const MENU_ROOT_ID = 'dawnreach-game-menu';
const AVAILABILITY_CLASS = 'game-setting-availability';

// Some presentation subsystems can become functional without changing the central engine
// settings registry. Keep these explicit and narrow so the Options UI only enables controls
// that have a real consumer in the current build.
const RUNTIME_IMPLEMENTED_OVERRIDES = new Set<string>([
  'audio.master',
  'audio.effects',
  'audio.pings',
]);

function settingHasRuntimeSupport(key: string) {
  return isGameSettingImplemented(key) || RUNTIME_IMPLEMENTED_OVERRIDES.has(key);
}

function markUnavailable(control: HTMLElement, rowSelector: string) {
  const key = control.dataset.settingKey ?? control.dataset.keybindKey;
  if (!key) return;
  const implemented = settingHasRuntimeSupport(key);
  const row = control.closest<HTMLElement>(rowSelector);
  if (!row) return;

  row.classList.toggle('is-unavailable', !implemented);
  row.setAttribute('aria-disabled', implemented ? 'false' : 'true');

  if (
    control instanceof HTMLInputElement
    || control instanceof HTMLSelectElement
    || control instanceof HTMLButtonElement
  ) {
    control.disabled = !implemented;
  }

  const copy = (
    row.querySelector<HTMLElement>('.game-setting-copy')
    ?? (row.firstElementChild instanceof HTMLElement ? row.firstElementChild : null)
  );
  let badge = row.querySelector<HTMLElement>(`.${AVAILABILITY_CLASS}`);
  if (implemented) {
    badge?.remove();
    return;
  }

  if (!badge && copy) {
    badge = document.createElement('span');
    badge.className = AVAILABILITY_CLASS;
    badge.textContent = 'NO DISPONIBLE EN ESTA BUILD';
    copy.appendChild(badge);
  }
}

function categoryHasRuntimeSupport(category: string) {
  if (category === 'network') {
    return [...IMPLEMENTED_GAME_SETTINGS].some(key => (
      key.startsWith('network.') || key.startsWith('social.') || key.startsWith('privacy.')
    ));
  }
  if ([...RUNTIME_IMPLEMENTED_OVERRIDES].some(key => key.startsWith(`${category}.`))) return true;
  return [...IMPLEMENTED_GAME_SETTINGS].some(key => key.startsWith(`${category}.`));
}

function refreshAvailability(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('[data-setting-key]').forEach(control => {
    markUnavailable(control, '.game-setting-row');
  });
  root.querySelectorAll<HTMLElement>('[data-keybind-key]').forEach(control => {
    markUnavailable(control, '.game-keybind-row');
  });

  root.querySelectorAll<HTMLElement>('.game-options-sidebar button[data-category]').forEach(button => {
    const category = button.dataset.category;
    if (!category) return;
    button.classList.toggle('is-roadmap-only', !categoryHasRuntimeSupport(category));
  });
}

export function mountSettingsAvailability() {
  const root = document.getElementById(MENU_ROOT_ID);
  if (!root) return () => undefined;

  let pending = false;
  const refresh = () => {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      refreshAvailability(root);
    });
  };

  const observer = new MutationObserver(refresh);
  observer.observe(root, { subtree: true, childList: true });
  refresh();

  return () => observer.disconnect();
}
