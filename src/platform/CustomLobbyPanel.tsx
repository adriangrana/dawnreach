import {
  CheckCircle2,
  ChevronDown,
  Copy,
  Crown,
  Eye,
  Globe2,
  Link2,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Shield,
  Signal,
  Swords,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { DawnreachPlayModeRail, type PlayMode } from './DawnreachPlay';
import { platformRealtime } from './realtimeClient';
import type { CustomLobby, LobbyPlayer, PlatformUser, Team } from './types';

const MAP_ART = '/assets/images/dawnreach_normal_background.webp';

function playerStatus(player: LobbyPlayer) {
  return player.ready ? 'READY' : 'NOT READY';
}

function TeamColumn({ team, lobby, me }: { team: Team; lobby: CustomLobby; me: PlatformUser }) {
  const title = team === 'blue' ? 'DAWN TEAM' : 'DUSK TEAM';
  const tone = team === 'blue' ? 'is-dawn' : 'is-dusk';
  const players = lobby.players.filter(player => player.team === team);
  const open = lobby.status === 'open';

  return <section className={`dr-custom-team ${tone}`}>
    <header>
      <strong>{title}</strong>
      <span>{players.length}/5</span>
    </header>
    <div className="dr-custom-team-slots">
      {Array.from({ length: 5 }, (_, slot) => {
        const player = players.find(candidate => candidate.slot === slot);
        if (player) {
          const isSelf = player.userId === me.id;
          const isHost = player.userId === lobby.ownerId;
          return <article className={`dr-custom-player${isSelf ? ' is-self' : ''}${player.ready ? ' is-ready' : ' is-not-ready'}`} key={player.userId}>
            <span className="dr-custom-player-mark">{isHost ? <Crown /> : <span>{player.username.slice(0, 2).toUpperCase()}</span>}</span>
            <div>
              <strong>{player.username}</strong>
              <small><i /> {playerStatus(player)}{isHost ? ' · HOST' : ''}{isSelf ? ' · YOU' : ''}</small>
            </div>
            <em>{player.rating > 0 ? player.rating : '—'}</em>
          </article>;
        }

        return <button
          type="button"
          className="dr-custom-open-slot"
          disabled={!open}
          key={`${team}-${slot}`}
          onClick={() => platformRealtime.send('lobby.move', { team, slot })}
        >
          <Plus />
          <span>{open ? 'MOVE HERE' : 'OPEN SLOT'}</span>
        </button>;
      })}
    </div>
  </section>;
}

function LobbyBrowser({
  lobbies,
  currentLobby,
}: {
  lobbies: readonly CustomLobby[];
  currentLobby: CustomLobby | null;
}) {
  const [query, setQuery] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [showJoin, setShowJoin] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [privateLobby, setPrivateLobby] = useState(false);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return lobbies;
    return lobbies.filter(lobby =>
      lobby.name.toLowerCase().includes(needle)
      || lobby.ownerUsername.toLowerCase().includes(needle)
      || lobby.code.toLowerCase().includes(needle));
  }, [lobbies, query]);

  const createLobby = () => {
    platformRealtime.send('lobby.create', {
      name: name.trim(),
      privacy: privateLobby ? 'private' : 'public',
      maxPlayers: 10,
    });
    setShowCreate(false);
  };

  const joinLobby = () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    platformRealtime.send('lobby.join', { code });
  };

  return <section className="dr-custom-browser-panel">
    <header className="dr-custom-panel-title">
      <div><strong>CUSTOM LOBBIES</strong><small>{lobbies.length} PUBLIC</small></div>
      <button type="button" aria-label="Refresh lobbies" onClick={() => platformRealtime.send('lobby.list')}><RefreshCw /></button>
    </header>

    <div className="dr-custom-browser-actions">
      <button type="button" className="is-primary" onClick={() => { setShowCreate(value => !value); setShowJoin(false); }}><Plus /><span>CREATE LOBBY</span></button>
      <button type="button" onClick={() => { setShowJoin(value => !value); setShowCreate(false); }}><Link2 /><span>JOIN BY CODE</span></button>
    </div>

    {showCreate && <div className="dr-custom-create-drawer">
      <label><span>LOBBY NAME</span><input value={name} onChange={event => setName(event.target.value)} maxLength={40} placeholder="Dawnreach Legends" /></label>
      <button type="button" className={`dr-custom-privacy-toggle${privateLobby ? ' is-active' : ''}`} onClick={() => setPrivateLobby(value => !value)}>
        <Lock /><span><strong>{privateLobby ? 'PRIVATE' : 'PUBLIC'}</strong><small>{privateLobby ? 'Join by code only' : 'Visible in browser'}</small></span>
      </button>
      <button type="button" className="dr-custom-drawer-confirm" onClick={createLobby}>CREATE</button>
    </div>}

    {showJoin && <form className="dr-custom-join-drawer" onSubmit={event => { event.preventDefault(); joinLobby(); }}>
      <Link2 />
      <input value={joinCode} onChange={event => setJoinCode(event.target.value.toUpperCase())} maxLength={12} placeholder="ENTER LOBBY CODE" autoFocus />
      <button type="submit">JOIN</button>
    </form>}

    <label className="dr-custom-search">
      <Search />
      <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search lobbies..." />
    </label>

    <div className="dr-custom-filters">
      <button type="button">Dawnreach <ChevronDown /></button>
      <button type="button">5v5 <ChevronDown /></button>
      <button type="button">All Regions <ChevronDown /></button>
    </div>

    <div className="dr-custom-lobby-table">
      <div className="dr-custom-lobby-table-head"><span>LOBBY</span><span>HOST</span><span>PLAYERS</span><span>PING</span></div>
      <div className="dr-custom-lobby-rows">
        {filtered.map(lobby => {
          const active = currentLobby?.id === lobby.id;
          return <button
            type="button"
            key={lobby.id}
            className={active ? 'is-active' : ''}
            onClick={() => !active && platformRealtime.send('lobby.join', { code: lobby.code })}
          >
            <span><strong>{lobby.name}</strong><small>{lobby.privacy === 'private' ? <><Lock /> PRIVATE</> : 'PUBLIC'}</small></span>
            <span>{lobby.ownerUsername}</span>
            <span>{lobby.players.length}/{lobby.maxPlayers}</span>
            <span className="dr-custom-ping"><Signal /> —</span>
          </button>;
        })}
        {filtered.length === 0 && <div className="dr-custom-browser-empty"><Shield /><strong>NO LOBBIES FOUND</strong><span>Create a new room or join one by code.</span></div>}
      </div>
    </div>
  </section>;
}

function LobbyRoom({ lobby, me }: { lobby: CustomLobby; me: PlatformUser }) {
  const [copied, setCopied] = useState(false);
  const [channel, setChannel] = useState<'team' | 'all'>('team');
  const [messageText, setMessageText] = useState('');
  const meInLobby = lobby.players.find(player => player.userId === me.id) ?? null;
  const visibleMessages = lobby.messages.filter(message =>
    message.channel === 'system' || message.channel === channel);

  const copyCode = async () => {
    try {
      await navigator.clipboard?.writeText(lobby.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  const submitMessage = () => {
    const text = messageText.trim();
    if (!text) return;
    platformRealtime.send('lobby.message', { channel, text });
    setMessageText('');
  };

  return <section className="dr-custom-room-panel">
    <header className="dr-custom-room-head">
      <div className="dr-custom-room-identity">
        <div><strong>{lobby.name}</strong>{lobby.privacy === 'private' && <Lock />}</div>
        <span>Hosted by {lobby.ownerUsername}<i />5v5<i />Dawnreach</span>
      </div>
      <div className="dr-custom-room-tools">
        <button type="button" className="dr-custom-code" onClick={copyCode}><span>#{lobby.code}</span><Copy /></button>
        <button type="button" className="dr-custom-invite" onClick={copyCode}><UserPlus /><span>{copied ? 'CODE COPIED' : 'INVITE FRIENDS'}</span></button>
      </div>
    </header>

    <div className="dr-custom-team-grid">
      <TeamColumn team="blue" lobby={lobby} me={me} />
      <TeamColumn team="red" lobby={lobby} me={me} />
    </div>

    <section className="dr-custom-lobby-chat">
      <header>
        <div className="dr-custom-chat-tabs">
          <button type="button" className={channel === 'team' ? 'is-active' : ''} onClick={() => setChannel('team')}>TEAM</button>
          <button type="button" className={channel === 'all' ? 'is-active' : ''} onClick={() => setChannel('all')}>ALL</button>
        </div>
        <div className="dr-custom-chat-ready">
          <span>{lobby.players.filter(player => player.ready).length}/{lobby.players.length} READY</span>
          <button
            type="button"
            className={meInLobby?.ready ? 'is-ready' : ''}
            disabled={!meInLobby || lobby.status !== 'open'}
            onClick={() => platformRealtime.send('lobby.ready', { ready: !meInLobby?.ready })}
          >
            <CheckCircle2 />
            {meInLobby?.ready ? 'READY' : 'MARK READY'}
          </button>
        </div>
      </header>

      <div className="dr-custom-chat-messages">
        {visibleMessages.map(message => <p className={`is-${message.channel}`} key={message.id}>
          <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
          {message.channel === 'system'
            ? <span>{message.text}</span>
            : <><strong>{message.username}</strong><em>{message.channel === 'team' ? '[TEAM]' : '[ALL]'}</em><span>{message.text}</span></>}
        </p>)}
        {visibleMessages.length === 0 && <div className="dr-custom-chat-empty">No messages in this channel yet.</div>}
      </div>

      <form onSubmit={event => { event.preventDefault(); submitMessage(); }}>
        <span>{channel === 'team' ? 'TEAM' : 'ALL'}</span>
        <input
          value={messageText}
          maxLength={300}
          onChange={event => setMessageText(event.target.value)}
          placeholder={channel === 'team' ? 'Message your team...' : 'Message everyone...'}
          disabled={lobby.status !== 'open'}
        />
        <button type="submit" aria-label="Send lobby message" disabled={!messageText.trim() || lobby.status !== 'open'}><Send /></button>
      </form>
    </section>
  </section>;
}

function EmptyLobbyRoom() {
  return <section className="dr-custom-room-panel is-empty">
    <div className="dr-custom-empty-room-mark"><Swords /></div>
    <small>CUSTOM BATTLE</small>
    <h2>CREATE OR JOIN A LOBBY</h2>
    <p>Choose a public room, enter an invitation code, or create your own 5v5 battle.</p>
  </section>;
}

function LobbySettings({ lobby, me }: { lobby: CustomLobby | null; me: PlatformUser }) {
  const owner = Boolean(lobby && lobby.ownerId === me.id);
  const running = Boolean(lobby && lobby.status !== 'open');
  const blueCount = lobby?.players.filter(player => player.team === 'blue').length ?? 0;
  const redCount = lobby?.players.filter(player => player.team === 'red').length ?? 0;
  const readyCount = lobby?.players.filter(player => player.ready).length ?? 0;
  const allReady = Boolean(lobby && lobby.players.length >= 2 && lobby.players.every(player => player.ready));
  const teamsValid = blueCount > 0 && redCount > 0;
  const canStart = Boolean(lobby && owner && !running && allReady && teamsValid);

  const startLabel = running
    ? 'MATCH STARTING'
    : !lobby
      ? 'START GAME'
      : !owner
        ? 'WAITING FOR HOST'
        : !teamsValid
          ? 'BALANCE TEAMS'
          : !allReady
            ? 'WAITING FOR READY'
            : 'START GAME';

  return <aside className="dr-custom-settings-panel">
    <header className="dr-custom-panel-title"><div><strong>LOBBY SETTINGS</strong><small>{owner ? 'HOST CONTROLS' : 'MATCH RULES'}</small></div><Settings /></header>

    <div className="dr-custom-settings-scroll">
      <section className="dr-custom-settings-group">
        <label>Map</label>
        <div className="dr-custom-map-setting">
          <img src={MAP_ART} alt="" draggable={false} />
          <span><strong>Dawnreach</strong><small>The Eternal Battlefield</small></span>
          <ChevronDown />
        </div>
      </section>

      <section className="dr-custom-settings-group">
        <label>Game Mode</label>
        <div className="dr-custom-setting-value"><span>5v5 Classic</span><ChevronDown /></div>
      </section>

      <section className="dr-custom-settings-group">
        <label>Team Size</label>
        <div className="dr-custom-setting-value"><span>5 vs 5</span><ChevronDown /></div>
      </section>

      <div className="dr-custom-settings-divider"><span>GAME RULES</span></div>

      <section className="dr-custom-settings-group">
        <label>Hero Select</label>
        <div className="dr-custom-setting-value"><span>All Pick</span><ChevronDown /></div>
      </section>

      <section className="dr-custom-settings-group">
        <label>Bans</label>
        <div className="dr-custom-setting-value"><span>None</span><ChevronDown /></div>
      </section>

      <section className="dr-custom-settings-line">
        <span><Eye />Spectators</span><strong>Not enabled</strong>
      </section>

      <section className="dr-custom-settings-line">
        <span><Users />Bots</span><strong>Not enabled</strong>
      </section>

      <section className="dr-custom-settings-line">
        <span>{lobby?.privacy === 'private' ? <Lock /> : <Globe2 />}Access</span>
        <strong>{lobby ? (lobby.privacy === 'private' ? 'Private' : 'Public') : '—'}</strong>
      </section>

      <section className="dr-custom-settings-line">
        <span><Globe2 />Server Region</span><strong>Automatic</strong>
      </section>

      <div className="dr-custom-settings-divider"><span>ADVANCED SETTINGS</span></div>
      <p className="dr-custom-settings-note">Custom rules are currently locked to Dawnreach Classic while the lobby backend is expanded.</p>
    </div>

    <footer className="dr-custom-settings-footer">
      {lobby && <button type="button" className="dr-custom-leave" disabled={running} onClick={() => platformRealtime.send('lobby.leave')}><X /> LEAVE LOBBY</button>}
      <button
        type="button"
        className={`dr-custom-start${canStart ? ' is-ready' : ''}`}
        disabled={!canStart}
        onClick={() => platformRealtime.send('lobby.start')}
      >
        <Swords /> {startLabel}
      </button>
      <small>{!lobby
        ? 'Create or join a lobby first.'
        : !teamsValid
          ? 'At least one player is required on Dawn and Dusk.'
          : `${readyCount}/${lobby.players.length} players ready`}</small>
    </footer>
  </aside>;
}

export function CustomLobbyPanel({
  me,
  lobbies,
  currentLobby,
  onSelectMode,
}: {
  me: PlatformUser;
  lobbies: readonly CustomLobby[];
  currentLobby: CustomLobby | null;
  onSelectMode: (mode: PlayMode) => void;
}) {
  return <section className="dr-custom-screen">
    <DawnreachPlayModeRail selectedMode="custom" onSelect={onSelectMode} />
    <div className="dr-custom-stage">
      <LobbyBrowser lobbies={lobbies} currentLobby={currentLobby} />
      {currentLobby ? <LobbyRoom lobby={currentLobby} me={me} /> : <EmptyLobbyRoom />}
      <LobbySettings lobby={currentLobby} me={me} />
    </div>
  </section>;
}
