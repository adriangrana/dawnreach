import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const {
  MatchEventBus,
  buildDeathMatchEvent,
} = require('../node_modules/.cache/alden-test/match/matchEvents.js');

const hero = (entityId, team, label) => ({ entityId, team, kind: 'hero', label });

test('MatchEventBus publishes to subscribers and unsubscribe stops delivery', () => {
  const bus = new MatchEventBus();
  const received = [];
  const unsubscribe = bus.subscribe(event => received.push(event.eventId));
  const event = buildDeathMatchEvent({
    target: hero('red-hero-varek', 'red', 'Varek'),
    killer: hero('blue-hero-alden', 'blue', 'Alden'),
    atMs: 1200,
  });
  assert.ok(event);
  bus.publish(event);
  unsubscribe();
  bus.publish(event);
  assert.deepEqual(received, [event.eventId]);
  assert.equal(bus.listenerCount(), 0);
});

test('hero death becomes a semantic hero_killed event with assists', () => {
  const event = buildDeathMatchEvent({
    target: hero('red-hero-varek', 'red', 'Varek'),
    killer: hero('blue-hero-alden', 'blue', 'Alden'),
    assists: [hero('blue-hero-kael', 'blue', 'Kael')],
    atMs: 4200.5,
  });
  assert.equal(event?.type, 'hero_killed');
  assert.equal(event?.killer?.label, 'Alden');
  assert.equal(event?.victim.label, 'Varek');
  assert.deepEqual(event?.assists.map(item => item.label), ['Kael']);
});

test('tower and neutral deaths are classified without presentation text in gameplay', () => {
  const tower = buildDeathMatchEvent({
    target: { entityId: 'red-tower-mid-1', team: 'red', kind: 'tower', label: 'Torre Mid 1' },
    killer: hero('blue-hero-alden', 'blue', 'Alden'),
    atMs: 5000,
  });
  const objective = buildDeathMatchEvent({
    target: { entityId: 'radiant-drake', team: 'neutral', kind: 'jungle-creature', label: 'Aurelios' },
    killer: hero('blue-hero-alden', 'blue', 'Alden'),
    atMs: 6000,
  });
  assert.equal(tower?.type, 'tower_destroyed');
  assert.equal(objective?.type, 'objective_killed');
});

test('destroying a throne derives the winning team from the defeated throne', () => {
  const red = buildDeathMatchEvent({
    target: { entityId: 'red-throne', team: 'red', kind: 'building', label: 'Trono del Ocaso' },
    killer: hero('blue-hero-alden', 'blue', 'Alden'),
    atMs: 7000,
  });
  const blue = buildDeathMatchEvent({
    target: { entityId: 'blue-throne', team: 'blue', kind: 'building', label: 'Trono del Alba' },
    killer: hero('red-hero-varek', 'red', 'Varek'),
    atMs: 8000,
  });
  assert.equal(red?.type, 'throne_destroyed');
  assert.equal(red?.winnerTeam, 'blue');
  assert.equal(blue?.type, 'throne_destroyed');
  assert.equal(blue?.winnerTeam, 'red');
});
