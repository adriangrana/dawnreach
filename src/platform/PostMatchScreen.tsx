import { useState } from 'react';
import { Activity, BarChart3, Crown, Gauge, Home, RotateCcw, Shield, Swords, Timer, Trophy, Users, Wifi, WifiOff } from 'lucide-react';
import { getHeroDefinition } from '../game/heroes/catalog';
import { getItemIconDataUrl } from '../game/items/itemVisuals';
import { DawnreachHomeTopbar } from './DawnreachHome';
import type {
  MatchEndedEvent,
  MatchGraphSample,
  MatchResultPlayer,
  MatchRuntimePlayerState,
  MatchTimelineEvent,
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

function EmptyPlayerRow({ team, slot }: { team: Team; slot: number }) {
  return (
    <article className="dr-post-player-row is-empty" aria-label={`${teamLabel(team)} empty slot ${slot + 1}`}>
      <div className="dr-post-player">
        <span className="dr-post-level">—</span>
        <div className="dr-post-portrait dr-post-portrait--empty"><Shield /></div>
        <div className="dr-post-player-copy"><span>Empty slot</span></div>
      </div>
      <span /><span /><span /><span /><span /><span />
      <div className="dr-post-items">
        {Array.from({ length: 6 }, (_, index) => <span key={index} className="dr-post-item" />)}
      </div>
      <span />
    </article>
  );
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
        <div>
          <strong>{teamLabel(team)}</strong>
          <small>{entries.length}/5 PLAYERS</small>
        </div>
        <span><b>{kills}</b> / {deaths} / {assists}</span>
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
        <span />
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
              <div className="dr-post-accolade">
                {mvp && <span className="dr-post-mvp-tag"><Crown /> MVP</span>}
              </div>
            </article>
          );
        })}
        {Array.from({ length: Math.max(0, 5 - entries.length) }, (_, index) => (
          <EmptyPlayerRow key={`empty-${team}-${index}`} team={team} slot={entries.length + index} />
        ))}
      </div>
    </section>
  );
}


type PostMatchTab = 'overview' | 'detailed' | 'graphs' | 'timeline';
type GraphMetric = 'gold' | 'experience' | 'heroDamage' | 'creepScore';

const GRAPH_METRICS: readonly Readonly<{ key: GraphMetric; label: string }>[]= [
  { key: 'gold', label: 'GOLD HELD' },
  { key: 'experience', label: 'EXPERIENCE' },
  { key: 'heroDamage', label: 'HERO DAMAGE' },
  { key: 'creepScore', label: 'CREEP SCORE' },
];

function graphValue(sample: MatchGraphSample, metric: GraphMetric) {
  if (metric === 'experience') return sample.experience;
  if (metric === 'heroDamage') return sample.heroDamage;
  if (metric === 'creepScore') return sample.creepKills + sample.creepDenies;
  return sample.gold;
}

function DetailedStatsTab({ players, localUserId }: { players: readonly FinalPlayer[]; localUserId: string }) {
  return (
    <section className="dr-post-tab-surface dr-post-detailed">
      <header className="dr-post-tab-heading">
        <div><small>PLAYER PERFORMANCE</small><h2>DETAILED STATS</h2></div>
        <span>{players.length} PLAYERS</span>
      </header>
      <div className="dr-post-detailed-scroll">
        <div className="dr-post-detailed-grid dr-post-detailed-head">
          <span>PLAYER</span><span>LVL</span><span>K / D / A</span><span>LH / DN</span><span>GOLD</span>
          <span>XP</span><span>XPM</span><span>HERO DMG</span><span>DMG TAKEN</span><span>HEALING</span>
          <span>TOWER DMG</span><span>BUILDING</span><span>TOWERS</span><span>STREAK</span><span>DISCONNECTED</span>
        </div>
        {players.map(entry => (
          <article
            key={entry.player.userId}
            className={`dr-post-detailed-grid dr-post-detailed-row is-${entry.player.team}${entry.player.userId === localUserId ? ' is-local' : ''}`}
          >
            <div className="dr-post-detailed-player">
              <div className="dr-post-mini-portrait">{entry.portrait ? <img src={entry.portrait} alt="" /> : <Shield />}</div>
              <span><strong>{entry.heroName}</strong><small>{entry.player.username}</small></span>
            </div>
            <b>{entry.stats.heroLevel}</b>
            <b>{entry.stats.kills} / {entry.stats.deaths} / {entry.stats.assists}</b>
            <b>{entry.stats.creepKills} / {entry.stats.creepDenies}</b>
            <b>{formatNumber(entry.stats.currentGold)}</b>
            <b>{formatNumber(entry.stats.experience)}</b>
            <b>{formatNumber(entry.stats.xpm)}</b>
            <b>{formatNumber(entry.stats.heroDamage)}</b>
            <b>{formatNumber(entry.stats.heroDamageTaken)}</b>
            <b>{formatNumber(entry.stats.healing)}</b>
            <b>{formatNumber(entry.stats.towerDamage)}</b>
            <b>{formatNumber(entry.stats.buildingDamage)}</b>
            <b>{entry.stats.towersDestroyed}</b>
            <b>{entry.stats.killStreak}</b>
            <b>{formatDuration(entry.stats.disconnectSeconds * 1000)}</b>
          </article>
        ))}
      </div>
    </section>
  );
}

function GraphsTab({
  samples,
  players,
}: {
  samples: readonly MatchGraphSample[];
  players: readonly FinalPlayer[];
}) {
  const [metric, setMetric] = useState<GraphMetric>('gold');
  const grouped = new Map<string, MatchGraphSample[]>();
  for (const sample of samples) {
    const bucket = grouped.get(sample.userId) ?? [];
    bucket.push(sample);
    grouped.set(sample.userId, bucket);
  }
  for (const bucket of grouped.values()) bucket.sort((a, b) => a.atMs - b.atMs);

  const maxAt = Math.max(1, ...samples.map(sample => sample.atMs));
  const maxValue = Math.max(1, ...samples.map(sample => graphValue(sample, metric)));
  const x = (atMs: number) => 54 + (atMs / maxAt) * 890;
  const y = (value: number) => 324 - (value / maxValue) * 270;

  return (
    <section className="dr-post-tab-surface dr-post-graphs">
      <header className="dr-post-tab-heading">
        <div><small>MATCH PROGRESSION</small><h2>GRAPHS</h2></div>
        <div className="dr-post-graph-metrics">
          {GRAPH_METRICS.map(option => (
            <button key={option.key} type="button" className={metric === option.key ? 'is-active' : ''} onClick={() => setMetric(option.key)}>
              {option.label}
            </button>
          ))}
        </div>
      </header>
      {samples.length ? (
        <div className="dr-post-graph-layout">
          <div className="dr-post-chart">
            <svg viewBox="0 0 1000 360" role="img" aria-label={`${GRAPH_METRICS.find(item => item.key === metric)?.label} over time`}>
              {[0, .25, .5, .75, 1].map(fraction => (
                <g key={fraction}>
                  <line className="dr-post-chart-grid" x1="54" x2="944" y1={324 - fraction * 270} y2={324 - fraction * 270} />
                  <text className="dr-post-chart-label" x="46" y={328 - fraction * 270} textAnchor="end">
                    {formatNumber(maxValue * fraction)}
                  </text>
                  <text className="dr-post-chart-label" x={54 + fraction * 890} y="348" textAnchor="middle">
                    {formatDuration(maxAt * fraction)}
                  </text>
                </g>
              ))}
              {[...grouped.entries()].map(([userId, bucket]) => {
                const player = players.find(entry => entry.player.userId === userId);
                if (!player || !bucket.length) return null;
                const points = bucket.map(sample => `${x(sample.atMs)},${y(graphValue(sample, metric))}`).join(' ');
                return <polyline key={userId} className={`dr-post-graph-line is-${player.player.team} slot-${player.player.slot}`} points={points} />;
              })}
            </svg>
          </div>
          <aside className="dr-post-graph-legend">
            {players.map(entry => {
              const bucket = grouped.get(entry.player.userId) ?? [];
              const last = bucket[bucket.length - 1];
              return (
                <div key={entry.player.userId} className={`is-${entry.player.team}`}>
                  <i />
                  <div><strong>{entry.heroName}</strong><small>{entry.player.username}</small></div>
                  <b>{last ? formatNumber(graphValue(last, metric)) : '—'}</b>
                </div>
              );
            })}
          </aside>
        </div>
      ) : (
        <div className="dr-post-tab-empty"><BarChart3 /><strong>NO HISTORICAL SAMPLES</strong><span>This match was recorded before graph telemetry was enabled.</span></div>
      )}
    </section>
  );
}

function timelineIcon(type: MatchTimelineEvent['type']) {
  if (type === 'disconnect' || type === 'abandon') return <WifiOff />;
  if (type === 'reconnect') return <Wifi />;
  if (type === 'level_up') return <Gauge />;
  if (type === 'tower_destroyed' || type === 'building_destroyed') return <Shield />;
  if (type === 'match_start' || type === 'match_end') return <Trophy />;
  return <Swords />;
}

function TimelineTab({ events }: { events: readonly MatchTimelineEvent[] }) {
  const ordered = [...events].sort((a, b) => a.atMs - b.atMs || a.id.localeCompare(b.id));
  return (
    <section className="dr-post-tab-surface dr-post-timeline">
      <header className="dr-post-tab-heading">
        <div><small>SERVER-RECORDED EVENTS</small><h2>TIMELINE</h2></div>
        <span>{ordered.length} EVENTS</span>
      </header>
      {ordered.length ? (
        <div className="dr-post-timeline-list">
          {ordered.map(event => (
            <article key={event.id} className={`dr-post-timeline-event is-${event.team ?? 'neutral'} type-${event.type}`}>
              <time>{formatDuration(event.atMs)}</time>
              <span className="dr-post-timeline-icon">{timelineIcon(event.type)}</span>
              <div>
                <strong>{event.label}</strong>
                <small>{event.type.replaceAll('_', ' ').toUpperCase()}</small>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="dr-post-tab-empty"><Activity /><strong>NO TIMELINE DATA</strong><span>This match was recorded before timeline telemetry was enabled.</span></div>
      )}
    </section>
  );
}

export function PostMatchScreen({
  result,
  me,
  realtime,
  onContinue,
  onPlay,
  onPlayAgain,
  onLogout,
}: {
  result: MatchEndedEvent;
  me: PlatformUser;
  realtime: 'connecting' | 'online' | 'offline';
  onContinue: () => void;
  onPlay: () => void;
  onPlayAgain: () => void;
  onLogout: () => void;
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
  const localStructureDamage = local
    ? number(local.stats.towerDamage) + number(local.stats.buildingDamage)
    : 0;
  const localXpm = local ? number(local.stats.xpm) : 0;
  const localDisconnectSeconds = local ? number(local.stats.disconnectSeconds) : 0;
  const isCustomMatch = result.match.mode === 'custom';
  const modeLabel = isCustomMatch ? 'CUSTOM MATCH' : result.match.mode.toUpperCase();
  const [activeTab, setActiveTab] = useState<PostMatchTab>('overview');
  const graphSamples = result.match.postMatchReport?.graphSamples ?? [];
  const timeline = result.match.postMatchReport?.timeline ?? [];

  return (
    <main className={`dr-post-match is-mode-${result.match.mode}`} aria-label="Match results">
      <div className="dr-post-backdrop" aria-hidden="true" />

      <DawnreachHomeTopbar
        section="home"
        user={me}
        realtime={realtime}
        onHome={onContinue}
        onPlay={onPlay}
        onLogout={onLogout}
      />

      <section className={`dr-post-victory-banner is-${result.winnerTeam ?? 'neutral'}`}>
        <div className="dr-post-match-meta">
          <img src={`/assets/icon/${isCustomMatch ? 'custom' : result.match.mode}.png`} alt="" />
          <div>
            <strong>{modeLabel}</strong>
            <span>DAWNREACH</span>
            <small>{formatDuration(durationMs)}</small>
          </div>
        </div>

        <div className="dr-post-victory-center">
          {result.winnerTeam && (
            <img
              className="dr-post-victory-emblem"
              src={result.winnerTeam === 'red'
            ? '/assets/images/emblema_victoria_cristal_rojo.webp'
            : '/assets/images/emblema_victoria_cristal_azul.webp'}
              alt=""
              draggable={false}
            />
          )}
          <div className="dr-post-victory-content">
            <div className="dr-post-banner-score is-blue">
              <strong>{dawnKills}</strong>
              <span>DAWN TEAM</span>
            </div>
            <div className="dr-post-banner-title">
              <h1 className={localResult === 'VICTORY' ? 'is-victory' : localResult === 'DEFEAT' ? 'is-defeat' : ''}>{localResult}</h1>
              <small>{result.winnerTeam ? `${teamLabel(result.winnerTeam)} WINS` : 'MATCH ENDED'}</small>
            </div>
            <div className="dr-post-banner-score is-red">
              <strong>{duskKills}</strong>
              <span>DUSK TEAM</span>
            </div>
          </div>
        </div>

        <div className="dr-post-banner-motto">
          <strong>DAWNREACH</strong>
          <small>A BRIGHTER TOMORROW</small>
        </div>
      </section>

      <nav className="dr-post-tabs" aria-label="Post match sections">
        <button type="button" className={activeTab === 'overview' ? 'is-active' : ''} aria-current={activeTab === 'overview' ? 'page' : undefined} onClick={() => setActiveTab('overview')}>OVERVIEW</button>
        <button type="button" className={activeTab === 'detailed' ? 'is-active' : ''} aria-current={activeTab === 'detailed' ? 'page' : undefined} onClick={() => setActiveTab('detailed')}>DETAILED STATS</button>
        <button type="button" className={activeTab === 'graphs' ? 'is-active' : ''} aria-current={activeTab === 'graphs' ? 'page' : undefined} onClick={() => setActiveTab('graphs')}>GRAPHS</button>
        <button type="button" className={activeTab === 'timeline' ? 'is-active' : ''} aria-current={activeTab === 'timeline' ? 'page' : undefined} onClick={() => setActiveTab('timeline')}>TIMELINE</button>
      </nav>

      {activeTab === 'overview' && <>
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
                <div className="dr-post-mvp-copy">
                  <small>MOST VALUABLE PLAYER</small>
                  <strong>{mvp.heroName}</strong>
                  <small>{mvp.player.username}</small>
                </div>
                <span className="dr-post-grade" aria-label="Match MVP"><Crown /><b>MVP</b></span>
              </div>
              <div className="dr-post-mvp-metrics">
                <span><b>{mvp.stats.kills} / {mvp.stats.deaths} / {mvp.stats.assists}</b><small>K / D / A</small></span>
                <span><b>{formatNumber(number(mvp.stats.heroDamage))}</b><small>DAMAGE</small></span>
                <span><b>{formatNumber(number(mvp.stats.xpm))}</b><small>XPM</small></span>
                <span><b>{formatNumber(number(mvp.stats.currentGold))}</b><small>FINAL GOLD</small></span>
              </div>
              <p className="dr-post-mvp-caption">A brighter tomorrow begins with you.</p>
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
                      <div className={`dr-post-damage-entry is-${entry.player.team}`} key={entry.player.userId} title={`${entry.heroName} · ${entry.player.username}: ${formatNumber(damage)} damage`}>
                        <div className="dr-post-mini-portrait">{entry.portrait ? <img src={entry.portrait} alt="" /> : <Shield />}</div>
                        <div className="dr-post-damage-track"><i style={{ width: `${Math.max(0, damage / maxDamage * 100)}%` }} /></div>
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
        <article>
          <Timer />
          <span><small>MATCH TIME</small><strong>{formatDuration(durationMs)}</strong></span>
        </article>
        <article>
          <Gauge />
          <span><small>YOUR XPM</small><strong>{formatNumber(localXpm)}</strong></span>
        </article>
        <article>
          <Swords />
          <span><small>STRUCTURE DAMAGE</small><strong>{formatNumber(localStructureDamage)}</strong></span>
        </article>
        <article className="dr-post-mode-card">
          {isCustomMatch ? <Users /> : <Trophy />}
          <span>
            <small>{isCustomMatch ? 'MATCH TYPE' : 'YOUR RESULT'}</small>
            <strong>{isCustomMatch ? 'CUSTOM MATCH' : localResult}</strong>
            {isCustomMatch && <em>{players.length} PLAYERS</em>}
          </span>
        </article>
      </section>

      <div className="dr-post-secondary-stats" aria-label="Additional match statistics">
        <span><b>{formatNumber(localGold)}</b><small>FINAL GOLD</small></span>
        <span><b>{formatNumber(localCreepScore)}</b><small>LH + DN</small></span>
        <span><b>{local?.stats.towersDestroyed ?? 0}</b><small>TOWERS</small></span>
        <span><b>{local?.stats.killStreak ?? 0}</b><small>BEST STREAK</small></span>
        <span><b>{formatDuration(localDisconnectSeconds * 1000)}</b><small>DISCONNECTED</small></span>
      </div>


      </>}
      {activeTab === 'detailed' && <DetailedStatsTab players={players} localUserId={me.id} />}
      {activeTab === 'graphs' && <GraphsTab samples={graphSamples} players={players} />}
      {activeTab === 'timeline' && <TimelineTab events={timeline} />}

      <footer className="dr-post-actions">
        <button type="button" className="dr-post-primary" onClick={onPlayAgain}><RotateCcw /> PLAY AGAIN</button>
        <button type="button" className="dr-post-secondary" onClick={onContinue}><Home /> CONTINUE</button>
        <span className="dr-post-footer-motto">GREAT PLAYERS BUILD BRIGHTER WORLDS.<img src="/assets/icon/dawnreach.png" alt="" /></span>
      </footer>
    </main>
  );
}
