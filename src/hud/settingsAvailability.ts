import { isGameSettingImplemented } from '../game/settings/gameSettings';

const MENU_ROOT_ID = 'dawnreach-game-menu';
const AVAILABILITY_CLASS = 'game-setting-availability';

function markUnavailable(control: HTMLElement, rowSelector: string) {
  const key = control.dataset.settingKey ?? control.dataset.keybindKey;
  if (!key) return;
  const implemented = isGameSettingImplemented(key);
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

  const copy = row.querySelector<HTMLElement>('.game-setting-copy') ?? row.firstElementChild as HTMLElement | null;
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
    const anyImplemented = Array.from(root.querySelectorAll<HTMLElement>(`[data-setting-key^="${category}."]`))
      .some(control => isGameSettingImplemented(control.dataset.settingKey ?? ''));
    const hasImplementedKeybind = category === 'controls'
      && Array.from(root.querySelectorAll<HTMLElement>('[data-keybind-key]'))
        .some(control => isGameSettingImplemented(control.dataset.keybindKey ?? ''));
    button.classList.toggle('is-roadmap-only', !anyImplemented && !hasImplementedKeybind);
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
