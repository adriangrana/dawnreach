import ReactDOM from 'react-dom/client';
import App from './App';
import { mountAldenAudioRuntime } from './game/heroes/alden/aldenAudioRuntime';
import { mountAldenWorldAbilityBootstrap } from './game/heroes/alden/worldAbilityBootstrap';
import { warmTeleportPortalGeometry } from './game/items/teleportPortalWarmup';
import { installMatchEndRuntime } from './game/match/matchEndRuntime';
import { installMatchEventAnnouncementRuntime } from './game/match/matchEventAnnouncements';
import { installMatchEventRuntime } from './game/match/matchEventRuntime';
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
import { mountInGameChat } from './hud/inGameChat';
import { mountInventoryControls } from './hud/inventoryControls';
import { mountMatchEventBanner } from './hud/matchEventBanner';
import { mountMatchEventFeed } from './hud/matchEventFeed';
import { mountMinimapDragCamera } from './hud/minimapDragCamera';
import { mountPingPresentationEnhancements } from './hud/pingPresentationEnhancements';
import { mountPingWheel } from './hud/pingWheel';
import { mountResponsiveHudScale } from './hud/responsiveHudScale';
import { mountSelectionHudNameLayout } from './hud/selectionHudNameLayout';
import { mountSettingsAvailability } from './hud/settingsAvailability';
import { mountSettingsSliderValueGuard } from './hud/settingsSliderValueGuard';
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
import './match-end.css';
import './match-event-feed.css';
import './match-event-banner.css';
import './in-game-chat.css';
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

const disposeMatchEventRuntime = installMatchEventRuntime();
const disposeMatchEventAnnouncementRuntime = installMatchEventAnnouncementRuntime();
const disposeMatchEndRuntime = installMatchEndRuntime();
const disposeMatchPauseRuntime = installMatchPauseRuntime();
const disposeRuntimePerformanceTuning = installRuntimePerformanceTuning();
const disposeShadowInvalidationBridge = installShadowInvalidationBridge();
const disposeAldenWorldAbilityRuntime = mountAldenWorldAbilityBootstrap();

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);

const disposeMatchEventFeed = mountMatchEventFeed();
const disposeMatchEventBanner = mountMatchEventBanner();
// Mount chat before gameplay key handlers. Its capture listeners own keyboard/pointer input while
// composing so typing can never leak Q/W/E/R/A/S/H or world-click orders into the simulation.
const disposeInGameChat = mountInGameChat();
const disposeAldenAudioRuntime = mountAldenAudioRuntime();

const disposeGameMenuQuickKeys = mountGameMenuQuickKeys();
const disposeGameMenu = mountGameMenu();
const disposeSettingsSliderValueGuard = mountSettingsSliderValueGuard();
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
    disposeAldenAudioRuntime();
    disposeInGameChat();
    disposeMatchEventBanner();
    disposeMatchEventFeed();
    disposeAldenWorldAbilityRuntime();
    disposeShadowInvalidationBridge();
    disposeRuntimePerformanceTuning();
    disposeMatchPauseRuntime();
    disposeMatchEndRuntime();
    disposeMatchEventAnnouncementRuntime();
    disposeMatchEventRuntime();
    disposeSettingsAvailability();
    disposeSettingsSliderValueGuard();
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
