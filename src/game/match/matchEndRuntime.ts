import { subscribeWorldCombatEvents } from '../entities/worldCombatBridge';
import { requestMatchPause } from './matchPauseRuntime';

export const MATCH_FINISHED_EVENT = 'dawnreach:match-finished';

export type MatchWinner = 'dawn' | 'dusk';

export type MatchFinishedDetail = Readonly<{
  winner: MatchWinner;
  loser: MatchWinner;
  destroyedThroneId: 'blue-throne' | 'red-throne';
  finishedAtMs: number;
}>;

type MatchEndState = {
  finished: boolean;
  result: MatchFinishedDetail | null;
};

const OVERLAY_ID = 'dawnreach-match-end-overlay';
const MENU_ROOT_ID = 'dawnreach-game-menu';
const LOCAL_TEAM: MatchWinner = 'dawn';

const state: MatchEndState = {
  finished: false,
  result: null,
};

let installed = false;

function throneResult(entityId: string, finishedAtMs: number): MatchFinishedDetail | null {
  if (entityId === 'red-throne') {
    return {
      winner: 'dawn',
      loser: 'dusk',
      destroyedThroneId: 'red-throne',
      finishedAtMs,
    };
  }
  if (entityId === 'blue-throne') {
    return {
      winner: 'dusk',
      loser: 'dawn',
      destroyedThroneId: 'blue-throne',
      finishedAtMs,
    };
  }
  return null;
}

export function getMatchEndSnapshot(): Readonly<MatchEndState> {
  return {
    finished: state.finished,
    result: state.result ? { ...state.result } : null,
  };
}

export function isMatchFinished() {
  return state.finished;
}

function ensureOverlay() {
  let root = document.getElementById(OVERLAY_ID);
  if (root) return root;

  root = document.createElement('section');
  root.id = OVERLAY_ID;
  root.className = 'match-end-overlay';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-live', 'assertive');
  root.innerHTML = `
    <div class="match-end-vignette" aria-hidden="true"></div>
    <div class="match-end-panel">
      <span class="match-end-kicker">DAWNREACH</span>
      <strong class="match-end-title">VICTORIA</strong>
      <div class="match-end-divider" aria-hidden="true"><i></i><b></b><i></i></div>
      <p class="match-end-copy">El trono enemigo ha caído.</p>
      <small class="match-end-team">EQUIPO DEL ALBA</small>
    </div>`;
  document.body.appendChild(root);
  return root;
}

function renderResult(detail: MatchFinishedDetail) {
  const root = ensureOverlay();
  const localVictory = detail.winner === LOCAL_TEAM;
  root.hidden = false;
  root.classList.toggle('is-victory', localVictory);
  root.classList.toggle('is-defeat', !localVictory);

  const title = root.querySelector<HTMLElement>('.match-end-title');
  const copy = root.querySelector<HTMLElement>('.match-end-copy');
  const team = root.querySelector<HTMLElement>('.match-end-team');
  if (title) title.textContent = localVictory ? 'VICTORIA' : 'DERROTA';
  if (copy) {
    copy.textContent = localVictory
      ? 'El trono del Ocaso ha caído.'
      : 'El trono del Alba ha sido destruido.';
  }
  if (team) team.textContent = detail.winner === 'dawn' ? 'EQUIPO DEL ALBA' : 'EQUIPO DEL OCASO';

  requestAnimationFrame(() => root.classList.add('is-visible'));
}

function finishMatch(detail: MatchFinishedDetail) {
  if (state.finished) return;
  state.finished = true;
  state.result = detail;
  document.body.dataset.dawnreachMatchFinished = 'true';
  document.body.dataset.dawnreachMatchWinner = detail.winner;

  // Reuse Dawnreach's authoritative pause clock. This freezes Three.js clocks and the
  // pause-aware match timestamp, so creeps, cooldowns, regeneration and the HUD clock stop
  // on the exact terminal state instead of continuing behind the result screen.
  requestMatchPause(true, 'match-end');
  renderResult(detail);

  window.dispatchEvent(new CustomEvent<MatchFinishedDetail>(MATCH_FINISHED_EVENT, {
    detail: { ...detail },
  }));
}

function isResumeAction(target: EventTarget | null) {
  return target instanceof Element
    && Boolean(target.closest(`#${MENU_ROOT_ID} [data-action="resume"]`));
}

/**
 * Owns the terminal local-match state until MatchState itself becomes server-authoritative.
 * The source of truth is an authoritative world combat death event from one of the two thrones,
 * never DOM inspection or HP polling.
 */
export function installMatchEndRuntime() {
  if (installed) return () => undefined;
  installed = true;
  document.body.dataset.dawnreachMatchFinished = 'false';

  const unsubscribeCombat = subscribeWorldCombatEvents((event) => {
    if (state.finished || event.reason !== 'death' || event.currentHp > 0 || event.alive) return;
    const result = throneResult(event.entityId, event.atMs);
    if (result) finishMatch(result);
  });

  // The global pause overlay normally allows F10 -> Resume. Once a throne is destroyed that
  // action must never restart simulation; the result is terminal for the current match.
  const blockResumeAfterFinish = (event: MouseEvent) => {
    if (!state.finished || !isResumeAction(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  window.addEventListener('click', blockResumeAfterFinish, true);

  return () => {
    installed = false;
    unsubscribeCombat();
    window.removeEventListener('click', blockResumeAfterFinish, true);
    document.getElementById(OVERLAY_ID)?.remove();
    delete document.body.dataset.dawnreachMatchWinner;
    document.body.dataset.dawnreachMatchFinished = 'false';
    state.finished = false;
    state.result = null;
  };
}
