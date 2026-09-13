import rawTowerGameplay from './towers.json';

export const TOWER_GAMEPLAY = rawTowerGameplay.defaultTower;
export const TOWER_GAMEPLAY_SCHEMA_VERSION = rawTowerGameplay.schemaVersion;

export type TowerAbilityConfig = (typeof TOWER_GAMEPLAY.abilities)[number];

export function getTowerAbility(id: string): TowerAbilityConfig | undefined {
  return TOWER_GAMEPLAY.abilities.find(ability => ability.id === id);
}
