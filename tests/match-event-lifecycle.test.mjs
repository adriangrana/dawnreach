import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const {
  MatchLifecycleTracker,
  THRONE_ATTACK_ALERT_COOLDOWN_MS,
  buildPauseMatchEvent,
  buildPlayerConnectionMatchEvent,
} = require('../node_modules/.cache/alden-test/match/matchEventLifecycle.js');

const throne = (entityId, team, label) => ({ entityId, team, kind: 'building', label });
const hero = (entityId, team, label) => ({ entityId, team, kind: 'hero', label });

const blueThrone = throne('blue-throne', 'blue', 'Trono del Alba');
const duskHero = hero('red-hero-varek', 'red', 'Varek');

test('throne pressure emits once and is throttled while sustained damage continues', () => {
  const tracker = new MatchLifecycleTracker();
  const first = tracker.consumeThroneDamage({
    throne: blueThrone,
    attacker: duskHero,
    currentHp: 4500,
    maxHp: 5000,
    amount: 100,
    atMs: 1_000,
  });
  const suppressed = tracker.consumeThroneDamage({
    throne: blueThrone,
    attacker: duskHero,
    currentHp: 4400,
    maxHp: 5000,
    amount: 100,
    atMs: 1_000 + THRONE_ATTACK_ALERT_COOLDOWN_MS - 1,
  });
  const repeated = tracker.consumeThroneDamage({
    throne: blueThrone,
    attacker: duskHero,
    currentHp: 4200,
    maxHp: 5000,
    amount: 200,
    atMs: 1_000 + THRONE_ATTACK_ALERT_COOLDOWN_MS,
  });

  assert.equal(first?.type, 'throne_under_attack');
  assert.equal(first?.currentHp, 4500);
  assert.equal(suppressed, null);
  assert.equal(repeated?.type, 'throne_under_attack');
});

test('friendly, neutral, zero-damage and lethal throne events do not create pressure alerts', () => {
  const tracker = new MatchLifecycleTracker();
  const ally = hero('blue-hero-alden', 'blue', 'Alden');
  const neutral = hero('neutral-hero-test', 'neutral', 'Neutral');
  const base = { throne: blueThrone, currentHp: 4500, maxHp: 5000, amount: 100, atMs: 1_000 };

  assert.equal(tracker.consumeThroneDamage({ ...base, attacker: ally }), null);
  assert.equal(tracker.consumeThroneDamage({ ...base, attacker: neutral }), null);
  assert.equal(tracker.consumeThroneDamage({ ...base, attacker: duskHero, amount: 0 }), null);
  assert.equal(tracker.consumeThroneDamage({ ...base, attacker: duskHero, currentHp: 0 }), null);
});

test('pause and resume remain semantic events without rendered copy', () => {
  const paused = buildPauseMatchEvent(true, 'p1', 3_000);
  const resumed = buildPauseMatchEvent(false, 'p1', 5_000);
  assert.equal(paused.type, 'match_paused');
  assert.equal(paused.actorPlayerId, 'p1');
  assert.equal(resumed.type, 'match_resumed');
  assert.equal(resumed.actorPlayerId, 'p1');
});

test('player connection contract is ready for the future authenticated session', () => {
  const disconnected = buildPlayerConnectionMatchEvent(false, 'p2', 'Pepe', 'red', 4_000);
  const reconnected = buildPlayerConnectionMatchEvent(true, 'p2', 'Pepe', 'red', 8_000);
  assert.equal(disconnected.type, 'player_disconnected');
  assert.equal(reconnected.type, 'player_reconnected');
  assert.equal(reconnected.displayName, 'Pepe');
});
