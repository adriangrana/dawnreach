import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Crown, LockKeyhole, Search, Shield, Sparkles, Swords, Trophy, Users } from 'lucide-react';
import { getRankedLeaderboard } from './apiClient';
import type { PlatformUser, RankingEntry, SocialSnapshot } from './types';

type RankingScope = 'global' | 'friends';
const DAWNREACH_ICON = '/assets/icon/dawnreach.png';

function formatNumber(value: number) {
  return Math.max(0, Math.round(value)).toLocaleString('en-US');
}
function winRate(user: Pick<PlatformUser, 'wins' | 'losses'>) {
  const total = user.wins + user.losses;
  return total > 0 ? (user.wins / total) * 100 : 0;
}
function initials(username: string) { return username.slice(0, 2).toUpperCase(); }
function StandingAvatar({ entry }: { entry: Pick<PlatformUser, 'username'> }) {
  return <span className="dr-ranking-avatar" aria-hidden="true">{initials(entry.username)}</span>;
}
function PodiumCard({ entry, place }: { entry: RankingEntry | null; place: 1 | 2 | 3 }) {
  return <article className={`dr-ranking-podium-card is-place-${place} ${entry ? '' : 'is-empty'}`}>
    <span className="dr-ranking-podium-place">{place}</span>
    {entry ? <>
      <StandingAvatar entry={entry} />
      <div><strong>{entry.username}</strong><small>RATED PLAYER</small><b>{formatNumber(entry.rating)} MMR</b></div>
    </> : <>
      <span className="dr-ranking-empty-avatar"><LockKeyhole /></span>
      <div><strong>UNCLAIMED</strong><small>RANKED POSITION</small><b>—</b></div>
    </>}
  </article>;
}

export function DawnreachRanking({ user, social }: { user: PlatformUser; social: SocialSnapshot }) {
  const [entries, setEntries] = useState<readonly RankingEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [scope, setScope] = useState<RankingScope>('global');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void getRankedLeaderboard(500)
      .then(result => {
        if (!active) return;
        setEntries(result.entries);
        setTotal(result.total);
      })
      .catch(reason => {
        if (!active) return;
        setEntries([]);
        setTotal(0);
        setError(reason instanceof Error ? reason.message : 'Could not load rankings.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const friendIds = useMemo(() => new Set(social.friends.map(friend => friend.id)), [social.friends]);
  const scopedEntries = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return entries.filter(entry => {
      if (scope === 'friends' && entry.id !== user.id && !friendIds.has(entry.id)) return false;
      return !normalized || entry.username.toLowerCase().includes(normalized);
    });
  }, [entries, friendIds, query, scope, user.id]);

  const viewerStanding = entries.find(entry => entry.id === user.id) ?? null;
  const viewerGames = user.wins + user.losses;
  const viewerWinRate = winRate(user);
  const podium: readonly (RankingEntry | null)[] = [entries[0] ?? null, entries[1] ?? null, entries[2] ?? null];

  return <section className="dr-ranking-page">
    <header className="dr-ranking-hero">
      <div className="dr-ranking-brand-lockup"><img src={DAWNREACH_ICON} alt="" /><span><strong>DAWNREACH</strong><small>A BRIGHTER TOMORROW</small></span></div>
      <div className="dr-ranking-season-title"><small>COMPETITIVE LADDER</small><h1>SEASON I RANKINGS</h1><p>HIGHER GROUND AWAITS</p><span><i /><Crown /><i /></span></div>
      <blockquote>“SOME FIGHT FOR GLORY.<br />I FIGHT FOR A<br />BRIGHTER TOMORROW.”</blockquote>
    </header>

    <div className="dr-ranking-shell">
      <main className="dr-ranking-main">
        <section className="dr-ranking-panel dr-ranking-your-rank">
          <header><strong>YOUR RANK</strong><span>{user.calibrated ? 'RATED' : 'CALIBRATION'}</span></header>
          <div className="dr-ranking-your-body">
            <div className="dr-ranking-user">
              <span className="dr-ranking-user-avatar">{initials(user.username)}<i><Crown /></i></span>
              <div><h2>{user.username}</h2><p>Light finds a way.</p><small>{viewerStanding ? `#${viewerStanding.position} GLOBAL` : 'UNRANKED'}</small></div>
            </div>
            <div className="dr-ranking-rank-emblem"><Shield /><span /></div>
            <div className="dr-ranking-current">
              <small>{user.calibrated ? 'CURRENT RATING' : 'RANK CALIBRATION'}</small>
              <h3>{user.calibrated ? `${formatNumber(user.rating)} MMR` : 'PROVISIONAL'}</h3>
              <b>{user.calibrated ? `${user.rankedGames} RANKED MATCHES` : `${user.calibrationGames} / ${user.calibrationTarget} GAMES`}</b>
              <span className="dr-ranking-progress"><i style={{ width: `${user.calibrated ? 100 : Math.min(100, (user.calibrationGames / Math.max(1, user.calibrationTarget)) * 100)}%` }} /></span>
            </div>
            <div className="dr-ranking-user-metrics">
              <article><Swords /><span><small>RANKED MATCHES</small><strong>{formatNumber(user.rankedGames)}</strong></span></article>
              <article><Trophy /><span><small>WIN RATE</small><strong>{viewerGames ? `${viewerWinRate.toFixed(1)}%` : '—'}</strong></span></article>
            </div>
          </div>
        </section>

        <section className="dr-ranking-panel dr-ranking-board">
          <div className="dr-ranking-board-toolbar">
            <nav>
              <button type="button" className={scope === 'global' ? 'is-active' : ''} onClick={() => setScope('global')}>GLOBAL</button>
              <button type="button" className={scope === 'friends' ? 'is-active' : ''} onClick={() => setScope('friends')}>FRIENDS</button>
              <button type="button" disabled>REGION</button><button type="button" disabled>HEROES</button><button type="button" disabled>CLANS</button>
            </nav>
            <div className="dr-ranking-controls">
              <button type="button" disabled>REGION: GLOBAL</button><button type="button" disabled>QUEUE: RANKED</button><button type="button" disabled>SEASON I</button>
              <label><Search /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search players" /></label>
            </div>
          </div>

          <div className="dr-ranking-podium">
            <PodiumCard entry={podium[1]} place={2} /><PodiumCard entry={podium[0]} place={1} /><PodiumCard entry={podium[2]} place={3} />
          </div>

          <div className="dr-ranking-table">
            <div className="dr-ranking-table-head"><span>#</span><span>PLAYER</span><span>RATING</span><span>W / L</span><span>WIN RATE</span><span>STATUS</span><span /></div>
            {loading ? <div className="dr-ranking-empty"><Sparkles /><strong>LOADING RANKINGS</strong><span>Reading the competitive ladder…</span></div>
            : error ? <div className="dr-ranking-empty"><Shield /><strong>RANKINGS UNAVAILABLE</strong><span>{error}</span></div>
            : scopedEntries.length ? scopedEntries.map(entry => <article key={entry.id} className={`dr-ranking-row ${entry.id === user.id ? 'is-you' : ''}`}>
              <b>{entry.position}</b>
              <span className="dr-ranking-player-cell"><StandingAvatar entry={entry} /><strong>{entry.username}</strong>{entry.id === user.id && <small>YOU</small>}</span>
              <strong>{formatNumber(entry.rating)}</strong><span>{entry.wins} / {entry.losses}</span><span>{winRate(entry).toFixed(1)}%</span><span>RATED</span><ChevronRight />
            </article>) : <div className="dr-ranking-empty"><Trophy /><strong>NO RATED PLAYERS YET</strong><span>{scope === 'friends' ? 'No friends are currently calibrated.' : 'Complete ranked calibration to establish the first standings.'}</span></div>}
          </div>
        </section>
      </main>

      <aside className="dr-ranking-side">
        <section className="dr-ranking-panel dr-ranking-season-info">
          <header><strong>SEASON INFORMATION</strong><span>SEASON I</span></header>
          <div><small>FOUNDATION SEASON</small><h3>RANKED IS LIVE</h3><p>No season end date has been defined yet.</p></div>
          <blockquote>“GREATER PLAYERS BUILD BRIGHTER WORLDS.”</blockquote>
        </section>
        <section className="dr-ranking-panel dr-ranking-side-rank">
          <header><strong>YOUR RANK (SEASON I)</strong><span>{viewerStanding ? `#${viewerStanding.position}` : 'UNRANKED'}</span></header>
          <div className="dr-ranking-side-rank-body"><div className="dr-ranking-side-emblem"><Shield /></div><div><h3>{user.calibrated ? `${formatNumber(user.rating)} MMR` : 'PROVISIONAL'}</h3><strong>{user.calibrated ? 'RATED' : `${user.calibrationGames} / ${user.calibrationTarget} CALIBRATION`}</strong><small>{user.rankedGames} ranked matches</small></div></div>
        </section>
        <section className="dr-ranking-panel dr-ranking-rewards">
          <header><strong>SEASON REWARDS</strong><span>NOT DEFINED</span></header>
          <div>{Array.from({ length: 4 }, (_, index) => <article key={index}><span><LockKeyhole /></span><strong>REWARD SLOT</strong><small>UNASSIGNED</small></article>)}</div>
        </section>
        <section className="dr-ranking-panel dr-ranking-hero-board">
          <header><strong>HERO RANKINGS</strong><span>COMING LATER</span></header>
          <div className="dr-ranking-hero-placeholder"><Users /><span><strong>PER-HERO LADDER</strong><small>Ranked hero statistics are not tracked yet.</small></span></div>
        </section>
      </aside>
    </div>
  </section>;
}
