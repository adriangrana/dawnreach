import { useState } from 'react';
import {
  ChevronDown,
  Crown,
  Gamepad2,
  MessageSquare,
  Plus,
  Settings,
  Shield,
  Sparkles,
  Swords,
  Trophy,
  Users,
} from 'lucide-react';
import aldenPortrait from '../game/heroes/alden/images/H001.webp';
import { platformRealtime } from './realtimeClient';
import { SocialRail } from './SocialRail';
import type { PartySnapshot, PlatformUser, SocialSnapshot } from './types';

const DAWNREACH_ICON = '/assets/icon/dawnreach.png';

export function DawnreachHomeTopbar({
  section,
  user,
  realtime,
  onHome,
  onPlay,
  onLogout,
}: {
  section: 'home' | 'play';
  user: PlatformUser;
  realtime: 'connecting' | 'online' | 'offline';
  onHome: () => void;
  onPlay: () => void;
  onLogout: () => void;
}) {
  return <header className="platform-topbar dr-home-topbar">
    <button className="dr-home-mark" type="button" onClick={onHome} aria-label="Inicio de Dawnreach"><img src={DAWNREACH_ICON} alt="" /></button>
    <nav className="dr-home-nav" aria-label="Navegación principal">
      <button className={section === 'home' ? 'is-active' : ''} onClick={onHome}>INICIO</button>
      <button className={section === 'play' ? 'is-active' : ''} onClick={onPlay}>JUGAR</button>
      <button disabled>HÉROES</button>
      <button disabled>COLECCIÓN</button>
      <button disabled>RANKING</button>
      <button disabled>PERFIL</button>
    </nav>
    <div className="dr-home-top-actions">
      <span className="dr-home-top-stat"><Trophy /> <strong>{user.calibrated ? user.rating : user.calibrationGames}</strong><small>{user.calibrated ? 'MMR' : 'CAL.'}</small></span>
      <span className="dr-home-top-stat"><Shield /> <strong>{user.wins}</strong><small>VICTORIAS</small></span>
      <button className="dr-home-icon-button" type="button" disabled aria-label="Mensajes"><MessageSquare /></button>
      <button className="dr-home-icon-button" type="button" disabled aria-label="Ajustes"><Settings /></button>
      <span className="dr-home-account-avatar">{user.username.slice(0, 2).toUpperCase()}</span>
      <span className="dr-home-account-copy"><strong>{user.username}</strong><small><i className={`platform-presence is-${realtime}`} /> {realtime === 'online' ? 'En línea' : realtime === 'connecting' ? 'Conectando…' : 'Sin conexión'}</small></span>
      <button className="dr-home-account-menu" type="button" onClick={onLogout} title="Cerrar sesión"><ChevronDown /></button>
    </div>
  </header>;
}

export function DawnreachHomeOverview({
  user,
  party,
  online,
  onPlay,
  onLocalPlay,
  onNormal,
  onRanked,
  onCustom,
}: {
  user: PlatformUser;
  party: PartySnapshot;
  online: readonly PlatformUser[];
  onPlay: () => void;
  onLocalPlay: () => void;
  onNormal: () => void;
  onRanked: () => void;
  onCustom: () => void;
}) {
  const games = user.wins + user.losses;
  const calibrationProgress = Math.min(100, Math.round((user.calibrationGames / Math.max(1, user.calibrationTarget)) * 100));
  return <section className="dr-home-overview">
    <div className="dr-home-stage">
      <aside className="dr-home-left-column">
        <article className="dr-home-season-card">
          <div><small>TEMPORADA I</small><h2>EL ALBA DE<br />LOS REINOS</h2><p>La guerra por los dos tronos acaba de comenzar.</p></div>
          <button type="button" disabled>VER TEMPORADA</button>
        </article>
        <article className="dr-home-progress-card">
          <div className="dr-home-progress-medal">{user.calibrated ? user.rating : user.calibrationGames}</div>
          <div><small>{user.calibrated ? 'CLASIFICACIÓN' : 'CALIBRACIÓN'}</small><strong>{user.calibrated ? `${user.rating} MMR` : `${user.calibrationGames} / ${user.calibrationTarget}`}</strong><span className="dr-home-progress-track"><i style={{ width: `${user.calibrated ? 100 : calibrationProgress}%` }} /></span></div>
        </article>
        <article className="dr-home-events-card">
          <header><strong>ACTIVIDAD</strong><button type="button" disabled>VER TODO</button></header>
          <div><span className="dr-home-event-icon"><Swords /></span><p><strong>Frontera abierta</strong><small>Matchmaking Normal disponible</small></p><em>AHORA</em></div>
          <div><span className="dr-home-event-icon"><Trophy /></span><p><strong>Clasificatoria</strong><small>{user.calibrated ? 'Defiende tu posición' : 'Completa tu calibración'}</small></p><em>{games} P.</em></div>
          <div><span className="dr-home-event-icon"><Users /></span><p><strong>Consejo de guerra</strong><small>{party.party ? `Escuadra ${party.party.members.length}/5` : 'Forma una escuadra'}</small></p><em>{online.length} ON</em></div>
        </article>
      </aside>

      <div className="dr-home-feature-copy">
        <span>HÉROE DESTACADO</span>
        <h1>ALDEN</h1>
        <h3>EL REY DE HIERRO</h3>
        <p>Frontline, iniciador y combatiente de daño sostenido.</p>
        <button type="button" onClick={onPlay}>PREPARAR BATALLA</button>
      </div>

      <nav className="dr-home-mode-ribbon" aria-label="Modos de juego">
        <button type="button" onClick={onLocalPlay}><Gamepad2 /><span><strong>ENTRENAMIENTO</strong><small>Prueba el campo de batalla</small></span></button>
        <button type="button" onClick={onNormal}><Shield /><span><strong>NORMAL</strong><small>Combate sin presión</small></span></button>
        <button className="is-primary" type="button" onClick={onPlay}><Swords /><span><strong>JUGAR</strong><small>Elige tu modo</small></span></button>
        <button type="button" onClick={onRanked} className='invert'><Trophy /><span><strong>RANKED</strong><small>Asciende en la clasificación</small></span></button>
        <button type="button" onClick={onCustom}><Sparkles /><span><strong>PERSONALIZADA</strong><small>Tus reglas, tu sala</small></span></button>
      </nav>
    </div>

    <div className="dr-home-lower-strip">
      <article className="dr-home-news-card is-wide"><div><small>CRÓNICAS DE DAWNREACH</small><strong>Más allá del campo de batalla</strong><span>Descubre los reinos que luchan por controlar la corona.</span></div></article>
      <article className="dr-home-news-card is-hero"><img src={aldenPortrait} alt="Alden" /><div><small>HÉROE</small><strong>Alden</strong></div></article>
      <article className="dr-home-news-card is-update"><div><small>ACTUALIZACIÓN</small><strong>Temporada de Fundación</strong></div></article>
      <article className="dr-home-channel-card"><header><strong>CANAL</strong><span>General&nbsp;&nbsp; · &nbsp;&nbsp;Grupo</span></header><div><p>El chat social y los mensajes privados están disponibles en el panel de amigos.</p></div><footer><input disabled placeholder="Selecciona un amigo para conversar…" /><button disabled><MessageSquare /></button></footer></article>
      <article className="dr-home-motto-card"><Crown /><strong>DOS REINOS.<br />UN TRONO.</strong><span>DAWNREACH</span></article>
    </div>
  </section>;
}

export function DawnreachHomeRightRail({
  me,
  online,
  snapshot,
  party,
  refresh,
}: {
  me: PlatformUser;
  online: readonly PlatformUser[];
  snapshot: SocialSnapshot;
  party: PartySnapshot;
  refresh: () => Promise<void>;
}) {
  const [inviteName, setInviteName] = useState('');
  const activeParty = party.party;
  const members = activeParty?.members ?? [me];
  const isLeader = !activeParty || activeParty.leaderId === me.id;
  const invite = () => {
    const username = inviteName.trim();
    if (!username || !activeParty || !isLeader) return;
    if (platformRealtime.send('party.invite', { username })) setInviteName('');
  };

  return <aside className="dr-home-right-rail">
    <section className="dr-home-party-card">
      <header><strong>GRUPO</strong><span>{members.length}/5</span></header>
      <div className="dr-home-party-slots">
        {Array.from({ length: 5 }, (_, index) => {
          const member = members[index];
          return <span key={member?.id ?? `empty-${index}`} className={member ? 'is-filled' : ''}>{member ? <><b>{member.username.slice(0, 2).toUpperCase()}</b>{activeParty?.leaderId === member.id && <Crown />}</> : <Plus />}</span>;
        })}
      </div>
      {!activeParty ? <button className="dr-home-party-main" type="button" onClick={() => platformRealtime.send('party.create')}>CREAR GRUPO</button> : isLeader ? <div className="dr-home-party-invite"><input value={inviteName} onChange={event => setInviteName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); invite(); } }} placeholder="Invitar por usuario" /><button type="button" onClick={invite}>INVITAR</button></div> : <button className="dr-home-party-main" type="button" onClick={() => platformRealtime.send('party.leave')}>SALIR DEL GRUPO</button>}
      {activeParty && isLeader && <button className="dr-home-party-leave" type="button" onClick={() => platformRealtime.send('party.leave')}>Salir del grupo</button>}
    </section>
    <SocialRail me={me} online={online} snapshot={snapshot} party={party} refresh={refresh} />
  </aside>;
}
