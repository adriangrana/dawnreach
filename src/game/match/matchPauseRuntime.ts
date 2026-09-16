import * as THREE from 'three';

export const MATCH_PAUSE_REQUEST_EVENT = 'dawnreach:match-pause-request';
export const MATCH_PAUSE_STATE_EVENT = 'dawnreach:match-pause-state';

const PAUSE_OVERLAY_ID = 'dawnreach-match-pause-overlay';
const MENU_ROOT_ID = 'dawnreach-game-menu';
const LOCAL_PLAYER_ID = 'local-player';

export type MatchPauseRequestDetail = Readonly<{
  paused: boolean;
  requestedByPlayerId: string;
  requestedAtMs: number;
}>;

export type MatchPauseStateDetail = Readonly<{
  paused: boolean;
  pausedByPlayerId: string | null;
  changedAtMs: number;
  pauseStartedAtMs: number | null;
  accumulatedPauseMs: number;
}>;

type MutablePauseState = {
  paused: boolean;
  pausedByPlayerId: string | null;
  changedAtMs: number;
  pauseStartedAtMs: number | null;
  accumulatedPauseMs: number;
};

const state: MutablePauseState = {
  paused: false,
  pausedByPlayerId: null,
  changedAtMs: 0,
  pauseStartedAtMs: null,
  accumulatedPauseMs: 0,
};

let installed = false;

function realNowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function getMatchPauseSnapshot(): MatchPauseStateDetail {
  return { ...state };
}

export function isMatchPaused() {
  return state.paused;
}

/**
 * Converts the browser's monotonic clock into Dawnreach match time. Time spent in a global
 * pause is removed, so cooldowns, regeneration, respawn timers and the match clock do not
 * advance while every player is paused.
 *
 * The conversion is intentionally idempotent for current/live timestamps: HUD bridges may
 * normalize an event before it reaches the reducer, and normalizing that value again must not
 * subtract the accumulated pause a second time.
 */
export function toMatchGameTimeMs(timestampMs = realNowMs()) {
  const currentRealMs = realNowMs();
  const currentLivePauseMs = state.paused && state.pauseStartedAtMs !== null
    ? Math.max(0, currentRealMs - state.pauseStartedAtMs)
    : 0;
  const currentOffsetMs = state.accumulatedPauseMs + currentLivePauseMs;
  const currentMatchMs = Math.max(0, currentRealMs - currentOffsetMs);

  // A timestamp at or behind the current match clock is already expressed in match time.
  // Live browser timestamps after at least one pause remain ahead by approximately the pause
  // offset and therefore take the conversion path below.
  if (timestampMs <= currentMatchMs + 1) return Math.max(0, timestampMs);

  const livePauseAtTimestamp = state.paused && state.pauseStartedAtMs !== null
    ? Math.max(0, timestampMs - state.pauseStartedAtMs)
    : 0;
  return Math.max(0, timestampMs - state.accumulatedPauseMs - livePauseAtTimestamp);
}

export function requestMatchPause(paused: boolean, requestedByPlayerId = LOCAL_PLAYER_ID) {
  window.dispatchEvent(new CustomEvent<MatchPauseRequestDetail>(MATCH_PAUSE_REQUEST_EVENT, {
    detail: {
      paused,
      requestedByPlayerId,
      requestedAtMs: realNowMs(),
    },
  }));
}

/**
 * Applies a match-authoritative pause decision. The local build uses one authority for the
 * whole match. A future network session can forward MATCH_PAUSE_REQUEST_EVENT to the server
 * and feed the replicated decision back through this function on every client.
 */
export function applyAuthoritativeMatchPause(
  paused: boolean,
  pausedByPlayerId: string | null,
  changedAtMs = realNowMs(),
) {
  if (state.paused === paused) return;

  if (paused) {
    state.paused = true;
    state.pausedByPlayerId = pausedByPlayerId;
    state.pauseStartedAtMs = changedAtMs;
  } else {
    if (state.pauseStartedAtMs !== null) {
      state.accumulatedPauseMs += Math.max(0, changedAtMs - state.pauseStartedAtMs);
    }
    state.paused = false;
    state.pausedByPlayerId = null;
    state.pauseStartedAtMs = null;
  }
  state.changedAtMs = changedAtMs;

  document.body.dataset.dawnreachMatchPaused = String(state.paused);
  renderPauseOverlay();
  refreshMenuPauseAction();
  window.dispatchEvent(new CustomEvent<MatchPauseStateDetail>(MATCH_PAUSE_STATE_EVENT, {
    detail: getMatchPauseSnapshot(),
  }));
}

function ensurePauseOverlay() {
  let root = document.getElementById(PAUSE_OVERLAY_ID);
  if (root) return root;
  root = document.createElement('div');
  root.id = PAUSE_OVERLAY_ID;
  root.className = 'match-pause-overlay';
  root.hidden = true;
  root.setAttribute('aria-live', 'polite');
  root.innerHTML = `
    <div class="match-pause-emblem" aria-hidden="true"><span></span><span></span></div>
    <div class="match-pause-copy">
      <small>DAWNREACH</small>
      <strong>PARTIDA PAUSADA</strong>
      <p>La batalla está detenida para todos los jugadores.</p>
      <span>F10 · MENÚ DE PARTIDA</span>
    </div>`;
  document.body.appendChild(root);
  return root;
}

function renderPauseOverlay() {
  const root = ensurePauseOverlay();
  root.hidden = !state.paused;
  root.classList.toggle('is-visible', state.paused);
}

function setText(element: HTMLElement | null, value: string) {
  if (element && element.textContent !== value) element.textContent = value;
}

function refreshMenuPauseAction() {
  const menu = document.getElementById(MENU_ROOT_ID);
  const button = menu?.querySelector<HTMLButtonElement>('[data-action="resume"]');
  if (!button) return;

  const strong = button.querySelector<HTMLElement>('strong');
  const small = button.querySelector<HTMLElement>('small');
  const index = button.querySelector<HTMLElement>('.game-menu-action-index');
  setText(index, '01');

  if (state.paused) {
    setText(strong, 'Reanudar partida');
    setText(small, 'Reanudar la batalla para todos los jugadores');
    button.classList.add('game-menu-primary-action--resume');
    button.classList.remove('game-menu-primary-action--pause');
  } else {
    setText(strong, 'Pausar partida');
    setText(small, 'Detener temporalmente la batalla para todos');
    button.classList.remove('game-menu-primary-action--resume');
    button.classList.add('game-menu-primary-action--pause');
  }
}

function isMenuTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(`#${MENU_ROOT_ID}`));
}

function shouldBlockPointerTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  if (isMenuTarget(target)) return false;
  if (target.closest('#dawnreach-combat-settings-button')) return false;
  return Boolean(target.closest('.game-canvas, .minimap-live, .game-hud, .shop-overlay, .shop-panel'));
}

/**
 * Installs the single match pause authority used by the current local runtime. The pause state
 * itself is match-wide rather than tied to F10: opening the menu never changes simulation time.
 */
export function installMatchPauseRuntime() {
  if (installed) return () => undefined;
  installed = true;
  document.body.dataset.dawnreachMatchPaused = 'false';

  const clockPrototype = THREE.Clock.prototype;
  const originalGetDelta = clockPrototype.getDelta;
  clockPrototype.getDelta = function pausedAwareGetDelta(this: THREE.Clock) {
    // Always call the real clock so its internal oldTime stays current. Returning zero while
    // paused prevents a large catch-up delta on the first frame after resuming.
    const delta = originalGetDelta.call(this);
    return state.paused ? 0 : delta;
  };

  const onPauseRequest = (event: Event) => {
    const detail = (event as CustomEvent<MatchPauseRequestDetail>).detail;
    if (!detail || typeof detail.paused !== 'boolean') return;
    applyAuthoritativeMatchPause(
      detail.paused,
      detail.paused ? detail.requestedByPlayerId || LOCAL_PLAYER_ID : null,
      detail.requestedAtMs || realNowMs(),
    );
  };

  const onClickCapture = (event: MouseEvent) => {
    const target = event.target instanceof Element
      ? event.target.closest<HTMLElement>(`#${MENU_ROOT_ID} [data-action="resume"]`)
      : null;
    if (!target) return;

    // The legacy menu action only closed F10. Own it at capture phase and reinterpret it as
    // match-wide pause/resume. Close the menu afterwards; the dedicated pause overlay remains.
    event.preventDefault();
    event.stopImmediatePropagation();
    requestMatchPause(!state.paused);
    window.dispatchEvent(new KeyboardEvent('keydown', {
      code: 'F10',
      key: 'F10',
      bubbles: true,
      cancelable: true,
    }));
  };

  const onPointerCapture = (event: PointerEvent) => {
    if (!state.paused || !shouldBlockPointerTarget(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const onContextMenuCapture = (event: MouseEvent) => {
    if (!state.paused || !shouldBlockPointerTarget(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const onKeyDownCapture = (event: KeyboardEvent) => {
    if (!state.paused || event.code === 'F10' || isMenuTarget(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const menuObserver = new MutationObserver(() => refreshMenuPauseAction());
  menuObserver.observe(document.body, { subtree: true, childList: true });

  window.addEventListener(MATCH_PAUSE_REQUEST_EVENT, onPauseRequest as EventListener);
  window.addEventListener('click', onClickCapture, true);
  window.addEventListener('pointerdown', onPointerCapture, true);
  window.addEventListener('contextmenu', onContextMenuCapture, true);
  window.addEventListener('keydown', onKeyDownCapture, true);

  renderPauseOverlay();
  refreshMenuPauseAction();

  return () => {
    installed = false;
    menuObserver.disconnect();
    window.removeEventListener(MATCH_PAUSE_REQUEST_EVENT, onPauseRequest as EventListener);
    window.removeEventListener('click', onClickCapture, true);
    window.removeEventListener('pointerdown', onPointerCapture, true);
    window.removeEventListener('contextmenu', onContextMenuCapture, true);
    window.removeEventListener('keydown', onKeyDownCapture, true);
    clockPrototype.getDelta = originalGetDelta;
    document.body.dataset.dawnreachMatchPaused = 'false';
    document.getElementById(PAUSE_OVERLAY_ID)?.remove();
    state.paused = false;
    state.pausedByPlayerId = null;
    state.pauseStartedAtMs = null;
    state.accumulatedPauseMs = 0;
    state.changedAtMs = 0;
  };
}
