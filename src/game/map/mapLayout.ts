export type MapPoint = readonly [x: number, z: number];

export const OBJECTIVE_LAYOUT = { poolRadius: 5.8, wallRadius: 6.25, clearance: 7.9, gateHalfAngle: 1.08 } as const;

export const BASE_LAYOUT = {
  radius: 19.6,
  elevation: 3.2,
  rampLength: 7,
  rampWidth: 5.2,
  gates: [-1.78, -0.616, 0.395],
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
  // Keep neutral camps on dry jungle ground and off the river corridor.
  camps: [[-30, -8], [-24, -15], [-15, 22], [-4, 13], [30, 8], [24, 15], [15, -22], [4, -13]] satisfies MapPoint[],
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

export const DAWNREACH_LAYOUT = {
  ...layout,
  width: layout.width * MAP_LAYOUT_SCALE,
  height: layout.height * MAP_LAYOUT_SCALE,
  blueBase: scalePosition(layout.blueBase),
  redBase: scalePosition(layout.redBase),
  blueSpawn: {
    x: layout.blueBase.x * MAP_LAYOUT_SCALE + layout.blueSpawn.x - layout.blueBase.x,
    z: layout.blueBase.z * MAP_LAYOUT_SCALE + layout.blueSpawn.z - layout.blueBase.z,
  },
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

export const MAP_BOUNDS = {
  minX: -DAWNREACH_LAYOUT.width / 2,
  maxX: DAWNREACH_LAYOUT.width / 2,
  minZ: -DAWNREACH_LAYOUT.height / 2,
  maxZ: DAWNREACH_LAYOUT.height / 2,
};
