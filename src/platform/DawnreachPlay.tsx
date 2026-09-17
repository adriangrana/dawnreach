import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Bot,
  CheckCircle2,
  Clock3,
  Compass,
  Crosshair,
  Map,
  Shield,
  Sparkles,
  Swords,
  Trophy,
  Users,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { PartySnapshot, PlatformUser, QueueMode, QueueState } from './types';

type PlayMode = QueueMode | 'vs_ai' | 'training';
type RoleId = 'top' | 'jungle' | 'mid' | 'carry' | 'support';

type ModeDefinition = Readonly<{
  id: PlayMode;
  title: string;
  subtitle: string;
  eyebrow: string;
  icon: LucideIcon;
}>;

type RoleDefinition = Readonly<{
  id: RoleId;
  label: string;
  icon: LucideIcon;
}>;

const MODES: readonly ModeDefinition[] = [
  { id: 'normal', title: 'NORMAL', subtitle: '5v5 on Dawnreach', eyebrow: 'STANDARD', icon: Swords },
  { id: 'ranked', title: 'RANKED', subtitle: 'Compete for a Higher Tomorrow.', eyebrow: 'COMPETITIVE', icon: Trophy },
  { id: 'vs_ai', title: 'VS AI', subtitle: 'Play Against AI Bots', eyebrow: 'CO-OP', icon: Bot },
  { id: 'training', title: 'TRAINING', subtitle: 'Learn. Practice. Improve.', eyebrow: 'PRACTICE', icon: BookOpen },
];

const ROLES: readonly RoleDefinition[] = [
  { id: 'top', label: 'TOP', icon: Shield },
  { id: 'jungle', label: 'JUNGLE', icon: Compass },
  { id: 'mid', label: 'MID', icon: Zap },
  { id: 'carry', label: 'CARRY', icon: Crosshair },
  { id: 'support', label: 'SUPPORT', icon: Users },
];

const MODE_COPY: Record<PlayMode, Readonly<{
  kicker: string;
  title: string;
  lines: readonly string[];
  estimate: string;
  heroSelect: string;
  action: string;
}>> = {
  normal: {
    kicker: '5v5',
    title: 'NORMAL',
    lines: ['FIGHT TOGETHER', 'FOR A BRIGHTER TOMORROW.'],
    estimate: '25 – 40 min',
    heroSelect: 'Blind Pick',
    action: 'FIND MATCH',
  },
  ranked: {
    kicker: '5v5',
    title: 'RANKED',
    lines: ['CLIMB TOGETHER', 'PROVE YOUR PLACE.'],
    estimate: '25 – 45 min',
    heroSelect: 'Draft Pick',
    action: 'FIND RANKED MATCH',
  },
  vs_ai: {
    kicker: '5v5',
    title: 'VS AI',
    lines: ['TRAIN WITH ALLIES', 'AGAINST THE DUSK.'],
    estimate: '20 – 35 min',
    heroSelect: 'Practice Pick',
    action: 'PLAY VS AI',
  },
  training: {
    kicker: 'PRACTICE',
    title: 'TRAINING',
    lines: ['MASTER ALDEN', 'AND THE BATTLEFIELD.'],
    estimate: 'No limit',
    heroSelect: 'Alden',
    action: 'ENTER TRAINING',
  },
};

function selectedRoleLabel(role: RoleId, primary: RoleId | null, secondary: RoleId | null) {
  if (role === primary) return 'Primary';
  if (role === secondary) return 'Secondary';
  return '';
}

export function DawnreachPlayScreen({
  me,
  party,
  queue,
  onMode,
  onJoin,
  onLeave,
  onLocalPlay,
  onCustom,
}: {
  me: PlatformUser;
  party: PartySnapshot;
  queue: QueueState;
  onMode: (mode: QueueMode) => void;
  onJoin: (mode: QueueMode) => void;
  onLeave: () => void;
  onLocalPlay: () => void;
  onCustom: () => void;
}) {
  const [selectedMode, setSelectedMode] = useState<PlayMode>(queue.mode);
  const [primaryRole, setPrimaryRole] = useState<RoleId | null>('mid');
  const [secondaryRole, setSecondaryRole] = useState<RoleId | null>('support');

  useEffect(() => {
    if (queue.joined) setSelectedMode(queue.mode);
  }, [queue.joined, queue.mode]);

  const copy = MODE_COPY[selectedMode];
  const partySize = party.party?.members.length ?? 1;
  const queueProgress = Math.min(100, Math.round(queue.count / Math.max(queue.target, 1) * 100));
  const rankedCalibration = !me.calibrated;
  const readyToQueue = selectedMode === 'normal' || selectedMode === 'ranked';

  const roleSummary = useMemo(() => {
    const primary = ROLES.find(role => role.id === primaryRole)?.label;
    const secondary = ROLES.find(role => role.id === secondaryRole)?.label;
    if (primary && secondary) return `${primary} · ${secondary}`;
    return primary || secondary || 'ANY ROLE';
  }, [primaryRole, secondaryRole]);

  const selectMode = (mode: PlayMode) => {
    if (queue.joined) return;
    setSelectedMode(mode);
    if (mode === 'normal' || mode === 'ranked') onMode(mode);
  };

  const selectRole = (role: RoleId) => {
    if (queue.joined) return;
    if (primaryRole === role) {
      setPrimaryRole(secondaryRole);
      setSecondaryRole(null);
      return;
    }
    if (secondaryRole === role) {
      setSecondaryRole(null);
      return;
    }
    if (!primaryRole) {
      setPrimaryRole(role);
      return;
    }
    if (!secondaryRole) {
      setSecondaryRole(role);
      return;
    }
    setSecondaryRole(role);
  };

  const activate = () => {
    if (queue.joined) {
      onLeave();
      return;
    }
    if (selectedMode === 'normal' || selectedMode === 'ranked') {
      onJoin(selectedMode);
      return;
    }
    onLocalPlay();
  };

  return <section className="dr-play-screen">
    <aside className="dr-play-modes" aria-label="Game modes">
      <div className="dr-play-modes-heading"><small>PLAY</small><strong>CHOOSE YOUR BATTLE</strong></div>
      {MODES.map(mode => {
        const Icon = mode.icon;
        const active = selectedMode === mode.id;
        return <button
          type="button"
          key={mode.id}
          className={`dr-play-mode-card is-${mode.id}${active ? ' is-selected' : ''}`}
          disabled={queue.joined && !active}
          onClick={() => selectMode(mode.id)}
        >
          <span className="dr-play-mode-icon"><Icon /></span>
          <span className="dr-play-mode-copy"><small>{mode.eyebrow}</small><strong>{mode.title}</strong><em>{mode.subtitle}</em></span>
        </button>;
      })}
      <button type="button" className="dr-play-mode-card is-custom" disabled={queue.joined} onClick={onCustom}>
        <span className="dr-play-mode-icon"><Sparkles /></span>
        <span className="dr-play-mode-copy"><small>PLAYER MADE</small><strong>CUSTOM</strong><em>Create Your Own Game.</em></span>
      </button>
      <blockquote>“GREAT PLAYERS<br />BUILD A BRIGHTER WORLD.”<span>— DAWNREACH</span></blockquote>
    </aside>

    <div className="dr-play-center">
      <section className={`dr-play-hero is-${selectedMode}`}>
        <div className="dr-play-hero-shade" />
        <div className="dr-play-hero-copy">
          <small>{copy.kicker}</small>
          <h1>{copy.title}</h1>
          <p>{copy.lines.map(line => <span key={line}>{line}</span>)}</p>
        </div>
        {selectedMode === 'ranked' && <div className="dr-play-ranked-note"><Trophy /><span><small>{rankedCalibration ? 'CALIBRATION' : 'RANKED RATING'}</small><strong>{rankedCalibration ? `${me.calibrationGames} / ${me.calibrationTarget}` : `${me.rating} MMR`}</strong></span></div>}
        <div className="dr-play-match-facts">
          <div><Clock3 /><span><small>Estimated Match Time</small><strong>{copy.estimate}</strong></span></div>
          <div><Map /><span><small>Map</small><strong>Dawnreach</strong></span></div>
          <div><Users /><span><small>Hero Select</small><strong>{copy.heroSelect}</strong></span></div>
        </div>
      </section>

      <section className="dr-play-role-panel">
        <header>
          <div><strong>ROLE PREFERENCE</strong><span>Select up to two preferred roles.</span></div>
          <small>{readyToQueue ? 'Primary and secondary roles help define your preferred lane.' : 'Role preference is kept for your next online queue.'}</small>
        </header>
        <div className="dr-play-role-grid">
          {ROLES.map(role => {
            const Icon = role.icon;
            const roleState = selectedRoleLabel(role.id, primaryRole, secondaryRole);
            return <button
              type="button"
              key={role.id}
              disabled={queue.joined}
              className={roleState ? `is-selected is-${roleState.toLowerCase()}` : ''}
              onClick={() => selectRole(role.id)}
            >
              <span className="dr-play-role-gem"><Icon /></span>
              <strong>{role.label}</strong>
              <small>{roleState || 'Select'}</small>
              <i />
            </button>;
          })}
        </div>
      </section>

      <section className="dr-play-action-row">
        <button
          type="button"
          className={`dr-play-find-match${queue.joined ? ' is-searching' : ''}`}
          onClick={activate}
        >
          {queue.joined ? <><X /> LEAVE QUEUE</> : <>{copy.action}</>}
        </button>
        <div className={`dr-play-ready-card${queue.joined ? ' is-searching' : ''}`}>
          {queue.joined ? <Swords /> : <CheckCircle2 />}
          <span>
            <strong>{queue.joined ? `Searching · ${queue.count}/${queue.target}` : selectedMode === 'ranked' && rankedCalibration ? 'Calibration ready' : 'Ready to queue'}</strong>
            <small>{queue.joined ? `${queue.mode.toUpperCase()} · party ${partySize}/5` : `${roleSummary} · party ${partySize}/5`}</small>
          </span>
          {queue.joined && <i style={{ '--dr-queue-progress': `${queueProgress}%` } as React.CSSProperties} />}
        </div>
      </section>
    </div>
  </section>;
}
