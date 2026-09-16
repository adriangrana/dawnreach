import ReactDOM from 'react-dom/client';
import App from './App';
import { mountAldenWorldAbilityBootstrap } from './game/heroes/alden/worldAbilityBootstrap';
import { warmTeleportPortalGeometry } from './game/items/teleportPortalWarmup';
import { installMatchPauseRuntime } from './game/match/matchPauseRuntime';
import { installRuntimePerformanceTuning } from './game/performance/runtimePerformanceTuning';
import { installShadowInvalidationBridge } from './game/performance/shadowInvalidationBridge';
import { mountAbilityRangeSettingsGuard } from './hud/abilityRangeSettingsGuard';
import { mountBrowserInteractionGuards } from './hud/browserInteractionGuards';
import { mountCombatStatsOverlay } from './hud/combatStatsOverlay';
import { mountFpsOverlay } from './hud/fpsOverlay';
import { mountGameCameraControls } from './hud/gameCameraControls';
import { mountGameMenu } from './hud/gameMenu';
import { mountGameMenuQuickKeys } from './hud/gameMenuQuickKeys';
import { mountGameplayKeybindBridge } from './hud/gameplayKeybindBridge';
import { mountHeroFunctionKeyControls } from './hud/heroFunctionKeyControls';
import { mountInventoryControls } from './hud/inventoryControls';
import { mountMinimapDragCamera } from './hud/minimapDragCamera';
import { mountPingPresentationEnhancements } from './hud/pingPresentationEnhancements';
import { mountPingWheel } from './hud/pingWheel';
import { mountResponsiveHudScale } from './hud/responsiveHudScale';
import { mountSelectionHudNameLayout } from './hud/selectionHudNameLayout';
import { mountSettingsAvailability } from './hud/settingsAvailability';
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
import './game-menu.css';
import './game-menu-hotkeys.css';
import './match-pause.css';
import './settings-runtime.css';
import './scoreboard.css';
import './ping-wheel.css';
import './ping-presentation-enhancements.css';

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

// Install the match-wide pause clock before any Three.js Clock is constructed. F10 itself does
// not pause; only an explicit pause request freezes simulation time for the entire match.
const disposeMatchPauseRuntime = installMatchPauseRuntime();
// Install renderer/lighting scheduling before the Dawnreach scene is constructed.
const disposeRuntimePerformanceTuning = installRuntimePerformanceTuning();
// Destructive world-state changes can happen between scheduled shadow passes. Track the main
// renderer and force a short refresh burst after deaths so removed structures cannot leave a
// stale silhouette in the reused shadow atlas.
const disposeShadowInvalidationBridge = installShadowInvalidationBridge();
// Three r180 creates render as an instance method. Install the Alden bootstrap before React
// constructs the game renderer so live ability effects bind to the actual renderer instance.
const disposeAldenWorldAbilityRuntime = mountAldenWorldAbilityBootstrap();

// The Three.js world is intentionally mounted once. React StrictMode's development-only
// effect replay would otherwise build and warm the complete Dawnreach scene twice in parallel,
// doubling startup work and transient GPU/CPU pressure in tauri:dev.
ReactDOM.createRoot(document.getElementById('root')!).render(<App />);

// Main-menu accelerators must be registered before mountGameMenu because the menu itself owns
// gameplay keys such as A/S/H while open. The accelerator layer converts those keys into menu
// actions first, then the regular menu/input guards keep them from leaking into gameplay.
const disposeGameMenuQuickKeys = mountGameMenuQuickKeys();
// Register the F10 menu before gameplay hotkeys so an open menu owns keyboard input and
// never leaks commands to the world underneath it.
const disposeGameMenu = mountGameMenu();
const disposeSettingsAvailability = mountSettingsAvailability();
const disposeAbilityRangeSettingsGuard = mountAbilityRangeSettingsGuard();
const disposeBrowserInteractionGuards = mountBrowserInteractionGuards();
mountCombatStatsOverlay();
const disposeFpsOverlay = mountFpsOverlay();
const disposeResponsiveHudScale = mountResponsiveHudScale();
const disposePingWheel = mountPingWheel();
const disposePingPresentationEnhancements = mountPingPresentationEnhancements();
const disposeHeroFunctionKeyControls = mountHeroFunctionKeyControls();
const disposeInventoryControls = mountInventoryControls();
const disposeGameplayKeybindBridge = mountGameplayKeybindBridge();
const disposeGameCameraControls = mountGameCameraControls();
const disposeMinimapDragCamera = mountMinimapDragCamera();
const disposeTowerPortraitAssets = mountTowerPortraitAssets();
const disposeSelectionHudNameLayout = mountSelectionHudNameLayout();

const portalWarmup = warmTeleportPortalGeometry().catch((error) => {
  console.warn('[Dawnreach] Teleport portal warmup failed; continuing without it.', error);
});
void Promise.all([waitForDawnreachReady(), portalWarmup]).then(dismissBootSplash);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeAldenWorldAbilityRuntime();
    disposeShadowInvalidationBridge();
    disposeRuntimePerformanceTuning();
    disposeMatchPauseRuntime();
    disposeSettingsAvailability();
    disposeAbilityRangeSettingsGuard();
    disposeGameMenu();
    disposeGameMenuQuickKeys();
    disposeBrowserInteractionGuards();
    disposeFpsOverlay();
    disposeResponsiveHudScale();
    disposePingPresentationEnhancements();
    disposePingWheel();
    disposeHeroFunctionKeyControls();
    disposeInventoryControls();
    disposeGameplayKeybindBridge();
    disposeGameCameraControls();
    disposeMinimapDragCamera();
    disposeTowerPortraitAssets();
    disposeSelectionHudNameLayout();
  });
}
