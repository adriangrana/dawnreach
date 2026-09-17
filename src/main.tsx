import ReactDOM from 'react-dom/client';
import PlatformShell from './platform/PlatformShell';
import { bootstrapAuthTokenStorage } from './platform/authToken';
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
import './platform-shell.css';

const BOOT_SPLASH_ID = 'dawnreach-boot-splash';
const BOOT_SPLASH_MAX_WAIT_MS = 12_000;

function nextAnimationFrame() {
  return new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
}

async function waitForPlatformReady() {
  const startedAt = performance.now();
  while (performance.now() - startedAt < BOOT_SPLASH_MAX_WAIT_MS) {
    await nextAnimationFrame();
    const shell = document.querySelector<HTMLElement>('[data-dawnreach-platform-ready="true"]');
    if (!shell) continue;
    if (!Array.from(document.images).every(image => image.complete)) continue;
    await nextAnimationFrame();
    return;
  }
  console.warn('[Dawnreach] Platform boot readiness watchdog expired; continuing.');
}

function dismissBootSplash() {
  const splash = document.getElementById(BOOT_SPLASH_ID);
  if (!splash) return;
  splash.classList.add('is-ready');
  window.setTimeout(() => splash.remove(), 280);
}

async function boot() {
  await bootstrapAuthTokenStorage();
  ReactDOM.createRoot(document.getElementById('root')!).render(<PlatformShell />);
  await waitForPlatformReady();
  dismissBootSplash();
}

void boot().catch(error => {
  console.error('[Dawnreach] Platform boot failed.', error);
  ReactDOM.createRoot(document.getElementById('root')!).render(<PlatformShell />);
  void waitForPlatformReady().then(dismissBootSplash);
});
