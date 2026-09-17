import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { PartyManager } from '../server/parties.mjs';
import { PlatformStore } from '../server/store.mjs';

function withParty(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dawnreach-party-'));
  const store = new PlatformStore(path.join(root, 'users.json'));
  const events = [];
  const parties = new PartyManager({ store, onEvent: (event, userIds) => events.push({ event, userIds }) });
  try { return run({ store, parties, events }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function addUser(store, username) {
  store.registerWithPassword(username, 'Iron!Crown42');
  return store.publicUser(store.findByUsername(username));
}

test('players automatically have a solo party and return to one after leaving a group', () => withParty(({ store, parties, events }) => {
  const leader = addUser(store, 'Leader');
  const friend = addUser(store, 'Friend');

  const party = parties.partyForUser(leader.id);
  const friendSoloParty = parties.partyForUser(friend.id);
  assert.equal(party.members.length, 1);
  assert.equal(party.leaderId, leader.id);
  assert.equal(friendSoloParty.members.length, 1);
  assert.match(party.code, /^[A-HJ-NP-Z2-9]{5}$/);

  const invite = parties.invite(leader.id, friend.username);
  assert.equal(parties.snapshotFor(friend.id).invites.length, 1);
  assert.equal(parties.snapshotFor(friend.id).invites[0].from.username, leader.username);

  parties.accept(friend.id, invite.id);
  const joined = parties.snapshotFor(friend.id).party;
  assert.deepEqual(joined.members.map(member => member.id), [leader.id, friend.id]);
  assert.equal(parties.snapshotFor(friend.id).invites.length, 0);
  assert.equal(parties.parties.has(friendSoloParty.id), false);

  parties.leave(leader.id);
  const friendParty = parties.snapshotFor(friend.id).party;
  const leaderReplacement = parties.snapshotFor(leader.id).party;
  assert.equal(friendParty.leaderId, friend.id);
  assert.deepEqual(friendParty.members.map(member => member.id), [friend.id]);
  assert.equal(leaderReplacement.leaderId, leader.id);
  assert.deepEqual(leaderReplacement.members.map(member => member.id), [leader.id]);
  assert.notEqual(leaderReplacement.id, friendParty.id);
  assert.ok(events.some(item => item.event.type === 'party.invite'));
  assert.ok(events.some(item => item.event.type === 'party.snapshot'));
}));

test('party rules cap groups at five and move an accepter out of their solo party', () => withParty(({ store, parties }) => {
  const users = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'].map(name => addUser(store, name));
  parties.partyForUser(users[0].id);

  for (const user of users.slice(1, 5)) {
    const invite = parties.invite(users[0].id, user.username);
    parties.accept(user.id, invite.id);
  }
  assert.equal(parties.snapshotFor(users[0].id).party.members.length, 5);
  assert.throws(() => parties.invite(users[0].id, users[5].username), /5 jugadores/);

  parties.leave(users[4].id);
  const replacement = parties.snapshotFor(users[4].id).party;
  assert.deepEqual(replacement.members.map(member => member.id), [users[4].id]);

  const oldPartyId = parties.partyForUser(users[5].id).id;
  const transfer = parties.invite(users[0].id, users[5].username);
  parties.accept(users[5].id, transfer.id);

  assert.equal(parties.snapshotFor(users[5].id).party.id, parties.snapshotFor(users[0].id).party.id);
  assert.notEqual(parties.snapshotFor(users[5].id).party.id, oldPartyId);
  assert.equal(parties.parties.has(oldPartyId), false);
}));

test('party chat broadcasts to the current group, keeps history, and isolates solo channels', () => withParty(({ store, parties, events }) => {
  const leader = addUser(store, 'ChatLead');
  const friend = addUser(store, 'ChatMate');
  const outsider = addUser(store, 'Outsider');
  parties.partyForUser(leader.id);
  const invite = parties.invite(leader.id, friend.username);
  parties.accept(friend.id, invite.id);

  const message = parties.sendMessage(friend.id, 'Ready for battle?');
  assert.equal(message.username, friend.username);
  assert.equal(message.text, 'Ready for battle?');
  assert.deepEqual(parties.snapshotFor(leader.id).messages.map(item => item.id), [message.id]);
  assert.deepEqual(parties.snapshotFor(friend.id).messages.map(item => item.id), [message.id]);

  const emitted = events.find(item => item.event.type === 'party.message' && item.event.message.id === message.id);
  assert.ok(emitted);
  assert.deepEqual(new Set(emitted.userIds), new Set([leader.id, friend.id]));

  const outsiderMessage = parties.sendMessage(outsider.id, 'Hello?');
  assert.notEqual(outsiderMessage.partyId, message.partyId);
  assert.deepEqual(parties.snapshotFor(outsider.id).messages.map(item => item.id), [outsiderMessage.id]);
  assert.deepEqual(parties.snapshotFor(leader.id).messages.map(item => item.id), [message.id]);
  assert.throws(() => parties.sendMessage(friend.id, '   '), /vacío/);
}));
