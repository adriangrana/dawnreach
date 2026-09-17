import { randomToken } from './security.mjs';

const TEAM_CAPACITY = 5;

function copyLobby(lobby) {
  return { ...lobby, players: lobby.players.map(player => ({ ...player })) };
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
      .map(copyLobby);
  }

  lobbyForUser(userId) {
    const lobby = [...this.lobbies.values()].find(candidate => candidate.players.some(player => player.userId === userId));
    return lobby ? copyLobby(lobby) : null;
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
      players: [{ userId: owner.id, username: owner.username, rating: owner.rating, joinedAt: Date.now(), team: 'blue', slot: 0 }],
    };
    this.lobbies.set(lobby.id, lobby);
    this.emitLobby(lobby);
    this.emitList();
    return copyLobby(lobby);
  }

  join(user, codeOrId) {
    const raw = String(codeOrId || '').trim();
    const key = raw.toUpperCase();
    const lobby = [...this.lobbies.values()].find(candidate => candidate.id === raw || candidate.code === key);
    if (!lobby || lobby.status !== 'open') throw new Error('La sala personalizada no está disponible.');
    if (lobby.players.length >= lobby.maxPlayers) throw new Error('La sala está completa.');
    const current = this.lobbyForUser(user.id);
    if (current?.id === lobby.id) return current;
    this.leave(user.id);

    const blueCount = lobby.players.filter(player => player.team === 'blue').length;
    const redCount = lobby.players.filter(player => player.team === 'red').length;
    let team = blueCount <= redCount ? 'blue' : 'red';
    if (team === 'blue' && blueCount >= TEAM_CAPACITY) team = 'red';
    if (team === 'red' && redCount >= TEAM_CAPACITY) team = 'blue';
    const slot = this.firstFreeSlot(lobby, team);
    lobby.players.push({ userId: user.id, username: user.username, rating: user.rating, joinedAt: Date.now(), team, slot });
    this.emitLobby(lobby);
    this.emitList();
    return copyLobby(lobby);
  }

  move(userId, team, slot) {
    const lobby = [...this.lobbies.values()].find(candidate => candidate.players.some(player => player.userId === userId));
    if (!lobby || lobby.status !== 'open') throw new Error('Solo puedes cambiar de posición antes de iniciar la partida.');
    if (!['blue', 'red'].includes(team)) throw new Error('Equipo inválido.');
    const safeSlot = Math.trunc(Number(slot));
    if (safeSlot < 0 || safeSlot >= TEAM_CAPACITY) throw new Error('Posición inválida.');
    const player = lobby.players.find(candidate => candidate.userId === userId);
    if (!player) throw new Error('No estás en esa sala.');
    if (lobby.players.some(candidate => candidate.userId !== userId && candidate.team === team && candidate.slot === safeSlot)) {
      throw new Error('Esa posición ya está ocupada.');
    }
    if (lobby.players.filter(candidate => candidate.userId !== userId && candidate.team === team).length >= TEAM_CAPACITY) {
      throw new Error('Ese equipo ya tiene 5 jugadores.');
    }
    player.team = team;
    player.slot = safeSlot;
    this.emitLobby(lobby);
    this.emitList();
    return copyLobby(lobby);
  }

  leave(userId) {
    const lobby = [...this.lobbies.values()].find(candidate => candidate.players.some(player => player.userId === userId));
    if (!lobby) return;
    if (lobby.status !== 'open') throw new Error('La partida de esta sala ya fue creada.');
    lobby.players = lobby.players.filter(player => player.userId !== userId);
    this.options.onEvent({ type: 'lobby.left', lobbyId: lobby.id }, [userId]);
    if (!lobby.players.length) {
      this.lobbies.delete(lobby.id);
      this.emitList();
      return;
    }
    if (lobby.ownerId === userId) {
      const next = lobby.players[0];
      lobby.ownerId = next.userId;
      lobby.ownerUsername = next.username;
    }
    this.emitLobby(lobby);
    this.emitList();
  }

  start(userId) {
    const lobby = [...this.lobbies.values()].find(candidate => candidate.ownerId === userId && candidate.status === 'open');
    if (!lobby) throw new Error('No tienes una sala personalizada abierta.');
    if (!lobby.players.length) throw new Error('La sala no tiene jugadores.');
    const blue = lobby.players.filter(player => player.team === 'blue');
    const red = lobby.players.filter(player => player.team === 'red');
    if (blue.length > TEAM_CAPACITY || red.length > TEAM_CAPACITY) throw new Error('Cada equipo admite un máximo de 5 jugadores.');

    const players = lobby.players.map(player => ({
      ...player,
      slot: player.team === 'blue' ? player.slot : TEAM_CAPACITY + player.slot,
    }));
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

  firstFreeSlot(lobby, team) {
    for (let slot = 0; slot < TEAM_CAPACITY; slot += 1) {
      if (!lobby.players.some(player => player.team === team && player.slot === slot)) return slot;
    }
    throw new Error('No quedan posiciones libres en ese equipo.');
  }

  emitLobby(lobby) {
    this.options.onEvent({ type: 'lobby.update', lobby: copyLobby(lobby) }, lobby.players.map(player => player.userId));
  }

  emitList() {
    this.options.onEvent({ type: 'lobbies.update', lobbies: this.listPublic() });
  }

  code() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
  }
}
