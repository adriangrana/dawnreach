import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { SessionManager } from '../server/auth/session-manager.mjs';
import { validatePassword } from '../server/auth/password-policy.mjs';
import { hashBearerToken, hashPassword, verifyPassword } from '../server/security.mjs';
import { PlatformStore } from '../server/store.mjs';

const policy = {
  sessionAbsoluteTtlHours: 24,
  sessionIdleTtlHours: 2,
  maxSessionsPerUser: 3,
};

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dawnreach-platform-'));
}

test('password hashes verify without persisting the plaintext password', () => {
  const encoded = hashPassword('IronCrown!42');
  assert.equal(encoded.includes('IronCrown!42'), false);
  assert.equal(verifyPassword('IronCrown!42', encoded), true);
  assert.equal(verifyPassword('WrongCrown!42', encoded), false);
});

test('Dawnreach password policy rejects weak/common and username-derived secrets', () => {
  assert.throws(() => validatePassword('password123', 'Alden', 10));
  assert.throws(() => validatePassword('Alden!Strong42', 'Alden', 10));
  assert.equal(validatePassword('Iron!Crown42', 'Alden', 10), true);
});

test('platform store registers users case-insensitively and authenticates them', () => {
  const root = tempDir();
  try {
    const store = new PlatformStore(path.join(root, 'users.json'));
    const user = store.registerWithPassword('Pepe', 'Iron!Crown42');
    assert.equal(user.username, 'Pepe');
    assert.equal(store.authenticate('pepe', 'Iron!Crown42')?.id, user.id);
    assert.throws(() => store.registerWithPassword('PEPE', 'Other!Crown42'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('sessions persist only bearer digests and can be revoked', () => {
  const root = tempDir();
  try {
    const file = path.join(root, 'sessions.json');
    const sessions = new SessionManager(file, policy, 1_000);
    const issued = sessions.issue('user-1', 1_000, 'Test client');
    const raw = fs.readFileSync(file, 'utf8');
    assert.equal(raw.includes(issued.token), false);
    assert.equal(raw.includes(hashBearerToken(issued.token)), true);
    assert.equal(sessions.authenticate(issued.token, 1_001)?.userId, 'user-1');
    assert.equal(sessions.revoke(issued.token, 1_002), true);
    assert.equal(sessions.authenticate(issued.token, 1_003), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
