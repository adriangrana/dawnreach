import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { mountCombatStatsOverlay } from './hud/combatStatsOverlay';
import { mountGameCameraControls } from './hud/gameCameraControls';
import { mountResponsiveHudScale } from './hud/responsiveHudScale';
import './styles.css';
import './hud-overrides.css';
import './command-controls.css';
import './combat-stats.css';

const BOOT_SPLASH_ID = 'dawnreach-boot-splash';

function nextAnimationFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function mountedImagesAreSettled() {
  return Array.from(document.images).every((image) => image.complete);
}

async function waitForDawnreachReady() {
  if ('fonts' in document) await document.fonts.ready;

  while (true) {
    await nextAnimationFrame();

    const gameCanvas = document.querySelector<HTMLCanvasElement>('.game-canvas');
    const minimapCanvas = document.querySelector<HTMLCanvasElement>('.minimap-canvas');
    const gameHud = document.querySelector<HTMLElement>('.game-hud');
    const gameBounds = gameCanvas?.getBoundingClientRect();
    const minimapBounds = minimapCanvas?.getBoundingClientRect();

    const gameSurfaceReady = Boolean(
      gameCanvas
      && gameBounds
      && gameCanvas.width > 0
      && gameCanvas.height > 0
      && gameBounds.width > 0
      && gameBounds.height > 0,
    );
    const minimapReady = Boolean(
      minimapCanvas
      && minimapBounds
      && minimapCanvas.width > 0
      && minimapCanvas.height > 0
      && minimapBounds.width > 0
      && minimapBounds.height > 0,
    );

    if (!gameSurfaceReady || !minimapReady || !gameHud || !mountedImagesAreSettled()) continue;

    // Give Three.js and the browser two complete paint opportunities after all
    // visible assets have settled. This prevents exposing a partially composed frame.
    await nextAnimationFrame();
    await nextAnimationFrame();
    return;
  }
}

function dismissBootSplash() {
  const splash = document.getElementById(BOOT_SPLASH_ID);
  if (!splash) return;

  splash.classList.add('is-ready');
  window.setTimeout(() => splash.remove(), 280);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

mountCombatStatsOverlay();
const disposeResponsiveHudScale = mountResponsiveHudScale();
const disposeGameCameraControls = mountGameCameraControls();

void waitForDawnreachReady().then(dismissBootSplash);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeResponsiveHudScale();
    disposeGameCameraControls();
  });
}
