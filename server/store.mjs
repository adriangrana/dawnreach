import fs from 'node:fs';
import { hashPassword, randomToken, verifyPassword } from './security.mjs';
import { writeJsonAtomic } from './json-file.mjs';

function readState(file) {
  if (!fs.existsSync(file)) return { users: [], friendRequests: [], friendships: [], messages: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      friendRequests: Array.isArray(parsed.friendRequests) ? parsed.friendRequests : [],
      friendships: Array.isArray(parsed.friendships) ? parsed.friendships : [],
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    };
  } catch {
    return { users: [], friendRequests: [], friendships: [], messages: [] };
  }
}

function normalizeUsername(value) {
  return String(value || '').trim();
}

function validateUsername(username) {
  if (username.length < 3 || username.length > 24) throw new Error('El nombre de usuario debe tener entre 3 y 24 caracteres.');
  if (!/^[A-Za-z0-9_.-]+$/.test(username)) throw new Error('Usa solo letras, números, punto, guion o guion bajo.');
}

function friendshipKey(first, second) {
  return [String(first), String(second)].sort().join(':');
}

function cleanMessage(value) {
  return String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, 500);
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

  searchUsers(query, viewerId, limit = 20) {
    const needle = normalizeUsername(query).toLowerCase();
    if (needle.length < 2) return [];
    return this.#state.users
      .filter(user => user.id !== viewerId && user.username.toLowerCase().includes(needle))
      .sort((a, b) => {
        const aStarts = Number(a.username.toLowerCase().startsWith(needle));
        const bStarts = Number(b.username.toLowerCase().startsWith(needle));
        return bStarts - aStarts || a.username.localeCompare(b.username);
      })
      .slice(0, Math.max(1, Math.min(50, limit)))
      .map(user => this.publicUser(user));
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

  areFriends(firstUserId, secondUserId) {
    const key = friendshipKey(firstUserId, secondUserId);
    return this.#state.friendships.some(friendship => friendship.key === key);
  }

  friendsOf(userId) {
    const friendIds = this.#state.friendships.flatMap(friendship => {
      if (friendship.userA === userId) return [friendship.userB];
      if (friendship.userB === userId) return [friendship.userA];
      return [];
    });
    return friendIds.map(id => this.publicUser(this.getUser(id))).filter(Boolean);
  }

  incomingFriendRequests(userId) {
    return this.#state.friendRequests.filter(request => request.toUserId === userId);
  }

  outgoingFriendRequests(userId) {
    return this.#state.friendRequests.filter(request => request.fromUserId === userId);
  }

  createFriendRequest(fromUserId, toUserId) {
    if (fromUserId === toUserId) throw new Error('No puedes enviarte una solicitud a ti mismo.');
    if (!this.getUser(toUserId)) throw new Error('El usuario solicitado no existe.');
    if (this.areFriends(fromUserId, toUserId)) throw new Error('Ya sois amigos.');
    const existing = this.#state.friendRequests.find(request =>
      (request.fromUserId === fromUserId && request.toUserId === toUserId)
      || (request.fromUserId === toUserId && request.toUserId === fromUserId));
    if (existing) throw new Error('Ya existe una solicitud de amistad entre ambos usuarios.');
    const request = { id: randomToken(10), fromUserId, toUserId, createdAt: new Date().toISOString() };
    this.#state.friendRequests.push(request);
    this.#persist();
    return request;
  }

  respondFriendRequest(userId, requestId, accept) {
    const index = this.#state.friendRequests.findIndex(request => request.id === requestId && request.toUserId === userId);
    if (index < 0) throw new Error('La solicitud de amistad ya no está disponible.');
    const [request] = this.#state.friendRequests.splice(index, 1);
    if (accept && !this.areFriends(request.fromUserId, request.toUserId)) {
      const [userA, userB] = [request.fromUserId, request.toUserId].sort();
      this.#state.friendships.push({ key: friendshipKey(userA, userB), userA, userB, createdAt: new Date().toISOString() });
    }
    this.#persist();
    return request;
  }

  removeFriendship(userId, friendUserId) {
    const key = friendshipKey(userId, friendUserId);
    const before = this.#state.friendships.length;
    this.#state.friendships = this.#state.friendships.filter(friendship => friendship.key !== key);
    if (this.#state.friendships.length === before) return false;
    this.#persist();
    return true;
  }

  unreadCount(userId, friendUserId) {
    return this.#state.messages.filter(message =>
      message.toUserId === userId && message.fromUserId === friendUserId && !message.readAt).length;
  }

  sendDirectMessage(fromUserId, toUserId, text) {
    if (!this.areFriends(fromUserId, toUserId)) throw new Error('Solo puedes enviar mensajes directos a tus amigos.');
    const clean = cleanMessage(text);
    if (!clean) throw new Error('El mensaje está vacío.');
    const message = {
      id: randomToken(12),
      fromUserId,
      toUserId,
      text: clean,
      createdAt: new Date().toISOString(),
      readAt: null,
    };
    this.#state.messages.push(message);
    if (this.#state.messages.length > 10_000) this.#state.messages.splice(0, this.#state.messages.length - 10_000);
    this.#persist();
    return { ...message };
  }

  conversation(userId, friendUserId, limit = 100) {
    if (!this.areFriends(userId, friendUserId)) throw new Error('Ese usuario no está en tu lista de amigos.');
    return this.#state.messages
      .filter(message =>
        (message.fromUserId === userId && message.toUserId === friendUserId)
        || (message.fromUserId === friendUserId && message.toUserId === userId))
      .slice(-Math.max(1, Math.min(200, limit)))
      .map(message => ({ ...message }));
  }

  markConversationRead(userId, friendUserId) {
    const now = new Date().toISOString();
    let changed = false;
    for (const message of this.#state.messages) {
      if (message.toUserId === userId && message.fromUserId === friendUserId && !message.readAt) {
        message.readAt = now;
        changed = true;
      }
    }
    if (changed) this.#persist();
    return changed;
  }
}
