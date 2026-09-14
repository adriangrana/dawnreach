import rawTowerGameplay from './towers.json';

export type TowerTier = 1 | 2 | 3 | 4;

export const TOWER_GAMEPLAY = rawTowerGameplay.defaultTower;
export const TOWER_GAMEPLAY_SCHEMA_VERSION = rawTowerGameplay.schemaVersion;
export const TOWER_TIERS = rawTowerGameplay.tiers;

export type TowerAbilityConfig = (typeof TOWER_GAMEPLAY.abilities)[number];
export type TowerTierConfig = (typeof TOWER_TIERS)[keyof typeof TOWER_TIERS];

export function normalizeTowerTier(value: number): TowerTier {
  if (value >= 4) return 4;
  if (value >= 3) return 3;
  if (value >= 2) return 2;
  return 1;
}

export function getTowerTierConfig(tier: number): TowerTierConfig {
  switch (normalizeTowerTier(tier)) {
    case 1: return TOWER_TIERS['1'];
    case 2: return TOWER_TIERS['2'];
    case 3: return TOWER_TIERS['3'];
    case 4: return TOWER_TIERS['4'];
  }
}

export function rollTowerAttackDamage(tier: number, random = Math.random): number {
  const config = getTowerTierConfig(tier);
  const minimum = Math.min(config.damageMin, config.damageMax);
  const maximum = Math.max(config.damageMin, config.damageMax);
  const roll = Math.max(0, Math.min(0.999999, random()));
  return Math.floor(minimum + roll * (maximum - minimum + 1));
}

export function getTowerAbility(id: string): TowerAbilityConfig | undefined {
  return TOWER_GAMEPLAY.abilities.find(ability => ability.id === id);
}
