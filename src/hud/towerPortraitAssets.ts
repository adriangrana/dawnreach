const STYLE_ID = 'dawnreach-tower-portrait-assets';
const PORTRAIT_ATTRIBUTE = 'data-dawnreach-tower-portrait';

const TOWER_PORTRAITS = {
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
  observer.observe(document.body, { childList: true, subtree: true });
  scheduleSync();

  return () => {
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    document.querySelectorAll(`[${PORTRAIT_ATTRIBUTE}]`).forEach(node => node.remove());
    document.getElementById(STYLE_ID)?.remove();
  };
}
