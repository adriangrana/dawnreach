import { getHeroDefinition, hasHeroDefinition } from '../heroes/catalog';
import { calculateDefinitionStatsAtLevel } from '../heroes/heroAttributes';
import {
  createEmptyAbilityRanks,
  createEmptyInventory,
  type AbilityKey,
  type HeroDefinition,
  type HeroId,
  type InventoryItem,
} from '../heroes/types';
import type {
  MatchHeroState,
  MatchPlayerState,
  MatchSlotId,
  MatchSlotState,
  MatchState,
  TeamId,
  TeamSlotIndex,
} from './types';

const TEAMS: readonly TeamId[] = ['dawn', 'dusk'];
const SLOT_INDEXES: readonly TeamSlotIndex[] = [1, 2, 3, 4, 5];
const ABILITY_KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];
export const HERO_STARTING_GOLD = 600;

export function createMatchSlots(): MatchSlotState[] {
  return TEAMS.flatMap(team => SLOT_INDEXES.map(index => ({
    slotId: `${team}-${index}` as MatchSlotId,
    team,
    index,
    playerId: null,
    heroEntityId: null,
  })));
}

export function createMatchState(matchId: string, createdAtMs = Date.now()): MatchState {
  if (!matchId.trim()) throw new Error('matchId is required.');
  return {
    matchId,
    phase: 'lobby',
    createdAtMs,
    slots: createMatchSlots(),
    players: {},
    heroes: {},
  };
}

export function setMatchPhase(state: MatchState, phase: MatchState['phase']): MatchState {
  const next = cloneState(state);
  next.phase = phase;
  return next;
}

export function addPlayerToMatch(
  state: MatchState,
  input: {
    playerId: string;
    displayName: string;
    team: TeamId;
    slotIndex: TeamSlotIndex;
  },
): MatchState {
  if (!input.playerId.trim()) throw new Error('playerId is required.');
  if (state.players[input.playerId]) throw new Error(`Player ${input.playerId} is already in the match.`);

  const slotId = `${input.team}-${input.slotIndex}` as MatchSlotId;
  const slot = state.slots.find(candidate => candidate.slotId === slotId);
  if (!slot) throw new Error(`Unknown match slot ${slotId}.`);
  if (slot.playerId) throw new Error(`Match slot ${slotId} is already occupied.`);

  const next = cloneState(state);
  const nextSlot = getRequiredSlot(next, slotId);
  const player: MatchPlayerState = {
    playerId: input.playerId,
    displayName: input.displayName,
    team: input.team,
    slotId,
    connected: true,
    selectedHeroId: null,
    ownedHeroEntityId: null,
  };
  next.players[player.playerId] = player;
  nextSlot.playerId = player.playerId;
  return next;
}

export function setPlayerConnection(state: MatchState, playerId: string, connected: boolean): MatchState {
  const next = cloneState(state);
  const player = getRequiredPlayer(next, playerId);
  player.connected = connected;
  return next;
}

export function selectHeroForPlayer(state: MatchState, playerId: string, heroId: HeroId): MatchState {
  if (!hasHeroDefinition(heroId)) throw new Error(`Cannot select unknown hero ${heroId}.`);
  const next = cloneState(state);
  getRequiredPlayer(next, playerId).selectedHeroId = heroId;
  return next;
}

export function assignSelectedHeroToPlayer(
  state: MatchState,
  playerId: string,
  heroEntityId = `${playerId}:hero`,
): MatchState {
  if (state.heroes[heroEntityId]) throw new Error(`Hero entity ${heroEntityId} already exists.`);
  const sourcePlayer = getRequiredPlayer(state, playerId);
  if (!sourcePlayer.selectedHeroId) throw new Error(`Player ${playerId} has not selected a hero.`);
  if (sourcePlayer.ownedHeroEntityId) throw new Error(`Player ${playerId} already owns hero ${sourcePlayer.ownedHeroEntityId}.`);

  const definition = getHeroDefinition(sourcePlayer.selectedHeroId);
  const stats = calculateDefinitionStatsAtLevel(definition, 1);

  const hero: MatchHeroState = {
    heroEntityId,
    definitionId: definition.id,
    heroName: definition.displayName,
    ownerPlayerId: playerId,
    team: sourcePlayer.team,
    slotId: sourcePlayer.slotId,
    level: 1,
    experience: 0,
    gold: HERO_STARTING_GOLD,
    lastHits: 0,
    denies: 0,
    currentHp: stats.maxHp,
    currentResource: stats.maxResource,
    abilityRanks: createEmptyAbilityRanks(),
    inventory: createEmptyInventory(),
    cooldownReadyAtMs: { Q: 0, W: 0, E: 0, R: 0 },
    runtime: {
      statuses: {},
      counters: {},
      timestamps: {},
      targetCounters: {},
    },
  };

  const next = cloneState(state);
  const player = getRequiredPlayer(next, playerId);
  const slot = getRequiredSlot(next, player.slotId);
  player.ownedHeroEntityId = heroEntityId;
  slot.heroEntityId = heroEntityId;
  next.heroes[heroEntityId] = hero;
  return next;
}

export function setHeroLevel(state: MatchState, heroEntityId: string, level: number): MatchState {
  const next = cloneState(state);
  const hero = getRequiredHero(next, heroEntityId);
  const definition = getHeroDefinition(hero.definitionId);
  if (!Number.isInteger(level) || level < 1 || level > definition.maxLevel) {
    throw new RangeError(`Hero level must be an integer from 1 to ${definition.maxLevel}.`);
  }

  assertAbilityAllocationFitsLevel(hero, definition, level);

  const before = calculateDefinitionStatsAtLevel(definition, hero.level);
  const after = calculateDefinitionStatsAtLevel(definition, level);
  const hpRatio = before.maxHp > 0 ? hero.currentHp / before.maxHp : 1;
  const resourceRatio = before.maxResource > 0 ? hero.currentResource / before.maxResource : 1;

  hero.level = level;
  hero.currentHp = clamp(after.maxHp * hpRatio, 0, after.maxHp);
  hero.currentResource = clamp(after.maxResource * resourceRatio, 0, after.maxResource);
  return next;
}

export function getSpentHeroAbilityPoints(state: MatchState, heroEntityId: string): number {
  return getSpentAbilityPoints(getRequiredHero(state, heroEntityId));
}

export function getUnspentHeroAbilityPoints(state: MatchState, heroEntityId: string): number {
  const hero = getRequiredHero(state, heroEntityId);
  return Math.max(0, hero.level - getSpentAbilityPoints(hero));
}

export function upgradeHeroAbility(state: MatchState, heroEntityId: string, key: AbilityKey): MatchState {
  const next = cloneState(state);
  const hero = getRequiredHero(next, heroEntityId);
  const definition = getHeroDefinition(hero.definitionId);
  const ability = definition.abilities[key];
  const currentRank = hero.abilityRanks[key];
  const maxRank = ability.unlockLevels.length;
  if (currentRank >= maxRank) throw new Error(`${key} is already rank ${maxRank}.`);

  const availableRank = ability.unlockLevels.filter(level => level <= hero.level).length;
  const desiredRank = currentRank + 1;
  if (desiredRank > availableRank) {
    const requiredLevel = ability.unlockLevels[desiredRank - 1];
    throw new Error(`${key} rank ${desiredRank} requires hero level ${requiredLevel}.`);
  }

  if (getSpentAbilityPoints(hero) >= hero.level) {
    throw new Error(`${hero.heroEntityId} has no unspent ability points at hero level ${hero.level}.`);
  }

  hero.abilityRanks[key] = desiredRank;
  return next;
}

export function equipInventoryItem(
  state: MatchState,
  heroEntityId: string,
  inventorySlot: 0 | 1 | 2 | 3 | 4 | 5,
  item: InventoryItem | null,
): MatchState {
  const next = cloneState(state);
  const hero = getRequiredHero(next, heroEntityId);
  const slot = hero.inventory.find(candidate => candidate.slot === inventorySlot);
  if (!slot) throw new Error(`Inventory slot ${inventorySlot} does not exist.`);
  slot.item = item ? structuredClone(item) : null;
  return next;
}

export function getPlayerSelectedHeroId(state: MatchState, playerId: string): HeroId | null {
  return getRequiredPlayer(state, playerId).selectedHeroId;
}

export function getPlayerOwnedHero(state: MatchState, playerId: string): MatchHeroState | null {
  const player = getRequiredPlayer(state, playerId);
  if (!player.ownedHeroEntityId) return null;
  return getRequiredHero(state, player.ownedHeroEntityId);
}

export function getSlotAssignment(state: MatchState, slotId: MatchSlotId): {
  slot: MatchSlotState;
  player: MatchPlayerState | null;
  hero: MatchHeroState | null;
} {
  const slot = getRequiredSlot(state, slotId);
  return {
    slot,
    player: slot.playerId ? getRequiredPlayer(state, slot.playerId) : null,
    hero: slot.heroEntityId ? getRequiredHero(state, slot.heroEntityId) : null,
  };
}

export function validateMatchState(state: MatchState): void {
  if (state.slots.length !== 10) throw new Error(`A match must contain exactly 10 slots, received ${state.slots.length}.`);
  for (const team of TEAMS) {
    const teamSlots = state.slots.filter(slot => slot.team === team);
    if (teamSlots.length !== 5) throw new Error(`Team ${team} must contain exactly 5 slots.`);
  }

  const slotIds = new Set(state.slots.map(slot => slot.slotId));
  if (slotIds.size !== 10) throw new Error('Match slot ids must be unique.');

  for (const player of Object.values(state.players)) {
    const slot = getRequiredSlot(state, player.slotId);
    if (slot.playerId !== player.playerId) throw new Error(`Player ${player.playerId} is not linked back from slot ${player.slotId}.`);
    if (player.ownedHeroEntityId) {
      const hero = getRequiredHero(state, player.ownedHeroEntityId);
      if (hero.ownerPlayerId !== player.playerId) throw new Error(`Hero ${hero.heroEntityId} ownership is inconsistent.`);
      if (slot.heroEntityId !== hero.heroEntityId) throw new Error(`Hero ${hero.heroEntityId} is not linked back from slot ${slot.slotId}.`);
    }
  }

  for (const hero of Object.values(state.heroes)) {
    const definition = getHeroDefinition(hero.definitionId);
    if (hero.level < 1 || hero.level > definition.maxLevel) {
      throw new Error(`Hero ${hero.heroEntityId} has invalid level ${hero.level}.`);
    }
    if (hero.gold < 0 || hero.lastHits < 0 || hero.denies < 0 || hero.experience < 0) {
      throw new Error(`Hero ${hero.heroEntityId} has invalid progression state.`);
    }
    assertAbilityAllocationFitsLevel(hero, definition, hero.level);
  }
}

export function getRequiredPlayer(state: MatchState, playerId: string): MatchPlayerState {
  const player = state.players[playerId];
  if (!player) throw new Error(`Unknown player ${playerId}.`);
  return player;
}

export function getRequiredHero(state: MatchState, heroEntityId: string): MatchHeroState {
  const hero = state.heroes[heroEntityId];
  if (!hero) throw new Error(`Unknown hero entity ${heroEntityId}.`);
  return hero;
}

function getRequiredSlot(state: MatchState, slotId: MatchSlotId): MatchSlotState {
  const slot = state.slots.find(candidate => candidate.slotId === slotId);
  if (!slot) throw new Error(`Unknown match slot ${slotId}.`);
  return slot;
}

function getSpentAbilityPoints(hero: MatchHeroState): number {
  return ABILITY_KEYS.reduce((total, key) => total + hero.abilityRanks[key], 0);
}

function assertAbilityAllocationFitsLevel(
  hero: MatchHeroState,
  definition: HeroDefinition,
  heroLevel: number,
): void {
  const spentPoints = getSpentAbilityPoints(hero);
  if (spentPoints > heroLevel) {
    throw new RangeError(
      `Hero ${hero.heroEntityId} has spent ${spentPoints} ability points but level ${heroLevel} only grants ${heroLevel}.`,
    );
  }

  for (const key of ABILITY_KEYS) {
    const rank = hero.abilityRanks[key];
    const unlockLevels = definition.abilities[key].unlockLevels;
    if (!Number.isInteger(rank) || rank < 0 || rank > unlockLevels.length) {
      throw new RangeError(`${key} rank ${rank} is invalid for ${definition.displayName}.`);
    }
    if (rank > 0) {
      const requiredLevel = unlockLevels[rank - 1];
      if (requiredLevel === undefined || heroLevel < requiredLevel) {
        throw new RangeError(`${key} rank ${rank} requires hero level ${requiredLevel}.`);
      }
    }
  }
}

function cloneState(state: MatchState): MatchState {
  return structuredClone(state);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
