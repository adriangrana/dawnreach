import { useEffect, useState, type FormEvent } from 'react';
import { LogIn, Shield, Swords, UserPlus, Users } from 'lucide-react';
import GameApp from '../App';
import { mountGameClientRuntime } from '../game/mountGameClientRuntime';
import {
  getAuthToken,
  getCurrentPlatformUser,
  loginPlatformAccount,
  logoutPlatformAccount,
  platformRealtime,
  registerPlatformAccount,
  type PlatformRealtimeEvent,
  type PlatformUser,
} from './index';

const LOADING_SPLASH = '/assets/images/dawnreach_loading_splash.webp';
const DAWNREACH_ICON = '/assets/icon/dawnreach.png';

type Surface = 'booting' | 'auth' | 'home' | 'game';
type AuthMode = 'login' | 'register';

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
      if (loaded || performance.now() - startedAt > 12_000) {
        setReady(true);
        return;
      }
      requestAnimationFrame(inspect);
    };
    requestAnimationFrame(inspect);
    return () => { disposed = true; };
  }, []);

  return (
    <div className="platform-local-game">
      <GameApp />
      {!ready && (
        <div className="platform-game-loading" role="status" aria-label="Cargando partida">
          <img src={LOADING_SPLASH} alt="" draggable={false} />
          <div><strong>DAWNREACH</strong><span>Preparando el campo de batalla…</span></div>
        </div>
      )}
    </div>
  );
}

function AuthSurface({ error, onAuthenticated, onLocalGame }: {
  error: string;
  onAuthenticated: (user: PlatformUser) => void;
  onLocalGame: () => void;
}) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(error);

  useEffect(() => setMessage(error), [error]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const user = mode === 'register'
        ? await registerPlatformAccount(username, password)
        : await loginPlatformAccount(username, password);
      onAuthenticated(user);
    } catch (authError) {
      setMessage(authError instanceof Error ? authError.message : 'No se pudo iniciar sesión.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="platform-auth-surface">
      <section className="platform-brand-panel">
        <img className="platform-brand-icon" src={DAWNREACH_ICON} alt="" draggable={false} />
        <p className="platform-eyebrow">EL CONFLICTO DE DOS REINOS</p>
        <h1>DAWNREACH</h1>
        <p className="platform-brand-copy">Forma tu grupo, entra en cola y lucha por derribar el trono enemigo.</p>
        <div className="platform-brand-rule"><span /><Shield /><span /></div>
      </section>

      <section className="platform-auth-card" aria-label={mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta'}>
        <div className="platform-auth-tabs" role="tablist">
          <button type="button" className={mode === 'login' ? 'is-active' : ''} onClick={() => setMode('login')}>
            <LogIn /> Iniciar sesión
          </button>
          <button type="button" className={mode === 'register' ? 'is-active' : ''} onClick={() => setMode('register')}>
            <UserPlus /> Crear cuenta
          </button>
        </div>
        <form onSubmit={submit}>
          <label>Nombre de usuario<input autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} minLength={3} maxLength={24} required /></label>
          <label>Contraseña<input type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} minLength={10} required /></label>
          {mode === 'register' && <p className="platform-password-hint">10+ caracteres y al menos tres tipos entre mayúsculas, minúsculas, números y símbolos.</p>}
          {message && <p className="platform-auth-message" role="alert">{message}</p>}
          <button className="platform-primary-button" type="submit" disabled={busy}>
            {busy ? 'Conectando…' : mode === 'login' ? 'Entrar en Dawnreach' : 'Crear cuenta'}
          </button>
        </form>
        <button className="platform-local-button" type="button" onClick={onLocalGame}>Partida local · desarrollo</button>
      </section>
    </main>
  );
}

function HomeSurface({ user, onPlay, onLogout }: { user: PlatformUser; onPlay: () => void; onLogout: () => void }) {
  const [online, setOnline] = useState<readonly PlatformUser[]>([user]);
  const [realtime, setRealtime] = useState<'connecting' | 'online' | 'offline'>('connecting');

  useEffect(() => {
    const unsubscribe = platformRealtime.subscribe(event => {
      const type = eventType(event);
      if (type === 'presence.snapshot' && 'users' in event && Array.isArray(event.users)) {
        setOnline(event.users as readonly PlatformUser[]);
      }
      if (type === 'session.ready') {
        setRealtime('online');
        if ('presence' in event && Array.isArray(event.presence)) setOnline(event.presence as readonly PlatformUser[]);
      }
    });
    let socket: WebSocket | null = null;
    try {
      socket = platformRealtime.connect();
      socket.addEventListener('open', () => setRealtime('online'));
      socket.addEventListener('close', () => setRealtime('offline'));
      socket.addEventListener('error', () => setRealtime('offline'));
    } catch {
      setRealtime('offline');
    }
    return () => {
      unsubscribe();
      platformRealtime.disconnect();
    };
  }, [user.id]);

  return (
    <main className="platform-home-surface">
      <header className="platform-topbar">
        <div className="platform-wordmark"><img src={DAWNREACH_ICON} alt="" /><strong>DAWNREACH</strong></div>
        <nav aria-label="Navegación principal"><button className="is-active">JUGAR</button><button disabled>SOCIAL</button><button disabled>RANKING</button><button disabled>PERFIL</button></nav>
        <div className="platform-account"><span className={`platform-presence is-${realtime}`} /> <strong>{user.username}</strong><button onClick={onLogout}>Salir</button></div>
      </header>

      <section className="platform-play-hero">
        <div className="platform-play-copy">
          <p className="platform-eyebrow">FASE A · PLATAFORMA NATIVA</p>
          <h2>Elige cómo entrar en batalla</h2>
          <p>La cuenta y presencia realtime ya pertenecen a Dawnreach. Matchmaking, party y salas se conectarán sobre esta misma sesión.</p>
          <button className="platform-primary-button platform-play-button" onClick={onPlay}><Swords /> Entrar en partida local</button>
        </div>
        <aside className="platform-online-card">
          <div><Users /><span><strong>{online.length}</strong> conectados</span></div>
          <small>{realtime === 'online' ? 'Servidor realtime conectado' : realtime === 'connecting' ? 'Conectando realtime…' : 'Realtime desconectado'}</small>
          <ul>{online.slice(0, 6).map(player => <li key={player.id}><span />{player.username}</li>)}</ul>
        </aside>
      </section>
    </main>
  );
}

export default function PlatformShell() {
  const [surface, setSurface] = useState<Surface>('booting');
  const [user, setUser] = useState<PlatformUser | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const restore = async () => {
      if (!getAuthToken()) {
        if (active) setSurface('auth');
        return;
      }
      try {
        const restored = await getCurrentPlatformUser();
        if (!active) return;
        setUser(restored);
        setSurface('home');
      } catch (restoreError) {
        if (!active) return;
        setError(restoreError instanceof Error ? restoreError.message : 'No se pudo restaurar la sesión.');
        setSurface('auth');
      }
    };
    void restore();
    return () => { active = false; };
  }, []);

  const authenticated = (nextUser: PlatformUser) => {
    setUser(nextUser);
    setError('');
    setSurface('home');
  };

  const logout = async () => {
    platformRealtime.disconnect();
    try { await logoutPlatformAccount(); } catch { /* Token storage is cleared by the API client. */ }
    setUser(null);
    setSurface('auth');
  };

  if (surface === 'game') return <div className="platform-shell platform-shell--game" data-dawnreach-platform-ready="true"><LocalGameScreen /></div>;

  return (
    <div className="platform-shell" data-dawnreach-platform-ready={surface === 'booting' ? 'false' : 'true'}>
      <div className="platform-shell-backdrop" aria-hidden="true" />
      {surface === 'booting' && <div className="platform-bootstrap"><img src={DAWNREACH_ICON} alt="" /><strong>DAWNREACH</strong><span>Restaurando sesión…</span></div>}
      {surface === 'auth' && <AuthSurface error={error} onAuthenticated={authenticated} onLocalGame={() => setSurface('game')} />}
      {surface === 'home' && user && <HomeSurface user={user} onPlay={() => setSurface('game')} onLogout={() => void logout()} />}
    </div>
  );
}
