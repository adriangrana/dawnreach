import {
  Check,
  Clock3,
  LockKeyhole,
  Search,
  Send,
  Shield,
  Swords,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import ALDEN_SELECTION_ART from '../game/heroes/alden/images/H001.webp';
import ALDEN_PASSIVE from '../game/heroes/alden/images/H001P.webp';
import ALDEN_FOCUS_ART from '../game/heroes/alden/images/H001F.png';
import ALDEN_Q from '../game/heroes/alden/images/H001Q.webp';
import ALDEN_W from '../game/heroes/alden/images/H001W.webp';
import ALDEN_E from '../game/heroes/alden/images/H001E.webp';
import ALDEN_R from '../game/heroes/alden/images/H001R.webp';
import { ALDEN } from '../game/heroes/alden/gameplay';
import { platformRealtime } from './realtimeClient';
import type { HeroSelectPlayer, HeroSelectState, PlatformUser, Team } from './types';

const HERO_FOCUS_ART: Record<string, string> = {
  H001: ALDEN_FOCUS_ART,
};

const HERO_SELECTION_ART: Record<string, string> = {
  H001: ALDEN_SELECTION_ART,
};

const HERO_NAMES: Record<string, string> = {
  H001: ALDEN.displayName,
};

const ABILITIES = [
  {
    key: 'P',
    label: 'PASSIVE',
    name: ALDEN.innate.name,
    art: ALDEN_PASSIVE,
    description: ALDEN.innate.technicalDescription,
    stats: [
      `Max stacks · ${ALDEN.innate.maxStacks}`,
      `Front arc · ${ALDEN.innate.frontalArcDegrees}°`,
      `Empowered window · ${ALDEN.innate.empoweredAttackWindowSeconds}s`,
      `Proc lockout · ${ALDEN.innate.procLockoutSeconds}s`,
      `Bonus damage · ${ALDEN.innate.bonusDamageBase} + ${Math.round(ALDEN.innate.totalAdRatio * 100)}% total AD`,
    ],
  },
  {
    key: 'Q',
    label: 'Q',
    name: ALDEN.abilities.Q.name,
    art: ALDEN_Q,
    description: ALDEN.abilities.Q.technicalDescription,
    stats: [
      `Dash · ${ALDEN.q.dashRange}`,
      `Cleave · ${ALDEN.q.cleaveRange} / ${ALDEN.q.cleaveAngleDegrees}°`,
      `Damage · ${ALDEN.q.ranks[0].baseDamage}–${ALDEN.q.ranks[3].baseDamage} + ${Math.round(ALDEN.q.totalAdRatio * 100)}% total AD`,
      `Slow · ${ALDEN.q.ranks[0].slowPercent}–${ALDEN.q.ranks[3].slowPercent}%`,
      `Cooldown · ${ALDEN.q.ranks[0].cooldownSeconds}–${ALDEN.q.ranks[3].cooldownSeconds}s`,
    ],
  },
  {
    key: 'W',
    label: 'W',
    name: ALDEN.abilities.W.name,
    art: ALDEN_W,
    description: ALDEN.abilities.W.technicalDescription,
    stats: [
      `Guard · ${ALDEN.w.guardDurationSeconds}s / ${ALDEN.w.guardArcDegrees}°`,
      `Damage reduction · ${ALDEN.w.ranks[0].frontDamageReductionPercent}–${ALDEN.w.ranks[3].frontDamageReductionPercent}%`,
      `Movement penalty · ${ALDEN.w.movementPenaltyPercent}%`,
      `Reprisal window · ${ALDEN.w.reprisalWindowSeconds}s`,
      `Cooldown · ${ALDEN.w.ranks[0].cooldownSeconds}–${ALDEN.w.ranks[3].cooldownSeconds}s`,
    ],
  },
  {
    key: 'E',
    label: 'E',
    name: ALDEN.abilities.E.name,
    art: ALDEN_E,
    description: ALDEN.abilities.E.technicalDescription,
    stats: [
      `Cadence stacks · ${ALDEN.e.maxCadenceStacks}`,
      `Stack duration · ${ALDEN.e.cadenceDurationSeconds}s`,
      `Active radius · ${ALDEN.e.activeRadius}`,
      `Damage · ${ALDEN.e.ranks[0].activeBaseDamage}–${ALDEN.e.ranks[3].activeBaseDamage} + ${Math.round(ALDEN.e.activeTotalAdRatio * 100)}% total AD`,
      `Cooldown · ${ALDEN.e.ranks[0].cooldownSeconds}–${ALDEN.e.ranks[3].cooldownSeconds}s`,
    ],
  },
  {
    key: 'R',
    label: 'R',
    name: ALDEN.abilities.R.name,
    art: ALDEN_R,
    description: ALDEN.abilities.R.technicalDescription,
    stats: [
      `Radius · ${ALDEN.r.radius}`,
      `Damage · ${ALDEN.r.ranks[0].baseDamage}–${ALDEN.r.ranks[2].baseDamage} + ${Math.round(ALDEN.r.totalAdRatio * 100)}% total AD`,
      `Majesty · ${ALDEN.r.majestyDurationSeconds}s`,
      `Damage reduction · ${ALDEN.r.ranks[0].damageReductionPercent}–${ALDEN.r.ranks[2].damageReductionPercent}%`,
      `Cooldown · ${ALDEN.r.ranks[0].cooldownSeconds}–${ALDEN.r.ranks[2].cooldownSeconds}s`,
    ],
  },
] as const;

function formatClock(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function teamLabel(team: Team) {
  return team === 'blue' ? 'DAWN TEAM' : 'DUSK TEAM';
}

function HeroSelectPlayerCard({
  player,
  me,
  side,
}: {
  player: HeroSelectPlayer;
  me: PlatformUser;
  side: 'left' | 'right';
}) {
  const selected = player.selection.heroId;
  const heroName = selected ? HERO_NAMES[selected] || selected : null;
  return <article className={`dr-hero-select-player is-${player.team}${player.userId === me.id ? ' is-self' : ''}${player.selection.locked ? ' is-locked' : ''}`}>
    {side === 'left' && <div className="dr-hero-select-player-portrait">
      {selected ? <img src={HERO_SELECTION_ART[selected] || HERO_FOCUS_ART[selected]} alt="" draggable={false} /> : <span />}
    </div>}
    <div className="dr-hero-select-player-copy">
      <div><strong>{player.username}</strong>{player.userId === me.id && <em>YOU</em>}</div>
      <span>{player.lane}</span>
      <small>{player.selection.locked ? `LOCKED · ${heroName}` : selected ? `PICKING · ${heroName}` : 'WAITING…'}</small>
    </div>
    {side === 'right' && <div className="dr-hero-select-player-portrait">
      {selected ? <img src={HERO_SELECTION_ART[selected] || HERO_FOCUS_ART[selected]} alt="" draggable={false} /> : <span />}
    </div>}
  </article>;
}

function TeamColumn({
  team,
  players,
  me,
  side,
}: {
  team: Team;
  players: readonly HeroSelectPlayer[];
  me: PlatformUser;
  side: 'left' | 'right';
}) {
  return <aside className={`dr-hero-select-team is-${team} is-${side}`}>
    <header><span>{teamLabel(team)}</span><strong>{players.filter(player => player.selection.locked).length}/{players.length}</strong></header>
    <div>
      {players.map(player => <HeroSelectPlayerCard key={player.userId} player={player} me={me} side={side} />)}
    </div>
  </aside>;
}

function BansStrip({ team, count }: { team: Team; count: number }) {
  if (count <= 0) return <div className={`dr-hero-select-bans is-${team}`}><span>{team === 'blue' ? 'YOUR TEAM BANS' : 'ENEMY TEAM BANS'}</span><div><i className="is-disabled" /></div></div>;
  return <div className={`dr-hero-select-bans is-${team}`}>
    <span>{team === 'blue' ? 'YOUR TEAM BANS' : 'ENEMY TEAM BANS'}</span>
    <div>{Array.from({ length: count }, (_, index) => <i key={index}><LockKeyhole /></i>)}</div>
  </div>;
}

function HeroSelectChat({ state, me }: { state: HeroSelectState; me: PlatformUser }) {
  const [text, setText] = useState('');
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const meState = state.players.find(player => player.userId === me.id);
  const teamName = meState?.team === 'red' ? 'DUSK' : 'DAWN';

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [state.messages.length]);

  const send = () => {
    const message = text.trim();
    if (!message) return;
    platformRealtime.send('hero_select.message', { text: message });
    setText('');
  };

  return <section className="dr-hero-select-chat">
    <header><span>TEAM CHAT</span><small>{teamName}</small></header>
    <div ref={viewportRef}>
      {state.messages.map(message => <p className={message.system ? 'is-system' : ''} key={message.id}>
        <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
        {!message.system && <strong>{message.username}</strong>}
        <span>{message.text}</span>
      </p>)}
      {state.messages.length === 0 && <p className="is-empty"><span>Coordinate picks with your team.</span></p>}
    </div>
    <form onSubmit={event => { event.preventDefault(); send(); }}>
      <input value={text} onChange={event => setText(event.target.value)} maxLength={240} placeholder="Message your team…" />
      <button type="submit" disabled={!text.trim()} aria-label="Send team message"><Send /></button>
    </form>
  </section>;
}

export function HeroSelectScreen({
  state,
  me,
}: {
  state: HeroSelectState;
  me: PlatformUser;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [selectedHeroId, setSelectedHeroId] = useState<string | null>(() => {
    const mine = state.players.find(player => player.userId === me.id);
    return mine?.selection.heroId || state.availableHeroIds[0] || null;
  });
  const [search, setSearch] = useState('');

  const meState = state.players.find(player => player.userId === me.id) ?? null;
  const myTeam = meState?.team ?? 'blue';
  const leftPlayers = state.players.filter(player => player.team === myTeam);
  const rightPlayers = state.players.filter(player => player.team !== myTeam);
  const selected = selectedHeroId || meState?.selection.heroId || state.availableHeroIds[0] || null;
  const isLocked = Boolean(meState?.selection.locked);
  const filteredHeroes = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return state.availableHeroIds.filter(heroId => !needle || (HERO_NAMES[heroId] || heroId).toLowerCase().includes(needle));
  }, [search, state.availableHeroIds]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (meState?.selection.heroId) setSelectedHeroId(meState.selection.heroId);
  }, [meState?.selection.heroId]);

  useEffect(() => {
    if (!meState || meState.selection.heroId || !selectedHeroId || meState.selection.locked || state.phase === 'complete') return;
    platformRealtime.send('hero_select.preview', { heroId: selectedHeroId });
  }, [meState, selectedHeroId, state.phase]);

  const chooseHero = (heroId: string) => {
    if (isLocked || state.phase === 'complete') return;
    setSelectedHeroId(heroId);
    platformRealtime.send('hero_select.preview', { heroId });
  };

  const lockHero = () => {
    if (!selected || isLocked || state.phase === 'complete') return;
    platformRealtime.send('hero_select.lock', { heroId: selected });
  };

  const title = state.match.mode === 'ranked'
    ? 'RANKED DRAFT'
    : state.match.mode === 'custom'
      ? state.selectionType === 'draft' ? 'CUSTOM DRAFT' : 'CUSTOM · ALL PICK'
      : 'NORMAL · ALL PICK';

  return <main className="dr-hero-select-screen">
    <div className="dr-hero-select-backdrop" aria-hidden="true" />

    <header className="dr-hero-select-header">
      <div className="dr-hero-select-brand">
        <img src="/assets/icon/dawnreach.png" alt="" draggable={false} />
        <div><strong>DAWNREACH</strong><small>A BRIGHTER TOMORROW</small></div>
      </div>

      <BansStrip team="blue" count={state.bansPerTeam} />

      <div className="dr-hero-select-phase">
        <small>{state.phase === 'complete' ? 'SELECTION COMPLETE' : 'PICK PHASE'}</small>
        <strong>{title}</strong>
        <time><Clock3 />{state.phase === 'complete' ? '00:00' : formatClock(state.expiresAt - now)}</time>
      </div>

      <BansStrip team="red" count={state.bansPerTeam} />

      <div className="dr-hero-select-motto">
        <span>DIFFERENT HEROES.</span>
        <strong>A BRIGHTER TOMORROW.</strong>
      </div>
    </header>

    <section className="dr-hero-select-body">
      <TeamColumn team={myTeam} players={leftPlayers} me={me} side="left" />

      <section className="dr-hero-select-focus">
        <div className="dr-hero-select-hero-copy">
          <blockquote><span>“STRENGTH BUILDS WALLS.</span><strong>BUT HOPE BUILDS WORLDS.”</strong></blockquote>
          <div className="dr-hero-select-name">
            <h1>{selected ? HERO_NAMES[selected] || selected : 'CHOOSE A HERO'}</h1>
            <p>{selected === 'H001' ? 'THE OATHBEARER' : 'DAWNREACH HERO'}</p>
            {selected === 'H001' && <div><span>FIGHTER</span><span>VANGUARD</span><span>INITIATOR</span></div>}
          </div>
        </div>

        {selected && <img className="dr-hero-select-main-art" src={HERO_FOCUS_ART[selected] || HERO_SELECTION_ART[selected]} alt={HERO_NAMES[selected] || selected} draggable={false} />}

        <aside className="dr-hero-select-overview">
          <nav><button type="button" className="is-active">OVERVIEW</button><button type="button" disabled>SKINS</button></nav>
          <p>{selected === 'H001' ? ALDEN.lore : 'Select a hero to inspect their battlefield identity.'}</p>
          <div className="dr-hero-select-abilities">
            {ABILITIES.map(ability => <article
              key={ability.key}
              className="dr-hero-select-ability"
              tabIndex={0}
              aria-label={`${ability.label} · ${ability.name}`}
            >
              <img src={ability.art} alt="" draggable={false} />
              <small>{ability.label}</small>
              <span>{ability.name}</span>
              <div className="dr-hero-select-ability-tooltip" role="tooltip">
                <header><em>{ability.label}</em><strong>{ability.name}</strong></header>
                <p>{ability.description}</p>
                <ul>{ability.stats.map(stat => <li key={stat}>{stat}</li>)}</ul>
              </div>
            </article>)}
          </div>
          <div className="dr-hero-select-ratings">
            <label><span>DURABILITY</span><i><b style={{ width: '82%' }} /></i></label>
            <label><span>DAMAGE</span><i><b style={{ width: '48%' }} /></i></label>
            <label><span>MOBILITY</span><i><b style={{ width: '52%' }} /></i></label>
            <label><span>UTILITY</span><i><b style={{ width: '68%' }} /></i></label>
          </div>
        </aside>

        <button
          type="button"
          className={`dr-hero-select-lock${isLocked ? ' is-locked' : ''}`}
          disabled={!selected || isLocked || state.phase === 'complete'}
          onClick={lockHero}
        >
          {isLocked ? <><Check /> LOCKED IN</> : state.phase === 'complete' ? 'PREPARING MATCH' : 'LOCK IN'}
        </button>

        {state.rosterDevelopmentMode && <div className="dr-hero-select-dev-note">
          DEVELOPMENT ROSTER · duplicate heroes temporarily allowed until Dawnreach has enough heroes for unique team picks.
        </div>}
        {state.draftRulesDeferred && <div className="dr-hero-select-draft-note">
          Draft bans are visually reserved but disabled while the playable roster contains only Alden.
        </div>}
      </section>

      <TeamColumn team={myTeam === 'blue' ? 'red' : 'blue'} players={rightPlayers} me={me} side="right" />
    </section>

    <footer className="dr-hero-select-footer">
      <HeroSelectChat state={state} me={me} />

      <section className="dr-hero-select-roster">
        <header>
          <div className="dr-hero-select-roster-tabs"><button className="is-active" type="button">ALL</button><button type="button" disabled>VANGUARD</button><button type="button" disabled>CONTROL</button><button type="button" disabled>ASSAULT</button></div>
          <label><Search /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search heroes…" /></label>
        </header>
        <div>
          {filteredHeroes.map(heroId => <button
            type="button"
            key={heroId}
            className={`${selected === heroId ? 'is-selected' : ''}${meState?.selection.heroId === heroId && isLocked ? ' is-locked' : ''}`}
            disabled={isLocked}
            onClick={() => chooseHero(heroId)}
          >
            <img src={HERO_SELECTION_ART[heroId] || HERO_FOCUS_ART[heroId]} alt="" draggable={false} />
            <span>{HERO_NAMES[heroId] || heroId}</span>
          </button>)}
          {Array.from({ length: Math.max(0, 8 - filteredHeroes.length) }, (_, index) => <div className="dr-hero-select-roster-placeholder" key={index}><Shield /><span>COMING SOON</span></div>)}
        </div>
      </section>

      <aside className="dr-hero-select-footer-art">
        <Swords />
        <span>SAME SKIES.</span>
        <strong>NEW LEGENDS.</strong>
      </aside>
    </footer>
  </main>;
}
