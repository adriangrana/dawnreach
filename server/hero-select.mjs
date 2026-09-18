import { randomToken } from './security.mjs';

const DEFAULT_PICK_SECONDS = 45;
const MAX_MESSAGES = 80;
const MAX_MESSAGE_LENGTH = 240;

function localSlot(player, teamSize) {
  if (player.team === 'blue') return player.slot >= teamSize ? player.slot - teamSize : player.slot;
  return player.slot >= teamSize ? player.slot - teamSize : player.slot;
}

function laneFor(slot, teamSize) {
  const index = Math.max(0, Math.min(teamSize - 1, localSlot(slot, teamSize)));
  if (teamSize <= 1) return 'MID';
  if (teamSize === 2) return index === 0 ? 'NORTH' : 'SOUTH';
  if (teamSize === 3) return ['NORTH', 'MID', 'SOUTH'][index];
  if (teamSize === 4) return index < 2 ? 'NORTH' : 'SOUTH';
  return ['NORTH', 'NORTH', 'MID', 'SOUTH', 'SOUTH'][index] || 'MID';
}

function safeMatch(match) {
  const { resultToken: _secret, ...safe } = match;
  return safe;
}

export class HeroSelectManager {
  constructor(options) {
    this.options = options;
    this.sessions = new Map();
    this.byUser = new Map();
  }

  begin(match) {
    const teamSize = Math.max(1, Math.min(5, Number(match.customSettings?.teamSize || Math.floor(match.players.length / 2) || 5)));
    const selectionType = match.customSettings?.heroSelect === 'draft' || match.mode === 'ranked' ? 'draft' : 'all_pick';
    const bansPerTeam = match.customSettings?.bans === '4' ? 4 : match.customSettings?.bans === '2' ? 2 : 0;
    const heroIds = [...this.options.heroIds];
    const rosterDevelopmentMode = heroIds.length < teamSize;
    const session = {
      id: randomToken(8),
      match,
      matchId: match.id,
      phase: 'pick',
      selectionType,
      bansPerTeam,
      draftRulesDeferred: selectionType === 'draft' && heroIds.length < Math.max(3, teamSize),
      rosterDevelopmentMode,
      heroIds,
      teamSize,
      startedAt: Date.now(),
      expiresAt: Date.now() + (this.options.pickSeconds || DEFAULT_PICK_SECONDS) * 1000,
      selections: new Map(match.players.map(player => [player.userId, { heroId: null, locked: false, lockedAt: null }])),
      messages: [],
      completed: false,
    };

    this.sessions.set(match.id, session);
    for (const player of match.players) this.byUser.set(player.userId, match.id);
    this.emit(session, 'hero_select.start');
    return this.snapshotForMatch(match.id);
  }

  preview(userId, heroId) {
    const session = this.requireSessionForUser(userId);
    if (session.completed) return this.snapshotForUser(userId);
    if (!session.heroIds.includes(heroId)) throw new Error('Ese héroe no está disponible.');
    const selection = session.selections.get(userId);
    if (!selection || selection.locked) return this.snapshotForUser(userId);
    selection.heroId = heroId;
    this.emit(session, 'hero_select.update');
    return this.snapshotForUser(userId);
  }

  lock(userId, heroId) {
    const session = this.requireSessionForUser(userId);
    if (session.completed) return this.snapshotForUser(userId);
    if (!session.heroIds.includes(heroId)) throw new Error('Ese héroe no está disponible.');

    const selection = session.selections.get(userId);
    if (!selection) throw new Error('No participas en esta selección.');
    if (selection.locked) return this.snapshotForUser(userId);

    const player = session.match.players.find(candidate => candidate.userId === userId);
    if (!player) throw new Error('Jugador no encontrado en la partida.');

    if (!session.rosterDevelopmentMode) {
      const duplicate = session.match.players.some(candidate => {
        if (candidate.userId === userId || candidate.team !== player.team) return false;
        const other = session.selections.get(candidate.userId);
        return other?.locked && other.heroId === heroId;
      });
      if (duplicate) throw new Error('Ese héroe ya está bloqueado por tu equipo.');
    }

    selection.heroId = heroId;
    selection.locked = true;
    selection.lockedAt = Date.now();
    this.addSystem(session, player.team, `${player.username} locked ${this.options.heroNames[heroId] || heroId}.`);
    this.emit(session, 'hero_select.update');

    if ([...session.selections.values()].every(candidate => candidate.locked)) this.complete(session);
    return this.snapshotForUser(userId);
  }

  sendMessage(userId, text) {
    const session = this.requireSessionForUser(userId);
    const player = session.match.players.find(candidate => candidate.userId === userId);
    if (!player) throw new Error('No participas en esta selección.');
    const cleanText = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!cleanText) return;
    session.messages.push({
      id: randomToken(8),
      username: player.username,
      userId,
      team: player.team,
      text: cleanText,
      createdAt: new Date().toISOString(),
      system: false,
    });
    this.trimMessages(session);
    this.emit(session, 'hero_select.update');
  }

  complete(session) {
    if (session.completed) return;
    session.completed = true;
    session.phase = 'complete';
    const selections = Object.fromEntries([...session.selections.entries()].map(([userId, selection]) => [userId, { ...selection }]));
    session.match.heroSelections = selections;
    this.emit(session, 'hero_select.complete');
    this.options.onComplete(session.match, selections);
  }

  snapshotForUser(userId) {
    const matchId = this.byUser.get(userId);
    if (!matchId) return null;
    const session = this.sessions.get(matchId);
    return session ? this.publicState(session, userId) : null;
  }

  snapshotForMatch(matchId) {
    const session = this.sessions.get(matchId);
    return session ? this.publicState(session, null) : null;
  }

  requireSessionForUser(userId) {
    const matchId = this.byUser.get(userId);
    const session = matchId ? this.sessions.get(matchId) : null;
    if (!session) throw new Error('No tienes una selección de héroe activa.');
    return session;
  }

  publicState(session, viewerUserId) {
    const viewer = viewerUserId ? session.match.players.find(player => player.userId === viewerUserId) : null;
    return {
      id: session.id,
      match: safeMatch(session.match),
      phase: session.phase,
      selectionType: session.selectionType,
      bansPerTeam: session.bansPerTeam,
      draftRulesDeferred: session.draftRulesDeferred,
      rosterDevelopmentMode: session.rosterDevelopmentMode,
      teamSize: session.teamSize,
      startedAt: session.startedAt,
      expiresAt: session.expiresAt,
      availableHeroIds: [...session.heroIds],
      players: session.match.players.map(player => ({
        ...player,
        lane: laneFor(player, session.teamSize),
        selection: { ...session.selections.get(player.userId) },
      })),
      messages: viewer
        ? session.messages.filter(message => message.team === viewer.team).map(message => ({ ...message }))
        : [],
    };
  }

  addSystem(session, team, text) {
    session.messages.push({
      id: randomToken(8),
      username: 'SYSTEM',
      userId: null,
      team,
      text,
      createdAt: new Date().toISOString(),
      system: true,
    });
    this.trimMessages(session);
  }

  trimMessages(session) {
    if (session.messages.length > MAX_MESSAGES) session.messages.splice(0, session.messages.length - MAX_MESSAGES);
  }

  emit(session, type) {
    for (const player of session.match.players) {
      this.options.onEvent({ type, heroSelect: this.publicState(session, player.userId) }, [player.userId]);
    }
  }
}
