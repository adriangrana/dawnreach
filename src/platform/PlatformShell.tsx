import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { LogIn, Shield, Swords, UserPlus, X } from 'lucide-react';
import GameApp from '../App';
import { mountGameClientRuntime } from '../game/mountGameClientRuntime';
import { CustomLobbyPanel } from './CustomLobbyPanel';
import { HeroSelectScreen } from './HeroSelectScreen';
import { MatchLoadingScreen } from './MatchLoadingScreen';
import { PostMatchScreen } from './PostMatchScreen';
import { DawnreachHeroes } from './DawnreachHeroes';
import { DawnreachRanking } from './DawnreachRanking';
import { DawnreachProfile } from './DawnreachProfile';
import { DawnreachHomeOverview, DawnreachHomeRightRail, DawnreachHomeTopbar, DawnreachSharedFooter } from './DawnreachHome';
import { ReadyCheckOverlay } from './MatchmakingPanel';
import { DawnreachPlayScreen, type PlayMode } from './DawnreachPlay';
import {
  getAuthToken,
  getCurrentPlatformUser,
  getSocialSnapshot,
  loginPlatformAccount,
  logoutPlatformAccount,
  platformRealtime,
  registerPlatformAccount,
  type ActiveMatchSession,
  type CustomLobby,
  type HeroSelectState,
  type PartySnapshot,
  type PlatformRealtimeEvent,
  type PlatformUser,
  type MatchEndedEvent,
  type MatchSummary,
  type QueueMode,
  type QueueState,
  type ReadyState,
  type SocialSnapshot,
} from './index';

const LOADING_SPLASH = '/assets/images/dawnreach_loading_splash.webp';
const DAWNREACH_ICON = '/assets/icon/dawnreach.png';
const EMPTY_SOCIAL: SocialSnapshot = { friends: [], incoming: [], outgoing: [] };
const EMPTY_PARTY: PartySnapshot = { party: null, invites: [], messages: [] };
const EMPTY_QUEUE: QueueState = { joined: false, mode: 'ranked', count: 0, target: 10 };
const MATCH_ABANDON_REQUEST_EVENT = 'dawnreach:match-abandon-request';
const MATCH_POST_MATCH_OPEN_EVENT = 'dawnreach:post-match-open';

type Surface = 'booting' | 'auth' | 'home' | 'game';
type AuthMode = 'login' | 'register';
type HomeSection = 'home' | 'play' | 'heroes' | 'ranking' | 'profile';
type PlaySection = 'matchmaking' | 'custom';

function eventType(event: PlatformRealtimeEvent) {
  return typeof event === 'object' && event !== null && 'type' in event ? String(event.type || '') : '';
}

function LocalGameScreen({ activeMatch, user }: { activeMatch?: ActiveMatchSession | null; user?: PlatformUser | null } = {}) {
  const [ready, setReady] = useState(false);
  const localMatchPlayer = activeMatch?.match.players.find(player => player.userId === user?.id) ?? null;
  const runtimeMatchId = activeMatch?.match.id ?? null;
  const runtimePlayerId = user?.id ?? null;
  const runtimePlayerName = user?.username ?? null;
  const runtimeTeam = localMatchPlayer?.team ?? null;

  useEffect(() => mountGameClientRuntime({
    matchId: runtimeMatchId,
    playerId: runtimePlayerId,
    playerName: runtimePlayerName,
    team: runtimeTeam,
  }), [runtimeMatchId, runtimePlayerId, runtimePlayerName, runtimeTeam]);

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
  return <div className="platform-local-game"><GameApp onlineMatch={activeMatch?.match ?? null} localUser={user ?? null} />{!ready && <div className="platform-game-loading" role="status" aria-label="Loading match"><img src={LOADING_SPLASH} alt="" draggable={false} /><div><strong>DAWNREACH</strong><span>Preparing the battlefield…</span></div></div>}</div>;
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
  const [requestedPlayMode, setRequestedPlayMode] = useState<PlayMode | null>(null);
  const [online, setOnline] = useState<readonly PlatformUser[]>([user]);
  const [social, setSocial] = useState<SocialSnapshot>(EMPTY_SOCIAL);
  const [party, setParty] = useState<PartySnapshot>(EMPTY_PARTY);
  const [queue, setQueue] = useState<QueueState>(EMPTY_QUEUE);
  const [ready, setReady] = useState<ReadyState | null>(null);
  const [lobbies, setLobbies] = useState<readonly CustomLobby[]>([]);
  const [currentLobby, setCurrentLobby] = useState<CustomLobby | null>(null);
  const [heroSelect, setHeroSelect] = useState<HeroSelectState | null>(null);
  const [activeMatch, setActiveMatch] = useState<ActiveMatchSession | null>(null);
  const [sharedGameVisible, setSharedGameVisible] = useState(false);
  const [postMatch, setPostMatch] = useState<MatchEndedEvent | null>(null);
  const [postMatchVisible, setPostMatchVisible] = useState(false);
  const [postMatchReturnSection, setPostMatchReturnSection] = useState<HomeSection>('home');
  const abandonPendingRef = useRef(false);
  const closeAfterAbandonRef = useRef(false);
  const [realtime, setRealtime] = useState<'connecting' | 'online' | 'offline'>('connecting');
  const [notice, setNotice] = useState('');
  const [chatFriendId, setChatFriendId] = useState<string | null>(null);
  const refreshSocial = useCallback(async () => { setSocial(await getSocialSnapshot()); }, []);

  useEffect(() => {
    if (chatFriendId && !social.friends.some(friend => friend.id === chatFriendId)) setChatFriendId(null);
  }, [chatFriendId, social.friends]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 6000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    const onMatchAbandonRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ closeAfter?: boolean }>).detail;
      if (activeMatch?.stage !== 'in_game') {
        window.dispatchEvent(new CustomEvent('dawnreach:match-abandon-failed', {
          detail: { message: 'No active online match was found.' },
        }));
        return;
      }
      if (abandonPendingRef.current) return;

      abandonPendingRef.current = true;
      closeAfterAbandonRef.current = Boolean(detail?.closeAfter);

      if (!platformRealtime.send('match.abandon')) {
        abandonPendingRef.current = false;
        closeAfterAbandonRef.current = false;
        setNotice('Realtime connection unavailable. Could not abandon the match.');
        window.dispatchEvent(new CustomEvent('dawnreach:match-abandon-failed', {
          detail: { message: 'Realtime connection unavailable. Could not abandon the match.' },
        }));
        return;
      }

      setNotice('Leaving the active match…');
    };
    window.addEventListener(MATCH_ABANDON_REQUEST_EVENT, onMatchAbandonRequest);
    return () => window.removeEventListener(MATCH_ABANDON_REQUEST_EVENT, onMatchAbandonRequest);
  }, [activeMatch?.stage, activeMatch?.match.id]);

  useEffect(() => {
    const openPostMatch = () => {
      if (!postMatch) return;
      setPostMatchVisible(true);
      setHeroSelect(null);
      setActiveMatch(null);
      setSharedGameVisible(false);
      setCurrentLobby(null);
    };
    window.addEventListener(MATCH_POST_MATCH_OPEN_EVENT, openPostMatch);
    return () => window.removeEventListener(MATCH_POST_MATCH_OPEN_EVENT, openPostMatch);
  }, [postMatch]);

  useEffect(() => {
    void refreshSocial().catch(() => undefined);
    const unsubscribe = platformRealtime.subscribe(event => {
      const type = eventType(event);
      if (type === 'presence.snapshot' && 'users' in event && Array.isArray(event.users)) setOnline(event.users as readonly PlatformUser[]);
      if (type === 'social.snapshot' && 'friends' in event && 'incoming' in event && 'outgoing' in event) setSocial(event as unknown as SocialSnapshot);
      if (type === 'party.snapshot' && 'party' in event && 'invites' in event) setParty({
        party: event.party as PartySnapshot['party'],
        invites: event.invites as PartySnapshot['invites'],
        messages: 'messages' in event && Array.isArray(event.messages) ? event.messages as PartySnapshot['messages'] : [],
      });
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
        if ('match' in event && event.match) setActiveMatch({ stage: 'hero_select', match: event.match as ActiveMatchSession['match'] });
        setNotice('');
      }
      if ((type === 'hero_select.start' || type === 'hero_select.update' || type === 'hero_select.complete') && 'heroSelect' in event && event.heroSelect) {
        const nextHeroSelect = event.heroSelect as HeroSelectState;
        setHeroSelect(nextHeroSelect);
        setActiveMatch({
          stage: nextHeroSelect.phase === 'complete' ? 'loading' : 'hero_select',
          match: nextHeroSelect.match,
        });
        setNotice('');
      }
      if (type === 'hero_select.cancelled') {
        const cancelledByUserId = 'cancelledByUserId' in event ? String(event.cancelledByUserId || '') : '';
        const cancelledByUsername = 'cancelledByUsername' in event ? String(event.cancelledByUsername || 'A player') : 'A player';
        const source = 'source' in event && event.source === 'custom' ? 'custom' : 'matchmaking';
        setHeroSelect(null);
        setActiveMatch(null);
        setSharedGameVisible(false);
        setReady(null);
        setQueue(current => ({ ...current, joined: false }));
        setSection('play');
        setPlaySection(source === 'custom' ? 'custom' : 'matchmaking');
        if (source === 'custom') platformRealtime.send('lobby.list');
        setNotice(cancelledByUserId === user.id
          ? 'You left Hero Select.'
          : `${cancelledByUsername} left Hero Select. The match was cancelled.`);
      }
      if (type === 'match.session.pending') {
        if ('match' in event && event.match) {
          setHeroSelect(null);
          setActiveMatch({ stage: 'loading', match: event.match as ActiveMatchSession['match'] });
        }
        setNotice('');
      }
      if (type === 'match.loading.update' && 'match' in event && event.match) {
        setHeroSelect(null);
        setActiveMatch({ stage: 'loading', match: event.match as ActiveMatchSession['match'] });
      }
      if (type === 'match.start' && 'match' in event && event.match) {
        setHeroSelect(null);
        setPostMatch(null);
        setPostMatchVisible(false);
        setPostMatchReturnSection('home');
        setActiveMatch({ stage: 'in_game', match: event.match as ActiveMatchSession['match'] });
        setSharedGameVisible(true);
        setNotice('');
      }
      if (type === 'match.player.abandoned' && 'match' in event && event.match) {
        const username = 'username' in event ? String(event.username || 'A player') : 'A player';
        setActiveMatch({ stage: 'in_game', match: event.match as ActiveMatchSession['match'] });
        setNotice(`${username} abandoned the match.`);
      }
      if (type === 'match.abandoned') {
        const closeAfter = closeAfterAbandonRef.current;
        abandonPendingRef.current = false;
        closeAfterAbandonRef.current = false;
        window.dispatchEvent(new CustomEvent('dawnreach:match-abandon-confirmed', {
          detail: { closeAfter },
        }));
        setHeroSelect(null);
        setActiveMatch(null);
        setSharedGameVisible(false);
        setCurrentLobby(null);
        setSection('home');
        setNotice('You left the match.');
      }
      if (type === 'match.ended' && 'match' in event && event.match) {
        const ended = event as MatchEndedEvent;
        setHeroSelect(null);
        setPostMatch(ended);
        setCurrentLobby(null);
        setNotice('');

        // Normal flow keeps the battlefield mounted so GameApp can play its result cinematic.
        // If the game is not currently mounted (for example a disconnected player receives
        // the final event from the home surface), open the post-match report immediately.
        const gameMounted = Boolean(document.querySelector('.platform-local-game'));
        if (!gameMounted) {
          setActiveMatch(null);
          setSharedGameVisible(false);
          setPostMatchVisible(true);
        }
      }
      if (type === 'match.rejoin.ready' && 'activeMatch' in event && event.activeMatch) {
        setActiveMatch(event.activeMatch as ActiveMatchSession);
        setSharedGameVisible(true);
        setNotice('');
      }
      if (type === 'error' && 'message' in event) {
        const message = String(event.message || 'Could not complete the action.');
        setNotice(message);
        if (abandonPendingRef.current) {
          abandonPendingRef.current = false;
          closeAfterAbandonRef.current = false;
          window.dispatchEvent(new CustomEvent('dawnreach:match-abandon-failed', {
            detail: { message },
          }));
        }
      }
      if (type === 'session.ready') {
        setRealtime('online');
        if ('presence' in event && Array.isArray(event.presence)) setOnline(event.presence as readonly PlatformUser[]);
        if ('social' in event && event.social) setSocial(event.social as SocialSnapshot);
        if ('party' in event && event.party) setParty(event.party as PartySnapshot);
        if ('lobbies' in event && Array.isArray(event.lobbies)) setLobbies(event.lobbies as readonly CustomLobby[]);
        if ('lobby' in event) setCurrentLobby((event.lobby as CustomLobby | null) ?? null);
        if ('heroSelect' in event) setHeroSelect((event.heroSelect as HeroSelectState | null) ?? null);
        if ('activeMatch' in event) {
          const restoredActiveMatch = (event.activeMatch as ActiveMatchSession | null) ?? null;
          setActiveMatch(restoredActiveMatch);
          if (!restoredActiveMatch || restoredActiveMatch.stage !== 'in_game') setSharedGameVisible(false);
        }
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
  const returnToMatch = () => {
    if (!activeMatch) return;
    if (!platformRealtime.send('match.rejoin')) {
      setNotice('Realtime connection unavailable. Could not return to the match.');
      return;
    }
    setNotice('Reconnecting to your active match…');
  };
  const openPlay = () => { setRequestedPlayMode(null); setSection('play'); setPlaySection('matchmaking'); };
  const openNormal = () => { chooseMode('normal'); setRequestedPlayMode('normal'); setSection('play'); setPlaySection('matchmaking'); };
  const openRanked = () => { chooseMode('ranked'); setRequestedPlayMode('ranked'); setSection('play'); setPlaySection('matchmaking'); };
  const openCustom = () => { setRequestedPlayMode('custom'); setSection('play'); setPlaySection('custom'); platformRealtime.send('lobby.list'); };
  const openHeroes = () => { setRequestedPlayMode(null); setSection('heroes'); };
  const openRanking = () => { setRequestedPlayMode(null); setSection('ranking'); };
  const openProfile = () => { setRequestedPlayMode(null); setSection('profile'); };
  const openProfileMatch = (match: MatchSummary) => {
    const report = match.postMatchReport;
    if (!report) return;
    setPostMatchReturnSection('profile');
    setPostMatch({
      type: 'match.ended',
      match,
      winnerTeam: match.winnerTeam ?? report.winnerTeam ?? null,
      reason: match.endReason || report.reason || 'completed',
      voided: report.voided,
      durationMs: report.durationMs,
      finalStates: report.finalStates,
    });
    setPostMatchVisible(true);
  };
  const openPlayMode = (mode: PlayMode) => {
    if (mode === 'custom') {
      openCustom();
      return;
    }
    if (mode === 'normal' || mode === 'ranked') chooseMode(mode);
    setRequestedPlayMode(mode);
    setSection('play');
    setPlaySection('matchmaking');
  };

  if (postMatch && postMatchVisible) {
    const continueToHome = () => {
      setPostMatch(null);
      setPostMatchVisible(false);
      setSection(postMatchReturnSection);
      setPostMatchReturnSection('home');
      setRequestedPlayMode(null);
    };
    const openPostMatchHome = () => {
      setPostMatch(null);
      setPostMatchVisible(false);
      setPostMatchReturnSection('home');
      setSection('home');
      setRequestedPlayMode(null);
    };
    const openPostMatchPlay = () => {
      setPostMatch(null);
      setPostMatchVisible(false);
      setPostMatchReturnSection('home');
      setSection('play');
      setPlaySection('matchmaking');
      setRequestedPlayMode(null);
    };
    const openPostMatchHeroes = () => {
      setPostMatch(null);
      setPostMatchVisible(false);
      setPostMatchReturnSection('home');
      setSection('heroes');
      setRequestedPlayMode(null);
    };
    const openPostMatchRanking = () => {
      setPostMatch(null);
      setPostMatchVisible(false);
      setPostMatchReturnSection('home');
      setSection('ranking');
      setRequestedPlayMode(null);
    };
    const openPostMatchProfile = () => {
      setPostMatch(null);
      setPostMatchVisible(false);
      setPostMatchReturnSection('home');
      setSection('profile');
      setRequestedPlayMode(null);
    };
    const playAgain = () => {
      const mode = postMatch.match.mode;
      setPostMatch(null);
      setPostMatchVisible(false);
      setPostMatchReturnSection('home');
      setSection('play');
      setPlaySection(mode === 'custom' ? 'custom' : 'matchmaking');
      setRequestedPlayMode(mode === 'normal' || mode === 'ranked' || mode === 'custom' ? mode : null);
      if (mode === 'custom') platformRealtime.send('lobby.list');
    };
    return <PostMatchScreen
      result={postMatch}
      me={user}
      realtime={realtime}
      onContinue={continueToHome}
      onHome={openPostMatchHome}
      onPlay={openPostMatchPlay}
      onHeroes={openPostMatchHeroes}
      onRanking={openPostMatchRanking}
      onProfile={openPostMatchProfile}
      onPlayAgain={playAgain}
      onLogout={onLogout}
    />;
  }

  if (activeMatch?.stage === 'loading' || (activeMatch?.stage === 'in_game' && sharedGameVisible)) {
    return <div className={`platform-shared-match-runtime${activeMatch.stage === 'loading' ? ' is-loading' : ''}`}>
      <LocalGameScreen activeMatch={activeMatch} user={user} />
      {activeMatch.stage === 'loading' && <MatchLoadingScreen session={activeMatch} me={user} />}
    </div>;
  }

  if (heroSelect) {
    return <HeroSelectScreen state={heroSelect} me={user} />;
  }

  return <>
    <main className="platform-home-surface platform-home-shell">
      <DawnreachHomeTopbar section={section} user={user} realtime={realtime} onHome={() => setSection('home')} onPlay={openPlay} onHeroes={openHeroes} onRanking={openRanking} onProfile={openProfile} onLogout={onLogout} />
      {activeMatch?.stage === 'in_game' && !sharedGameVisible && <aside className="dr-active-match-recovery" role="status">
        <Swords />
        <div>
          <small>MATCH IN PROGRESS</small>
          <strong>You still have an active Dawnreach match.</strong>
        </div>
        <button type="button" onClick={returnToMatch}>RETURN TO MATCH</button>
      </aside>}
      {section === 'profile' ? (
        <DawnreachProfile user={user} realtime={realtime} onOpenMatch={openProfileMatch} />
      ) : section === 'heroes' ? (
        <DawnreachHeroes onPlay={openPlay} onPractice={onLocalPlay} />
      ) : section === 'ranking' ? (
        <DawnreachRanking user={user} social={social} />
      ) : (
        <div className="platform-home-grid">
          <section className="platform-main-workspace">
            {section === 'home' ? <DawnreachHomeOverview user={user} party={party} online={online} social={social} selectedChatFriendId={chatFriendId} refreshSocial={refreshSocial} onActiveChatFriendChange={setChatFriendId} onPlay={openPlay} onLocalPlay={onLocalPlay} onNormal={openNormal} onRanked={openRanked} onCustom={openCustom} /> : <section className="dr-play-overview">
              {playSection === 'matchmaking' ? <>
                <DawnreachPlayScreen me={user} party={party} queue={queue} initialMode={requestedPlayMode ?? undefined} onMode={chooseMode} onJoin={joinQueue} onLeave={leaveQueue} onLocalPlay={onLocalPlay} onCustom={openCustom} />
              </> : <section className="platform-play-custom-shell">
                <CustomLobbyPanel me={user} lobbies={lobbies} currentLobby={currentLobby} onSelectMode={openPlayMode} />
              </section>}
              {playSection === 'matchmaking' && <DawnreachSharedFooter user={user} online={online} social={social} party={party} selectedChatFriendId={chatFriendId} refreshSocial={refreshSocial} onActiveChatFriendChange={setChatFriendId} />}
            </section>}
          </section>
          {!(section === 'play' && playSection === 'custom') && <DawnreachHomeRightRail me={user} online={online} snapshot={social} party={party} refresh={refreshSocial} activeConversationId={chatFriendId} onOpenConversation={setChatFriendId} />}
        </div>
      )}
      {notice && <div className="dr-platform-toast" role="status">
        <span className="dr-platform-toast-mark" aria-hidden="true" />
        <span>{notice}</span>
        <button type="button" aria-label="Dismiss notification" onClick={() => setNotice('')}><X /></button>
      </div>}
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
