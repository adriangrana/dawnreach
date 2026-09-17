import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { LogIn, Search, Shield, Swords, UserPlus, Users } from 'lucide-react';
import GameApp from '../App';
import { mountGameClientRuntime } from '../game/mountGameClientRuntime';
import { MatchmakingPanel, ReadyCheckOverlay } from './MatchmakingPanel';
import { PartyBar } from './PartyBar';
import {
  getAuthToken,
  getCurrentPlatformUser,
  getDirectConversation,
  getSocialSnapshot,
  loginPlatformAccount,
  logoutPlatformAccount,
  platformRealtime,
  registerPlatformAccount,
  respondPlatformFriendRequest,
  searchPlatformUsers,
  sendPlatformDirectMessage,
  sendPlatformFriendRequest,
  type DirectMessage,
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
type HomeSection = 'play' | 'social';

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
  return <div className="platform-local-game"><GameApp />{!ready && <div className="platform-game-loading" role="status" aria-label="Cargando partida"><img src={LOADING_SPLASH} alt="" draggable={false} /><div><strong>DAWNREACH</strong><span>Preparando el campo de batalla…</span></div></div>}</div>;
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
    } catch (authError) { setMessage(authError instanceof Error ? authError.message : 'No se pudo iniciar sesión.'); }
    finally { setBusy(false); }
  };
  return <main className="platform-auth-surface">
    <section className="platform-brand-panel"><img className="platform-brand-icon" src={DAWNREACH_ICON} alt="" draggable={false} /><p className="platform-eyebrow">EL CONFLICTO DE DOS REINOS</p><h1>DAWNREACH</h1><p className="platform-brand-copy">Forma tu grupo, entra en cola y lucha por derribar el trono enemigo.</p><div className="platform-brand-rule"><span /><Shield /><span /></div></section>
    <section className="platform-auth-card" aria-label={mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}>
      <div className="platform-auth-tabs" role="tablist"><button type="button" className={mode === 'login' ? 'is-active' : ''} onClick={() => setMode('login')}><LogIn /> Iniciar sesión</button><button type="button" className={mode === 'register' ? 'is-active' : ''} onClick={() => setMode('register')}><UserPlus /> Crear cuenta</button></div>
      <form onSubmit={submit}><label>Nombre de usuario<input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} minLength={3} maxLength={24} required /></label><label>Contraseña<input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} minLength={10} required /></label>{mode === 'register' && <p className="platform-password-hint">10+ caracteres y al menos tres tipos entre mayúsculas, minúsculas, números y símbolos.</p>}{message && <p className="platform-auth-message" role="alert">{message}</p>}<button className="platform-primary-button" type="submit" disabled={busy}>{busy ? 'Conectando…' : mode === 'login' ? 'Entrar en Dawnreach' : 'Crear cuenta'}</button></form>
      <button className="platform-local-button" type="button" onClick={onLocalGame}>Partida local · desarrollo</button>
    </section>
  </main>;
}

function SocialSurface({ currentUser, snapshot, party, refresh }: { currentUser: PlatformUser; snapshot: SocialSnapshot; party: PartySnapshot; refresh: () => Promise<void> }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<readonly PlatformUser[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<readonly DirectMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState('');
  const selected = useMemo(() => snapshot.friends.find(friend => friend.id === selectedId) ?? null, [snapshot.friends, selectedId]);

  const loadConversation = async (userId: string) => {
    setSelectedId(userId);
    try { setMessages(await getDirectConversation(userId)); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo cargar la conversación.'); }
  };

  useEffect(() => platformRealtime.subscribe(event => {
    if (eventType(event) !== 'direct.message' || !('message' in event)) return;
    const incoming = event.message as DirectMessage;
    if (!selectedId || (incoming.fromUserId !== selectedId && incoming.toUserId !== selectedId)) return;
    setMessages(previous => previous.some(item => item.id === incoming.id) ? previous : [...previous, incoming]);
  }), [selectedId]);

  const search = async (event: FormEvent) => {
    event.preventDefault(); setMessage('');
    try { setResults(await searchPlatformUsers(query)); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo buscar.'); }
  };
  const requestFriend = async (userId: string) => {
    try { await sendPlatformFriendRequest(userId); setResults(results.filter(user => user.id !== userId)); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo enviar la solicitud.'); }
  };
  const respond = async (requestId: string, accept: boolean) => {
    try { await respondPlatformFriendRequest(requestId, accept); await refresh(); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo responder.'); }
  };
  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !draft.trim()) return;
    try { const sent = await sendPlatformDirectMessage(selected.id, draft); setMessages(previous => [...previous, sent]); setDraft(''); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'No se pudo enviar el mensaje.'); }
  };

  return <section className="platform-social-surface">
    <aside className="platform-social-sidebar">
      <form className="platform-user-search" onSubmit={search}><Search /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar jugador…" minLength={2} /><button>Buscar</button></form>
      {results.length > 0 && <div className="platform-search-results">{results.map(user => <div key={user.id}><span>{user.username}</span><button onClick={() => void requestFriend(user.id)}>Añadir</button></div>)}</div>}
      {party.invites.length > 0 && <div className="platform-party-invites"><h4>INVITACIONES DE GRUPO</h4>{party.invites.map(invite => <div className="platform-party-invite-row" key={invite.id}><span><strong>{invite.from?.username ?? 'Jugador'}</strong><small>Te invita a su grupo</small></span><button type="button" onClick={() => platformRealtime.send('party.accept', { inviteId: invite.id })}>Aceptar</button><button type="button" onClick={() => platformRealtime.send('party.decline', { inviteId: invite.id })}>Rechazar</button></div>)}</div>}
      {snapshot.incoming.length > 0 && <div className="platform-social-group"><h3>Solicitudes</h3>{snapshot.incoming.map(request => <div className="platform-request-row" key={request.id}><span>{request.user?.username ?? 'Jugador'}</span><div><button onClick={() => void respond(request.id, true)}>Aceptar</button><button onClick={() => void respond(request.id, false)}>×</button></div></div>)}</div>}
      <div className="platform-social-group"><h3>Amigos · {snapshot.friends.length}</h3>{snapshot.friends.length === 0 && <p>Aún no tienes amigos añadidos.</p>}{snapshot.friends.map(friend => <button className={`platform-friend-row${selectedId === friend.id ? ' is-selected' : ''}`} key={friend.id} onClick={() => void loadConversation(friend.id)}><span className={`platform-friend-dot is-${friend.status}`} /><strong>{friend.username}</strong>{friend.unread > 0 && <em>{friend.unread}</em>}</button>)}</div>
      {snapshot.outgoing.length > 0 && <div className="platform-social-group platform-social-pending"><h3>Pendientes</h3>{snapshot.outgoing.map(request => <p key={request.id}>{request.user?.username ?? 'Jugador'}</p>)}</div>}
    </aside>
    <div className="platform-chat-panel">
      {selected ? <><header><div><span className={`platform-friend-dot is-${selected.status}`} /><strong>{selected.username}</strong></div><small>{selected.status === 'online' ? 'En línea' : 'Desconectado'}</small></header><div className="platform-dm-log">{messages.length === 0 && <p className="platform-empty-chat">Todavía no hay mensajes.</p>}{messages.map(item => <div key={item.id} className={item.fromUserId === currentUser.id ? 'is-mine' : 'is-theirs'}><strong>{item.fromUserId === currentUser.id ? 'Tú' : selected.username}</strong><p>{item.text}</p><small>{new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small></div>)}</div><form className="platform-dm-compose" onSubmit={send}><input value={draft} onChange={event => setDraft(event.target.value)} maxLength={500} placeholder={`Mensaje a ${selected.username}`} /><button>Enviar</button></form></> : <div className="platform-chat-placeholder"><Users /><strong>Social de Dawnreach</strong><span>Selecciona un amigo para abrir la conversación.</span></div>}
      {message && <p className="platform-social-message" role="alert">{message}</p>}
    </div>
  </section>;
}

function HomeSurface({ user, onPlay, onLogout }: { user: PlatformUser; onPlay: () => void; onLogout: () => void }) {
  const [section, setSection] = useState<HomeSection>('play');
  const [online, setOnline] = useState<readonly PlatformUser[]>([user]);
  const [social, setSocial] = useState<SocialSnapshot>(EMPTY_SOCIAL);
  const [party, setParty] = useState<PartySnapshot>(EMPTY_PARTY);
  const [queue, setQueue] = useState<QueueState>(EMPTY_QUEUE);
  const [ready, setReady] = useState<ReadyState | null>(null);
  const [realtime, setRealtime] = useState<'connecting' | 'online' | 'offline'>('connecting');
  const [notice, setNotice] = useState('');
  const refreshSocial = async () => { setSocial(await getSocialSnapshot()); };

  useEffect(() => {
    void refreshSocial().catch(() => undefined);
    const unsubscribe = platformRealtime.subscribe(event => {
      const type = eventType(event);
      if (type === 'presence.snapshot' && 'users' in event && Array.isArray(event.users)) setOnline(event.users as readonly PlatformUser[]);
      if (type === 'social.snapshot' && 'friends' in event && 'incoming' in event && 'outgoing' in event) setSocial(event as unknown as SocialSnapshot);
      if (type === 'party.snapshot' && 'party' in event && 'invites' in event) setParty({ party: event.party as PartySnapshot['party'], invites: event.invites as PartySnapshot['invites'] });
      if (type === 'party.invite') setNotice('Tienes una nueva invitación de grupo.');
      if (type === 'queue.update' && 'mode' in event && 'count' in event && 'target' in event) {
        const mode = event.mode === 'normal' ? 'normal' : 'ranked';
        setQueue(current => ({ ...current, mode: current.joined ? current.mode : mode, count: Number(event.count || 0), target: Number(event.target || current.target) }));
      }
      if (type === 'ready.start' && 'readyId' in event && 'players' in event && 'expiresAt' in event) {
        setReady({
          readyId: String(event.readyId),
          mode: event.mode === 'normal' ? 'normal' : 'ranked',
          players: Array.isArray(event.players) ? event.players as ReadyState['players'] : [],
          expiresAt: Number(event.expiresAt),
          acceptedUserIds: [],
          declinedUserIds: [],
        });
      }
      if (type === 'ready.progress' && 'readyId' in event) {
        setReady(current => current && current.readyId === event.readyId ? {
          ...current,
          acceptedUserIds: Array.isArray(event.acceptedUserIds) ? event.acceptedUserIds as string[] : [],
          declinedUserIds: Array.isArray(event.declinedUserIds) ? event.declinedUserIds as string[] : [],
        } : current);
      }
      if (type === 'ready.cancelled') {
        const declinedUserId = 'declinedUserId' in event ? String(event.declinedUserId || '') : '';
        setReady(null);
        setQueue(current => ({ ...current, joined: !declinedUserId || declinedUserId !== user.id }));
        setNotice(declinedUserId === user.id ? 'Has rechazado el ready check y saliste de la cola.' : 'Ready check cancelado. Sigues en la cola.');
      }
      if (type === 'match.found') {
        setReady(null);
        setQueue(current => ({ ...current, joined: false }));
        setNotice('Partida confirmada. La sesión de juego se conectará sobre este match en la siguiente fase.');
      }
      if (type === 'match.session.pending') setNotice('Los 10 jugadores están confirmados. Pendiente conectar el transporte de la partida Dawnreach.');
      if (type === 'error' && 'message' in event) setNotice(String(event.message || 'No se pudo completar la acción.'));
      if (type === 'session.ready') {
        setRealtime('online');
        if ('presence' in event && Array.isArray(event.presence)) setOnline(event.presence as readonly PlatformUser[]);
        if ('social' in event && event.social) setSocial(event.social as SocialSnapshot);
        if ('party' in event && event.party) setParty(event.party as PartySnapshot);
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
  }, [user.id]);

  const chooseMode = (mode: QueueMode) => setQueue(current => current.joined ? current : { ...current, mode });
  const joinQueue = (mode: QueueMode) => {
    if (!platformRealtime.send('queue.join', { mode })) { setNotice('Sin conexión realtime.'); return; }
    setQueue(current => ({ ...current, joined: true, mode }));
    setNotice('');
  };
  const leaveQueue = () => {
    if (!platformRealtime.send('queue.leave')) { setNotice('Sin conexión realtime.'); return; }
    setQueue(current => ({ ...current, joined: false }));
  };

  return <>
    <main className="platform-home-surface">
      <header className="platform-topbar"><div className="platform-wordmark"><img src={DAWNREACH_ICON} alt="" /><strong>DAWNREACH</strong></div><nav aria-label="Navegación principal"><button className={section === 'play' ? 'is-active' : ''} onClick={() => setSection('play')}>JUGAR</button><button className={section === 'social' ? 'is-active' : ''} onClick={() => setSection('social')}>SOCIAL{social.incoming.length + party.invites.length > 0 && <em>{social.incoming.length + party.invites.length}</em>}</button><button disabled>RANKING</button><button disabled>PERFIL</button></nav><div className="platform-account"><span className={`platform-presence is-${realtime}`} /><strong>{user.username}</strong><button onClick={onLogout}>Salir</button></div></header>
      {section === 'play' ? <section className="platform-play-hero"><div className="platform-play-copy platform-play-copy--matchmaking"><p className="platform-eyebrow">PLATAFORMA DAWNREACH · ARQUITECTURA TCL</p><h2>Elige cómo entrar en batalla</h2><p>Party, matchmaking y ready check comparten ya el flujo competitivo de TCL.</p><PartyBar me={user} snapshot={party} /><MatchmakingPanel me={user} party={party} queue={queue} onMode={chooseMode} onJoin={joinQueue} onLeave={leaveQueue} /><button className="platform-local-button platform-local-play-button" type="button" onClick={onPlay}><Swords /> Partida local · desarrollo</button>{notice && <p className="platform-auth-message" role="status">{notice}</p>}</div><aside className="platform-online-card"><div><Users /><span><strong>{online.length}</strong> conectados</span></div><small>{realtime === 'online' ? 'Servidor realtime conectado' : realtime === 'connecting' ? 'Conectando realtime…' : 'Realtime desconectado'}</small><ul>{online.slice(0, 6).map(player => <li key={player.id}><span />{player.username}</li>)}</ul></aside></section> : <SocialSurface currentUser={user} snapshot={social} party={party} refresh={refreshSocial} />}
    </main>
    {ready && <ReadyCheckOverlay ready={ready} me={user} />}
  </>;
}

export default function PlatformShell() {
  const [surface, setSurface] = useState<Surface>('booting');
  const [user, setUser] = useState<PlatformUser | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { let active = true; const restore = async () => { if (!getAuthToken()) { if (active) setSurface('auth'); return; } try { const restored = await getCurrentPlatformUser(); if (!active) return; setUser(restored); setSurface('home'); } catch (restoreError) { if (!active) return; setError(restoreError instanceof Error ? restoreError.message : 'No se pudo restaurar la sesión.'); setSurface('auth'); } }; void restore(); return () => { active = false; }; }, []);
  const authenticated = (nextUser: PlatformUser) => { setUser(nextUser); setError(''); setSurface('home'); };
  const logout = async () => { platformRealtime.disconnect(); try { await logoutPlatformAccount(); } catch { /* token is cleared in client */ } setUser(null); setSurface('auth'); };
  if (surface === 'game') return <div className="platform-shell platform-shell--game" data-dawnreach-platform-ready="true"><LocalGameScreen /></div>;
  return <div className="platform-shell" data-dawnreach-platform-ready={surface === 'booting' ? 'false' : 'true'}><div className="platform-shell-backdrop" aria-hidden="true" />{surface === 'booting' && <div className="platform-bootstrap"><img src={DAWNREACH_ICON} alt="" /><strong>DAWNREACH</strong><span>Restaurando sesión…</span></div>}{surface === 'auth' && <AuthSurface error={error} onAuthenticated={authenticated} onLocalGame={() => setSurface('game')} />}{surface === 'home' && user && <HomeSurface user={user} onPlay={() => setSurface('game')} onLogout={() => void logout()} />}</div>;
}
