import {
  subscribeMatchEvents,
  type FirstBloodMatchEvent,
  type MatchEvent,
  type MultiKillMatchEvent,
  type ObjectiveKilledMatchEvent,
} from '../game/match/matchEvents';

const BANNER_ID = 'dawnreach-match-event-banner';
const DISPLAY_MS = 2_650;
const EXIT_MS = 240;

type BannerCopy = Readonly<{
  title: string;
  subtitle: string;
  tone: 'dawn' | 'dusk' | 'neutral';
}>;

function toneForTeam(team: 'blue' | 'red' | 'neutral'): BannerCopy['tone'] {
  if (team === 'blue') return 'dawn';
  if (team === 'red') return 'dusk';
  return 'neutral';
}

function multiKillTitle(count: number) {
  if (count <= 2) return 'DOBLE BAJA';
  if (count === 3) return 'TRIPLE BAJA';
  if (count === 4) return 'CUÁDRUPLE BAJA';
  return 'PENTABAJA';
}

function firstBloodCopy(event: FirstBloodMatchEvent): BannerCopy {
  return {
    title: 'PRIMERA SANGRE',
    subtitle: `${event.killer.label} eliminó a ${event.victim.label}`,
    tone: toneForTeam(event.killer.team),
  };
}

function multiKillCopy(event: MultiKillMatchEvent): BannerCopy {
  return {
    title: multiKillTitle(event.count),
    subtitle: `${event.killer.label} encadena ${event.count} eliminaciones`,
    tone: toneForTeam(event.killer.team),
  };
}

function objectiveCopy(event: ObjectiveKilledMatchEvent): BannerCopy {
  return {
    title: `${event.objective.label.toUpperCase()} HA CAÍDO`,
    subtitle: event.killer ? `${event.killer.label} aseguró el objetivo` : 'Objetivo neutral derrotado',
    tone: toneForTeam(event.killer?.team ?? 'neutral'),
  };
}

function copyFor(event: MatchEvent): BannerCopy | null {
  if (event.type === 'first_blood') return firstBloodCopy(event);
  if (event.type === 'multi_kill') return multiKillCopy(event);
  if (event.type === 'objective_killed') return objectiveCopy(event);
  return null;
}

export function mountMatchEventBanner() {
  if (typeof document === 'undefined') return () => undefined;
  document.getElementById(BANNER_ID)?.remove();

  const root = document.createElement('section');
  root.id = BANNER_ID;
  root.className = 'match-event-banner';
  root.hidden = true;
  root.setAttribute('aria-live', 'assertive');
  root.setAttribute('aria-atomic', 'true');
  root.innerHTML = `
    <div class="match-event-banner-frame">
      <span class="match-event-banner-wing" aria-hidden="true"></span>
      <div class="match-event-banner-copy">
        <strong class="match-event-banner-title"></strong>
        <span class="match-event-banner-subtitle"></span>
      </div>
      <span class="match-event-banner-wing is-right" aria-hidden="true"></span>
    </div>`;
  document.body.appendChild(root);

  const title = root.querySelector<HTMLElement>('.match-event-banner-title');
  const subtitle = root.querySelector<HTMLElement>('.match-event-banner-subtitle');
  const queue: BannerCopy[] = [];
  let activeTimer: number | null = null;
  let exitTimer: number | null = null;
  let showing = false;

  const showNext = () => {
    if (showing || queue.length === 0) return;
    const copy = queue.shift();
    if (!copy) return;
    showing = true;
    root.hidden = false;
    root.classList.remove('is-dawn', 'is-dusk', 'is-neutral', 'is-visible', 'is-exiting');
    root.classList.add(`is-${copy.tone}`);
    if (title) title.textContent = copy.title;
    if (subtitle) subtitle.textContent = copy.subtitle;
    requestAnimationFrame(() => root.classList.add('is-visible'));

    activeTimer = window.setTimeout(() => {
      root.classList.add('is-exiting');
      root.classList.remove('is-visible');
      exitTimer = window.setTimeout(() => {
        root.hidden = true;
        root.classList.remove('is-exiting');
        showing = false;
        showNext();
      }, EXIT_MS);
    }, DISPLAY_MS);
  };

  const unsubscribe = subscribeMatchEvents((event) => {
    const copy = copyFor(event);
    if (!copy) return;
    queue.push(copy);
    showNext();
  });

  return () => {
    unsubscribe();
    queue.length = 0;
    if (activeTimer !== null) window.clearTimeout(activeTimer);
    if (exitTimer !== null) window.clearTimeout(exitTimer);
    root.remove();
  };
}
