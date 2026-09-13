export type MapPoint = readonly [x: number, z: number];

export const DAWNREACH_LAYOUT = {
  width: 96,
  height: 72,
  blueSpawn: { x: -39, z: 27 },
  redSpawn: { x: 39, z: -27 },
  blueBase: { x: -40, z: 28 },
  redBase: { x: 40, z: -28 },
  lanes: {
    top: [
      [-39, 25], [-40, 12], [-37, -3], [-31, -17], [-20, -27], [0, -30], [20, -30], [33, -25], [39, -25],
    ] satisfies MapPoint[],
    mid: [
      [-36, 24], [-26, 18], [-15, 11], [0, 0], [15, -11], [26, -18], [36, -24],
    ] satisfies MapPoint[],
    bot: [
      [-39, 25], [-28, 29], [-10, 30], [10, 30], [26, 23], [35, 10], [39, -6], [39, -25],
    ] satisfies MapPoint[],
  },
  river: [
    [-31, -34], [-22, -24], [-12, -13], [0, 0], [12, 13], [22, 24], [31, 34],
  ] satisfies MapPoint[],
  objectivePits: [
    { x: -13, z: -9, kind: 'upper' as const },
    { x: 14, z: 10, kind: 'lower' as const },
  ],
  jungleClusters: [
    [-31, 11, 1.15], [-23, 6, 1.0], [-18, -2, 1.15], [-25, -9, 1.05], [-17, -17, 1.0],
    [-7, 20, 1.0], [-2, 14, 1.2], [-12, -2, 1.0], [-4, -16, 1.1], [-9, -20, 1.0],
    [31, -11, 1.15], [23, -6, 1.0], [18, 2, 1.15], [25, 9, 1.05], [17, 17, 1.0],
    [7, -20, 1.0], [2, -14, 1.2], [12, 2, 1.0], [4, 16, 1.1], [9, 20, 1.0],
  ] satisfies Array<readonly [x: number, z: number, scale: number]>,
} as const;

export const MAP_BOUNDS = {
  minX: -DAWNREACH_LAYOUT.width / 2,
  maxX: DAWNREACH_LAYOUT.width / 2,
  minZ: -DAWNREACH_LAYOUT.height / 2,
  maxZ: DAWNREACH_LAYOUT.height / 2,
};
