import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  Matchmaker,
  balanceMatchmakingTeams,
  rankedSearchWindow,
  RANKED_BASE_MMR_WINDOW,
  RANKED_MAX_MMR_WINDOW,
} from '../server/matchmaking.mjs';

function player(userId, rating, joinedAt = 1, partyId) {
  return { userId, username: userId, rating, joinedAt, ...(partyId ? { partyId } : {}) };
}

test('TCL ranked matchmaking expands its MMR window over time with a hard cap', () => {
  const joinedAt = 1_000;
  assert.equal(rankedSearchWindow(joinedAt, joinedAt), RANKED_BASE_MMR_WINDOW);
  assert.equal(rankedSearchWindow(joinedAt, joinedAt + 45_000), RANKED_BASE_MMR_WINDOW + 100);
  assert.equal(rankedSearchWindow(joinedAt, joinedAt + 60 * 60_000), RANKED_MAX_MMR_WINDOW);
});

test('TCL team balancing keeps party members together and fills equal teams', () => {
  const balanced = balanceMatchmakingTeams([
    player('a', 2800, 1, 'party-a'),
    player('b', 2750, 1, 'party-a'),
    player('c', 2720, 2),
    player('d', 2680, 3),
  ], 4);
  const red = balanced.filter(item => item.team === 'red');
  const blue = balanced.filter(item => item.team === 'blue');
  assert.equal(red.length, 2);
  assert.equal(blue.length, 2);
  assert.equal(balanced.find(item => item.userId === 'a').team, balanced.find(item => item.userId === 'b').team);
});

test('TCL ready check launches only after every selected player accepts', () => {
  const events = [];
  const launched = [];
  const store = { matches: [], addMatch(match) { this.matches.push(match); } };
  const matchmaker = new Matchmaker({
    queueSize: 4,
    readyTimeoutSeconds: 30,
    store,
    onEvent: (event, userIds) => events.push({ event, userIds }),
    onLaunch: match => launched.push(match),
  });

  const users = [
    { id: 'p1', username: 'p1', rating: 2800 },
    { id: 'p2', username: 'p2', rating: 2780 },
    { id: 'p3', username: 'p3', rating: 2720 },
    { id: 'p4', username: 'p4', rating: 2700 },
  ];
  users.forEach(user => matchmaker.join(user, 'normal'));

  const readyStart = events.find(item => item.event.type === 'ready.start');
  assert.ok(readyStart);
  assert.equal(readyStart.event.players.length, 4);
  assert.equal(launched.length, 0);

  for (const user of users.slice(0, 3)) matchmaker.respond(user.id, readyStart.event.readyId, true);
  assert.equal(launched.length, 0);
  matchmaker.respond(users[3].id, readyStart.event.readyId, true);

  assert.equal(launched.length, 1);
  assert.equal(store.matches.length, 1);
  assert.equal(launched[0].players.filter(item => item.team === 'red').length, 2);
  assert.equal(launched[0].players.filter(item => item.team === 'blue').length, 2);
  assert.ok(events.some(item => item.event.type === 'match.found'));
});
