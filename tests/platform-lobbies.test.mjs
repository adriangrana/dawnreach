import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { LobbyManager } from '../server/lobbies.mjs';
import { PlatformStore } from '../server/store.mjs';

function withLobbies(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dawnreach-lobbies-'));
  const store = new PlatformStore(path.join(root, 'users.json'));
  const events = [];
  const launches = [];
  const lobbies = new LobbyManager({
    store,
    onEvent: (event, userIds) => events.push({ event, userIds }),
    onLaunch: match => launches.push(match),
  });
  try { return run({ store, lobbies, events, launches }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function addUser(store, username) {
  store.registerWithPassword(username, 'Iron!Crown42');
  return store.publicUser(store.findByUsername(username));
}

test('custom lobby creates public/private rooms, joins by code and transfers host', () => withLobbies(({ store, lobbies }) => {
  const host = addUser(store, 'LobbyHost');
  const guest = addUser(store, 'LobbyGuest');

  const lobby = lobbies.create(host, 'Scrim Dawnreach', 'public');
  assert.match(lobby.code, /^[A-HJ-NP-Z2-9]{5}$/);
  assert.equal(lobbies.listPublic().length, 1);
  assert.equal(lobby.players[0].team, 'blue');

  const joined = lobbies.join(guest, lobby.code);
  assert.equal(joined.players.length, 2);
  assert.equal(joined.players[1].team, 'red');

  lobbies.setReady(guest.id, true);
  assert.equal(lobbies.lobbyForUser(guest.id).players.find(player => player.userId === guest.id).ready, true);
  lobbies.move(guest.id, 'blue', 1);
  assert.equal(lobbies.lobbyForUser(guest.id).players.find(player => player.userId === guest.id).slot, 1);
  assert.equal(lobbies.lobbyForUser(guest.id).players.find(player => player.userId === guest.id).ready, false);

  lobbies.leave(host.id);
  assert.equal(lobbies.lobbyForUser(guest.id).ownerId, guest.id);

  lobbies.leave(guest.id);
  assert.equal(lobbies.listPublic().length, 0);

  const privateLobby = lobbies.create(host, 'Privada', 'private');
  assert.equal(privateLobby.privacy, 'private');
  assert.equal(lobbies.listPublic().length, 0);
}));

test('custom lobby keeps five slots per team and launches a non-rated custom match', () => withLobbies(({ store, lobbies, events, launches }) => {
  const users = Array.from({ length: 10 }, (_, index) => addUser(store, `Lobby${index + 1}`));
  const lobby = lobbies.create(users[0], 'Diez jugadores', 'public');
  for (const user of users.slice(1)) lobbies.join(user, lobby.code);

  const full = lobbies.lobbyForUser(users[0].id);
  assert.equal(full.players.filter(player => player.team === 'blue').length, 5);
  assert.equal(full.players.filter(player => player.team === 'red').length, 5);
  assert.equal(new Set(full.players.filter(player => player.team === 'blue').map(player => player.slot)).size, 5);
  assert.equal(new Set(full.players.filter(player => player.team === 'red').map(player => player.slot)).size, 5);

  assert.throws(() => lobbies.start(users[0].id), /deben estar listos/);
  for (const user of users) lobbies.setReady(user.id, true);

  const match = lobbies.start(users[0].id);
  assert.equal(match.mode, 'custom');
  assert.equal(match.source, 'custom');
  assert.equal(match.rated, false);
  assert.equal(match.players.length, 10);
  assert.deepEqual([...match.players.map(player => player.slot)].sort((a, b) => a - b), [0,1,2,3,4,5,6,7,8,9]);
  assert.equal(launches.length, 1);
  assert.equal(store.matches().at(-1).id, match.id);
  assert.ok(events.some(item => item.event.type === 'match.found'));
  assert.throws(() => lobbies.leave(users[1].id), /ya fue creada/);
}));


test('custom lobby chat keeps TEAM private and ALL visible to everyone in the lobby', () => withLobbies(({ store, lobbies }) => {
  const host = addUser(store, 'ChatHost');
  const dusk = addUser(store, 'ChatDusk');
  const dawn = addUser(store, 'ChatDawn');

  const lobby = lobbies.create(host, 'Chat room', 'public');
  lobbies.join(dusk, lobby.code);
  lobbies.join(dawn, lobby.code);

  lobbies.sendMessage(host.id, 'Dawn only plan', 'team');
  lobbies.sendMessage(dusk.id, 'Hello everyone', 'all');

  const hostView = lobbies.lobbyForUser(host.id);
  const dawnView = lobbies.lobbyForUser(dawn.id);
  const duskView = lobbies.lobbyForUser(dusk.id);

  assert.ok(hostView.messages.some(message => message.text === 'Dawn only plan' && message.channel === 'team'));
  assert.ok(dawnView.messages.some(message => message.text === 'Dawn only plan' && message.channel === 'team'));
  assert.equal(duskView.messages.some(message => message.text === 'Dawn only plan'), false);

  assert.ok(hostView.messages.some(message => message.text === 'Hello everyone' && message.channel === 'all'));
  assert.ok(dawnView.messages.some(message => message.text === 'Hello everyone' && message.channel === 'all'));
  assert.ok(duskView.messages.some(message => message.text === 'Hello everyone' && message.channel === 'all'));
}));

test('custom lobby requires both teams and every player ready before host can start', () => withLobbies(({ store, lobbies }) => {
  const host = addUser(store, 'ReadyHost');
  const guest = addUser(store, 'ReadyGuest');
  const lobby = lobbies.create(host, 'Ready room', 'public');

  assert.throws(() => lobbies.start(host.id), /al menos dos jugadores/);
  lobbies.join(guest, lobby.code);

  lobbies.setReady(host.id, true);
  assert.throws(() => lobbies.start(host.id), /deben estar listos/);

  lobbies.setReady(guest.id, true);
  const snapshot = lobbies.lobbyForUser(host.id);
  assert.equal(snapshot.players.every(player => player.ready), true);
  assert.doesNotThrow(() => lobbies.start(host.id));
}));
