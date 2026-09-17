import {
  subscribeMatchEvents,
  type HeroKilledMatchEvent,
  type MatchEvent,
  type MatchEventParticipant,
  type MatchPauseMatchEvent,
  type ObjectiveKilledMatchEvent,
  type PlayerConnectionMatchEvent,
  type ThroneDestroyedMatchEvent,
  type ThroneUnderAttackMatchEvent,
  type TowerDestroyedMatchEvent,
} from '../game/match/matchEvents';

const FEED_ID = 'dawnreach-match-event-feed';
const MAX_VISIBLE_ROWS = 6;
const ROW_LIFETIME_MS = 7_500;
const EXIT_ANIMATION_MS = 220;

type FeedSystemEvent =
  | TowerDestroyedMatchEvent
  | ObjectiveKilledMatchEvent
  | ThroneDestroyedMatchEvent
  | ThroneUnderAttackMatchEvent
  | MatchPauseMatchEvent
  | PlayerConnectionMatchEvent;

const heroPortraits = {
  ...import.meta.glob<string>('../game/heroes/*/images/H*.webp', { eager: true, query: '?url', import: 'default' }),
  ...import.meta.glob<string>('../game/heroes/*/images/H*.png', { eager: true, query: '?url', import: 'default' }),
};

function teamClass(team: MatchEventParticipant['team']) {
  if (team === 'blue') return 'is-dawn';
  if (team === 'red') return 'is-dusk';
  return 'is-neutral';
}

function heroSlug(entityId: string) {
  const marker = '-hero-';
  const index = entityId.indexOf(marker);
  if (index < 0) return '';
  return entityId.slice(index + marker.length).split(':')[0].toLowerCase();
}

function portraitFor(participant: MatchEventParticipant) {
  if (participant.kind !== 'hero') return '';
  const slug = heroSlug(participant.entityId);
  if (!slug) return '';
  const directoryMarker = `/heroes/${slug}/images/`;
  for (const [path, url] of Object.entries(heroPortraits)) {
    if (!path.includes(directoryMarker)) continue;
    const file = path.split('/').pop() ?? '';
    if (/^H\d{3}\.(?:webp|png)$/i.test(file)) return url;
  }
  return '';
}

function createPortrait(participant: MatchEventParticipant) {
  const root = document.createElement('span');
  root.className = `match-event-feed-portrait ${teamClass(participant.team)}`;
  const portrait = portraitFor(participant);
  if (portrait) {
    const image = document.createElement('img');
    image.src = portrait;
    image.alt = '';
    image.draggable = false;
    root.appendChild(image);
  } else {
    root.textContent = participant.label.charAt(0).toUpperCase() || '?';
  }
  return root;
}

function createParticipant(participant: MatchEventParticipant, align: 'left' | 'right') {
  const root = document.createElement('span');
  root.className = `match-event-feed-participant ${teamClass(participant.team)} is-${align}`;
  const name = document.createElement('span');
  name.className = 'match-event-feed-name';
  name.textContent = participant.label;
  if (align === 'left') root.append(createPortrait(participant), name);
  else root.append(name, createPortrait(participant));
  return root;
}

function createKillRow(event: HeroKilledMatchEvent) {
  const row = document.createElement('div');
  row.className = 'match-event-feed-row is-kill is-entering';
  row.dataset.eventId = event.eventId;

  const killer = event.killer ?? {
    entityId: 'environment',
    team: 'neutral' as const,
    kind: 'unknown' as const,
    label: 'Entorno',
  };
  const icon = document.createElement('span');
  icon.className = 'match-event-feed-kill-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = '⚔';

  row.append(createParticipant(killer, 'left'), icon, createParticipant(event.victim, 'right'));
  row.setAttribute('aria-label', `${killer.label} eliminó a ${event.victim.label}`);
  return row;
}

function localPlayerLabel(playerId: string | null) {
  if (!playerId) return 'El sistema';
  return playerId === 'local-player' ? 'Tú' : playerId;
}

function systemEventCopy(event: FeedSystemEvent) {
  if (event.type === 'tower_destroyed') {
    return {
      icon: '♜',
      text: `${event.destroyer?.label ?? 'Un enemigo'} destruyó ${event.tower.label}`,
      team: event.destroyer?.team ?? event.tower.team,
    };
  }
  if (event.type === 'objective_killed') {
    return {
      icon: '◆',
      text: `${event.killer?.label ?? 'Un equipo'} derrotó a ${event.objective.label}`,
      team: event.killer?.team ?? 'neutral' as const,
    };
  }
  if (event.type === 'throne_destroyed') {
    const winner = event.winnerTeam === 'blue' ? 'Dawn' : event.winnerTeam === 'red' ? 'Dusk' : 'Un equipo';
    return {
      icon: '♛',
      text: `${winner} destruyó ${event.throne.label}`,
      team: event.winnerTeam,
    };
  }
  if (event.type === 'throne_under_attack') {
    return {
      icon: '⚠',
      text: `${event.throne.label} está bajo ataque`,
      team: event.throne.team,
    };
  }
  if (event.type === 'match_paused') {
    return {
      icon: 'Ⅱ',
      text: `${localPlayerLabel(event.actorPlayerId)} pausó la partida`,
      team: 'neutral' as const,
    };
  }
  if (event.type === 'match_resumed') {
    return {
      icon: '▶',
      text: `${localPlayerLabel(event.actorPlayerId)} reanudó la partida`,
      team: 'neutral' as const,
    };
  }
  if (event.type === 'player_disconnected' || event.type === 'player_reconnected') {
    return {
      icon: event.type === 'player_reconnected' ? '↻' : '×',
      text: `${event.displayName} ${event.type === 'player_reconnected' ? 'se reconectó' : 'se desconectó'}`,
      team: event.team,
    };
  }

  const exhaustive: never = event;
  return exhaustive;
}

function createSystemRow(event: FeedSystemEvent) {
  const row = document.createElement('div');
  const copy = systemEventCopy(event);
  row.className = `match-event-feed-row is-system ${teamClass(copy.team)} is-entering`;
  row.dataset.eventId = event.eventId;
  const icon = document.createElement('span');
  icon.className = 'match-event-feed-system-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = copy.icon;
  const text = document.createElement('span');
  text.className = 'match-event-feed-system-copy';
  text.textContent = copy.text;
  row.append(icon, text);
  row.setAttribute('aria-label', copy.text);
  return row;
}

function createRow(event: MatchEvent): HTMLElement | null {
  if (event.type === 'hero_killed') return createKillRow(event);
  if (
    event.type === 'tower_destroyed'
    || event.type === 'objective_killed'
    || event.type === 'throne_destroyed'
    || event.type === 'throne_under_attack'
    || event.type === 'match_paused'
    || event.type === 'match_resumed'
    || event.type === 'player_disconnected'
    || event.type === 'player_reconnected'
  ) {
    return createSystemRow(event);
  }
  return null;
}

export function mountMatchEventFeed() {
  if (typeof document === 'undefined') return () => undefined;
  document.getElementById(FEED_ID)?.remove();

  const root = document.createElement('aside');
  root.id = FEED_ID;
  root.className = 'match-event-feed';
  root.setAttribute('aria-label', 'Eventos de partida');
  root.setAttribute('aria-live', 'polite');
  root.setAttribute('aria-atomic', 'false');
  document.body.appendChild(root);

  const timers = new Map<string, number>();

  const removeRow = (row: HTMLElement) => {
    const eventId = row.dataset.eventId ?? '';
    const timer = timers.get(eventId);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.delete(eventId);
    row.classList.add('is-exiting');
    window.setTimeout(() => row.remove(), EXIT_ANIMATION_MS);
  };

  const push = (event: MatchEvent) => {
    if (root.querySelector(`[data-event-id="${CSS.escape(event.eventId)}"]`)) return;
    const row = createRow(event);
    if (!row) return;
    root.prepend(row);
    requestAnimationFrame(() => row.classList.remove('is-entering'));

    const timer = window.setTimeout(() => removeRow(row), ROW_LIFETIME_MS);
    timers.set(event.eventId, timer);

    while (root.children.length > MAX_VISIBLE_ROWS) {
      const oldest = root.lastElementChild;
      if (oldest instanceof HTMLElement) removeRow(oldest);
      else break;
    }
  };

  const unsubscribe = subscribeMatchEvents(push);
  return () => {
    unsubscribe();
    for (const timer of timers.values()) window.clearTimeout(timer);
    timers.clear();
    root.remove();
  };
}
