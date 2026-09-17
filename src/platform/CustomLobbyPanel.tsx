import { Copy, Lock, Plus, Shield, Swords, Users, X } from 'lucide-react';
import { useState } from 'react';
import { platformRealtime } from './realtimeClient';
import type { CustomLobby, PlatformUser, Team } from './types';

function TeamColumn({ team, lobby, me }: { team: Team; lobby: CustomLobby; me: PlatformUser }) {
  const title = team === 'blue' ? 'DAWN' : 'DUSK';
  const tone = team === 'blue' ? 'is-dawn' : 'is-dusk';
  const open = lobby.status === 'open';
  return <section className={`platform-lobby-team ${tone}`}>
    <header><span>{title}</span><strong>{lobby.players.filter(player => player.team === team).length}/5</strong></header>
    <div className="platform-lobby-slots">{Array.from({ length: 5 }).map((_, slot) => {
      const player = lobby.players.find(candidate => candidate.team === team && candidate.slot === slot);
      if (player) return <div className={`platform-lobby-slot is-filled${player.userId === me.id ? ' is-self' : ''}`} key={player.userId}>
        <span className="platform-lobby-avatar">{player.username.slice(0, 2).toUpperCase()}</span>
        <span><strong>{player.username}</strong><small>{player.rating > 0 ? `${player.rating} MMR` : 'Sin rango'}{player.userId === lobby.ownerId ? ' · HOST' : ''}</small></span>
      </div>;
      return <button type="button" className="platform-lobby-slot is-empty" disabled={!open} key={`${team}-${slot}`} onClick={() => platformRealtime.send('lobby.move', { team, slot })}>
        <Plus /><span>{open ? 'Moverme aquí' : 'Disponible'}</span>
      </button>;
    })}</div>
  </section>;
}

function CurrentLobby({ lobby, me }: { lobby: CustomLobby; me: PlatformUser }) {
  const owner = lobby.ownerId === me.id;
  const running = lobby.status !== 'open';
  return <section className="platform-current-lobby">
    <header className="platform-current-lobby-head">
      <div><small>{lobby.privacy === 'private' ? 'SALA PRIVADA' : 'SALA PÚBLICA'}</small><h3>{lobby.name}</h3><p>Código <button type="button" onClick={() => void navigator.clipboard?.writeText(lobby.code)}>{lobby.code}<Copy /></button></p></div>
      <span>{lobby.players.length}/{lobby.maxPlayers}</span>
    </header>
    <div className="platform-lobby-team-grid"><TeamColumn team="blue" lobby={lobby} me={me} /><div className="platform-lobby-versus">VS</div><TeamColumn team="red" lobby={lobby} me={me} /></div>
    <footer><p>{running ? 'Partida creada. El servidor de juego compartido se conectará en la siguiente fase.' : 'Selecciona cualquier hueco libre para cambiar de equipo o posición.'}</p>{!running && <button type="button" className="platform-lobby-secondary" onClick={() => platformRealtime.send('lobby.leave')}><X /> Salir</button>}{owner && !running && <button type="button" className="platform-lobby-primary" onClick={() => platformRealtime.send('lobby.start')}><Swords /> Crear partida</button>}</footer>
  </section>;
}

export function CustomLobbyPanel({ me, lobbies, currentLobby }: { me: PlatformUser; lobbies: readonly CustomLobby[]; currentLobby: CustomLobby | null }) {
  const [name, setName] = useState('');
  const [privateLobby, setPrivateLobby] = useState(false);
  const [joinCode, setJoinCode] = useState('');

  if (currentLobby) return <CurrentLobby lobby={currentLobby} me={me} />;

  return <div className="platform-custom-lobbies">
    <section className="platform-lobby-create">
      <div className="platform-lobby-heading"><Shield /><span><small>NUEVA SALA</small><strong>Reúne a los dos reinos</strong></span></div>
      <p>Crea una sala para scrims, pruebas o partidas organizadas. Los equipos conservan 5 huecos cada uno.</p>
      <label>Nombre de la sala<input value={name} onChange={event => setName(event.target.value)} maxLength={40} placeholder="Entrenamiento del gremio" /></label>
      <label className="platform-lobby-privacy"><input type="checkbox" checked={privateLobby} onChange={event => setPrivateLobby(event.target.checked)} /><Lock /><span><strong>Privada por código</strong><small>No aparecerá en el navegador público.</small></span></label>
      <button type="button" className="platform-lobby-primary" onClick={() => platformRealtime.send('lobby.create', { name, privacy: privateLobby ? 'private' : 'public', maxPlayers: 10 })}><Plus /> Crear sala</button>
    </section>
    <section className="platform-lobby-browser">
      <header><div><Users /><span><small>SALAS ABIERTAS</small><strong>{lobbies.length} públicas</strong></span></div><button type="button" onClick={() => platformRealtime.send('lobby.list')}>Actualizar</button></header>
      <form onSubmit={event => { event.preventDefault(); if (joinCode.trim()) platformRealtime.send('lobby.join', { code: joinCode.trim().toUpperCase() }); }}><input value={joinCode} onChange={event => setJoinCode(event.target.value.toUpperCase())} maxLength={12} placeholder="Código de invitación" /><button>Unirme</button></form>
      <div className="platform-lobby-list">{lobbies.map(lobby => <article key={lobby.id}><span className="platform-lobby-code">{lobby.code}</span><div><strong>{lobby.name}</strong><small>{lobby.ownerUsername} · {lobby.players.length}/{lobby.maxPlayers}</small></div><button type="button" onClick={() => platformRealtime.send('lobby.join', { code: lobby.code })}>Entrar</button></article>)}{lobbies.length === 0 && <div className="platform-lobby-empty">No hay salas públicas abiertas.</div>}</div>
    </section>
  </div>;
}
