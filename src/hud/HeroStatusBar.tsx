import type { ReactNode } from 'react';
import { AlertTriangle, Sparkles } from 'lucide-react';
import type { HeroInnateDefinition, HeroStatusTone } from '../game/heroes/types';
import type { TimedStatusState } from '../game/match/types';
import AbilityButton from './AbilityButton';

type HeroStatusBarProps = {
  heroEntityId: string;
  innate?: HeroInnateDefinition;
  timedStatuses: readonly TimedStatusState[];
  runtimeCounters: Readonly<Record<string, number>>;
  nowMs: number;
  renderArt: (art: string) => ReactNode;
};

type PresentedTimedStatus = {
  status: TimedStatusState;
  tone: Extract<HeroStatusTone, 'buff' | 'debuff'>;
};

function classifyTimedStatus(status: TimedStatusState, heroEntityId: string): PresentedTimedStatus['tone'] {
  if (status.id.startsWith('cc:')) return 'debuff';
  if (status.sourceHeroEntityId && status.sourceHeroEntityId !== heroEntityId) return 'debuff';
  return 'buff';
}

function humanizeStatusId(id: string) {
  const parts = id.split(':').filter(Boolean);
  const raw = parts[0] === 'cc' ? parts[1] : parts.length > 1 ? parts[1] : parts[0];
  if (!raw) return 'Estado temporal';
  return raw
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function formatStatusData(data: TimedStatusState['data']) {
  if (!data) return '';
  const entries = Object.entries(data);
  if (entries.length === 0) return '';
  return entries.map(([key, value]) => `${key}: ${String(value)}`).join(' · ');
}

function TimedStatusIcon({ status, tone, nowMs }: PresentedTimedStatus & { nowMs: number }) {
  const remainingSeconds = Math.max(0, status.expiresAtMs - nowMs) / 1000;
  const name = humanizeStatusId(status.id);
  const data = formatStatusData(status.data);
  const tooltip = [
    name,
    tone === 'debuff' ? 'Debuff temporal' : 'Buff temporal',
    `Duración restante: ${remainingSeconds.toFixed(1)} s`,
    status.rank ? `Rango: ${status.rank}` : '',
    data,
  ].filter(Boolean).join('\n');

  return (
    <span
      className={`hero-status-icon hero-status-icon--${tone}`}
      role="img"
      tabIndex={0}
      aria-label={`${name}, ${tone === 'debuff' ? 'debuff' : 'buff'} temporal`}
      title={tooltip}
      data-status-id={status.id}
      data-status-kind="timed"
    >
      {tone === 'debuff' ? <AlertTriangle aria-hidden="true" /> : <Sparkles aria-hidden="true" />}
      {(status.stacks ?? 0) > 1 && <b className="hero-status-stack">{status.stacks}</b>}
    </span>
  );
}

export default function HeroStatusBar({
  heroEntityId,
  innate,
  timedStatuses,
  runtimeCounters,
  nowMs,
  renderArt,
}: HeroStatusBarProps) {
  const activeStatuses = timedStatuses
    .filter(status => status.expiresAtMs > nowMs)
    .map(status => ({ status, tone: classifyTimedStatus(status, heroEntityId) }))
    .sort((left, right) => Number(left.tone === 'debuff') - Number(right.tone === 'debuff'));
  const innateCounter = innate?.hud.counter;
  const rawInnateStacks = innateCounter ? runtimeCounters[innateCounter.runtimeCounterKey] ?? 0 : 0;
  const innateStacks = innateCounter
    ? Math.max(0, Math.min(innateCounter.maxStacks, Math.floor(rawInnateStacks)))
    : 0;
  const innateReady = Boolean(
    innateCounter?.readyStatusId
    && activeStatuses.some(({ status }) => status.id === innateCounter.readyStatusId),
  );
  const innateDescription = innateCounter
    ? `${innate?.technicalDescription ?? ''} Cargas actuales: ${innateStacks}/${innateCounter.maxStacks}.`
    : innate?.technicalDescription ?? '';

  return (
    <div className="hero-status-bar" aria-label="Estados, auras y efectos del héroe">
      {innate?.hud.kind === 'persistent_aura' && (
        <div
          className={`hero-status-persistent hero-status-persistent--${innate.hud.tone ?? 'passive'}${innateReady ? ' is-ready' : ''}`}
          data-status-id={innate.id}
          data-status-kind="persistent-aura"
          data-status-stacks={innateCounter ? innateStacks : undefined}
          data-status-ready={innateReady ? 'true' : undefined}
        >
          <AbilityButton
            name={innate.name}
            kind="passive"
            art={innate.hud.art ?? 'passive'}
            blockedReason="Aura pasiva permanente"
            description={innateDescription}
            lore={innate.description}
          >
            {innate.hud.art ? renderArt(innate.hud.art) : <Sparkles aria-hidden="true" />}
          </AbilityButton>
          {innateCounter && (
            <b
              className="hero-status-persistent-counter"
              aria-label={`${innateStacks} de ${innateCounter.maxStacks} cargas`}
            >
              {innateStacks}/{innateCounter.maxStacks}
            </b>
          )}
        </div>
      )}
      {activeStatuses.map(({ status, tone }) => (
        <TimedStatusIcon key={status.id} status={status} tone={tone} nowMs={nowMs} />
      ))}
    </div>
  );
}
