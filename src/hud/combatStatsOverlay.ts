import {
  getWorldAttackEventsAfter,
  subscribeWorldCombatEvents,
} from '../game/entities/worldCombatBridge';

export type CombatHudStats = Readonly<{
  kills: number;
  deaths: number;
  assists: number;
  lastHits: number;
  denies: number;
}>;

type MutableCombatHudStats = {
  kills: number;
  deaths: number;
  assists: number;
  lastHits: number;
  denies: number;
};

const LOCAL_WORLD_HERO_ENTITY_ID = 'blue-hero-alden';
const HERO_ASSIST_WINDOW_MS = 10_000;
const PANEL_ID = 'dawnreach-combat-stats';
const SETTINGS_BUTTON_ID = 'dawnreach-combat-settings-button';
const listeners = new Set<(stats: CombatHudStats) => void>();
const stats: MutableCombatHudStats = {
  kills: 0,
  deaths: 0,
  assists: 0,
  lastHits: 0,
  denies: 0,
};
let lastRecordedDeathAtMs = -1;
let lastRecordedKillKey = '';
let lastRecordedAssistKey = '';
let worldSubscriptionStarted = false;

function snapshot(): CombatHudStats {
  return { ...stats };
}

export function getCombatHudStatsSnapshot(): CombatHudStats {
  return snapshot();
}

function publish() {
  const next = snapshot();
  for (const listener of listeners) listener(next);
}

export function subscribeCombatHudStats(listener: (stats: CombatHudStats) => void): () => void {
  listeners.add(listener);
  listener(snapshot());
  return () => {
    listeners.delete(listener);
  };
}

export function recordCombatHudStat(stat: keyof MutableCombatHudStats, amount = 1) {
  if (!Number.isFinite(amount) || amount === 0) return;
  stats[stat] = Math.max(0, stats[stat] + Math.trunc(amount));
  publish();
}

export function setCombatHudStats(next: Partial<MutableCombatHudStats>) {
  for (const key of Object.keys(next) as Array<keyof MutableCombatHudStats>) {
    const value = next[key];
    if (value === undefined || !Number.isFinite(value)) continue;
    stats[key] = Math.max(0, Math.trunc(value));
  }
  publish();
}

function localHeroParticipatedInHeroKill(targetId: string, atMs: number) {
  const attacks = getWorldAttackEventsAfter(0);
  for (let index = attacks.length - 1; index >= 0; index--) {
    const attack = attacks[index];
    const ageMs = atMs - attack.atMs;
    if (ageMs > HERO_ASSIST_WINDOW_MS) break;
    if (ageMs < -4 || attack.targetId !== targetId) continue;
    if (attack.targetKind !== 'hero' || attack.attackerKind !== 'hero') continue;
    if (attack.attackerId !== LOCAL_WORLD_HERO_ENTITY_ID) continue;
    if (attack.attackerTeam === attack.targetTeam) continue;
    return true;
  }
  return false;
}

function startWorldCombatSubscription() {
  if (worldSubscriptionStarted) return;
  worldSubscriptionStarted = true;
  subscribeWorldCombatEvents((event) => {
    if (event.reason !== 'death') return;

    if (event.entityId === LOCAL_WORLD_HERO_ENTITY_ID) {
      if (event.atMs === lastRecordedDeathAtMs) return;
      lastRecordedDeathAtMs = event.atMs;
      recordCombatHudStat('deaths');
      return;
    }

    if (!localHeroParticipatedInHeroKill(event.entityId, event.atMs)) return;
    const participationKey = `${event.entityId}:${event.atMs}`;

    if (event.sourceEntityId === LOCAL_WORLD_HERO_ENTITY_ID) {
      if (participationKey === lastRecordedKillKey) return;
      lastRecordedKillKey = participationKey;
      recordCombatHudStat('kills');
      return;
    }

    if (participationKey === lastRecordedAssistKey) return;
    lastRecordedAssistKey = participationKey;
    recordCombatHudStat('assists');
  });
}

function statRow(label: string, valueClass: string) {
  const row = document.createElement('div');
  row.className = 'combat-stats-row';

  const name = document.createElement('span');
  name.className = 'combat-stats-label';
  name.textContent = label;

  const value = document.createElement('span');
  value.className = `combat-stats-value ${valueClass}`;

  row.append(name, value);
  return row;
}

function createSettingsButton() {
  const button = document.createElement('button');
  button.id = SETTINGS_BUTTON_ID;
  button.className = 'combat-stats-settings-button';
  button.type = 'button';
  button.title = 'Menú de partida (F10)';
  button.setAttribute('aria-label', 'Abrir menú de partida');
  button.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 8.25a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5Z" />
      <path d="M19.3 13.5a7.58 7.58 0 0 0 .05-3l2.02-1.57-1.9-3.29-2.39.96a7.8 7.8 0 0 0-2.58-1.5L14.14 2.5h-3.8L9.97 5.1A7.8 7.8 0 0 0 7.4 6.6L5 5.64 3.1 8.93l2.02 1.57a7.58 7.58 0 0 0 .05 3l-2.07 1.6L5 18.4l2.45-.98a7.7 7.7 0 0 0 2.52 1.46l.37 2.62h3.8l.37-2.62a7.7 7.7 0 0 0 2.52-1.46l2.45.98 1.9-3.3-2.08-1.6Z" />
    </svg>`;
  button.addEventListener('click', () => {
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'F10',
      code: 'F10',
      bubbles: true,
      cancelable: true,
    }));
  });
  return button;
}

function renderStats(panel: HTMLElement, current: CombatHudStats) {
  const kda = panel.querySelector<HTMLElement>('.combat-stats-value--kda');
  const lane = panel.querySelector<HTMLElement>('.combat-stats-value--lane');
  if (kda) kda.textContent = `${current.kills} / ${current.deaths} / ${current.assists}`;
  if (lane) lane.textContent = `${current.lastHits} / ${current.denies}`;
}

export function mountCombatStatsOverlay() {
  if (typeof document === 'undefined') return () => undefined;
  startWorldCombatSubscription();

  document.getElementById(PANEL_ID)?.remove();
  document.getElementById(SETTINGS_BUTTON_ID)?.remove();

  const settingsButton = createSettingsButton();
  const panel = document.createElement('aside');
  panel.id = PANEL_ID;
  panel.className = 'combat-stats-overlay';
  panel.setAttribute('aria-label', 'Estadísticas de combate');
  panel.append(
    statRow('K/D/A', 'combat-stats-value--kda'),
    statRow('LH/DN', 'combat-stats-value--lane'),
  );
  document.body.append(settingsButton, panel);

  const unsubscribe = subscribeCombatHudStats((current) => renderStats(panel, current));
  return () => {
    unsubscribe();
    settingsButton.remove();
    panel.remove();
  };
}
