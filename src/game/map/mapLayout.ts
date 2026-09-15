export type MapPoint = readonly [x: number, z: number];

export const OBJECTIVE_LAYOUT = { poolRadius: 5.8, wallRadius: 6.25, clearance: 7.9, gateHalfAngle: 1.08 } as const;

export const CAMP_LAYOUT = { radius: 3.3, clearingRadius: 4.4, entranceHalfAngle: 0.65 } as const;

export const BASE_LAYOUT = {
  radius: 19.6,
  elevation: 2.5,
  rampLength: 7,
  rampWidth: 5.2,
  gates: [-1.78, -0.616, 0.395],
} as const;

export const BASE_SHOP_LAYOUT = {
  localFootprintRadius: 3,
  worldScale: 0.52,
  wallGap: 0.55,
} as const;

export const TEAM_START_BASE_LAYOUT = {
  radius: 7,
  // The fountain sanctuary is intentionally a second architectural tier above the citadel
  // plaza. Gameplay continues to use this same value for spawn/regen height validation.
  elevation: 5.25,
  waterDepth: 0.10,
  rampLength: 5.4,
  rampWidth: 4.4,
  fountainForward: 2.05,
  fountainSide: 0,
  // Keep heroes on the dry sanctuary plaza, clear of the fountain/pool footprint (~3.2u),
  // while remaining comfortably inside the 7u healing/protection radius.
  spawnForward: 4.8,
  spawnSide: -2.8,
  hpRegenFractionPerSecond: 0.10,
  resourceRegenFractionPerSecond: 0.08,
  fountainTrueDamagePerSecond: 200,
} as const;

const layout = {
  width: 120,
  height: 100,
  blueSpawn: { x: -28, z: 20 },
  redSpawn: { x: 28, z: -20 },
  blueBase: { x: -39, z: 28 },
  redBase: { x: 39, z: -28 },
  lanes: {
    top: [
      [-39, 28], [-44.5, 2], [-38, -14], [-28, -32], [-10, -39], [15, -38], [39, -28],
    ] satisfies MapPoint[],
    mid: [
      [-39, 28], [-15, 11], [0, 0], [15, -11], [39, -28],
    ] satisfies MapPoint[],
    bot: [
      [-39, 28], [-15, 38], [10, 39], [28, 32], [38, 14], [44.5, -2], [39, -28],
    ] satisfies MapPoint[],
  },
  river: [
    [-31, -36], [-26, -28], [-19, -22], [-18, -16], [-10, -12], [-5, -5],
    [0, 0], [7, 5], [9, 12], [17, 18], [20, 27], [31, 36],
  ] satisfies MapPoint[],
  objectivePits: [
    { x: -13, z: -9, kind: 'upper' as const },
    { x: 14, z: 10, kind: 'lower' as const },
  ],
  junglePaths: [
    [[-37, 17], [-29, 12], [-27, 3], [-29, -6], [-26, -17], [-20, -26]],
    [[-29, 17], [-22, 23], [-12, 24], [-3, 21], [5, 22], [15, 27]],
    [[-29, -6], [-21, -4], [-17, 2], [-15, 11]],
    [[-12, 24], [-9, 17], [-7, 10], [-3, 5]],
    [[37, -17], [29, -12], [27, -3], [29, 6], [26, 17], [20, 26]],
    [[29, -17], [22, -23], [12, -24], [3, -21], [-5, -22], [-15, -27]],
    [[29, 6], [21, 4], [17, -2], [15, -11]],
    [[12, -24], [9, -17], [7, -10], [3, -5]],
  ] satisfies MapPoint[][],
  // Neutral camps live in grassy jungle clearings, away from river water and visible travel routes.
  camps: [[-32, -12.8], [-8, -19], [-15, 28], [-4, 13], [32, 12.8], [8, 19], [15, -28], [4, -13]] satisfies MapPoint[],
  retainingWalls: [
    [[-34, 5], [-33, -2], [-30, -10]],
    [[-23, -18], [-19, -15], [-18, -10]],
    [[-21, 16], [-16, 18], [-11, 17]],
    [[-5, 26], [2, 26], [9, 24]],
    [[34, -5], [33, 2], [30, 10]],
    [[23, 18], [19, 15], [18, 10]],
    [[21, -16], [16, -18], [11, -17]],
    [[5, -26], [-2, -26], [-9, -24]],
  ] satisfies MapPoint[][],
  jungleClusters: [
    [-48, -18, 1.2], [-34, -25, 1.15], [-17, -32, 1.2], [1, -32, 1.15], [19, -38, 1.05],
    [48, 18, 1.2], [34, 25, 1.15], [17, 32, 1.2], [-1, 32, 1.15], [-19, 38, 1.05],
    [-31, 11, 1.15], [-23, 6, 1.0], [-18, -2, 1.15], [-25, -9, 1.05], [-17, -17, 1.0],
    [-7, 20, 1.0], [-2, 14, 1.2], [-12, -2, 1.0], [-4, -16, 1.1], [-9, -20, 1.0],
    [31, -11, 1.15], [23, -6, 1.0], [18, 2, 1.15], [25, 9, 1.05], [17, 17, 1.0],
    [7, -20, 1.0], [2, -14, 1.2], [12, 2, 1.0], [4, 16, 1.1], [9, 20, 1.0],
  ] satisfies Array<readonly [x: number, z: number, scale: number]>,
} as const;

const MAP_LAYOUT_SCALE = 1.25;
const scalePoints = (points: readonly MapPoint[]): MapPoint[] => points.map(([x, z]) => [x * MAP_LAYOUT_SCALE, z * MAP_LAYOUT_SCALE]);
const scalePosition = (point: { x: number; z: number }) => ({ x: point.x * MAP_LAYOUT_SCALE, z: point.z * MAP_LAYOUT_SCALE });

function shopPositionFromBase(center: Readonly<{ x: number; z: number }>) {
  const length = Math.hypot(center.x, center.z) || 1;
  const rearX = center.x / length;
  const rearZ = center.z / length;
  const shopFootprint = BASE_SHOP_LAYOUT.localFootprintRadius * BASE_SHOP_LAYOUT.worldScale;
  const rearDistance = BASE_LAYOUT.radius - shopFootprint - BASE_SHOP_LAYOUT.wallGap;
  return {
    x: center.x + rearX * rearDistance,
    z: center.z + rearZ * rearDistance,
  };
}

function startSpawnFromCenter(center: Readonly<{ x: number; z: number }>) {
  const length = Math.hypot(center.x, center.z) || 1;
  const inwardX = -center.x / length;
  const inwardZ = -center.z / length;
  const tangentX = -inwardZ;
  const tangentZ = inwardX;
  return {
    x: center.x + inwardX * TEAM_START_BASE_LAYOUT.spawnForward + tangentX * TEAM_START_BASE_LAYOUT.spawnSide,
    z: center.z + inwardZ * TEAM_START_BASE_LAYOUT.spawnForward + tangentZ * TEAM_START_BASE_LAYOUT.spawnSide,
  };
}

const scaledBlueBase = scalePosition(layout.blueBase);
const scaledRedBase = scalePosition(layout.redBase);
const blueStartBaseCenter = shopPositionFromBase(scaledBlueBase);

export const DAWNREACH_LAYOUT = {
  ...layout,
  width: layout.width * MAP_LAYOUT_SCALE,
  height: layout.height * MAP_LAYOUT_SCALE,
  blueBase: scaledBlueBase,
  redBase: scaledRedBase,
  blueSpawn: startSpawnFromCenter(blueStartBaseCenter),
  redSpawn: {
    x: layout.redBase.x * MAP_LAYOUT_SCALE + layout.redSpawn.x - layout.redBase.x,
    z: layout.redBase.z * MAP_LAYOUT_SCALE + layout.redSpawn.z - layout.redBase.z,
  },
  lanes: {
    top: scalePoints(layout.lanes.top),
    mid: scalePoints(layout.lanes.mid),
    bot: scalePoints(layout.lanes.bot),
  },
  river: scalePoints(layout.river),
  objectivePits: layout.objectivePits.map(pit => ({ ...pit, ...scalePosition(pit) })),
  junglePaths: layout.junglePaths.map(scalePoints),
  camps: scalePoints(layout.camps),
  retainingWalls: layout.retainingWalls.map(scalePoints),
  jungleClusters: layout.jungleClusters.map(([x, z, scale]) => [x * MAP_LAYOUT_SCALE, z * MAP_LAYOUT_SCALE, scale * MAP_LAYOUT_SCALE] as const),
};

export function getTeamBaseShopPosition(team: 'blue' | 'red') {
  return shopPositionFromBase(team === 'blue' ? DAWNREACH_LAYOUT.blueBase : DAWNREACH_LAYOUT.redBase);
}

export function getTeamStartSpawnPosition(team: 'blue' | 'red') {
  if (team === 'blue') return { ...DAWNREACH_LAYOUT.blueSpawn };
  return startSpawnFromCenter(getTeamBaseShopPosition(team));
}

export function getTeamStartBaseServiceOpening(
  team: 'blue' | 'red',
): { angle: number; halfAngle: number } | null {
  // The sanctuary no longer has a forest-facing service breach. The citadel wall remains closed
  // behind Mercado del Alba; access is exclusively from the base plaza via the monumental stair.
  void team;
  return null;
}

export const MAP_BOUNDS = {
  minX: -DAWNREACH_LAYOUT.width / 2,
  maxX: DAWNREACH_LAYOUT.width / 2,
  minZ: -DAWNREACH_LAYOUT.height / 2,
  maxZ: DAWNREACH_LAYOUT.height / 2,
};
