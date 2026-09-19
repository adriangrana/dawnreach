import { BarChart3, Coins, Crown, Home, RotateCcw, Shield, Swords, Timer, Trophy } from 'lucide-react';
import { getHeroDefinition } from '../game/heroes/catalog';
import { getItemIconDataUrl } from '../game/items/itemVisuals';
import type { MatchEndedEvent, MatchRuntimePlayerState, MatchPlayer, PlatformUser, Team } from './types';

const heroPortraitModules = import.meta.glob<string>('../game/heroes/*/images/*.webp', {
  eager: true,
  query: '?url',
  import: 'default',
});

const heroPortraitsById = new Map<string, string>();
for (const [path, url] of Object.entries(heroPortraitModules)) {
  const match = /\/images\/(H\d+)\.webp$/i.exec(path);
  if (match?.[1]) heroPortraitsById.set(match[1].toUpperCase(), url);
}

type FinalPlayer = Readonly<{
  player: MatchPlayer;
  state: MatchRuntimePlayerState;
  heroName: string;
  portrait?: string;
}>;

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value: number) {
  return Math.max(0, Math.round(value)).toLocaleString('en-US');
}

function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function safeHeroName(heroId: string) {
  try {
    return getHeroDefinition(heroId).displayName;
  } catch {
    return heroId || 'Unknown Hero';
  }
}

function fallbackState(player: MatchPlayer, heroId: string): MatchRuntimePlayerState {
  return {
    userId: player.userId,
    username: player.username,
    team: player.team,
    slot: player.slot,
    heroId,
    sequence: 0,
    position: { x: 0, y: 0, z: 0 },
    yaw: 0,
    moving: false,
    currentHp: 0,
    maxHp: 0,
    currentResource: 0,
    maxResource: 0,
    level: 1,
    experience: 0,
    alive: false,
    kills: 0,
    deaths: 0,
    assists: 0,
    lastHits: 0,
    denies: 0,
    gold: 0,
    damageDealt: 0,
    damageTaken: 0,
    healingDone: 0,
    inventory: [],
    sentAt: 0,
  };
}

function buildFinalPlayers(result: MatchEndedEvent): FinalPlayer[] {
  const byUserId = new Map((result.finalStates ?? []).map(state => [state.userId, state] as const));
  return result.match.players
    .map(player => {
      const heroId = result.match.heroSelections?.[player.userId]?.heroId || byUserId.get(player.userId)?.heroId || 'H001';
      const state = byUserId.get(player.userId) ?? fallbackState(player, heroId);
      return {
        player,
        state,
        heroName: safeHeroName(heroId),
        portrait: heroPortraitsById.get(heroId.toUpperCase()),
      };
    })
    .sort((left, right) => left.player.team.localeCompare(right.player.team) || left.player.slot - right.player.slot);
}

function teamLabel(team: Team) {
  return team === 'blue' ? 'DAWN TEAM' : 'DUSK TEAM';
}

function resultTitle(result: MatchEndedEvent, localTeam: Team | null) {
  if (result.voided || !result.winnerTeam) return 'MATCH CANCELLED';
  return result.winnerTeam === localTeam ? 'VICTORY' : 'DEFEAT';
}

function mvpScore(entry: FinalPlayer) {
  const state = entry.state;
  return (
    number(state.kills) * 4
    + number(state.assists) * 1.8
    - number(state.deaths) * 1.35
    + number(state.damageDealt) / 1200
    + number(state.gold) / 1800
    + number(state.lastHits) * 0.05
    + number(state.denies) * 0.25
  );
}

function itemSlots(state: MatchRuntimePlayerState) {
  const itemsBySlot = new Map(state.inventory.map(item => [item.slot, item] as const));
  return Array.from({ length: 6 }, (_, slot) => itemsBySlot.get(slot) ?? null);
}

function TeamTable({
  team,
  entries,
  localUserId,
  mvpUserId,
}: {
  team: Team;
  entries: readonly FinalPlayer[];
  localUserId: string;
  mvpUserId: string | null;
}) {
  const kills = entries.reduce((sum, entry) => sum + number(entry.state.kills), 0);
  const deaths = entries.reduce((sum, entry) => sum + number(entry.state.deaths), 0);
  const assists = entries.reduce((sum, entry) => sum + number(entry.state.assists), 0);
  return (
    <section className={`dr-post-team dr-post-team--${team}`}>
      <header className="dr-post-team-header">
        <strong>{teamLabel(team)}</strong>
        <span>{kills} / {deaths} / {assists}</span>
      </header>
      <div className="dr-post-table-head" aria-hidden="true">
        <span>PLAYER</span>
        <span>K / D / A</span>
        <span>LH / DN</span>
        <span>GOLD</span>
        <span>DMG DEALT</span>
        <span>DMG TAKEN</span>
        <span>ITEMS</span>
      </div>
      <div className="dr-post-team-rows">
        {entries.map(entry => {
          const state = entry.state;
          const local = entry.player.userId === localUserId;
          const mvp = entry.player.userId === mvpUserId;
          return (
            <article
              key={entry.player.userId}
              className={`dr-post-player-row${local ? ' is-local' : ''}${mvp ? ' is-mvp' : ''}`}
            >
              <div className="dr-post-player">
                <span className="dr-post-level">{Math.max(1, Math.floor(number(state.level)))}</span>
                <div className="dr-post-portrait">
                  {entry.portrait ? <img src={entry.portrait} alt="" draggable={false} /> : <Shield />}
                </div>
                <div className="dr-post-player-copy">
                  <strong>{entry.heroName}</strong>
                  <span>{entry.player.username}{local ? ' · YOU' : ''}</span>
                </div>
              </div>
              <b className="dr-post-kda">{state.kills} / {state.deaths} / {state.assists}</b>
              <span>{state.lastHits} / {state.denies}</span>
              <span>{formatNumber(number(state.gold))}</span>
              <span>{formatNumber(number(state.damageDealt))}</span>
              <span>{formatNumber(number(state.damageTaken))}</span>
              <div className="dr-post-items" aria-label="Final inventory">
                {itemSlots(state).map((item, index) => (
                  <span key={index} className={`dr-post-item${item ? ' has-item' : ''}`}>
                    {item && <img src={getItemIconDataUrl(item.definitionId)} alt={item.displayName} draggable={false} />}
                    {item && item.quantity > 1 && <em>{item.quantity}</em>}
                  </span>
                ))}
              </div>
              {mvp && <span className="dr-post-mvp-tag"><Crown /> MVP</span>}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function PostMatchScreen({
  result,
  me,
  onContinue,
  onPlayAgain,
}: {
  result: MatchEndedEvent;
  me: PlatformUser;
  onContinue: () => void;
  onPlayAgain: () => void;
}) {
  const players = buildFinalPlayers(result);
  const localTeam = result.match.players.find(player => player.userId === me.id)?.team ?? null;
  const dawn = players.filter(entry => entry.player.team === 'blue');
  const dusk = players.filter(entry => entry.player.team === 'red');
  const dawnKills = dawn.reduce((sum, entry) => sum + number(entry.state.kills), 0);
  const duskKills = dusk.reduce((sum, entry) => sum + number(entry.state.kills), 0);
  const endedAtMs = Date.parse(result.match.endedAt || '');
  const startedAtMs = Date.parse(result.match.startedAt || result.match.createdAt);
  const fallbackDurationMs = Number.isFinite(endedAtMs) && Number.isFinite(startedAtMs)
    ? Math.max(0, endedAtMs - startedAtMs)
    : 0;
  const durationMs = number(result.durationMs) || fallbackDurationMs;
  const mvpPool = result.winnerTeam
    ? players.filter(entry => entry.player.team === result.winnerTeam)
    : players;
  const mvp = [...mvpPool].sort((left, right) => mvpScore(right) - mvpScore(left))[0] ?? null;
  const local = players.find(entry => entry.player.userId === me.id) ?? null;
  const maxDamage = Math.max(1, ...players.map(entry => number(entry.state.damageDealt)));
  const localResult = resultTitle(result, localTeam);
  const totalGold = players.reduce((sum, entry) => sum + number(entry.state.gold), 0);
  const localCreepScore = local ? number(local.state.lastHits) + number(local.state.denies) : 0;

  return (
    <main className="dr-post-match">
      <div className="dr-post-backdrop" aria-hidden="true" />
      <header className="dr-post-topbar">
        <div className="dr-post-brand">
          <img src="/assets/icon/dawnreach.png" alt="" draggable={false} />
          <span><strong>DAWNREACH</strong><small>A BRIGHTER TOMORROW</small></span>
        </div>
        <div className="dr-post-result">
          <span className="dr-post-score dr-post-score--blue">{dawnKills}</span>
          <div>
            <small>{result.match.mode.toUpperCase()} · {formatDuration(durationMs)}</small>
            <h1 className={localResult === 'VICTORY' ? 'is-victory' : localResult === 'DEFEAT' ? 'is-defeat' : ''}>{localResult}</h1>
          </div>
          <span className="dr-post-score dr-post-score--red">{duskKills}</span>
        </div>
        <div className="dr-post-user">
          <strong>{me.username}</strong>
          <span>POST-MATCH REPORT</span>
        </div>
      </header>

      <nav className="dr-post-tabs" aria-label="Post match sections">
        <button type="button" className="is-active">OVERVIEW</button>
        <button type="button" disabled>DETAILED STATS</button>
        <button type="button" disabled>GRAPHS</button>
        <button type="button" disabled>TIMELINE</button>
      </nav>

      <section className="dr-post-content">
        <div className="dr-post-main">
          <TeamTable team="blue" entries={dawn} localUserId={me.id} mvpUserId={mvp?.player.userId ?? null} />
          <TeamTable team="red" entries={dusk} localUserId={me.id} mvpUserId={mvp?.player.userId ?? null} />
        </div>

        <aside className="dr-post-side">
          <section className="dr-post-panel dr-post-mvp-panel">
            <header><Trophy /> MATCH MVP</header>
            {mvp ? <>
              <div className="dr-post-mvp-hero">
                <div className="dr-post-mvp-art">
                  {mvp.portrait ? <img src={mvp.portrait} alt="" draggable={false} /> : <Shield />}
                </div>
                <div>
                  <span className="dr-post-grade">S+</span>
                  <strong>{mvp.heroName}</strong>
                  <small>{mvp.player.username}</small>
                </div>
              </div>
              <div className="dr-post-mvp-metrics">
                <span><b>{mvp.state.kills} / {mvp.state.deaths} / {mvp.state.assists}</b><small>K / D / A</small></span>
                <span><b>{formatNumber(number(mvp.state.damageDealt))}</b><small>DAMAGE</small></span>
                <span><b>{formatNumber(number(mvp.state.gold))}</b><small>GOLD</small></span>
              </div>
            </> : <p>No MVP data available.</p>}
          </section>

          <section className="dr-post-panel dr-post-damage-panel">
            <header><BarChart3 /> TEAM DAMAGE</header>
            <div className="dr-post-damage-list">
              {players.map(entry => {
                const damage = number(entry.state.damageDealt);
                return (
                  <div className={`dr-post-damage-entry is-${entry.player.team}`} key={entry.player.userId}>
                    <div className="dr-post-mini-portrait">{entry.portrait ? <img src={entry.portrait} alt="" /> : <Shield />}</div>
                    <div className="dr-post-damage-track"><i style={{ width: `${Math.max(2, damage / maxDamage * 100)}%` }} /></div>
                    <strong>{formatNumber(damage)}</strong>
                  </div>
                );
              })}
            </div>
          </section>
        </aside>
      </section>

      <section className="dr-post-lower">
        <article><Timer /><span><small>MATCH TIME</small><strong>{formatDuration(durationMs)}</strong></span></article>
        <article><Coins /><span><small>TOTAL MATCH GOLD</small><strong>{formatNumber(totalGold)}</strong></span></article>
        <article><Swords /><span><small>YOUR CREEP SCORE</small><strong>{formatNumber(localCreepScore)}</strong></span></article>
        <article><Trophy /><span><small>YOUR RESULT</small><strong>{localResult}</strong></span></article>
      </section>

      <footer className="dr-post-actions">
        <button type="button" className="dr-post-primary" onClick={onPlayAgain}><RotateCcw /> PLAY AGAIN</button>
        <button type="button" className="dr-post-secondary" onClick={onContinue}><Home /> CONTINUE</button>
      </footer>
    </main>
  );
}
