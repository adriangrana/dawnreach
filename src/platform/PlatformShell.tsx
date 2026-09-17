import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { LogIn, Shield, Swords, UserPlus } from 'lucide-react';
import GameApp from '../App';
import { mountGameClientRuntime } from '../game/mountGameClientRuntime';
import { CustomLobbyPanel } from './CustomLobbyPanel';
import { DawnreachHomeOverview, DawnreachHomeRightRail, DawnreachHomeTopbar } from './DawnreachHome';
import { MatchmakingPanel, ReadyCheckOverlay } from './MatchmakingPanel';
import { PartyBar } from './PartyBar';
import {
  getAuthToken,
  getCurrentPlatformUser,
  getSocialSnapshot,
  loginPlatformAccount,
  logoutPlatformAccount,
  platformRealtime,
  registerPlatformAccount,
  type CustomLobby,
  type PartySnapshot,
  type PlatformRealtimeEvent,
  type PlatformUser,
  type QueueMode,
  type QueueState,
  type ReadyState,
  type SocialSnapshot,
} from './index';

const LOADING_SPLASH = '/assets/images/dawnreach_loading_splash.webp';
const DAWNREACH_ICON = '/assets/icon/dawnreach.png';
const EMPTY_SOCIAL: SocialSnapshot = { friends: [], incoming: [], outgoing: [] };
const EMPTY_PARTY: PartySnapshot = { party: null, invites: [] };
const EMPTY_QUEUE: QueueState = { joined: false, mode: 'ranked', count: 0, target: 10 };

type Surface = 'booting' | 'auth' | 'home' | 'game';
type AuthMode = 'login' | 'register';
type HomeSection = 'home' | 'play';
type PlaySection = 'matchmaking' | 'custom';

function eventType(event: PlatformRealtimeEvent) {
  return typeof event === 'object' && event !== null && 'type' in event ? String(event.type || '') : '';
}

function LocalGameScreen() {
  const [ready, setReady] = useState(false);
  useEffect(() => mountGameClientRuntime(), []);
  useEffect(() => {
    let disposed = false;
    const startedAt = performance.now();
    const inspect = () => {
      if (disposed) return;
      const canvas = document.querySelector<HTMLCanvasElement>('.game-canvas');
      const minimap = document.querySelector<HTMLCanvasElement>('.minimap-canvas');
      const hud = document.querySelector<HTMLElement>('.game-hud');
      const loaded = Boolean(canvas?.dataset.dawnreachReady === 'true' && minimap && hud && canvas.width > 0 && minimap.width > 0);
      if (loaded || performance.now() - startedAt > 12_000) { setReady(true); return; }
      requestAnimationFrame(inspect);
    };
    requestAnimationFrame(inspect);
    return () => { disposed = true; };
  }, []);
  return <div className="platform-local-game"><GameApp />{!ready && <div className="platform-game-loading" role="status" aria-label="Loading match"><img src={LOADING_SPLASH} alt="" draggable={false} /><div><strong>DAWNREACH</strong><span>Preparing the battlefield…</span></div></div>}</div>;
}

function AuthSurface({ error, onAuthenticated, onLocalGame }: { error: string; onAuthenticated: (user: PlatformUser) => void; onLocalGame: () => void }) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(error);
  useEffect(() => setMessage(error), [error]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      const user = mode === 'register' ? await registerPlatformAccount(username, password) : await loginPlatformAccount(username, password);
      onAuthenticated(user);
    } catch (authError) { setMessage(authError instanceof Error ? authError.message : 'Could not sign in.'); }
    finally { setBusy(false); }
  };
  return <main className="platform-auth-surface">
    <section className="platform-brand-panel"><img className="platform-brand-icon" src={DAWNREACH_ICON} alt="" draggable={false} /><p className="platform-eyebrow">THE CONFLICT OF TWO REALMS</p><h1>DAWNREACH</h1><p className="platform-brand-copy">Form your party, queue up, and fight to bring down the enemy throne.</p><div className="platform-brand-rule"><span /><Shield /><span /></div></section>
    <section className="platform-auth-card" aria-label={mode === 'login' ? 'Sign in' : 'Create account'}>
      <div className="platform-auth-tabs" role="tablist"><button type="button" className={mode === 'login' ? 'is-active' : ''} onClick={() => setMode('login')}><LogIn /> Sign in</button><button type="button" className={mode === 'register' ? 'is-active' : ''} onClick={() => setMode('register')}><UserPlus /> Create account</button></div>
      <form onSubmit={submit}><label>Username<input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} minLength={3} maxLength={24} required /></label><label>Password<input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} minLength={10} required /></label>{mode === 'register' && <p className="platform-password-hint">10+ characters and at least three types among uppercase letters, lowercase letters, numbers, and symbols.</p>}{message && <p className="platform-auth-message" role="alert">{message}</p>}<button className="platform-primary-button" type="submit" disabled={busy}>{busy ? 'Connecting…' : mode === 'login' ? 'Enter Dawnreach' : 'Create account'}</button></form>
      <button className="platform-local-button" type="button" onClick={onLocalGame}>Local match · development</button>
    </section>
  </main>;
}

function HomeSurface({ user, onLocalPlay, onLogout }: { user: PlatformUser; onLocalPlay: () => void; onLogout: () => void }) {
  const [section, setSection] = useState<HomeSection>('home');
  const [playSection, setPlaySection] = useState<PlaySection>('matchmaking');
  const [online, setOnline] = useState<readonly PlatformUser[]>([user]);
  const [social, setSocial] = useState<SocialSnapshot>(EMPTY_SOCIAL);
  const [party, setParty] = useState<PartySnapshot>(EMPTY_PARTY);
  const [queue, setQueue] = useState<QueueState>(EMPTY_QUEUE);
  const [ready, setReady] = useState<ReadyState | null>(null);
  const [lobbies, setLobbies] = useState<readonly CustomLobby[]>([]);
  const [currentLobby, setCurrentLobby] = useState<CustomLobby | null>(null);
  const [realtime, setRealtime] = useState<'connecting' | 'online' | 'offline'>('connecting');
  const [notice, setNotice] = useState('');
  const [chatFriendId, setChatFriendId] = useState<string | null>(null);
  const refreshSocial = useCallback(async () => { setSocial(await getSocialSnapshot()); }, []);

  useEffect(() => {
    if (chatFriendId && !social.friends.some(friend => friend.id === chatFriendId)) setChatFriendId(null);
  }, [chatFriendId, social.friends]);

  useEffect(() => {
    void refreshSocial().catch(() => undefined);
    const unsubscribe = platformRealtime.subscribe(event => {
      const type = eventType(event);
      if (type === 'presence.snapshot' && 'users' in event && Array.isArray(event.users)) setOnline(event.users as readonly PlatformUser[]);
      if (type === 'social.snapshot' && 'friends' in event && 'incoming' in event && 'outgoing' in event) setSocial(event as unknown as SocialSnapshot);
      if (type === 'party.snapshot' && 'party' in event && 'invites' in event) setParty({ party: event.party as PartySnapshot['party'], invites: event.invites as PartySnapshot['invites'] });
      if (type === 'party.invite') setNotice('You have a new party invite.');
      if (type === 'lobbies.update' && 'lobbies' in event && Array.isArray(event.lobbies)) setLobbies(event.lobbies as readonly CustomLobby[]);
      if (type === 'lobby.update' && 'lobby' in event && event.lobby) { setCurrentLobby(event.lobby as CustomLobby); setPlaySection('custom'); setSection('play'); }
      if (type === 'lobby.left' || type === 'lobby.closed') setCurrentLobby(null);
      if (type === 'queue.update' && 'mode' in event && 'count' in event && 'target' in event) {
        const mode = event.mode === 'normal' ? 'normal' : 'ranked';
        setQueue(current => ({ ...current, mode: current.joined ? current.mode : mode, count: Number(event.count || 0), target: Number(event.target || current.target) }));
      }
      if (type === 'ready.start' && 'readyId' in event && 'players' in event && 'expiresAt' in event) {
        setReady({ readyId: String(event.readyId), mode: event.mode === 'normal' ? 'normal' : 'ranked', players: Array.isArray(event.players) ? event.players as ReadyState['players'] : [], expiresAt: Number(event.expiresAt), acceptedUserIds: [], declinedUserIds: [] });
      }
      if (type === 'ready.progress' && 'readyId' in event && 'acceptedUserIds' in event && 'declinedUserIds' in event) {
        const acceptedUserIds = Array.isArray(event.acceptedUserIds) ? event.acceptedUserIds as string[] : [];
        const declinedUserIds = Array.isArray(event.declinedUserIds) ? event.declinedUserIds as string[] : [];
        setReady(current => current && current.readyId === event.readyId ? { ...current, acceptedUserIds, declinedUserIds } : current);
      }
      if (type === 'ready.cancelled') {
        const declinedUserId = 'declinedUserId' in event ? String(event.declinedUserId || '') : '';
        setReady(null);
        setQueue(current => ({ ...current, joined: !declinedUserId || declinedUserId !== user.id }));
        setNotice(declinedUserId === user.id ? 'You declined the Ready Check and left the queue.' : 'Ready Check cancelled. You are still in queue.');
      }
      if (type === 'match.found') {
        setReady(null);
        setQueue(current => ({ ...current, joined: false }));
        setNotice('Match confirmed. The platform is preserving its players and teams.');
      }
      if (type === 'match.session.pending') setNotice('Match created. Waiting to connect the shared Dawnreach game server.');
      if (type === 'error' && 'message' in event) setNotice(String(event.message || 'Could not complete the action.'));
      if (type === 'session.ready') {
        setRealtime('online');
        if ('presence' in event && Array.isArray(event.presence)) setOnline(event.presence as readonly PlatformUser[]);
        if ('social' in event && event.social) setSocial(event.social as SocialSnapshot);
        if ('party' in event && event.party) setParty(event.party as PartySnapshot);
        if ('lobbies' in event && Array.isArray(event.lobbies)) setLobbies(event.lobbies as readonly CustomLobby[]);
        if ('lobby' in event) setCurrentLobby((event.lobby as CustomLobby | null) ?? null);
        if ('queue' in event && event.queue && typeof event.queue === 'object') {
          const snapshot = event.queue as { joined?: boolean; target?: number };
          setQueue(current => ({ ...current, joined: Boolean(snapshot.joined), target: Number(snapshot.target || current.target) }));
        }
      }
    });
    let socket: WebSocket | null = null;
    try { socket = platformRealtime.connect(); socket.addEventListener('open', () => setRealtime('online')); socket.addEventListener('close', () => setRealtime('offline')); socket.addEventListener('error', () => setRealtime('offline')); }
    catch { setRealtime('offline'); }
    return () => { unsubscribe(); platformRealtime.disconnect(); };
  }, [refreshSocial, user.id]);

  const chooseMode = (mode: QueueMode) => setQueue(current => current.joined ? current : { ...current, mode });
  const joinQueue = (mode: QueueMode) => {
    if (!platformRealtime.send('queue.join', { mode })) { setNotice('Realtime connection unavailable.'); return; }
    setQueue(current => ({ ...current, joined: true, mode }));
    setNotice('');
  };
  const leaveQueue = () => {
    if (!platformRealtime.send('queue.leave')) { setNotice('Realtime connection unavailable.'); return; }
    setQueue(current => ({ ...current, joined: false }));
  };
  const openPlay = () => { setSection('play'); setPlaySection('matchmaking'); };
  const openNormal = () => { chooseMode('normal'); setSection('play'); setPlaySection('matchmaking'); };
  const openRanked = () => { chooseMode('ranked'); setSection('play'); setPlaySection('matchmaking'); };
  const openCustom = () => { setSection('play'); setPlaySection('custom'); platformRealtime.send('lobby.list'); };

  return <>
    <main className="platform-home-surface platform-home-shell">
      <DawnreachHomeTopbar section={section} user={user} realtime={realtime} onHome={() => setSection('home')} onPlay={openPlay} onLogout={onLogout} />
      <div className="platform-home-grid">
        <section className="platform-main-workspace">
          {section === 'home' ? <DawnreachHomeOverview user={user} party={party} online={online} social={social} selectedChatFriendId={chatFriendId} refreshSocial={refreshSocial} onPlay={openPlay} onLocalPlay={onLocalPlay} onNormal={openNormal} onRanked={openRanked} onCustom={openCustom} /> : <section className="platform-play-workspace">
            <header className="platform-play-heading"><div><p className="platform-eyebrow">PLAY</p><h1>Prepare for your next battle</h1><p>Matchmaking and custom lobbies share the same session, party, and presence.</p></div><div className="platform-play-tabs"><button className={playSection === 'matchmaking' ? 'is-active' : ''} onClick={() => setPlaySection('matchmaking')}>Matchmaking</button><button className={playSection === 'custom' ? 'is-active' : ''} onClick={openCustom}>Custom</button></div></header>
            <PartyBar me={user} snapshot={party} />
            {playSection === 'matchmaking' ? <MatchmakingPanel me={user} party={party} queue={queue} onMode={chooseMode} onJoin={joinQueue} onLeave={leaveQueue} /> : <CustomLobbyPanel me={user} lobbies={lobbies} currentLobby={currentLobby} />}
            <div className="platform-dev-entry"><span>DEVELOPMENT</span><p>The local map remains available for gameplay testing without an online session.</p><button className="platform-local-button" type="button" onClick={onLocalPlay}><Swords /> Enter Local Match</button></div>
            {notice && <p className="platform-workspace-notice" role="status">{notice}</p>}
          </section>}
        </section>
        <DawnreachHomeRightRail me={user} online={online} snapshot={social} party={party} refresh={refreshSocial} activeConversationId={section === 'home' ? chatFriendId : null} onOpenConversation={section === 'home' ? setChatFriendId : undefined} />
      </div>
    </main>
    {ready && <ReadyCheckOverlay ready={ready} me={user} />}
  </>;
}

export default function PlatformShell() {
  const [surface, setSurface] = useState<Surface>('booting');
  const [user, setUser] = useState<PlatformUser | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { let active = true; const restore = async () => { if (!getAuthToken()) { if (active) setSurface('auth'); return; } try { const restored = await getCurrentPlatformUser(); if (!active) return; setUser(restored); setSurface('home'); } catch (restoreError) { if (!active) return; setError(restoreError instanceof Error ? restoreError.message : 'Could not restore the session.'); setSurface('auth'); } }; void restore(); return () => { active = false; }; }, []);
  const authenticated = (nextUser: PlatformUser) => { setUser(nextUser); setError(''); setSurface('home'); };
  const logout = async () => { platformRealtime.disconnect(); try { await logoutPlatformAccount(); } catch { /* token is cleared in client */ } setUser(null); setSurface('auth'); };
  if (surface === 'game') return <div className="platform-shell platform-shell--game" data-dawnreach-platform-ready="true"><LocalGameScreen /></div>;
  return <div className="platform-shell" data-dawnreach-platform-ready={surface === 'booting' ? 'false' : 'true'}><div className="platform-shell-backdrop" aria-hidden="true" />{surface === 'booting' && <div className="platform-bootstrap"><img src={DAWNREACH_ICON} alt="" /><strong>DAWNREACH</strong><span>Restoring session…</span></div>}{surface === 'auth' && <AuthSurface error={error} onAuthenticated={authenticated} onLocalGame={() => setSurface('game')} />}{surface === 'home' && user && <HomeSurface user={user} onLocalPlay={() => setSurface('game')} onLogout={() => void logout()} />}</div>;
}
