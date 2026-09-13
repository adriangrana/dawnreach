export const MAX_HERO_LEVEL = 30 as const;

export type AbilityKey = 'Q' | 'W' | 'E' | 'R';
export type DamageType = 'physical' | 'magic' | 'true';
export type HeroResourceType = 'mana' | 'rage' | 'energy';
export type HeroId = string;

export interface HeroStats {
  maxHp: number;
  maxResource: number;
  attackDamage: number;
  physicalArmor: number;
  magicResistance: number;
  attackSpeed: number;
  movementSpeed: number;
  hpRegenPerSecond: number;
  resourceRegenPerSecond: number;
  attackRange: number;
  criticalChancePercent: number;
}

export type HeroStatKey = keyof HeroStats;

export type StatProgression =
  | { kind: 'fixed' }
  | { kind: 'linear'; perLevel: number }
  | { kind: 'percentOfBase'; percentPerLevel: number };

export type AbilityUnlockLevels =
  | readonly [number, number, number]
  | readonly [number, number, number, number];

export interface HeroAbilityDefinition {
  key: AbilityKey;
  name: string;
  type: 'active' | 'passive' | 'active_with_passive' | 'ultimate';
  lore: string;
  technicalDescription: string;
  unlockLevels: AbilityUnlockLevels;
}

export interface HeroDefinition {
  id: HeroId;
  displayName: string;
  version: string;
  maxLevel: typeof MAX_HERO_LEVEL;
  className: string;
  primaryRole: string;
  secondaryRoles: readonly string[];
  difficulty: 'Easy' | 'Medium' | 'Hard';
  weaponConfiguration: string;
  weaponDesignReason: string;
  lore: string;
  resource: {
    type: HeroResourceType;
    displayName: string;
    reason: string;
  };
  baseStats: HeroStats;
  statProgression: Record<HeroStatKey, StatProgression>;
  abilities: Record<AbilityKey, HeroAbilityDefinition>;
}

export interface ItemStatModifier {
  stat: HeroStatKey;
  mode: 'flat' | 'percent';
  value: number;
}

export interface InventoryItem {
  instanceId: string;
  definitionId: string;
  displayName: string;
  quantity: number;
  statModifiers: readonly ItemStatModifier[];
}

export interface InventorySlot {
  slot: 0 | 1 | 2 | 3 | 4 | 5;
  item: InventoryItem | null;
}

export interface AbilityRanks {
  Q: number;
  W: number;
  E: number;
  R: number;
}

export function createEmptyAbilityRanks(): AbilityRanks {
  return { Q: 0, W: 0, E: 0, R: 0 };
}

export function createEmptyInventory(): InventorySlot[] {
  return Array.from({ length: 6 }, (_, slot) => ({
    slot: slot as InventorySlot['slot'],
    item: null,
  }));
}
