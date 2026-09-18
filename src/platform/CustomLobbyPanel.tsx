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
import { useEffect, useMemo, useRef, useState } from 'react';
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
      <span>{players.length}/{lobby.settings.teamSize}</span>
    </header>
    <div className="dr-custom-team-slots">
      {Array.from({ length: lobby.settings.teamSize }, (_, slot) => {
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
  const [pendingLobbyId, setPendingLobbyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return lobbies;
    return lobbies.filter(lobby =>
      lobby.name.toLowerCase().includes(needle)
      || lobby.ownerUsername.toLowerCase().includes(needle)
      || lobby.code.toLowerCase().includes(needle));
  }, [lobbies, query]);

  const pendingLobby = lobbies.find(lobby => lobby.id === pendingLobbyId) ?? null;

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

  const confirmLobbyJoin = () => {
    if (!pendingLobby) return;
    platformRealtime.send('lobby.join', { code: pendingLobby.code });
    setPendingLobbyId(null);
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
      <button type="button">Any Size <ChevronDown /></button>
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
            className={active ? 'is-active' : pendingLobbyId === lobby.id ? 'is-pending' : ''}
            onClick={() => !active && setPendingLobbyId(lobby.id)}
          >
            <span><strong>{lobby.name}</strong><small>{lobby.privacy === 'private' ? <><Lock /> PRIVATE</> : `${lobby.settings.teamSize}v${lobby.settings.teamSize}`}</small></span>
            <span>{lobby.ownerUsername}</span>
            <span>{lobby.players.length}/{lobby.maxPlayers}</span>
            <span className="dr-custom-ping"><Signal /> —</span>
          </button>;
        })}
        {filtered.length === 0 && <div className="dr-custom-browser-empty"><Shield /><strong>NO LOBBIES FOUND</strong><span>Create a new room or join one by code.</span></div>}
      </div>
    </div>

    {pendingLobby && <div className="dr-custom-join-confirm" role="dialog" aria-modal="true" aria-label="Join custom lobby">
      <div>
        <small>JOIN CUSTOM LOBBY</small>
        <strong>{pendingLobby.name}</strong>
        <span>Hosted by {pendingLobby.ownerUsername} · {pendingLobby.players.length}/{pendingLobby.maxPlayers} players</span>
        {currentLobby && currentLobby.id !== pendingLobby.id && <em>You will leave <b>{currentLobby.name}</b> to join this lobby.</em>}
        <div className="dr-custom-join-confirm-actions">
          <button type="button" onClick={() => setPendingLobbyId(null)}>CANCEL</button>
          {pendingLobby.settings.allowSpectators && pendingLobby.spectators.length < pendingLobby.maxSpectators && <button
            type="button"
            className="is-spectate"
            onClick={() => {
              platformRealtime.send('lobby.join.spectator', { code: pendingLobby.code });
              setPendingLobbyId(null);
            }}
          >SPECTATE</button>}
          <button
            type="button"
            className="is-confirm"
            disabled={pendingLobby.players.length >= pendingLobby.maxPlayers}
            onClick={confirmLobbyJoin}
          >{pendingLobby.players.length >= pendingLobby.maxPlayers ? 'LOBBY FULL' : 'JOIN LOBBY'}</button>
        </div>
      </div>
    </div>}
  </section>;
}

function SpectatorStrip({ lobby, me }: { lobby: CustomLobby; me: PlatformUser }) {
  const isSpectator = lobby.spectators.some(spectator => spectator.userId === me.id);
  const canSpectate = lobby.settings.allowSpectators
    && lobby.status === 'open'
    && lobby.ownerId !== me.id
    && !isSpectator
    && lobby.spectators.length < lobby.maxSpectators;

  return <section className="dr-custom-spectators">
    <header>
      <div><Eye /><strong>SPECTATORS</strong><span>{lobby.spectators.length}/{lobby.maxSpectators}</span></div>
      {!lobby.settings.allowSpectators && <small>DISABLED BY HOST</small>}
      {canSpectate && <button type="button" onClick={() => platformRealtime.send('lobby.spectate')}><Eye /> SPECTATE</button>}
      {isSpectator && <small className="is-watching">YOU ARE WATCHING · choose an open team slot to return</small>}
    </header>
    <div>
      {Array.from({ length: lobby.maxSpectators }, (_, index) => {
        const spectator = lobby.spectators[index];
        return spectator
          ? <article className={spectator.userId === me.id ? 'is-self' : ''} key={spectator.userId}>
              <span>{spectator.username.slice(0, 2).toUpperCase()}</span>
              <div><strong>{spectator.username}</strong><small><Eye /> WATCHING</small></div>
            </article>
          : <div className="dr-custom-spectator-open" key={index}><Plus /><span>OPEN SLOT</span></div>;
      })}
    </div>
  </section>;
}

function LobbyRoom({ lobby, me }: { lobby: CustomLobby; me: PlatformUser }) {
  const [copied, setCopied] = useState(false);
  const [channel, setChannel] = useState<'team' | 'all'>('team');
  const [messageText, setMessageText] = useState('');
  const messageViewportRef = useRef<HTMLDivElement | null>(null);
  const meInLobby = lobby.players.find(player => player.userId === me.id) ?? null;
  const meSpectating = lobby.spectators.some(spectator => spectator.userId === me.id);

  useEffect(() => {
    if (meSpectating && channel === 'team') setChannel('all');
  }, [channel, meSpectating]);

  const visibleMessages = lobby.messages.filter(message =>
    message.channel === 'system' || message.channel === channel);

  useEffect(() => {
    const viewport = messageViewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [channel, visibleMessages.length]);

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
    platformRealtime.send('lobby.message', { channel: meSpectating ? 'all' : channel, text });
    setMessageText('');
  };

  return <section className="dr-custom-room-panel">
    <header className="dr-custom-room-head">
      <div className="dr-custom-room-identity">
        <div><strong>{lobby.name}</strong>{lobby.privacy === 'private' && <Lock />}</div>
        <span>Hosted by {lobby.ownerUsername}<i />{lobby.settings.teamSize}v{lobby.settings.teamSize}<i />Dawnreach</span>
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

    <SpectatorStrip lobby={lobby} me={me} />

    <section className="dr-custom-lobby-chat">
      <header>
        <div className="dr-custom-chat-tabs">
          <button type="button" disabled={meSpectating} className={channel === 'team' ? 'is-active' : ''} onClick={() => setChannel('team')}>TEAM</button>
          <button type="button" className={channel === 'all' ? 'is-active' : ''} onClick={() => setChannel('all')}>ALL</button>
        </div>
        <div className="dr-custom-chat-ready">
          <span>{lobby.players.filter(player => player.ready).length}/{lobby.players.length} READY</span>
          {!meSpectating && <button
            type="button"
            className={meInLobby?.ready ? 'is-ready' : ''}
            disabled={!meInLobby || lobby.status !== 'open'}
            onClick={() => platformRealtime.send('lobby.ready', { ready: !meInLobby?.ready })}
          >
            <CheckCircle2 />
            {meInLobby?.ready ? 'READY' : 'MARK READY'}
          </button>}
          {meSpectating && <small>ALL CHAT ONLY</small>}
        </div>
      </header>

      <div className="dr-custom-chat-messages" ref={messageViewportRef}>
        {visibleMessages.map(message => <p className={`is-${message.channel}`} key={message.id}>
          <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
          {message.channel === 'system'
            ? <span>{message.text}</span>
            : <><strong>{message.username}</strong><em>{message.channel === 'team' ? '[TEAM]' : '[ALL]'}</em><span>{message.text}</span></>}
        </p>)}
        {visibleMessages.length === 0 && <div className="dr-custom-chat-empty">No messages in this channel yet.</div>}
      </div>

      <form onSubmit={event => { event.preventDefault(); submitMessage(); }}>
        <span>{meSpectating ? 'ALL' : channel.toUpperCase()}</span>
        <input
          value={messageText}
          maxLength={300}
          onChange={event => setMessageText(event.target.value)}
          placeholder={meSpectating || channel === 'all' ? 'Message everyone...' : 'Message your team...'}
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
    <p>Choose a public room, enter an invitation code, or create your own battle.</p>
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
  const settingsDisabled = !lobby || !owner || running;

  const updateSetting = (settings: Record<string, string | number | boolean>) => {
    if (settingsDisabled) return;
    platformRealtime.send('lobby.settings', { settings });
  };

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
          <small className="dr-custom-setting-lock">ONLY MAP</small>
        </div>
      </section>

      <section className="dr-custom-settings-group">
        <label>Game Mode</label>
        <div className="dr-custom-setting-static"><span>Classic</span><small>Current ruleset</small></div>
      </section>

      <section className="dr-custom-settings-group">
        <label htmlFor="custom-team-size">Team Size</label>
        <select
          id="custom-team-size"
          className="dr-custom-setting-select"
          value={lobby?.settings.teamSize ?? 5}
          disabled={settingsDisabled}
          onChange={event => updateSetting({ teamSize: Number(event.target.value) })}
        >
          {[1, 2, 3, 4, 5].map(size => <option value={size} key={size}>{size} vs {size}</option>)}
        </select>
      </section>

      <div className="dr-custom-settings-divider"><span>GAME RULES</span></div>

      <section className="dr-custom-settings-group">
        <label htmlFor="custom-hero-select">Hero Select</label>
        <select
          id="custom-hero-select"
          className="dr-custom-setting-select"
          value={lobby?.settings.heroSelect ?? 'all_pick'}
          disabled={settingsDisabled}
          onChange={event => updateSetting({ heroSelect: event.target.value })}
        >
          <option value="all_pick">All Pick</option>
          <option value="draft">Draft Pick</option>
        </select>
      </section>

      <section className="dr-custom-settings-group">
        <label htmlFor="custom-bans">Bans</label>
        <select
          id="custom-bans"
          className="dr-custom-setting-select"
          value={lobby?.settings.bans ?? 'none'}
          disabled={settingsDisabled}
          onChange={event => updateSetting({ bans: event.target.value })}
        >
          <option value="none">None</option>
          <option value="2">2 per team</option>
          <option value="4">4 per team</option>
        </select>
      </section>

      <section className="dr-custom-settings-toggle">
        <span><Eye /><span><strong>Allow Spectators</strong><small>{lobby?.spectators.length ?? 0}/{lobby?.maxSpectators ?? 4} watching</small></span></span>
        <button
          type="button"
          className={lobby?.settings.allowSpectators ? 'is-on' : ''}
          disabled={settingsDisabled}
          aria-pressed={Boolean(lobby?.settings.allowSpectators)}
          onClick={() => updateSetting({ allowSpectators: !lobby?.settings.allowSpectators })}
        ><i /></button>
      </section>

      <section className="dr-custom-settings-line is-disabled">
        <span><Users />Bots</span><strong>Coming later</strong>
      </section>

      <section className="dr-custom-settings-toggle">
        <span>{lobby?.settings.privacy === 'private' ? <Lock /> : <Globe2 />}<span><strong>Private Lobby</strong><small>Hide from public browser</small></span></span>
        <button
          type="button"
          className={lobby?.settings.privacy === 'private' ? 'is-on' : ''}
          disabled={settingsDisabled}
          aria-pressed={lobby?.settings.privacy === 'private'}
          onClick={() => updateSetting({ privacy: lobby?.settings.privacy === 'private' ? 'public' : 'private' })}
        ><i /></button>
      </section>

      <section className="dr-custom-settings-group">
        <label htmlFor="custom-region">Server Region</label>
        <select
          id="custom-region"
          className="dr-custom-setting-select"
          value={lobby?.settings.region ?? 'auto'}
          disabled={settingsDisabled}
          onChange={event => updateSetting({ region: event.target.value })}
        >
          <option value="auto">Automatic</option>
          <option value="eu">Europe</option>
          <option value="na">North America</option>
          <option value="sa">South America</option>
        </select>
      </section>

      <div className="dr-custom-settings-divider"><span>READY RULE</span></div>
      <p className="dr-custom-settings-note">Changing team size, hero select or bans resets every player to Not Ready. Spectators never block match start.</p>
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
