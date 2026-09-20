import { useEffect, useMemo, useState } from 'react';
import { RankBadge, RankProgress, playerRank, RankLadder } from './RankBadge';
import {
  BarChart3,
  CalendarDays,
  ChevronRight,
  Clock3,
  Crown,
  History,
  LockKeyhole,
  Medal,
  Shield,
  Sparkles,
  Swords,
  Trophy,
  UserRound,
} from 'lucide-react';
import { getHeroFullArt, getHeroPortrait } from '../game/heroes/assets';
import { listHeroDefinitions } from '../game/heroes/catalog';
import { getItemDefinition } from '../game/items/itemDatabase';
import { getProfileMatchHistory } from './apiClient';
import type { MatchSummary, PlatformUser, Team } from './types';

type ProfileSection = 'overview' | 'history' | 'mastery' | 'achievements' | 'cosmetics' | 'stats';

type HistoryEntry = Readonly<{
  match: MatchSummary;
  team: Team | null;
  won: boolean | null;
  heroId: string;
  heroName: string;
  kills: number;
  deaths: number;
  assists: number;
  durationMs: number;
  netWorth: number | null;
  resultLabel: 'VICTORY' | 'DEFEAT' | 'CANCELLED' | 'VOID' | 'ENDED';
}>;

const PROFILE_SECTIONS: readonly Readonly<{ key: ProfileSection; label: string; icon: typeof Trophy; ready: boolean }>[] = [
  { key: 'overview', label: 'OVERVIEW', icon: UserRound, ready: true },
  { key: 'history', label: 'MATCH HISTORY', icon: History, ready: true },
  { key: 'mastery', label: 'HERO MASTERY', icon: Swords, ready: true },
  { key: 'achievements', label: 'ACHIEVEMENTS', icon: Trophy, ready: true },
  { key: 'cosmetics', label: 'COSMETICS', icon: Sparkles, ready: true },
  { key: 'stats', label: 'STATS', icon: BarChart3, ready: true },
];

function formatNumber(value: number) {
  return Math.max(0, Math.round(value)).toLocaleString('en-US');
}

function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatAccountDate(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return 'UNKNOWN';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(parsed);
}

function formatMatchDate(value?: string) {
  const parsed = Date.parse(value || '');
  if (!Number.isFinite(parsed)) return '—';
  const today = new Date();
  const date = new Date(parsed);
  const days = Math.floor((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

function matchEndedAt(match: MatchSummary) {
  return match.postMatchReport?.endedAt || match.endedAt || match.createdAt;
}

function inventoryValue(items: readonly Readonly<{ definitionId: string; quantity: number }>[] | undefined) {
  if (!items?.length) return 0;
  return items.reduce((total, item) => {
    const definition = getItemDefinition(item.definitionId);
    const quantity = Math.max(0, Math.floor(Number(item.quantity) || 0));
    return total + (definition?.cost ?? 0) * quantity;
  }, 0);
}

function historicalDurationMs(match: MatchSummary) {
  const report = match.postMatchReport;
  const recorded = Number(report?.durationMs || 0);
  if (recorded > 0) return recorded;

  const startedAt = Date.parse(report?.startedAt || match.startedAt || match.createdAt || '');
  const endedAt = Date.parse(report?.endedAt || match.endedAt || '');
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return 0;
  return Math.max(0, endedAt - startedAt);
}

function historyEntry(match: MatchSummary, userId: string): HistoryEntry {
  const report = match.postMatchReport;
  const participant = match.players.find(player => player.userId === userId) ?? null;
  const resultPlayer = report?.players.find(player => player.userId === userId) ?? null;
  const finalState = report?.finalStates.find(state => state.userId === userId) ?? null;
  const heroId = resultPlayer?.heroId || finalState?.heroId || match.heroSelections?.[userId]?.heroId || '';
  const winnerTeam = match.winnerTeam ?? report?.winnerTeam ?? null;
  const voided = Boolean(report?.voided);
  const won = match.status === 'cancelled' || voided || !participant || !winnerTeam
    ? null
    : participant.team === winnerTeam;

  let netWorth: number | null = null;
  if (resultPlayer?.netWorth !== undefined && Number.isFinite(Number(resultPlayer.netWorth))) {
    netWorth = Math.max(0, Number(resultPlayer.netWorth));
  } else if (resultPlayer) {
    netWorth = Math.max(0, Number(resultPlayer.currentGold || 0)) + inventoryValue(resultPlayer.items);
  } else if (finalState) {
    netWorth = Math.max(0, Number(finalState.gold || 0)) + inventoryValue(finalState.inventory);
  }

  const resultLabel: HistoryEntry['resultLabel'] = match.status === 'cancelled'
    ? 'CANCELLED'
    : voided
      ? 'VOID'
      : won === true
        ? 'VICTORY'
        : won === false
          ? 'DEFEAT'
          : 'ENDED';

  return {
    match,
    team: participant?.team ?? finalState?.team ?? null,
    won,
    heroId,
    heroName: profileHeroName(heroId, resultPlayer?.heroName),
    kills: Number(resultPlayer?.kills ?? finalState?.kills ?? 0),
    deaths: Number(resultPlayer?.deaths ?? finalState?.deaths ?? 0),
    assists: Number(resultPlayer?.assists ?? finalState?.assists ?? 0),
    durationMs: historicalDurationMs(match),
    netWorth,
    resultLabel,
  };
}

const PROFILE_HEROES = listHeroDefinitions();
const PROFILE_HERO_BY_ID = new Map<string, (typeof PROFILE_HEROES)[number]>(
  PROFILE_HEROES.map(hero => [hero.id, hero]),
);
const PROFILE_FALLBACK_HERO_ID = PROFILE_HEROES[0]?.id ?? '';

function profileHeroName(heroId: string, fallback?: string) {
  return PROFILE_HERO_BY_ID.get(heroId)?.displayName || fallback || (heroId ? heroId : 'Unknown Hero');
}

function profileHeroPortrait(heroId: string) {
  return getHeroPortrait(heroId) || '/assets/icon/dawnreach.png';
}

function profileHeroFullArt(heroId: string) {
  return getHeroFullArt(heroId) || getHeroPortrait(heroId) || '/assets/icon/dawnreach.png';
}

function medalSlots() {
  return Array.from({ length: 4 }, (_, index) => index);
}

function MatchRows({ entries, onOpenMatch, limit }: { entries: readonly HistoryEntry[]; onOpenMatch?: (match: MatchSummary) => void; limit?: number }) {
  const visible = typeof limit === 'number' ? entries.slice(0, limit) : entries;
  if (!visible.length) {
    return <div className="dr-profile-empty-list"><History /><strong>NO RECORDED MATCHES YET</strong><span>Your completed Dawnreach matches will appear here.</span></div>;
  }
  return <div className="dr-profile-match-list">
    {visible.map(entry => (
      <button
        key={entry.match.id}
        className={`dr-profile-match-row ${entry.won === null ? 'is-neutral' : entry.won ? 'is-win' : 'is-loss'}`}
        type="button"
        onClick={() => onOpenMatch?.(entry.match)}
        disabled={!entry.match.postMatchReport || !onOpenMatch}
      >
        <span className="dr-profile-match-hero"><img src={profileHeroPortrait(entry.heroId)} alt={entry.heroName} /><span><strong>{entry.heroName}</strong><small>{entry.match.mode.toUpperCase()}</small></span></span>
        <span className="dr-profile-match-kda"><b>{entry.kills} / {entry.deaths} / {entry.assists}</b><small>K / D / A</small></span>
        <strong className="dr-profile-match-result">{entry.resultLabel}</strong>
        <span className="dr-profile-match-networth"><b>{entry.netWorth === null ? '—' : formatNumber(entry.netWorth)}</b><small>NET WORTH</small></span>
        <span className="dr-profile-match-time"><b>{formatDuration(entry.durationMs)}</b><small>{formatMatchDate(matchEndedAt(entry.match))}</small></span>
        <ChevronRight />
      </button>
    ))}
  </div>;
}

function PlaceholderMedals() {
  return <div className="dr-profile-achievement-grid">
    {medalSlots().map(index => (
      <div className="dr-profile-achievement-slot" key={index}>
        <div className="dr-profile-medal-shell">
          <span className="dr-profile-medal-diamond" />
          <img src="/assets/icon/dawnreach.png" alt="" />
          <LockKeyhole />
        </div>
        <strong>UNASSIGNED</strong>
        <small>MEDAL SLOT</small>
      </div>
    ))}
  </div>;
}

export function DawnreachProfile({
  user,
  realtime,
  onOpenMatch,
}: {
  user: PlatformUser;
  realtime: 'connecting' | 'online' | 'offline';
  onOpenMatch?: (match: MatchSummary) => void;
}) {
  const [section, setSection] = useState<ProfileSection>('overview');
  const [matches, setMatches] = useState<readonly MatchSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    void getProfileMatchHistory(50)
      .then(result => { if (active) setMatches(result); })
      .catch(error => {
        if (!active) return;
        setMatches([]);
        setLoadError(error instanceof Error ? error.message : 'Could not load match history.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user.id]);

  const entries = useMemo(() => matches.map(match => historyEntry(match, user.id)), [matches, user.id]);
  const playedEntries = entries.filter(entry => entry.match.status === 'completed' && !entry.match.postMatchReport?.voided);
  const decisiveEntries = playedEntries.filter(entry => entry.won !== null);
  const recordedWins = decisiveEntries.filter(entry => entry.won === true).length;
  const recordedLosses = decisiveEntries.filter(entry => entry.won === false).length;
  const totalRecordedMs = playedEntries.reduce((sum, entry) => sum + entry.durationMs, 0);
  const totalMatches = playedEntries.length;
  const winRate = decisiveEntries.length > 0 ? (recordedWins / decisiveEntries.length) * 100 : 0;
  const rank = playerRank(user);
  const ratingHistory = matches.flatMap(match => (match.ratingChanges ?? [])
    .filter(change => change.userId === user.id).map(change => ({ ...change, matchId: match.id, endedAt: match.endedAt }))).slice(0, 5);
  const heroCounts = new Map<string, number>();
  for (const entry of playedEntries) heroCounts.set(entry.heroId, (heroCounts.get(entry.heroId) || 0) + 1);
  const favoriteHero = [...heroCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [PROFILE_FALLBACK_HERO_ID, 0];
  const favoriteHeroName = profileHeroName(favoriteHero[0], favoriteHero[0]);
  const featuredHeroId = favoriteHero[0] || PROFILE_FALLBACK_HERO_ID;
  const featuredHeroArt = profileHeroFullArt(featuredHeroId);
  const historyReady = !loading && !loadError;

  const totalKills = playedEntries.reduce((sum, entry) => sum + entry.kills, 0);
  const totalDeaths = playedEntries.reduce((sum, entry) => sum + entry.deaths, 0);
  const totalAssists = playedEntries.reduce((sum, entry) => sum + entry.assists, 0);
  const overallKda = (totalKills + totalAssists) / Math.max(1, totalDeaths);
  const netWorthEntries = playedEntries.filter(entry => entry.netWorth !== null);
  const averageNetWorth = netWorthEntries.length
    ? netWorthEntries.reduce((sum, entry) => sum + Number(entry.netWorth || 0), 0) / netWorthEntries.length
    : 0;
  const averageDurationMs = playedEntries.length ? totalRecordedMs / playedEntries.length : 0;
  const longestDurationMs = playedEntries.reduce((longest, entry) => Math.max(longest, entry.durationMs), 0);
  const modeCounts = new Map<string, number>();
  for (const entry of playedEntries) modeCounts.set(entry.match.mode, (modeCounts.get(entry.match.mode) || 0) + 1);

  const masteryRecords = PROFILE_HEROES.map(hero => {
    const heroEntries = playedEntries.filter(entry => entry.heroId === hero.id);
    const wins = heroEntries.filter(entry => entry.won === true).length;
    const losses = heroEntries.filter(entry => entry.won === false).length;
    const kills = heroEntries.reduce((sum, entry) => sum + entry.kills, 0);
    const deaths = heroEntries.reduce((sum, entry) => sum + entry.deaths, 0);
    const assists = heroEntries.reduce((sum, entry) => sum + entry.assists, 0);
    const progress = Math.min(100, Math.round((heroEntries.length / 25) * 100));
    return {
      hero,
      entries: heroEntries,
      wins,
      losses,
      kills,
      deaths,
      assists,
      winRate: wins + losses ? (wins / (wins + losses)) * 100 : 0,
      kda: (kills + assists) / Math.max(1, deaths),
      progress,
      masteryLevel: heroEntries.length ? Math.max(1, Math.ceil(heroEntries.length / 5)) : 0,
    };
  });
  const featuredMastery = masteryRecords.find(record => record.hero.id === featuredHeroId) ?? masteryRecords[0] ?? null;
  const overviewMasteryRecords = [...masteryRecords]
    .sort((left, right) => right.entries.length - left.entries.length)
    .slice(0, 4);

  return <section className="dr-profile-page">
    <aside className="dr-profile-sidebar">
      <div className="dr-profile-side-rule" />
      <nav aria-label="Profile sections">
        {PROFILE_SECTIONS.map(item => {
          const Icon = item.icon;
          return <button
            key={item.key}
            className={section === item.key ? 'is-active' : ''}
            type="button"
            onClick={() => item.ready && setSection(item.key)}
            aria-disabled={!item.ready}
          >
            <Icon />
            <span>{item.label}</span>
            {!item.ready && <LockKeyhole className="dr-profile-nav-lock" />}
          </button>;
        })}
      </nav>
      <blockquote>“SOME FIGHT FOR GLORY.<br />I FIGHT FOR A<br />BRIGHTER TOMORROW.”<small>— DAWNREACH</small></blockquote>
    </aside>

    <div className="dr-profile-body">
      <header className="dr-profile-identity">
        <div className="dr-profile-avatar-frame">
          <span className="dr-profile-avatar"><strong>{user.username.slice(0, 2).toUpperCase()}</strong></span>
          <span className="dr-profile-avatar-badge"><Crown /></span>
        </div>
        <div className="dr-profile-identity-copy">
          <h1>{user.username}</h1>
          <h2><RankBadge player={user} size="tiny" /> {rank.label.toUpperCase()}</h2>
          <span><i className={`platform-presence is-${realtime}`} /> {realtime === 'online' ? 'Online' : realtime === 'connecting' ? 'Connecting…' : 'Offline'}</span>
          <p>Light finds a way.</p>
        </div>
        <div className="dr-profile-identity-art" aria-hidden="true"><img src={featuredHeroArt} alt="" /></div>
        <div className="dr-profile-identity-motto"><strong>VALOR<br />GUIDES US</strong><img src="/assets/icon/dawnreach.png" alt="" /></div>
      </header>

      {section === 'overview' ? <div className="dr-profile-overview-grid">
        <div className="dr-profile-left-stack">
          <section className="dr-profile-panel dr-profile-summary-panel">
            <header><strong>OVERVIEW</strong><span>PLAYER ID <b>#{user.id.slice(0, 8).toUpperCase()}</b></span></header>
            <div className="dr-profile-summary-grid">
              <article><Swords /><span><small>TOTAL MATCHES</small><strong>{historyReady ? formatNumber(totalMatches) : '—'}</strong></span></article>
              <article><Trophy /><span><small>WIN RATE</small><strong>{historyReady && decisiveEntries.length ? `${winRate.toFixed(1)}%` : '—'}</strong></span></article>
              <article><Clock3 /><span><small>RECORDED TIME</small><strong>{historyReady && totalRecordedMs ? `${Math.floor(totalRecordedMs / 3_600_000)}h ${Math.floor((totalRecordedMs % 3_600_000) / 60_000)}m` : '—'}</strong></span></article>
              <article className="is-hero"><img src={profileHeroPortrait(favoriteHero[0])} alt={favoriteHeroName} /><span><small>FAVORITE HERO</small><strong>{historyReady && totalMatches ? favoriteHeroName : '—'}</strong><em>{historyReady ? `${favoriteHero[1]} recorded matches` : 'History unavailable'}</em></span></article>
              <article><Shield /><span><small>PREFERRED ROLE</small><strong>NOT SET</strong><em>Role tracking pending</em></span></article>
              <article><CalendarDays /><span><small>ACCOUNT CREATED</small><strong>SEASON I</strong><em>{formatAccountDate(user.createdAt)}</em></span></article>
            </div>
          </section>

          <section className="dr-profile-panel dr-profile-recent-panel">
            <header><strong>RECENT MATCHES</strong><button type="button" onClick={() => setSection('history')}>VIEW ALL <ChevronRight /></button></header>
            {loading
              ? <div className="dr-profile-loading">Loading match history…</div>
              : loadError
                ? <div className="dr-profile-empty-list"><History /><strong>HISTORY UNAVAILABLE</strong><span>{loadError}</span></div>
                : <MatchRows entries={entries} onOpenMatch={onOpenMatch} limit={5} />}
          </section>
        </div>

        <div className="dr-profile-center-stack">
          <section className="dr-profile-panel dr-profile-ranked-panel">
            <header><strong>RANKED PROGRESSION</strong><span>SEASON I</span></header>
            <div className="dr-profile-ranked-content">
              <div className="dr-profile-rank-emblem"><RankBadge player={user} size="large" /></div>
              <div className="dr-profile-rank-copy">
                <small>{rank.label.toUpperCase()}</small>
                <h3>{user.calibrated ? `${formatNumber(user.rating)} MMR` : 'PROVISIONAL'}</h3>
                <strong>{user.calibrated ? `${user.rankedGames} ranked games` : `${user.calibrationGames} / ${user.calibrationTarget} GAMES`}</strong>
                <RankProgress player={user} />
              </div>
            </div>
            <div className="dr-profile-rank-history">
              <div className="dr-rank-history-list">{ratingHistory.length ? ratingHistory.map(change => <div key={change.matchId}>
                <time>{change.endedAt ? new Date(change.endedAt).toLocaleDateString() : 'Ranked match'}</time>
                <b className={(change.delta ?? 0) < 0 ? 'is-loss' : ''}>{change.delta === null ? 'Calibration' : `${change.delta > 0 ? '+' : ''}${change.delta} MMR`}</b>
                <small>{change.after.calibrated ? `${change.after.rating} MMR` : `${change.after.calibrationGames} / 5`}</small>
              </div>) : <small>Complete a ranked match to begin your rating history.</small>}</div>
            </div>
          </section>
          <RankLadder />

          <section className="dr-profile-panel dr-profile-mastery-panel">
            <header><strong>HERO MASTERY</strong><span>FOUNDATION ROSTER</span></header>
            <div className="dr-profile-mastery-grid">
              {overviewMasteryRecords.map(record => <article key={record.hero.id}>
                <img src={profileHeroPortrait(record.hero.id)} alt={record.hero.displayName} />
                <div><strong>{record.hero.displayName.toUpperCase()}</strong><small>{record.entries.length} RECORDED MATCHES</small></div>
                <span className="dr-profile-mastery-bar"><i style={{ width: `${record.progress}%` }} /></span>
              </article>)}
              {Array.from({ length: Math.max(0, 4 - overviewMasteryRecords.length) }, (_, index) => <article className="is-placeholder" key={`future-${index}`}><div className="dr-profile-future-hero"><LockKeyhole /></div><div><strong>FUTURE HERO</strong><small>MASTERY SLOT</small></div><span className="dr-profile-mastery-bar"><i /></span></article>)}
            </div>
          </section>
        </div>

        <div className="dr-profile-right-stack">
          <section className="dr-profile-panel dr-profile-banner-panel">
            <header><strong>FEATURED BANNER</strong><span>FOUNDATION</span></header>
            <div className="dr-profile-banner-art"><div><strong>A BRIGHTER<br />TOMORROW</strong><img src="/assets/icon/dawnreach.png" alt="" /></div></div>
          </section>

          <section className="dr-profile-panel dr-profile-achievements-panel">
            <header><strong>MEDALS & ACHIEVEMENTS</strong><span>COMING LATER</span></header>
            <PlaceholderMedals />
          </section>
        </div>
      </div> : section === 'history' ? <section className="dr-profile-history-page dr-profile-panel">
        <header><strong>MATCH HISTORY</strong><span>{entries.length} RECORDED MATCHES</span></header>
        <div className="dr-profile-history-intro"><History /><div><h2>YOUR BATTLES</h2><p>Completed matches are stored with their post-match report. Select a match to reopen its detailed results.</p></div></div>
        {loading
          ? <div className="dr-profile-loading">Loading match history…</div>
          : loadError
            ? <div className="dr-profile-empty-list"><History /><strong>HISTORY UNAVAILABLE</strong><span>{loadError}</span></div>
            : <MatchRows entries={entries} onOpenMatch={onOpenMatch} />}
        {!!entries.length && !loadError && <footer>
          <span>{recordedWins} victories</span>
          <span>{recordedLosses} defeats</span>
          <span>{entries.filter(entry => entry.match.status === 'cancelled').length} cancelled</span>
          <span>{entries.filter(entry => entry.match.postMatchReport?.voided).length} void</span>
        </footer>}
      </section> : section === 'mastery' ? <section className="dr-profile-section-page">
        <div className="dr-profile-section-heading">
          <div><small>PROFILE PROGRESSION</small><h2>HERO MASTERY</h2><p>Performance and experience with each Dawnreach hero, built from your recorded matches.</p></div>
          <Swords />
        </div>

        <div className="dr-profile-mastery-page-grid">
          <section className="dr-profile-panel dr-profile-mastery-feature">
            <header><strong>{featuredMastery?.hero.displayName.toUpperCase() ?? 'HERO'}</strong><span>FEATURED MASTERY</span></header>
            <div className="dr-profile-mastery-feature-body">
              <div className="dr-profile-mastery-portrait"><img src={profileHeroFullArt(featuredMastery?.hero.id ?? featuredHeroId)} alt={featuredMastery?.hero.displayName ?? favoriteHeroName} /></div>
              <div className="dr-profile-mastery-feature-copy">
                <small>{featuredMastery ? `${featuredMastery.hero.className.toUpperCase()} · ${featuredMastery.hero.primaryRole.toUpperCase()}` : 'DAWNREACH HERO'}</small>
                <h3>{featuredMastery?.hero.displayName ?? favoriteHeroName}</h3>
                <p>Your current mastery record for this Dawnreach hero.</p>
                <span className="dr-profile-master-level"><b>{featuredMastery?.masteryLevel ?? 0}</b><i>MASTERY LEVEL</i></span>
                <div className="dr-profile-master-progress"><i style={{ width: `${featuredMastery?.progress ?? 0}%` }} /></div>
                <em>{featuredMastery?.entries.length ?? 0} / 25 matches toward the current foundation milestone</em>
              </div>
            </div>
          </section>

          <section className="dr-profile-panel dr-profile-mastery-stats">
            <header><strong>MASTERY PERFORMANCE</strong><span>RECORDED MATCHES</span></header>
            <div className="dr-profile-stat-tile-grid">
              <article><small>MATCHES</small><strong>{historyReady ? featuredMastery?.entries.length ?? 0 : '—'}</strong></article>
              <article><small>WIN RATE</small><strong>{historyReady && featuredMastery && featuredMastery.wins + featuredMastery.losses ? `${featuredMastery.winRate.toFixed(1)}%` : '—'}</strong></article>
              <article><small>K / D / A</small><strong>{historyReady && featuredMastery ? `${featuredMastery.kills} / ${featuredMastery.deaths} / ${featuredMastery.assists}` : '—'}</strong></article>
              <article><small>KDA RATIO</small><strong>{historyReady && featuredMastery?.entries.length ? featuredMastery.kda.toFixed(2) : '—'}</strong></article>
            </div>
          </section>

          <section className="dr-profile-panel dr-profile-roster-panel">
            <header><strong>HERO ROSTER</strong><span>MASTERY COLLECTION</span></header>
            <div className="dr-profile-roster-grid">
              {masteryRecords.map(record => <article className="is-owned" key={record.hero.id}>
                <img src={profileHeroPortrait(record.hero.id)} alt={record.hero.displayName} />
                <div><strong>{record.hero.displayName.toUpperCase()}</strong><small>{record.entries.length} MATCHES</small></div>
                <span><i style={{ width: `${record.progress}%` }} /></span>
              </article>)}
              {Array.from({ length: Math.max(0, 8 - masteryRecords.length) }, (_, index) => <article className="is-locked" key={`future-${index}`}><div className="dr-profile-roster-placeholder"><LockKeyhole /></div><div><strong>FUTURE HERO</strong><small>NOT YET AVAILABLE</small></div><span><i /></span></article>)}
            </div>
          </section>
        </div>
      </section> : section === 'achievements' ? <section className="dr-profile-section-page">
        <div className="dr-profile-section-heading">
          <div><small>PROFILE PROGRESSION</small><h2>ACHIEVEMENTS</h2><p>The achievement system is reserved here without inventing medals or requirements before they are defined.</p></div>
          <Trophy />
        </div>

        <div className="dr-profile-achievements-page-grid">
          <section className="dr-profile-panel dr-profile-achievement-showcase">
            <header><strong>FEATURED MEDALS</strong><span>4 DISPLAY SLOTS</span></header>
            <PlaceholderMedals />
          </section>
          <section className="dr-profile-panel dr-profile-achievement-summary">
            <header><strong>ACHIEVEMENT SUMMARY</strong><span>SYSTEM FOUNDATION</span></header>
            <div className="dr-profile-stat-tile-grid">
              <article><small>UNLOCKED</small><strong>0</strong></article>
              <article><small>TOTAL DEFINED</small><strong>—</strong></article>
              <article><small>COMPLETION</small><strong>—</strong></article>
              <article><small>RAREST</small><strong>—</strong></article>
            </div>
          </section>
          <section className="dr-profile-panel dr-profile-achievement-catalog">
            <header><strong>ACHIEVEMENT CATALOG</strong><span>AWAITING FINAL DEFINITIONS</span></header>
            <div className="dr-profile-achievement-category-grid">
              {['COMBAT', 'VICTORIES', 'HERO MASTERY', 'OBJECTIVES', 'COLLECTION', 'SOCIAL'].map(label => (
                <article key={label}><div><LockKeyhole /></div><span><strong>{label}</strong><small>Achievement definitions pending</small></span><b>—</b></article>
              ))}
            </div>
          </section>
        </div>
      </section> : section === 'cosmetics' ? <section className="dr-profile-section-page">
        <div className="dr-profile-section-heading">
          <div><small>PLAYER IDENTITY</small><h2>COSMETICS</h2><p>Profile presentation slots are prepared now; owned cosmetics can be wired in when the collection system is defined.</p></div>
          <Sparkles />
        </div>

        <div className="dr-profile-cosmetics-grid">
          <section className="dr-profile-panel dr-profile-cosmetic-preview">
            <header><strong>PROFILE PREVIEW</strong><span>FOUNDATION LOADOUT</span></header>
            <div className="dr-profile-cosmetic-banner-preview">
              <div className="dr-profile-cosmetic-avatar"><strong>{user.username.slice(0,2).toUpperCase()}</strong></div>
              <div><h3>{user.username}</h3><span>DAWNREACH PLAYER</span><small>A BRIGHTER TOMORROW</small></div>
              <img src={featuredHeroArt} alt="" />
            </div>
          </section>
          <section className="dr-profile-panel dr-profile-equipped-cosmetics">
            <header><strong>EQUIPPED</strong><span>4 PROFILE SLOTS</span></header>
            <div className="dr-profile-equipped-grid">
              <article><Sparkles /><span><small>BANNER</small><strong>FOUNDATION</strong></span></article>
              <article><UserRound /><span><small>AVATAR</small><strong>INITIALS</strong></span></article>
              <article><Crown /><span><small>FRAME</small><strong>FOUNDATION</strong></span></article>
              <article><Medal /><span><small>TITLE</small><strong>DAWNREACH PLAYER</strong></span></article>
            </div>
          </section>
          <section className="dr-profile-panel dr-profile-cosmetic-collection">
            <header><strong>COLLECTION SLOTS</strong><span>COMING WITH COLLECTION</span></header>
            <div className="dr-profile-cosmetic-slot-grid">
              {Array.from({ length: 12 }, (_, index) => <article key={index}><LockKeyhole /><strong>UNASSIGNED</strong><small>COSMETIC SLOT</small></article>)}
            </div>
          </section>
        </div>
      </section> : <section className="dr-profile-section-page">
        <div className="dr-profile-section-heading">
          <div><small>ACCOUNT PERFORMANCE</small><h2>STATS</h2><p>Aggregate performance from the matches currently stored in your Dawnreach history.</p></div>
          <BarChart3 />
        </div>

        <div className="dr-profile-stats-page-grid">
          <section className="dr-profile-panel dr-profile-stats-overall">
            <header><strong>OVERALL PERFORMANCE</strong><span>ALL RECORDED MODES</span></header>
            <div className="dr-profile-stat-tile-grid is-large">
              <article><small>MATCHES</small><strong>{historyReady ? totalMatches : '—'}</strong></article>
              <article><small>WIN RATE</small><strong>{historyReady && decisiveEntries.length ? `${winRate.toFixed(1)}%` : '—'}</strong></article>
              <article><small>K / D / A</small><strong>{historyReady ? `${totalKills} / ${totalDeaths} / ${totalAssists}` : '—'}</strong></article>
              <article><small>KDA RATIO</small><strong>{historyReady && playedEntries.length ? overallKda.toFixed(2) : '—'}</strong></article>
              <article><small>AVG NET WORTH</small><strong>{historyReady && netWorthEntries.length ? formatNumber(averageNetWorth) : '—'}</strong></article>
              <article><small>PLAY TIME</small><strong>{historyReady && totalRecordedMs ? `${Math.floor(totalRecordedMs / 3_600_000)}h ${Math.floor((totalRecordedMs % 3_600_000) / 60_000)}m` : '—'}</strong></article>
            </div>
          </section>

          <section className="dr-profile-panel dr-profile-stats-modes">
            <header><strong>MODES PLAYED</strong><span>RECORDED HISTORY</span></header>
            <div className="dr-profile-mode-stats">
              {['custom','normal','ranked'].map(mode => {
                const count = modeCounts.get(mode) || 0;
                const width = totalMatches ? Math.round((count / totalMatches) * 100) : 0;
                return <article key={mode}><span><strong>{mode.toUpperCase()}</strong><small>{count} matches</small></span><div><i style={{ width: `${width}%` }} /></div><b>{width}%</b></article>;
              })}
            </div>
          </section>

          <section className="dr-profile-panel dr-profile-stats-records">
            <header><strong>MATCH RECORDS</strong><span>AVAILABLE TELEMETRY</span></header>
            <div className="dr-profile-stat-tile-grid">
              <article><small>AVG MATCH</small><strong>{historyReady && averageDurationMs ? formatDuration(averageDurationMs) : '—'}</strong></article>
              <article><small>LONGEST MATCH</small><strong>{historyReady && longestDurationMs ? formatDuration(longestDurationMs) : '—'}</strong></article>
              <article><small>VICTORIES</small><strong>{historyReady ? recordedWins : '—'}</strong></article>
              <article><small>DEFEATS</small><strong>{historyReady ? recordedLosses : '—'}</strong></article>
            </div>
          </section>

          <section className="dr-profile-panel dr-profile-stats-recent">
            <header><strong>RECENT FORM</strong><span>LAST 5 MATCHES</span></header>
            <div className="dr-profile-form-strip">
              {entries.slice(0,5).map(entry => <span key={entry.match.id} className={entry.won === true ? 'is-win' : entry.won === false ? 'is-loss' : 'is-neutral'}><b>{entry.won === true ? 'W' : entry.won === false ? 'L' : '—'}</b><small>{entry.heroName}</small></span>)}
              {!entries.length && <em>No recorded matches yet.</em>}
            </div>
          </section>
        </div>
      </section>}

      <footer className="dr-profile-footer">
        <div><img src="/assets/icon/dawnreach.png" alt="" /><span><strong>DAWNREACH</strong><small>A BRIGHTER TOMORROW</small></span></div>
        <q>GREAT PLAYERS BUILD BRIGHTER WORLDS.</q>
        <Medal />
      </footer>
    </div>
  </section>;
}
