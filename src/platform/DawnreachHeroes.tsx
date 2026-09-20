import { useMemo, useState } from 'react';
import {
  ChevronRight,
  Crosshair,
  Footprints,
  Gauge,
  Heart,
  LockKeyhole,
  Search,
  Shield,
  Sparkles,
  Swords,
} from 'lucide-react';
import { calculateDefinitionAttributesAtLevel, calculateDefinitionStatsAtLevel } from '../game/heroes/heroAttributes';
import { listHeroDefinitions } from '../game/heroes/catalog';
import { HeroPrimaryAttribute, type HeroDefinition } from '../game/heroes/types';

type HeroFilter = 'all' | 'tank' | 'bruiser' | 'damage' | 'support' | 'control';

const HERO_FILTERS: readonly Readonly<{ key: HeroFilter; label: string }>[] = [
  { key: 'all', label: 'ALL' },
  { key: 'tank', label: 'TANK' },
  { key: 'bruiser', label: 'BRUISER' },
  { key: 'damage', label: 'DAMAGE' },
  { key: 'support', label: 'SUPPORT' },
  { key: 'control', label: 'CONTROL' },
];

function heroPortrait(heroId: string) {
  return heroId === 'H001' ? '/src/game/heroes/alden/images/H001.webp' : '';
}

function heroFullArt(heroId: string) {
  return heroId === 'H001' ? '/src/game/heroes/alden/images/H001F.png' : '';
}

function abilityArt(heroId: string, key: 'I' | 'Q' | 'W' | 'E' | 'R') {
  return heroId === 'H001' ? `/src/game/heroes/alden/images/H001${key}.webp` : '';
}

function primaryAttributeLabel(attribute: HeroPrimaryAttribute) {
  if (attribute === HeroPrimaryAttribute.STR) return 'STRENGTH';
  if (attribute === HeroPrimaryAttribute.AGI) return 'AGILITY';
  return 'INTELLIGENCE';
}

function difficultyBars(difficulty: HeroDefinition['difficulty']) {
  return difficulty === 'Easy' ? 1 : difficulty === 'Medium' ? 2 : 3;
}

function matchesFilter(hero: HeroDefinition, filter: HeroFilter) {
  if (filter === 'all') return true;
  const roleText = [hero.primaryRole, hero.className, ...hero.secondaryRoles].join(' ').toLowerCase();
  if (filter === 'tank') return roleText.includes('tank') || roleText.includes('tanque') || roleText.includes('frontline');
  if (filter === 'bruiser') return roleText.includes('bruiser') || roleText.includes('sostenido');
  if (filter === 'damage') return roleText.includes('damage') || roleText.includes('daño');
  if (filter === 'support') return roleText.includes('support') || roleText.includes('apoyo');
  return roleText.includes('control') || roleText.includes('iniciador');
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

  const visibleHeroes = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return heroes.filter(hero => {
      if (!matchesFilter(hero, filter)) return false;
      if (!normalized) return true;
      return [hero.displayName, hero.className, hero.primaryRole, ...hero.secondaryRoles]
        .some(value => value.toLowerCase().includes(normalized));
    });
  }, [heroes, filter, query]);

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
        <header><strong>FILTER</strong><span>ROLE</span></header>
        <nav>
          {HERO_FILTERS.map(item => <button
            key={item.key}
            type="button"
            className={filter === item.key ? 'is-active' : ''}
            onClick={() => setFilter(item.key)}
          ><span className="dr-heroes-filter-icon">{item.key === 'tank' ? <Shield /> : item.key === 'all' ? <Sparkles /> : <Swords />}</span><span>{item.label}</span></button>)}
        </nav>
        <div className="dr-heroes-owned-summary"><small>FOUNDATION ROSTER</small><strong>{heroes.length} / {heroes.length}</strong><span>AVAILABLE</span></div>
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
              <article><img src={abilityArt(selected.id,'I')} alt="" /><span><b>{selected.innate?.name ?? 'Innate'}</b><small>INNATE</small></span></article>
              {(['Q','W','E','R'] as const).map(key => <article key={key}><img src={abilityArt(selected.id,key)} alt="" /><span><b>{selected.abilities[key].name}</b><small>{key}</small></span></article>)}
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
