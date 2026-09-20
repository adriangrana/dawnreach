import type { AbilityKey, HeroId } from './types';

export type HeroAssetKind = '' | 'F' | 'I' | AbilityKey;

const HERO_IMAGE_ASSETS = {
  ...import.meta.glob<string>('./*/images/*.webp', { eager: true, query: '?url', import: 'default' }),
  ...import.meta.glob<string>('./*/images/*.png', { eager: true, query: '?url', import: 'default' }),
};

const ASSET_BY_KEY = new Map<string, string>();
for (const [path, url] of Object.entries(HERO_IMAGE_ASSETS)) {
  const match = /\/images\/(H\d{3})([A-Z]?)\.(?:webp|png)$/i.exec(path);
  if (!match) continue;
  const heroId = match[1].toUpperCase();
  const suffix = match[2].toUpperCase();
  const key = `${heroId}:${suffix}`;
  const existing = ASSET_BY_KEY.get(key);
  // Prefer WebP when both formats exist.
  if (!existing || /\.webp(?:\?|$)/i.test(url)) ASSET_BY_KEY.set(key, url);
}

export function getHeroAsset(heroId: HeroId | string, kind: HeroAssetKind = ''): string {
  const id = String(heroId).toUpperCase();
  const direct = ASSET_BY_KEY.get(`${id}:${kind}`);
  if (direct) return direct;
  if (kind === 'I') {
    const legacyPassive = ASSET_BY_KEY.get(`${id}:P`);
    if (legacyPassive) return legacyPassive;
  }
  return kind === '' ? '' : ASSET_BY_KEY.get(`${id}:`) ?? '';
}

export const getHeroPortrait = (heroId: HeroId | string) => getHeroAsset(heroId, '');
export const getHeroFullArt = (heroId: HeroId | string) => getHeroAsset(heroId, 'F');
export const getHeroInnateArt = (heroId: HeroId | string) => getHeroAsset(heroId, 'I');
export const getHeroAbilityArt = (heroId: HeroId | string, key: AbilityKey) => getHeroAsset(heroId, key);
