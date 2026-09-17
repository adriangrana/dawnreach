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
import { PartyManager } from './parties.mjs';
import { Matchmaker } from './matchmaking.mjs';
import { LobbyManager } from './lobbies.mjs';
import { acceptWebSocket } from './websocket.mjs';

export function createPlatformServer(options = {}) {
  const config = options.config || loadPlatformConfig();
  const logger = options.logger || console;
  fs.mkdirSync(config.dataDir, { recursive: true });
  const store = new PlatformStore(path.join(config.dataDir, 'users.json'));
  const sessions = new SessionManager(path.join(config.dataDir, 'sessions.json'), config.auth);
  const rateLimiter = new AuthRateLimiter(config.auth);
  const peersByUser = new Map();

  function isOnline(userId) {
    return peersByUser.has(userId);
  }

  function publicPresence() {
    return [...peersByUser.keys()].map(id => store.publicUser(store.getUser(id))).filter(Boolean);
  }

  function send(userId, payload) {
    peersByUser.get(userId)?.send(payload);
  }

  function broadcast(payload, userIds) {
    const targets = userIds
      ? userIds.map(userId => peersByUser.get(userId)).filter(Boolean)
      : [...peersByUser.values()];
    for (const peer of targets) peer.send(payload);
  }

  const parties = new PartyManager({
    store,
    onEvent: (event, userIds) => broadcast(event, userIds),
  });

  function launchMatch(match) {
    const { resultToken: _secret, ...safe } = match;
    broadcast({
      type: 'match.session.pending',
      match: safe,
      note: 'La plataforma ya creó la partida. El transporte de la sesión de juego se conectará en la siguiente fase.',
    }, match.players.map(player => player.userId));
  }

  const matchmaker = new Matchmaker({
    queueSize: config.queueSize,
    readyTimeoutSeconds: config.readyTimeoutSeconds,
    store,
    onEvent: (event, userIds) => broadcast(event, userIds),
    onLaunch: launchMatch,
  });

  const lobbies = new LobbyManager({
    store,
    onEvent: (event, userIds) => broadcast(event, userIds),
    onLaunch: launchMatch,
  });

  function requireNotInLobby(userId) {
    if (lobbies.lobbyForUser(userId)) throw new Error('Sal de la sala personalizada antes de entrar en matchmaking.');
  }

  function queueParty(user, mode) {
    const party = parties.partyForUser(user.id);
    if (!party) {
      requireNotInLobby(user.id);
      const competitor = store.competitiveUser(store.getUser(user.id));
      if (!competitor) throw new Error('Jugador no encontrado.');
      matchmaker.join(competitor, mode);
      return;
    }
    if (party.leaderId !== user.id) throw new Error('Solo el líder del grupo puede iniciar matchmaking.');
    const members = parties.membersAsUsers(party);
    members.forEach(member => requireNotInLobby(member.id));
    matchmaker.joinMany(members, mode, party.id);
  }

  function leaveQueue(user) {
    const party = parties.partyForUser(user.id);
    if (party && party.leaderId === user.id) parties.membersAsUsers(party).forEach(member => matchmaker.leave(member.id));
    else matchmaker.leave(user.id);
  }

  function socialSnapshot(userId) {
    const incoming = store.incomingFriendRequests(userId).map(request => ({
      ...request,
      user: store.publicUser(store.getUser(request.fromUserId)),
    }));
    const outgoing = store.outgoingFriendRequests(userId).map(request => ({
      ...request,
      user: store.publicUser(store.getUser(request.toUserId)),
    }));
    const friends = store.friendsOf(userId).map(friend => ({
      ...friend,
      status: isOnline(friend.id) ? 'online' : 'offline',
      unread: store.unreadCount(userId, friend.id),
    })).sort((a, b) => Number(b.status === 'online') - Number(a.status === 'online') || a.username.localeCompare(b.username));
    return { friends, incoming, outgoing };
  }

  function pushSocial(userIds) {
    for (const userId of new Set(userIds)) send(userId, { type: 'social.snapshot', ...socialSnapshot(userId) });
  }

  function broadcastPresence() {
    broadcast({ type: 'presence.snapshot', users: publicPresence() });
    pushSocial([...peersByUser.keys()]);
  }

  function cors(req, res) {
    const origin = String(req.headers.origin || '');
    if (!origin || /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(origin) || /^tauri:\/\//i.test(origin)) {
      res.setHeader('access-control-allow-origin', origin || '*');
    }
    res.setHeader('vary', 'origin');
    res.setHeader('access-control-allow-headers', 'content-type, authorization');
    res.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
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
      if (req.method === 'GET' && url.pathname === '/api/config') {
        return json(req, res, 200, { queueSize: config.queueSize, readyTimeoutSeconds: config.readyTimeoutSeconds });
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

      const token = bearerToken(req);
      const user = token ? userFromToken(token) : null;
      if (req.method === 'GET' && url.pathname === '/api/me') {
        if (!user) return json(req, res, 401, { error: 'Unauthorized' });
        return json(req, res, 200, { user });
      }
      if (req.method === 'GET' && url.pathname === '/api/auth/sessions') {
        if (!user) return json(req, res, 401, { error: 'Unauthorized' });
        return json(req, res, 200, { sessions: sessions.sessionsFor(user.id, token) });
      }
      if (req.method === 'POST' && url.pathname === '/api/logout') {
        if (!user) return json(req, res, 401, { error: 'Unauthorized' });
        sessions.revoke(token);
        const peer = peersByUser.get(user.id);
        if (peer) peer.close();
        return json(req, res, 200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/api/social/snapshot') {
        if (!user) return json(req, res, 401, { error: 'Unauthorized' });
        return json(req, res, 200, socialSnapshot(user.id));
      }
      if (req.method === 'GET' && url.pathname === '/api/users/search') {
        if (!user) return json(req, res, 401, { error: 'Unauthorized' });
        return json(req, res, 200, { users: store.searchUsers(url.searchParams.get('q') || '', user.id) });
      }
      if (req.method === 'POST' && url.pathname === '/api/friends/request') {
        if (!user) return json(req, res, 401, { error: 'Unauthorized' });
        const body = await readJson(req);
        const request = store.createFriendRequest(user.id, String(body.userId || ''));
        pushSocial([request.fromUserId, request.toUserId]);
        return json(req, res, 201, { request });
      }
      if (req.method === 'POST' && url.pathname === '/api/friends/respond') {
        if (!user) return json(req, res, 401, { error: 'Unauthorized' });
        const body = await readJson(req);
        const request = store.respondFriendRequest(user.id, String(body.requestId || ''), Boolean(body.accept));
        pushSocial([request.fromUserId, request.toUserId]);
        return json(req, res, 200, { ok: true });
      }
      if (req.method === 'DELETE' && url.pathname === '/api/friends') {
        if (!user) return json(req, res, 401, { error: 'Unauthorized' });
        const friendUserId = String(url.searchParams.get('userId') || '');
        const removed = store.removeFriendship(user.id, friendUserId);
        if (removed) pushSocial([user.id, friendUserId]);
        return json(req, res, 200, { ok: true, removed });
      }
      if (req.method === 'GET' && url.pathname === '/api/messages') {
        if (!user) return json(req, res, 401, { error: 'Unauthorized' });
        const friendUserId = String(url.searchParams.get('userId') || '');
        const messages = store.conversation(user.id, friendUserId);
        store.markConversationRead(user.id, friendUserId);
        pushSocial([user.id]);
        return json(req, res, 200, { messages });
      }
      if (req.method === 'POST' && url.pathname === '/api/messages') {
        if (!user) return json(req, res, 401, { error: 'Unauthorized' });
        const body = await readJson(req);
        const friendUserId = String(body.userId || '');
        const message = store.sendDirectMessage(user.id, friendUserId, body.text);
        send(friendUserId, { type: 'direct.message', message, user: store.publicUser(store.getUser(user.id)) });
        send(user.id, { type: 'direct.message', message, user: store.publicUser(store.getUser(friendUserId)) });
        pushSocial([user.id, friendUserId]);
        return json(req, res, 201, { message });
      }
      return json(req, res, 404, { error: 'Not found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected server error';
      const clientFault = /registrado|contraseña|nombre de usuario|caracteres|tipos|solicitud|amistad|amigos|mensaje|usuario solicitado|lista de amigos|sala|partida|equipo|posición|matchmaking/i.test(message);
      const status = clientFault ? 400 : 500;
      if (status === 500) logger.error?.('[platform] request failed', error);
      return json(req, res, status, { error: status === 500 ? 'Error interno del servidor.' : message });
    }
  });

  server.on('upgrade', (req, socket) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (url.pathname !== '/ws') return socket.destroy();
      const token = String(url.searchParams.get('token') || '');
      const user = userFromToken(token);
      if (!user) return socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      const existing = peersByUser.get(user.id);
      if (existing) existing.close();
      const peer = acceptWebSocket(req, socket, user.id);
      if (!peer) return socket.destroy();
      peersByUser.set(user.id, peer);
      peer.onMessage = message => {
        try {
          const type = String(message?.type || '');
          if (type === 'queue.join' || type === 'party.queue') queueParty(user, message.mode === 'normal' ? 'normal' : 'ranked');
          else if (type === 'queue.leave') leaveQueue(user);
          else if (type === 'ready.response') matchmaker.respond(user.id, String(message.readyId || ''), Boolean(message.accepted));
          else if (type === 'lobby.create') {
            leaveQueue(user);
            lobbies.create(user, String(message.name || ''), message.privacy === 'private' ? 'private' : 'public', Number(message.maxPlayers || 10));
          } else if (type === 'lobby.join') {
            leaveQueue(user);
            lobbies.join(user, String(message.code || message.lobbyId || ''));
          } else if (type === 'lobby.move') lobbies.move(user.id, message.team === 'red' ? 'red' : 'blue', Number(message.slot));
          else if (type === 'lobby.leave') lobbies.leave(user.id);
          else if (type === 'lobby.start') lobbies.start(user.id);
          else if (type === 'lobby.list') lobbies.emitList();
          else if (type === 'party.create') parties.create(user);
          else if (type === 'party.invite') parties.invite(user.id, String(message.username || ''));
          else if (type === 'party.accept') parties.accept(user.id, String(message.inviteId || ''));
          else if (type === 'party.decline') parties.decline(user.id, String(message.inviteId || ''));
          else if (type === 'party.message') parties.sendMessage(user.id, message.text);
          else if (type === 'party.leave') {
            parties.leave(user.id);
            matchmaker.leave(user.id);
          }
        } catch (error) {
          peer.send({ type: 'error', message: error instanceof Error ? error.message : 'No se pudo completar la acción.' });
        }
      };
      peer.onClose = () => {
        if (peersByUser.get(user.id) === peer) peersByUser.delete(user.id);
        broadcastPresence();
      };
      peer.send({
        type: 'session.ready',
        user,
        presence: publicPresence(),
        social: socialSnapshot(user.id),
        party: parties.snapshotFor(user.id),
        queue: { joined: Boolean(matchmaker.statusFor(user.id)), target: config.queueSize },
        lobbies: lobbies.listPublic(),
        lobby: lobbies.lobbyForUser(user.id),
      });
      broadcastPresence();
    } catch {
      socket.destroy();
    }
  });

  async function start({ host = config.host, port = config.port } = {}) {
    if (server.listening) throw new Error('Dawnreach platform server is already listening.');
    await new Promise((resolve, reject) => {
      const onError = error => { server.off('listening', onListening); reject(error); };
      const onListening = () => { server.off('error', onError); resolve(); };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, host);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Could not resolve Dawnreach platform listen address.');
    return { host: address.address, port: address.port };
  }

  async function close() {
    for (const peer of [...peersByUser.values()]) peer.close();
    peersByUser.clear();
    if (!server.listening) return;
    await new Promise(resolve => server.close(() => resolve()));
  }

  return { config, server, store, sessions, parties, matchmaker, lobbies, start, close };
}
