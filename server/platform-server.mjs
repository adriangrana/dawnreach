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
  const matchRuntimeCreepStates = new Map();
  const matchRuntimeStructureStates = new Map();
  const matchRuntimeCombatLocks = new Map();
  const matchRuntimeHeroDamageCredits = new Map();
  const matchRuntimeHeroAbilityStates = new Map();
  const matchRuntimePauseStates = new Map();
  const matchRuntimeSpawnPositions = new Map();
  const matchRuntimeAuthorityUsers = new Map();
  const matchRuntimeResultStats = new Map();
  const matchRuntimeGraphSamples = new Map();
  const matchRuntimeTimelineEvents = new Map();
  const matchDisconnectGraceStates = new Map();
  const HERO_KILL_CREDIT_WINDOW_MS = 10_000;
  const HERO_NAMES = Object.freeze({ H001: 'Alden' });
  const MATCH_RECONNECT_GRACE_MS = Math.max(50, Number(options.matchReconnectGraceMs) || 60_000);
  const HERO_RESPAWN_BASE_SECONDS = Number.isFinite(Number(options.heroRespawnBaseSeconds))
    ? Math.max(0.01, Number(options.heroRespawnBaseSeconds))
    : 6;
  const HERO_RESPAWN_PER_LEVEL_SECONDS = Number.isFinite(Number(options.heroRespawnPerLevelSeconds))
    ? Math.max(0, Number(options.heroRespawnPerLevelSeconds))
    : 2;
  let matchChatSequence = 0;
  let matchCombatSequence = 0;
  let shuttingDown = false;

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
    heroNames: HERO_NAMES,
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
    return room ? [...room.values()].map(state => ({
      ...state,
      position: { ...state.position },
      inventory: Array.isArray(state.inventory) ? state.inventory.map(item => ({ ...item })) : [],
    })) : [];
  }

  function resultStatsRoom(matchId) {
    let room = matchRuntimeResultStats.get(matchId);
    if (!room) {
      room = new Map();
      matchRuntimeResultStats.set(matchId, room);
    }
    return room;
  }

  function resultStatsFor(matchId, userId) {
    const room = resultStatsRoom(matchId);
    let stats = room.get(userId);
    if (!stats) {
      stats = {
        towerDamage: 0,
        buildingDamage: 0,
        towersDestroyed: 0,
        currentKillStreak: 0,
        maxKillStreak: 0,
        disconnectMs: 0,
        disconnectStartedAt: null,
      };
      room.set(userId, stats);
    }
    return stats;
  }

  function graphSamplesRoom(matchId) {
    let room = matchRuntimeGraphSamples.get(matchId);
    if (!room) {
      room = new Map();
      matchRuntimeGraphSamples.set(matchId, room);
    }
    return room;
  }

  function recordGraphSample(match, state, atMs = null) {
    if (!match || !state) return;
    const elapsedMs = atMs === null
      ? runtimeMatchElapsedMs(match, Date.now())
      : Math.max(0, Number(atMs) || 0);
    const bucketMs = atMs === null ? Math.floor(elapsedMs / 10_000) * 10_000 : elapsedMs;
    const room = graphSamplesRoom(match.id);
    const samples = room.get(state.userId) || [];
    const sample = {
      userId: state.userId,
      team: state.team,
      atMs: bucketMs,
      level: Math.max(1, Number(state.level || 1)),
      gold: Math.max(0, Number(state.gold || 0)),
      experience: Math.max(0, Number(state.experience || 0)),
      heroDamage: Math.max(0, Number(state.damageDealt || 0)),
      heroDamageTaken: Math.max(0, Number(state.damageTaken || 0)),
      healing: Math.max(0, Number(state.healingDone || 0)),
      creepKills: Math.max(0, Number(state.lastHits || 0)),
      creepDenies: Math.max(0, Number(state.denies || 0)),
    };
    if (samples.length && samples[samples.length - 1].atMs === bucketMs) samples[samples.length - 1] = sample;
    else samples.push(sample);
    room.set(state.userId, samples.slice(-720));
  }

  function graphSamplesSnapshot(matchId) {
    const room = matchRuntimeGraphSamples.get(matchId);
    if (!room) return [];
    return [...room.values()]
      .flat()
      .map(sample => ({ ...sample }))
      .sort((left, right) => left.atMs - right.atMs || left.userId.localeCompare(right.userId));
  }

  function timelineRoom(matchId) {
    let events = matchRuntimeTimelineEvents.get(matchId);
    if (!events) {
      events = [];
      matchRuntimeTimelineEvents.set(matchId, events);
    }
    return events;
  }

  function recordTimelineEvent(match, event) {
    if (!match || !event?.id) return;
    const events = timelineRoom(match.id);
    if (events.some(existing => existing.id === event.id)) return;
    events.push({
      ...event,
      atMs: Math.max(0, Number(event.atMs ?? runtimeMatchElapsedMs(match, Date.now())) || 0),
    });
    if (events.length > 2000) events.splice(0, events.length - 2000);
  }

  function timelineSnapshot(matchId) {
    return [...(matchRuntimeTimelineEvents.get(matchId) || [])]
      .map(event => ({ ...event }))
      .sort((left, right) => left.atMs - right.atMs || left.id.localeCompare(right.id));
  }

  function markResultPlayerDisconnected(matchId, userId, at = Date.now()) {
    const stats = resultStatsFor(matchId, userId);
    if (stats.disconnectStartedAt !== null) return;
    stats.disconnectStartedAt = at;
    const match = store.match(matchId);
    const player = match?.players?.find(candidate => candidate.userId === userId) || null;
    if (match && player) {
      recordTimelineEvent(match, {
        id: `disconnect:${matchId}:${userId}:${at}`,
        type: 'disconnect',
        team: player.team,
        userId,
        username: player.username,
        label: `${player.username} disconnected`,
        atMs: runtimeMatchElapsedMs(match, at),
      });
    }
  }

  function markResultPlayerConnected(matchId, userId, at = Date.now()) {
    const stats = resultStatsFor(matchId, userId);
    if (stats.disconnectStartedAt === null) return;
    stats.disconnectMs += Math.max(0, at - Number(stats.disconnectStartedAt));
    stats.disconnectStartedAt = null;
    const match = store.match(matchId);
    const player = match?.players?.find(candidate => candidate.userId === userId) || null;
    if (match && player) {
      recordTimelineEvent(match, {
        id: `reconnect:${matchId}:${userId}:${at}`,
        type: 'reconnect',
        team: player.team,
        userId,
        username: player.username,
        label: `${player.username} reconnected`,
        atMs: runtimeMatchElapsedMs(match, at),
      });
    }
  }

  function buildPostMatchReport(match, {
    winnerTeam = null,
    reason = 'completed',
    voided = false,
    endedAt = new Date().toISOString(),
  } = {}) {
    const finalStates = runtimeSnapshot(match.id);
    const finalByUserId = new Map(finalStates.map(state => [state.userId, state]));
    const structureSnapshot = runtimeStructureSnapshot(match.id);
    const creepSnapshot = runtimeCreepSnapshot(match.id);
    const startedAt = match.startedAt || null;
    const endedAtMs = Date.parse(endedAt);
    const durationMs = startedAt && Number.isFinite(endedAtMs)
      ? runtimeMatchElapsedMs(match, endedAtMs)
      : Math.max(0, endedAtMs - Date.parse(match.createdAt || endedAt));
    const durationMinutes = durationMs > 0 ? durationMs / 60_000 : 0;
    const abandoned = new Set(match.abandonedUserIds || []);

    for (const state of finalStates) recordGraphSample(match, state, durationMs);
    const graphSamples = graphSamplesSnapshot(match.id);
    const timeline = timelineSnapshot(match.id);
    if (!timeline.some(event => event.type === 'match_start')) {
      timeline.unshift({
        id: `match-start:${match.id}`,
        type: 'match_start',
        team: null,
        label: 'Match started',
        atMs: 0,
      });
    }
    timeline.push({
      id: `match-end:${match.id}`,
      type: 'match_end',
      team: voided ? null : winnerTeam,
      label: voided
        ? 'Match ended without a winner'
        : winnerTeam
          ? `${winnerTeam === 'blue' ? 'Dawn Team' : 'Dusk Team'} won the match`
          : 'Match ended',
      atMs: durationMs,
    });

    const players = match.players.map(player => {
      const state = finalByUserId.get(player.userId) || null;
      const stats = resultStatsFor(match.id, player.userId);
      const heroId = match.heroSelections?.[player.userId]?.heroId || state?.heroId || 'H001';
      const experience = Math.max(0, Number(state?.experience || 0));
      const disconnectMs = Math.max(
        0,
        Number(stats.disconnectMs || 0)
          + (stats.disconnectStartedAt !== null && Number.isFinite(endedAtMs)
            ? Math.max(0, endedAtMs - Number(stats.disconnectStartedAt))
            : 0),
      );

      return {
        userId: player.userId,
        slot: Number(player.slot || 0),
        playerName: player.username,
        team: player.team,
        heroId,
        heroName: HERO_NAMES[heroId] || heroId,
        kills: Math.max(0, Number(state?.kills || 0)),
        deaths: Math.max(0, Number(state?.deaths || 0)),
        assists: Math.max(0, Number(state?.assists || 0)),
        heroLevel: Math.max(1, Number(state?.level || 1)),
        creepKills: Math.max(0, Number(state?.lastHits || 0)),
        creepDenies: Math.max(0, Number(state?.denies || 0)),
        currentGold: Math.max(0, Number(state?.gold || 0)),
        experience,
        heroDamage: Math.max(0, Number(state?.damageDealt || 0)),
        heroDamageTaken: Math.max(0, Number(state?.damageTaken || 0)),
        towerDamage: Math.max(0, Number(stats.towerDamage || 0)),
        buildingDamage: Math.max(0, Number(stats.buildingDamage || 0)),
        healing: Math.max(0, Number(state?.healingDone || 0)),
        xpm: durationMinutes > 0 ? Math.round(experience / durationMinutes) : 0,
        towersDestroyed: Math.max(0, Number(stats.towersDestroyed || 0)),
        killStreak: Math.max(0, Number(stats.maxKillStreak || 0)),
        items: Array.isArray(state?.inventory) ? state.inventory.map(item => ({ ...item })) : [],
        leftGame: abandoned.has(player.userId),
        disconnectSeconds: Math.floor(disconnectMs / 1000),
        observedAt: endedAt,
      };
    });

    return {
      version: 3,
      matchId: match.id,
      winnerTeam: voided ? null : winnerTeam,
      reason: String(reason || (voided ? 'cancelled' : 'completed')),
      voided: Boolean(voided),
      startedAt,
      endedAt,
      durationMs,
      players,
      graphSamples,
      timeline,
      finalStates,
      structures: structureSnapshot?.structures?.map(structure => ({ ...structure })) || [],
      creeps: creepSnapshot?.creeps?.map(creep => ({
        ...creep,
        position: { ...creep.position },
      })) || [],
    };
  }

  function runtimeAuthorityUserId(match) {
    const abandoned = new Set(match?.abandonedUserIds || []);
    const eligible = [...(match?.players || [])]
      .filter(player => !abandoned.has(player.userId))
      .sort((left, right) => {
        const teamOrder = (left.team === 'blue' ? 0 : 1) - (right.team === 'blue' ? 0 : 1);
        return teamOrder || Number(left.slot || 0) - Number(right.slot || 0) || String(left.userId).localeCompare(String(right.userId));
      });
    if (!eligible.length) {
      matchRuntimeAuthorityUsers.delete(match?.id);
      return null;
    }

    const currentUserId = matchRuntimeAuthorityUsers.get(match.id) || null;
    const current = currentUserId
      ? eligible.find(player => player.userId === currentUserId) || null
      : null;
    if (current && isOnline(current.userId)) return current.userId;

    // Legacy name: this is now only a migratable simulation lease for creep/world AI.
    // Canonical HP/death/structure/combat/session state lives on the server. If the current
    // simulator disappears, migrate the lease to a connected participant; an old lobby host
    // never regains special ownership merely by reconnecting.
    const next = eligible.find(player => isOnline(player.userId)) || current || eligible[0];
    matchRuntimeAuthorityUsers.set(match.id, next.userId);
    return next.userId;
  }

  function broadcastRuntimeAuthority(match) {
    if (!match || match.status !== 'in_game') return null;
    const previous = matchRuntimeAuthorityUsers.get(match.id) || null;
    const simulationUserId = runtimeAuthorityUserId(match);
    if (simulationUserId !== previous || simulationUserId) {
      broadcast({
        type: 'match.runtime.authority',
        matchId: match.id,
        authorityUserId: null,
        simulationUserId,
      }, match.players.map(player => player.userId));
    }
    return simulationUserId;
  }

  function runtimeCombatLocks(matchId) {
    let locks = matchRuntimeCombatLocks.get(matchId);
    if (!locks) {
      locks = new Map();
      matchRuntimeCombatLocks.set(matchId, locks);
    }
    return locks;
  }

  function serverHeroRespawnSeconds(level) {
    return HERO_RESPAWN_BASE_SECONDS
      + Math.max(1, Math.floor(Number(level) || 1)) * HERO_RESPAWN_PER_LEVEL_SECONDS;
  }

  function runtimeHeroDamageCredits(matchId) {
    let credits = matchRuntimeHeroDamageCredits.get(matchId);
    if (!credits) {
      credits = new Map();
      matchRuntimeHeroDamageCredits.set(matchId, credits);
    }
    return credits;
  }

  function runtimeHeroAbilityStates(matchId) {
    let states = matchRuntimeHeroAbilityStates.get(matchId);
    if (!states) {
      states = new Map();
      matchRuntimeHeroAbilityStates.set(matchId, states);
    }
    return states;
  }

  const HERO_SERVER_COMBAT_RULES = {
    H001: {
      W: {
        durationMs: 1250,
        frontalArcDegrees: 140,
        damageReductionPercentByRank: [40, 45, 50, 55],
      },
      R: {
        delayMs: 550,
        durationMs: 6000,
        damageReductionPercentByRank: [15, 20, 24],
      },
    },
  };

  function reportMatchRuntimeAbilityCast(userId, payload) {
    const active = store.activeMatchForUser(userId);
    if (!active || active.status !== 'in_game') throw new Error('No tienes una partida activa para usar habilidades.');
    if (payload?.matchId && String(payload.matchId) !== active.id) throw new Error('La habilidad pertenece a otra partida.');

    const player = active.players.find(candidate => candidate.userId === userId);
    const runtime = runtimeRoom(active.id).get(userId) || null;
    if (!player || !runtime || runtime.alive === false || Number(runtime.currentHp || 0) <= 0) return null;

    const key = String(payload?.key || '').toUpperCase();
    if (!['Q', 'W', 'E', 'R'].includes(key)) return null;
    const learnedRank = Math.max(0, Math.floor(Number(runtime.abilityRanks?.[key] || 0)));
    const requestedRank = Math.max(0, Math.floor(Number(payload?.rank || 0)));
    const rank = Math.min(learnedRank, requestedRank);
    if (rank <= 0) return null;

    const now = Date.now();
    const heroId = active.heroSelections?.[userId]?.heroId || runtime.heroId || 'H001';
    const current = runtimeHeroAbilityStates(active.id).get(userId) || {};
    const next = { ...current, heroId, lastCastAt: now, lastCastKey: key };

    const rules = HERO_SERVER_COMBAT_RULES[heroId];
    if (key === 'W' && rules?.W) {
      next.guardRank = rank;
      next.guardUntil = now + rules.W.durationMs;
    }
    if (key === 'R' && rules?.R) {
      next.majestyRank = rank;
      next.majestyStartsAt = now + rules.R.delayMs;
      next.majestyUntil = now + rules.R.delayMs + rules.R.durationMs;
    }

    runtimeHeroAbilityStates(active.id).set(userId, next);

    // Ability mechanics stay server-authoritative, but every other client needs the accepted
    // cast as an ephemeral presentation event so it can play the caster's animation/VFX.
    // Do not echo to the source: that client already presents its cast immediately.
    broadcast({
      type: 'match.runtime.ability.cast',
      matchId: active.id,
      sourceUserId: userId,
      sourceUsername: player.username,
      sourceHeroId: heroId,
      key,
      rank,
      facingYaw: Number.isFinite(Number(runtime.yaw)) ? Number(runtime.yaw) : 0,
      at: now,
    }, active.players
      .map(candidate => candidate.userId)
      .filter(candidateUserId => candidateUserId !== userId));

    return next;
  }

  function isSourceInsideServerGuardArc(active, targetRuntime, sourceUserId, sourceEntityId, arcDegrees) {
    const sourceRuntime = sourceUserId ? runtimeRoom(active.id).get(sourceUserId) || null : null;
    let sourcePosition = sourceRuntime?.position || null;

    if (!sourcePosition && sourceEntityId?.startsWith('lane-creep:')) {
      const creep = matchRuntimeCreepStates.get(active.id)?.creeps?.find(candidate => candidate.id === sourceEntityId) || null;
      sourcePosition = creep?.position || null;
    }
    if (!sourcePosition || !targetRuntime?.position) return true;

    const dx = Number(sourcePosition.x || 0) - Number(targetRuntime.position.x || 0);
    const dz = Number(sourcePosition.z || 0) - Number(targetRuntime.position.z || 0);
    const distance = Math.hypot(dx, dz);
    if (distance <= 0.001) return true;

    const yaw = Number(targetRuntime.yaw || 0);
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const dot = Math.max(-1, Math.min(1, fx * dx / distance + fz * dz / distance));
    return Math.acos(dot) <= (Math.max(0, Number(arcDegrees) || 0) * Math.PI / 180) * 0.5;
  }

  function applyServerHeroDamageMitigation(active, targetUserId, sourceUserId, sourceEntityId, amount, now) {
    const targetRuntime = runtimeRoom(active.id).get(targetUserId) || null;
    const abilityState = runtimeHeroAbilityStates(active.id).get(targetUserId) || null;
    if (!targetRuntime || !abilityState) return Math.max(0, amount);

    const heroId = active.heroSelections?.[targetUserId]?.heroId || targetRuntime.heroId || 'H001';
    const rules = HERO_SERVER_COMBAT_RULES[heroId];
    if (!rules) return Math.max(0, amount);

    let remaining = Math.max(0, amount);
    if (
      rules.R
      && Number(abilityState.majestyStartsAt || 0) <= now
      && Number(abilityState.majestyUntil || 0) > now
      && Number(abilityState.majestyRank || 0) > 0
    ) {
      const rank = Math.min(
        rules.R.damageReductionPercentByRank.length,
        Math.max(1, Math.floor(Number(abilityState.majestyRank))),
      );
      const reduction = rules.R.damageReductionPercentByRank[rank - 1] || 0;
      remaining *= 1 - reduction / 100;
    }

    if (
      rules.W
      && Number(abilityState.guardUntil || 0) > now
      && Number(abilityState.guardRank || 0) > 0
      && isSourceInsideServerGuardArc(
        active,
        targetRuntime,
        sourceUserId,
        sourceEntityId,
        rules.W.frontalArcDegrees,
      )
    ) {
      const rank = Math.min(
        rules.W.damageReductionPercentByRank.length,
        Math.max(1, Math.floor(Number(abilityState.guardRank))),
      );
      const reduction = rules.W.damageReductionPercentByRank[rank - 1] || 0;
      remaining *= 1 - reduction / 100;
    }

    return Math.max(0, remaining);
  }

  function runtimeSpawnPositions(matchId) {
    let positions = matchRuntimeSpawnPositions.get(matchId);
    if (!positions) {
      positions = new Map();
      matchRuntimeSpawnPositions.set(matchId, positions);
    }
    return positions;
  }

  function scheduleServerHeroRespawn(matchId, userId) {
    const check = () => {
      if (shuttingDown) return;
      const match = store.match(matchId);
      if (!match || match.status !== 'in_game') return;

      const locks = runtimeCombatLocks(matchId);
      const lock = locks.get(userId) || null;
      const state = runtimeRoom(matchId).get(userId) || null;
      if (!lock?.deadUntil || !state || state.alive !== false) return;

      const now = Date.now();
      const remainingMs = Number(lock.deadUntil) - now;
      if (remainingMs > 0) {
        setTimeout(check, Math.max(1, remainingMs));
        return;
      }

      const spawn = runtimeSpawnPositions(matchId).get(userId) || state.position;
      const respawnRevision = Math.max(0, Number(state.respawnRevision || 0)) + 1;
      const respawned = {
        ...state,
        position: { ...spawn },
        moving: false,
        currentHp: Math.max(1, Number(state.maxHp) || 1),
        currentResource: Math.max(0, Number(state.maxResource) || 0),
        alive: true,
        respawnRemainingMs: 0,
        respawnDurationMs: 0,
        respawnRevision,
        sequence: Number(state.sequence || 0) + 1,
        sentAt: now,
      };
      runtimeRoom(matchId).set(userId, respawned);
      // Keep the authoritative spawn locked until the owner proves it has consumed the
      // respawn by publishing a live position near that spawn. A fixed timeout is unsafe:
      // delayed/in-flight corpse packets can arrive after it and teleport the hero back to
      // the death location.
      locks.set(userId, {
        ...lock,
        hpCeiling: respawned.currentHp,
        until: null,
        deadUntil: null,
        pendingLethal: false,
        respawnSeconds: null,
        serverResolved: true,
        respawnGuard: true,
        respawnPosition: { ...spawn },
        respawnRevision,
      });
      broadcast({
        type: 'match.runtime.state',
        matchId,
        state: respawned,
      }, match.players.map(player => player.userId));
    };

    const lock = runtimeCombatLocks(matchId).get(userId) || null;
    const delayMs = lock?.deadUntil ? Math.max(1, Number(lock.deadUntil) - Date.now()) : 1;
    setTimeout(check, delayMs);
  }

  function clearMatchDisconnectGrace(matchId) {
    const state = matchDisconnectGraceStates.get(matchId);
    if (state?.timer) clearTimeout(state.timer);
    matchDisconnectGraceStates.delete(matchId);
  }

  function clearMatchRuntime(matchId) {
    matchRuntimeStates.delete(matchId);
    matchRuntimeCreepStates.delete(matchId);
    matchRuntimeStructureStates.delete(matchId);
    matchRuntimeCombatLocks.delete(matchId);
    matchRuntimeHeroDamageCredits.delete(matchId);
    matchRuntimeHeroAbilityStates.delete(matchId);
    matchRuntimePauseStates.delete(matchId);
    matchRuntimeSpawnPositions.delete(matchId);
    matchRuntimeAuthorityUsers.delete(matchId);
    matchRuntimeResultStats.delete(matchId);
    matchRuntimeGraphSamples.delete(matchId);
    matchRuntimeTimelineEvents.delete(matchId);
    clearMatchDisconnectGrace(matchId);
  }

  function finishMatch(active, { winnerTeam = null, reason, voided = false } = {}) {
    if (!active || !['loading', 'in_game'].includes(active.status)) return active ? publicMatch(active) : null;
    const endedAt = new Date().toISOString();
    const endReason = String(reason || (voided ? 'cancelled' : 'completed'));
    const postMatchReport = buildPostMatchReport(active, {
      winnerTeam,
      reason: endReason,
      voided,
      endedAt,
    });
    const updated = store.updateMatch(active.id, {
      status: voided ? 'cancelled' : 'completed',
      endedAt,
      endReason,
      winnerTeam: voided ? null : winnerTeam,
      postMatchReport,
      ...(voided ? { rated: false } : {}),
    }) || {
      ...active,
      status: voided ? 'cancelled' : 'completed',
      endedAt,
      endReason,
      winnerTeam: voided ? null : winnerTeam,
      postMatchReport,
      ...(voided ? { rated: false } : {}),
    };

    broadcast({
      type: 'match.ended',
      match: publicMatch(updated),
      winnerTeam: voided ? null : winnerTeam,
      reason: updated.endReason,
      voided,
      durationMs: postMatchReport.durationMs,
      finalStates: postMatchReport.finalStates,
    }, active.players.map(candidate => candidate.userId));

    clearMatchRuntime(active.id);
    if (active.source === 'custom') lobbies.closeByMatch(active.id);
    return publicMatch(updated);
  }

  function matchConnectivity(match) {
    const abandoned = new Set(match?.abandonedUserIds || []);
    const activePlayers = (match?.players || []).filter(player => !abandoned.has(player.userId));
    const blue = activePlayers.filter(player => player.team === 'blue');
    const red = activePlayers.filter(player => player.team === 'red');
    return {
      blue,
      red,
      blueConnected: blue.filter(player => isOnline(player.userId)),
      redConnected: red.filter(player => isOnline(player.userId)),
    };
  }

  function broadcastMatchPlayerConnection(match, userId, connected) {
    const player = match?.players?.find(candidate => candidate.userId === userId);
    if (!player) return;
    broadcast({
      type: 'match.player.connection',
      matchId: match.id,
      userId,
      username: player.username,
      team: player.team,
      connected: Boolean(connected),
    }, match.players.map(candidate => candidate.userId));
  }

  function runtimeConnectionGraceEvent(match) {
    const connectivity = matchConnectivity(match);
    const connectedUserIds = [
      ...connectivity.blueConnected,
      ...connectivity.redConnected,
    ].map(player => player.userId);
    const connectedSet = new Set(connectedUserIds);
    const disconnectedPlayers = [
      ...connectivity.blue,
      ...connectivity.red,
    ]
      .filter(player => !connectedSet.has(player.userId))
      .map(player => ({ userId: player.userId, username: player.username, team: player.team }));
    const state = matchDisconnectGraceStates.get(match.id) || null;
    return {
      type: 'match.connection.grace',
      matchId: match.id,
      mode: state?.mode === 'team' || state?.mode === 'all' ? state.mode : 'cleared',
      team: state?.team === 'blue' || state?.team === 'red' ? state.team : null,
      deadlineAt: Number.isFinite(Number(state?.deadlineAt)) ? Number(state.deadlineAt) : null,
      connectedUserIds,
      disconnectedUserIds: disconnectedPlayers.map(player => player.userId),
      disconnectedPlayers,
    };
  }

  function evaluateMatchConnectivity(matchId) {
    const match = store.match(matchId);
    if (!match || match.status !== 'in_game' || shuttingDown) {
      clearMatchDisconnectGrace(matchId);
      return null;
    }

    const connectivity = matchConnectivity(match);
    const connectedUserIds = [
      ...connectivity.blueConnected,
      ...connectivity.redConnected,
    ].map(player => player.userId);
    const connectedSet = new Set(connectedUserIds);
    const disconnectedPlayers = [
      ...connectivity.blue,
      ...connectivity.red,
    ]
      .filter(player => !connectedSet.has(player.userId))
      .map(player => ({ userId: player.userId, username: player.username, team: player.team }));
    const disconnectedUserIds = disconnectedPlayers.map(player => player.userId);
    broadcastRuntimeAuthority(match);
    if (!connectivity.blue.length && !connectivity.red.length) {
      clearMatchDisconnectGrace(matchId);
      return finishMatch(match, { reason: 'all_players_abandoned', voided: true });
    }
    if (!connectivity.blue.length && connectivity.redConnected.length) {
      clearMatchDisconnectGrace(matchId);
      return finishMatch(match, { winnerTeam: 'red', reason: 'team_abandonment' });
    }
    if (!connectivity.red.length && connectivity.blueConnected.length) {
      clearMatchDisconnectGrace(matchId);
      return finishMatch(match, { winnerTeam: 'blue', reason: 'team_abandonment' });
    }
    // If the only non-abandoned team is itself offline, do not award an offline victory.
    // It gets the same reconnect grace; reconnecting immediately wins, while nobody returning
    // ends the orphaned match as cancelled/unrated.

    const now = Date.now();
    const previous = matchDisconnectGraceStates.get(matchId) || {};
    const state = {
      blueSince: connectivity.blueConnected.length ? null : (previous.blueSince ?? now),
      redSince: connectivity.redConnected.length ? null : (previous.redSince ?? now),
      allSince: null,
      timer: previous.timer || null,
      token: Number(previous.token || 0),
      mode: null,
      team: null,
      deadlineAt: null,
    };
    if (!connectivity.blueConnected.length && !connectivity.redConnected.length) {
      state.allSince = previous.allSince ?? now;
    }
    if (state.timer) clearTimeout(state.timer);

    let mode = null;
    let team = null;
    let deadlineAt = null;
    if (!connectivity.blueConnected.length && !connectivity.redConnected.length) {
      mode = 'all';
      deadlineAt = state.allSince + MATCH_RECONNECT_GRACE_MS;
    } else if (!connectivity.blueConnected.length) {
      mode = 'team';
      team = 'blue';
      deadlineAt = state.blueSince + MATCH_RECONNECT_GRACE_MS;
    } else if (!connectivity.redConnected.length) {
      mode = 'team';
      team = 'red';
      deadlineAt = state.redSince + MATCH_RECONNECT_GRACE_MS;
    }

    if (!mode || deadlineAt === null) {
      matchDisconnectGraceStates.delete(matchId);
      broadcast({
        type: 'match.connection.grace',
        matchId,
        mode: 'cleared',
        team: null,
        deadlineAt: null,
        connectedUserIds,
        disconnectedUserIds,
        disconnectedPlayers,
      }, match.players.map(player => player.userId));
      return null;
    }

    state.mode = mode;
    state.team = team;
    state.deadlineAt = deadlineAt;
    state.token += 1;
    const token = state.token;
    state.timer = setTimeout(() => {
      const latest = matchDisconnectGraceStates.get(matchId);
      if (!latest || latest.token !== token || shuttingDown) return;
      const current = store.match(matchId);
      if (!current || current.status !== 'in_game') {
        clearMatchDisconnectGrace(matchId);
        return;
      }
      const next = matchConnectivity(current);
      if (latest.mode === 'all') {
        if (!next.blueConnected.length && !next.redConnected.length) {
          finishMatch(current, { reason: 'all_disconnected_timeout', voided: true });
          return;
        }
      } else if (latest.team === 'blue') {
        if (!next.blueConnected.length && next.redConnected.length) {
          finishMatch(current, { winnerTeam: 'red', reason: 'team_disconnect_timeout' });
          return;
        }
      } else if (latest.team === 'red') {
        if (!next.redConnected.length && next.blueConnected.length) {
          finishMatch(current, { winnerTeam: 'blue', reason: 'team_disconnect_timeout' });
          return;
        }
      }
      evaluateMatchConnectivity(matchId);
    }, Math.max(0, deadlineAt - now));

    matchDisconnectGraceStates.set(matchId, state);
    broadcast({
      type: 'match.connection.grace',
      matchId,
      mode,
      team,
      deadlineAt,
      connectedUserIds,
      disconnectedUserIds,
      disconnectedPlayers,
    }, match.players.map(player => player.userId));
    return { mode, team, deadlineAt };
  }

  function runtimePauseState(matchId) {
    let pause = matchRuntimePauseStates.get(matchId);
    if (!pause) {
      pause = {
        type: 'match.runtime.pause',
        matchId,
        paused: false,
        pausedByUserId: null,
        pausedByUsername: null,
        revision: 0,
        changedAt: Date.now(),
        pauseStartedAt: null,
        accumulatedPauseMs: 0,
      };
      matchRuntimePauseStates.set(matchId, pause);
    }
    return pause;
  }

  function publicRuntimePauseState(matchId) {
    const pause = runtimePauseState(matchId);
    return {
      type: 'match.runtime.pause',
      matchId,
      paused: pause.paused,
      pausedByUserId: pause.pausedByUserId,
      pausedByUsername: pause.pausedByUsername ?? null,
      revision: pause.revision,
      changedAt: pause.changedAt,
      accumulatedPauseMs: pause.accumulatedPauseMs,
    };
  }

  function runtimeMatchElapsedMs(match, now = Date.now()) {
    const startedAt = Date.parse(String(match?.startedAt || ''));
    if (!Number.isFinite(startedAt)) return 0;
    const pause = runtimePauseState(match.id);
    const activePauseMs = pause.paused && pause.pauseStartedAt !== null
      ? Math.max(0, now - Number(pause.pauseStartedAt))
      : 0;
    return Math.max(
      0,
      now - startedAt - Math.max(0, Number(pause.accumulatedPauseMs || 0)) - activePauseMs,
    );
  }

  function shiftRuntimeTimersForPause(matchId, durationMs) {
    if (!(durationMs > 0)) return;

    const locks = matchRuntimeCombatLocks.get(matchId);
    if (locks) {
      for (const [entityId, lock] of locks) {
        locks.set(entityId, {
          ...lock,
          until: Number.isFinite(Number(lock.until)) ? Number(lock.until) + durationMs : lock.until,
          deadUntil: Number.isFinite(Number(lock.deadUntil)) ? Number(lock.deadUntil) + durationMs : lock.deadUntil,
        });
      }
    }

    const credits = matchRuntimeHeroDamageCredits.get(matchId);
    if (credits) {
      for (const [entityId, credit] of credits) {
        credits.set(entityId, {
          ...credit,
          at: Number(credit.at || 0) + durationMs,
        });
      }
    }

    const abilityStates = matchRuntimeHeroAbilityStates.get(matchId);
    if (abilityStates) {
      for (const [userId, abilityState] of abilityStates) {
        abilityStates.set(userId, {
          ...abilityState,
          guardUntil: Number.isFinite(Number(abilityState.guardUntil))
            ? Number(abilityState.guardUntil) + durationMs
            : abilityState.guardUntil,
          majestyStartsAt: Number.isFinite(Number(abilityState.majestyStartsAt))
            ? Number(abilityState.majestyStartsAt) + durationMs
            : abilityState.majestyStartsAt,
          majestyUntil: Number.isFinite(Number(abilityState.majestyUntil))
            ? Number(abilityState.majestyUntil) + durationMs
            : abilityState.majestyUntil,
        });
      }
    }
  }

  function reportMatchRuntimePause(userId, payload) {
    const active = store.activeMatchForUser(userId);
    if (!active || active.status !== 'in_game') throw new Error('No tienes una partida activa para pausar.');
    if (payload?.matchId && String(payload.matchId) !== active.id) throw new Error('La pausa pertenece a otra partida.');
    const player = active.players.find(candidate => candidate.userId === userId);
    if (!player) throw new Error('No participas en esta partida.');

    const requestedPaused = Boolean(payload?.paused);
    const current = runtimePauseState(active.id);
    const now = Date.now();

    if (current.paused === requestedPaused) {
      const snapshot = publicRuntimePauseState(active.id);
      send(userId, snapshot);
      return snapshot;
    }

    let accumulatedPauseMs = Number(current.accumulatedPauseMs || 0);
    if (!requestedPaused && current.pauseStartedAt !== null) {
      const pausedForMs = Math.max(0, now - Number(current.pauseStartedAt));
      accumulatedPauseMs += pausedForMs;
      shiftRuntimeTimersForPause(active.id, pausedForMs);
    }

    const next = {
      type: 'match.runtime.pause',
      matchId: active.id,
      paused: requestedPaused,
      pausedByUserId: requestedPaused ? userId : null,
      pausedByUsername: requestedPaused ? player.username : null,
      revision: Number(current.revision || 0) + 1,
      changedAt: now,
      pauseStartedAt: requestedPaused ? now : null,
      accumulatedPauseMs,
    };
    matchRuntimePauseStates.set(active.id, next);

    const event = publicRuntimePauseState(active.id);
    broadcast(event, active.players.map(candidate => candidate.userId));
    return event;
  }

  function runtimeCreepSnapshot(matchId) {
    const snapshot = matchRuntimeCreepStates.get(matchId);
    if (!snapshot) return null;
    return {
      ...snapshot,
      creeps: snapshot.creeps.map(creep => ({ ...creep, position: { ...creep.position } })),
    };
  }

  function runtimeStructureSnapshot(matchId) {
    const snapshot = matchRuntimeStructureStates.get(matchId);
    if (!snapshot) return null;
    return {
      ...snapshot,
      structures: snapshot.structures.map(structure => ({ ...structure })),
    };
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
    const clientSequence = Math.max(0, Math.floor(finite(payload?.sequence, 0)));
    const previousOwnerSequence = previous && Number.isFinite(Number(previous.ownerSequence))
      ? Number(previous.ownerSequence)
      : null;
    if (previousOwnerSequence !== null && clientSequence <= previousOwnerSequence) {
      return previous;
    }
    const reportedRespawnRevision = Math.max(
      0,
      Math.floor(finite(payload?.respawnRevision, 0)),
    );

    const reportedPosition = {
      x: clamp(position.x, -75, 75),
      y: clamp(position.y, -5, 40),
      z: clamp(position.z, -62.5, 62.5),
    };
    if (!previous && !runtimeSpawnPositions(active.id).has(userId)) {
      runtimeSpawnPositions(active.id).set(userId, { ...reportedPosition });
    }
    const sequence = Math.max(Number(previous?.sequence || 0) + 1, clientSequence);
    const now = Date.now();
    const combatLocks = runtimeCombatLocks(active.id);
    const combatLock = combatLocks.get(userId) || null;
    const inventory = Array.isArray(payload?.inventory)
      ? payload.inventory.slice(0, 7).map((item, index) => {
        const raw = item && typeof item === 'object' ? item : {};
        return {
          slot: Math.max(0, Math.min(6, Math.floor(finite(raw.slot, index)))),
          definitionId: String(raw.definitionId || '').slice(0, 64),
          displayName: String(raw.displayName || '').slice(0, 80),
          quantity: Math.max(1, Math.min(99, Math.floor(finite(raw.quantity, 1)))),
          cooldownRemainingMs: clamp(raw.cooldownRemainingMs, 0, 120000),
        };
      }).filter(item => item.definitionId)
      : (previous?.inventory || []);
    const nonNegativeCounter = (value, fallback = 0) => Math.max(0, Math.min(999999, Math.floor(finite(value, fallback))));
    const payloadRespawnRemainingMs = clamp(payload?.respawnRemainingMs, 0, 120000);
    const payloadRespawnDurationMs = clamp(payload?.respawnDurationMs, 0, 120000);
    const abilityRanks = {};
    const abilityCooldownRemainingMs = {};
    for (const key of ['Q', 'W', 'E', 'R']) {
      abilityRanks[key] = Math.max(0, Math.min(4, Math.floor(finite(payload?.abilityRanks?.[key], previous?.abilityRanks?.[key] || 0))));
      abilityCooldownRemainingMs[key] = clamp(
        payload?.abilityCooldownRemainingMs?.[key],
        0,
        120000,
      );
    }
    const requestedMaxHp = clamp(payload?.maxHp, 1, 100000);
    const requestedMaxResource = clamp(payload?.maxResource, 0, 100000);
    const rawCurrentResource = clamp(payload?.currentResource, 0, requestedMaxResource || 100000);
    const rawCurrentHp = clamp(payload?.currentHp, 0, requestedMaxHp);
    const rawAlive = payload?.alive !== false && rawCurrentHp > 0;
    let requestedCurrentHp = rawCurrentHp;
    let requestedCurrentResource = rawCurrentResource;
    let requestedAlive = rawAlive;
    let serverRespawned = false;
    let authoritativeRespawnRevision = Math.max(0, Number(previous?.respawnRevision || 0));
    const respawnGuardPosition = combatLock?.respawnGuard
      ? (combatLock.respawnPosition
        || previous?.position
        || runtimeSpawnPositions(active.id).get(userId)
        || null)
      : null;
    const respawnGuardAcked = Boolean(
      combatLock?.respawnGuard
      && previous?.alive !== false
      && rawAlive
      && respawnGuardPosition
      && reportedRespawnRevision === Math.max(0, Number(combatLock.respawnRevision || 0))
      && (
        (reportedPosition.x - Number(respawnGuardPosition.x || 0)) ** 2
        + (reportedPosition.z - Number(respawnGuardPosition.z || 0)) ** 2
      ) <= 2.5 ** 2
    );
    let deathIncrement = 0;
    let creditedKillerState = null;
    let confirmedHeroKillEvent = null;

    if (combatLock?.deadUntil && now < combatLock.deadUntil) {
      requestedCurrentHp = 0;
      requestedAlive = false;
    } else if (
      combatLock?.deadUntil
      && now >= combatLock.deadUntil
      && previous
      && previous.alive === false
    ) {
      // Respawn is server-owned. Never let a stale client packet resurrect the hero at the
      // death location with its pre-death HP; the server explicitly restores full resources
      // and the captured team/slot spawn position when the death lock expires.
      serverRespawned = true;
      authoritativeRespawnRevision += 1;
      requestedCurrentHp = requestedMaxHp;
      requestedCurrentResource = requestedMaxResource;
      requestedAlive = true;
      combatLocks.delete(userId);
    } else if (combatLock?.respawnGuard && previous?.alive !== false) {
      if (respawnGuardAcked) {
        // The owner has now observed the authoritative respawn and is publishing from the
        // spawn area. Normal movement proposals may resume from this packet onward.
        combatLocks.delete(userId);
      } else {
        // Stale corpse/death-position packets remain invalid for as long as necessary.
        requestedCurrentHp = Math.max(1, Number(previous?.currentHp ?? combatLock.hpCeiling ?? requestedMaxHp));
        requestedCurrentResource = Math.max(0, Number(previous?.currentResource ?? requestedMaxResource));
        requestedAlive = true;
      }
    } else if (combatLock?.until && now < combatLock.until) {
      // Canonical combat has already committed HP/death on the server. Periodic owner
      // snapshots are movement/resource proposals only during this reconciliation window.
      // Never let them restore pre-hit HP or resurrect the hero.
      requestedCurrentHp = Math.max(0, Number(previous?.currentHp ?? combatLock.hpCeiling ?? 0));
      requestedAlive = previous?.alive !== false && requestedCurrentHp > 0;
    } else if (combatLock) {
      combatLocks.delete(userId);
    }

    // A hero can die from a world source (lane creeps, towers, jungle, etc.) without there
    // being a hero-vs-hero combat lock. The owner still publishes the authoritative
    // alive -> dead transition, so account that transition exactly once here.
    const transitionedToDead = Boolean(
      previous
      && previous.alive !== false
      && Number(previous.currentHp || 0) > 0
      && !requestedAlive,
    );
    if (transitionedToDead && deathIncrement === 0) {
      deathIncrement = 1;
      const fallbackRespawnSeconds = Math.max(
        0,
        payloadRespawnDurationMs > 0
          ? payloadRespawnDurationMs / 1000
          : serverHeroRespawnSeconds(previous?.level || payload?.level || 1),
      );

      const existingDeathLock = combatLocks.get(userId) || null;
      combatLocks.set(userId, {
        ...(existingDeathLock || {}),
        preDamageHp: Number(previous.currentHp || 0),
        hpCeiling: 0,
        until: now + fallbackRespawnSeconds * 1000,
        deadUntil: now + fallbackRespawnSeconds * 1000,
        pendingLethal: true,
        deathAccounted: true,
        respawnSeconds: fallbackRespawnSeconds,
        sourceUserId: existingDeathLock?.sourceUserId ?? null,
        sourceEntityId: existingDeathLock?.sourceEntityId ?? null,
      });
      scheduleServerHeroRespawn(active.id, userId);

      const damageCredits = runtimeHeroDamageCredits(active.id);
      const recentCredit = damageCredits.get(userId) || null;
      const killerPlayer = recentCredit
        && now - Number(recentCredit.at || 0) <= HERO_KILL_CREDIT_WINDOW_MS
        ? active.players.find(candidate =>
          candidate.userId === recentCredit.sourceUserId
          && candidate.team !== player.team
        ) ?? null
        : null;

      if (killerPlayer) {
        const killerRuntime = runtimeRoom(active.id).get(killerPlayer.userId);
        if (killerRuntime) {
          creditedKillerState = {
            ...killerRuntime,
            kills: Number(killerRuntime.kills || 0) + 1,
            sequence: killerRuntime.sequence + 1,
            sentAt: now,
          };
          runtimeRoom(active.id).set(killerPlayer.userId, creditedKillerState);
        }
      }

      damageCredits.delete(userId);
      const nextDeaths = Number(previous?.deaths || 0) + 1;
      confirmedHeroKillEvent = {
        type: 'match.runtime.hero.kill',
        matchId: active.id,
        eventId: `hero-kill:${active.id}:${userId}:${nextDeaths}`,
        victimUserId: userId,
        victimUsername: player.username,
        victimTeam: player.team,
        victimHeroId: active.heroSelections?.[userId]?.heroId || 'H001',
        killerUserId: killerPlayer?.userId ?? null,
        killerUsername: killerPlayer?.username ?? null,
        killerTeam: killerPlayer?.team ?? 'neutral',
        killerHeroId: killerPlayer
          ? (active.heroSelections?.[killerPlayer.userId]?.heroId || 'H001')
          : null,
        killerEntityId: killerPlayer
          ? `player:${killerPlayer.userId}:hero`
          : null,
        at: now,
      };
    }

    const effectiveCombatLock = combatLocks.get(userId) || null;
    const respawnGuardActive = Boolean(
      effectiveCombatLock?.respawnGuard
      && previous?.alive !== false,
    );
    const authoritativeRespawnRemainingMs = requestedAlive
      ? 0
      : effectiveCombatLock?.deadUntil && now < effectiveCombatLock.deadUntil
        ? Math.max(0, effectiveCombatLock.deadUntil - now)
        : payloadRespawnRemainingMs;
    const authoritativeRespawnDurationMs = requestedAlive
      ? 0
      : Math.max(
        authoritativeRespawnRemainingMs,
        effectiveCombatLock?.respawnSeconds
          ? Math.max(0, Number(effectiveCombatLock.respawnSeconds) * 1000)
          : payloadRespawnDurationMs,
      );

    const state = {
      userId,
      username: player.username,
      team: player.team,
      slot: player.slot,
      heroId: active.heroSelections?.[userId]?.heroId || 'H001',
      sequence,
      ownerSequence: clientSequence,
      respawnRevision: authoritativeRespawnRevision,
      position: serverRespawned
        ? { ...(runtimeSpawnPositions(active.id).get(userId) || reportedPosition) }
        : respawnGuardActive && previous
          ? { ...previous.position }
          : reportedPosition,
      yaw: respawnGuardActive && previous
        ? previous.yaw
        : clamp(payload?.yaw, -Math.PI * 8, Math.PI * 8),
      moving: serverRespawned || respawnGuardActive ? false : Boolean(payload?.moving),
      currentHp: requestedCurrentHp,
      maxHp: requestedMaxHp,
      currentResource: requestedCurrentResource,
      maxResource: requestedMaxResource,
      level: Math.max(1, Math.min(99, Math.floor(finite(payload?.level, previous?.level || 1)))),
      experience: Math.max(0, Math.min(1000000000, finite(payload?.experience, previous?.experience || 0))),
      alive: requestedAlive,
      respawnRemainingMs: authoritativeRespawnRemainingMs,
      respawnDurationMs: authoritativeRespawnDurationMs,
      abilityRanks,
      abilityCooldownRemainingMs,
      // Kills/deaths are server-owned. A client may report them for backwards compatibility,
      // but once a runtime row exists it cannot overwrite authoritative combat accounting.
      kills: previous ? previous.kills : 0,
      deaths: (previous ? previous.deaths : 0) + deathIncrement,
      assists: previous ? nonNegativeCounter(payload?.assists, previous.assists) : 0,
      lastHits: previous ? nonNegativeCounter(previous.lastHits, 0) : 0,
      denies: previous ? nonNegativeCounter(previous.denies, 0) : 0,
      gold: nonNegativeCounter(payload?.gold, previous?.gold),
      damageDealt: Math.max(0, Number(previous?.damageDealt || 0)),
      damageTaken: Math.max(0, Number(previous?.damageTaken || 0)),
      healingDone: Math.max(0, Number(previous?.healingDone || 0)),
      inventory,
      sentAt: now,
    };

    runtimeRoom(active.id).set(userId, state);
    recordGraphSample(active, state);
    if (previous && Number(state.level || 1) > Number(previous.level || 1)) {
      recordTimelineEvent(active, {
        id: `level-up:${active.id}:${userId}:${state.level}`,
        type: 'level_up',
        team: player.team,
        userId,
        username: player.username,
        level: state.level,
        label: `${player.username} reached level ${state.level}`,
        atMs: runtimeMatchElapsedMs(active, now),
      });
    }
    if (serverRespawned) {
      combatLocks.set(userId, {
        ...(combatLock || {}),
        hpCeiling: state.currentHp,
        until: null,
        deadUntil: null,
        pendingLethal: false,
        respawnSeconds: null,
        serverResolved: true,
        respawnGuard: true,
        respawnPosition: { ...state.position },
        respawnRevision: state.respawnRevision,
      });
    }
    const recipients = active.players.map(candidate => candidate.userId);
    // This is the owner's high-frequency proposal stream. Echoing it back to the same
    // client races with local HP/mana regeneration: by the time an older echo arrives,
    // the owner has already regenerated further and the HUD visibly oscillates backward.
    //
    // Other players still need the state, while authoritative corrections for the owner
    // are delivered by the dedicated combat/respawn flows and by explicit runtime snapshot
    // hydration on (re)join. Therefore never reflect an ordinary periodic proposal back
    // to its source.
    broadcast({
      type: 'match.runtime.state',
      matchId: active.id,
      state,
    }, (serverRespawned || deathIncrement > 0)
      ? recipients
      : recipients.filter(recipientUserId => recipientUserId !== userId));
    if (creditedKillerState) {
      broadcast({
        type: 'match.runtime.state',
        matchId: active.id,
        state: creditedKillerState,
      }, recipients);
    }
    if (confirmedHeroKillEvent) {
      recordTimelineEvent(active, {
        id: confirmedHeroKillEvent.eventId,
        type: 'hero_kill',
        team: confirmedHeroKillEvent.killerTeam === 'blue' || confirmedHeroKillEvent.killerTeam === 'red'
          ? confirmedHeroKillEvent.killerTeam
          : null,
        userId: confirmedHeroKillEvent.killerUserId,
        username: confirmedHeroKillEvent.killerUsername,
        targetUserId: confirmedHeroKillEvent.victimUserId,
        targetUsername: confirmedHeroKillEvent.victimUsername,
        label: confirmedHeroKillEvent.killerUsername
          ? `${confirmedHeroKillEvent.killerUsername} killed ${confirmedHeroKillEvent.victimUsername}`
          : `${confirmedHeroKillEvent.victimUsername} died`,
        atMs: runtimeMatchElapsedMs(active, confirmedHeroKillEvent.at),
      });
      broadcast(confirmedHeroKillEvent, recipients);
    }
    return state;
  }

  function reportMatchRuntimeCombat(userId, payload) {
    const active = store.activeMatchForUser(userId);
    if (!active || active.status !== 'in_game') throw new Error('No tienes una partida activa para combatir.');
    if (payload?.matchId && String(payload.matchId) !== active.id) throw new Error('El evento pertenece a otra partida.');

    const reporter = active.players.find(candidate => candidate.userId === userId);
    const targetUserId = String(payload?.targetUserId || '');
    const target = active.players.find(candidate => candidate.userId === targetUserId);
    if (!reporter || !target) throw new Error('Objetivo de combate inválido.');

    const reason = payload?.reason === 'heal' ? 'heal' : 'damage';
    const requestedSourceEntityId = String(payload?.sourceEntityId || '');
    const simulatorUserId = runtimeAuthorityUserId(active);
    const creepSourceMatch = /^lane-creep:(blue|red):(top|mid|bot):\d+:\d+$/.exec(requestedSourceEntityId);
    const towerSourceMatch = /^(blue|red)-[a-z0-9-]+-tower$/.exec(requestedSourceEntityId);
    const serverAcceptedCreepSource = Boolean(
      simulatorUserId
      && userId === simulatorUserId
      && creepSourceMatch,
    );
    const serverAcceptedTowerSource = Boolean(
      reporter.userId === target.userId
      && towerSourceMatch,
    );
    const environmentSource = serverAcceptedCreepSource || serverAcceptedTowerSource;
    if (!environmentSource && reporter.userId === target.userId) {
      throw new Error('Objetivo de combate inválido.');
    }

    const sourceEntityId = environmentSource
      ? requestedSourceEntityId
      : `player:${reporter.userId}:hero`;

    if (reason === 'damage') {
      if (environmentSource) {
        const environmentTeam = creepSourceMatch?.[1] || towerSourceMatch?.[1] || null;
        if (!environmentTeam || environmentTeam === target.team) {
          throw new Error('No se permite daño aliado de fuentes del mundo.');
        }
      } else if (reporter.team === target.team) {
        throw new Error('No se permite daño aliado entre héroes.');
      }
    }

    const requestedAmount = Math.max(0, Math.min(10000, Number(payload?.amount) || 0));
    if (requestedAmount <= 0) return null;

    const room = runtimeRoom(active.id);
    const reporterRuntime = room.get(reporter.userId) || null;
    const targetRuntime = room.get(target.userId) || null;
    if (!targetRuntime || targetRuntime.alive === false || Number(targetRuntime.currentHp || 0) <= 0) return null;
    if (
      reason === 'damage'
      && !environmentSource
      && (!reporterRuntime || reporterRuntime.alive === false || Number(reporterRuntime.currentHp || 0) <= 0)
    ) {
      // Combat is serialized by the server. Once a hero is canonically dead, late/stale
      // client attack packets from that hero cannot kill someone after death.
      return null;
    }

    const now = Date.now();
    matchCombatSequence += 1;
    const combatId = `${active.id}:${target.userId}:${now}:${matchCombatSequence}`;

    const finalDamage = reason === 'damage'
      ? applyServerHeroDamageMitigation(
        active,
        target.userId,
        environmentSource ? null : reporter.userId,
        sourceEntityId,
        requestedAmount,
        now,
      )
      : 0;

    const nextHp = reason === 'heal'
      ? Math.min(Number(targetRuntime.maxHp || 1), Number(targetRuntime.currentHp || 0) + requestedAmount)
      : Math.max(0, Number(targetRuntime.currentHp || 0) - finalDamage);
    const resolvedHealing = reason === 'heal'
      ? Math.max(0, nextHp - Number(targetRuntime.currentHp || 0))
      : 0;

    let reporterStatState = null;
    if (!environmentSource && reporterRuntime) {
      reporterStatState = {
        ...reporterRuntime,
        damageDealt: Math.max(0, Number(reporterRuntime.damageDealt || 0))
          + (reason === 'damage' ? finalDamage : 0),
        healingDone: Math.max(0, Number(reporterRuntime.healingDone || 0)) + resolvedHealing,
        sequence: Number(reporterRuntime.sequence || 0) + 1,
        sentAt: now,
      };
      room.set(reporter.userId, reporterStatState);
    }
    const lethal = reason === 'damage' && nextHp <= 0;
    const respawnSeconds = lethal
      ? serverHeroRespawnSeconds(targetRuntime.level)
      : null;

    if (
      reason === 'damage'
      && !environmentSource
      && reporter.userId !== target.userId
      && reporter.team !== target.team
    ) {
      runtimeHeroDamageCredits(active.id).set(target.userId, {
        sourceUserId: reporter.userId,
        at: now,
      });
    }

    let killerPlayer = null;
    let creditedKillerState = null;
    let confirmedHeroKillEvent = null;

    if (lethal) {
      const victimResultStats = resultStatsFor(active.id, target.userId);
      victimResultStats.currentKillStreak = 0;

      const directHeroKiller = !environmentSource
        ? reporter
        : null;
      const recentCredit = runtimeHeroDamageCredits(active.id).get(target.userId) || null;
      const recentCreditedPlayer = recentCredit
        && now - Number(recentCredit.at || 0) <= HERO_KILL_CREDIT_WINDOW_MS
        ? active.players.find(candidate =>
          candidate.userId === recentCredit.sourceUserId
          && candidate.team !== target.team
        ) ?? null
        : null;
      killerPlayer = directHeroKiller || recentCreditedPlayer;

      if (killerPlayer) {
        const killerResultStats = resultStatsFor(active.id, killerPlayer.userId);
        killerResultStats.currentKillStreak = Math.max(0, Number(killerResultStats.currentKillStreak || 0)) + 1;
        killerResultStats.maxKillStreak = Math.max(
          Number(killerResultStats.maxKillStreak || 0),
          killerResultStats.currentKillStreak,
        );

        const killerRuntime = room.get(killerPlayer.userId) || null;
        if (killerRuntime) {
          creditedKillerState = {
            ...killerRuntime,
            kills: Number(killerRuntime.kills || 0) + 1,
            sequence: Number(killerRuntime.sequence || 0) + 1,
            sentAt: now,
          };
          room.set(killerPlayer.userId, creditedKillerState);
          if (reporterStatState?.userId === killerPlayer.userId) reporterStatState = creditedKillerState;
        }
      }
      runtimeHeroDamageCredits(active.id).delete(target.userId);

      const nextDeaths = Number(targetRuntime.deaths || 0) + 1;
      confirmedHeroKillEvent = {
        type: 'match.runtime.hero.kill',
        matchId: active.id,
        eventId: `hero-kill:${active.id}:${target.userId}:${nextDeaths}`,
        victimUserId: target.userId,
        victimUsername: target.username,
        victimTeam: target.team,
        victimHeroId: active.heroSelections?.[target.userId]?.heroId || 'H001',
        killerUserId: killerPlayer?.userId ?? null,
        killerUsername: killerPlayer?.username ?? null,
        killerTeam: killerPlayer?.team
          ?? (creepSourceMatch?.[1] === 'red' || towerSourceMatch?.[1] === 'red'
            ? 'red'
            : creepSourceMatch?.[1] === 'blue' || towerSourceMatch?.[1] === 'blue'
              ? 'blue'
              : 'neutral'),
        killerHeroId: killerPlayer
          ? (active.heroSelections?.[killerPlayer.userId]?.heroId || 'H001')
          : null,
        killerEntityId: killerPlayer
          ? `player:${killerPlayer.userId}:hero`
          : sourceEntityId || null,
        at: now,
      };
    }

    const targetState = {
      ...targetRuntime,
      currentHp: nextHp,
      alive: nextHp > 0,
      moving: nextHp > 0 ? Boolean(targetRuntime.moving) : false,
      damageTaken: Math.max(0, Number(targetRuntime.damageTaken || 0))
        + (reason === 'damage' ? finalDamage : 0),
      deaths: Number(targetRuntime.deaths || 0) + (lethal ? 1 : 0),
      respawnRemainingMs: lethal ? respawnSeconds * 1000 : 0,
      respawnDurationMs: lethal ? respawnSeconds * 1000 : 0,
      sequence: Number(targetRuntime.sequence || 0) + 1,
      sentAt: now,
    };
    room.set(target.userId, targetState);

    const locks = runtimeCombatLocks(active.id);
    if (reason === 'damage') {
      locks.set(target.userId, {
        combatId,
        preDamageHp: Number(targetRuntime.currentHp || 0),
        hpCeiling: nextHp,
        until: lethal ? now + respawnSeconds * 1000 : now + 1200,
        deadUntil: lethal ? now + respawnSeconds * 1000 : null,
        pendingLethal: lethal,
        deathAccounted: lethal,
        respawnSeconds,
        sourceUserId: environmentSource ? null : reporter.userId,
        sourceEntityId,
        serverResolved: true,
      });
      if (lethal) scheduleServerHeroRespawn(active.id, target.userId);
    }

    const event = {
      type: 'match.runtime.combat',
      matchId: active.id,
      sourceUserId: reporter.userId,
      sourceUsername: reporter.username,
      sourceEntityId,
      combatId,
      targetUserId: target.userId,
      targetUsername: target.username,
      reason,
      amount: requestedAmount,
      resolvedAmount: reason === 'damage' ? finalDamage : requestedAmount,
      lethal,
      respawnSeconds,
      at: now,
    };

    const recipients = active.players.map(candidate => candidate.userId);

    // Presentation first, canonical state immediately after. WebSocket ordering guarantees
    // the victim can play its local hit/guard feedback before the authoritative state
    // reconciles HP; this prevents both double-hit flicker and stale client resurrection.
    broadcast(event, [...new Set([reporter.userId, target.userId])]);
    broadcast({
      type: 'match.runtime.state',
      matchId: active.id,
      state: targetState,
    }, recipients);
    const reporterBroadcastState = creditedKillerState || reporterStatState;
    if (reporterBroadcastState && reporterBroadcastState.userId !== target.userId) {
      broadcast({
        type: 'match.runtime.state',
        matchId: active.id,
        state: reporterBroadcastState,
      }, recipients);
    }
    if (confirmedHeroKillEvent) {
      recordTimelineEvent(active, {
        id: confirmedHeroKillEvent.eventId,
        type: 'hero_kill',
        team: confirmedHeroKillEvent.killerTeam === 'blue' || confirmedHeroKillEvent.killerTeam === 'red'
          ? confirmedHeroKillEvent.killerTeam
          : null,
        userId: confirmedHeroKillEvent.killerUserId,
        username: confirmedHeroKillEvent.killerUsername,
        targetUserId: confirmedHeroKillEvent.victimUserId,
        targetUsername: confirmedHeroKillEvent.victimUsername,
        label: confirmedHeroKillEvent.killerUsername
          ? `${confirmedHeroKillEvent.killerUsername} killed ${confirmedHeroKillEvent.victimUsername}`
          : `${confirmedHeroKillEvent.victimUsername} died`,
        atMs: runtimeMatchElapsedMs(active, confirmedHeroKillEvent.at),
      });
      broadcast(confirmedHeroKillEvent, recipients);
    }
    return event;
  }

  function reportMatchRuntimeCombatResolve(userId, payload) {
    const active = store.activeMatchForUser(userId);
    if (!active || active.status !== 'in_game') throw new Error('No tienes una partida activa para resolver combate.');
    if (payload?.matchId && String(payload.matchId) !== active.id) throw new Error('La resolución pertenece a otra partida.');

    // Backwards-compatible no-op. Hero HP/death is now server-canonical in
    // reportMatchRuntimeCombat; an old client response must never overwrite it.
    return runtimeRoom(active.id).get(userId) || null;
  }

  function reportMatchRuntimeCreeps(userId, payload) {
    const active = store.activeMatchForUser(userId);
    if (!active || active.status !== 'in_game') throw new Error('No tienes una partida activa para sincronizar creeps.');
    if (payload?.matchId && String(payload.matchId) !== active.id) throw new Error('La oleada pertenece a otra partida.');
    const authorityUserId = runtimeAuthorityUserId(active);
    if (!authorityUserId || userId !== authorityUserId) throw new Error('Solo el simulador asignado puede proponer el estado de creeps.');

    const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value)));
    const previous = matchRuntimeCreepStates.get(active.id);
    const previousById = new Map((previous?.creeps || []).map(creep => [creep.id, creep]));
    // Sequence belongs to the server. The selected client is a simulation producer only;
    // it can never move the canonical snapshot sequence backwards/forwards on its own.
    const sequence = Number(previous?.sequence || 0) + 1;
    const allowedLanes = new Set(['top', 'mid', 'bot']);
    const allowedTypes = new Set(['melee', 'ranged', 'flagbearer', 'siege']);
    const allowedStates = new Set(['ATTACK_MOVE', 'COMBAT', 'AGGRO', 'RETURNING']);
    const creeps = (Array.isArray(payload?.creeps) ? payload.creeps : []).slice(0, 240).flatMap(raw => {
      if (!raw || typeof raw !== 'object') return [];
      const id = String(raw.id || '');
      const team = raw.team === 'red' ? 'red' : raw.team === 'blue' ? 'blue' : null;
      const lane = String(raw.lane || '');
      const type = String(raw.type || '');
      const state = String(raw.state || '');
      if (!/^lane-creep:(blue|red):(top|mid|bot):\d+:\d+$/.test(id) || !team || !allowedLanes.has(lane) || !allowedTypes.has(type) || !allowedStates.has(state)) return [];
      const position = raw.position && typeof raw.position === 'object' ? raw.position : {};
      const prior = previousById.get(id) || null;
      const incomingMaxHp = clamp(raw.maxHp, 1, 100000);
      const maxHp = prior ? Math.max(1, Number(prior.maxHp) || incomingMaxHp) : incomingMaxHp;
      const incomingHp = clamp(raw.currentHp, 0, maxHp);
      // Creeps have no healing mechanic. Server-applied damage/death is irreversible for the
      // same creep id, so a stale simulator proposal cannot heal or resurrect it.
      const currentHp = prior
        ? Math.min(Math.max(0, Number(prior.currentHp) || 0), incomingHp)
        : incomingHp;
      const alive = (prior?.alive !== false) && raw.alive !== false && currentHp > 0;
      return [{
        id,
        team,
        lane,
        type,
        position: {
          x: clamp(position.x, -75, 75),
          y: clamp(position.y, -5, 40),
          z: clamp(position.z, -62.5, 62.5),
        },
        yaw: clamp(raw.yaw, -Math.PI * 8, Math.PI * 8),
        currentHp: alive ? currentHp : 0,
        maxHp,
        alive,
        state,
        moving: alive && Boolean(raw.moving),
        seed: Math.max(0, Math.min(1000000, Math.floor(finite(raw.seed, 0)))),
        attackSequence: Math.max(
          Number(prior?.attackSequence || 0),
          Math.max(0, Math.min(1000000000, Math.floor(finite(raw.attackSequence, 0)))),
        ),
      }];
    });

    const snapshot = {
      type: 'match.runtime.creeps',
      matchId: active.id,
      authorityUserId: null,
      simulationUserId: authorityUserId,
      sequence,
      sentAt: Date.now(),
      elapsedSeconds: Math.max(
        Number(previous?.elapsedSeconds || 0),
        runtimeMatchElapsedMs(active, Date.now()) / 1000,
      ),
      creeps,
    };
    matchRuntimeCreepStates.set(active.id, snapshot);
    broadcast(snapshot, active.players.map(candidate => candidate.userId));
    return snapshot;
  }

  function reportMatchRuntimeCreepDamage(userId, payload) {
    const active = store.activeMatchForUser(userId);
    if (!active || active.status !== 'in_game') throw new Error('No tienes una partida activa para combatir creeps.');
    if (payload?.matchId && String(payload.matchId) !== active.id) throw new Error('El daño pertenece a otra partida.');

    const source = active.players.find(candidate => candidate.userId === userId);
    if (!source) throw new Error('No participas en esta partida.');

    const creepId = String(payload?.creepId || '');
    const idMatch = /^lane-creep:(blue|red):(top|mid|bot):\d+:\d+$/.exec(creepId);
    if (!idMatch) throw new Error('Creep de destino inválido.');

    const amount = Math.max(0, Math.min(10000, Number(payload?.amount) || 0));
    if (amount <= 0) return null;

    const previous = matchRuntimeCreepStates.get(active.id);
    const target = previous?.creeps?.find(creep => creep.id === creepId) || null;
    if (!previous || !target || target.alive === false || Number(target.currentHp || 0) <= 0) return null;

    const alliedTarget = idMatch[1] === source.team;
    const targetHpFraction = Number(target.maxHp || 0) > 0
      ? Number(target.currentHp || 0) / Number(target.maxHp || 1)
      : 1;
    if (alliedTarget && targetHpFraction > 0.5) {
      throw new Error('Solo puedes denegar creeps aliados con 50% de vida o menos.');
    }

    const nextHp = Math.max(0, Number(target.currentHp || 0) - amount);
    const nextCreep = {
      ...target,
      currentHp: nextHp,
      alive: nextHp > 0,
      moving: nextHp > 0 ? Boolean(target.moving) : false,
    };
    const snapshot = {
      ...previous,
      type: 'match.runtime.creeps',
      matchId: active.id,
      authorityUserId: null,
      simulationUserId: runtimeAuthorityUserId(active),
      sequence: Number(previous.sequence || 0) + 1,
      sentAt: Date.now(),
      creeps: previous.creeps.map(creep => creep.id === creepId ? nextCreep : creep),
    };
    matchRuntimeCreepStates.set(active.id, snapshot);

    let creditedSourceState = null;
    if (nextHp <= 0) {
      const room = runtimeRoom(active.id);
      const sourceRuntime = room.get(userId) || null;
      if (sourceRuntime) {
        creditedSourceState = {
          ...sourceRuntime,
          lastHits: Number(sourceRuntime.lastHits || 0) + (alliedTarget ? 0 : 1),
          denies: Number(sourceRuntime.denies || 0) + (alliedTarget ? 1 : 0),
          sequence: Number(sourceRuntime.sequence || 0) + 1,
          sentAt: Date.now(),
        };
        room.set(userId, creditedSourceState);
      }
    }

    const simulatorUserId = runtimeAuthorityUserId(active);
    const event = {
      type: 'match.runtime.creep.damage',
      matchId: active.id,
      sourceUserId: userId,
      creepId,
      amount,
      at: Date.now(),
    };

    // The server owns HP/death. The simulation producer only mirrors the accepted hit into
    // its local AI world so future movement/attack proposals continue from the same state.
    if (simulatorUserId && simulatorUserId !== userId) send(simulatorUserId, event);
    const recipients = active.players.map(candidate => candidate.userId);
    broadcast(runtimeCreepSnapshot(active.id), recipients);
    if (creditedSourceState) {
      broadcast({
        type: 'match.runtime.state',
        matchId: active.id,
        state: creditedSourceState,
      }, recipients);
    }
    return event;
  }

  function reportMatchRuntimeStructures(userId, payload) {
    const active = store.activeMatchForUser(userId);
    if (!active || active.status !== 'in_game') throw new Error('No tienes una partida activa para sincronizar estructuras.');
    if (payload?.matchId && String(payload.matchId) !== active.id) throw new Error('Las estructuras pertenecen a otra partida.');

    const authorityUserId = runtimeAuthorityUserId(active);
    if (!authorityUserId || userId !== authorityUserId) throw new Error('Solo el simulador asignado puede proponer el estado de estructuras.');

    const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value)));
    const structureIdPattern = /^(blue|red)-(?:[a-z0-9-]+-tower|throne)$/;
    const previous = matchRuntimeStructureStates.get(active.id);
    const previousById = new Map((previous?.structures || []).map(structure => [structure.id, structure]));
    const sequence = Number(previous?.sequence || 0) + 1;

    const structures = (Array.isArray(payload?.structures) ? payload.structures : []).slice(0, 32).flatMap(raw => {
      if (!raw || typeof raw !== 'object') return [];
      const id = String(raw.id || '');
      const match = structureIdPattern.exec(id);
      if (!match) return [];
      const team = match[1];
      const kind = id.endsWith('-tower') ? 'tower' : 'building';
      const incomingMaxHp = clamp(raw.maxHp, 1, 100000);
      const prior = previousById.get(id) || null;
      const maxHp = prior ? Math.max(1, Number(prior.maxHp) || incomingMaxHp) : incomingMaxHp;
      const incomingHp = clamp(raw.currentHp, 0, maxHp);
      // Structures do not regenerate or respawn. The server therefore treats HP/death as
      // monotonic canonical state and rejects any stale client proposal that restores them.
      const currentHp = prior
        ? Math.min(Math.max(0, Number(prior.currentHp) || 0), incomingHp)
        : incomingHp;
      const alive = (prior?.alive !== false) && raw.alive !== false && currentHp > 0;
      return [{
        id,
        team,
        kind,
        currentHp: alive ? currentHp : 0,
        maxHp,
        alive,
      }];
    });

    const snapshot = {
      type: 'match.runtime.structures',
      matchId: active.id,
      authorityUserId: null,
      simulationUserId: authorityUserId,
      sequence,
      sentAt: Date.now(),
      structures,
    };
    matchRuntimeStructureStates.set(active.id, snapshot);
    broadcast(snapshot, active.players.map(candidate => candidate.userId));
    return snapshot;
  }

  function reportMatchRuntimeStructureDamage(userId, payload) {
    const active = store.activeMatchForUser(userId);
    if (!active || active.status !== 'in_game') throw new Error('No tienes una partida activa para dañar estructuras.');
    if (payload?.matchId && String(payload.matchId) !== active.id) throw new Error('El daño de estructura pertenece a otra partida.');

    const source = active.players.find(candidate => candidate.userId === userId);
    if (!source) throw new Error('No participas en esta partida.');

    const structureId = String(payload?.structureId || '');
    const match = /^(blue|red)-(?:[a-z0-9-]+-tower|throne)$/.exec(structureId);
    if (!match) throw new Error('Estructura de destino inválida.');
    if (match[1] === source.team) throw new Error('No se permite daño aliado a estructuras.');

    const amount = Math.max(0, Math.min(50000, Number(payload?.amount) || 0));
    if (amount <= 0) return null;

    const previous = matchRuntimeStructureStates.get(active.id);
    const target = previous?.structures?.find(structure => structure.id === structureId) || null;
    if (!previous || !target || target.alive === false || Number(target.currentHp || 0) <= 0) return null;

    const previousHp = Math.max(0, Number(target.currentHp || 0));
    const resolvedStructureDamage = Math.min(previousHp, amount);
    const nextHp = Math.max(0, previousHp - amount);
    const sourceResultStats = resultStatsFor(active.id, userId);
    if (target.kind === 'tower') {
      sourceResultStats.towerDamage += resolvedStructureDamage;
      if (nextHp <= 0) sourceResultStats.towersDestroyed += 1;
    } else {
      sourceResultStats.buildingDamage += resolvedStructureDamage;
    }

    const nextStructure = {
      ...target,
      currentHp: nextHp,
      alive: nextHp > 0,
    };
    const snapshot = {
      ...previous,
      type: 'match.runtime.structures',
      matchId: active.id,
      authorityUserId: null,
      simulationUserId: runtimeAuthorityUserId(active),
      sequence: Number(previous.sequence || 0) + 1,
      sentAt: Date.now(),
      structures: previous.structures.map(structure =>
        structure.id === structureId ? nextStructure : structure),
    };
    matchRuntimeStructureStates.set(active.id, snapshot);

    const simulatorUserId = runtimeAuthorityUserId(active);
    const event = {
      type: 'match.runtime.structure.damage',
      matchId: active.id,
      sourceUserId: userId,
      structureId,
      amount,
      at: Date.now(),
    };

    if (simulatorUserId && simulatorUserId !== userId) send(simulatorUserId, event);
    broadcast(runtimeStructureSnapshot(active.id), active.players.map(candidate => candidate.userId));

    if (nextHp <= 0) {
      const destroyedType = target.kind === 'tower' ? 'tower_destroyed' : 'building_destroyed';
      recordTimelineEvent(active, {
        id: `${destroyedType}:${active.id}:${structureId}`,
        type: destroyedType,
        team: source.team,
        userId,
        username: source.username,
        structureId,
        label: target.kind === 'tower'
          ? `${source.username} destroyed ${structureId}`
          : `${source.username} destroyed the enemy throne`,
        atMs: runtimeMatchElapsedMs(active, event.at),
      });
    }

    if (nextHp <= 0 && structureId.endsWith('-throne')) {
      finishMatch(active, {
        winnerTeam: source.team,
        reason: 'throne_destroyed',
        voided: false,
      });
    }
    return event;
  }

  function reportMatchChatMessage(userId, payload) {
    const active = store.activeMatchForUser(userId);
    if (!active || active.status !== 'in_game') throw new Error('No tienes una partida activa para usar el chat.');
    if (payload?.matchId && String(payload.matchId) !== active.id) throw new Error('El mensaje pertenece a otra partida.');
    const player = active.players.find(candidate => candidate.userId === userId);
    if (!player) throw new Error('No participas en esta partida.');

    const text = String(payload?.text || '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 220);
    if (!text) return null;
    const channel = payload?.channel === 'team' ? 'team' : 'all';
    matchChatSequence += 1;
    const message = {
      messageId: `${active.id}:${userId}:${Date.now()}:${matchChatSequence}`,
      matchId: active.id,
      playerId: userId,
      playerName: player.username,
      team: player.team,
      channel,
      text,
      atMs: Date.now(),
    };
    const abandoned = new Set(active.abandonedUserIds || []);
    const recipients = active.players
      .filter(candidate => !abandoned.has(candidate.userId))
      .filter(candidate => channel === 'all' || candidate.team === player.team)
      .map(candidate => candidate.userId);
    broadcast({ type: 'match.chat.message', message }, recipients);
    return message;
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
    matchRuntimeCreepStates.delete(updated.id);
    matchRuntimeStructureStates.delete(updated.id);
    matchRuntimeCombatLocks.delete(updated.id);
    matchRuntimeHeroDamageCredits.delete(updated.id);
    matchRuntimeHeroAbilityStates.delete(updated.id);
    matchRuntimePauseStates.delete(updated.id);
    matchRuntimeSpawnPositions.delete(updated.id);
    matchRuntimeAuthorityUsers.delete(updated.id);
    matchRuntimeResultStats.delete(updated.id);
    matchRuntimeGraphSamples.delete(updated.id);
    matchRuntimeTimelineEvents.delete(updated.id);
    clearMatchDisconnectGrace(updated.id);
    runtimePauseState(updated.id);
    broadcastRuntimeAuthority(updated);

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
    if (!(active.abandonedUserIds || []).includes(userId) && active.status === 'in_game') {
      recordTimelineEvent(active, {
        id: `abandon:${active.id}:${userId}`,
        type: 'abandon',
        team: player.team,
        userId,
        username: player.username,
        label: `${player.username} abandoned the match`,
        atMs: runtimeMatchElapsedMs(active, Date.now()),
      });
    }
    const remainingPlayers = active.players.filter(candidate => !abandonedUserIds.includes(candidate.userId));
    const remainingDawn = remainingPlayers.filter(candidate => candidate.team === 'blue');
    const remainingDusk = remainingPlayers.filter(candidate => candidate.team === 'red');

    const loadingCancelled = active.status === 'loading';
    const teamEliminated = active.status === 'in_game' && (!remainingDawn.length || !remainingDusk.length);
    const survivingTeam = remainingDawn.length ? 'blue' : remainingDusk.length ? 'red' : null;
    const survivingTeamHasConnection = survivingTeam
      ? remainingPlayers.some(candidate => candidate.team === survivingTeam && isOnline(candidate.userId))
      : false;
    const teamEliminatedWithConnectedWinner = teamEliminated && survivingTeamHasConnection;
    const ended = loadingCancelled
      || (teamEliminated && !survivingTeam)
      || teamEliminatedWithConnectedWinner;
    const winnerTeam = active.status === 'in_game' && teamEliminatedWithConnectedWinner
      ? survivingTeam
      : null;
    const voided = active.status === 'in_game' && teamEliminated && !survivingTeam;

    // Do not delete a leaver's runtime row while the match continues. Their hero becomes an
    // idle world entity and remains targetable/killable from the canonical server snapshot.
    // Removing the row here made a partial abandon corrupt the ongoing match because the other
    // clients still rendered the hero while the server no longer knew it existed.
    const abandoningRuntime = runtimeRoom(active.id).get(userId) || null;
    if (abandoningRuntime) {
      runtimeRoom(active.id).set(userId, {
        ...abandoningRuntime,
        moving: false,
        sequence: Number(abandoningRuntime.sequence || 0) + 1,
        sentAt: Date.now(),
      });
    }

    const updated = store.updateMatch(active.id, { abandonedUserIds }) || { ...active, abandonedUserIds };

    send(userId, {
      type: 'match.abandoned',
      matchId: active.id,
      ended,
    });

    if (ended) {
      const endReason = loadingCancelled
        ? 'loading_abandonment'
        : winnerTeam
          ? 'team_abandonment'
          : 'all_players_abandoned';
      return finishMatch(updated, {
        winnerTeam,
        reason: endReason,
        voided: loadingCancelled || voided,
      });
    }

    if (active.source === 'custom') lobbies.removeParticipantFromInGame(active.id, userId);
    const remainingUserIds = remainingPlayers.map(candidate => candidate.userId);
    broadcast({
      type: 'match.player.abandoned',
      match: publicMatch(updated),
      userId,
      username: player.username,
    }, remainingUserIds);
    const idleAbandonedState = runtimeRoom(active.id).get(userId) || null;
    if (idleAbandonedState) {
      broadcast({
        type: 'match.runtime.state',
        matchId: active.id,
        state: idleAbandonedState,
      }, remainingUserIds);
    }

    // The game session is independent of the lobby owner. If the custom-lobby creator
    // abandons, ownership may migrate, but every remaining player stays in the same match.
    evaluateMatchConnectivity(active.id);
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
      const creepSnapshot = runtimeCreepSnapshot(active.match.id);
      if (creepSnapshot) peer.send(creepSnapshot);
      const structureSnapshot = runtimeStructureSnapshot(active.match.id);
      if (structureSnapshot) peer.send(structureSnapshot);
      peer.send({
        type: 'match.runtime.authority',
        matchId: active.match.id,
        authorityUserId: null,
        simulationUserId: runtimeAuthorityUserId(active.match),
      });
      peer.send(publicRuntimePauseState(active.match.id));
      peer.send(runtimeConnectionGraceEvent(active.match));
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
      const connectedMatch = store.activeMatchForUser(user.id);
      if (connectedMatch?.status === 'in_game') {
        markResultPlayerConnected(connectedMatch.id, user.id);
        broadcastMatchPlayerConnection(connectedMatch, user.id, true);
        evaluateMatchConnectivity(connectedMatch.id);
      }
      peer.onMessage = message => {
        try {
          if (peersByUser.get(user.id) !== peer) return;
          const type = String(message?.type || '');
          if (type === 'queue.join' || type === 'party.queue') queueParty(user, message.mode === 'normal' ? 'normal' : 'ranked');
          else if (type === 'queue.leave') leaveQueue(user);
          else if (type === 'ready.response') matchmaker.respond(user.id, String(message.readyId || ''), Boolean(message.accepted));
          else if (type === 'match.rejoin') rejoinActiveSession(user.id, peer);
          else if (type === 'match.loading.progress') reportMatchLoadingProgress(user.id, message.progress);
          else if (type === 'match.runtime.state') reportMatchRuntimeState(user.id, message);
          else if (type === 'match.runtime.ability.cast') reportMatchRuntimeAbilityCast(user.id, message);
          else if (type === 'match.runtime.combat') reportMatchRuntimeCombat(user.id, message);
          else if (type === 'match.runtime.combat.resolve') reportMatchRuntimeCombatResolve(user.id, message);
          else if (type === 'match.runtime.creeps') reportMatchRuntimeCreeps(user.id, message);
          else if (type === 'match.runtime.creep.damage') reportMatchRuntimeCreepDamage(user.id, message);
          else if (type === 'match.runtime.structures') reportMatchRuntimeStructures(user.id, message);
          else if (type === 'match.runtime.structure.damage') reportMatchRuntimeStructureDamage(user.id, message);
          else if (type === 'match.runtime.pause') reportMatchRuntimePause(user.id, message);
          else if (type === 'match.chat.send') reportMatchChatMessage(user.id, message);
          else if (type === 'match.runtime.snapshot') {
            const active = store.activeMatchForUser(user.id);
            if (!active || active.status !== 'in_game') throw new Error('No tienes una partida activa.');
            peer.send({ type: 'match.runtime.snapshot', matchId: active.id, states: runtimeSnapshot(active.id) });
            const creepSnapshot = runtimeCreepSnapshot(active.id);
            if (creepSnapshot) peer.send(creepSnapshot);
            const structureSnapshot = runtimeStructureSnapshot(active.id);
            if (structureSnapshot) peer.send(structureSnapshot);
            peer.send({
              type: 'match.runtime.authority',
              matchId: active.id,
              authorityUserId: null,
              simulationUserId: runtimeAuthorityUserId(active),
            });
            peer.send(publicRuntimePauseState(active.id));
            peer.send(runtimeConnectionGraceEvent(active));
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
        if (peersByUser.get(user.id) === peer) {
          peersByUser.delete(user.id);
          const disconnectedMatch = store.activeMatchForUser(user.id);
          if (disconnectedMatch?.status === 'in_game' && !shuttingDown) {
            markResultPlayerDisconnected(disconnectedMatch.id, user.id);
            broadcastMatchPlayerConnection(disconnectedMatch, user.id, false);
            evaluateMatchConnectivity(disconnectedMatch.id);
          }
        }
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
    shuttingDown = false;
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
    shuttingDown = true;
    for (const matchId of [...matchDisconnectGraceStates.keys()]) clearMatchDisconnectGrace(matchId);
    for (const peer of [...peersByUser.values()]) peer.close();
    peersByUser.clear();
    if (!server.listening) return;
    await new Promise(resolve => server.close(() => resolve()));
  }

  return {
    config, server, store, sessions, parties, matchmaker, lobbies, heroSelect,
    abandonActiveMatch, reportMatchRuntimeState, reportMatchRuntimeAbilityCast,
    reportMatchRuntimeCombat, reportMatchRuntimeCombatResolve,
    reportMatchRuntimeCreeps, reportMatchRuntimeCreepDamage,
    reportMatchRuntimeStructures, reportMatchRuntimeStructureDamage, reportMatchChatMessage,
    runtimeSnapshot, runtimeCreepSnapshot, runtimeStructureSnapshot, start, close,
  };
}
