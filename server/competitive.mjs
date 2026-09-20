export { CALIBRATION_MATCHES } from '../shared/ranked.mjs';
export const INITIAL_PROVISIONAL_RATING = 2700;

// Team Elo: the result, rather than farmable personal statistics, determines MMR.
// Preserve the existing provisional starting point for already-created accounts.
export function ratingDelta(rating, opponentRating, won, calibrated) {
  const expected = 1 / (1 + 10 ** ((opponentRating - rating) / 400));
  const magnitude = Math.max(1, Math.round((calibrated ? 48 : 96) * (won ? 1 - expected : expected)));
  return won ? magnitude : -magnitude;
}
