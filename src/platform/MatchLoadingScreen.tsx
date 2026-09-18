import { useEffect, useMemo, useState } from 'react';
import { Shield, Swords } from 'lucide-react';
import aldenCardArt from '../game/heroes/alden/images/H001.webp';
import { platformRealtime } from './realtimeClient';
import type { ActiveMatchSession, MatchPlayer, PlatformUser, Team } from './types';

const BACKGROUND = '/assets/images/ciudadela_celestial_entre_las_nubes.webp';
const MARK = '/assets/icon/dawnreach.png';

const HEROES: Record<string, { name: string; title: string; art: string }> = {
  H001: { name: 'ALDEN', title: 'THE OATHBEARER', art: aldenCardArt },
};

const TIPS = [
  'Vision around objectives can decide a fight before it begins.',
  'Two heroes pressure North, one controls Mid, and two hold South.',
  'A coordinated retreat is stronger than five isolated escapes.',
  'Information wins battles. Watch the lanes before committing to a fight.',
];

function laneFor(player: MatchPlayer, teammates: readonly MatchPlayer[]) {
  const ordered = [...teammates].sort((a, b) => a.slot - b.slot);
  const index = Math.max(0, ordered.findIndex(candidate => candidate.userId === player.userId));
  if (ordered.length <= 1) return 'MID';
  if (ordered.length === 2) return index === 0 ? 'NORTH' : 'SOUTH';
  if (ordered.length === 3) return ['NORTH', 'MID', 'SOUTH'][index] || 'MID';
  if (ordered.length === 4) return ['NORTH', 'NORTH', 'SOUTH', 'SOUTH'][index] || 'MID';
  return ['NORTH', 'NORTH', 'MID', 'SOUTH', 'SOUTH'][index] || 'MID';
}

function teamName(team: Team) {
  return team === 'blue' ? 'DAWN TEAM' : 'DUSK TEAM';
}

function LoadingPlayerCard({
  player,
  teammates,
  session,
  me,
}: {
  player: MatchPlayer;
  teammates: readonly MatchPlayer[];
  session: ActiveMatchSession;
  me: PlatformUser;
}) {
  const heroId = session.match.heroSelections?.[player.userId]?.heroId || 'H001';
  const hero = HEROES[heroId] || { name: heroId, title: 'DAWNREACH HERO', art: aldenCardArt };
  const progress = Math.max(0, Math.min(100, Number(session.match.loadingProgress?.[player.userId] || 0)));
  const lane = laneFor(player, teammates);
  return <article className={`dr-loading-player-card is-${player.team}${player.userId === me.id ? ' is-self' : ''}`}>
    <div className="dr-loading-player-art">
      <img src={hero.art} alt="" draggable={false} />
      <div className="dr-loading-player-art-shade" />
      {player.userId === me.id && <span className="dr-loading-you">YOU</span>}
    </div>
    <div className="dr-loading-player-identity">
      <strong>{hero.name}</strong>
      <small>{hero.title}</small>
    </div>
    <div className="dr-loading-player-meta">
      <span className="dr-loading-player-name">{player.username}</span>
      <span className="dr-loading-player-lane"><Shield /> {lane}</span>
    </div>
    <div className="dr-loading-player-progress">
      <i><b style={{ width: `${progress}%` }} /></i>
      <span>{progress}%</span>
    </div>
  </article>;
}

function TeamRow({
  team,
  players,
  session,
  me,
}: {
  team: Team;
  players: readonly MatchPlayer[];
  session: ActiveMatchSession;
  me: PlatformUser;
}) {
  return <section className={`dr-loading-team-row is-${team}`}>
    <header><span /><strong>{teamName(team)}</strong><span /></header>
    <div className="dr-loading-team-cards">
      {players.map(player => <LoadingPlayerCard key={player.userId} player={player} teammates={players} session={session} me={me} />)}
    </div>
  </section>;
}

function preloadImage(src: string) {
  return new Promise<void>(resolve => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = src;
    if (image.complete) resolve();
  });
}

export function MatchLoadingScreen({
  session,
  me,
}: {
  session: ActiveMatchSession;
  me: PlatformUser;
}) {
  const [tipIndex, setTipIndex] = useState(0);
  const match = session.match;
  const dawn = useMemo(() => match.players.filter(player => player.team === 'blue').sort((a, b) => a.slot - b.slot), [match.players]);
  const dusk = useMemo(() => match.players.filter(player => player.team === 'red').sort((a, b) => a.slot - b.slot), [match.players]);
  const progressValues = match.players.map(player => Number(match.loadingProgress?.[player.userId] || 0));
  const globalProgress = progressValues.length
    ? Math.round(progressValues.reduce((sum, value) => sum + value, 0) / progressValues.length)
    : 0;

  useEffect(() => {
    const timer = window.setInterval(() => setTipIndex(index => (index + 1) % TIPS.length), 7000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let disposed = false;
    const current = Number(match.loadingProgress?.[me.id] || 0);
    const report = (progress: number) => {
      if (!disposed && (progress > current || progress === 100)) {
        platformRealtime.send('match.loading.progress', { progress });
      }
    };

    const prepare = async () => {
      const visibleSince = performance.now();
      report(8);
      const selectedHeroIds = Object.values(match.heroSelections || {})
        .map(selection => selection.heroId)
        .filter((heroId): heroId is string => Boolean(heroId));
      const assets = [...new Set([
        BACKGROUND,
        MARK,
        ...selectedHeroIds.map(heroId => HEROES[heroId]?.art).filter((art): art is string => Boolean(art)),
      ])];

      let completed = 0;
      await Promise.all(assets.map(async asset => {
        await preloadImage(asset);
        completed += 1;
        report(Math.min(78, 18 + Math.round((completed / Math.max(1, assets.length)) * 60)));
      }));

      try {
        await document.fonts?.ready;
      } catch {
        // Font readiness should never block the battle.
      }
      report(90);

      const minimumVisibleMs = 1350;
      const remaining = minimumVisibleMs - (performance.now() - visibleSince);
      if (remaining > 0) await new Promise(resolve => window.setTimeout(resolve, remaining));
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      report(100);
    };

    void prepare();
    return () => { disposed = true; };
  }, [match.id, me.id]);

  const actualTeamSize = Math.max(dawn.length, dusk.length, 1);
  const modeLabel = match.mode === 'ranked'
    ? `RANKED ${actualTeamSize}V${actualTeamSize}`
    : match.mode === 'normal'
      ? `CLASSIC ${actualTeamSize}V${actualTeamSize}`
      : `CUSTOM ${match.customSettings?.teamSize || actualTeamSize}V${match.customSettings?.teamSize || actualTeamSize}`;
  const region = match.customSettings?.region && match.customSettings.region !== 'auto'
    ? match.customSettings.region.toUpperCase()
    : 'EUROPE';

  return <main className="dr-loading-screen">
    <div className="dr-loading-backdrop" aria-hidden="true" />
    <div className="dr-loading-vignette" aria-hidden="true" />

    <header className="dr-loading-brand">
      <img src={MARK} alt="" draggable={false} />
      <div><strong>DAWNREACH</strong><span>THE ETERNAL BATTLEFIELD</span></div>
    </header>

    <div className="dr-loading-motto">
      <span>MORE THAN A BATTLE.</span>
      <strong>A HIGHER PURPOSE.</strong>
    </div>

    <TeamRow team="blue" players={dawn} session={session} me={me} />

    <section className="dr-loading-centerpiece">
      <div className="dr-loading-world-title">
        <strong>DAWNREACH</strong>
        <span>THE ETERNAL BATTLEFIELD</span>
        <small>{modeLabel} <i /> {region}</small>
      </div>
      <div className="dr-loading-vs"><span /><strong>VS</strong><span /></div>
    </section>

    <TeamRow team="red" players={dusk} session={session} me={me} />

    <div className="dr-loading-side-copy is-left"><span>DIFFERENT HEROES.</span><strong>SAME DESTINY.</strong></div>
    <div className="dr-loading-side-copy is-right"><span>GLORY LIVES</span><strong>IN THOSE WHO RISE.</strong></div>

    <footer className="dr-loading-footer">
      <div className="dr-loading-tip"><Swords /><strong>TIP:</strong><span>{TIPS[tipIndex]}</span></div>
      <div className="dr-loading-total">
        <small>{globalProgress >= 100 ? 'ENTERING DAWNREACH…' : 'PREPARING THE BATTLE…'}</small>
        <div><i><b style={{ width: `${globalProgress}%` }} /></i><strong>{globalProgress}%</strong></div>
      </div>
    </footer>
  </main>;
}
