import { useEffect, useMemo, useState } from 'react';
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
import aldenPortrait from '../game/heroes/alden/images/H001.webp';
import aldenFullArt from '../game/heroes/alden/images/H001F.png';
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
}>;

const PROFILE_SECTIONS: readonly Readonly<{ key: ProfileSection; label: string; icon: typeof Trophy; ready: boolean }>[] = [
  { key: 'overview', label: 'OVERVIEW', icon: UserRound, ready: true },
  { key: 'history', label: 'MATCH HISTORY', icon: History, ready: true },
  { key: 'mastery', label: 'HERO MASTERY', icon: Swords, ready: false },
  { key: 'achievements', label: 'ACHIEVEMENTS', icon: Trophy, ready: false },
  { key: 'cosmetics', label: 'COSMETICS', icon: Sparkles, ready: false },
  { key: 'stats', label: 'STATS', icon: BarChart3, ready: false },
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

function historyEntry(match: MatchSummary, userId: string): HistoryEntry {
  const participant = match.players.find(player => player.userId === userId) ?? null;
  const resultPlayer = match.postMatchReport?.players.find(player => player.userId === userId) ?? null;
  const heroId = resultPlayer?.heroId || match.heroSelections?.[userId]?.heroId || 'H001';
  const durationMs = Number(match.postMatchReport?.durationMs || 0);
  const won = match.status === 'cancelled' || !participant || !match.winnerTeam
    ? null
    : participant.team === match.winnerTeam;
  return {
    match,
    team: participant?.team ?? null,
    won,
    heroId,
    heroName: resultPlayer?.heroName || (heroId === 'H001' ? 'Alden' : heroId),
    kills: Number(resultPlayer?.kills || 0),
    deaths: Number(resultPlayer?.deaths || 0),
    assists: Number(resultPlayer?.assists || 0),
    durationMs,
    netWorth: resultPlayer?.netWorth !== undefined ? Number(resultPlayer.netWorth) : null,
  };
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
        <span className="dr-profile-match-hero"><img src={aldenPortrait} alt="" /><span><strong>{entry.heroName}</strong><small>{entry.match.mode.toUpperCase()}</small></span></span>
        <span className="dr-profile-match-kda"><b>{entry.kills} / {entry.deaths} / {entry.assists}</b><small>K / D / A</small></span>
        <strong className="dr-profile-match-result">{entry.won === null ? 'ENDED' : entry.won ? 'VICTORY' : 'DEFEAT'}</strong>
        <span className="dr-profile-match-networth"><b>{entry.netWorth === null ? '—' : formatNumber(entry.netWorth)}</b><small>NET WORTH</small></span>
        <span className="dr-profile-match-time"><b>{formatDuration(entry.durationMs)}</b><small>{formatMatchDate(entry.match.endedAt || entry.match.createdAt)}</small></span>
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

  useEffect(() => {
    let active = true;
    setLoading(true);
    void getProfileMatchHistory(50)
      .then(result => { if (active) setMatches(result); })
      .catch(() => { if (active) setMatches([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user.id]);

  const entries = useMemo(() => matches.map(match => historyEntry(match, user.id)), [matches, user.id]);
  const completedEntries = entries.filter(entry => entry.won !== null);
  const recordedWins = completedEntries.filter(entry => entry.won).length;
  const recordedLosses = completedEntries.filter(entry => entry.won === false).length;
  const totalRecordedMs = entries.reduce((sum, entry) => sum + entry.durationMs, 0);
  const totalMatches = user.wins + user.losses;
  const winRate = totalMatches > 0 ? (user.wins / totalMatches) * 100 : 0;
  const calibrationProgress = Math.min(100, Math.round((user.calibrationGames / Math.max(1, user.calibrationTarget)) * 100));
  const rankProgress = user.calibrated ? 100 : calibrationProgress;
  const heroCounts = new Map<string, number>();
  for (const entry of completedEntries) heroCounts.set(entry.heroName, (heroCounts.get(entry.heroName) || 0) + 1);
  const favoriteHero = [...heroCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['Alden', 0];

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
          <h2>DAWNREACH PLAYER</h2>
          <span><i className={`platform-presence is-${realtime}`} /> {realtime === 'online' ? 'Online' : realtime === 'connecting' ? 'Connecting…' : 'Offline'}</span>
          <p>Light finds a way.</p>
        </div>
        <div className="dr-profile-identity-art" aria-hidden="true"><img src={aldenFullArt} alt="" /></div>
        <div className="dr-profile-identity-motto"><strong>VALOR<br />GUIDES US</strong><img src="/assets/icon/dawnreach.png" alt="" /></div>
      </header>

      {section === 'overview' ? <div className="dr-profile-overview-grid">
        <div className="dr-profile-left-stack">
          <section className="dr-profile-panel dr-profile-summary-panel">
            <header><strong>OVERVIEW</strong><span>PLAYER ID <b>#{user.id.slice(0, 8).toUpperCase()}</b></span></header>
            <div className="dr-profile-summary-grid">
              <article><Swords /><span><small>TOTAL MATCHES</small><strong>{formatNumber(totalMatches)}</strong></span></article>
              <article><Trophy /><span><small>WIN RATE</small><strong>{totalMatches ? `${winRate.toFixed(1)}%` : '—'}</strong></span></article>
              <article><Clock3 /><span><small>RECORDED TIME</small><strong>{totalRecordedMs ? `${Math.floor(totalRecordedMs / 3_600_000)}h ${Math.floor((totalRecordedMs % 3_600_000) / 60_000)}m` : '—'}</strong></span></article>
              <article className="is-hero"><img src={aldenPortrait} alt="" /><span><small>FAVORITE HERO</small><strong>{favoriteHero[0]}</strong><em>{favoriteHero[1]} recorded matches</em></span></article>
              <article><Shield /><span><small>PREFERRED ROLE</small><strong>NOT SET</strong><em>Role tracking pending</em></span></article>
              <article><CalendarDays /><span><small>ACCOUNT CREATED</small><strong>SEASON I</strong><em>{formatAccountDate(user.createdAt)}</em></span></article>
            </div>
          </section>

          <section className="dr-profile-panel dr-profile-recent-panel">
            <header><strong>RECENT MATCHES</strong><button type="button" onClick={() => setSection('history')}>VIEW ALL <ChevronRight /></button></header>
            {loading ? <div className="dr-profile-loading">Loading match history…</div> : <MatchRows entries={entries} onOpenMatch={onOpenMatch} limit={5} />}
          </section>
        </div>

        <div className="dr-profile-center-stack">
          <section className="dr-profile-panel dr-profile-ranked-panel">
            <header><strong>RANKED PROGRESSION</strong><span>SEASON I</span></header>
            <div className="dr-profile-ranked-content">
              <div className="dr-profile-rank-emblem"><Crown /><span /></div>
              <div className="dr-profile-rank-copy">
                <small>{user.calibrated ? 'CURRENT RATING' : 'RANK CALIBRATION'}</small>
                <h3>{user.calibrated ? `${formatNumber(user.rating)} MMR` : 'PROVISIONAL'}</h3>
                <strong>{user.calibrated ? `${user.rankedGames} ranked games` : `${user.calibrationGames} / ${user.calibrationTarget} GAMES`}</strong>
                <span className="dr-profile-rank-track"><i style={{ width: `${rankProgress}%` }} /></span>
              </div>
            </div>
            <div className="dr-profile-rank-history">
              <div className="dr-profile-rank-grid-lines">{Array.from({ length: 8 }, (_, index) => <i key={index} />)}</div>
              <span>RATING HISTORY WILL APPEAR HERE ONCE SEASONAL TRACKING IS ENABLED.</span>
            </div>
          </section>

          <section className="dr-profile-panel dr-profile-mastery-panel">
            <header><strong>HERO MASTERY</strong><span>FOUNDATION ROSTER</span></header>
            <div className="dr-profile-mastery-grid">
              <article>
                <img src={aldenPortrait} alt="Alden" />
                <div><strong>ALDEN</strong><small>{favoriteHero[1]} RECORDED MATCHES</small></div>
                <span className="dr-profile-mastery-bar"><i style={{ width: favoriteHero[1] ? '68%' : '12%' }} /></span>
              </article>
              {Array.from({ length: 3 }, (_, index) => <article className="is-placeholder" key={index}><div className="dr-profile-future-hero"><LockKeyhole /></div><div><strong>FUTURE HERO</strong><small>MASTERY SLOT</small></div><span className="dr-profile-mastery-bar"><i /></span></article>)}
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
      </div> : <section className="dr-profile-history-page dr-profile-panel">
        <header><strong>MATCH HISTORY</strong><span>{entries.length} RECORDED MATCHES</span></header>
        <div className="dr-profile-history-intro"><History /><div><h2>YOUR BATTLES</h2><p>Completed matches are stored with their post-match report. Select a match to reopen its detailed results.</p></div></div>
        {loading ? <div className="dr-profile-loading">Loading match history…</div> : <MatchRows entries={entries} onOpenMatch={onOpenMatch} />}
        {!!entries.length && <footer><span>{recordedWins} victories</span><span>{recordedLosses} defeats</span><span>{entries.length - completedEntries.length} cancelled / neutral</span></footer>}
      </section>}

      <footer className="dr-profile-footer">
        <div><img src="/assets/icon/dawnreach.png" alt="" /><span><strong>DAWNREACH</strong><small>A BRIGHTER TOMORROW</small></span></div>
        <q>GREAT PLAYERS BUILD BRIGHTER WORLDS.</q>
        <Medal />
      </footer>
    </div>
  </section>;
}
