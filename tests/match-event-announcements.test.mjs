import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { buildDeathMatchEvent } = require('../node_modules/.cache/alden-test/match/matchEvents.js');
const {
  MatchAnnouncementTracker,
  MULTI_KILL_WINDOW_MS,
} = require('../node_modules/.cache/alden-test/match/matchEventAnnouncements.js');

const hero = (entityId, team, label) => ({ entityId, team, kind: 'hero', label });
const alden = hero('blue-hero-alden', 'blue', 'Alden');
const victim = (id, label) => hero(`red-hero-${id}`, 'red', label);

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
