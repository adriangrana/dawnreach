import { subscribeWorldCombatEvents } from '../game/entities/worldCombatBridge';

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
const PANEL_ID = 'dawnreach-combat-stats';
const listeners = new Set<(stats: CombatHudStats) => void>();
const stats: MutableCombatHudStats = {
  kills: 0,
  deaths: 0,
  assists: 0,
  lastHits: 0,
  denies: 0,
};
let lastRecordedDeathAtMs = -1;
let worldSubscriptionStarted = false;

function snapshot(): CombatHudStats {
  return { ...stats };
}

function publish() {
  const next = snapshot();
  for (const listener of listeners) listener(next);
}

export function subscribeCombatHudStats(listener: (stats: CombatHudStats) => void) {
  listeners.add(listener);
  listener(snapshot());
  return () => listeners.delete(listener);
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

function startWorldCombatSubscription() {
  if (worldSubscriptionStarted) return;
  worldSubscriptionStarted = true;
  subscribeWorldCombatEvents((event) => {
    if (event.entityId !== LOCAL_WORLD_HERO_ENTITY_ID || event.reason !== 'death') return;
    if (event.atMs === lastRecordedDeathAtMs) return;
    lastRecordedDeathAtMs = event.atMs;
    recordCombatHudStat('deaths');
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

  const panel = document.createElement('aside');
  panel.id = PANEL_ID;
  panel.className = 'combat-stats-overlay';
  panel.setAttribute('aria-label', 'Estadísticas de combate');
  panel.append(
    statRow('K/D/A', 'combat-stats-value--kda'),
    statRow('LH/DN', 'combat-stats-value--lane'),
  );
  document.body.append(panel);

  const unsubscribe = subscribeCombatHudStats((current) => renderStats(panel, current));
  return () => {
    unsubscribe();
    panel.remove();
  };
}
