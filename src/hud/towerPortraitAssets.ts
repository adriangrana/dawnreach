import { TOWER_GAMEPLAY, getTowerTierConfig, type TowerTier } from '../game/gameplay/towerConfig';

const STYLE_ID = 'dawnreach-tower-portrait-assets';
const PORTRAIT_ATTRIBUTE = 'data-dawnreach-tower-portrait';

export const TOWER_PORTRAITS = {
  dawn: '/assets/images/blue_tower.webp',
  dusk: '/assets/images/red_tower.webp',
} as const;

function installStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .tower-hud__preview canvas {
      display: none !important;
    }

    .tower-hud__preview > [${PORTRAIT_ATTRIBUTE}] {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
      object-fit: contain;
      object-position: center bottom;
      pointer-events: none;
      user-select: none;
      -webkit-user-drag: none;
      filter: drop-shadow(0 5px 7px rgba(0, 0, 0, .46));
    }

    .tower-hud[data-tower-tier="1"] [data-ability="backdoor-protection"] {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
}

function portraitForPreview(preview: HTMLElement) {
  const towerHud = preview.closest<HTMLElement>('.tower-hud');
  const teamLabel = towerHud
    ?.querySelector<HTMLElement>('.tower-hud__team')
    ?.textContent
    ?.trim()
    .toUpperCase();

  if (teamLabel === 'DAWN') return TOWER_PORTRAITS.dawn;
  if (teamLabel === 'DUSK') return TOWER_PORTRAITS.dusk;
  return null;
}

function tierFromHud(towerHud: HTMLElement): TowerTier | null {
  const name = towerHud.querySelector<HTMLElement>('.tower-hud__name')?.textContent ?? '';
  const match = name.match(/Tier\s+([1-4])/i);
  const tier = Number(match?.[1]);
  return tier >= 1 && tier <= 4 ? tier as TowerTier : null;
}

function setMetric(towerHud: HTMLElement, label: string, value: string) {
  for (const metric of towerHud.querySelectorAll<HTMLElement>('.tower-hud__metric')) {
    const metricLabel = metric.querySelector<HTMLElement>('span');
    if (metricLabel?.textContent?.trim().toLowerCase() !== label.toLowerCase()) continue;
    const metricValue = metric.querySelector<HTMLElement>('b');
    if (metricValue && metricValue.textContent !== value) metricValue.textContent = value;
    return;
  }
}

function syncTowerTierHud(towerHud: HTMLElement) {
  const tier = tierFromHud(towerHud);
  if (!tier) return;
  const config = getTowerTierConfig(tier);
  towerHud.dataset.towerTier = String(tier);

  const level = towerHud.querySelector<HTMLElement>('.tower-hud__level');
  if (level && level.textContent !== String(tier)) level.textContent = String(tier);

  const title = towerHud.querySelector<HTMLElement>('.tower-hud__portrait-title');
  const titleText = `TORRE · TIER ${tier}`;
  if (title && title.textContent !== titleText) title.textContent = titleText;

  setMetric(towerHud, 'Daño', `${config.damageMin}–${config.damageMax}`);
  setMetric(towerHud, 'Intervalo', `${TOWER_GAMEPLAY.attack.intervalSeconds.toFixed(2)}s`);

  // The original fourth metric showed generic vision on every tower. Armor is the
  // tier-specific combat value the player needs when comparing structures, so expose it
  // in the same slot while True Sight remains an intrinsic tower passive.
  for (const metric of towerHud.querySelectorAll<HTMLElement>('.tower-hud__metric')) {
    const metricLabel = metric.querySelector<HTMLElement>('span');
    if (metricLabel?.textContent?.trim().toLowerCase() !== 'visión') continue;
    metricLabel.textContent = 'Armadura';
    const metricValue = metric.querySelector<HTMLElement>('b');
    if (metricValue) metricValue.textContent = String(config.baseArmor);
  }
}

function syncTowerPortraits() {
  document.querySelectorAll<HTMLElement>('.tower-hud__preview').forEach((preview) => {
    const portraitSrc = portraitForPreview(preview);
    if (!portraitSrc) return;

    let image = preview.querySelector<HTMLImageElement>(`:scope > img[${PORTRAIT_ATTRIBUTE}]`);
    if (!image) {
      image = document.createElement('img');
      image.setAttribute(PORTRAIT_ATTRIBUTE, '');
      image.alt = '';
      image.draggable = false;
      image.decoding = 'async';
      preview.appendChild(image);
    }

    if (image.getAttribute('src') !== portraitSrc) image.src = portraitSrc;
    const towerHud = preview.closest<HTMLElement>('.tower-hud');
    if (towerHud) syncTowerTierHud(towerHud);
  });
}

export function mountTowerPortraitAssets() {
  installStyles();

  let frame = 0;
  const scheduleSync = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      syncTowerPortraits();
    });
  };

  const observer = new MutationObserver(scheduleSync);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  scheduleSync();

  return () => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    document.querySelectorAll(`[${PORTRAIT_ATTRIBUTE}]`).forEach(node => node.remove());
    document.getElementById(STYLE_ID)?.remove();
  };
}
