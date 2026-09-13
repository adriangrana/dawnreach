import { ALDEN } from './alden/gameplay';
import type { HeroDefinition, HeroId } from './types';

export function getHeroDefinition(heroId: HeroId): HeroDefinition {
  if (heroId === ALDEN.id) return ALDEN;
  throw new Error(`Unknown hero definition: ${heroId}`);
}

export function hasHeroDefinition(heroId: HeroId): boolean {
  return heroId === ALDEN.id;
}

export function listHeroDefinitions(): readonly HeroDefinition[] {
  return [ALDEN];
}
