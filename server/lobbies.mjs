import { randomToken } from './security.mjs';

const TEAM_CAPACITY = 5;
const MAX_LOBBY_MESSAGES = 100;
const MAX_LOBBY_MESSAGE_LENGTH = 300;

function copyLobby(lobby, userId = null) {
  const viewer = userId ? lobby.players.find(player => player.userId === userId) : null;
  const messages = userId
    ? lobby.messages.filter(message =>
      message.channel === 'system'
      || message.channel === 'all'
      || (message.channel === 'team' && viewer && message.team === viewer.team))
    : [];
  return {
    ...lobby,
    players: lobby.players.map(player => ({ ...player })),
    messages: messages.map(message => ({ ...message })),
  };
}

function publicMatch(match) {
  const { resultToken: _secret, ...safe } = match;
  return safe;
}

export class LobbyManager {
  constructor(options) {
    this.options = options;
    this.lobbies = new Map();
  }

  listPublic() {
    return [...this.lobbies.values()]
      .filter(lobby => lobby.status === 'open' && lobby.privacy === 'public')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(lobby => copyLobby(lobby));
  }

  lobbyForUser(userId) {
    const lobby = this.findLobbyForUser(userId);
    return lobby ? copyLobby(lobby, userId) : null;
  }

  create(owner, name, privacy = 'public', maxPlayers = 10) {
    this.leave(owner.id);
    const cleanName = String(name || '').trim().slice(0, 40) || `${owner.username} · Sala`;
    const safeMax = Math.max(2, Math.min(10, Math.round(Number(maxPlayers) || 10)));
    let code = this.code();
    while ([...this.lobbies.values()].some(lobby => lobby.code === code)) code = this.code();
    const lobby = {
      id: randomToken(8),
      code,
      name: cleanName,
      ownerId: owner.id,
      ownerUsername: owner.username,
      privacy: privacy === 'private' ? 'private' : 'public',
      maxPlayers: safeMax,
      status: 'open',
      createdAt: new Date().toISOString(),
      players: [{
        userId: owner.id,
        username: owner.username,
        rating: owner.rating,
        joinedAt: Date.now(),
        team: 'blue',
        slot: 0,
        ready: false,
      }],
      messages: [],
    };
    this.addSystemMessage(lobby, `${owner.username} opened the lobby.`);
    this.lobbies.set(lobby.id, lobby);
    this.emitLobby(lobby);
    this.emitList();
    return copyLobby(lobby, owner.id);
  }

  join(user, codeOrId) {
    const raw = String(codeOrId || '').trim();
    const key = raw.toUpperCase();
    const lobby = [...this.lobbies.values()].find(candidate => candidate.id === raw || candidate.code === key);
    if (!lobby || lobby.status !== 'open') throw new Error('La sala personalizada no está disponible.');
    if (lobby.players.length >= lobby.maxPlayers) throw new Error('La sala está completa.');
    const current = this.findLobbyForUser(user.id);
    if (current?.id === lobby.id) return copyLobby(current, user.id);
    this.leave(user.id);

    const blueCount = lobby.players.filter(player => player.team === 'blue').length;
    const redCount = lobby.players.filter(player => player.team === 'red').length;
    let team = blueCount <= redCount ? 'blue' : 'red';
    if (team === 'blue' && blueCount >= TEAM_CAPACITY) team = 'red';
    if (team === 'red' && redCount >= TEAM_CAPACITY) team = 'blue';
    const slot = this.firstFreeSlot(lobby, team);
    lobby.players.push({
      userId: user.id,
      username: user.username,
      rating: user.rating,
      joinedAt: Date.now(),
      team,
      slot,
      ready: false,
    });
    this.addSystemMessage(lobby, `${user.username} joined ${team === 'blue' ? 'Dawn' : 'Dusk'}.`);
    this.emitLobby(lobby);
    this.emitList();
    return copyLobby(lobby, user.id);
  }

  move(userId, team, slot) {
    const lobby = this.findLobbyForUser(userId);
    if (!lobby || lobby.status !== 'open') throw new Error('Solo puedes cambiar de posición antes de iniciar la partida.');
    if (!['blue', 'red'].includes(team)) throw new Error('Equipo inválido.');
    const safeSlot = Math.trunc(Number(slot));
    if (safeSlot < 0 || safeSlot >= TEAM_CAPACITY) throw new Error('Posición inválida.');
    const player = lobby.players.find(candidate => candidate.userId === userId);
    if (!player) throw new Error('No estás en esa sala.');
    if (player.team === team && player.slot === safeSlot) return copyLobby(lobby, userId);
    if (lobby.players.some(candidate => candidate.userId !== userId && candidate.team === team && candidate.slot === safeSlot)) {
      throw new Error('Esa posición ya está ocupada.');
    }
    if (lobby.players.filter(candidate => candidate.userId !== userId && candidate.team === team).length >= TEAM_CAPACITY) {
      throw new Error('Ese equipo ya tiene 5 jugadores.');
    }
    player.team = team;
    player.slot = safeSlot;
    player.ready = false;
    this.addSystemMessage(lobby, `${player.username} moved to ${team === 'blue' ? 'Dawn' : 'Dusk'} and must ready again.`);
    this.emitLobby(lobby);
    this.emitList();
    return copyLobby(lobby, userId);
  }

  setReady(userId, ready) {
    const lobby = this.findLobbyForUser(userId);
    if (!lobby || lobby.status !== 'open') throw new Error('La sala ya no acepta cambios de estado.');
    const player = lobby.players.find(candidate => candidate.userId === userId);
    if (!player) throw new Error('No estás en esa sala.');
    const nextReady = Boolean(ready);
    if (player.ready === nextReady) return copyLobby(lobby, userId);
    player.ready = nextReady;
    this.addSystemMessage(lobby, `${player.username} is ${nextReady ? 'ready' : 'not ready'}.`);
    this.emitLobby(lobby);
    this.emitList();
    return copyLobby(lobby, userId);
  }

  sendMessage(userId, text, channel = 'all') {
    const lobby = this.findLobbyForUser(userId);
    if (!lobby || lobby.status !== 'open') throw new Error('No estás en una sala personalizada abierta.');
    const player = lobby.players.find(candidate => candidate.userId === userId);
    if (!player) throw new Error('No estás en esa sala.');
    const cleanText = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LOBBY_MESSAGE_LENGTH);
    if (!cleanText) throw new Error('El mensaje está vacío.');
    const safeChannel = channel === 'team' ? 'team' : 'all';
    const message = {
      id: randomToken(8),
      lobbyId: lobby.id,
      fromUserId: player.userId,
      username: player.username,
      channel: safeChannel,
      team: safeChannel === 'team' ? player.team : null,
      text: cleanText,
      createdAt: new Date().toISOString(),
    };
    lobby.messages.push(message);
    this.trimMessages(lobby);
    this.emitLobby(lobby);
    return { ...message };
  }

  leave(userId) {
    const lobby = this.findLobbyForUser(userId);
    if (!lobby) return;
    if (lobby.status !== 'open') throw new Error('La partida de esta sala ya fue creada.');
    const leaving = lobby.players.find(player => player.userId === userId);
    lobby.players = lobby.players.filter(player => player.userId !== userId);
    this.options.onEvent({ type: 'lobby.left', lobbyId: lobby.id }, [userId]);
    if (!lobby.players.length) {
      this.lobbies.delete(lobby.id);
      this.emitList();
      return;
    }
    if (leaving) this.addSystemMessage(lobby, `${leaving.username} left the lobby.`);
    if (lobby.ownerId === userId) {
      const next = lobby.players[0];
      lobby.ownerId = next.userId;
      lobby.ownerUsername = next.username;
      next.ready = false;
      this.addSystemMessage(lobby, `${next.username} is now the host and must ready again.`);
    }
    this.emitLobby(lobby);
    this.emitList();
  }

  start(userId) {
    const lobby = [...this.lobbies.values()].find(candidate => candidate.ownerId === userId && candidate.status === 'open');
    if (!lobby) throw new Error('No tienes una sala personalizada abierta.');
    if (lobby.players.length < 2) throw new Error('Se necesitan al menos dos jugadores para iniciar la partida.');
    const blue = lobby.players.filter(player => player.team === 'blue');
    const red = lobby.players.filter(player => player.team === 'red');
    if (!blue.length || !red.length) throw new Error('Debe haber al menos un jugador en Dawn y uno en Dusk.');
    if (blue.length > TEAM_CAPACITY || red.length > TEAM_CAPACITY) throw new Error('Cada equipo admite un máximo de 5 jugadores.');
    const notReady = lobby.players.filter(player => !player.ready);
    if (notReady.length) throw new Error(`Todos los jugadores deben estar listos. Faltan: ${notReady.map(player => player.username).join(', ')}.`);

    const players = lobby.players.map(player => {
      const { ready: _ready, ...matchPlayer } = player;
      return {
        ...matchPlayer,
        slot: player.team === 'blue' ? player.slot : TEAM_CAPACITY + player.slot,
      };
    });
    const match = {
      id: randomToken(8),
      mode: 'custom',
      source: 'custom',
      lobbyId: lobby.id,
      rated: false,
      status: 'launching',
      createdAt: new Date().toISOString(),
      players,
      resultToken: randomToken(),
      mapSha256: null,
    };
    lobby.status = 'launching';
    lobby.matchId = match.id;
    this.addSystemMessage(lobby, 'All players are ready. The match is starting.');
    this.options.store.addMatch(match);
    this.emitLobby(lobby);
    this.emitList();
    this.options.onEvent({ type: 'match.found', match: publicMatch(match) }, players.map(player => player.userId));
    this.options.onLaunch(match);
    return match;
  }

  closeByMatch(matchId) {
    const lobby = [...this.lobbies.values()].find(candidate => candidate.matchId === matchId);
    if (!lobby) return;
    const participants = lobby.players.map(player => player.userId);
    this.options.onEvent({ type: 'lobby.closed', lobbyId: lobby.id, matchId }, participants);
    this.lobbies.delete(lobby.id);
    this.emitList();
  }

  findLobbyForUser(userId) {
    return [...this.lobbies.values()].find(candidate => candidate.players.some(player => player.userId === userId)) || null;
  }

  addSystemMessage(lobby, text) {
    lobby.messages.push({
      id: randomToken(8),
      lobbyId: lobby.id,
      fromUserId: null,
      username: 'SYSTEM',
      channel: 'system',
      team: null,
      text,
      createdAt: new Date().toISOString(),
    });
    this.trimMessages(lobby);
  }

  trimMessages(lobby) {
    if (lobby.messages.length > MAX_LOBBY_MESSAGES) {
      lobby.messages.splice(0, lobby.messages.length - MAX_LOBBY_MESSAGES);
    }
  }

  firstFreeSlot(lobby, team) {
    for (let slot = 0; slot < TEAM_CAPACITY; slot += 1) {
      if (!lobby.players.some(player => player.team === team && player.slot === slot)) return slot;
    }
    throw new Error('No quedan posiciones libres en ese equipo.');
  }

  emitLobby(lobby) {
    for (const player of lobby.players) {
      this.options.onEvent({ type: 'lobby.update', lobby: copyLobby(lobby, player.userId) }, [player.userId]);
    }
  }

  emitList() {
    this.options.onEvent({ type: 'lobbies.update', lobbies: this.listPublic() });
  }

  code() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  }
}
