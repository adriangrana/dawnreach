import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Infinity as PassiveIcon, Plus } from 'lucide-react';
import type { AbilityKey, HeroAbilityDefinition } from '../game/heroes/types';

type AbilityButtonProps = {
  hotkey?: AbilityKey;
  name: string;
  kind: HeroAbilityDefinition['type'];
  description: string;
  lore?: string;
  rank?: number;
  maxRank?: number;
  nextLevel?: number;
  remainingMs?: number;
  cooldownSeconds?: number;
  resourceCost?: number;
  resourceName?: string;
  blockedReason: string | null;
  image?: string;
  art: string;
  children: ReactNode;
  onUse?: () => void;
  canUpgrade?: boolean;
  onUpgrade?: () => void;
};

const kindLabels = { active: 'Activa', passive: 'Pasiva', active_with_passive: 'Activa + pasiva', ultimate: 'Definitiva' };

export default function AbilityButton({
  hotkey, name, kind, description, lore, rank, maxRank = 4, nextLevel,
  remainingMs = 0, cooldownSeconds = 0, resourceCost = 0, resourceName,
  blockedReason, image, art, children, onUse, canUpgrade = false, onUpgrade,
}: AbilityButtonProps) {
  const passive = kind === 'passive';
  const tooltipId = useId();
  const controlRef = useRef<HTMLDivElement>(null);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const cooling = remainingMs > 0 && !passive;
  const cooldownFraction = cooldownSeconds > 0 ? Math.min(1, remainingMs / (cooldownSeconds * 1000)) : 0;

  const showTooltip = () => {
    setDismissed(false);
    const rect = controlRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(360, window.innerWidth - 24);
    setTooltipStyle({
      width,
      left: Math.max(12, Math.min(window.innerWidth - width - 12, rect.left + rect.width / 2 - width / 2)),
      bottom: window.innerHeight - rect.top + 12,
      maxHeight: Math.max(80, Math.min(440, rect.top - 24)),
    });
  };
  const hideTooltip = () => setTooltipStyle(null);

  useEffect(() => {
    const close = () => setTooltipStyle(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setTooltipStyle(null);
        setDismissed(true);
      }
    };
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const tooltipOpen = tooltipStyle !== null && !dismissed;
  return (
    <div
      className={`ability-control${passive ? ' ability-control--passive' : ''}`}
      data-ability={hotkey}
      ref={controlRef}
      onPointerEnter={showTooltip}
      onPointerLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
      tabIndex={passive ? 0 : undefined}
      aria-label={passive ? `${name}, pasiva` : undefined}
      aria-describedby={passive && tooltipOpen ? tooltipId : undefined}
    >
      {canUpgrade && !passive && (
        <button
          type="button"
          className="ability-upgrade"
          aria-label={`Subir ${name} al rango ${(rank ?? 0) + 1}`}
          title={`Subir ${name}`}
          onClick={(event) => {
            event.stopPropagation();
            onUpgrade?.();
          }}
        >
          <Plus aria-hidden="true" />
        </button>
      )}
      <button
        type="button"
        className={`ability-slot ability-slot--${art}${cooling ? ' is-cooling' : ''}${passive ? ' is-passive' : ''}${rank === 0 ? ' is-locked' : ''}`}
        disabled={passive}
        aria-disabled={blockedReason !== null}
        aria-label={`${name}${rank !== undefined ? `, rango ${rank} de ${maxRank}` : ''}`}
        aria-keyshortcuts={passive ? undefined : hotkey}
        aria-describedby={tooltipOpen ? tooltipId : undefined}
        data-cooldown={remainingMs}
        data-cost={resourceCost}
        onClick={() => { if (!blockedReason) onUse?.(); }}
      >
        {image ? <img className="ability-image" src={image} alt="" draggable={false} /> : children}
        {cooling && (
          <b className="ability-cooldown" style={{ background: `conic-gradient(from 0deg, #050b0ed9 ${cooldownFraction * 360}deg, #07101825 0deg)` }}>
            {Math.ceil(remainingMs / 1000)}
          </b>
        )}
        {passive ? <PassiveIcon className="ability-passive-mark" /> : hotkey && <i>{hotkey}</i>}
        {kind === 'active_with_passive' && <PassiveIcon className="ability-mixed-mark" />}
      </button>
      {rank !== undefined && (
        <div className="ability-rank" aria-label={`Rango ${rank} de ${maxRank}`}>
          <span className="ability-rank-pips" aria-hidden="true">
            {Array.from({ length: maxRank }, (_, index) => <span key={index} className={index < rank ? 'is-learned' : ''} />)}
          </span>
          <b>{rank}/{maxRank}</b>
        </div>
      )}
      {tooltipOpen && createPortal(
        <div id={tooltipId} role="tooltip" className="ability-tooltip" style={tooltipStyle}>
          <header><span>{kindLabels[kind]}</span>{hotkey && !passive && <kbd>{hotkey}</kbd>}</header>
          <strong className="ability-tooltip-title">{name}</strong>
          {rank !== undefined && <div className="ability-tooltip-rank">Rango {rank} / {maxRank}</div>}
          {!passive && <dl><div><dt>{resourceName}</dt><dd>{resourceCost}</dd></div><div><dt>Recarga</dt><dd>{cooldownSeconds} s</dd></div></dl>}
          <p>{description}</p>
          {lore && <p className="ability-tooltip-lore">{lore}</p>}
          <footer>
            <span>{blockedReason ?? 'Disponible'}{cooling ? ` (${Math.ceil(remainingMs / 1000)} s)` : ''}</span>
            {nextLevel !== undefined && <span>Siguiente rango: nivel {nextLevel}</span>}
          </footer>
        </div>, document.body,
      )}
    </div>
  );
}
