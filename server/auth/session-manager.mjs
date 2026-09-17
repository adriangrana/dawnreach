import fs from 'node:fs';
import path from 'node:path';
import { hashBearerToken, randomToken } from '../security.mjs';

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temp, file);
}

function readState(file) {
  if (!fs.existsSync(file)) return { sessions: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [] };
  } catch {
    return { sessions: [] };
  }
}

export class SessionManager {
  #state;
  #absoluteTtlMs;
  #idleTtlMs;

  constructor(filePath, policy, now = Date.now()) {
    this.filePath = filePath;
    this.policy = policy;
    this.#absoluteTtlMs = policy.sessionAbsoluteTtlHours * 60 * 60 * 1000;
    this.#idleTtlMs = policy.sessionIdleTtlHours * 60 * 60 * 1000;
    this.#state = readState(filePath);
    this.#prune(now);
    this.#persist();
  }

  #persist() {
    writeJsonAtomic(this.filePath, this.#state);
  }

  #expired(session, now) {
    return Boolean(session.revokedAt) || now >= session.expiresAt || now - session.lastSeenAt >= this.#idleTtlMs;
  }

  #prune(now) {
    const retentionMs = 30 * 24 * 60 * 60 * 1000;
    this.#state.sessions = this.#state.sessions.filter(session => {
      if (!this.#expired(session, now)) return true;
      const terminalAt = session.revokedAt || Math.min(session.expiresAt, session.lastSeenAt + this.#idleTtlMs);
      return now - terminalAt < retentionMs;
    });
  }

  issue(userId, now = Date.now(), label = 'Dawnreach Desktop') {
    const active = this.#state.sessions
      .filter(session => session.userId === userId && !this.#expired(session, now))
      .sort((a, b) => a.createdAt - b.createdAt);
    while (active.length >= this.policy.maxSessionsPerUser) {
      const oldest = active.shift();
      if (oldest) oldest.revokedAt = now;
    }

    const token = randomToken(32);
    const session = {
      id: randomToken(12),
      tokenHash: hashBearerToken(token),
      userId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: now + this.#absoluteTtlMs,
      label: String(label || 'Dawnreach Desktop').slice(0, 80),
    };
    this.#state.sessions.push(session);
    this.#prune(now);
    this.#persist();
    return { token, session: this.view(session, true) };
  }

  authenticate(token, now = Date.now()) {
    const clean = String(token || '');
    if (!clean) return null;
    const tokenHash = hashBearerToken(clean);
    const session = this.#state.sessions.find(candidate => candidate.tokenHash === tokenHash);
    if (!session) return null;
    if (this.#expired(session, now)) {
      if (!session.revokedAt) session.revokedAt = now;
      this.#persist();
      return null;
    }
    if (now - session.lastSeenAt >= 60_000) {
      session.lastSeenAt = now;
      this.#persist();
    }
    return { userId: session.userId, sessionId: session.id };
  }

  revoke(token, now = Date.now()) {
    const tokenHash = hashBearerToken(String(token || ''));
    const session = this.#state.sessions.find(candidate => candidate.tokenHash === tokenHash && !candidate.revokedAt);
    if (!session) return false;
    session.revokedAt = now;
    this.#persist();
    return true;
  }

  sessionsFor(userId, currentToken, now = Date.now()) {
    const currentHash = hashBearerToken(String(currentToken || ''));
    return this.#state.sessions
      .filter(session => session.userId === userId && !this.#expired(session, now))
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .map(session => this.view(session, session.tokenHash === currentHash));
  }

  view(session, current) {
    return {
      id: session.id,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      expiresAt: session.expiresAt,
      label: session.label,
      current,
    };
  }
}
