import type { ReactNode } from 'react';
import { AlertTriangle, Sparkles } from 'lucide-react';
import type { HeroInnateDefinition, HeroStatusTone } from '../game/heroes/types';
import type { TimedStatusState } from '../game/match/types';
import AbilityButton from './AbilityButton';

type HeroStatusBarProps = {
  heroEntityId: string;
  innate?: HeroInnateDefinition;
  timedStatuses: readonly TimedStatusState[];
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

export default function HeroStatusBar({ heroEntityId, innate, timedStatuses, nowMs, renderArt }: HeroStatusBarProps) {
  const activeStatuses = timedStatuses
    .filter(status => status.expiresAtMs > nowMs)
    .map(status => ({ status, tone: classifyTimedStatus(status, heroEntityId) }))
    .sort((left, right) => Number(left.tone === 'debuff') - Number(right.tone === 'debuff'));

  return (
    <div className="hero-status-bar" aria-label="Estados, auras y efectos del héroe">
      {innate?.hud.kind === 'persistent_aura' && (
        <div
          className={`hero-status-persistent hero-status-persistent--${innate.hud.tone ?? 'passive'}`}
          data-status-id={innate.id}
          data-status-kind="persistent-aura"
        >
          <AbilityButton
            name={innate.name}
            kind="passive"
            art={innate.hud.art ?? 'passive'}
            blockedReason="Aura pasiva permanente"
            description={innate.technicalDescription}
            lore={innate.description}
          >
            {innate.hud.art ? renderArt(innate.hud.art) : <Sparkles aria-hidden="true" />}
          </AbilityButton>
        </div>
      )}
      {activeStatuses.map(({ status, tone }) => (
        <TimedStatusIcon key={status.id} status={status} tone={tone} nowMs={nowMs} />
      ))}
    </div>
  );
}
