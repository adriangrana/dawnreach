import { useMemo, useState } from 'react';
import {
  ChevronRight,
  Clock3,
  Crosshair,
  Footprints,
  Gauge,
  Heart,
  LockKeyhole,
  Search,
  Shield,
  Sparkles,
  Star,
  Swords,
} from 'lucide-react';
import { calculateDefinitionAttributesAtLevel, calculateDefinitionStatsAtLevel } from '../game/heroes/heroAttributes';
import { listHeroDefinitions } from '../game/heroes/catalog';
import { HeroPrimaryAttribute, type HeroDefinition } from '../game/heroes/types';
import aldenPortrait from '../game/heroes/alden/images/H001.webp';
import aldenFullArt from '../game/heroes/alden/images/H001F.png';
import aldenInnate from '../game/heroes/alden/images/H001I.webp';
import aldenQ from '../game/heroes/alden/images/H001Q.webp';
import aldenW from '../game/heroes/alden/images/H001W.webp';
import aldenE from '../game/heroes/alden/images/H001E.webp';
import aldenR from '../game/heroes/alden/images/H001R.webp';

type HeroFilter = 'all' | 'top' | 'jungle' | 'mid' | 'carry' | 'support' | 'favorites' | 'recent';

type SidebarFilterItem = Readonly<{
  key: HeroFilter;
  label: string;
  icon: typeof Sparkles;
}>;

const HERO_FILTER_GROUPS: readonly Readonly<{
  key: string;
  items: readonly SidebarFilterItem[];
}>[] = [
  {
    key: 'primary',
    items: [
      { key: 'all', label: 'ALL HEROES', icon: Sparkles },
      { key: 'top', label: 'TOP', icon: Shield },
      { key: 'jungle', label: 'JUNGLE', icon: Sparkles },
      { key: 'mid', label: 'MID', icon: Crosshair },
      { key: 'carry', label: 'CARRY', icon: Swords },
      { key: 'support', label: 'SUPPORT', icon: Heart },
    ],
  },
  {
    key: 'secondary',
    items: [
      { key: 'favorites', label: 'FAVORITES', icon: Star },
      { key: 'recent', label: 'RECENTLY PLAYED', icon: Clock3 },
    ],
  },
];

function heroPortrait(heroId: string) {
  return heroId === 'H001' ? aldenPortrait : '';
}

function heroFullArt(heroId: string) {
  return heroId === 'H001' ? aldenFullArt : '';
}

function abilityArt(heroId: string, key: 'I' | 'Q' | 'W' | 'E' | 'R') {
  if (heroId !== 'H001') return '';
  return { I: aldenInnate, Q: aldenQ, W: aldenW, E: aldenE, R: aldenR }[key];
}

function primaryAttributeLabel(attribute: HeroPrimaryAttribute) {
  if (attribute === HeroPrimaryAttribute.STR) return 'STRENGTH';
  if (attribute === HeroPrimaryAttribute.AGI) return 'AGILITY';
  return 'INTELLIGENCE';
}

function difficultyBars(difficulty: HeroDefinition['difficulty']) {
  return difficulty === 'Easy' ? 1 : difficulty === 'Medium' ? 2 : 3;
}

function inferHeroLane(hero: HeroDefinition): 'top' | 'jungle' | 'mid' | 'carry' | 'support' {
  const roleText = [hero.primaryRole, hero.className, ...hero.secondaryRoles].join(' ').toLowerCase();

  if (
    roleText.includes('support')
    || roleText.includes('apoyo')
    || roleText.includes('healer')
    || roleText.includes('utility')
  ) return 'support';

  if (
    roleText.includes('jungle')
    || roleText.includes('jungler')
    || roleText.includes('ganker')
  ) return 'jungle';

  if (
    roleText.includes('mid')
    || roleText.includes('mage')
    || roleText.includes('caster')
    || roleText.includes('assassin')
  ) return 'mid';

  if (
    roleText.includes('carry')
    || roleText.includes('marksman')
    || roleText.includes('adc')
  ) return 'carry';

  return 'top';
}

function matchesFilter(
  hero: HeroDefinition,
  filter: HeroFilter,
  favoriteHeroIds: ReadonlySet<string>,
  recentHeroIds: ReadonlySet<string>,
) {
  if (filter === 'all') return true;
  if (filter === 'favorites') return favoriteHeroIds.has(hero.id);
  if (filter === 'recent') return recentHeroIds.has(hero.id);
  return inferHeroLane(hero) === filter;
}

function FutureHeroCard({ index }: { index: number }) {
  return <article className="dr-heroes-card is-future" aria-label="Future hero slot">
    <div className="dr-heroes-future-art"><LockKeyhole /></div>
    <footer><strong>FUTURE HERO</strong><small>SLOT {String(index + 1).padStart(2, '0')}</small></footer>
  </article>;
}

export function DawnreachHeroes({ onPlay, onPractice }: { onPlay: () => void; onPractice: () => void }) {
  const heroes = useMemo(() => listHeroDefinitions(), []);
  const [filter, setFilter] = useState<HeroFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(heroes[0]?.id ?? '');

  // Favorites and recent-played data do not exist as persistent account data yet.
  // Keep the filters functional and truthful instead of inventing ownership/history.
  const favoriteHeroIds = useMemo(() => new Set<string>(), []);
  const recentHeroIds = useMemo(() => new Set<string>(), []);

  const filterCounts = useMemo<Record<HeroFilter, number>>(() => ({
    all: heroes.length,
    top: heroes.filter(hero => inferHeroLane(hero) === 'top').length,
    jungle: heroes.filter(hero => inferHeroLane(hero) === 'jungle').length,
    mid: heroes.filter(hero => inferHeroLane(hero) === 'mid').length,
    carry: heroes.filter(hero => inferHeroLane(hero) === 'carry').length,
    support: heroes.filter(hero => inferHeroLane(hero) === 'support').length,
    favorites: heroes.filter(hero => favoriteHeroIds.has(hero.id)).length,
    recent: heroes.filter(hero => recentHeroIds.has(hero.id)).length,
  }), [heroes, favoriteHeroIds, recentHeroIds]);

  const visibleHeroes = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return heroes.filter(hero => {
      if (!matchesFilter(hero, filter, favoriteHeroIds, recentHeroIds)) return false;
      if (!normalized) return true;
      return [hero.displayName, hero.className, hero.primaryRole, ...hero.secondaryRoles]
        .some(value => value.toLowerCase().includes(normalized));
    });
  }, [heroes, filter, query, favoriteHeroIds, recentHeroIds]);

  const selected = heroes.find(hero => hero.id === selectedId) ?? visibleHeroes[0] ?? heroes[0] ?? null;
  if (!selected) return null;

  const stats = calculateDefinitionStatsAtLevel(selected, 1);
  const attributes = calculateDefinitionAttributesAtLevel(selected, 1);
  const filledDifficulty = difficultyBars(selected.difficulty);

  return <section className="dr-heroes-page">
    <div className="dr-heroes-titlebar">
      <div><small>DAWNREACH ROSTER</small><h1>HEROES</h1><p>Choose a champion and study their role, attributes and abilities.</p></div>
      <div className="dr-heroes-roster-count"><strong>{heroes.length}</strong><span>PLAYABLE<br />HERO{heroes.length === 1 ? '' : 'ES'}</span></div>
    </div>

    <div className="dr-heroes-layout">
      <aside className="dr-heroes-filters">
        <div className="dr-heroes-filter-groups">
          {HERO_FILTER_GROUPS.map(group => (
            <section
              key={group.key}
              className={`dr-heroes-filter-group ${group.key === 'secondary' ? 'is-secondary' : ''}`}
            >
              {group.items.map(item => {
                const Icon = item.icon;
                return <button
                  key={item.key}
                  type="button"
                  className={`dr-heroes-filter-row ${filter === item.key ? 'is-active' : ''}`}
                  onClick={() => setFilter(item.key)}
                >
                  <span className="dr-heroes-filter-row-icon"><Icon /></span>
                  <span className="dr-heroes-filter-row-label">{item.label}</span>
                  <span className="dr-heroes-filter-row-count">({filterCounts[item.key]})</span>
                </button>;
              })}
            </section>
          ))}
        </div>

        <div className="dr-heroes-filter-footer">
          <div className="dr-heroes-filter-footer-art" />
          <p>DIFFERENT PATHS<br />SAME DAWN</p>
        </div>
      </aside>

      <main className="dr-heroes-browser">
        <div className="dr-heroes-browser-toolbar">
          <div className="dr-heroes-view-tabs"><button className="is-active" type="button">ALL HEROES</button><button type="button" disabled>FAVORITES</button></div>
          <label className="dr-heroes-search"><Search /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search heroes" /></label>
        </div>

        <div className="dr-heroes-grid">
          {visibleHeroes.map(hero => <button
            key={hero.id}
            type="button"
            className={`dr-heroes-card is-hero ${selected.id === hero.id ? 'is-selected' : ''}`}
            onClick={() => setSelectedId(hero.id)}
          >
            <img src={heroPortrait(hero.id)} alt={hero.displayName} />
            <span className="dr-heroes-card-overlay" />
            <footer><strong>{hero.displayName.toUpperCase()}</strong><small>{hero.primaryRole.toUpperCase()}</small></footer>
          </button>)}
          {!query && filter === 'all' && Array.from({ length: 11 }, (_, index) => <FutureHeroCard key={index} index={index} />)}
          {!visibleHeroes.length && <div className="dr-heroes-no-results"><Search /><strong>NO HEROES FOUND</strong><span>Try another search or role filter.</span></div>}
        </div>
      </main>

      <aside className="dr-heroes-detail">
        <div className="dr-heroes-detail-art">
          <img src={heroFullArt(selected.id)} alt="" />
          <div className="dr-heroes-detail-gradient" />
          <div className="dr-heroes-detail-name">
            <small>{selected.className.toUpperCase()}</small>
            <h2>{selected.displayName.toUpperCase()}</h2>
            <p>{selected.primaryRole.toUpperCase()}</p>
          </div>
        </div>

        <div className="dr-heroes-detail-content">
          <section className="dr-heroes-identity-row">
            <div><small>PRIMARY ATTRIBUTE</small><strong>{primaryAttributeLabel(selected.primaryAttribute)}</strong></div>
            <div><small>DIFFICULTY</small><span className="dr-heroes-difficulty">{[1,2,3].map(value => <i key={value} className={value <= filledDifficulty ? 'is-filled' : ''} />)}</span></div>
          </section>

          <p className="dr-heroes-lore">{selected.lore}</p>

          <section className="dr-heroes-attributes">
            <article><span>STR</span><strong>{attributes.strength.toFixed(0)}</strong></article>
            <article><span>AGI</span><strong>{attributes.agility.toFixed(0)}</strong></article>
            <article><span>INT</span><strong>{attributes.intelligence.toFixed(0)}</strong></article>
          </section>

          <section className="dr-heroes-combat-stats">
            <article><Heart /><span><small>HEALTH</small><strong>{Math.round(stats.maxHp)}</strong></span></article>
            <article><Swords /><span><small>ATTACK</small><strong>{Math.round(stats.attackDamage)}</strong></span></article>
            <article><Shield /><span><small>ARMOR</small><strong>{stats.physicalArmor.toFixed(1)}</strong></span></article>
            <article><Gauge /><span><small>ATTACK SPEED</small><strong>{stats.attackSpeed.toFixed(2)}</strong></span></article>
            <article><Footprints /><span><small>MOVE SPEED</small><strong>{Math.round(stats.movementSpeed)}</strong></span></article>
            <article><Crosshair /><span><small>RANGE</small><strong>{Math.round(stats.attackRange)}</strong></span></article>
          </section>

          <section className="dr-heroes-abilities">
            <header><strong>ABILITIES</strong><span>INNATE · Q · W · E · R</span></header>
            <div>
              <article title={selected.innate?.name ?? 'Innate'} aria-label={selected.innate?.name ?? 'Innate'}>
                <img src={abilityArt(selected.id,'I')} alt="" />
                <span><b>{selected.innate?.name ?? 'Innate'}</b><small>INNATE</small></span>
              </article>
              {(['Q','W','E','R'] as const).map(key => <article key={key} title={selected.abilities[key].name} aria-label={selected.abilities[key].name}>
                <img src={abilityArt(selected.id,key)} alt="" />
                <span><b>{selected.abilities[key].name}</b><small>{key}</small></span>
              </article>)}
            </div>
          </section>

          <div className="dr-heroes-detail-actions">
            <button type="button" onClick={onPractice}>PRACTICE</button>
            <button className="is-primary" type="button" onClick={onPlay}>PLAY <ChevronRight /></button>
          </div>
        </div>
      </aside>
    </div>
  </section>;
}
