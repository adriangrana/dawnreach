import fs from 'node:fs';
import path from 'node:path';
import { hashPassword, randomToken, verifyPassword } from './security.mjs';

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}

function readState(file) {
  if (!fs.existsSync(file)) return { users: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { users: Array.isArray(parsed.users) ? parsed.users : [] };
  } catch {
    return { users: [] };
  }
}

function normalizeUsername(value) {
  return String(value || '').trim();
}

function validateUsername(username) {
  if (username.length < 3 || username.length > 24) throw new Error('El nombre de usuario debe tener entre 3 y 24 caracteres.');
  if (!/^[A-Za-z0-9_.-]+$/.test(username)) throw new Error('Usa solo letras, números, punto, guion o guion bajo.');
}

export class PlatformStore {
  #state;

  constructor(filePath) {
    this.filePath = filePath;
    this.#state = readState(filePath);
  }

  #persist() {
    writeJsonAtomic(this.filePath, this.#state);
  }

  publicUser(user) {
    if (!user) return null;
    return { id: user.id, username: user.username, createdAt: user.createdAt };
  }

  getUser(id) {
    return this.#state.users.find(user => user.id === id) || null;
  }

  findByUsername(username) {
    const key = normalizeUsername(username).toLowerCase();
    return this.#state.users.find(user => user.username.toLowerCase() === key) || null;
  }

  register(username, passwordHash) {
    const clean = normalizeUsername(username);
    validateUsername(clean);
    if (this.findByUsername(clean)) throw new Error('Ese nombre de usuario ya está registrado.');
    const user = { id: randomToken(12), username: clean, passwordHash, createdAt: new Date().toISOString() };
    this.#state.users.push(user);
    this.#persist();
    return this.publicUser(user);
  }

  registerWithPassword(username, password) {
    return this.register(username, hashPassword(password));
  }

  authenticate(username, password) {
    const user = this.findByUsername(username);
    if (!user || !verifyPassword(password, user.passwordHash)) return null;
    return this.publicUser(user);
  }
}
