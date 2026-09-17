import { useEffect, useState } from 'react';
import { Check, Gamepad2, Swords, Trophy, X, Zap } from 'lucide-react';
import { platformRealtime } from './realtimeClient';
import type { PartySnapshot, PlatformUser, QueueMode, QueueState, ReadyState } from './types';

export function MatchmakingPanel({
  me,
  party,
  queue,
  onMode,
  onJoin,
  onLeave,
}: {
  me: PlatformUser;
  party: PartySnapshot;
  queue: QueueState;
  onMode: (mode: QueueMode) => void;
  onJoin: (mode: QueueMode) => void;
  onLeave: () => void;
}) {
  const progress = Math.min(100, Math.round(queue.count / Math.max(queue.target, 1) * 100));
  const rankedText = me.calibrated
    ? 'Persistent MMR, parties stay together, and teams are balanced.'
    : `Calibration ${me.calibrationGames}/${me.calibrationTarget}. Your provisional MMR remains hidden.`;

  return <section className="platform-matchmaking">
    <div className="platform-mode-grid">
      <button type="button" className={queue.mode === 'ranked' ? 'is-selected' : ''} disabled={queue.joined} onClick={() => onMode('ranked')}>
        <Trophy /><span><small>{me.calibrated ? 'COMPETITIVE' : 'CALIBRATION'}</small><strong>Ranked</strong><p>{rankedText}</p></span>
      </button>
      <button type="button" className={queue.mode === 'normal' ? 'is-selected' : ''} disabled={queue.joined} onClick={() => onMode('normal')}>
        <Gamepad2 /><span><small>NO PRESSURE</small><strong>Normal</strong><p>5v5 matchmaking without affecting rating or calibration.</p></span>
      </button>
    </div>
    <div className="platform-queue-card">
      <div className={queue.joined ? 'platform-queue-icon is-searching' : 'platform-queue-icon'}><Swords /></div>
      <div className="platform-queue-copy">
        <small>{queue.joined ? 'FINDING MATCH' : 'READY TO PLAY'}</small>
        <h3>{queue.joined ? `${queue.count} / ${queue.target} players` : `${queue.mode === 'ranked' ? 'Ranked' : 'Normal'} · Dawnreach`}</h3>
        <p>{queue.joined ? 'You can keep using the platform. Ready Check will appear when enough players are found.' : party.party ? `You will queue with your party of ${party.party.members.length} players.` : 'You can queue solo or create a party before searching.'}</p>
        {queue.joined && <div className="platform-queue-progress"><span style={{ width: `${progress}%` }} /></div>}
      </div>
      <button type="button" className={queue.joined ? 'platform-queue-leave' : 'platform-queue-join'} onClick={() => queue.joined ? onLeave() : onJoin(queue.mode)}>
        {queue.joined ? <><X /> Leave Queue</> : <><Swords /> Find Match</>}
      </button>
    </div>
  </section>;
}

export function ReadyCheckOverlay({ ready, me }: { ready: ReadyState; me: PlatformUser }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const seconds = Math.max(0, Math.ceil((ready.expiresAt - now) / 1000));
  const accepted = ready.acceptedUserIds.includes(me.id);
  const answer = (value: boolean) => platformRealtime.send('ready.response', { readyId: ready.readyId, accepted: value });

  return <div className="platform-ready-backdrop" role="dialog" aria-modal="true" aria-label="Match found">
    <section className="platform-ready-modal">
      <div className="platform-ready-eyebrow"><Zap /> READY CHECK</div>
      <h2>Match Found</h2>
      <p>Confirm that you are ready. The match is only created when everyone accepts.</p>
      <div className="platform-ready-timer"><strong>{seconds}</strong><span>seconds</span></div>
      <div className="platform-ready-players">{ready.players.map(player => <div className={ready.acceptedUserIds.includes(player.userId) ? 'is-accepted' : ''} key={player.userId}><span>{player.username.slice(0, 2).toUpperCase()}</span>{ready.acceptedUserIds.includes(player.userId) ? <Check /> : <i>•</i>}</div>)}</div>
      <footer>{accepted ? <div className="platform-ready-accepted"><Check /> Ready. Waiting for everyone else…</div> : <><button type="button" className="platform-ready-reject" onClick={() => answer(false)}>Decline</button><button type="button" className="platform-ready-accept" onClick={() => answer(true)}><Check /> Accept</button></>}</footer>
    </section>
  </div>;
}
