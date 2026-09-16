import {
  getGameSettingsSnapshot,
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
  { settingKey: 'controls.shop', engineCode: 'KeyP', engineKey: 'p' },
  { settingKey: 'controls.teleport', engineCode: 'KeyT', engineKey: 't' },
];

function isTypingTarget(target: EventTarget | null) {
  return target instanceof Element
    && Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'));
}

function isNativeBinding(event: KeyboardEvent, bridge: KeyBridge) {
  return event.code === bridge.engineCode
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
    const bridge = KEY_BRIDGES.find(candidate => settingBindingMatchesEvent(event, candidate.settingKey, settings));
    if (!bridge || isNativeBinding(event, bridge)) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    dispatching = true;
    window.dispatchEvent(new KeyboardEvent('keydown', {
      code: bridge.engineCode,
      key: bridge.engineKey,
      bubbles: true,
      cancelable: true,
    }));
    dispatching = false;
  };

  window.addEventListener('keydown', onKeyDown, true);
  return () => window.removeEventListener('keydown', onKeyDown, true);
}
