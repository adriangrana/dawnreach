import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const game = require('../node_modules/.cache/alden-test/match/index.js');

function makeDuel(level = 1) {
  let state = game.createMatchState('test', 0);
  state = game.addPlayerToMatch(state, { playerId: 'p1', displayName: 'A', team: 'dawn', slotIndex: 1 });
  state = game.addPlayerToMatch(state, { playerId: 'p2', displayName: 'B', team: 'dusk', slotIndex: 1 });
  state = game.selectHeroForPlayer(state, 'p1', 'alden');
  state = game.selectHeroForPlayer(state, 'p2', 'alden');
  state = game.assignSelectedHeroToPlayer(state, 'p1', 'h1');
  state = game.assignSelectedHeroToPlayer(state, 'p2', 'h2');
  if (level !== 1) {
    state = game.setHeroLevel(state, 'h1', level);
    state = game.setHeroLevel(state, 'h2', level);
  }
  return state;
}

test('match state always exposes 10 fixed 5v5 slots and keeps selection separate from ownership', () => {
  let state = game.createMatchState('m1', 10);
  assert.equal(state.slots.length, 10);
  assert.equal(state.slots.filter(s => s.team === 'dawn').length, 5);
  assert.equal(state.slots.filter(s => s.team === 'dusk').length, 5);
  assert.equal(new Set(state.slots.map(s => s.slotId)).size, 10);

  state = game.addPlayerToMatch(state, { playerId: 'p1', displayName: 'Player 1', team: 'dawn', slotIndex: 3 });
  state = game.selectHeroForPlayer(state, 'p1', 'alden');
  assert.equal(game.getPlayerSelectedHeroId(state, 'p1'), 'alden');
  assert.equal(game.getPlayerOwnedHero(state, 'p1'), null);

  state = game.assignSelectedHeroToPlayer(state, 'p1', 'hero:p1');
  const owned = game.getPlayerOwnedHero(state, 'p1');
  assert.equal(owned.heroEntityId, 'hero:p1');
  assert.equal(owned.definitionId, 'alden');
  assert.equal(game.getSlotAssignment(state, 'dawn-3').player.playerId, 'p1');
  assert.equal(game.getSlotAssignment(state, 'dawn-3').hero.heroEntityId, 'hero:p1');
  game.validateMatchState(state);
});

test('Alden level growth reproduces the level 1 and level 50 design values', () => {
  const l1 = game.getAldenStatsAtLevel(1);
  const l50 = game.getAldenStatsAtLevel(50);
  assert.equal(l1.maxHp, 760);
  assert.equal(l1.attackDamage, 66);
  assert.equal(l50.maxHp, 5905);
  assert.ok(Math.abs(l50.attackDamage - 232.6) < 1e-9);
  assert.ok(Math.abs(l50.attackSpeed - 1.10808) < 1e-9);
  assert.ok(Math.abs(l50.magicResistance - 84.35) < 1e-9);
});

test('skill ranks are gated by their alternating character levels', () => {
  let state = makeDuel();
  state = game.upgradeHeroAbility(state, 'h1', 'Q');
  assert.equal(state.heroes.h1.abilityRanks.Q, 1);
  assert.throws(() => game.upgradeHeroAbility(state, 'h1', 'Q'), /level 8/);
  assert.throws(() => game.upgradeHeroAbility(state, 'h1', 'W'), /level 3/);

  state = game.setHeroLevel(state, 'h1', 6);
  state = game.upgradeHeroAbility(state, 'h1', 'W');
  state = game.upgradeHeroAbility(state, 'h1', 'E');
  state = game.upgradeHeroAbility(state, 'h1', 'R');
  assert.deepEqual(state.heroes.h1.abilityRanks, { Q: 1, W: 1, E: 1, R: 1 });
});

test('inventory modifiers feed total stats and ability scaling', () => {
  let state = makeDuel(22);
  const before = game.calculateHeroStats(state, 'h1');
  const qBefore = game.calculateAldenAbilityAtRank(state, 'h1', 'Q', 4);
  state = game.equipInventoryItem(state, 'h1', 0, {
    instanceId: 'sword-1',
    definitionId: 'test-sword',
    displayName: 'Test Sword',
    quantity: 1,
    statModifiers: [
      { stat: 'attackDamage', mode: 'flat', value: 40 },
      { stat: 'maxHp', mode: 'percent', value: 10 },
    ],
  });
  const after = game.calculateHeroStats(state, 'h1');
  const qAfter = game.calculateAldenAbilityAtRank(state, 'h1', 'Q', 4);
  assert.equal(after.attackDamage, before.attackDamage + 40);
  assert.ok(Math.abs(after.maxHp - before.maxHp * 1.1) < 1e-9);
  assert.ok(Math.abs(qAfter.rawDamage - qBefore.rawDamage - 36) < 1e-9);
});

test('Q spends mana, starts cooldown, deals scaled physical damage, slows and starts Cadence', () => {
  let state = makeDuel(22);
  state = game.upgradeHeroAbility(state, 'h1', 'Q');
  state = game.upgradeHeroAbility(state, 'h1', 'Q');
  state = game.upgradeHeroAbility(state, 'h1', 'Q');
  state = game.upgradeHeroAbility(state, 'h1', 'Q');
  const manaBefore = state.heroes.h1.currentResource;
  const result = game.performAbilityAction(state, { actorHeroEntityId: 'h1', key: 'Q', targetHeroEntityIds: ['h2'], nowMs: 1000 });
  state = result.state;
  assert.equal(result.result.resourceSpent, 60);
  assert.equal(state.heroes.h1.currentResource, manaBefore - 60);
  assert.equal(state.heroes.h1.cooldownReadyAtMs.Q, 8000);
  assert.equal(state.heroes.h1.runtime.targetCounters['alden:cadence'].h2.stacks, 1);
  assert.ok(state.heroes.h2.runtime.statuses['cc:slow:h1'].expiresAtMs > 1000);
  assert.ok(result.result.targets[0].finalDamage > 0);
});

test('W reduces only eligible frontal direct damage and arms Represalia after enough prevented damage', () => {
  let state = makeDuel(24);
  for (let i = 0; i < 4; i++) state = game.upgradeHeroAbility(state, 'h1', 'W');
  state = game.performAbilityAction(state, { actorHeroEntityId: 'h1', key: 'W', nowMs: 1000 }).state;
  const hpBefore = state.heroes.h1.currentHp;
  const hit = game.applyDamagePacket(state, {
    sourceHeroEntityId: 'h2',
    targetHeroEntityId: 'h1',
    rawDamage: 1200,
    damageType: 'physical',
    isDirect: true,
    isFromFront: true,
  }, 1100);
  state = hit.state;
  assert.ok(hit.result.preventedByGuard > 0);
  assert.ok(state.heroes.h1.currentHp < hpBefore);
  assert.ok(state.heroes.h1.runtime.statuses['alden:reprisal']);

  const counter = game.performBasicAttackAction(state, { actorHeroEntityId: 'h1', targetHeroEntityId: 'h2', nowMs: 1200 });
  assert.ok(counter.result.notes.includes('Represalia consumed.'));
  assert.ok(counter.state.heroes.h2.runtime.statuses['cc:stun:h1']);
  assert.equal(counter.state.heroes.h1.runtime.statuses['alden:reprisal'], undefined);
});

test('E Cadence changes attack speed versus that target and is consumed for damage and healing', () => {
  let state = makeDuel(26);
  for (let i = 0; i < 4; i++) state = game.upgradeHeroAbility(state, 'h1', 'E');
  state.heroes.h1.currentHp -= 1000;

  for (let i = 0; i < 3; i++) {
    state = game.performBasicAttackAction(state, { actorHeroEntityId: 'h1', targetHeroEntityId: 'h2', nowMs: 1000 + i * 500 }).state;
  }
  const noTarget = game.calculateHeroStats(state, 'h1', { nowMs: 2100 });
  const vsTarget = game.calculateHeroStats(state, 'h1', { nowMs: 2100, targetHeroEntityId: 'h2' });
  assert.ok(Math.abs(vsTarget.attackSpeed / noTarget.attackSpeed - 1.21) < 1e-9);

  const hpBefore = state.heroes.h1.currentHp;
  const result = game.performAbilityAction(state, { actorHeroEntityId: 'h1', key: 'E', targetHeroEntityIds: ['h2'], nowMs: 2200 });
  state = result.state;
  assert.equal(result.result.targets[0].consumedCadenceStacks, 3);
  assert.ok(state.heroes.h1.currentHp > hpBefore);
  assert.equal(state.heroes.h1.runtime.targetCounters['alden:cadence'].h2, undefined);
});

test('R rank 1 keeps a 90 second cooldown and applies Majesty, taunt, Cadence and Q/W cooldown acceleration', () => {
  let state = makeDuel(6);
  state = game.upgradeHeroAbility(state, 'h1', 'Q');
  state = game.upgradeHeroAbility(state, 'h1', 'W');
  state = game.upgradeHeroAbility(state, 'h1', 'E');
  state = game.upgradeHeroAbility(state, 'h1', 'R');
  state.heroes.h1.cooldownReadyAtMs.Q = 12000;
  state.heroes.h1.cooldownReadyAtMs.W = 15000;

  const cast = game.performAbilityAction(state, { actorHeroEntityId: 'h1', key: 'R', targetHeroEntityIds: ['h2'], nowMs: 1000 });
  state = cast.state;
  assert.equal(state.heroes.h1.cooldownReadyAtMs.R, 91000);
  assert.ok(state.heroes.h1.runtime.statuses['alden:majesty']);
  assert.ok(state.heroes.h2.runtime.statuses['cc:taunt:h1']);
  assert.equal(state.heroes.h1.runtime.targetCounters['alden:cadence'].h2.stacks, 1);

  state = game.performBasicAttackAction(state, { actorHeroEntityId: 'h1', targetHeroEntityId: 'h2', nowMs: 1500 }).state;
  assert.equal(state.heroes.h1.cooldownReadyAtMs.Q, 11500);
  assert.equal(state.heroes.h1.cooldownReadyAtMs.W, 14500);
});

test('Voto del Muro Vivo gains frontal stacks on its ICD and empowers the next basic attack at four stacks', () => {
  let state = makeDuel(10);
  state.heroes.h1.currentHp -= 500;
  for (let i = 0; i < 4; i++) {
    state = game.applyDamagePacket(state, {
      sourceHeroEntityId: 'h2',
      targetHeroEntityId: 'h1',
      rawDamage: 10,
      damageType: 'physical',
      isDirect: true,
      isFromFront: true,
    }, 1000 + i * 800).state;
  }
  assert.ok(state.heroes.h1.runtime.statuses['alden:oath-ready']);
  const hpBefore = state.heroes.h1.currentHp;
  const hit = game.performBasicAttackAction(state, { actorHeroEntityId: 'h1', targetHeroEntityId: 'h2', nowMs: 3500 });
  assert.ok(hit.result.notes.includes('Voto del Muro Vivo consumed.'));
  assert.ok(hit.state.heroes.h1.currentHp > hpBefore);
  assert.ok(hit.state.heroes.h1.runtime.timestamps['alden:steel-lockout-until'] > 3500);
});
