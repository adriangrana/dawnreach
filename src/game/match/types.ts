import type {
  AbilityKey,
  AbilityRanks,
  HeroId,
  HeroStats,
  InventorySlot,
} from '../heroes/types';

export type TeamId = 'dawn' | 'dusk';
export type TeamSlotIndex = 1 | 2 | 3 | 4 | 5;
export type MatchSlotId = `${TeamId}-${TeamSlotIndex}`;
export type MatchPhase = 'lobby' | 'hero_select' | 'loading' | 'in_progress' | 'finished';

export interface MatchSlotState {
  slotId: MatchSlotId;
  team: TeamId;
  index: TeamSlotIndex;
  playerId: string | null;
  heroEntityId: string | null;
}

export interface MatchPlayerState {
  playerId: string;
  displayName: string;
  team: TeamId;
  slotId: MatchSlotId;
  connected: boolean;
  selectedHeroId: HeroId | null;
  ownedHeroEntityId: string | null;
}

export interface TimedStatusState {
  id: string;
  sourceHeroEntityId: string | null;
  rank?: number;
  stacks?: number;
  expiresAtMs: number;
  data?: Record<string, number | string | boolean>;
}

export interface TargetCounterState {
  stacks: number;
  expiresAtMs: number;
}

export interface HeroRuntimeState {
  statuses: Record<string, TimedStatusState>;
  counters: Record<string, number>;
  timestamps: Record<string, number>;
  targetCounters: Record<string, Record<string, TargetCounterState>>;
}

export interface MatchHeroState {
  heroEntityId: string;
  definitionId: HeroId;
  ownerPlayerId: string;
  team: TeamId;
  slotId: MatchSlotId;
  level: number;
  experience: number;
  currentHp: number;
  currentResource: number;
  abilityRanks: AbilityRanks;
  inventory: InventorySlot[];
  cooldownReadyAtMs: Record<AbilityKey, number>;
  runtime: HeroRuntimeState;
}

export interface MatchState {
  matchId: string;
  phase: MatchPhase;
  createdAtMs: number;
  slots: MatchSlotState[];
  players: Record<string, MatchPlayerState>;
  heroes: Record<string, MatchHeroState>;
}

export interface CombatStatsSnapshot {
  stats: HeroStats;
  tenacityPercent: number;
  globalDamageReductionPercent: number;
  frontalDamageReductionPercent: number;
}

export interface DamagePacket {
  sourceHeroEntityId: string | null;
  targetHeroEntityId: string;
  rawDamage: number;
  damageType: 'physical' | 'magic' | 'true';
  isDirect: boolean;
  isFromFront: boolean;
  includesHardCrowdControl?: boolean;
}

export interface DamageResult {
  rawDamage: number;
  mitigatedByResistances: number;
  preventedByGuard: number;
  preventedByGlobalReduction: number;
  finalDamage: number;
  targetHpBefore: number;
  targetHpAfter: number;
}

export interface ActionTargetResult {
  targetHeroEntityId: string;
  rawDamage: number;
  finalDamage: number;
  hpBefore: number;
  hpAfter: number;
  appliedStatuses: string[];
  consumedCadenceStacks: number;
}

export interface HeroActionResult {
  action: 'basic_attack' | AbilityKey;
  actorHeroEntityId: string;
  resourceSpent: number;
  actorHealing: number;
  actorHpBefore: number;
  actorHpAfter: number;
  cooldownReadyAtMs: number | null;
  targets: ActionTargetResult[];
  notes: string[];
}
