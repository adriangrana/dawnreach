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
    await run({ baseUrl: `http://127.0.0.1:${address.port}`, port: address.port });
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
