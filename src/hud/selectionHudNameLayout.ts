const STYLE_ID = 'dawnreach-selection-name-layout';
const OVERLAY_SELECTOR = '.selected-entity-hud-overlay';

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .selected-entity-hud__center-name,
    .tower-hud__abilities > .tower-hud__name {
      flex: 0 0 auto;
      width: 100%;
      min-width: 0;
      overflow: hidden;
      padding: 0 8px 1px;
      color: #f1e4ba;
      font: 700 15px/1.15 Georgia, serif;
      text-align: center;
      text-overflow: ellipsis;
      white-space: nowrap;
      box-sizing: border-box;
    }

    .selected-entity-hud__identity-text--compact {
      align-self: stretch;
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      min-width: 0;
      padding-top: 8px;
    }

    .selected-entity-hud__identity-text--compact > span {
      margin-top: 0;
    }

    .selected-entity-hud__identity-text--compact .selected-entity-hud__identity-stats {
      margin-top: 7px;
    }

    .tower-hud__summary--compact {
      justify-content: flex-start;
      padding-top: 11px;
    }

    .tower-hud__summary--compact .tower-hud__team {
      margin-top: 0;
    }
  `;
  document.head.appendChild(style);
}

function centerGenericEntityName(overlay: HTMLElement) {
  const generic = overlay.querySelector<HTMLElement>('.selected-entity-hud__generic');
  if (!generic) return;

  const identityText = generic.querySelector<HTMLElement>('.selected-entity-hud__identity-text');
  const combat = generic.querySelector<HTMLElement>('.selected-entity-hud__combat');
  if (!identityText || !combat) return;

  identityText.classList.add('selected-entity-hud__identity-text--compact');

  const existingCentered = combat.querySelector<HTMLElement>(':scope > .selected-entity-hud__center-name');
  const sourceName = identityText.querySelector<HTMLElement>(':scope > strong');
  if (!sourceName) return;

  if (existingCentered) {
    existingCentered.textContent = sourceName.textContent;
    sourceName.remove();
    return;
  }

  sourceName.className = 'selected-entity-hud__center-name';
  combat.prepend(sourceName);
}

function centerTowerName(overlay: HTMLElement) {
  const tower = overlay.querySelector<HTMLElement>('.tower-hud');
  if (!tower) return;

  const summary = tower.querySelector<HTMLElement>('.tower-hud__summary');
  const abilities = tower.querySelector<HTMLElement>('.tower-hud__abilities');
  if (!summary || !abilities) return;

  summary.classList.add('tower-hud__summary--compact');

  const sourceName = summary.querySelector<HTMLElement>(':scope > .tower-hud__name');
  if (!sourceName) return;

  const existingCentered = abilities.querySelector<HTMLElement>(':scope > .tower-hud__name');
  if (existingCentered) {
    existingCentered.textContent = sourceName.textContent;
    sourceName.remove();
    return;
  }

  abilities.prepend(sourceName);
}

function syncSelectionNames() {
  document.querySelectorAll<HTMLElement>(OVERLAY_SELECTOR).forEach((overlay) => {
    centerGenericEntityName(overlay);
    centerTowerName(overlay);
  });
}

export function mountSelectionHudNameLayout() {
  installStyles();

  let frame = 0;
  const scheduleSync = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      syncSelectionNames();
    });
  };

  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.body, { childList: true, subtree: true });
  scheduleSync();

  return () => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    document.getElementById(STYLE_ID)?.remove();
  };
}
