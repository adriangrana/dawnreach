import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HeroSelectManager } from '../server/hero-select.mjs';

function match(players, extra = {}) {
  return {
    id: extra.id || 'match-1',
    mode: extra.mode || 'custom',
    source: extra.source || 'custom',
    rated: false,
    status: 'launching',
    createdAt: new Date().toISOString(),
    players,
    resultToken: 'secret',
    mapSha256: null,
    ...(extra.customSettings ? { customSettings: extra.customSettings } : {}),
  };
}

function player(userId, team, slot) {
  return { userId, username: userId, rating: 1000, joinedAt: 1, team, slot };
}

function manager(overrides = {}) {
  const events = [];
  const completed = [];
  const heroSelect = new HeroSelectManager({
    heroIds: overrides.heroIds || ['H001'],
    heroNames: { H001: 'Alden', H002: 'Other' },
    pickSeconds: 45,
    onEvent: (event, userIds) => events.push({ event, userIds }),
    onComplete: (createdMatch, selections) => completed.push({ match: createdMatch, selections }),
  });
  return { heroSelect, events, completed };
}

test('hero select begins for every match participant and exposes Dawnreach lanes', () => {
  const { heroSelect, events } = manager();
  const created = match([
    player('a', 'blue', 0),
    player('b', 'blue', 1),
    player('c', 'red', 5),
    player('d', 'red', 6),
  ], { customSettings: { teamSize: 2, heroSelect: 'all_pick', bans: 'none' } });

  heroSelect.begin(created);

  const startEvents = events.filter(item => item.event.type === 'hero_select.start');
  assert.equal(startEvents.length, 4);
  const snapshot = heroSelect.snapshotForUser('a');
  assert.equal(snapshot.phase, 'pick');
  assert.deepEqual(snapshot.players.filter(item => item.team === 'blue').map(item => item.lane), ['NORTH', 'SOUTH']);
});

test('hero select preview is not a lock and all players must lock before completion', () => {
  const { heroSelect, completed } = manager();
  heroSelect.begin(match([
    player('a', 'blue', 0),
    player('b', 'red', 1),
  ], { customSettings: { teamSize: 1, heroSelect: 'all_pick', bans: 'none' } }));

  heroSelect.preview('a', 'H001');
  let state = heroSelect.snapshotForUser('a');
  assert.equal(state.players.find(item => item.userId === 'a').selection.heroId, 'H001');
  assert.equal(state.players.find(item => item.userId === 'a').selection.locked, false);

  heroSelect.lock('a', 'H001');
  assert.equal(completed.length, 0);
  heroSelect.lock('b', 'H001');
  assert.equal(completed.length, 1);
  assert.equal(completed[0].selections.a.heroId, 'H001');
  assert.equal(completed[0].selections.b.heroId, 'H001');
});

test('development roster allows duplicate heroes until enough unique heroes exist', () => {
  const { heroSelect } = manager({ heroIds: ['H001'] });
  heroSelect.begin(match([
    player('a', 'blue', 0),
    player('b', 'blue', 1),
    player('c', 'red', 2),
    player('d', 'red', 3),
  ], { customSettings: { teamSize: 2, heroSelect: 'all_pick', bans: 'none' } }));

  assert.doesNotThrow(() => heroSelect.lock('a', 'H001'));
  assert.doesNotThrow(() => heroSelect.lock('b', 'H001'));
  assert.equal(heroSelect.snapshotForUser('a').rosterDevelopmentMode, true);
});

test('TEAM hero-select chat is filtered per team', () => {
  const { heroSelect } = manager();
  heroSelect.begin(match([
    player('dawn', 'blue', 0),
    player('dusk', 'red', 1),
  ], { customSettings: { teamSize: 1, heroSelect: 'all_pick', bans: 'none' } }));

  heroSelect.sendMessage('dawn', 'north first');
  assert.ok(heroSelect.snapshotForUser('dawn').messages.some(message => message.text === 'north first'));
  assert.equal(heroSelect.snapshotForUser('dusk').messages.some(message => message.text === 'north first'), false);
});

test('ranked hero select reserves draft ban presentation while roster is still developing', () => {
  const { heroSelect } = manager();
  heroSelect.begin(match([
    player('a', 'blue', 0),
    player('b', 'red', 1),
  ], { mode: 'ranked', source: 'matchmaking' }));

  const snapshot = heroSelect.snapshotForUser('a');
  assert.equal(snapshot.selectionType, 'draft');
  assert.equal(snapshot.bansPerTeam, 3);
  assert.equal(snapshot.draftRulesDeferred, true);
});
