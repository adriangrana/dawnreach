import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { buildDeathMatchEvent } = require('../node_modules/.cache/alden-test/match/matchEvents.js');
const {
  KILL_STREAK_THRESHOLD,
  MatchAnnouncementTracker,
  MULTI_KILL_WINDOW_MS,
} = require('../node_modules/.cache/alden-test/match/matchEventAnnouncements.js');

const hero = (entityId, team, label) => ({ entityId, team, kind: 'hero', label });
const alden = hero('blue-hero-alden', 'blue', 'Alden');
const victim = (id, label) => hero(`red-hero-${id}`, 'red', label);
const blueVictim = (id, label) => hero(`blue-hero-${id}`, 'blue', label);

function kill(killer, target, atMs) {
  const event = buildDeathMatchEvent({ target, killer, atMs });
  assert.equal(event?.type, 'hero_killed');
  return event;
}

test('first blood is emitted exactly once for the first valid enemy hero kill', () => {
  const tracker = new MatchAnnouncementTracker();
  const first = tracker.consume(kill(alden, victim('varek', 'Varek'), 1_000));
  const second = tracker.consume(kill(alden, victim('nyra', 'Nyra'), 2_000));
  assert.equal(first.filter(event => event.type === 'first_blood').length, 1);
  assert.equal(second.filter(event => event.type === 'first_blood').length, 0);
});

test('rapid kills by the same hero derive double, triple and capped penta events', () => {
  const tracker = new MatchAnnouncementTracker();
  const counts = [];
  for (let index = 0; index < 6; index++) {
    const events = tracker.consume(kill(alden, victim(`v${index}`, `V${index}`), 1_000 + index * 1_000));
    for (const event of events) if (event.type === 'multi_kill') counts.push(event.count);
  }
  assert.deepEqual(counts, [2, 3, 4, 5, 5]);
});

test('multi-kill chain resets after the configured time window', () => {
  const tracker = new MatchAnnouncementTracker();
  tracker.consume(kill(alden, victim('one', 'One'), 1_000));
  const afterWindow = tracker.consume(kill(
    alden,
    victim('two', 'Two'),
    1_000 + MULTI_KILL_WINDOW_MS + 1,
  ));
  assert.equal(afterWindow.some(event => event.type === 'multi_kill'), false);
});

test('death breaks a rapid multi-kill chain before the next kill', () => {
  const tracker = new MatchAnnouncementTracker();
  const varek = hero('red-hero-varek', 'red', 'Varek');
  tracker.consume(kill(alden, victim('one', 'One'), 1_000));
  tracker.consume(kill(varek, alden, 2_000));
  const afterDeath = tracker.consume(kill(alden, victim('two', 'Two'), 3_000));
  assert.equal(afterDeath.some(event => event.type === 'multi_kill'), false);
});

test('consecutive enemy kills derive a persistent kill streak from the configured threshold', () => {
  const tracker = new MatchAnnouncementTracker();
  const streakCounts = [];
  for (let index = 0; index < KILL_STREAK_THRESHOLD + 2; index++) {
    const events = tracker.consume(kill(alden, victim(`streak-${index}`, `S${index}`), 20_000 + index * 15_000));
    for (const event of events) if (event.type === 'kill_streak') streakCounts.push(event.count);
  }
  assert.deepEqual(streakCounts, [3, 4, 5]);
});

test('killing an enemy on a streak emits shutdown and resets the victim streak', () => {
  const tracker = new MatchAnnouncementTracker();
  const varek = hero('red-hero-varek', 'red', 'Varek');
  for (let index = 0; index < KILL_STREAK_THRESHOLD; index++) {
    tracker.consume(kill(varek, blueVictim(`b${index}`, `B${index}`), 40_000 + index * 15_000));
  }

  const shutdownEvents = tracker.consume(kill(alden, varek, 90_000));
  const shutdown = shutdownEvents.find(event => event.type === 'shutdown');
  assert.ok(shutdown);
  assert.equal(shutdown.endedStreak, KILL_STREAK_THRESHOLD);
  assert.equal(shutdown.killer.entityId, alden.entityId);
  assert.equal(shutdown.victim.entityId, varek.entityId);

  const varekReturns = tracker.consume(kill(varek, blueVictim('fresh', 'Fresh'), 110_000));
  assert.equal(varekReturns.some(event => event.type === 'kill_streak'), false);
});

test('suicides and same-team deaths do not consume first blood or create multikills', () => {
  const tracker = new MatchAnnouncementTracker();
  const self = tracker.consume(kill(alden, alden, 1_000));
  const ally = hero('blue-hero-kael', 'blue', 'Kael');
  const friendly = tracker.consume(kill(alden, ally, 2_000));
  const valid = tracker.consume(kill(alden, victim('varek', 'Varek'), 3_000));
  assert.equal(self.length, 0);
  assert.equal(friendly.length, 0);
  assert.equal(valid.some(event => event.type === 'first_blood'), true);
});
