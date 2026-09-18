import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  CheckCircle2,
  Clock3,
  Map,
  Swords,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import type { PartySnapshot, PlatformUser, QueueMode, QueueState } from './types';

type PlayMode = QueueMode | 'vs_ai' | 'training' | 'custom';
type DeploymentId = 'north' | 'mid' | 'south';

type ModeDefinition = Readonly<{
  id: PlayMode;
  title: string;
  subtitle: string;
  icon: string;
  activeIcon: string;
  background: string;
}>;

type DeploymentDefinition = Readonly<{
  id: DeploymentId;
  label: string;
  subtitle: string;
  slots: number;
}>;

const MODES: readonly ModeDefinition[] = [
  {
    id: 'normal',
    title: 'NORMAL',
    subtitle: '5v5 on Dawnreach',
    icon: '/assets/icon/normal.png',
    activeIcon: '/assets/icon/normal-active.png',
    background: '/assets/images/dawnreach_normal_background.webp',
  },
  {
    id: 'ranked',
    title: 'RANKED',
    subtitle: 'Compete for a Higher Tomorrow.',
    icon: '/assets/icon/ranked.png',
    activeIcon: '/assets/icon/ranked-active.png',
    background: '/assets/images/dawnreach_ranked_background.webp',
  },
  {
    id: 'vs_ai',
    title: 'VS AI',
    subtitle: 'Play Against AI Bots',
    icon: '/assets/icon/vsAI.png',
    activeIcon: '/assets/icon/vsAI-active.png',
    background: '/assets/images/dawnreach_vsai_background.webp',
  },
  {
    id: 'training',
    title: 'TRAINING',
    subtitle: 'Learn. Practice. Improve.',
    icon: '/assets/icon/training.png',
    activeIcon: '/assets/icon/training-active.png',
    background: '/assets/images/dawnreach_training_background.webp',
  },
  {
    id: 'custom',
    title: 'CUSTOM',
    subtitle: 'Create Your Own Game.',
    icon: '/assets/icon/custom.png',
    activeIcon: '/assets/icon/custom-active.png',
    background: '/assets/images/dawnreach_custom_background.webp',
  },
];

const DEPLOYMENTS: readonly DeploymentDefinition[] = [
  { id: 'north', label: 'NORTH', subtitle: 'Northern lane', slots: 2 },
  { id: 'mid', label: 'MID', subtitle: 'Central lane', slots: 1 },
  { id: 'south', label: 'SOUTH', subtitle: 'Southern lane', slots: 2 },
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
    lines: ['MASTER YOUR HERO', 'MASTER THE BATTLEFIELD.'],
    estimate: 'No limit',
    heroSelect: 'Alden',
    action: 'ENTER TRAINING',
  },
  custom: {
    kicker: 'CUSTOM',
    title: 'CUSTOM',
    lines: ['YOUR RULES.', 'YOUR BATTLEFIELD.'],
    estimate: 'Player defined',
    heroSelect: 'Custom rules',
    action: 'CUSTOM LOBBIES',
  },
};

function selectedDeploymentLabel(deployment: DeploymentId, primary: DeploymentId | null, secondary: DeploymentId | null) {
  if (deployment === primary) return 'Primary';
  if (deployment === secondary) return 'Secondary';
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
  const [primaryDeployment, setPrimaryDeployment] = useState<DeploymentId | null>('mid');
  const [secondaryDeployment, setSecondaryDeployment] = useState<DeploymentId | null>('south');
  const [fillIfNeeded, setFillIfNeeded] = useState(true);

  useEffect(() => {
    if (queue.joined) setSelectedMode(queue.mode);
  }, [queue.joined, queue.mode]);

  const copy = MODE_COPY[selectedMode];
  const selectedModeDefinition = MODES.find(mode => mode.id === selectedMode) ?? MODES[0];
  const partySize = party.party?.members.length ?? 1;
  const queueProgress = Math.min(100, Math.round(queue.count / Math.max(queue.target, 1) * 100));
  const rankedCalibration = !me.calibrated;
  const readyToQueue = selectedMode === 'normal' || selectedMode === 'ranked';

  const deploymentSummary = useMemo(() => {
    const primary = DEPLOYMENTS.find(deployment => deployment.id === primaryDeployment)?.label;
    const secondary = DEPLOYMENTS.find(deployment => deployment.id === secondaryDeployment)?.label;
    const preference = primary && secondary ? `${primary} · ${secondary}` : primary || secondary || 'NO LANE';
    return fillIfNeeded ? `${preference} · FILL ON` : preference;
  }, [fillIfNeeded, primaryDeployment, secondaryDeployment]);

  const selectMode = (mode: PlayMode) => {
    if (queue.joined) return;
    setSelectedMode(mode);
    if (mode === 'normal' || mode === 'ranked') onMode(mode);
  };

  const selectDeployment = (deployment: DeploymentId) => {
    if (queue.joined) return;
    if (primaryDeployment === deployment) {
      setPrimaryDeployment(secondaryDeployment);
      setSecondaryDeployment(null);
      return;
    }
    if (secondaryDeployment === deployment) {
      setSecondaryDeployment(null);
      return;
    }
    if (!primaryDeployment) {
      setPrimaryDeployment(deployment);
      return;
    }
    if (!secondaryDeployment) {
      setSecondaryDeployment(deployment);
      return;
    }
    setSecondaryDeployment(deployment);
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
    if (selectedMode === 'custom') {
      onCustom();
      return;
    }
    onLocalPlay();
  };

  return <section className="dr-play-screen">
    <aside className="dr-play-modes" aria-label="Game modes">
      <div className="dr-play-modes-heading"><small>PLAY</small><strong>CHOOSE YOUR BATTLE</strong></div>
      {MODES.map(mode => {
        const active = selectedMode === mode.id;
        const cardStyle = {
          '--dr-play-card-background': `url("${mode.background}")`,
        } as CSSProperties;
        return <button
          type="button"
          key={mode.id}
          className={`dr-play-mode-card is-${mode.id}${active ? ' is-selected' : ''}`}
          style={cardStyle}
          disabled={queue.joined && !active}
          onClick={() => selectMode(mode.id)}
          aria-pressed={active}
        >
          <span className="dr-play-mode-icon">
            <img src={active ? mode.activeIcon : mode.icon} alt="" draggable={false} />
          </span>
          <span className="dr-play-mode-copy">
            <strong>{mode.title}</strong>
            <em>{mode.subtitle}</em>
          </span>
        </button>;
      })}
      <blockquote>“GREAT PLAYERS<br />BUILD A BRIGHTER WORLD.”<span>— DAWNREACH</span></blockquote>
    </aside>

    <div className="dr-play-center">
      <section
        className={`dr-play-hero is-${selectedMode}`}
        style={{ '--dr-play-mode-background': `url("${selectedModeDefinition.background}")` } as CSSProperties}
      >
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

      <section className="dr-play-deployment-panel">
        <header>
          <div className="dr-play-deployment-heading">
            <div><strong>DEPLOYMENT PREFERENCE</strong><span>Choose up to two preferred lanes.</span></div>
            <small>{readyToQueue ? 'Dawnreach deploys five heroes across three fronts · 2 / 1 / 2' : 'These preferences are kept for your next online queue.'}</small>
          </div>
          <button
            type="button"
            className={`dr-play-fill-toggle${fillIfNeeded ? ' is-active' : ''}`}
            aria-pressed={fillIfNeeded}
            disabled={queue.joined}
            onClick={() => setFillIfNeeded(current => !current)}
          >
            <span className="dr-play-fill-check" aria-hidden="true"><i /></span>
            <span><strong>FILL IF NEEDED</strong><small>Allow another lane when required</small></span>
          </button>
        </header>
        <div className="dr-play-deployment-grid">
          {DEPLOYMENTS.map(deployment => {
            const deploymentState = selectedDeploymentLabel(deployment.id, primaryDeployment, secondaryDeployment);
            return <button
              type="button"
              key={deployment.id}
              disabled={queue.joined}
              className={deploymentState ? `is-selected is-${deploymentState.toLowerCase()}` : ''}
              onClick={() => selectDeployment(deployment.id)}
            >
              <span className="dr-play-lane-map" data-lane={deployment.id} aria-hidden="true">
                <i className="dr-play-lane-map-frame" />
                <i className="dr-play-lane-route is-north" />
                <i className="dr-play-lane-route is-mid" />
                <i className="dr-play-lane-route is-south" />
                <b />
              </span>
              <span className="dr-play-deployment-copy">
                <small>{deployment.subtitle}</small>
                <strong>{deployment.label}</strong>
                <em>{deployment.slots} {deployment.slots === 1 ? 'SLOT' : 'SLOTS'}</em>
              </span>
              <span className="dr-play-deployment-state">{deploymentState || 'SELECT'}</span>
              <i className="dr-play-deployment-radio" aria-hidden="true" />
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
            <strong>{queue.joined ? `Searching · ${queue.count}/${queue.target}` : selectedMode === 'ranked' && rankedCalibration ? 'Calibration ready' : selectedMode === 'custom' ? 'Custom rules' : selectedMode === 'training' ? 'Practice ready' : selectedMode === 'vs_ai' ? 'Bots ready' : 'Ready to queue'}</strong>
            <small>{queue.joined ? `${queue.mode.toUpperCase()} · party ${partySize}/5` : `${deploymentSummary} · party ${partySize}/5`}</small>
          </span>
          {queue.joined && <i style={{ '--dr-queue-progress': `${queueProgress}%` } as CSSProperties} />}
        </div>
      </section>
    </div>
  </section>;
}
