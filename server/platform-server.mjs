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
import { HeroSelectManager } from './hero-select.mjs';
import { acceptWebSocket } from './websocket.mjs';

export function createPlatformServer(options = {}) {
  const config = options.config || loadPlatformConfig();
  const logger = options.logger || console;
  fs.mkdirSync(config.dataDir, { recursive: true });
  const store = new PlatformStore(path.join(config.dataDir, 'users.json'));
  const sessions = new SessionManager(path.join(config.dataDir, 'sessions.json'), config.auth);
  const rateLimiter = new AuthRateLimiter(config.auth);
  const peersByUser = new Map();
  const matchRuntimeStates = new Map();

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

  function handoffToGameSession(match, heroSelections) {
    const loadingProgress = Object.fromEntries(match.players.map(player => [player.userId, 0]));
    const updated = store.updateMatch(match.id, {
      status: 'loading',
      heroSelections,
      loadingProgress,
      heroSelectCompletedAt: new Date().toISOString(),
    }) || { ...match, status: 'loading', heroSelections, loadingProgress };
    const { resultToken: _secret, ...safe } = updated;
    broadcast({
      type: 'match.session.pending',
      match: safe,
      note: 'Hero Select complete. Preparing the shared Dawnreach game session.',
    }, match.players.map(player => player.userId));
  }

  function handleHeroSelectCancel(match, player) {
    store.updateMatch(match.id, {
      status: 'cancelled',
      cancelledAt: new Date().toISOString(),
      cancelledByUserId: player.userId,
    });
    if (match.source === 'custom') lobbies.cancelLaunch(match.id, player.userId);
  }

  const heroSelect = new HeroSelectManager({
    heroIds: ['H001'],
    heroNames: { H001: 'Alden' },
    pickSeconds: 45,
    onEvent: (event, userIds) => broadcast(event, userIds),
    onComplete: handoffToGameSession,
    onCancel: handleHeroSelectCancel,
  });

  function launchMatch(match) {
    heroSelect.begin(match);
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

  function publicMatch(match) {
    if (!match) return null;
    const { resultToken: _secret, ...safe } = match;
    return safe;
  }

  function runtimeRoom(matchId) {
    let room = matchRuntimeStates.get(matchId);
    if (!room) {
      room = new Map();
      matchRuntimeStates.set(matchId, room);
    }
    return room;
  }

  function runtimeSnapshot(matchId) {
    const room = matchRuntimeStates.get(matchId);
    return room ? [...room.values()].map(state => ({ ...state, position: { ...state.position } })) : [];
  }

  function reportMatchRuntimeState(userId, payload) {
    const active = store.activeMatchForUser(userId);
    if (!active || active.status !== 'in_game') throw new Error('No tienes una partida activa para sincronizar.');
    if (payload?.matchId && String(payload.matchId) !== active.id) throw new Error('La actualización pertenece a otra partida.');

    const player = active.players.find(candidate => candidate.userId === userId);
    if (!player) throw new Error('No participas en esta partida.');

    const position = payload?.position && typeof payload.position === 'object' ? payload.position : {};
    const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value)));

    const previous = runtimeRoom(active.id).get(userId);
    const sequence = Math.max(Number(previous?.sequence || 0) + 1, Math.floor(finite(payload?.sequence, 0)));
    const state = {
      userId,
      username: player.username,
      team: player.team,
      slot: player.slot,
      heroId: active.heroSelections?.[userId]?.heroId || 'H001',
      sequence,
      position: {
        x: clamp(position.x, -75, 75),
        y: clamp(position.y, -5, 40),
        z: clamp(position.z, -62.5, 62.5),
      },
      yaw: clamp(payload?.yaw, -Math.PI * 8, Math.PI * 8),
      moving: Boolean(payload?.moving),
      currentHp: clamp(payload?.currentHp, 0, 100000),
      maxHp: clamp(payload?.maxHp, 1, 100000),
      currentResource: clamp(payload?.currentResource, 0, 100000),
      maxResource: clamp(payload?.maxResource, 0, 100000),
      level: Math.max(1, Math.min(99, Math.floor(finite(payload?.level, 1)))),
      alive: payload?.alive !== false,
      sentAt: Date.now(),
    };

    runtimeRoom(active.id).set(userId, state);
    broadcast({
      type: 'match.runtime.state',
      matchId: active.id,
      state,
    }, active.players.map(candidate => candidate.userId));
    return state;
  }

  function activeSessionForUser(userId) {
    const heroState = heroSelect.snapshotForUser(userId);
    if (heroState) {
      return {
        stage: heroState.phase === 'complete' ? 'loading' : 'hero_select',
        match: heroState.match,
      };
    }

    const lobby = lobbies.lobbyForUser(userId);
    if (lobby?.matchId && (lobby.status === 'launching' || lobby.status === 'in_game')) {
      const match = store.match(lobby.matchId);
      if (match) {
        return {
          stage: lobby.status === 'in_game' ? 'in_game' : (match.status === 'loading' ? 'loading' : 'hero_select'),
          match: publicMatch(match),
        };
      }
    }

    const persistent = store.activeMatchForUser(userId);
    return persistent
      ? { stage: persistent.status === 'in_game' ? 'in_game' : 'loading', match: publicMatch(persistent) }
      : null;
  }

  function reportMatchLoadingProgress(userId, value) {
    const active = store.activeMatchForUser(userId);
    if (!active) throw new Error('No tienes una partida cargando.');
    if (active.status === 'in_game') return;
    if (active.status !== 'loading') throw new Error('No tienes una partida cargando.');

    const progress = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    const loadingProgress = { ...(active.loadingProgress || {}) };
    loadingProgress[userId] = Math.max(Number(loadingProgress[userId] || 0), progress);

    let updated = store.updateMatch(active.id, { loadingProgress });
    if (!updated) throw new Error('No se pudo actualizar la carga de la partida.');

    const participants = updated.players.map(player => player.userId);
    broadcast({
      type: 'match.loading.update',
      match: publicMatch(updated),
    }, participants);

    const everyoneReady = updated.players.every(player => Number(loadingProgress[player.userId] || 0) >= 100);
    if (!everyoneReady || updated.status !== 'loading') return;

    updated = store.updateMatch(updated.id, {
      status: 'in_game',
      loadingProgress,
      startedAt: new Date().toISOString(),
    }) || { ...updated, status: 'in_game', loadingProgress };

    if (updated.source === 'custom') lobbies.markInGame(updated.id);
    matchRuntimeStates.set(updated.id, new Map());

    broadcast({
      type: 'match.start',
      match: publicMatch(updated),
    }, participants);
  }

  function abandonActiveMatch(userId) {
    const active = store.activeMatchForUser(userId);
    if (!active) throw new Error('No tienes una partida activa que abandonar.');

    const player = active.players.find(candidate => candidate.userId === userId);
    if (!player) throw new Error('No participas en esta partida.');

    const abandonedUserIds = [...new Set([...(active.abandonedUserIds || []), userId])];
    const remainingPlayers = active.players.filter(candidate => !abandonedUserIds.includes(candidate.userId));
    const remainingDawn = remainingPlayers.filter(candidate => candidate.team === 'blue');
    const remainingDusk = remainingPlayers.filter(candidate => candidate.team === 'red');

    const loadingCancelled = active.status === 'loading';
    const teamEliminated = active.status === 'in_game' && (!remainingDawn.length || !remainingDusk.length);
    const ended = loadingCancelled || teamEliminated;
    const winnerTeam = active.status === 'in_game' && teamEliminated
      ? remainingDawn.length ? 'blue' : remainingDusk.length ? 'red' : null
      : null;

    runtimeRoom(active.id).delete(userId);

    const updated = store.updateMatch(active.id, {
      abandonedUserIds,
      ...(ended ? {
        status: loadingCancelled ? 'cancelled' : 'completed',
        endedAt: new Date().toISOString(),
        endReason: loadingCancelled ? 'loading_abandonment' : 'team_abandonment',
        winnerTeam,
      } : {}),
    }) || { ...active, abandonedUserIds };

    send(userId, {
      type: 'match.abandoned',
      matchId: active.id,
      ended,
    });

    const participantIds = active.players.map(candidate => candidate.userId);
    if (ended) {
      broadcast({
        type: 'match.ended',
        match: publicMatch(updated),
        winnerTeam,
        reason: loadingCancelled ? 'loading_abandonment' : 'team_abandonment',
      }, participantIds);
      matchRuntimeStates.delete(active.id);
      if (active.source === 'custom') lobbies.closeByMatch(active.id);
      return publicMatch(updated);
    }

    if (active.source === 'custom') lobbies.removeParticipantFromInGame(active.id, userId);
    broadcast({
      type: 'match.player.abandoned',
      match: publicMatch(updated),
      userId,
      username: player.username,
    }, remainingPlayers.map(candidate => candidate.userId));
    return publicMatch(updated);
  }

  function requireNoActiveSession(userId) {
    if (activeSessionForUser(userId)) {
      throw new Error('Ya tienes una partida activa. Usa RETURN TO MATCH para volver o abandónala desde la partida.');
    }
  }

  function rejoinActiveSession(userId, peer) {
    const heroState = heroSelect.snapshotForUser(userId);
    if (heroState) {
      peer.send({ type: 'hero_select.start', heroSelect: heroState, resumed: true });
      return;
    }

    const lobby = lobbies.lobbyForUser(userId);
    if (lobby?.matchId && lobby.status === 'launching') {
      const rawMatch = store.match(lobby.matchId);
      if (rawMatch && rawMatch.status === 'launching') {
        heroSelect.begin(rawMatch);
        return;
      }
    }

    const active = activeSessionForUser(userId);
    if (!active) throw new Error('No tienes una partida activa a la que volver.');

    if (active.stage === 'in_game') {
      peer.send({ type: 'match.rejoin.ready', activeMatch: active });
      peer.send({ type: 'match.runtime.snapshot', matchId: active.match.id, states: runtimeSnapshot(active.match.id) });
      return;
    }

    peer.send({
      type: 'match.session.pending',
      match: active.match,
      note: 'Reconnecting to the active Dawnreach match.',
      resumed: true,
    });
  }

  function requireNotInLobby(userId) {
    if (lobbies.lobbyForUser(userId)) throw new Error('Sal de la sala personalizada antes de entrar en matchmaking.');
  }

  function queueParty(user, mode) {
    requireNoActiveSession(user.id);
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
          else if (type === 'match.rejoin') rejoinActiveSession(user.id, peer);
          else if (type === 'match.loading.progress') reportMatchLoadingProgress(user.id, message.progress);
          else if (type === 'match.runtime.state') reportMatchRuntimeState(user.id, message);
          else if (type === 'match.runtime.snapshot') {
            const active = store.activeMatchForUser(user.id);
            if (!active || active.status !== 'in_game') throw new Error('No tienes una partida activa.');
            peer.send({ type: 'match.runtime.snapshot', matchId: active.id, states: runtimeSnapshot(active.id) });
          }
          else if (type === 'match.abandon') abandonActiveMatch(user.id);
          else if (type === 'lobby.create') {
            requireNoActiveSession(user.id);
            leaveQueue(user);
            lobbies.create(user, String(message.name || ''), message.privacy === 'private' ? 'private' : 'public', Number(message.maxPlayers || 10));
          } else if (type === 'lobby.join') {
            leaveQueue(user);
            lobbies.join(user, String(message.code || message.lobbyId || ''));
          } else if (type === 'lobby.join.spectator') {
            leaveQueue(user);
            lobbies.joinSpectator(user, String(message.code || message.lobbyId || ''));
          } else if (type === 'lobby.move') lobbies.move(user.id, message.team === 'red' ? 'red' : 'blue', Number(message.slot));
          else if (type === 'lobby.spectate') lobbies.spectate(user.id);
          else if (type === 'lobby.ready') lobbies.setReady(user.id, Boolean(message.ready));
          else if (type === 'lobby.settings') lobbies.updateSettings(user.id, message.settings && typeof message.settings === 'object' ? message.settings : {});
          else if (type === 'lobby.message') lobbies.sendMessage(user.id, message.text, message.channel === 'team' ? 'team' : 'all');
          else if (type === 'lobby.leave') lobbies.leave(user.id);
          else if (type === 'lobby.start') lobbies.start(user.id);
          else if (type === 'lobby.list') lobbies.emitList();
          else if (type === 'hero_select.preview') heroSelect.preview(user.id, String(message.heroId || ''));
          else if (type === 'hero_select.lock') heroSelect.lock(user.id, String(message.heroId || ''));
          else if (type === 'hero_select.message') heroSelect.sendMessage(user.id, message.text);
          else if (type === 'hero_select.cancel') heroSelect.cancel(user.id);
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
        heroSelect: heroSelect.snapshotForUser(user.id),
        activeMatch: activeSessionForUser(user.id),
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

  return { config, server, store, sessions, parties, matchmaker, lobbies, heroSelect, abandonActiveMatch, reportMatchRuntimeState, runtimeSnapshot, start, close };
}
