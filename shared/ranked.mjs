export const CALIBRATION_MATCHES = 5;
export const RANK_DIVISIONS = ['Mark', 'Crest', 'Standard', 'Crown'];
export const RANK_TIERS = [
  { id: 'kindled', name: 'Kindled', min: 0, color: '#ff975c', motto: 'A spark within' },
  { id: 'oathbound', name: 'Oathbound', min: 640, color: '#bfcfe8', motto: 'Discipline endures' },
  { id: 'vanguard', name: 'Vanguard', min: 1280, color: '#64c8ff', motto: 'Forward together' },
  { id: 'bastion', name: 'Bastion', min: 1920, color: '#78dbb4', motto: 'Strength protects' },
  { id: 'dawnforged', name: 'Dawnforged', min: 2560, color: '#57bbff', motto: 'Light shapes us' },
  { id: 'luminary', name: 'Luminary', min: 3200, color: '#efbe6c', motto: 'A brighter tomorrow' },
  { id: 'sovereign', name: 'Sovereign', min: 3840, color: '#bd8cff', motto: 'Beyond limits' },
];
export const DAWNBORN_MIN_MMR = 4480;
export const DAWNBORN_MAX_POSITION = 500;
const integer = value => Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));

/** The only source of tier boundaries, shared by server snapshots and every UI. */
export function resolveRank(user = {}) {
  const games = Math.min(CALIBRATION_MATCHES, integer(user.calibrationGames));
  const mmr = integer(user.rating);
  if (!user.calibrated) return {
    tier: 'unranked', name: 'Unranked', division: null, label: 'Unranked',
    medal: '/assets/ranks/unranked.png', color: '#bfcfe8', motto: 'Begin your journey',
    min: 0, max: null, mmr: null, progress: games / CALIBRATION_MATCHES,
    nextLabel: 'Reveal your rank', remaining: CALIBRATION_MATCHES - games,
    progressLabel: `${games} / ${CALIBRATION_MATCHES} calibration matches`, leaderboardPosition: null,
  };
  const position = Number.isInteger(user.leaderboardPosition) && user.leaderboardPosition > 0 ? user.leaderboardPosition : null;
  if (mmr >= DAWNBORN_MIN_MMR && position !== null && position <= DAWNBORN_MAX_POSITION) return {
    tier: 'dawnborn', name: 'Dawnborn', division: null, label: 'Dawnborn',
    medal: '/assets/ranks/dawnborn.png', color: '#f5d191', motto: 'A higher calling',
    min: DAWNBORN_MIN_MMR, max: null, mmr, progress: 1, nextLabel: null, remaining: 0,
    progressLabel: `#${position} global · Top 500`, leaderboardPosition: position,
  };
  const tierIndex = Math.min(RANK_TIERS.length - 1, Math.floor(mmr / 640));
  const tier = RANK_TIERS[tierIndex];
  const divisionIndex = Math.min(3, Math.floor((mmr - tier.min) / 160));
  const min = tier.min + divisionIndex * 160;
  const atSummit = tierIndex === 6 && divisionIndex === 3;
  const nextLabel = atSummit ? 'Dawnborn' : divisionIndex === 3
    ? `${RANK_TIERS[tierIndex + 1].name} Mark` : `${tier.name} ${RANK_DIVISIONS[divisionIndex + 1]}`;
  const remaining = Math.max(0, min + 160 - mmr);
  return {
    tier: tier.id, name: tier.name, division: RANK_DIVISIONS[divisionIndex],
    label: `${tier.name} ${RANK_DIVISIONS[divisionIndex]}`,
    medal: `/assets/ranks/${tier.id}-${RANK_DIVISIONS[divisionIndex].toLowerCase()}.png`,
    color: tier.color, motto: tier.motto, min, max: atSummit ? null : min + 159, mmr,
    progress: Math.min(1, (mmr - min) / 160), nextLabel, remaining,
    progressLabel: atSummit ? (remaining ? `${remaining} MMR to 4,480 · Top 500 required` : 'Top 500 required for Dawnborn')
      : `${remaining} MMR to ${nextLabel}`, leaderboardPosition: position,
  };
}
