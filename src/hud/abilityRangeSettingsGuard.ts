import {
  GAME_SETTINGS_CHANGED_EVENT,
  getGameSettingsSnapshot,
  type GameSettingsChangedDetail,
} from '../game/settings/gameSettings';

const ABILITY_SELECTOR = '.ability-control[data-ability]';

export function mountAbilityRangeSettingsGuard() {
  let settings = getGameSettingsSnapshot();

  const rangeEnabled = () => settings['gameplay.showCastRange'] !== false;

  // Window capture runs before abilityPresentation's document-level hover listener. When the
  // option is disabled, stop new hover-enter events before they can enable the Three.js range
  // visual. Mouseout is intentionally allowed so any already-visible range can clear normally.
  const onMouseOver = (event: MouseEvent) => {
    if (rangeEnabled()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(ABILITY_SELECTOR)) return;
    event.stopPropagation();
  };

  const onSettingsChanged = (event: Event) => {
    settings = (event as CustomEvent<GameSettingsChangedDetail>).detail?.settings ?? getGameSettingsSnapshot();
    if (rangeEnabled()) return;

    // If the setting is switched off while the pointer is already over an ability, emit the
    // matching exit so the presentation runtime clears hoverKey immediately instead of waiting
    // for the user to move the pointer away.
    const hovered = document.querySelector<HTMLElement>(`${ABILITY_SELECTOR}:hover`);
    hovered?.dispatchEvent(new MouseEvent('mouseout', {
      bubbles: true,
      cancelable: false,
      relatedTarget: document.body,
    }));
  };

  window.addEventListener('mouseover', onMouseOver, true);
  window.addEventListener(GAME_SETTINGS_CHANGED_EVENT, onSettingsChanged as EventListener);
  return () => {
    window.removeEventListener('mouseover', onMouseOver, true);
    window.removeEventListener(GAME_SETTINGS_CHANGED_EVENT, onSettingsChanged as EventListener);
  };
}
