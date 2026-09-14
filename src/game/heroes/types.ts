export const MAX_HERO_LEVEL = 30 as const;

export type AbilityKey = 'Q' | 'W' | 'E' | 'R';
export type DamageType = 'physical' | 'magic' | 'true';
export type HeroResourceType = 'mana' | 'rage' | 'energy';
export type HeroId = string;

export enum HeroPrimaryAttribute {
  STR = 'strength',
  AGI = 'agility',
  INT = 'intelligence',
}

export interface HeroAttributeValues {
  strength: number;
  agility: number;
  intelligence: number;
}

export interface HeroStats {
  maxHp: number;
  maxResource: number;
  attackDamage: number;
  physicalArmor: number;
  /** Flat percentage reduction applied to physical damage after armor. */
  physicalDamageResistancePercent: number;
  magicResistance: number;
  attackSpeed: number;
  movementSpeed: number;
  hpRegenPerSecond: number;
  resourceRegenPerSecond: number;
  /** Native spell power supplied by hero kits/items. */
  magicPower: number;
  /** Percent modifier applied to damage dealt by hero abilities. */
  abilityPowerPercent: number;
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

export type HeroStatusTone = 'passive' | 'buff' | 'debuff';

export interface HeroPersistentAuraPresentation {
  kind: 'persistent_aura';
  /** HUD-art symbol used by the compact status row. Falls back to a generic passive glyph. */
  art?: string;
  tone?: HeroStatusTone;
}

/**
 * Definition-level passive that exists independently from timed runtime statuses.
 * It stays present through death/respawn and is rendered as a persistent HUD aura.
 */
export interface HeroInnateDefinition {
  id: string;
  name: string;
  description: string;
  technicalDescription: string;
  hud: HeroPersistentAuraPresentation;
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
  primaryAttribute: HeroPrimaryAttribute;
  /** Damage inherent to the hero/weapon before the primary attribute and direct item damage. */
  baseAttackDamage: number;
  baseAttributes: HeroAttributeValues;
  /** Attribute points gained per hero level after level 1. */
  attributeProgression: HeroAttributeValues;
  resource: {
    type: HeroResourceType;
    displayName: string;
    reason: string;
  };
  /** Non-attribute baselines. Global attribute rules are applied on top by heroAttributes.ts. */
  baseStats: HeroStats;
  statProgression: Record<HeroStatKey, StatProgression>;
  abilities: Record<AbilityKey, HeroAbilityDefinition>;
  /** Optional permanent innate presented in the HUD as a persistent aura, not a fake timed status. */
  innate?: HeroInnateDefinition;
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
  /** Absolute performance.now()-based timestamp. Preserved while moving or dropping the item. */
  cooldownReadyAtMs: number;
}

export interface InventorySlot {
  /** Slots 0-5 are normal inventory. Slot 6 is the dedicated teleport-scroll slot. */
  slot: 0 | 1 | 2 | 3 | 4 | 5 | 6;
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
  return Array.from({ length: 7 }, (_, slot) => ({
    slot: slot as InventorySlot['slot'],
    item: null,
  }));
}
