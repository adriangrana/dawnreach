import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { mountBrowserInteractionGuards } from './hud/browserInteractionGuards';
import { mountCombatStatsOverlay } from './hud/combatStatsOverlay';
import { mountGameCameraControls } from './hud/gameCameraControls';
import { mountHeroFunctionKeyControls } from './hud/heroFunctionKeyControls';
import { mountInventoryControls } from './hud/inventoryControls';
import { mountMinimapDragCamera } from './hud/minimapDragCamera';
import { mountResponsiveHudScale } from './hud/responsiveHudScale';
import { mountSelectionHudNameLayout } from './hud/selectionHudNameLayout';
import { mountTowerPortraitAssets } from './hud/towerPortraitAssets';
import './styles.css';
import './hud-overrides.css';
import './hero-stats-hud.css';
import './command-controls.css';
import './combat-stats.css';
import './progression-hud.css';
import './shop.css';
import './item-ui.css';
import './teleport-slot.css';
import './shop-panel.css';

const BOOT_SPLASH_ID = 'dawnreach-boot-splash';
const BOOT_SPLASH_MAX_WAIT_MS = 12_000;
const BOOT_FONT_WAIT_MS = 2_000;

function nextAnimationFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function delay(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function mountedImagesAreSettled() {
  return Array.from(document.images).every((image) => image.complete);
}

async function waitForDawnreachReady() {
  const startedAt = performance.now();
  if ('fonts' in document) {
    await Promise.race([document.fonts.ready.then(() => undefined), delay(BOOT_FONT_WAIT_MS)]);
  }

  while (true) {
    await nextAnimationFrame();
    const gameCanvas = document.querySelector<HTMLCanvasElement>('.game-canvas');
    const minimapCanvas = document.querySelector<HTMLCanvasElement>('.minimap-canvas');
    const gameHud = document.querySelector<HTMLElement>('.game-hud');
    const gameBounds = gameCanvas?.getBoundingClientRect();
    const minimapBounds = minimapCanvas?.getBoundingClientRect();
    const gameSurfaceReady = Boolean(gameCanvas && gameCanvas.dataset.dawnreachReady === 'true' && gameBounds && gameCanvas.width > 0 && gameCanvas.height > 0 && gameBounds.width > 0 && gameBounds.height > 0);
    const minimapReady = Boolean(minimapCanvas && minimapBounds && minimapCanvas.width > 0 && minimapCanvas.height > 0 && minimapBounds.width > 0 && minimapBounds.height > 0);

    if (gameSurfaceReady && minimapReady && gameHud && mountedImagesAreSettled()) {
      await nextAnimationFrame();
      await nextAnimationFrame();
      return;
    }
    if (performance.now() - startedAt >= BOOT_SPLASH_MAX_WAIT_MS) {
      console.warn('[Dawnreach] Boot readiness watchdog expired; continuing without full warmup.');
      return;
    }
  }
}

function dismissBootSplash() {
  const splash = document.getElementById(BOOT_SPLASH_ID);
  if (!splash) return;
  splash.classList.add('is-ready');
  window.setTimeout(() => splash.remove(), 280);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>,
);

const disposeBrowserInteractionGuards = mountBrowserInteractionGuards();
mountCombatStatsOverlay();
const disposeResponsiveHudScale = mountResponsiveHudScale();
const disposeHeroFunctionKeyControls = mountHeroFunctionKeyControls();
const disposeInventoryControls = mountInventoryControls();
const disposeGameCameraControls = mountGameCameraControls();
const disposeMinimapDragCamera = mountMinimapDragCamera();
const disposeTowerPortraitAssets = mountTowerPortraitAssets();
const disposeSelectionHudNameLayout = mountSelectionHudNameLayout();

void waitForDawnreachReady().then(dismissBootSplash);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeBrowserInteractionGuards();
    disposeResponsiveHudScale();
    disposeHeroFunctionKeyControls();
    disposeInventoryControls();
    disposeGameCameraControls();
    disposeMinimapDragCamera();
    disposeTowerPortraitAssets();
    disposeSelectionHudNameLayout();
  });
}
