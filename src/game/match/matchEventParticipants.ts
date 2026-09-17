import type {
  MatchEventEntityKind,
  MatchEventTeam,
} from './matchEvents';

const GENERATED_WORLD_ID_PREFIXES = new Set([
  'hero',
  'creep',
  'tower',
  'building',
  'shop',
  'jungle-creature',
  'unknown',
]);

function titleCase(value: string) {
  return value
    .split(/[-_:\s]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * GameEntity falls back to `<kind>:<authored-root-name>:<uuid>` when no explicit id is supplied.
 * Match presentation should never expose that transport/runtime identity directly to players.
 */
export function authoredWorldEntityName(entityId: string) {
  const firstSeparator = entityId.indexOf(':');
  if (firstSeparator <= 0) return entityId;

  const prefix = entityId.slice(0, firstSeparator);
  if (!GENERATED_WORLD_ID_PREFIXES.has(prefix)) return entityId;

  const remainder = entityId.slice(firstSeparator + 1);
  const nextSeparator = remainder.indexOf(':');
  return nextSeparator >= 0 ? remainder.slice(0, nextSeparator) : remainder;
}

export function matchEventTeamFromEntityId(entityId: string): MatchEventTeam {
  const authoredName = authoredWorldEntityName(entityId);
  if (authoredName.startsWith('blue-')) return 'blue';
  if (authoredName.startsWith('red-')) return 'red';
  return 'neutral';
}

export function matchEventKindFromEntityId(entityId: string): MatchEventEntityKind {
  const generatedPrefix = entityId.includes(':') ? entityId.slice(0, entityId.indexOf(':')) : '';
  if (generatedPrefix === 'hero') return 'hero';
  if (generatedPrefix === 'creep') return 'creep';
  if (generatedPrefix === 'tower') return 'tower';
  if (generatedPrefix === 'building') return 'building';
  if (generatedPrefix === 'shop') return 'shop';
  if (generatedPrefix === 'jungle-creature') return 'jungle-creature';

  const authoredName = authoredWorldEntityName(entityId);
  if (authoredName === 'blue-throne' || authoredName === 'red-throne') return 'building';
  if (authoredName.includes('-hero-') || authoredName.startsWith('hero-')) return 'hero';
  if (authoredName.endsWith('-tower') || authoredName.includes('-tower-') || authoredName.startsWith('tower-')) return 'tower';
  if (authoredName.includes('-creep-') || authoredName.startsWith('creep-')) return 'creep';
  if (authoredName.includes('drake') || authoredName.includes('aurelios') || authoredName.includes('jungle')) return 'jungle-creature';
  return 'unknown';
}

export function matchEventLabelForEntityId(entityId: string, kind: MatchEventEntityKind) {
  const authoredName = authoredWorldEntityName(entityId);

  if (authoredName === 'blue-throne') return 'Trono del Alba';
  if (authoredName === 'red-throne') return 'Trono del Ocaso';
  if (authoredName.toLowerCase().includes('radiant-drake') || authoredName.toLowerCase().includes('aurelios')) return 'Aurelios';

  if (kind === 'hero') {
    const heroName = authoredName
      .replace(/^(blue|red|neutral)-/, '')
      .replace(/^hero-/, '');
    return titleCase(heroName) || 'Héroe';
  }

  if (kind === 'tower') {
    const towerName = authoredName
      .replace(/^(blue|red|neutral)-/, '')
      .replace(/^tower-/, '')
      .replace(/-tower$/, '');
    const tokens = towerName.split('-').filter(Boolean);
    const lane = tokens.find(token => token === 'top' || token === 'mid' || token === 'bot');
    const laneLabel = lane === 'top' ? 'superior' : lane === 'mid' ? 'central' : lane === 'bot' ? 'inferior' : null;
    const role = tokens.includes('inner') ? 'interior' : tokens.includes('outer') ? 'exterior' : null;
    if (laneLabel) return `Torre ${laneLabel}${role ? ` ${role}` : ''}`;
    const detail = titleCase(towerName);
    return detail ? `Torre ${detail}` : 'Torre';
  }

  return titleCase(authoredName.replace(/^(blue|red|neutral)-/, '')) || 'Entidad';
}
