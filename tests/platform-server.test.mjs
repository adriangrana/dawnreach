import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadPlatformConfig } from '../server/config.mjs';
import { createPlatformServer } from '../server/platform-server.mjs';

function testConfig(dataDir) {
  return {
    ...loadPlatformConfig(),
    host: '127.0.0.1',
    port: 0,
    dataDir,
  };
}

async function withServer(run, serverOptions = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dawnreach-server-'));
  const platform = createPlatformServer({
    config: testConfig(root),
    logger: { error() {} },
    ...serverOptions,
  });
  const address = await platform.start({ host: '127.0.0.1', port: 0 });
  try {
    await run({ baseUrl: `http://127.0.0.1:${address.port}`, port: address.port, platform });
  } finally {
    await platform.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function jsonFetch(url, init) {
  const response = await fetch(url, init);
  const body = await response.json();
  return { response, body };
}

test('platform HTTP auth flow registers, restores session, lists sessions and revokes logout', async () => {
  await withServer(async ({ baseUrl }) => {
    const registered = await jsonFetch(`${baseUrl}/api/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'Pepe', password: 'Iron!Crown42' }),
    });
    assert.equal(registered.response.status, 201);
    assert.equal(registered.body.user.username, 'Pepe');
    assert.match(registered.body.token, /^[a-f0-9]{64}$/);

    const headers = { authorization: `Bearer ${registered.body.token}` };
    const me = await jsonFetch(`${baseUrl}/api/me`, { headers });
    assert.equal(me.response.status, 200);
    assert.equal(me.body.user.id, registered.body.user.id);

    const sessions = await jsonFetch(`${baseUrl}/api/auth/sessions`, { headers });
    assert.equal(sessions.response.status, 200);
    assert.equal(sessions.body.sessions.length, 1);
    assert.equal(sessions.body.sessions[0].current, true);

    const logout = await jsonFetch(`${baseUrl}/api/logout`, { method: 'POST', headers });
    assert.equal(logout.response.status, 200);
    const afterLogout = await jsonFetch(`${baseUrl}/api/me`, { headers });
    assert.equal(afterLogout.response.status, 401);
  });
});

test('platform rejects invalid credentials without issuing a session', async () => {
  await withServer(async ({ baseUrl }) => {
    await jsonFetch(`${baseUrl}/api/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'AldenPlayer', password: 'Iron!Crown42' }),
    });
    const login = await jsonFetch(`${baseUrl}/api/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'AldenPlayer', password: 'Wrong!Crown42' }),
    });
    assert.equal(login.response.status, 401);
    assert.equal(login.body.token, undefined);
  });
});

function websocketHandshake(port, token) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const key = crypto.randomBytes(16).toString('base64');
    let buffer = Buffer.alloc(0);
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error('WebSocket handshake timed out')); }, 2_000);
    socket.once('error', error => { clearTimeout(timeout); reject(error); });
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      const marker = buffer.indexOf('\r\n\r\n');
      if (marker < 0) return;
      clearTimeout(timeout);
      const header = buffer.subarray(0, marker).toString('utf8');
      socket.destroy();
      resolve(header);
    });
    socket.once('connect', () => {
      socket.write([
        `GET /ws?token=${encodeURIComponent(token)} HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '', '',
      ].join('\r\n'));
    });
  });
}

function openWebsocket(port, token) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const key = crypto.randomBytes(16).toString('base64');
    let buffer = Buffer.alloc(0);
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('WebSocket handshake timed out'));
    }, 2_000);
    const onError = error => {
      clearTimeout(timeout);
      reject(error);
    };
    const onData = chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      const marker = buffer.indexOf('\r\n\r\n');
      if (marker < 0) return;
      const header = buffer.subarray(0, marker).toString('utf8');
      if (!/^HTTP\/1\.1 101 Switching Protocols/m.test(header)) {
        clearTimeout(timeout);
        socket.destroy();
        reject(new Error(`WebSocket rejected: ${header.split('\r\n')[0] || 'unknown'}`));
        return;
      }
      clearTimeout(timeout);
      socket.off('error', onError);
      socket.off('data', onData);
      socket.on('error', () => {});
      socket.on('data', () => {});
      resolve(socket);
    };
    socket.once('error', onError);
    socket.on('data', onData);
    socket.once('connect', () => {
      socket.write([
        `GET /ws?token=${encodeURIComponent(token)} HTTP/1.1`,
        `Host: 127.0.0.1:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '', '',
      ].join('\r\n'));
    });
  });
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('realtime websocket requires a valid authenticated bearer session', async () => {
  await withServer(async ({ baseUrl, port }) => {
    const unauthorized = await websocketHandshake(port, 'invalid-token');
    assert.match(unauthorized, /^HTTP\/1\.1 401 Unauthorized/m);

    const registered = await jsonFetch(`${baseUrl}/api/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'RealtimePlayer', password: 'Iron!Crown42' }),
    });
    const authorized = await websocketHandshake(port, registered.body.token);
    assert.match(authorized, /^HTTP\/1\.1 101 Switching Protocols/m);
    assert.match(authorized, /Sec-WebSocket-Accept:/i);
  });
});


test('hero select completion hands the match to loading with per-player progress', async () => {
  await withServer(async ({ platform }) => {
    const created = {
      id: 'loading-match',
      mode: 'custom',
      source: 'custom',
      rated: false,
      status: 'launching',
      createdAt: new Date().toISOString(),
      players: [
        { userId: 'dawn', username: 'Dawn', rating: 1000, joinedAt: 1, team: 'blue', slot: 0 },
        { userId: 'dusk', username: 'Dusk', rating: 1000, joinedAt: 1, team: 'red', slot: 1 },
      ],
      resultToken: 'secret',
      mapSha256: null,
      customSettings: {
        map: 'dawnreach',
        gameMode: 'classic',
        teamSize: 1,
        heroSelect: 'all_pick',
        bans: 'none',
        allowSpectators: false,
        privacy: 'public',
        region: 'auto',
      },
    };

    platform.store.addMatch(created);
    platform.heroSelect.begin(created);
    platform.heroSelect.lock('dawn', 'H001');
    platform.heroSelect.lock('dusk', 'H001');

    const loading = platform.store.match(created.id);
    assert.equal(loading.status, 'loading');
    assert.equal(loading.heroSelections.dawn.heroId, 'H001');
    assert.equal(loading.heroSelections.dusk.heroId, 'H001');
    assert.deepEqual(loading.loadingProgress, { dawn: 0, dusk: 0 });
    assert.equal(platform.heroSelect.snapshotForUser('dawn'), null);
    assert.equal(platform.heroSelect.snapshotForUser('dusk'), null);
    assert.equal(platform.store.activeMatchForUser('dawn').id, created.id);
  });
});


test('abandoning the last player on a team awards a connected surviving team', async () => {
  await withServer(async ({ baseUrl, port, platform }) => {
    const blue = await jsonFetch(`${baseUrl}/api/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'AbandonBlue', password: 'Iron!Crown42' }),
    });
    const red = await jsonFetch(`${baseUrl}/api/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'AbandonRed', password: 'Iron!Crown42' }),
    });
    const match = {
      id: 'abandon-1v1',
      mode: 'normal',
      source: 'matchmaking',
      rated: false,
      status: 'in_game',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      players: [
        { userId: blue.body.user.id, username: 'AbandonBlue', rating: 1000, joinedAt: 1, team: 'blue', slot: 0 },
        { userId: red.body.user.id, username: 'AbandonRed', rating: 1000, joinedAt: 1, team: 'red', slot: 5 },
      ],
      resultToken: 'secret',
      mapSha256: null,
      heroSelections: {
        [blue.body.user.id]: { heroId: 'H001', locked: true, lockedAt: Date.now() },
        [red.body.user.id]: { heroId: 'H001', locked: true, lockedAt: Date.now() },
      },
    };

    platform.store.addMatch(match);
    const redSocket = await openWebsocket(port, red.body.token);
    await wait(10);

    const ended = platform.abandonActiveMatch(blue.body.user.id);

    assert.equal(ended.status, 'completed');
    assert.equal(ended.endReason, 'team_abandonment');
    assert.equal(ended.winnerTeam, 'red');
    assert.deepEqual(ended.abandonedUserIds, [blue.body.user.id]);
    assert.equal(platform.store.activeMatchForUser(blue.body.user.id), null);
    assert.equal(platform.store.activeMatchForUser(red.body.user.id), null);
    redSocket.destroy();
  });
});


test('final team abandon waits for an offline survivor before cancelling the orphaned match', async () => {
  await withServer(async ({ baseUrl, platform }) => {
    const blue = await jsonFetch(`${baseUrl}/api/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'OfflineBlue', password: 'Iron!Crown42' }),
    });
    const red = await jsonFetch(`${baseUrl}/api/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'OfflineRed', password: 'Iron!Crown42' }),
    });
    const match = {
      id: 'abandon-offline-survivor',
      mode: 'ranked',
      source: 'matchmaking',
      rated: true,
      status: 'in_game',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      players: [
        { userId: blue.body.user.id, username: 'OfflineBlue', rating: 1000, joinedAt: 1, team: 'blue', slot: 0 },
        { userId: red.body.user.id, username: 'OfflineRed', rating: 1000, joinedAt: 1, team: 'red', slot: 0 },
      ],
      resultToken: 'secret',
      mapSha256: null,
    };
    platform.store.addMatch(match);

    const active = platform.abandonActiveMatch(blue.body.user.id);
    assert.equal(active.status, 'in_game');
    assert.equal(active.winnerTeam ?? null, null);

    await wait(80);
    const ended = platform.store.match(match.id);
    assert.equal(ended.status, 'cancelled');
    assert.equal(ended.rated, false);
    assert.equal(ended.winnerTeam, null);
  }, { matchReconnectGraceMs: 40 });
});

test('one abandonment in a multi-player team leaves the match active for everyone else', async () => {
  await withServer(async ({ platform }) => {
    const match = {
      id: 'abandon-2v2',
      mode: 'normal',
      source: 'matchmaking',
      rated: false,
      status: 'in_game',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      players: [
        { userId: 'blue-a', username: 'Blue A', rating: 1000, joinedAt: 1, team: 'blue', slot: 0 },
        { userId: 'blue-b', username: 'Blue B', rating: 1000, joinedAt: 1, team: 'blue', slot: 1 },
        { userId: 'red-a', username: 'Red A', rating: 1000, joinedAt: 1, team: 'red', slot: 5 },
        { userId: 'red-b', username: 'Red B', rating: 1000, joinedAt: 1, team: 'red', slot: 6 },
      ],
      resultToken: 'secret',
      mapSha256: null,
    };

    platform.store.addMatch(match);
    platform.reportMatchRuntimeState('blue-a', {
      matchId: match.id, sequence: 1, position: { x: -4, y: 5, z: 2 }, yaw: 0,
      moving: true, currentHp: 500, maxHp: 700, currentResource: 250, maxResource: 300,
      level: 1, alive: true,
    });
    const active = platform.abandonActiveMatch('blue-a');

    assert.equal(active.status, 'in_game');
    assert.deepEqual(active.abandonedUserIds, ['blue-a']);
    assert.equal(platform.store.activeMatchForUser('blue-a'), null);
    assert.equal(platform.store.activeMatchForUser('blue-b').id, match.id);
    assert.equal(platform.store.activeMatchForUser('red-a').id, match.id);
    const abandonedHero = platform.runtimeSnapshot(match.id).find(state => state.userId === 'blue-a');
    assert.ok(abandonedHero);
    assert.equal(abandonedHero.currentHp, 500);
    assert.equal(abandonedHero.alive, true);
    assert.equal(abandonedHero.moving, false);
  });
});


test('active match runtime state is shared by match id and survives as an in-memory snapshot', async () => {
  await withServer(async ({ platform }) => {
    const match = {
      id: 'runtime-room-1',
      mode: 'normal',
      source: 'matchmaking',
      rated: false,
      status: 'in_game',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      players: [
        { userId: 'runtime-blue', username: 'Runtime Blue', rating: 1000, joinedAt: 1, team: 'blue', slot: 0 },
        { userId: 'runtime-red', username: 'Runtime Red', rating: 1000, joinedAt: 1, team: 'red', slot: 0 },
      ],
      resultToken: 'secret',
      mapSha256: null,
      heroSelections: {
        'runtime-blue': { heroId: 'H001', locked: true, lockedAt: Date.now() },
        'runtime-red': { heroId: 'H001', locked: true, lockedAt: Date.now() },
      },
    };

    platform.store.addMatch(match);
    const published = platform.reportMatchRuntimeState('runtime-blue', {
      matchId: match.id,
      sequence: 7,
      position: { x: -12.5, y: 5.3, z: 9.25 },
      yaw: 1.2,
      moving: true,
      currentHp: 640,
      maxHp: 700,
      currentResource: 285,
      maxResource: 318,
      level: 2,
      alive: true,
    });

    assert.equal(published.userId, 'runtime-blue');
    assert.equal(published.heroId, 'H001');
    assert.equal(published.team, 'blue');
    assert.equal(published.sequence, 7);
    assert.deepEqual(published.position, { x: -12.5, y: 5.3, z: 9.25 });

    const snapshot = platform.runtimeSnapshot(match.id);
    assert.equal(snapshot.length, 1);
    assert.equal(snapshot[0].username, 'Runtime Blue');
    assert.equal(snapshot[0].currentHp, 640);
  });
});


test('shared player combat updates the target runtime snapshot', async () => {
  await withServer(async ({ platform }) => {
    const match = {
      id: 'runtime-combat-1v1',
      mode: 'normal',
      source: 'matchmaking',
      rated: false,
      status: 'in_game',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      players: [
        { userId: 'combat-blue', username: 'Combat Blue', rating: 1000, joinedAt: 1, team: 'blue', slot: 0 },
        { userId: 'combat-red', username: 'Combat Red', rating: 1000, joinedAt: 1, team: 'red', slot: 0 },
      ],
      resultToken: 'secret',
      mapSha256: null,
      heroSelections: {
        'combat-blue': { heroId: 'H001', locked: true, lockedAt: Date.now() },
        'combat-red': { heroId: 'H001', locked: true, lockedAt: Date.now() },
      },
    };

    platform.store.addMatch(match);
    platform.reportMatchRuntimeState('combat-blue', {
      matchId: match.id, sequence: 1, position: { x: 0, y: 0, z: 0 }, yaw: 0,
      moving: false, currentHp: 700, maxHp: 700, currentResource: 300, maxResource: 300, level: 1, alive: true,
    });
    platform.reportMatchRuntimeState('combat-red', {
      matchId: match.id, sequence: 1, position: { x: 1, y: 0, z: 0 }, yaw: 0,
      moving: false, currentHp: 700, maxHp: 700, currentResource: 300, maxResource: 300, level: 1, alive: true,
    });

    const event = platform.reportMatchRuntimeCombat('combat-blue', {
      matchId: match.id,
      targetUserId: 'combat-red',
      reason: 'damage',
      amount: 66,
    });

    assert.equal(event.targetUserId, 'combat-red');
    assert.equal(event.amount, 66);
    const target = platform.runtimeSnapshot(match.id).find(state => state.userId === 'combat-red');
    assert.equal(target.currentHp, 634);
    assert.equal(target.alive, true);
  });
});


test('server owns hero mitigation death and rejects stale client resurrection', async () => {
  await withServer(async ({ platform }) => {
    const match = {
      id: 'runtime-combat-canonical',
      mode: 'normal',
      source: 'matchmaking',
      rated: false,
      status: 'in_game',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      players: [
        { userId: 'resolve-blue', username: 'Resolve Blue', rating: 1000, joinedAt: 1, team: 'blue', slot: 0 },
        { userId: 'resolve-red', username: 'Resolve Red', rating: 1000, joinedAt: 1, team: 'red', slot: 0 },
      ],
      resultToken: 'secret',
      mapSha256: null,
      heroSelections: {
        'resolve-blue': { heroId: 'H001', locked: true, lockedAt: Date.now() },
        'resolve-red': { heroId: 'H001', locked: true, lockedAt: Date.now() },
      },
    };
    platform.store.addMatch(match);
    platform.reportMatchRuntimeState('resolve-blue', {
      matchId: match.id, sequence: 1, position: { x: 0, y: 5, z: 0 }, yaw: Math.PI / 2,
      moving: false, currentHp: 700, maxHp: 700, currentResource: 300, maxResource: 300,
      level: 1, alive: true, abilityRanks: { Q: 0, W: 0, E: 0, R: 0 },
    });
    platform.reportMatchRuntimeState('resolve-red', {
      matchId: match.id, sequence: 1, position: { x: 2, y: 5, z: 0 }, yaw: -Math.PI / 2,
      moving: false, currentHp: 50, maxHp: 700, currentResource: 300, maxResource: 300,
      level: 1, alive: true, abilityRanks: { Q: 0, W: 1, E: 0, R: 0 },
    });

    platform.reportMatchRuntimeAbilityCast('resolve-red', {
      matchId: match.id,
      key: 'W',
      rank: 1,
    });

    const guarded = platform.reportMatchRuntimeCombat('resolve-blue', {
      matchId: match.id,
      targetUserId: 'resolve-red',
      reason: 'damage',
      amount: 80,
    });
    assert.equal(guarded.lethal, false);
    assert.equal(guarded.resolvedAmount, 48);

    let red = platform.runtimeSnapshot(match.id).find(state => state.userId === 'resolve-red');
    assert.equal(red.currentHp, 2);
    assert.equal(red.alive, true);
    assert.equal(red.deaths, 0);

    // A stale owner packet authored before the hit cannot put HP back.
    platform.reportMatchRuntimeState('resolve-red', {
      matchId: match.id, sequence: 2, position: { x: 2, y: 5, z: 0 }, yaw: -Math.PI / 2,
      moving: false, currentHp: 50, maxHp: 700, currentResource: 300, maxResource: 300,
      level: 1, alive: true, abilityRanks: { Q: 0, W: 1, E: 0, R: 0 },
    });
    red = platform.runtimeSnapshot(match.id).find(state => state.userId === 'resolve-red');
    assert.equal(red.currentHp, 2);

    // Legacy victim-resolution packets are accepted as compatibility no-ops only.
    platform.reportMatchRuntimeCombatResolve('resolve-red', {
      matchId: match.id,
      combatId: guarded.combatId,
      currentHp: 25,
      currentResource: 300,
      alive: true,
    });
    red = platform.runtimeSnapshot(match.id).find(state => state.userId === 'resolve-red');
    assert.equal(red.currentHp, 2);

    const lethal = platform.reportMatchRuntimeCombat('resolve-blue', {
      matchId: match.id,
      targetUserId: 'resolve-red',
      reason: 'damage',
      amount: 100,
    });
    assert.equal(lethal.lethal, true);

    red = platform.runtimeSnapshot(match.id).find(state => state.userId === 'resolve-red');
    assert.equal(red.currentHp, 0);
    assert.equal(red.alive, false);
    assert.equal(red.deaths, 1);

    platform.reportMatchRuntimeState('resolve-red', {
      matchId: match.id, sequence: 3, position: { x: 2, y: 5, z: 0 }, yaw: -Math.PI / 2,
      moving: false, currentHp: 50, maxHp: 700, currentResource: 300, maxResource: 300,
      level: 1, alive: true, abilityRanks: { Q: 0, W: 1, E: 0, R: 0 },
    });
    red = platform.runtimeSnapshot(match.id).find(state => state.userId === 'resolve-red');
    assert.equal(red.currentHp, 0);
    assert.equal(red.alive, false);
    assert.equal(red.deaths, 1);
  });
});

test('server serialization rejects late attacks from a hero already confirmed dead', async () => {
  await withServer(async ({ platform }) => {
    const match = {
      id: 'runtime-combat-dead-source',
      mode: 'normal',
      source: 'matchmaking',
      rated: false,
      status: 'in_game',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      players: [
        { userId: 'late-blue', username: 'Late Blue', rating: 1000, joinedAt: 1, team: 'blue', slot: 0 },
        { userId: 'late-red', username: 'Late Red', rating: 1000, joinedAt: 1, team: 'red', slot: 0 },
      ],
      resultToken: 'secret',
      mapSha256: null,
      heroSelections: {
        'late-blue': { heroId: 'H001', locked: true, lockedAt: Date.now() },
        'late-red': { heroId: 'H001', locked: true, lockedAt: Date.now() },
      },
    };
    platform.store.addMatch(match);

    for (const [userId, x] of [['late-blue', 0], ['late-red', 1]]) {
      platform.reportMatchRuntimeState(userId, {
        matchId: match.id,
        sequence: 1,
        position: { x, y: 5, z: 0 },
        yaw: 0,
        moving: false,
        currentHp: 50,
        maxHp: 700,
        currentResource: 300,
        maxResource: 300,
        level: 1,
        alive: true,
        abilityRanks: { Q: 0, W: 0, E: 0, R: 0 },
      });
    }

    const lethal = platform.reportMatchRuntimeCombat('late-red', {
      matchId: match.id,
      targetUserId: 'late-blue',
      reason: 'damage',
      amount: 100,
    });
    assert.equal(lethal.lethal, true);

    const latePacket = platform.reportMatchRuntimeCombat('late-blue', {
      matchId: match.id,
      targetUserId: 'late-red',
      reason: 'damage',
      amount: 100,
    });
    assert.equal(latePacket, null);

    const states = platform.runtimeSnapshot(match.id);
    const blue = states.find(state => state.userId === 'late-blue');
    const red = states.find(state => state.userId === 'late-red');
    assert.equal(blue.currentHp, 0);
    assert.equal(blue.alive, false);
    assert.equal(blue.deaths, 1);
    assert.equal(red.currentHp, 50);
    assert.equal(red.alive, true);
    assert.equal(red.kills, 1);
  });
});

test('server respawns a dead hero at its captured spawn and rejects a stale corpse packet', async () => {
  await withServer(async ({ platform }) => {
    const match = {
      id: 'runtime-server-respawn',
      mode: 'normal',
      source: 'matchmaking',
      rated: false,
      status: 'in_game',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      players: [
        { userId: 'respawn-blue', username: 'Respawn Blue', rating: 1000, joinedAt: 1, team: 'blue', slot: 0 },
        { userId: 'respawn-red', username: 'Respawn Red', rating: 1000, joinedAt: 1, team: 'red', slot: 0 },
      ],
      resultToken: 'secret',
      mapSha256: null,
      heroSelections: {
        'respawn-blue': { heroId: 'H001', locked: true, lockedAt: Date.now() },
        'respawn-red': { heroId: 'H001', locked: true, lockedAt: Date.now() },
      },
    };
    platform.store.addMatch(match);

    platform.reportMatchRuntimeState('respawn-blue', {
      matchId: match.id,
      sequence: 1,
      position: { x: -12, y: 5.28, z: -20 },
      yaw: 0,
      moving: false,
      currentHp: 50,
      maxHp: 700,
      currentResource: 120,
      maxResource: 300,
      level: 1,
      alive: true,
      abilityRanks: { Q: 0, W: 0, E: 0, R: 0 },
    });
    platform.reportMatchRuntimeState('respawn-red', {
      matchId: match.id,
      sequence: 1,
      position: { x: -10, y: 5.28, z: -20 },
      yaw: 0,
      moving: false,
      currentHp: 700,
      maxHp: 700,
      currentResource: 300,
      maxResource: 300,
      level: 1,
      alive: true,
      abilityRanks: { Q: 0, W: 0, E: 0, R: 0 },
    });

    platform.reportMatchRuntimeCombat('respawn-red', {
      matchId: match.id,
      targetUserId: 'respawn-blue',
      reason: 'damage',
      amount: 100,
    });
    let blue = platform.runtimeSnapshot(match.id).find(state => state.userId === 'respawn-blue');
    assert.equal(blue.alive, false);
    assert.equal(blue.currentHp, 0);
    assert.equal(blue.deaths, 1);

    await wait(60);
    blue = platform.runtimeSnapshot(match.id).find(state => state.userId === 'respawn-blue');
    assert.equal(blue.alive, true);
    assert.equal(blue.currentHp, 700);
    assert.equal(blue.currentResource, 300);
    assert.deepEqual(blue.position, { x: -12, y: 5.28, z: -20 });

    platform.reportMatchRuntimeState('respawn-blue', {
      matchId: match.id,
      sequence: 99,
      position: { x: 3, y: 0, z: 4 },
      yaw: 2,
      moving: false,
      currentHp: 0,
      maxHp: 700,
      currentResource: 120,
      maxResource: 300,
      level: 1,
      alive: false,
      abilityRanks: { Q: 0, W: 0, E: 0, R: 0 },
    });
    blue = platform.runtimeSnapshot(match.id).find(state => state.userId === 'respawn-blue');
    assert.equal(blue.alive, true);
    assert.equal(blue.currentHp, 700);
    assert.deepEqual(blue.position, { x: -12, y: 5.28, z: -20 });
    assert.equal(blue.deaths, 1);
  }, { heroRespawnBaseSeconds: 0.02, heroRespawnPerLevelSeconds: 0 });
});

test('server keeps creep and structure HP canonical against stale simulator snapshots', async () => {
  await withServer(async ({ platform }) => {
    const match = {
      id: 'world-state-canonical',
      mode: 'normal',
      source: 'matchmaking',
      rated: false,
      status: 'in_game',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      players: [
        { userId: 'world-blue', username: 'World Blue', rating: 1000, joinedAt: 1, team: 'blue', slot: 0 },
        { userId: 'world-red', username: 'World Red', rating: 1000, joinedAt: 1, team: 'red', slot: 0 },
      ],
      resultToken: 'secret',
      mapSha256: null,
    };
    platform.store.addMatch(match);

    platform.reportMatchRuntimeCreeps('world-blue', {
      matchId: match.id,
      sequence: 50,
      sentAt: Date.now(),
      elapsedSeconds: 10,
      creeps: [{
        id: 'lane-creep:red:mid:1:1',
        team: 'red',
        lane: 'mid',
        type: 'melee',
        position: { x: 0, y: 0, z: 0 },
        yaw: 0,
        currentHp: 500,
        maxHp: 500,
        alive: true,
        state: 'ATTACK_MOVE',
        moving: true,
        seed: 1,
        attackSequence: 0,
      }],
    });
    platform.reportMatchRuntimeCreepDamage('world-blue', {
      matchId: match.id,
      creepId: 'lane-creep:red:mid:1:1',
      amount: 125,
    });
    let creep = platform.runtimeCreepSnapshot(match.id).creeps[0];
    assert.equal(creep.currentHp, 375);

    platform.reportMatchRuntimeCreeps('world-blue', {
      matchId: match.id,
      sequence: 999,
      sentAt: Date.now(),
      elapsedSeconds: 11,
      creeps: [{ ...creep, currentHp: 500, alive: true }],
    });
    creep = platform.runtimeCreepSnapshot(match.id).creeps[0];
    assert.equal(creep.currentHp, 375);

    platform.reportMatchRuntimeStructures('world-blue', {
      matchId: match.id,
      sequence: 500,
      structures: [{
        id: 'red-mid-1-tower',
        team: 'red',
        kind: 'tower',
        currentHp: 1000,
        maxHp: 1000,
        alive: true,
      }],
    });
    platform.reportMatchRuntimeStructureDamage('world-blue', {
      matchId: match.id,
      structureId: 'red-mid-1-tower',
      amount: 250,
    });
    let tower = platform.runtimeStructureSnapshot(match.id).structures[0];
    assert.equal(tower.currentHp, 750);

    platform.reportMatchRuntimeStructures('world-blue', {
      matchId: match.id,
      sequence: 999,
      structures: [{ ...tower, currentHp: 1000, alive: true }],
    });
    tower = platform.runtimeStructureSnapshot(match.id).structures[0];
    assert.equal(tower.currentHp, 750);
  });
});

test('one disconnected team gets a reconnect grace period before the other team wins', async () => {
  await withServer(async ({ baseUrl, port, platform }) => {
    const blue = await jsonFetch(`${baseUrl}/api/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'GraceBlue', password: 'Iron!Crown42' }),
    });
    const red = await jsonFetch(`${baseUrl}/api/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'GraceRed', password: 'Iron!Crown42' }),
    });
    const match = {
      id: 'disconnect-team-grace',
      mode: 'normal',
      source: 'matchmaking',
      rated: true,
      status: 'in_game',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      players: [
        { userId: blue.body.user.id, username: 'GraceBlue', rating: 1000, joinedAt: 1, team: 'blue', slot: 0 },
        { userId: red.body.user.id, username: 'GraceRed', rating: 1000, joinedAt: 1, team: 'red', slot: 0 },
      ],
      resultToken: 'secret',
      mapSha256: null,
    };
    platform.store.addMatch(match);

    const blueSocket = await openWebsocket(port, blue.body.token);
    const redSocket = await openWebsocket(port, red.body.token);
    await wait(10);
    blueSocket.destroy();

    await wait(80);
    const ended = platform.store.match(match.id);
    assert.equal(ended.status, 'completed');
    assert.equal(ended.winnerTeam, 'red');
    assert.equal(ended.endReason, 'team_disconnect_timeout');
    redSocket.destroy();
  }, { matchReconnectGraceMs: 40 });
});

test('all disconnected players void the match after the shared grace period', async () => {
  await withServer(async ({ baseUrl, port, platform }) => {
    const blue = await jsonFetch(`${baseUrl}/api/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'VoidBlue', password: 'Iron!Crown42' }),
    });
    const red = await jsonFetch(`${baseUrl}/api/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'VoidRed', password: 'Iron!Crown42' }),
    });
    const match = {
      id: 'disconnect-all-grace',
      mode: 'ranked',
      source: 'matchmaking',
      rated: true,
      status: 'in_game',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      players: [
        { userId: blue.body.user.id, username: 'VoidBlue', rating: 1000, joinedAt: 1, team: 'blue', slot: 0 },
        { userId: red.body.user.id, username: 'VoidRed', rating: 1000, joinedAt: 1, team: 'red', slot: 0 },
      ],
      resultToken: 'secret',
      mapSha256: null,
    };
    platform.store.addMatch(match);

    const blueSocket = await openWebsocket(port, blue.body.token);
    const redSocket = await openWebsocket(port, red.body.token);
    await wait(10);
    blueSocket.destroy();
    redSocket.destroy();

    await wait(80);
    const ended = platform.store.match(match.id);
    assert.equal(ended.status, 'cancelled');
    assert.equal(ended.winnerTeam, null);
    assert.equal(ended.rated, false);
    assert.equal(ended.endReason, 'all_disconnected_timeout');
  }, { matchReconnectGraceMs: 40 });
});

test('reconnecting inside the grace period keeps the match alive', async () => {
  await withServer(async ({ baseUrl, port, platform }) => {
    const blue = await jsonFetch(`${baseUrl}/api/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'ReturnBlue', password: 'Iron!Crown42' }),
    });
    const red = await jsonFetch(`${baseUrl}/api/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'ReturnRed', password: 'Iron!Crown42' }),
    });
    const match = {
      id: 'disconnect-rejoin-grace',
      mode: 'normal',
      source: 'matchmaking',
      rated: false,
      status: 'in_game',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      players: [
        { userId: blue.body.user.id, username: 'ReturnBlue', rating: 1000, joinedAt: 1, team: 'blue', slot: 0 },
        { userId: red.body.user.id, username: 'ReturnRed', rating: 1000, joinedAt: 1, team: 'red', slot: 0 },
      ],
      resultToken: 'secret',
      mapSha256: null,
    };
    platform.store.addMatch(match);

    let blueSocket = await openWebsocket(port, blue.body.token);
    const redSocket = await openWebsocket(port, red.body.token);
    await wait(10);
    blueSocket.destroy();
    await wait(20);
    blueSocket = await openWebsocket(port, blue.body.token);

    await wait(70);
    assert.equal(platform.store.match(match.id).status, 'in_game');
    blueSocket.destroy();
    redSocket.destroy();
  }, { matchReconnectGraceMs: 60 });
});


test('simulation lease migrates when its producer disconnects while server state remains canonical', async () => {
  await withServer(async ({ baseUrl, port, platform }) => {
    const blue = await jsonFetch(`${baseUrl}/api/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'AuthorityBlue', password: 'Iron!Crown42' }),
    });
    const red = await jsonFetch(`${baseUrl}/api/register`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'AuthorityRed', password: 'Iron!Crown42' }),
    });
    const match = {
      id: 'authority-migration',
      mode: 'normal',
      source: 'matchmaking',
      rated: false,
      status: 'in_game',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      players: [
        { userId: blue.body.user.id, username: 'AuthorityBlue', rating: 1000, joinedAt: 1, team: 'blue', slot: 0 },
        { userId: red.body.user.id, username: 'AuthorityRed', rating: 1000, joinedAt: 1, team: 'red', slot: 0 },
      ],
      resultToken: 'secret',
      mapSha256: null,
    };
    platform.store.addMatch(match);

    let blueSocket = await openWebsocket(port, blue.body.token);
    const redSocket = await openWebsocket(port, red.body.token);
    await wait(10);

    const blueSnapshot = platform.reportMatchRuntimeCreeps(blue.body.user.id, {
      matchId: match.id,
      sequence: 1,
      sentAt: Date.now(),
      elapsedSeconds: 10,
      creeps: [],
    });
    assert.equal(blueSnapshot.authorityUserId, blue.body.user.id);

    blueSocket.destroy();
    await wait(20);

    const redSnapshot = platform.reportMatchRuntimeCreeps(red.body.user.id, {
      matchId: match.id,
      sequence: 1,
      sentAt: Date.now(),
      elapsedSeconds: 12,
      creeps: [],
    });
    assert.equal(redSnapshot.authorityUserId, red.body.user.id);

    blueSocket = await openWebsocket(port, blue.body.token);
    await wait(10);

    const stillRed = platform.reportMatchRuntimeCreeps(red.body.user.id, {
      matchId: match.id,
      sequence: 2,
      sentAt: Date.now(),
      elapsedSeconds: 13,
      creeps: [],
    });
    assert.equal(stillRed.authorityUserId, red.body.user.id);
    assert.throws(() => platform.reportMatchRuntimeCreeps(blue.body.user.id, {
      matchId: match.id,
      sequence: 3,
      sentAt: Date.now(),
      elapsedSeconds: 13,
      creeps: [],
    }), /Solo la autoridad/);

    blueSocket.destroy();
    redSocket.destroy();
  }, { matchReconnectGraceMs: 200 });
});
