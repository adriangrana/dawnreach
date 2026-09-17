const MENU_ROOT_ID = 'dawnreach-game-menu';

/**
 * gameMenu owns range sliders through its `input` handler and stores their value as a number.
 * Native range controls also emit `change` when the drag/keyboard interaction commits. The
 * menu's generic change handler treats every non-checkbox input as text and would therefore
 * overwrite that numeric draft value with a string (for example 80 -> "80"). Numeric settings
 * are type-checked before persistence, so that string is rejected and the setting falls back to
 * its default value.
 *
 * Keep committed range changes on the numeric `input` path by stopping only the redundant
 * `change` event before the generic handler sees it. Checkbox/select changes are untouched.
 */
export function mountSettingsSliderValueGuard() {
  const root = document.getElementById(MENU_ROOT_ID);
  if (!root) return () => undefined;

  const onRangeChangeCapture = (event: Event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.type !== 'range' || !input.dataset.settingKey) return;
    event.stopImmediatePropagation();
  };

  root.addEventListener('change', onRangeChangeCapture, true);

  return () => {
    root.removeEventListener('change', onRangeChangeCapture, true);
  };
}
