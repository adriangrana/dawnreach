import type { CSSProperties } from 'react';
import { RANK_DIVISIONS, RANK_TIERS, resolveRank, type RankInput, type RankSummary } from '../../shared/ranked.mjs';
import './ranked.css';

type RankedPlayer = RankInput & { rank?: RankSummary };
export function playerRank(player: RankedPlayer) { return player.rank ?? resolveRank(player); }

export function RankBadge({ player, size = 'small', label = false }: {
  player: RankedPlayer; size?: 'tiny' | 'small' | 'large'; label?: boolean;
}) {
  const rank = playerRank(player);
  return <span className={`dr-rank-badge is-${size}`} style={{ '--rank-color': rank.color } as CSSProperties}
    title={`${rank.label} · ${rank.mmr === null ? rank.progressLabel : `${rank.mmr.toLocaleString('en-US')} MMR`}`}>
    <img src={rank.medal} alt={label ? '' : rank.label} draggable={false} />
    {label && <span><strong>{rank.label}</strong><small>{rank.mmr === null ? rank.progressLabel : `${rank.mmr.toLocaleString('en-US')} MMR`}</small></span>}
  </span>;
}

export function RankProgress({ player }: { player: RankedPlayer }) {
  const rank = playerRank(player);
  return <div className="dr-rank-progress" style={{ '--rank-color': rank.color } as CSSProperties}>
    <div role="progressbar" aria-label={rank.progressLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(rank.progress * 100)}>
      <i style={{ width: `${rank.progress * 100}%` }} />
    </div><small>{rank.progressLabel}</small>
  </div>;
}

export function RankLadder() {
  return <details className="dr-rank-ladder"><summary>THE RANKED LADDER <span>View medals & MMR divisions</span></summary>
    <p>Five ranked matches reveal your rank. Each division spans 160 MMR. Normal and custom matches do not change MMR.</p>
    <div className="dr-rank-ladder-unranked"><RankBadge player={{ calibrated: false }} label /><span>Begin your journey · 0 / 5 calibration matches</span></div>
    <div className="dr-rank-ladder-grid">{RANK_TIERS.map(tier => <section key={tier.id} style={{ '--rank-color': tier.color } as CSSProperties}>
      <header><strong>{tier.name}</strong><small>{tier.motto}</small></header>
      <div>{RANK_DIVISIONS.map((division, index) => {
        const min = tier.min + index * 160;
        return <article key={division}><RankBadge player={{ calibrated: true, rating: min }} size="large" />
          <strong>{division}</strong><small>{min.toLocaleString('en-US')} {tier.id === 'sovereign' && index === 3 ? '+' : `– ${(min + 159).toLocaleString('en-US')}`} MMR</small></article>;
      })}</div>
    </section>)}</div>
    <div className="dr-rank-ladder-dawnborn"><RankBadge player={{ calibrated: true, rating: 4480, leaderboardPosition: 1 }} size="large" label /><p>Top 500 players worldwide, with at least 4,480 MMR. Your medal follows your current standing.</p></div>
  </details>;
}
