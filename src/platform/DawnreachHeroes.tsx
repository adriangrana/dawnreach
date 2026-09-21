import { useEffect, useMemo, useState, type FocusEvent, type MouseEvent } from 'react';
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
import { getHeroAbilityArt, getHeroFullArt, getHeroPassiveArt, getHeroPortrait } from '../game/heroes/assets';
import { calculateDefinitionAttributesAtLevel, calculateDefinitionStatsAtLevel } from '../game/heroes/heroAttributes';
import { listHeroDefinitions } from '../game/heroes/catalog';
import { HeroPrimaryAttribute, type HeroDefinition } from '../game/heroes/types';

type HeroFilter = 'all' | 'north' | 'mid' | 'south' | 'favorites' | 'recent';
type DisplayAbilityKey = 'P' | 'Q' | 'W' | 'E' | 'R';

type AbilityTooltipState = Readonly<{
  key: DisplayAbilityKey;
  left: number;
  top: number;
}>;

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
      { key: 'north', label: 'NORTH', icon: Shield },
      { key: 'mid', label: 'MID', icon: Crosshair },
      { key: 'south', label: 'SOUTH', icon: Swords },
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
  return getHeroPortrait(heroId);
}

function heroFullArt(heroId: string) {
  return getHeroFullArt(heroId) || getHeroPortrait(heroId);
}

function abilityArt(heroId: string, key: 'P' | 'Q' | 'W' | 'E' | 'R') {
  return key === 'P' ? getHeroPassiveArt(heroId) : getHeroAbilityArt(heroId, key);
}

function primaryAttributeLabel(attribute: HeroPrimaryAttribute) {
  if (attribute === HeroPrimaryAttribute.STR) return 'STRENGTH';
  if (attribute === HeroPrimaryAttribute.AGI) return 'AGILITY';
  return 'INTELLIGENCE';
}

function difficultyBars(difficulty: HeroDefinition['difficulty']) {
  return difficulty === 'Easy' ? 1 : difficulty === 'Medium' ? 2 : 3;
}

function abilityTypeLabel(hero: HeroDefinition, key: DisplayAbilityKey) {
  if (key === 'P') return 'INNATE';
  const type = hero.abilities[key].type;
  if (type === 'ultimate') return 'ULTIMATE';
  if (type === 'passive') return 'PASSIVE';
  if (type === 'active_with_passive') return 'ACTIVE + PASSIVE';
  return 'ACTIVE';
}

function abilityTooltipPosition(target: HTMLElement) {
  const rect = target.getBoundingClientRect();
  const width = 330;
  const gap = 12;
  const preferredLeft = rect.left - width - gap;
  const left = Math.max(12, Math.min(window.innerWidth - width - 12, preferredLeft));
  const top = Math.max(12, Math.min(window.innerHeight - 260, rect.top - 18));
  return { left, top };
}

function heroMatchesLane(hero: HeroDefinition, lane: 'north' | 'mid' | 'south') {
  const wanted = lane.toUpperCase();
  return Boolean(
    hero.deploymentPreferences?.primary.includes(wanted as 'NORTH' | 'MID' | 'SOUTH')
    || hero.deploymentPreferences?.secondary.includes(wanted as 'NORTH' | 'MID' | 'SOUTH'),
  );
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
  return heroMatchesLane(hero, filter);
}

function FutureHeroCard({ index }: { index: number }) {
  return <article className="dr-heroes-card is-future" aria-label="Future hero slot">
    <div className="dr-heroes-future-art"><LockKeyhole /></div>
    <footer><strong>FUTURE HERO</strong><small>SLOT {String(index + 1).padStart(2, '0')}</small></footer>
  </article>;
}

export function DawnreachHeroes({ onPlay, onPractice }: { onPlay: () => void; onPractice: (heroId: string) => void }) {
  const heroes = useMemo(() => listHeroDefinitions(), []);
  const [filter, setFilter] = useState<HeroFilter>('all');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(heroes[0]?.id ?? '');
  const [abilityTooltip, setAbilityTooltip] = useState<AbilityTooltipState | null>(null);

  // Favorites and recent-played data do not exist as persistent account data yet.
  // Keep the filters functional and truthful instead of inventing ownership/history.
  const favoriteHeroIds = useMemo(() => new Set<string>(), []);
  const recentHeroIds = useMemo(() => new Set<string>(), []);

  const filterCounts = useMemo<Record<HeroFilter, number>>(() => ({
    all: heroes.length,
    north: heroes.filter(hero => heroMatchesLane(hero, 'north')).length,
    mid: heroes.filter(hero => heroMatchesLane(hero, 'mid')).length,
    south: heroes.filter(hero => heroMatchesLane(hero, 'south')).length,
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

  useEffect(() => {
    setAbilityTooltip(null);
  }, [selected?.id]);

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
          {!visibleHeroes.length && <div className="dr-heroes-no-results"><Search /><strong>NO HEROES FOUND</strong><span>Try another search or lane filter.</span></div>}
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
            <header><strong>ABILITIES</strong><span>HOVER FOR DETAILS</span></header>
            <div>
              {(['P','Q','W','E','R'] as const).map(key => {
                const isInnate = key === 'P';
                const name = isInnate ? selected.innate?.name ?? 'Innate' : selected.abilities[key].name;
                const showTooltip = (
                  target: HTMLElement,
                  abilityKey: DisplayAbilityKey,
                ) => {
                  const position = abilityTooltipPosition(target);
                  setAbilityTooltip({ key: abilityKey, ...position });
                };
                const handleMouseEnter = (event: MouseEvent<HTMLButtonElement>) => showTooltip(event.currentTarget, key);
                const handleFocus = (event: FocusEvent<HTMLButtonElement>) => showTooltip(event.currentTarget, key);

                return <article key={key}>
                  <button
                    type="button"
                    className="dr-heroes-ability-trigger"
                    aria-label={`View ${name} details`}
                    aria-describedby={abilityTooltip?.key === key ? 'dr-heroes-ability-tooltip' : undefined}
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={() => setAbilityTooltip(current => current?.key === key ? null : current)}
                    onFocus={handleFocus}
                    onBlur={() => setAbilityTooltip(current => current?.key === key ? null : current)}
                  >
                    {abilityArt(selected.id, key)
                      ? <img src={abilityArt(selected.id, key)} alt="" />
                      : <span className="dr-heroes-ability-placeholder" aria-hidden="true"><Sparkles /></span>}
                    <span><b>{name}</b><small>{isInnate ? 'INNATE' : key}</small></span>
                  </button>
                </article>;
              })}
            </div>
          </section>

          {abilityTooltip && (() => {
            const key = abilityTooltip.key;
            const innate = key === 'P' ? selected.innate : null;
            const ability = key === 'P' ? null : selected.abilities[key];
            const name = innate?.name ?? ability?.name ?? 'Innate';
            const description = innate?.description ?? ability?.lore ?? '';
            const technicalDescription = innate?.technicalDescription ?? ability?.technicalDescription ?? '';
            const unlockLevels = ability?.unlockLevels ?? [];

            return <aside
              id="dr-heroes-ability-tooltip"
              className="dr-heroes-ability-tooltip"
              role="tooltip"
              style={{ left: abilityTooltip.left, top: abilityTooltip.top }}
            >
              <div className="dr-heroes-ability-tooltip-head">
                <span className="dr-heroes-ability-tooltip-icon">
                  {abilityArt(selected.id, key)
                    ? <img src={abilityArt(selected.id, key)} alt="" />
                    : <Sparkles />}
                </span>
                <span>
                  <small>{key === 'P' ? 'INNATE' : key} · {abilityTypeLabel(selected, key)}</small>
                  <strong>{name}</strong>
                </span>
              </div>
              {description && <p>{description}</p>}
              {technicalDescription && <div className="dr-heroes-ability-tooltip-tech">
                <small>ABILITY DETAILS</small>
                <p>{technicalDescription}</p>
              </div>}
              {!!unlockLevels.length && <footer>
                <span>RANK LEVELS</span>
                <strong>{unlockLevels.join(' · ')}</strong>
              </footer>}
            </aside>;
          })()}

          <div className="dr-heroes-detail-actions">
            <button type="button" onClick={() => onPractice(selected.id)}>PRACTICE</button>
            <button className="is-primary" type="button" onClick={onPlay}>PLAY <ChevronRight /></button>
          </div>
        </div>
      </aside>
    </div>
  </section>;
}
