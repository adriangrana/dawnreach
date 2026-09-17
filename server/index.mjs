import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { URL } from 'node:url';
import { loadPlatformConfig } from './config.mjs';
import { AuthRateLimiter } from './auth/rate-limit.mjs';
import { SessionManager } from './auth/session-manager.mjs';
import { validatePassword } from './auth/password-policy.mjs';
import { hashPassword } from './security.mjs';
import { PlatformStore } from './store.mjs';
import { acceptWebSocket } from './websocket.mjs';

try { process.umask(0o077); } catch { /* unsupported platform */ }

const config = loadPlatformConfig();
fs.mkdirSync(config.dataDir, { recursive: true });
const store = new PlatformStore(path.join(config.dataDir, 'users.json'));
const sessions = new SessionManager(path.join(config.dataDir, 'sessions.json'), config.auth);
const rateLimiter = new AuthRateLimiter(config.auth);
const peersByUser = new Map();

function publicPresence() {
  return [...peersByUser.keys()].map(id => store.publicUser(store.getUser(id))).filter(Boolean);
}

function broadcast(payload) {
  for (const peer of peersByUser.values()) peer.send(payload);
}

function broadcastPresence() {
  broadcast({ type: 'presence.snapshot', users: publicPresence() });
}

function cors(req, res) {
  const origin = String(req.headers.origin || '');
  if (!origin || /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(origin) || /^tauri:\/\//i.test(origin)) {
    res.setHeader('access-control-allow-origin', origin || '*');
  }
  res.setHeader('vary', 'origin');
  res.setHeader('access-control-allow-headers', 'content-type, authorization');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('x-content-type-options', 'nosniff');
}

function json(req, res, status, body) {
  cors(req, res);
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data) });
  res.end(data);
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 256 * 1024) throw new Error('Body too large');
  }
  return body ? JSON.parse(body) : {};
}

function bearerToken(req) {
  const header = String(req.headers.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

function userFromToken(token) {
  const authenticated = sessions.authenticate(token);
  return authenticated ? store.publicUser(store.getUser(authenticated.userId)) : null;
}

function sourceFor(req) {
  return String(req.socket.remoteAddress || 'unknown');
}

function sessionLabel(req) {
  const agent = String(req.headers['user-agent'] || '');
  if (/Windows/i.test(agent)) return 'Dawnreach Desktop · Windows';
  if (/Macintosh|Mac OS/i.test(agent)) return 'Dawnreach Desktop · macOS';
  if (/Linux/i.test(agent)) return 'Dawnreach Desktop · Linux';
  return 'Dawnreach Desktop';
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      cors(req, res);
      res.writeHead(204);
      return res.end();
    }
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(req, res, 200, { ok: true, service: 'dawnreach-platform', now: new Date().toISOString() });
    }
    if (req.method === 'POST' && url.pathname === '/api/register') {
      const source = sourceFor(req);
      const limit = rateLimiter.consumeRegister(source);
      if (!limit.allowed) {
        res.setHeader('retry-after', String(limit.retryAfterSeconds));
        return json(req, res, 429, { error: 'Demasiados intentos. Inténtalo de nuevo más tarde.' });
      }
      const body = await readJson(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      validatePassword(password, username, config.auth.minPasswordLength);
      const user = store.register(username, hashPassword(password));
      const issued = sessions.issue(user.id, Date.now(), sessionLabel(req));
      return json(req, res, 201, { token: issued.token, user });
    }
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const body = await readJson(req);
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      const source = sourceFor(req);
      const limit = rateLimiter.checkLogin(source, username);
      if (!limit.allowed) {
        res.setHeader('retry-after', String(limit.retryAfterSeconds));
        return json(req, res, 429, { error: 'Demasiados intentos. Inténtalo de nuevo más tarde.' });
      }
      const user = store.authenticate(username, password);
      if (!user) {
        rateLimiter.recordLoginFailure(source, username);
        return json(req, res, 401, { error: 'Usuario o contraseña incorrectos.' });
      }
      rateLimiter.recordLoginSuccess(username);
      const issued = sessions.issue(user.id, Date.now(), sessionLabel(req));
      return json(req, res, 200, { token: issued.token, user });
    }
    if (req.method === 'GET' && url.pathname === '/api/me') {
      const user = userFromToken(bearerToken(req));
      if (!user) return json(req, res, 401, { error: 'Unauthorized' });
      return json(req, res, 200, { user });
    }
    if (req.method === 'GET' && url.pathname === '/api/auth/sessions') {
      const token = bearerToken(req);
      const user = userFromToken(token);
      if (!user) return json(req, res, 401, { error: 'Unauthorized' });
      return json(req, res, 200, { sessions: sessions.sessionsFor(user.id, token) });
    }
    if (req.method === 'POST' && url.pathname === '/api/logout') {
      const token = bearerToken(req);
      const user = userFromToken(token);
      if (!user) return json(req, res, 401, { error: 'Unauthorized' });
      sessions.revoke(token);
      const peer = peersByUser.get(user.id);
      if (peer) peer.close();
      return json(req, res, 200, { ok: true });
    }
    return json(req, res, 404, { error: 'Not found' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    const status = /registrado|contraseña|nombre de usuario|caracteres|tipos/i.test(message) ? 400 : 500;
    if (status === 500) console.error('[platform] request failed', error);
    return json(req, res, status, { error: status === 500 ? 'Error interno del servidor.' : message });
  }
});

server.on('upgrade', (req, socket) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname !== '/ws') return socket.destroy();
    const token = String(url.searchParams.get('token') || '');
    const user = userFromToken(token);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      return socket.destroy();
    }
    const existing = peersByUser.get(user.id);
    if (existing) existing.close();
    const peer = acceptWebSocket(req, socket, user.id);
    if (!peer) return socket.destroy();
    peersByUser.set(user.id, peer);
    peer.onClose = () => {
      if (peersByUser.get(user.id) === peer) peersByUser.delete(user.id);
      broadcastPresence();
    };
    peer.send({ type: 'session.ready', user, presence: publicPresence() });
    broadcastPresence();
  } catch {
    socket.destroy();
  }
});

server.listen(config.port, config.host, () => {
  console.log(`[platform] Dawnreach server listening on http://${config.host}:${config.port}`);
});

function shutdown() {
  for (const peer of peersByUser.values()) peer.close();
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
