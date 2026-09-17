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

test('TCL party flow creates, invites, accepts and transfers leadership', () => withParty(({ store, parties, events }) => {
  const leader = addUser(store, 'Leader');
  const friend = addUser(store, 'Friend');

  const party = parties.create(leader);
  assert.equal(party.members.length, 1);
  assert.match(party.code, /^[A-HJ-NP-Z2-9]{5}$/);

  const invite = parties.invite(leader.id, friend.username);
  assert.equal(parties.snapshotFor(friend.id).invites.length, 1);
  assert.equal(parties.snapshotFor(friend.id).invites[0].from.username, leader.username);

  parties.accept(friend.id, invite.id);
  const joined = parties.snapshotFor(friend.id).party;
  assert.deepEqual(joined.members.map(member => member.id), [leader.id, friend.id]);
  assert.equal(parties.snapshotFor(friend.id).invites.length, 0);

  parties.leave(leader.id);
  assert.equal(parties.snapshotFor(friend.id).party.leaderId, friend.id);
  assert.equal(parties.snapshotFor(leader.id).party, null);
  assert.ok(events.some(item => item.event.type === 'party.invite'));
  assert.ok(events.some(item => item.event.type === 'party.snapshot'));
}));

test('TCL party rules cap groups at five and move an accepter out of the previous party', () => withParty(({ store, parties }) => {
  const users = ['One', 'Two', 'Three', 'Four', 'Five', 'Six'].map(name => addUser(store, name));
  parties.create(users[0]);

  for (const user of users.slice(1, 5)) {
    const invite = parties.invite(users[0].id, user.username);
    parties.accept(user.id, invite.id);
  }
  assert.equal(parties.snapshotFor(users[0].id).party.members.length, 5);
  assert.throws(() => parties.invite(users[0].id, users[5].username), /5 jugadores/);

  parties.leave(users[4].id);
  parties.create(users[5]);
  const oldPartyId = parties.snapshotFor(users[5].id).party.id;
  const transfer = parties.invite(users[0].id, users[5].username);
  parties.accept(users[5].id, transfer.id);

  assert.equal(parties.snapshotFor(users[5].id).party.id, parties.snapshotFor(users[0].id).party.id);
  assert.notEqual(parties.snapshotFor(users[5].id).party.id, oldPartyId);
  assert.equal(parties.parties.has(oldPartyId), false);
}));
