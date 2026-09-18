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

async function withServer(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dawnreach-server-'));
  const platform = createPlatformServer({ config: testConfig(root), logger: { error() {} } });
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


test('abandoning the last player on a team ends the active match and clears reconnect state', async () => {
  await withServer(async ({ platform }) => {
    const match = {
      id: 'abandon-1v1',
      mode: 'normal',
      source: 'matchmaking',
      rated: false,
      status: 'in_game',
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      players: [
        { userId: 'blue-player', username: 'Blue', rating: 1000, joinedAt: 1, team: 'blue', slot: 0 },
        { userId: 'red-player', username: 'Red', rating: 1000, joinedAt: 1, team: 'red', slot: 5 },
      ],
      resultToken: 'secret',
      mapSha256: null,
      heroSelections: {
        'blue-player': { heroId: 'H001', locked: true, lockedAt: Date.now() },
        'red-player': { heroId: 'H001', locked: true, lockedAt: Date.now() },
      },
    };

    platform.store.addMatch(match);
    const ended = platform.abandonActiveMatch('blue-player');

    assert.equal(ended.status, 'completed');
    assert.equal(ended.endReason, 'team_abandonment');
    assert.equal(ended.winnerTeam, 'red');
    assert.deepEqual(ended.abandonedUserIds, ['blue-player']);
    assert.equal(platform.store.activeMatchForUser('blue-player'), null);
    assert.equal(platform.store.activeMatchForUser('red-player'), null);
  });
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
    const active = platform.abandonActiveMatch('blue-a');

    assert.equal(active.status, 'in_game');
    assert.deepEqual(active.abandonedUserIds, ['blue-a']);
    assert.equal(platform.store.activeMatchForUser('blue-a'), null);
    assert.equal(platform.store.activeMatchForUser('blue-b').id, match.id);
    assert.equal(platform.store.activeMatchForUser('red-a').id, match.id);
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
