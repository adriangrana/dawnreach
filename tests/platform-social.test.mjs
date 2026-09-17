import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { loadPlatformConfig } from '../server/config.mjs';
import { createPlatformServer } from '../server/platform-server.mjs';

function testConfig(dataDir) {
  return { ...loadPlatformConfig(), host: '127.0.0.1', port: 0, dataDir };
}

async function withServer(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dawnreach-social-'));
  const platform = createPlatformServer({ config: testConfig(root), logger: { error() {} } });
  const address = await platform.start({ host: '127.0.0.1', port: 0 });
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { await platform.close(); fs.rmSync(root, { recursive: true, force: true }); }
}

async function request(baseUrl, pathName, token, init = {}) {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(`${baseUrl}${pathName}`, { ...init, headers });
  return { status: response.status, body: await response.json() };
}

async function register(baseUrl, username) {
  const result = await request(baseUrl, '/api/register', '', {
    method: 'POST', body: JSON.stringify({ username, password: 'Iron!Crown42' }),
  });
  assert.equal(result.status, 201);
  return result.body;
}

test('social flow searches users, accepts friendship and exposes symmetric snapshots', async () => {
  await withServer(async baseUrl => {
    const pepe = await register(baseUrl, 'Pepe');
    const juan = await register(baseUrl, 'Juan');
    const search = await request(baseUrl, '/api/users/search?q=ju', pepe.token);
    assert.equal(search.status, 200);
    assert.equal(search.body.users[0].id, juan.user.id);

    const created = await request(baseUrl, '/api/friends/request', pepe.token, {
      method: 'POST', body: JSON.stringify({ userId: juan.user.id }),
    });
    assert.equal(created.status, 201);

    const incoming = await request(baseUrl, '/api/social/snapshot', juan.token);
    assert.equal(incoming.body.incoming.length, 1);
    assert.equal(incoming.body.incoming[0].user.username, 'Pepe');

    const accepted = await request(baseUrl, '/api/friends/respond', juan.token, {
      method: 'POST', body: JSON.stringify({ requestId: created.body.request.id, accept: true }),
    });
    assert.equal(accepted.status, 200);

    const pepeSocial = await request(baseUrl, '/api/social/snapshot', pepe.token);
    const juanSocial = await request(baseUrl, '/api/social/snapshot', juan.token);
    assert.equal(pepeSocial.body.friends[0].username, 'Juan');
    assert.equal(juanSocial.body.friends[0].username, 'Pepe');
  });
});

test('direct messages require friendship and unread count clears when conversation is read', async () => {
  await withServer(async baseUrl => {
    const pepe = await register(baseUrl, 'PepeMsg');
    const juan = await register(baseUrl, 'JuanMsg');

    const denied = await request(baseUrl, '/api/messages', pepe.token, {
      method: 'POST', body: JSON.stringify({ userId: juan.user.id, text: 'hola antes de amistad' }),
    });
    assert.equal(denied.status, 400);

    const created = await request(baseUrl, '/api/friends/request', pepe.token, {
      method: 'POST', body: JSON.stringify({ userId: juan.user.id }),
    });
    await request(baseUrl, '/api/friends/respond', juan.token, {
      method: 'POST', body: JSON.stringify({ requestId: created.body.request.id, accept: true }),
    });

    const sent = await request(baseUrl, '/api/messages', pepe.token, {
      method: 'POST', body: JSON.stringify({ userId: juan.user.id, text: '  Hola Juan  ' }),
    });
    assert.equal(sent.status, 201);
    assert.equal(sent.body.message.text, 'Hola Juan');

    const beforeRead = await request(baseUrl, '/api/social/snapshot', juan.token);
    assert.equal(beforeRead.body.friends[0].unread, 1);

    const conversation = await request(baseUrl, `/api/messages?userId=${encodeURIComponent(pepe.user.id)}`, juan.token);
    assert.equal(conversation.status, 200);
    assert.equal(conversation.body.messages[0].text, 'Hola Juan');

    const afterRead = await request(baseUrl, '/api/social/snapshot', juan.token);
    assert.equal(afterRead.body.friends[0].unread, 0);
  });
});
