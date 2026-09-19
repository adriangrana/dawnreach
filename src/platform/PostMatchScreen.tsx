import { BarChart3, Coins, Crown, Home, RotateCcw, Shield, Swords, Timer, Trophy } from 'lucide-react';
import { getHeroDefinition } from '../game/heroes/catalog';
import { getItemIconDataUrl } from '../game/items/itemVisuals';
import type {
  MatchEndedEvent,
  MatchResultPlayer,
  MatchRuntimePlayerState,
  MatchPlayer,
  PlatformUser,
  Team,
} from './types';

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
  stats: MatchResultPlayer;
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

function legacyResultPlayer(
  player: MatchPlayer,
  state: MatchRuntimePlayerState | null,
  heroId: string,
  observedAt: string,
): MatchResultPlayer {
  const experience = Math.max(0, number(state?.experience));
  return {
    userId: player.userId,
    slot: player.slot,
    playerName: player.username,
    team: player.team,
    heroId,
    heroName: safeHeroName(heroId),
    kills: Math.max(0, number(state?.kills)),
    deaths: Math.max(0, number(state?.deaths)),
    assists: Math.max(0, number(state?.assists)),
    heroLevel: Math.max(1, number(state?.level) || 1),
    creepKills: Math.max(0, number(state?.lastHits)),
    creepDenies: Math.max(0, number(state?.denies)),
    currentGold: Math.max(0, number(state?.gold)),
    experience,
    heroDamage: Math.max(0, number(state?.damageDealt)),
    heroDamageTaken: Math.max(0, number(state?.damageTaken)),
    towerDamage: 0,
    buildingDamage: 0,
    healing: Math.max(0, number(state?.healingDone)),
    xpm: 0,
    towersDestroyed: 0,
    killStreak: 0,
    items: state?.inventory ?? [],
    leftGame: false,
    disconnectSeconds: 0,
    observedAt,
  };
}

function buildFinalPlayers(result: MatchEndedEvent): FinalPlayer[] {
  const reportPlayers = result.match.postMatchReport?.players ?? [];
  const resultByUserId = new Map(reportPlayers.map(stats => [stats.userId, stats] as const));
  const legacyStates = result.finalStates?.length
    ? result.finalStates
    : result.match.postMatchReport?.finalStates ?? [];
  const legacyByUserId = new Map(legacyStates.map(state => [state.userId, state] as const));
  const observedAt = result.match.postMatchReport?.endedAt ?? result.match.endedAt ?? new Date().toISOString();

  return result.match.players
    .map(player => {
      const stored = resultByUserId.get(player.userId) ?? null;
      const legacy = legacyByUserId.get(player.userId) ?? null;
      const heroId = stored?.heroId
        || result.match.heroSelections?.[player.userId]?.heroId
        || legacy?.heroId
        || 'H001';
      const stats = stored ?? legacyResultPlayer(player, legacy, heroId, observedAt);
      return {
        player,
        stats,
        heroName: stats.heroName || safeHeroName(heroId),
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
  const stats = entry.stats;
  return (
    number(stats.kills) * 4
    + number(stats.assists) * 1.8
    - number(stats.deaths) * 1.35
    + number(stats.heroDamage) / 1200
    + number(stats.currentGold) / 1800
    + number(stats.creepKills) * 0.05
    + number(stats.creepDenies) * 0.25
  );
}

function itemSlots(stats: MatchResultPlayer) {
  const itemsBySlot = new Map(stats.items.map(item => [item.slot, item] as const));
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
  const kills = entries.reduce((sum, entry) => sum + number(entry.stats.kills), 0);
  const deaths = entries.reduce((sum, entry) => sum + number(entry.stats.deaths), 0);
  const assists = entries.reduce((sum, entry) => sum + number(entry.stats.assists), 0);
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
        <span>HEALING</span>
        <span>ITEMS</span>
      </div>
      <div className="dr-post-team-rows">
        {entries.map(entry => {
          const stats = entry.stats;
          const local = entry.player.userId === localUserId;
          const mvp = entry.player.userId === mvpUserId;
          return (
            <article
              key={entry.player.userId}
              className={`dr-post-player-row${local ? ' is-local' : ''}${mvp ? ' is-mvp' : ''}`}
            >
              <div className="dr-post-player">
                <span className="dr-post-level">{Math.max(1, Math.floor(number(stats.heroLevel)))}</span>
                <div className="dr-post-portrait">
                  {entry.portrait ? <img src={entry.portrait} alt="" draggable={false} /> : <Shield />}
                </div>
                <div className="dr-post-player-copy">
                  <strong>{entry.heroName}</strong>
                  <span>{entry.player.username}{local ? ' · YOU' : ''}</span>
                </div>
              </div>
              <b className="dr-post-kda">{stats.kills} / {stats.deaths} / {stats.assists}</b>
              <span>{stats.creepKills} / {stats.creepDenies}</span>
              <span>{formatNumber(number(stats.currentGold))}</span>
              <span>{formatNumber(number(stats.heroDamage))}</span>
              <span>{formatNumber(number(stats.heroDamageTaken))}</span>
              <span>{formatNumber(number(stats.healing))}</span>
              <div className="dr-post-items" aria-label="Final inventory">
                {itemSlots(stats).map((item, index) => (
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
  const dawnKills = dawn.reduce((sum, entry) => sum + number(entry.stats.kills), 0);
  const duskKills = dusk.reduce((sum, entry) => sum + number(entry.stats.kills), 0);
  const endedAtMs = Date.parse(result.match.endedAt || '');
  const startedAtMs = Date.parse(result.match.startedAt || result.match.createdAt);
  const fallbackDurationMs = Number.isFinite(endedAtMs) && Number.isFinite(startedAtMs)
    ? Math.max(0, endedAtMs - startedAtMs)
    : 0;
  const durationMs = number(result.durationMs)
    || number(result.match.postMatchReport?.durationMs)
    || fallbackDurationMs;
  const mvpPool = result.winnerTeam
    ? players.filter(entry => entry.player.team === result.winnerTeam)
    : players;
  const mvp = [...mvpPool].sort((left, right) => mvpScore(right) - mvpScore(left))[0] ?? null;
  const local = players.find(entry => entry.player.userId === me.id) ?? null;
  const maxDamage = Math.max(1, ...players.map(entry => number(entry.stats.heroDamage)));
  const dawnDamage = dawn.reduce((sum, entry) => sum + number(entry.stats.heroDamage), 0);
  const duskDamage = dusk.reduce((sum, entry) => sum + number(entry.stats.heroDamage), 0);
  const localResult = resultTitle(result, localTeam);
  const localGold = local ? number(local.stats.currentGold) : 0;
  const localCreepScore = local ? number(local.stats.creepKills) + number(local.stats.creepDenies) : 0;

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
                  <span className="dr-post-grade"><Crown /></span>
                  <strong>{mvp.heroName}</strong>
                  <small>{mvp.player.username}</small>
                </div>
              </div>
              <div className="dr-post-mvp-metrics">
                <span><b>{mvp.stats.kills} / {mvp.stats.deaths} / {mvp.stats.assists}</b><small>K / D / A</small></span>
                <span><b>{formatNumber(number(mvp.stats.heroDamage))}</b><small>DAMAGE</small></span>
                <span><b>{formatNumber(number(mvp.stats.currentGold))}</b><small>GOLD</small></span>
              </div>
            </> : <p>No MVP data available.</p>}
          </section>

          <section className="dr-post-panel dr-post-damage-panel">
            <header><BarChart3 /> TEAM DAMAGE</header>
            <div className="dr-post-damage-list">
              {([
                ['blue', dawnDamage, dawn],
                ['red', duskDamage, dusk],
              ] as const).map(([team, total, entries]) => (
                <div className="dr-post-damage-team" key={team}>
                  <div className={`dr-post-damage-total is-${team}`}>
                    <span>{teamLabel(team)}</span>
                    <strong>{formatNumber(total)}</strong>
                  </div>
                  {entries.map(entry => {
                    const damage = number(entry.stats.heroDamage);
                    return (
                      <div className={`dr-post-damage-entry is-${entry.player.team}`} key={entry.player.userId}>
                        <div className="dr-post-mini-portrait">{entry.portrait ? <img src={entry.portrait} alt="" /> : <Shield />}</div>
                        <div className="dr-post-damage-track"><i style={{ width: `${Math.max(2, damage / maxDamage * 100)}%` }} /></div>
                        <strong>{formatNumber(damage)}</strong>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </section>
        </aside>
      </section>

      <section className="dr-post-lower">
        <article><Timer /><span><small>MATCH TIME</small><strong>{formatDuration(durationMs)}</strong></span></article>
        <article><Coins /><span><small>YOUR FINAL GOLD</small><strong>{formatNumber(localGold)}</strong></span></article>
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
