export type RankInput = { rating?: number; calibrated?: boolean; calibrationGames?: number; leaderboardPosition?: number | null };
export type RankSummary = {
  tier: string; name: string; division: string | null; label: string; medal: string; color: string; motto: string;
  min: number; max: number | null; mmr: number | null; progress: number; nextLabel: string | null;
  remaining: number; progressLabel: string; leaderboardPosition: number | null;
};
export const CALIBRATION_MATCHES: number;
export const DAWNBORN_MIN_MMR: number;
export const DAWNBORN_MAX_POSITION: number;
export const RANK_DIVISIONS: string[];
export const RANK_TIERS: { id: string; name: string; min: number; color: string; motto: string }[];
export function resolveRank(user?: RankInput): RankSummary;
