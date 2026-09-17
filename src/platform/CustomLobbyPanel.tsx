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
        <span><strong>{player.username}</strong><small>{player.rating > 0 ? `${player.rating} MMR` : 'Unranked'}{player.userId === lobby.ownerId ? ' · HOST' : ''}</small></span>
      </div>;
      return <button type="button" className="platform-lobby-slot is-empty" disabled={!open} key={`${team}-${slot}`} onClick={() => platformRealtime.send('lobby.move', { team, slot })}>
        <Plus /><span>{open ? 'Move here' : 'Available'}</span>
      </button>;
    })}</div>
  </section>;
}

function CurrentLobby({ lobby, me }: { lobby: CustomLobby; me: PlatformUser }) {
  const owner = lobby.ownerId === me.id;
  const running = lobby.status !== 'open';
  return <section className="platform-current-lobby">
    <header className="platform-current-lobby-head">
      <div><small>{lobby.privacy === 'private' ? 'PRIVATE LOBBY' : 'PUBLIC LOBBY'}</small><h3>{lobby.name}</h3><p>Code <button type="button" onClick={() => void navigator.clipboard?.writeText(lobby.code)}>{lobby.code}<Copy /></button></p></div>
      <span>{lobby.players.length}/{lobby.maxPlayers}</span>
    </header>
    <div className="platform-lobby-team-grid"><TeamColumn team="blue" lobby={lobby} me={me} /><div className="platform-lobby-versus">VS</div><TeamColumn team="red" lobby={lobby} me={me} /></div>
    <footer><p>{running ? 'Match created. The shared game server will connect in the next phase.' : 'Select any open slot to change team or position.'}</p>{!running && <button type="button" className="platform-lobby-secondary" onClick={() => platformRealtime.send('lobby.leave')}><X /> Leave</button>}{owner && !running && <button type="button" className="platform-lobby-primary" onClick={() => platformRealtime.send('lobby.start')}><Swords /> Start Match</button>}</footer>
  </section>;
}

export function CustomLobbyPanel({ me, lobbies, currentLobby }: { me: PlatformUser; lobbies: readonly CustomLobby[]; currentLobby: CustomLobby | null }) {
  const [name, setName] = useState('');
  const [privateLobby, setPrivateLobby] = useState(false);
  const [joinCode, setJoinCode] = useState('');

  if (currentLobby) return <CurrentLobby lobby={currentLobby} me={me} />;

  return <div className="platform-custom-lobbies">
    <section className="platform-lobby-create">
      <div className="platform-lobby-heading"><Shield /><span><small>NEW LOBBY</small><strong>Gather both realms</strong></span></div>
      <p>Create a lobby for scrims, testing, or organized matches. Each team keeps five player slots.</p>
      <label>Lobby name<input value={name} onChange={event => setName(event.target.value)} maxLength={40} placeholder="Guild practice" /></label>
      <label className="platform-lobby-privacy"><input type="checkbox" checked={privateLobby} onChange={event => setPrivateLobby(event.target.checked)} /><Lock /><span><strong>Private by code</strong><small>It will not appear in the public browser.</small></span></label>
      <button type="button" className="platform-lobby-primary" onClick={() => platformRealtime.send('lobby.create', { name, privacy: privateLobby ? 'private' : 'public', maxPlayers: 10 })}><Plus /> Create Lobby</button>
    </section>
    <section className="platform-lobby-browser">
      <header><div><Users /><span><small>OPEN LOBBIES</small><strong>{lobbies.length} public</strong></span></div><button type="button" onClick={() => platformRealtime.send('lobby.list')}>Refresh</button></header>
      <form onSubmit={event => { event.preventDefault(); if (joinCode.trim()) platformRealtime.send('lobby.join', { code: joinCode.trim().toUpperCase() }); }}><input value={joinCode} onChange={event => setJoinCode(event.target.value.toUpperCase())} maxLength={12} placeholder="Invitation code" /><button>Join</button></form>
      <div className="platform-lobby-list">{lobbies.map(lobby => <article key={lobby.id}><span className="platform-lobby-code">{lobby.code}</span><div><strong>{lobby.name}</strong><small>{lobby.ownerUsername} · {lobby.players.length}/{lobby.maxPlayers}</small></div><button type="button" onClick={() => platformRealtime.send('lobby.join', { code: lobby.code })}>Join</button></article>)}{lobbies.length === 0 && <div className="platform-lobby-empty">No public lobbies are open.</div>}</div>
    </section>
  </div>;
}
