import {
  getGameSettingsSnapshot,
  keyBindingMatchesEvent,
  settingBindingMatchesEvent,
} from '../game/settings/gameSettings';
import { isGameMenuOpen } from './gameMenu';

type KeyBridge = Readonly<{
  settingKey: string;
  engineCode: string;
  engineKey: string;
}>;

const KEY_BRIDGES: readonly KeyBridge[] = [
  { settingKey: 'controls.abilityQ', engineCode: 'KeyQ', engineKey: 'q' },
  { settingKey: 'controls.abilityW', engineCode: 'KeyW', engineKey: 'w' },
  { settingKey: 'controls.abilityE', engineCode: 'KeyE', engineKey: 'e' },
  { settingKey: 'controls.abilityR', engineCode: 'KeyR', engineKey: 'r' },
  { settingKey: 'controls.attackMove', engineCode: 'KeyA', engineKey: 'a' },
  { settingKey: 'controls.stop', engineCode: 'KeyS', engineKey: 's' },
  { settingKey: 'controls.holdPosition', engineCode: 'KeyH', engineKey: 'h' },
  { settingKey: 'controls.centerHero', engineCode: 'Space', engineKey: ' ' },
  { settingKey: 'controls.shop', engineCode: 'KeyP', engineKey: 'p' },
  { settingKey: 'controls.teleport', engineCode: 'KeyT', engineKey: 't' },
];

function isTypingTarget(target: EventTarget | null) {
  return target instanceof Element
    && Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'));
}

function eventIsUnmodifiedCode(event: KeyboardEvent, code: string) {
  return event.code === code
    && !event.ctrlKey
    && !event.altKey
    && !event.shiftKey
    && !event.metaKey;
}

export function mountGameplayKeybindBridge() {
  let dispatching = false;

  const onKeyDown = (event: KeyboardEvent) => {
    if (dispatching || event.repeat || event.isComposing || event.defaultPrevented) return;
    if (isGameMenuOpen() || isTypingTarget(event.target)) return;

    const settings = getGameSettingsSnapshot();
    const configured = KEY_BRIDGES.find(candidate => (
      settingBindingMatchesEvent(event, candidate.settingKey, settings)
    ));

    if (configured) {
      // If the selected binding already is the engine's native command, let the original event
      // pass through. Otherwise translate it to the legacy command exactly once.
      if (eventIsUnmodifiedCode(event, configured.engineCode)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      dispatching = true;
      window.dispatchEvent(new KeyboardEvent('keydown', {
        code: configured.engineCode,
        key: configured.engineKey,
        bubbles: true,
        cancelable: true,
      }));
      dispatching = false;
      return;
    }

    // A remap must replace the old key rather than add an alias. Suppress a native engine key
    // when its action has been rebound elsewhere; otherwise Q would still cast Q after assigning
    // that ability to another key, P would still open the shop, etc.
    const staleNative = KEY_BRIDGES.find(candidate => (
      eventIsUnmodifiedCode(event, candidate.engineCode)
      && !keyBindingMatchesEvent(event, String(settings[candidate.settingKey] ?? ''))
    ));
    if (!staleNative) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  window.addEventListener('keydown', onKeyDown, true);
  return () => window.removeEventListener('keydown', onKeyDown, true);
}
