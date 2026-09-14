import {
  HeroPrimaryAttribute,
  type HeroAttributeValues,
  type HeroDefinition,
  type HeroStatKey,
  type HeroStats,
} from './types';

export const HERO_ATTRIBUTE_RULES = Object.freeze({
  baseHealth: 200,
  baseMana: 150,
  strength: Object.freeze({
    maxHealthPerPoint: 20,
    hpRegenPerSecondPerPoint: 0.15,
    physicalDamageResistancePercentPerPoint: 0.10,
  }),
  agility: Object.freeze({
    armorPerPoint: 0.18,
    attackSpeedPercentPerPoint: 1.2,
    movementSpeedPercentPerPoint: 0.2,
  }),
  intelligence: Object.freeze({
    maxManaPerPoint: 14,
    manaRegenPerSecondPerPoint: 0.25,
    abilityPowerPercentPerPoint: 0.8,
  }),
  /** Dawnreach currently uses fixed hero movement speed, so the optional AGI move bonus is not applied. */
  agilityAffectsMovementSpeed: false,
});

function finiteNonNegative(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Global, hero-agnostic primary-attribute model.
 * The three totals already include level growth and item bonuses when used by match/stats.ts.
 */
export class HeroAttributes {
  readonly primaryAttribute: HeroPrimaryAttribute;
  readonly str: number;
  readonly agi: number;
  readonly int: number;

  constructor(primaryAttribute: HeroPrimaryAttribute, str: number, agi: number, int: number) {
    this.primaryAttribute = primaryAttribute;
    this.str = finiteNonNegative(str);
    this.agi = finiteNonNegative(agi);
    this.int = finiteNonNegative(int);
  }

  get strength() { return this.str; }
  get agility() { return this.agi; }
  get intelligence() { return this.int; }

  get primaryValue() {
    switch (this.primaryAttribute) {
      case HeroPrimaryAttribute.STR: return this.str;
      case HeroPrimaryAttribute.AGI: return this.agi;
      case HeroPrimaryAttribute.INT: return this.int;
    }
  }

  CalculateMaxHealth(baseHealth = HERO_ATTRIBUTE_RULES.baseHealth) {
    return baseHealth + this.str * HERO_ATTRIBUTE_RULES.strength.maxHealthPerPoint;
  }

  CalculateMaxMana(baseMana = HERO_ATTRIBUTE_RULES.baseMana) {
    return baseMana + this.int * HERO_ATTRIBUTE_RULES.intelligence.maxManaPerPoint;
  }

  CalculateArmor(baseArmor = 0) {
    return baseArmor + this.agi * HERO_ATTRIBUTE_RULES.agility.armorPerPoint;
  }

  CalculateAttackDamage(baseWeaponDamage = 0) {
    return baseWeaponDamage + this.primaryValue;
  }

  CalculateHpRegen(baseRegenPerSecond = 0) {
    return baseRegenPerSecond + this.str * HERO_ATTRIBUTE_RULES.strength.hpRegenPerSecondPerPoint;
  }

  CalculateManaRegen(baseRegenPerSecond = 0) {
    return baseRegenPerSecond + this.int * HERO_ATTRIBUTE_RULES.intelligence.manaRegenPerSecondPerPoint;
  }

  CalculatePhysicalDamageResistance(basePercent = 0) {
    return basePercent + this.str * HERO_ATTRIBUTE_RULES.strength.physicalDamageResistancePercentPerPoint;
  }

  CalculateAttackSpeed(baseAttackSpeed: number) {
    return baseAttackSpeed * (1 + this.agi * HERO_ATTRIBUTE_RULES.agility.attackSpeedPercentPerPoint / 100);
  }

  CalculateMovementSpeed(baseMovementSpeed: number, applyAgilityBonus = HERO_ATTRIBUTE_RULES.agilityAffectsMovementSpeed) {
    if (!applyAgilityBonus) return baseMovementSpeed;
    return baseMovementSpeed * (1 + this.agi * HERO_ATTRIBUTE_RULES.agility.movementSpeedPercentPerPoint / 100);
  }

  CalculateAbilityPowerPercent(basePercent = 0) {
    return basePercent + this.int * HERO_ATTRIBUTE_RULES.intelligence.abilityPowerPercentPerPoint;
  }

  toValues(): HeroAttributeValues {
    return {
      strength: this.str,
      agility: this.agi,
      intelligence: this.int,
    };
  }
}

export function calculateDefinitionBaseStatsAtLevel(definition: HeroDefinition, level: number): HeroStats {
  validateLevel(definition, level);
  const levelsGained = level - 1;
  const result = {} as HeroStats;
  for (const key of Object.keys(definition.baseStats) as HeroStatKey[]) {
    const base = definition.baseStats[key];
    const progression = definition.statProgression[key];
    switch (progression.kind) {
      case 'fixed': result[key] = base; break;
      case 'linear': result[key] = base + progression.perLevel * levelsGained; break;
      case 'percentOfBase': result[key] = base * (1 + progression.percentPerLevel / 100 * levelsGained); break;
    }
  }
  return result;
}

export function calculateDefinitionAttributesAtLevel(definition: HeroDefinition, level: number): HeroAttributes {
  validateLevel(definition, level);
  const levelsGained = level - 1;
  return new HeroAttributes(
    definition.primaryAttribute,
    definition.baseAttributes.strength + definition.attributeProgression.strength * levelsGained,
    definition.baseAttributes.agility + definition.attributeProgression.agility * levelsGained,
    definition.baseAttributes.intelligence + definition.attributeProgression.intelligence * levelsGained,
  );
}

export function applyHeroAttributeRules(
  baseStats: HeroStats,
  definition: HeroDefinition,
  attributes: HeroAttributes,
): HeroStats {
  return {
    ...baseStats,
    maxHp: attributes.CalculateMaxHealth(),
    maxResource: attributes.CalculateMaxMana(),
    attackDamage: attributes.CalculateAttackDamage(definition.baseAttackDamage),
    physicalArmor: attributes.CalculateArmor(baseStats.physicalArmor),
    physicalDamageResistancePercent: attributes.CalculatePhysicalDamageResistance(baseStats.physicalDamageResistancePercent),
    attackSpeed: attributes.CalculateAttackSpeed(baseStats.attackSpeed),
    movementSpeed: attributes.CalculateMovementSpeed(baseStats.movementSpeed),
    hpRegenPerSecond: attributes.CalculateHpRegen(baseStats.hpRegenPerSecond),
    resourceRegenPerSecond: attributes.CalculateManaRegen(baseStats.resourceRegenPerSecond),
    abilityPowerPercent: attributes.CalculateAbilityPowerPercent(baseStats.abilityPowerPercent),
  };
}

export function calculateDefinitionStatsAtLevel(definition: HeroDefinition, level: number): HeroStats {
  return applyHeroAttributeRules(
    calculateDefinitionBaseStatsAtLevel(definition, level),
    definition,
    calculateDefinitionAttributesAtLevel(definition, level),
  );
}

function validateLevel(definition: HeroDefinition, level: number) {
  if (!Number.isInteger(level) || level < 1 || level > definition.maxLevel) {
    throw new RangeError(`${definition.displayName} level must be an integer from 1 to ${definition.maxLevel}.`);
  }
}
