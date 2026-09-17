import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const game = require('../node_modules/.cache/alden-test/match/index.js');

function learnAbilities(state, heroId, keys) {
  let next = state;
  for (const key of keys) next = game.upgradeHeroAbility(next, heroId, key);
  return next;
}

test('playable HUD uses learned definition ranks, costs and cooldowns without duplicate casts', () => {
  const heroId = game.LOCAL_HERO_ENTITY_ID;
  const state = learnAbilities(
    game.createPlayableMatch('H001', 6),
    heroId,
    ['Q', 'W', 'E', 'Q', 'W', 'R'],
  );
  assert.deepEqual(state.heroes[heroId].abilityRanks, { Q: 2, W: 2, E: 1, R: 1 });
  for (const key of game.ABILITY_KEYS) {
    const control = game.getAbilityControl(state, heroId, key, 1000);
    assert.equal(control.canUse, true);
    const next = game.useHeroAbility(state, heroId, key, 1000);
    assert.equal(next.heroes[heroId].currentResource, state.heroes[heroId].currentResource - control.preview.resourceCost);
    assert.equal(next.heroes[heroId].cooldownReadyAtMs[key], 1000 + control.preview.cooldownSeconds * 1000);
    assert.equal(game.useHeroAbility(next, heroId, key, 1001), next);
    assert.equal(game.getAbilityControl(next, heroId, key, next.heroes[heroId].cooldownReadyAtMs[key]).canUse, true);
  }
});

test('ability controls block locked, resource-starved, dead and inactive heroes', () => {
  const heroId = game.LOCAL_HERO_ENTITY_ID;
  const locked = game.createPlayableMatch('H001', 1);
  assert.equal(game.useHeroAbility(locked, heroId, 'W', 0), locked);

  const empty = game.upgradeHeroAbility(game.createPlayableMatch(), heroId, 'Q');
  empty.heroes[heroId].currentResource = 0;
  assert.equal(game.getAbilityControl(empty, heroId, 'Q', 0).blockedReason, 'Maná insuficiente');
  assert.equal(game.useHeroAbility(empty, heroId, 'Q', 0), empty);

  const dead = game.upgradeHeroAbility(game.createPlayableMatch(), heroId, 'Q');
  dead.heroes[heroId].currentHp = 0;
  assert.equal(game.getAbilityControl(dead, heroId, 'Q', 0).blockedReason, 'Heroe derrotado');
  assert.equal(game.useHeroAbility(dead, heroId, 'Q', 0), dead);

  const learned = game.upgradeHeroAbility(game.createPlayableMatch(), heroId, 'Q');
  const paused = game.setMatchPhase(learned, 'finished');
  assert.equal(game.getAbilityControl(paused, heroId, 'Q', 0).blockedReason, 'Partida inactiva');
  assert.equal(game.useHeroAbility(paused, heroId, 'Q', 0), paused);
});

test('resource recovery follows gameplay stats and never exceeds capacity', () => {
  const heroId = game.LOCAL_HERO_ENTITY_ID;
  let state = game.upgradeHeroAbility(game.createPlayableMatch(), heroId, 'Q');
  state = game.useHeroAbility(state, heroId, 'Q', 0);
  const stats = game.calculateHeroStats(state, heroId);
  const recovered = game.recoverHeroResource(state, heroId, 1000, 1000);
  assert.equal(recovered.heroes[heroId].currentResource, state.heroes[heroId].currentResource + stats.resourceRegenPerSecond);
  assert.equal(game.recoverHeroResource(state, heroId, 1_000_000, 1_000_000).heroes[heroId].currentResource, stats.maxResource);
  assert.equal(game.recoverHeroResource(state, heroId, -1000, 0), state);
});

test('pure passives cannot cast but learned active-with-passive abilities can', () => {
  const heroId = game.LOCAL_HERO_ENTITY_ID;
  const state = game.upgradeHeroAbility(game.createPlayableMatch(), heroId, 'E');
  assert.equal(game.getAbilityControl(state, heroId, 'E', 0).canUse, true);
  const originalType = game.ALDEN.abilities.E.type;
  try {
    game.ALDEN.abilities.E.type = 'passive';
    assert.equal(game.getAbilityControl(state, heroId, 'E', 0).passive, true);
    assert.equal(game.useHeroAbility(state, heroId, 'E', 0), state);
    assert.throws(() => game.performAbilityAction(state, { actorHeroEntityId: heroId, key: 'E', nowMs: 0 }), /passive/);
  } finally {
    game.ALDEN.abilities.E.type = originalType;
  }
});

function makeDuel(level = 1) {
  let state = game.createMatchState('test', 0);
  state = game.addPlayerToMatch(state, { playerId: 'p1', displayName: 'A', team: 'dawn', slotIndex: 1 });
  state = game.addPlayerToMatch(state, { playerId: 'p2', displayName: 'B', team: 'dusk', slotIndex: 1 });
  state = game.selectHeroForPlayer(state, 'p1', 'H001');
  state = game.selectHeroForPlayer(state, 'p2', 'H001');
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
  state = game.selectHeroForPlayer(state, 'p1', 'H001');
  assert.equal(game.getPlayerSelectedHeroId(state, 'p1'), 'H001');
  assert.equal(game.getPlayerOwnedHero(state, 'p1'), null);

  state = game.assignSelectedHeroToPlayer(state, 'p1', 'hero:p1');
  const owned = game.getPlayerOwnedHero(state, 'p1');
  assert.equal(owned.heroEntityId, 'hero:p1');
  assert.equal(owned.definitionId, 'H001');
  assert.equal(game.getSlotAssignment(state, 'dawn-3').player.playerId, 'p1');
  assert.equal(game.getSlotAssignment(state, 'dawn-3').hero.heroEntityId, 'hero:p1');
  game.validateMatchState(state);
});

test('global HeroAttributes applies the same fixed formulas to every primary-attribute type', () => {
  const agilityHero = new game.HeroAttributes(game.HeroPrimaryAttribute.AGI, 10, 20, 30);
  assert.equal(agilityHero.CalculateMaxHealth(), 400);
  assert.equal(agilityHero.CalculateMaxMana(), 570);
  assert.ok(Math.abs(agilityHero.CalculateArmor(5) - 8.6) < 1e-9);
  assert.equal(agilityHero.CalculateAttackDamage(40), 60);
  assert.equal(agilityHero.CalculateHpRegen(), 1.5);
  assert.equal(agilityHero.CalculateManaRegen(), 7.5);
  assert.equal(agilityHero.CalculatePhysicalDamageResistance(), 1);
  assert.equal(agilityHero.CalculateAbilityPowerPercent(), 24);
  assert.ok(Math.abs(agilityHero.CalculateAttackSpeed(1) - 1.24) < 1e-9);
  assert.equal(agilityHero.CalculateMovementSpeed(325), 325);
  assert.ok(Math.abs(agilityHero.CalculateMovementSpeed(325, true) - 338) < 1e-9);

  const strengthHero = new game.HeroAttributes(game.HeroPrimaryAttribute.STR, 10, 20, 30);
  const intellectHero = new game.HeroAttributes(game.HeroPrimaryAttribute.INT, 10, 20, 30);
  assert.equal(strengthHero.CalculateAttackDamage(40), 50);
  assert.equal(intellectHero.CalculateAttackDamage(40), 70);
  assert.ok(Math.abs(game.calculateDamageAfterResistance(100, 'physical', 0, 0, 10) - 90) < 1e-9);
});

test('level growth is driven by STR, AGI and INT formulas and stops at level 30', () => {
  const l1 = game.getAldenStatsAtLevel(1);
  const l30 = game.getAldenStatsAtLevel(30);
  assert.equal(l1.maxHp, 640);
  assert.equal(l1.maxResource, 318);
  assert.equal(l1.attackDamage, 66);
  assert.equal(l1.physicalArmor, 32);
  assert.equal(l1.physicalDamageResistancePercent, 2.2);
  assert.ok(Math.abs(l1.attackSpeed - 0.72416) < 1e-9);
  assert.equal(l1.hpRegenPerSecond, 3.3);
  assert.equal(l1.resourceRegenPerSecond, 4.2);
  assert.ok(Math.abs(l1.abilityPowerPercent - 9.6) < 1e-9);

  assert.equal(l30.maxHp, 2612);
  assert.ok(Math.abs(l30.maxResource - 886.4) < 1e-9);
  assert.ok(Math.abs(l30.attackDamage - 164.6) < 1e-9);
  assert.ok(Math.abs(l30.physicalArmor - 40.352) < 1e-9);
  assert.ok(Math.abs(l30.physicalDamageResistancePercent - 12.06) < 1e-9);
  assert.ok(Math.abs(l30.attackSpeed - 1.069376) < 1e-9);
  assert.ok(Math.abs(l30.hpRegenPerSecond - 18.09) < 1e-9);
  assert.ok(Math.abs(l30.resourceRegenPerSecond - 14.35) < 1e-9);
  assert.ok(Math.abs(l30.abilityPowerPercent - 42.08) < 1e-9);
  assert.ok(Math.abs(l30.magicResistance - 61.35) < 1e-9);
  assert.throws(() => game.getAldenStatsAtLevel(31), /1 to 30/);
});

test('skill ranks use Dota-style points, 1/3/5/7 basic gates and 6/12/18 ultimate gates', () => {
  let state = makeDuel();
  assert.equal(game.getUnspentHeroAbilityPoints(state, 'h1'), 1);

  state = game.upgradeHeroAbility(state, 'h1', 'Q');
  assert.equal(state.heroes.h1.abilityRanks.Q, 1);
  assert.equal(game.getUnspentHeroAbilityPoints(state, 'h1'), 0);
  assert.throws(() => game.upgradeHeroAbility(state, 'h1', 'Q'), /level 3/);
  assert.throws(() => game.upgradeHeroAbility(state, 'h1', 'W'), /no unspent ability points/);

  state = game.setHeroLevel(state, 'h1', 2);
  state = game.upgradeHeroAbility(state, 'h1', 'W');
  assert.deepEqual(state.heroes.h1.abilityRanks, { Q: 1, W: 1, E: 0, R: 0 });
  assert.throws(() => game.upgradeHeroAbility(state, 'h1', 'Q'), /level 3/);

  state = game.setHeroLevel(state, 'h1', 3);
  state = game.upgradeHeroAbility(state, 'h1', 'Q');
  assert.equal(state.heroes.h1.abilityRanks.Q, 2);

  state = game.setHeroLevel(state, 'h1', 7);
  state = game.upgradeHeroAbility(state, 'h1', 'E');
  state = game.upgradeHeroAbility(state, 'h1', 'Q');
  state = game.upgradeHeroAbility(state, 'h1', 'R');
  state = game.upgradeHeroAbility(state, 'h1', 'Q');
  assert.deepEqual(state.heroes.h1.abilityRanks, { Q: 4, W: 1, E: 1, R: 1 });
  assert.equal(game.getSpentHeroAbilityPoints(state, 'h1'), 7);
  assert.equal(game.getUnspentHeroAbilityPoints(state, 'h1'), 0);
  assert.throws(() => game.upgradeHeroAbility(state, 'h1', 'W'), /no unspent ability points/);

  let ultimate = makeDuel(18);
  ultimate = game.upgradeHeroAbility(ultimate, 'h1', 'R');
  ultimate = game.upgradeHeroAbility(ultimate, 'h1', 'R');
  ultimate = game.upgradeHeroAbility(ultimate, 'h1', 'R');
  assert.equal(ultimate.heroes.h1.abilityRanks.R, 3);
  assert.throws(() => game.upgradeHeroAbility(ultimate, 'h1', 'R'), /already rank 3/);
  assert.equal(game.calculateAldenAbilityAtRank(ultimate, 'h1', 'R', 3).cooldownSeconds, 60);
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
  const abilityMultiplier = 1 + before.abilityPowerPercent / 100;
  assert.ok(Math.abs(qAfter.rawDamage - qBefore.rawDamage - 36 * abilityMultiplier) < 1e-9);
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
