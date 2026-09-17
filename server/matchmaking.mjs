import { randomToken } from './security.mjs';

export const RANKED_BASE_MMR_WINDOW = 200;
export const RANKED_MMR_EXPANSION_STEP = 100;
export const RANKED_MMR_EXPANSION_INTERVAL_MS = 45_000;
export const RANKED_MAX_MMR_WINDOW = 900;

function groupQueuePlayers(players) {
  const grouped = new Map();
  for (const player of players) {
    const key = player.partyId || `solo:${player.userId}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(player);
  }
  return [...grouped.entries()].map(([key, members]) => ({
    key,
    players: members,
    rating: members.reduce((sum, player) => sum + player.rating, 0) / members.length,
    joinedAt: Math.min(...members.map(player => player.joinedAt)),
  }));
}

export function rankedSearchWindow(joinedAt, now = Date.now()) {
  const waited = Math.max(0, now - joinedAt);
  const expansions = Math.floor(waited / RANKED_MMR_EXPANSION_INTERVAL_MS);
  return Math.min(RANKED_MAX_MMR_WINDOW, RANKED_BASE_MMR_WINDOW + expansions * RANKED_MMR_EXPANSION_STEP);
}

function nextRankedWindowExpansion(joinedAt, now) {
  const window = rankedSearchWindow(joinedAt, now);
  if (window >= RANKED_MAX_MMR_WINDOW) return undefined;
  const waited = Math.max(0, now - joinedAt);
  const expansions = Math.floor(waited / RANKED_MMR_EXPANSION_INTERVAL_MS);
  return joinedAt + (expansions + 1) * RANKED_MMR_EXPANSION_INTERVAL_MS;
}

function betterRankedSelection(candidate, current) {
  if (!current) return true;
  if (candidate.maxDistance !== current.maxDistance) return candidate.maxDistance < current.maxDistance;
  if (candidate.totalDistance !== current.totalDistance) return candidate.totalDistance < current.totalDistance;
  if (candidate.joinedAtSum !== current.joinedAtSum) return candidate.joinedAtSum < current.joinedAtSum;
  return candidate.groupIndexes.join(',') < current.groupIndexes.join(',');
}

function selectAroundAnchor(groups, anchorIndex, queueSize, now) {
  const anchor = groups[anchorIndex];
  const window = rankedSearchWindow(anchor.joinedAt, now);
  const anchorPlayers = anchor.players.length;
  if (anchorPlayers > queueSize) return null;

  const candidateIndexes = groups
    .map((group, index) => ({ group, index }))
    .filter(({ group, index }) => index !== anchorIndex && group.players.every(player => Math.abs(player.rating - anchor.rating) <= window))
    .sort((a, b) => {
      const distanceA = Math.max(...a.group.players.map(player => Math.abs(player.rating - anchor.rating)));
      const distanceB = Math.max(...b.group.players.map(player => Math.abs(player.rating - anchor.rating)));
      return distanceA - distanceB || a.group.joinedAt - b.group.joinedAt || a.group.key.localeCompare(b.group.key);
    });

  const remainingSlots = queueSize - anchorPlayers;
  const dp = new Map();
  dp.set(0, { groupIndexes: [], totalDistance: 0, maxDistance: 0, joinedAtSum: 0 });

  for (const { group, index } of candidateIndexes) {
    const groupSize = group.players.length;
    const groupDistances = group.players.map(player => Math.abs(player.rating - anchor.rating));
    const groupTotalDistance = groupDistances.reduce((sum, value) => sum + value, 0);
    const groupMaxDistance = groupDistances.length ? Math.max(...groupDistances) : 0;
    const groupJoinedAtSum = group.players.reduce((sum, player) => sum + player.joinedAt, 0);
    const snapshot = [...dp.entries()].sort((a, b) => b[0] - a[0]);

    for (const [count, partial] of snapshot) {
      const nextCount = count + groupSize;
      if (nextCount > remainingSlots) continue;
      const next = {
        groupIndexes: [...partial.groupIndexes, index],
        totalDistance: partial.totalDistance + groupTotalDistance,
        maxDistance: Math.max(partial.maxDistance, groupMaxDistance),
        joinedAtSum: partial.joinedAtSum + groupJoinedAtSum,
      };
      const current = dp.get(nextCount);
      if (betterRankedSelection(next, current)) dp.set(nextCount, next);
    }
  }

  const selected = dp.get(remainingSlots);
  if (!selected) return null;
  const anchorDistances = anchor.players.map(player => Math.abs(player.rating - anchor.rating));
  return {
    groupIndexes: [anchorIndex, ...selected.groupIndexes],
    totalDistance: selected.totalDistance + anchorDistances.reduce((sum, value) => sum + value, 0),
    maxDistance: Math.max(selected.maxDistance, ...(anchorDistances.length ? anchorDistances : [0])),
    joinedAtSum: selected.joinedAtSum + anchor.players.reduce((sum, player) => sum + player.joinedAt, 0),
  };
}

export function selectRankedMatchmakingPool(players, queueSize, now = Date.now()) {
  if (players.length < queueSize) return { players: null, nextRetryAt: undefined };
  const groups = groupQueuePlayers(players).sort((a, b) => a.joinedAt - b.joinedAt || a.key.localeCompare(b.key));
  let nextRetryAt;

  for (let anchorIndex = 0; anchorIndex < groups.length; anchorIndex += 1) {
    const anchor = groups[anchorIndex];
    const nextExpansion = nextRankedWindowExpansion(anchor.joinedAt, now);
    if (nextExpansion != null && (nextRetryAt == null || nextExpansion < nextRetryAt)) nextRetryAt = nextExpansion;
    const selected = selectAroundAnchor(groups, anchorIndex, queueSize, now);
    if (!selected) continue;
    const chosen = new Set(selected.groupIndexes);
    const pool = groups.filter((_, index) => chosen.has(index)).flatMap(group => group.players);
    if (pool.length === queueSize) return { players: pool, nextRetryAt };
  }

  return { players: null, nextRetryAt };
}

export function balanceMatchmakingTeams(players, queueSize = players.length) {
  if (queueSize < 2 || queueSize % 2 !== 0) throw new Error('El matchmaking requiere un número par de jugadores.');
  if (players.length !== queueSize) throw new Error(`Se esperaban ${queueSize} jugadores para equilibrar la partida.`);

  const capacity = queueSize / 2;
  const groups = groupQueuePlayers(players).map(group => ({
    ...group,
    rating: group.players.reduce((sum, player) => sum + player.rating, 0),
  }));
  if (groups.some(group => group.players.length > capacity)) throw new Error(`Un grupo no puede superar ${capacity} jugadores.`);

  const totalRating = players.reduce((sum, player) => sum + player.rating, 0);
  let best;
  const search = (index, redCount, redRating, redGroupIndexes) => {
    if (redCount > capacity) return;
    if (index === groups.length) {
      if (redCount !== capacity) return;
      const blueRating = totalRating - redRating;
      const difference = Math.abs(redRating - blueRating);
      if (!best || difference < best.difference || (difference === best.difference && redRating < best.redRating)) {
        best = { redGroupIndexes: [...redGroupIndexes], difference, redRating };
      }
      return;
    }

    const group = groups[index];
    const remainingPlayers = groups.slice(index + 1).reduce((sum, candidate) => sum + candidate.players.length, 0);
    if (index === 0) {
      redGroupIndexes.push(index);
      search(index + 1, redCount + group.players.length, redRating + group.rating, redGroupIndexes);
      redGroupIndexes.pop();
      return;
    }
    if (redCount + group.players.length <= capacity) {
      redGroupIndexes.push(index);
      search(index + 1, redCount + group.players.length, redRating + group.rating, redGroupIndexes);
      redGroupIndexes.pop();
    }
    if (redCount + remainingPlayers >= capacity) search(index + 1, redCount, redRating, redGroupIndexes);
  };

  search(0, 0, 0, []);
  if (!best) throw new Error('No se pudieron equilibrar los grupos en dos equipos de igual tamaño.');

  const redIndexes = new Set(best.redGroupIndexes);
  const red = groups.filter((_, index) => redIndexes.has(index)).flatMap(group => group.players);
  const blue = groups.filter((_, index) => !redIndexes.has(index)).flatMap(group => group.players);
  red.sort((a, b) => b.rating - a.rating || a.joinedAt - b.joinedAt || a.userId.localeCompare(b.userId));
  blue.sort((a, b) => b.rating - a.rating || a.joinedAt - b.joinedAt || a.userId.localeCompare(b.userId));

  return [
    ...red.map((player, index) => ({ ...player, team: 'red', slot: index })),
    ...blue.map((player, index) => ({ ...player, team: 'blue', slot: capacity + index })),
  ];
}

export class Matchmaker {
  constructor(options) {
    this.options = options;
    this.readyTimeoutMs = options.readyTimeoutSeconds * 1000;
    this.queues = new Map();
    this.pending = new Map();
    this.rankedRetryTimer = undefined;
  }

  queue(mode) {
    if (!this.queues.has(mode)) this.queues.set(mode, []);
    return this.queues.get(mode);
  }

  statusFor(userId) {
    if ([...this.pending.values()].some(item => userId in item.ready)) return 'ready';
    if ([...this.queues.values()].some(queue => queue.some(player => player.userId === userId))) return 'queue';
    return null;
  }

  join(user, mode = 'ranked') {
    this.joinMany([user], mode);
  }

  joinMany(users, mode = 'ranked', partyId) {
    const unique = users.filter((user, index, all) => all.findIndex(candidate => candidate.id === user.id) === index);
    if (!unique.length) return;
    const teamCapacity = Math.floor(this.options.queueSize / 2);
    if (partyId && unique.length > teamCapacity) throw new Error(`El grupo no puede superar ${teamCapacity} jugadores.`);
    unique.forEach(user => this.leave(user.id));
    const queue = this.queue(mode);
    const joinedAt = Date.now();
    for (const user of unique) queue.push({ userId: user.id, username: user.username, rating: user.rating, joinedAt, partyId });
    this.emitQueue(mode);
    this.drain(mode);
  }

  leave(userId) {
    for (const [mode, queue] of this.queues) {
      const next = queue.filter(player => player.userId !== userId);
      if (next.length !== queue.length) {
        this.queues.set(mode, next);
        this.emitQueue(mode);
        this.drain(mode);
      }
    }
  }

  respond(userId, readyId, accepted) {
    const pending = this.pending.get(readyId);
    if (!pending || !(userId in pending.ready)) return;
    pending.ready[userId] = accepted;
    const participants = pending.players.map(player => player.userId);
    this.options.onEvent({
      type: 'ready.progress',
      readyId,
      acceptedUserIds: Object.entries(pending.ready).filter(([, value]) => value === true).map(([id]) => id),
      declinedUserIds: Object.entries(pending.ready).filter(([, value]) => value === false).map(([id]) => id),
    }, participants);
    if (!accepted) return this.cancelReady(pending, userId);
    if (Object.values(pending.ready).every(value => value === true)) this.launch(pending);
  }

  emitQueue(mode) {
    this.options.onEvent({ type: 'queue.update', mode, count: this.queue(mode).length, target: this.options.queueSize });
  }

  clearRankedRetry() {
    if (this.rankedRetryTimer) clearTimeout(this.rankedRetryTimer);
    this.rankedRetryTimer = undefined;
  }

  scheduleRankedRetry(at) {
    this.clearRankedRetry();
    if (at == null) return;
    const delay = Math.max(1, at - Date.now() + 1);
    this.rankedRetryTimer = setTimeout(() => {
      this.rankedRetryTimer = undefined;
      this.drain('ranked');
    }, delay);
    this.rankedRetryTimer.unref?.();
  }

  drain(mode) {
    if (mode === 'normal') {
      while (this.queue(mode).length >= this.options.queueSize) this.createReadyCheck(mode, this.queue(mode).slice(0, this.options.queueSize));
      return;
    }

    this.clearRankedRetry();
    while (this.queue(mode).length >= this.options.queueSize) {
      const selection = selectRankedMatchmakingPool(this.queue(mode), this.options.queueSize, Date.now());
      if (!selection.players) {
        this.scheduleRankedRetry(selection.nextRetryAt);
        return;
      }
      this.createReadyCheck(mode, selection.players);
    }
  }

  createReadyCheck(mode, selectedPlayers) {
    const queue = this.queue(mode);
    if (selectedPlayers.length !== this.options.queueSize) return;
    const selectedIds = new Set(selectedPlayers.map(player => player.userId));
    this.queues.set(mode, queue.filter(player => !selectedIds.has(player.userId)));
    const players = [...selectedPlayers];
    const id = randomToken(8);
    const ready = Object.fromEntries(players.map(player => [player.userId, null]));
    const pending = { id, mode, players, ready, expiresAt: Date.now() + this.readyTimeoutMs };
    this.pending.set(id, pending);
    this.emitQueue(mode);
    this.options.onEvent({ type: 'ready.start', readyId: id, mode, players, expiresAt: pending.expiresAt }, players.map(player => player.userId));
    const timer = setTimeout(() => this.expire(id), this.readyTimeoutMs + 50);
    timer.unref?.();
  }

  expire(id) {
    const pending = this.pending.get(id);
    if (!pending || pending.expiresAt > Date.now()) return;
    this.cancelReady(pending, null);
  }

  cancelReady(pending, declinedUserId) {
    this.pending.delete(pending.id);
    for (const player of pending.players) {
      if (player.userId !== declinedUserId && pending.ready[player.userId] !== false) this.queue(pending.mode).push(player);
    }
    const participants = pending.players.map(player => player.userId);
    this.options.onEvent({ type: 'ready.cancelled', readyId: pending.id, declinedUserId }, participants);
    this.emitQueue(pending.mode);
    this.drain(pending.mode);
  }

  assignTeams(players) {
    return balanceMatchmakingTeams(players, this.options.queueSize);
  }

  launch(pending) {
    this.pending.delete(pending.id);
    const players = this.assignTeams([...pending.players].sort((a, b) => b.rating - a.rating));
    const match = {
      id: randomToken(8),
      mode: pending.mode,
      source: 'matchmaking',
      rated: pending.mode === 'ranked',
      status: 'launching',
      createdAt: new Date().toISOString(),
      players,
      resultToken: randomToken(),
      mapSha256: null,
    };
    this.options.store.addMatch(match);
    const { resultToken: _secret, ...safe } = match;
    this.options.onEvent({ type: 'match.found', match: safe }, players.map(player => player.userId));
    this.options.onLaunch(match);
    this.emitQueue(pending.mode);
    this.drain(pending.mode);
  }
}
