import { randomToken } from './security.mjs';

const TEAM_CAPACITY = 5;
const SPECTATOR_CAPACITY = 4;
const MAX_LOBBY_MESSAGES = 100;
const MAX_LOBBY_MESSAGE_LENGTH = 300;

const DEFAULT_SETTINGS = Object.freeze({
  map: 'dawnreach',
  gameMode: 'classic',
  teamSize: 5,
  heroSelect: 'all_pick',
  bans: 'none',
  allowSpectators: true,
  privacy: 'public',
  region: 'auto',
});

function participantIds(lobby) {
  return [
    ...lobby.players.map(player => player.userId),
    ...lobby.spectators.map(spectator => spectator.userId),
  ];
}

function viewerFor(lobby, userId) {
  if (!userId) return null;
  const player = lobby.players.find(candidate => candidate.userId === userId);
  if (player) return { kind: 'player', team: player.team };
  const spectator = lobby.spectators.find(candidate => candidate.userId === userId);
  return spectator ? { kind: 'spectator', team: null } : null;
}

function copyLobby(lobby, userId = null) {
  const viewer = viewerFor(lobby, userId);
  const messages = userId
    ? lobby.messages.filter(message =>
      message.channel === 'system'
      || message.channel === 'all'
      || (message.channel === 'team' && viewer?.kind === 'player' && message.team === viewer.team))
    : [];
  return {
    ...lobby,
    settings: { ...lobby.settings },
    players: lobby.players.map(player => ({ ...player })),
    spectators: lobby.spectators.map(spectator => ({ ...spectator })),
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
      .filter(lobby => lobby.status === 'open' && lobby.settings.privacy === 'public')
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
    const requestedTeamSize = Math.max(1, Math.min(TEAM_CAPACITY, Math.floor(safeMax / 2) || TEAM_CAPACITY));
    let code = this.code();
    while ([...this.lobbies.values()].some(lobby => lobby.code === code)) code = this.code();

    const settings = {
      ...DEFAULT_SETTINGS,
      teamSize: requestedTeamSize,
      privacy: privacy === 'private' ? 'private' : 'public',
    };
    const lobby = {
      id: randomToken(8),
      code,
      name: cleanName,
      ownerId: owner.id,
      ownerUsername: owner.username,
      privacy: settings.privacy,
      maxPlayers: settings.teamSize * 2,
      maxSpectators: SPECTATOR_CAPACITY,
      status: 'open',
      createdAt: new Date().toISOString(),
      settings,
      players: [{
        userId: owner.id,
        username: owner.username,
        rating: owner.rating,
        joinedAt: Date.now(),
        team: 'blue',
        slot: 0,
        ready: false,
      }],
      spectators: [],
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
    const current = this.findLobbyForUser(user.id);
    if (current?.id === lobby.id) return copyLobby(current, user.id);
    if (lobby.players.length >= lobby.maxPlayers) throw new Error('La sala está completa. Si el host permite espectadores, entra desde la opción Spectate.');
    this.leave(user.id);

    const blueCount = lobby.players.filter(player => player.team === 'blue').length;
    const redCount = lobby.players.filter(player => player.team === 'red').length;
    let team = blueCount <= redCount ? 'blue' : 'red';
    if (team === 'blue' && blueCount >= lobby.settings.teamSize) team = 'red';
    if (team === 'red' && redCount >= lobby.settings.teamSize) team = 'blue';
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
    if (safeSlot < 0 || safeSlot >= lobby.settings.teamSize) throw new Error('Posición inválida.');

    let player = lobby.players.find(candidate => candidate.userId === userId);
    const spectator = lobby.spectators.find(candidate => candidate.userId === userId);
    if (!player && !spectator) throw new Error('No estás en esa sala.');
    if (player?.team === team && player.slot === safeSlot) return copyLobby(lobby, userId);
    if (lobby.players.some(candidate => candidate.userId !== userId && candidate.team === team && candidate.slot === safeSlot)) {
      throw new Error('Esa posición ya está ocupada.');
    }
    if (lobby.players.filter(candidate => candidate.userId !== userId && candidate.team === team).length >= lobby.settings.teamSize) {
      throw new Error('Ese equipo está completo.');
    }

    if (spectator) {
      lobby.spectators = lobby.spectators.filter(candidate => candidate.userId !== userId);
      player = {
        userId: spectator.userId,
        username: spectator.username,
        rating: spectator.rating,
        joinedAt: spectator.joinedAt,
        team,
        slot: safeSlot,
        ready: false,
      };
      lobby.players.push(player);
    } else if (player) {
      player.team = team;
      player.slot = safeSlot;
      player.ready = false;
    }

    this.addSystemMessage(lobby, `${player.username} moved to ${team === 'blue' ? 'Dawn' : 'Dusk'} and must ready again.`);
    this.emitLobby(lobby);
    this.emitList();
    return copyLobby(lobby, userId);
  }

  spectate(userId) {
    const lobby = this.findLobbyForUser(userId);
    if (!lobby || lobby.status !== 'open') throw new Error('La sala no está disponible para espectadores.');
    if (!lobby.settings.allowSpectators) throw new Error('El host no permite espectadores.');
    if (lobby.spectators.length >= lobby.maxSpectators) throw new Error('No quedan plazas de espectador.');
    if (lobby.ownerId === userId) throw new Error('El host debe permanecer en un equipo.');

    const player = lobby.players.find(candidate => candidate.userId === userId);
    if (!player) {
      if (lobby.spectators.some(candidate => candidate.userId === userId)) return copyLobby(lobby, userId);
      throw new Error('No estás en esa sala.');
    }

    lobby.players = lobby.players.filter(candidate => candidate.userId !== userId);
    lobby.spectators.push({
      userId: player.userId,
      username: player.username,
      rating: player.rating,
      joinedAt: player.joinedAt,
    });
    this.addSystemMessage(lobby, `${player.username} is now spectating.`);
    this.emitLobby(lobby);
    this.emitList();
    return copyLobby(lobby, userId);
  }

  setReady(userId, ready) {
    const lobby = this.findLobbyForUser(userId);
    if (!lobby || lobby.status !== 'open') throw new Error('La sala ya no acepta cambios de estado.');
    const player = lobby.players.find(candidate => candidate.userId === userId);
    if (!player) throw new Error('Los espectadores no participan en Ready.');
    const nextReady = Boolean(ready);
    if (player.ready === nextReady) return copyLobby(lobby, userId);
    player.ready = nextReady;
    this.addSystemMessage(lobby, `${player.username} is ${nextReady ? 'ready' : 'not ready'}.`);
    this.emitLobby(lobby);
    this.emitList();
    return copyLobby(lobby, userId);
  }

  updateSettings(userId, patch = {}) {
    const lobby = [...this.lobbies.values()].find(candidate => candidate.ownerId === userId && candidate.status === 'open');
    if (!lobby) throw new Error('Solo el host puede cambiar los ajustes del lobby.');

    const next = { ...lobby.settings };
    let gameplayChanged = false;

    if ('teamSize' in patch) {
      const teamSize = Math.max(1, Math.min(TEAM_CAPACITY, Math.trunc(Number(patch.teamSize) || TEAM_CAPACITY)));
      const invalidPlayer = lobby.players.some(player => player.slot >= teamSize);
      const blueCount = lobby.players.filter(player => player.team === 'blue').length;
      const redCount = lobby.players.filter(player => player.team === 'red').length;
      if (invalidPlayer || blueCount > teamSize || redCount > teamSize) {
        throw new Error('No puedes reducir el tamaño mientras haya jugadores ocupando esos slots.');
      }
      if (next.teamSize !== teamSize) gameplayChanged = true;
      next.teamSize = teamSize;
    }

    if ('heroSelect' in patch) {
      const heroSelect = patch.heroSelect === 'draft' ? 'draft' : 'all_pick';
      if (next.heroSelect !== heroSelect) gameplayChanged = true;
      next.heroSelect = heroSelect;
    }

    if ('bans' in patch) {
      const bans = ['none', '2', '4'].includes(String(patch.bans)) ? String(patch.bans) : 'none';
      if (next.bans !== bans) gameplayChanged = true;
      next.bans = bans;
    }

    if ('allowSpectators' in patch) {
      const allowSpectators = Boolean(patch.allowSpectators);
      if (!allowSpectators && lobby.spectators.length) {
        throw new Error('No puedes desactivar espectadores mientras haya alguien observando.');
      }
      next.allowSpectators = allowSpectators;
    }

    if ('privacy' in patch) {
      next.privacy = patch.privacy === 'private' ? 'private' : 'public';
    }

    if ('region' in patch) {
      const region = ['auto', 'eu', 'na', 'sa'].includes(String(patch.region)) ? String(patch.region) : 'auto';
      next.region = region;
    }

    lobby.settings = next;
    lobby.privacy = next.privacy;
    lobby.maxPlayers = next.teamSize * 2;

    if (gameplayChanged) {
      for (const player of lobby.players) player.ready = false;
      this.addSystemMessage(lobby, 'Lobby rules changed. All players must ready again.');
    } else {
      this.addSystemMessage(lobby, 'Lobby settings updated.');
    }

    this.emitLobby(lobby);
    this.emitList();
    return copyLobby(lobby, userId);
  }

  sendMessage(userId, text, channel = 'all') {
    const lobby = this.findLobbyForUser(userId);
    if (!lobby || lobby.status !== 'open') throw new Error('No estás en una sala personalizada abierta.');
    const player = lobby.players.find(candidate => candidate.userId === userId);
    const spectator = lobby.spectators.find(candidate => candidate.userId === userId);
    if (!player && !spectator) throw new Error('No estás en esa sala.');

    const cleanText = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LOBBY_MESSAGE_LENGTH);
    if (!cleanText) throw new Error('El mensaje está vacío.');

    const safeChannel = channel === 'team' && player ? 'team' : 'all';
    const sender = player || spectator;
    const message = {
      id: randomToken(8),
      lobbyId: lobby.id,
      fromUserId: sender.userId,
      username: sender.username,
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

    const leavingPlayer = lobby.players.find(player => player.userId === userId);
    const leavingSpectator = lobby.spectators.find(spectator => spectator.userId === userId);
    lobby.players = lobby.players.filter(player => player.userId !== userId);
    lobby.spectators = lobby.spectators.filter(spectator => spectator.userId !== userId);
    this.options.onEvent({ type: 'lobby.left', lobbyId: lobby.id }, [userId]);

    if (!lobby.players.length && !lobby.spectators.length) {
      this.lobbies.delete(lobby.id);
      this.emitList();
      return;
    }

    const leaving = leavingPlayer || leavingSpectator;
    if (leaving) this.addSystemMessage(lobby, `${leaving.username} left the lobby.`);

    if (lobby.ownerId === userId) {
      const next = lobby.players[0];
      if (!next) {
        for (const spectator of lobby.spectators) {
          this.options.onEvent({ type: 'lobby.left', lobbyId: lobby.id }, [spectator.userId]);
        }
        this.lobbies.delete(lobby.id);
        this.emitList();
        return;
      }
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
    if (blue.length > lobby.settings.teamSize || red.length > lobby.settings.teamSize) throw new Error('Uno de los equipos supera el tamaño configurado.');

    const notReady = lobby.players.filter(player => !player.ready);
    if (notReady.length) throw new Error(`Todos los jugadores deben estar listos. Faltan: ${notReady.map(player => player.username).join(', ')}.`);

    const players = lobby.players.map(player => {
      const { ready: _ready, ...matchPlayer } = player;
      return {
        ...matchPlayer,
        slot: player.team === 'blue' ? player.slot : lobby.settings.teamSize + player.slot,
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
      customSettings: { ...lobby.settings },
    };

    lobby.status = 'launching';
    lobby.matchId = match.id;
    this.addSystemMessage(lobby, 'All players are ready. The match is starting.');
    this.options.store.addMatch(match);
    this.emitLobby(lobby);
    this.emitList();
    this.options.onEvent({ type: 'match.found', match: publicMatch(match) }, participantIds(lobby));
    this.options.onLaunch(match);
    return match;
  }

  closeByMatch(matchId) {
    const lobby = [...this.lobbies.values()].find(candidate => candidate.matchId === matchId);
    if (!lobby) return;
    const participants = participantIds(lobby);
    this.options.onEvent({ type: 'lobby.closed', lobbyId: lobby.id, matchId }, participants);
    this.lobbies.delete(lobby.id);
    this.emitList();
  }

  findLobbyForUser(userId) {
    return [...this.lobbies.values()].find(candidate =>
      candidate.players.some(player => player.userId === userId)
      || candidate.spectators.some(spectator => spectator.userId === userId)) || null;
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
    for (let slot = 0; slot < lobby.settings.teamSize; slot += 1) {
      if (!lobby.players.some(player => player.team === team && player.slot === slot)) return slot;
    }
    throw new Error('No quedan posiciones libres en ese equipo.');
  }

  emitLobby(lobby) {
    for (const userId of participantIds(lobby)) {
      this.options.onEvent({ type: 'lobby.update', lobby: copyLobby(lobby, userId) }, [userId]);
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
