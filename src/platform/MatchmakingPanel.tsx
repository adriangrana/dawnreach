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
    ? 'MMR persistente, grupos juntos y equipos equilibrados.'
    : `Calibración ${me.calibrationGames}/${me.calibrationTarget}. Tu MMR provisional permanece oculto.`;

  return <section className="platform-matchmaking">
    <div className="platform-mode-grid">
      <button type="button" className={queue.mode === 'ranked' ? 'is-selected' : ''} disabled={queue.joined} onClick={() => onMode('ranked')}>
        <Trophy /><span><small>{me.calibrated ? 'COMPETITIVO' : 'CALIBRACIÓN'}</small><strong>Ranked</strong><p>{rankedText}</p></span>
      </button>
      <button type="button" className={queue.mode === 'normal' ? 'is-selected' : ''} disabled={queue.joined} onClick={() => onMode('normal')}>
        <Gamepad2 /><span><small>SIN PRESIÓN</small><strong>Normal</strong><p>Matchmaking 5v5 sin modificar rating ni calibración.</p></span>
      </button>
    </div>
    <div className="platform-queue-card">
      <div className={queue.joined ? 'platform-queue-icon is-searching' : 'platform-queue-icon'}><Swords /></div>
      <div className="platform-queue-copy">
        <small>{queue.joined ? 'BUSCANDO PARTIDA' : 'LISTO PARA JUGAR'}</small>
        <h3>{queue.joined ? `${queue.count} / ${queue.target} jugadores` : `${queue.mode === 'ranked' ? 'Ranked' : 'Normal'} · Dawnreach`}</h3>
        <p>{queue.joined ? 'Puedes seguir usando la plataforma. El ready check aparecerá cuando haya suficientes jugadores.' : party.party ? `Entrarás con tu grupo de ${party.party.members.length} jugadores.` : 'Puedes entrar solo o crear un grupo antes de buscar.'}</p>
        {queue.joined && <div className="platform-queue-progress"><span style={{ width: `${progress}%` }} /></div>}
      </div>
      <button type="button" className={queue.joined ? 'platform-queue-leave' : 'platform-queue-join'} onClick={() => queue.joined ? onLeave() : onJoin(queue.mode)}>
        {queue.joined ? <><X /> Salir de cola</> : <><Swords /> Entrar en cola</>}
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

  return <div className="platform-ready-backdrop" role="dialog" aria-modal="true" aria-label="Partida encontrada">
    <section className="platform-ready-modal">
      <div className="platform-ready-eyebrow"><Zap /> TODO LISTO</div>
      <h2>Partida encontrada</h2>
      <p>Confirma que estás listo. La partida solo se crea cuando todos aceptan.</p>
      <div className="platform-ready-timer"><strong>{seconds}</strong><span>segundos</span></div>
      <div className="platform-ready-players">{ready.players.map(player => <div className={ready.acceptedUserIds.includes(player.userId) ? 'is-accepted' : ''} key={player.userId}><span>{player.username.slice(0, 2).toUpperCase()}</span>{ready.acceptedUserIds.includes(player.userId) ? <Check /> : <i>•</i>}</div>)}</div>
      <footer>{accepted ? <div className="platform-ready-accepted"><Check /> Listo. Esperando al resto…</div> : <><button type="button" className="platform-ready-reject" onClick={() => answer(false)}>Rechazar</button><button type="button" className="platform-ready-accept" onClick={() => answer(true)}><Check /> Estoy listo</button></>}</footer>
    </section>
  </div>;
}
