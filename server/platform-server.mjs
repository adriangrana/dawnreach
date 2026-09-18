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
  const matchRuntimePauseStates = new Map();
  const matchRuntimeSpawnPositions = new Map();
  const matchRuntimeAuthorityUsers = new Map();
  const matchDisconnectGraceStates = new Map();
  const HERO_KILL_CREDIT_WINDOW_MS = 10_000;
  const MATCH_RECONNECT_GRACE_MS = Math.max(50, Number(options.matchReconnectGraceMs) || 60_000);
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
    return room ? [...room.values()].map(state => ({
      ...state,
      position: { ...state.position },
      inventory: Array.isArray(state.inventory) ? state.inventory.map(item => ({ ...item })) : [],
    })) : [];
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

    // Authority is sticky while connected. If it disappears, migrate to the first remaining
    // connected participant. Reconnecting an old lobby host never steals authority back.
    const next = eligible.find(player => isOnline(player.userId)) || current || eligible[0];
    matchRuntimeAuthorityUsers.set(match.id, next.userId);
    return next.userId;
  }

  function broadcastRuntimeAuthority(match) {
    if (!match || match.status !== 'in_game') return null;
    const previous = matchRuntimeAuthorityUsers.get(match.id) || null;
    const authorityUserId = runtimeAuthorityUserId(match);
    if (authorityUserId !== previous || authorityUserId) {
      broadcast({
        type: 'match.runtime.authority',
        matchId: match.id,
        authorityUserId,
      }, match.players.map(player => player.userId));
    }
    return authorityUserId;
  }

  function runtimeCombatLocks(matchId) {
    let locks = matchRuntimeCombatLocks.get(matchId);
    if (!locks) {
      locks = new Map();
      matchRuntimeCombatLocks.set(matchId, locks);
    }
    return locks;
  }

  function runtimeHeroDamageCredits(matchId) {
    let credits = matchRuntimeHeroDamageCredits.get(matchId);
    if (!credits) {
      credits = new Map();
      matchRuntimeHeroDamageCredits.set(matchId, credits);
    }
    return credits;
  }

  function runtimeSpawnPositions(matchId) {
    let positions = matchRuntimeSpawnPositions.get(matchId);
    if (!positions) {
      positions = new Map();
      matchRuntimeSpawnPositions.set(matchId, positions);
    }
    return positions;
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
    matchRuntimePauseStates.delete(matchId);
    matchRuntimeSpawnPositions.delete(matchId);
    matchRuntimeAuthorityUsers.delete(matchId);
    clearMatchDisconnectGrace(matchId);
  }

  function finishMatch(active, { winnerTeam = null, reason, voided = false } = {}) {
    if (!active || !['loading', 'in_game'].includes(active.status)) return active ? publicMatch(active) : null;
    const endedAt = new Date().toISOString();
    const updated = store.updateMatch(active.id, {
      status: voided ? 'cancelled' : 'completed',
      endedAt,
      endReason: String(reason || (voided ? 'cancelled' : 'completed')),
      winnerTeam: voided ? null : winnerTeam,
      ...(voided ? { rated: false } : {}),
    }) || {
      ...active,
      status: voided ? 'cancelled' : 'completed',
      endedAt,
      endReason: String(reason || (voided ? 'cancelled' : 'completed')),
      winnerTeam: voided ? null : winnerTeam,
      ...(voided ? { rated: false } : {}),
    };

    broadcast({
      type: 'match.ended',
      match: publicMatch(updated),
      winnerTeam: voided ? null : winnerTeam,
      reason: updated.endReason,
      voided,
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

  function evaluateMatchConnectivity(matchId) {
    const match = store.match(matchId);
    if (!match || match.status !== 'in_game' || shuttingDown) {
      clearMatchDisconnectGrace(matchId);
      return null;
    }

    const connectivity = matchConnectivity(match);
    broadcastRuntimeAuthority(match);
    if (!connectivity.blue.length || !connectivity.red.length) {
      clearMatchDisconnectGrace(matchId);
      if (!connectivity.blue.length && !connectivity.red.length) {
        return finishMatch(match, { reason: 'all_players_abandoned', voided: true });
      }
      return finishMatch(match, {
        winnerTeam: connectivity.blue.length ? 'blue' : 'red',
        reason: 'team_abandonment',
      });
    }

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
    const reportedPosition = {
      x: clamp(position.x, -75, 75),
      y: clamp(position.y, -5, 40),
      z: clamp(position.z, -62.5, 62.5),
    };
    if (!previous && !runtimeSpawnPositions(active.id).has(userId)) {
      runtimeSpawnPositions(active.id).set(userId, { ...reportedPosition });
    }
    const sequence = Math.max(Number(previous?.sequence || 0) + 1, Math.floor(finite(payload?.sequence, 0)));
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
    let suppressOwnerEcho = false;
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
      requestedCurrentHp = requestedMaxHp;
      requestedCurrentResource = requestedMaxResource;
      requestedAlive = true;
      combatLocks.delete(userId);
    } else if (combatLock?.until && now < combatLock.until) {
      const processedDamage = rawAlive === false
        || rawCurrentHp < Math.max(0, Number(combatLock.preDamageHp || 0)) - 0.001;

      if (processedDamage) {
        requestedCurrentHp = rawCurrentHp;
        requestedAlive = rawAlive;

        if (!requestedAlive && combatLock.pendingLethal && !combatLock.deathAccounted) {
          deathIncrement = 1;
          const respawnSeconds = Math.max(0, Number(combatLock.respawnSeconds || 0));
          combatLock.deathAccounted = true;
          combatLock.hpCeiling = 0;
          combatLock.deadUntil = now + respawnSeconds * 1000;
          combatLock.until = Math.max(combatLock.until, combatLock.deadUntil);

          const directKillerPlayer = combatLock.sourceUserId
            ? active.players.find(candidate => candidate.userId === combatLock.sourceUserId) ?? null
            : null;
          const directHeroKiller = Boolean(
            directKillerPlayer
            && combatLock.sourceEntityId === `player:${combatLock.sourceUserId}:hero`,
          );

          const damageCredits = runtimeHeroDamageCredits(active.id);
          const recentCredit = damageCredits.get(userId) || null;
          const recentCreditedPlayer = recentCredit
            && now - Number(recentCredit.at || 0) <= HERO_KILL_CREDIT_WINDOW_MS
            ? active.players.find(candidate =>
              candidate.userId === recentCredit.sourceUserId
              && candidate.team !== player.team
            ) ?? null
            : null;
          const killerPlayer = directHeroKiller
            ? directKillerPlayer
            : recentCreditedPlayer;
          const heroKiller = Boolean(killerPlayer);

          if (heroKiller && killerPlayer) {
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

          const killerTeam = heroKiller && killerPlayer
            ? killerPlayer.team
            : String(combatLock.sourceEntityId || '').includes(':red:')
              ? 'red'
              : String(combatLock.sourceEntityId || '').includes(':blue:')
                ? 'blue'
                : 'neutral';
          const nextDeaths = Number(previous?.deaths || 0) + 1;
          confirmedHeroKillEvent = {
            type: 'match.runtime.hero.kill',
            matchId: active.id,
            eventId: `hero-kill:${active.id}:${userId}:${nextDeaths}`,
            victimUserId: userId,
            victimUsername: player.username,
            victimTeam: player.team,
            victimHeroId: active.heroSelections?.[userId]?.heroId || 'H001',
            killerUserId: heroKiller && killerPlayer ? killerPlayer.userId : null,
            killerUsername: heroKiller && killerPlayer ? killerPlayer.username : null,
            killerTeam,
            killerHeroId: heroKiller && killerPlayer
              ? (active.heroSelections?.[killerPlayer.userId]?.heroId || 'H001')
              : null,
            killerEntityId: heroKiller && killerPlayer
              ? `player:${killerPlayer.userId}:hero`
              : String(combatLock.sourceEntityId || '') || null,
            at: now,
          };
        } else if (requestedAlive) {
          combatLocks.delete(userId);
        }
      } else {
        // This packet was authored before the victim processed the combat event. A pending
        // lethal prediction MUST NOT manufacture a death from this stale packet: Alden's
        // guard/majesty can reduce the hit and keep the victim alive. Wait for the explicit
        // victim combat resolution (or a genuinely processed state packet).
        if (combatLock.pendingLethal && !combatLock.deathAccounted) {
          requestedCurrentHp = previous?.currentHp ?? rawCurrentHp;
          requestedAlive = previous?.alive !== false && requestedCurrentHp > 0;
          suppressOwnerEcho = true;
        } else {
          requestedCurrentHp = Math.min(rawCurrentHp, Math.max(0, Number(combatLock.hpCeiling || 0)));
          requestedAlive = requestedCurrentHp > 0;
        }
      }
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
          : 6 + Math.max(1, Math.floor(Number(previous?.level || payload?.level || 1))) * 2,
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

    const effectiveCombatLock = combatLocks.get(userId) || combatLock;
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
      position: serverRespawned
        ? { ...(runtimeSpawnPositions(active.id).get(userId) || reportedPosition) }
        : reportedPosition,
      yaw: clamp(payload?.yaw, -Math.PI * 8, Math.PI * 8),
      moving: serverRespawned ? false : Boolean(payload?.moving),
      currentHp: requestedCurrentHp,
      maxHp: requestedMaxHp,
      currentResource: requestedCurrentResource,
      maxResource: requestedMaxResource,
      level: Math.max(1, Math.min(99, Math.floor(finite(payload?.level, 1)))),
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
      lastHits: nonNegativeCounter(payload?.lastHits, previous?.lastHits),
      denies: nonNegativeCounter(payload?.denies, previous?.denies),
      gold: nonNegativeCounter(payload?.gold, previous?.gold),
      inventory,
      sentAt: now,
    };

    runtimeRoom(active.id).set(userId, state);
    const recipients = active.players.map(candidate => candidate.userId);
    broadcast({
      type: 'match.runtime.state',
      matchId: active.id,
      state,
    }, suppressOwnerEcho ? recipients.filter(recipientUserId => recipientUserId !== userId) : recipients);
    if (creditedKillerState) {
      broadcast({
        type: 'match.runtime.state',
        matchId: active.id,
        state: creditedKillerState,
      }, recipients);
    }
    if (confirmedHeroKillEvent) broadcast(confirmedHeroKillEvent, recipients);
    return state;
  }

  function reportMatchRuntimeCombat(userId, payload) {
    const active = store.activeMatchForUser(userId);
    if (!active || active.status !== 'in_game') throw new Error('No tienes una partida activa para combatir.');
    if (payload?.matchId && String(payload.matchId) !== active.id) throw new Error('El evento pertenece a otra partida.');

    const source = active.players.find(candidate => candidate.userId === userId);
    const targetUserId = String(payload?.targetUserId || '');
    const target = active.players.find(candidate => candidate.userId === targetUserId);
    if (!source || !target || source.userId === target.userId) throw new Error('Objetivo de combate inválido.');

    const amount = Math.max(0, Math.min(10000, Number(payload?.amount) || 0));
    if (amount <= 0) return null;
    const reason = payload?.reason === 'heal' ? 'heal' : 'damage';
    if (reason === 'damage' && source.team === target.team) throw new Error('No se permite daño aliado entre héroes.');
    const requestedSourceEntityId = String(payload?.sourceEntityId || '');
    const authorityUserId = runtimeAuthorityUserId(active);
    const sourceEntityId = userId === authorityUserId && /^lane-creep:(blue|red):(top|mid|bot):\d+:\d+$/.test(requestedSourceEntityId)
      ? requestedSourceEntityId
      : `player:${userId}:hero`;

    const room = runtimeRoom(active.id);
    const targetRuntime = room.get(target.userId);
    const now = Date.now();
    matchCombatSequence += 1;
    const combatId = `${active.id}:${target.userId}:${now}:${matchCombatSequence}`;

    if (
      reason === 'damage'
      && sourceEntityId === `player:${source.userId}:hero`
      && source.userId !== target.userId
      && source.team !== target.team
    ) {
      runtimeHeroDamageCredits(active.id).set(target.userId, {
        sourceUserId: source.userId,
        at: now,
      });
    }

    let lethal = false;
    let respawnSeconds = null;
    let synchronizedTargetState = null;

    if (targetRuntime) {
      const locks = runtimeCombatLocks(active.id);
      const existingLock = locks.get(target.userId) || null;
      const preDamageHp = existingLock?.preDamageHp ?? targetRuntime.currentHp;
      const baseHp = reason === 'damage' && existingLock
        ? Math.min(targetRuntime.currentHp, Math.max(0, Number(existingLock.hpCeiling ?? targetRuntime.currentHp)))
        : targetRuntime.currentHp;
      const currentHp = reason === 'heal'
        ? Math.min(targetRuntime.maxHp, targetRuntime.currentHp + amount)
        : Math.max(0, baseHp - amount);
      lethal = reason === 'damage' && currentHp <= 0;
      respawnSeconds = lethal
        ? 6 + Math.max(1, Math.floor(Number(targetRuntime.level) || 1)) * 2
        : null;

      // Do not broadcast a speculative target state. The victim applies the combat event
      // and its next runtime packet becomes the authoritative HP/alive result. The lock
      // only prevents an older pre-hit snapshot from restoring HP in the meantime.
      if (reason === 'damage') {
        const crossedLethal = lethal && !existingLock?.pendingLethal;
        locks.set(target.userId, {
          combatId,
          preDamageHp,
          hpCeiling: currentHp,
          until: now + 1200,
          deadUntil: existingLock?.deadUntil ?? null,
          pendingLethal: Boolean(existingLock?.pendingLethal || lethal),
          deathAccounted: Boolean(existingLock?.deathAccounted),
          respawnSeconds: crossedLethal
            ? respawnSeconds
            : (existingLock?.respawnSeconds ?? respawnSeconds),
          sourceUserId: crossedLethal
            ? source.userId
            : (existingLock?.sourceUserId ?? source.userId),
          sourceEntityId: crossedLethal
            ? sourceEntityId
            : (existingLock?.sourceEntityId ?? sourceEntityId),
        });
      }

      // Keep the shared runtime snapshot in sync immediately for ordinary damage/healing.
      // Lethal damage still waits for the victim's authoritative alive=false packet so death,
      // respawn and kill-feed accounting remain exactly-once.
      if (!lethal) {
        synchronizedTargetState = {
          ...targetRuntime,
          currentHp,
          alive: currentHp > 0,
          sequence: Number(targetRuntime.sequence || 0) + 1,
          sentAt: now,
        };
        room.set(target.userId, synchronizedTargetState);
      }
    }

    const event = {
      type: 'match.runtime.combat',
      matchId: active.id,
      sourceUserId: source.userId,
      sourceUsername: source.username,
      sourceEntityId,
      combatId,
      targetUserId: target.userId,
      targetUsername: target.username,
      reason,
      amount,
      lethal,
      respawnSeconds,
      at: now,
    };
    const recipients = active.players.map(candidate => candidate.userId);
    if (synchronizedTargetState) {
      // Observers and the attacker can render the predicted HP immediately, but the victim
      // must apply the combat event against its own pre-hit state exactly once. Sending the
      // prediction to the victim first made it subtract the same hit twice.
      broadcast({
        type: 'match.runtime.state',
        matchId: active.id,
        state: synchronizedTargetState,
      }, recipients.filter(recipientUserId => recipientUserId !== target.userId));
    }
    broadcast(event, [...new Set([source.userId, target.userId])]);
    return event;
  }

  function reportMatchRuntimeCombatResolve(userId, payload) {
    const active = store.activeMatchForUser(userId);
    if (!active || active.status !== 'in_game') throw new Error('No tienes una partida activa para resolver combate.');
    if (payload?.matchId && String(payload.matchId) !== active.id) throw new Error('La resolución pertenece a otra partida.');

    const combatId = String(payload?.combatId || '');
    const locks = runtimeCombatLocks(active.id);
    const lock = locks.get(userId) || null;
    const previous = runtimeRoom(active.id).get(userId) || null;
    if (!combatId || !lock || lock.combatId !== combatId || !previous) return previous;

    const maxHp = Math.max(1, Number(previous.maxHp) || 1);
    const currentHp = Math.max(0, Math.min(maxHp, Number(payload?.currentHp) || 0));
    const maxResource = Math.max(0, Number(previous.maxResource) || 0);
    const currentResource = Math.max(
      0,
      Math.min(maxResource || 100000, Number(payload?.currentResource ?? previous.currentResource) || 0),
    );

    return reportMatchRuntimeState(userId, {
      matchId: active.id,
      sequence: Number(previous.sequence || 0) + 1,
      position: { ...previous.position },
      yaw: previous.yaw,
      moving: currentHp > 0 ? Boolean(previous.moving) : false,
      currentHp,
      maxHp,
      currentResource,
      maxResource,
      level: previous.level,
      experience: previous.experience,
      alive: payload?.alive !== false && currentHp > 0,
      abilityRanks: previous.abilityRanks,
      abilityCooldownRemainingMs: previous.abilityCooldownRemainingMs,
      kills: previous.kills,
      deaths: previous.deaths,
      assists: previous.assists,
      lastHits: previous.lastHits,
      denies: previous.denies,
      gold: previous.gold,
      inventory: previous.inventory,
      respawnRemainingMs: 0,
      respawnDurationMs: currentHp <= 0
        ? Math.max(0, Number(lock.respawnSeconds || 0) * 1000)
        : 0,
    });
  }

  function reportMatchRuntimeCreeps(userId, payload) {
    const active = store.activeMatchForUser(userId);
    if (!active || active.status !== 'in_game') throw new Error('No tienes una partida activa para sincronizar creeps.');
    if (payload?.matchId && String(payload.matchId) !== active.id) throw new Error('La oleada pertenece a otra partida.');
    const authorityUserId = runtimeAuthorityUserId(active);
    if (!authorityUserId || userId !== authorityUserId) throw new Error('Solo la autoridad de la partida puede publicar creeps.');

    const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value)));
    const previous = matchRuntimeCreepStates.get(active.id);
    const sequence = Math.max(Number(previous?.sequence || 0) + 1, Math.floor(finite(payload?.sequence, 0)));
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
        currentHp: clamp(raw.currentHp, 0, 100000),
        maxHp: clamp(raw.maxHp, 1, 100000),
        alive: raw.alive !== false,
        state,
        moving: Boolean(raw.moving),
        seed: Math.max(0, Math.min(1000000, Math.floor(finite(raw.seed, 0)))),
        attackSequence: Math.max(0, Math.min(1000000000, Math.floor(finite(raw.attackSequence, 0)))),
      }];
    });

    const snapshot = {
      type: 'match.runtime.creeps',
      matchId: active.id,
      authorityUserId,
      sequence,
      sentAt: Date.now(),
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

    const authorityUserId = runtimeAuthorityUserId(active);
    if (!authorityUserId || authorityUserId === userId) return null;
    const creepId = String(payload?.creepId || '');
    if (!/^lane-creep:(blue|red):(top|mid|bot):\d+:\d+$/.test(creepId)) throw new Error('Creep de destino inválido.');
    const amount = Math.max(0, Math.min(10000, Number(payload?.amount) || 0));
    if (amount <= 0) return null;

    const event = {
      type: 'match.runtime.creep.damage',
      matchId: active.id,
      sourceUserId: userId,
      creepId,
      amount,
      at: Date.now(),
    };
    send(authorityUserId, event);
    return event;
  }

  function reportMatchRuntimeStructures(userId, payload) {
    const active = store.activeMatchForUser(userId);
    if (!active || active.status !== 'in_game') throw new Error('No tienes una partida activa para sincronizar estructuras.');
    if (payload?.matchId && String(payload.matchId) !== active.id) throw new Error('Las estructuras pertenecen a otra partida.');

    const authorityUserId = runtimeAuthorityUserId(active);
    if (!authorityUserId || userId !== authorityUserId) throw new Error('Solo la autoridad de la partida puede publicar estructuras.');

    const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
    const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value)));
    const structureIdPattern = /^(blue|red)-(?:[a-z0-9-]+-tower|throne)$/;
    const previous = matchRuntimeStructureStates.get(active.id);
    const sequence = Math.max(Number(previous?.sequence || 0) + 1, Math.floor(finite(payload?.sequence, 0)));

    const structures = (Array.isArray(payload?.structures) ? payload.structures : []).slice(0, 32).flatMap(raw => {
      if (!raw || typeof raw !== 'object') return [];
      const id = String(raw.id || '');
      const match = structureIdPattern.exec(id);
      if (!match) return [];
      const team = match[1];
      const kind = id.endsWith('-tower') ? 'tower' : 'building';
      const maxHp = clamp(raw.maxHp, 1, 100000);
      const currentHp = clamp(raw.currentHp, 0, maxHp);
      return [{
        id,
        team,
        kind,
        currentHp,
        maxHp,
        alive: raw.alive !== false && currentHp > 0,
      }];
    });

    const snapshot = {
      type: 'match.runtime.structures',
      matchId: active.id,
      authorityUserId,
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

    const authorityUserId = runtimeAuthorityUserId(active);
    if (!authorityUserId || authorityUserId === userId) return null;

    const structureId = String(payload?.structureId || '');
    const match = /^(blue|red)-(?:[a-z0-9-]+-tower|throne)$/.exec(structureId);
    if (!match) throw new Error('Estructura de destino inválida.');
    if (match[1] === source.team) throw new Error('No se permite daño aliado a estructuras.');

    const amount = Math.max(0, Math.min(50000, Number(payload?.amount) || 0));
    if (amount <= 0) return null;

    const event = {
      type: 'match.runtime.structure.damage',
      matchId: active.id,
      sourceUserId: userId,
      structureId,
      amount,
      at: Date.now(),
    };
    send(authorityUserId, event);
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
    matchRuntimePauseStates.delete(updated.id);
    matchRuntimeSpawnPositions.delete(updated.id);
    matchRuntimeAuthorityUsers.delete(updated.id);
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
      clearMatchRuntime(active.id);
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
        authorityUserId: runtimeAuthorityUserId(active.match),
      });
      peer.send(publicRuntimePauseState(active.match.id));
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
      if (connectedMatch?.status === 'in_game') evaluateMatchConnectivity(connectedMatch.id);
      peer.onMessage = message => {
        try {
          const type = String(message?.type || '');
          if (type === 'queue.join' || type === 'party.queue') queueParty(user, message.mode === 'normal' ? 'normal' : 'ranked');
          else if (type === 'queue.leave') leaveQueue(user);
          else if (type === 'ready.response') matchmaker.respond(user.id, String(message.readyId || ''), Boolean(message.accepted));
          else if (type === 'match.rejoin') rejoinActiveSession(user.id, peer);
          else if (type === 'match.loading.progress') reportMatchLoadingProgress(user.id, message.progress);
          else if (type === 'match.runtime.state') reportMatchRuntimeState(user.id, message);
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
              authorityUserId: runtimeAuthorityUserId(active),
            });
            peer.send(publicRuntimePauseState(active.id));
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
    abandonActiveMatch, reportMatchRuntimeState, reportMatchRuntimeCombat, reportMatchRuntimeCombatResolve,
    reportMatchRuntimeCreeps, reportMatchRuntimeCreepDamage, reportMatchChatMessage,
    runtimeSnapshot, runtimeCreepSnapshot, start, close,
  };
}
