import { ALDEN } from './alden/gameplay';
import { SERYN } from './seryn/gameplay';
import type { HeroDefinition, HeroId } from './types';

const HERO_DEFINITIONS: readonly HeroDefinition[] = [ALDEN, SERYN];
const HERO_BY_ID = new Map<HeroId, HeroDefinition>(HERO_DEFINITIONS.map(hero => [hero.id, hero]));

export function getHeroDefinition(heroId: HeroId): HeroDefinition {
  const definition = HERO_BY_ID.get(heroId);
  if (!definition) throw new Error(`Unknown hero definition: ${heroId}`);
  return definition;
}

export function hasHeroDefinition(heroId: HeroId): boolean {
  return HERO_BY_ID.has(heroId);
}

export function listHeroDefinitions(): readonly HeroDefinition[] {
  return HERO_DEFINITIONS;
}
