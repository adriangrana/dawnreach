export type NavigationPoint = Readonly<{ x: number; z: number }>;

export type NavigationBounds = Readonly<{
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}>;

export type NavigationCollisionQuery = Readonly<{
  isBlocked(point: NavigationPoint, radius: number): boolean;
}>;

export type NavigationPath = Readonly<{
  requestedTarget: NavigationPoint;
  resolvedTarget: NavigationPoint;
  waypoints: readonly NavigationPoint[];
  partial: boolean;
}>;

export type FindPathOptions = Readonly<{
  allowPartial?: boolean;
  nearestSearchRadius?: number;
}>;

export type NavigationWorldOptions = Readonly<{
  bounds: NavigationBounds;
  collisionWorld: NavigationCollisionQuery;
  agentRadius: number;
  cellSize?: number;
  clearance?: number;
  nearestSearchRadius?: number;
  terrainWalkable?: (point: NavigationPoint) => boolean;
  traversalCost?: (point: NavigationPoint) => number;
}>;

export type NavigationDebugSnapshot = Readonly<{
  bounds: NavigationBounds;
  cellSize: number;
  columns: number;
  rows: number;
  walkable: Uint8Array;
}>;

export type NavigationWorld = Readonly<{
  cellSize: number;
  agentRadius: number;
  isWalkable(point: NavigationPoint): boolean;
  findNearestWalkable(point: NavigationPoint, maxRadius?: number): NavigationPoint | null;
  segmentIsWalkable(from: NavigationPoint, to: NavigationPoint): boolean;
  smoothPath(points: readonly NavigationPoint[]): NavigationPoint[];
  findPath(start: NavigationPoint, target: NavigationPoint, options?: FindPathOptions): NavigationPath | null;
  getDebugSnapshot(): NavigationDebugSnapshot;
}>;

type GridCell = Readonly<{ column: number; row: number }>;
type HeapEntry = Readonly<{ index: number; score: number }>;

const SQRT_TWO = Math.SQRT2;
const DEFAULT_CELL_SIZE = 0.65;
const DEFAULT_CLEARANCE = 0.07;
const DEFAULT_NEAREST_SEARCH_RADIUS = 5;
const SEGMENT_SAMPLE_RATIO = 0.32;
const PARTIAL_PROGRESS_EPSILON = 0.35;

const NEIGHBORS = [
  { dc: 1, dr: 0, cost: 1 },
  { dc: -1, dr: 0, cost: 1 },
  { dc: 0, dr: 1, cost: 1 },
  { dc: 0, dr: -1, cost: 1 },
  { dc: 1, dr: 1, cost: SQRT_TWO },
  { dc: 1, dr: -1, cost: SQRT_TWO },
  { dc: -1, dr: 1, cost: SQRT_TWO },
  { dc: -1, dr: -1, cost: SQRT_TWO },
] as const;

class BinaryMinHeap {
  private readonly entries: HeapEntry[] = [];

  get size() {
    return this.entries.length;
  }

  clear() {
    this.entries.length = 0;
  }

  push(entry: HeapEntry) {
    const entries = this.entries;
    entries.push(entry);
    let index = entries.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (entries[parent].score <= entry.score) break;
      entries[index] = entries[parent];
      index = parent;
    }
    entries[index] = entry;
  }

  pop(): HeapEntry | null {
    const entries = this.entries;
    if (entries.length === 0) return null;
    const first = entries[0];
    const last = entries.pop();
    if (!last || entries.length === 0) return first;

    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      if (left >= entries.length) break;
      const right = left + 1;
      let child = left;
      if (right < entries.length && entries[right].score < entries[left].score) child = right;
      if (entries[child].score >= last.score) break;
      entries[index] = entries[child];
      index = child;
    }
    entries[index] = last;
    return first;
  }
}

export function createNavigationWorld(options: NavigationWorldOptions): NavigationWorld {
  const cellSize = Math.max(0.15, options.cellSize ?? DEFAULT_CELL_SIZE);
  const clearance = Math.max(0, options.clearance ?? DEFAULT_CLEARANCE);
  const queryRadius = Math.max(0, options.agentRadius) + clearance;
  const nearestSearchRadius = Math.max(cellSize, options.nearestSearchRadius ?? DEFAULT_NEAREST_SEARCH_RADIUS);
  const { bounds } = options;
  const columns = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cellSize));
  const rows = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / cellSize));
  const nodeCount = columns * rows;
  const walkable = new Uint8Array(nodeCount);
  const traversalCosts = new Float32Array(nodeCount);
  const parents = new Int32Array(nodeCount);
  const gScores = new Float64Array(nodeCount);
  const seenGeneration = new Uint32Array(nodeCount);
  const closedGeneration = new Uint32Array(nodeCount);
  const heap = new BinaryMinHeap();
  let generation = 0;

  const indexOf = (column: number, row: number) => row * columns + column;
  const inGrid = (column: number, row: number) => column >= 0 && row >= 0 && column < columns && row < rows;

  const cellToWorld = (column: number, row: number): NavigationPoint => ({
    x: Math.min(bounds.maxX, bounds.minX + (column + 0.5) * cellSize),
    z: Math.min(bounds.maxZ, bounds.minZ + (row + 0.5) * cellSize),
  });

  const worldToCell = (point: NavigationPoint): GridCell => ({
    column: clampInt(Math.floor((point.x - bounds.minX) / cellSize), 0, columns - 1),
    row: clampInt(Math.floor((point.z - bounds.minZ) / cellSize), 0, rows - 1),
  });

  const pointIsWalkable = (point: NavigationPoint) => {
    if (point.x < bounds.minX || point.x > bounds.maxX || point.z < bounds.minZ || point.z > bounds.maxZ) return false;
    if (options.terrainWalkable && !options.terrainWalkable(point)) return false;
    return !options.collisionWorld.isBlocked(point, queryRadius);
  };

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const index = indexOf(column, row);
      const point = cellToWorld(column, row);
      const allowed = pointIsWalkable(point);
      walkable[index] = allowed ? 1 : 0;
      if (!allowed) {
        traversalCosts[index] = Number.POSITIVE_INFINITY;
        continue;
      }
      const cost = options.traversalCost?.(point) ?? 1;
      traversalCosts[index] = Number.isFinite(cost) ? Math.max(1, cost) : 1;
    }
  }

  const nearestWalkableCell = (
    point: NavigationPoint,
    maxRadius: number,
    requireSegmentToPoint: boolean,
  ): GridCell | null => {
    const origin = worldToCell(point);
    const radiusInCells = Math.max(1, Math.ceil(maxRadius / cellSize));
    let best: GridCell | null = null;
    let bestDistanceSquared = Number.POSITIVE_INFINITY;

    for (let rowOffset = -radiusInCells; rowOffset <= radiusInCells; rowOffset++) {
      for (let columnOffset = -radiusInCells; columnOffset <= radiusInCells; columnOffset++) {
        const column = origin.column + columnOffset;
        const row = origin.row + rowOffset;
        if (!inGrid(column, row)) continue;
        const index = indexOf(column, row);
        if (walkable[index] === 0) continue;
        const candidate = cellToWorld(column, row);
        const dx = candidate.x - point.x;
        const dz = candidate.z - point.z;
        const distanceSquared = dx * dx + dz * dz;
        if (distanceSquared > maxRadius * maxRadius || distanceSquared >= bestDistanceSquared) continue;
        if (requireSegmentToPoint && !segmentIsWalkable(candidate, point)) continue;
        best = { column, row };
        bestDistanceSquared = distanceSquared;
      }
    }
    return best;
  };

  const segmentIsWalkable = (from: NavigationPoint, to: NavigationPoint) => {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const distance = Math.hypot(dx, dz);
    const sampleStep = Math.max(0.08, cellSize * SEGMENT_SAMPLE_RATIO);
    const samples = Math.max(1, Math.ceil(distance / sampleStep));
    let previousCell = worldToCell(from);

    for (let step = 0; step <= samples; step++) {
      const t = step / samples;
      const point = { x: from.x + dx * t, z: from.z + dz * t };
      if (!pointIsWalkable(point)) return false;

      const cell = worldToCell(point);
      if (cell.column !== previousCell.column && cell.row !== previousCell.row) {
        const horizontal = indexOf(cell.column, previousCell.row);
        const vertical = indexOf(previousCell.column, cell.row);
        if (walkable[horizontal] === 0 || walkable[vertical] === 0) return false;
      }
      previousCell = cell;
    }
    return true;
  };

  const findNearestWalkable = (point: NavigationPoint, maxRadius = nearestSearchRadius): NavigationPoint | null => {
    const clamped = clampPoint(point, bounds);
    if (pointIsWalkable(clamped)) return clamped;
    const cell = nearestWalkableCell(clamped, Math.max(cellSize, maxRadius), false);
    return cell ? cellToWorld(cell.column, cell.row) : null;
  };

  const smoothPath = (points: readonly NavigationPoint[]) => {
    if (points.length <= 2) return points.map(copyPoint);
    const result: NavigationPoint[] = [copyPoint(points[0])];
    let anchor = 0;
    while (anchor < points.length - 1) {
      let next = points.length - 1;
      while (next > anchor + 1 && !segmentIsWalkable(points[anchor], points[next])) next--;
      result.push(copyPoint(points[next]));
      anchor = next;
    }
    return result;
  };

  const heuristic = (from: GridCell, to: GridCell) => {
    const dx = Math.abs(from.column - to.column);
    const dz = Math.abs(from.row - to.row);
    const diagonal = Math.min(dx, dz);
    return (Math.max(dx, dz) + (SQRT_TWO - 1) * diagonal) * cellSize;
  };

  const reconstruct = (startIndex: number, goalIndex: number) => {
    const indices: number[] = [];
    let current = goalIndex;
    while (true) {
      indices.push(current);
      if (current === startIndex) break;
      const parent = parents[current];
      if (parent < 0 || parent === current) return [];
      current = parent;
    }
    indices.reverse();
    return indices;
  };

  const runAStar = (start: GridCell, goal: GridCell, allowPartial: boolean) => {
    generation++;
    if (generation === 0xffffffff) {
      generation = 1;
      seenGeneration.fill(0);
      closedGeneration.fill(0);
    }
    heap.clear();

    const startIndex = indexOf(start.column, start.row);
    const goalIndex = indexOf(goal.column, goal.row);
    seenGeneration[startIndex] = generation;
    gScores[startIndex] = 0;
    parents[startIndex] = startIndex;
    heap.push({ index: startIndex, score: heuristic(start, goal) });

    let bestIndex = startIndex;
    let bestHeuristic = heuristic(start, goal);
    const startHeuristic = bestHeuristic;

    while (heap.size > 0) {
      const entry = heap.pop();
      if (!entry) break;
      const currentIndex = entry.index;
      if (closedGeneration[currentIndex] === generation) continue;
      closedGeneration[currentIndex] = generation;
      if (currentIndex === goalIndex) return { indices: reconstruct(startIndex, goalIndex), partial: false };

      const currentRow = Math.floor(currentIndex / columns);
      const currentColumn = currentIndex - currentRow * columns;
      const currentCell = { column: currentColumn, row: currentRow };
      const currentHeuristic = heuristic(currentCell, goal);
      if (currentHeuristic < bestHeuristic) {
        bestHeuristic = currentHeuristic;
        bestIndex = currentIndex;
      }

      for (const neighbor of NEIGHBORS) {
        const column = currentColumn + neighbor.dc;
        const row = currentRow + neighbor.dr;
        if (!inGrid(column, row)) continue;
        const neighborIndex = indexOf(column, row);
        if (walkable[neighborIndex] === 0 || closedGeneration[neighborIndex] === generation) continue;

        if (neighbor.dc !== 0 && neighbor.dr !== 0) {
          const sideA = indexOf(currentColumn + neighbor.dc, currentRow);
          const sideB = indexOf(currentColumn, currentRow + neighbor.dr);
          if (walkable[sideA] === 0 || walkable[sideB] === 0) continue;
        }

        const stepCost = neighbor.cost * cellSize
          * (traversalCosts[currentIndex] + traversalCosts[neighborIndex]) * 0.5;
        const tentative = gScores[currentIndex] + stepCost;
        if (seenGeneration[neighborIndex] === generation && tentative >= gScores[neighborIndex]) continue;

        seenGeneration[neighborIndex] = generation;
        gScores[neighborIndex] = tentative;
        parents[neighborIndex] = currentIndex;
        heap.push({
          index: neighborIndex,
          score: tentative + heuristic({ column, row }, goal),
        });
      }
    }

    if (!allowPartial || bestIndex === startIndex || startHeuristic - bestHeuristic < PARTIAL_PROGRESS_EPSILON) return null;
    return { indices: reconstruct(startIndex, bestIndex), partial: true };
  };

  const findPath = (
    start: NavigationPoint,
    target: NavigationPoint,
    findOptions: FindPathOptions = {},
  ): NavigationPath | null => {
    const requestedTarget = clampPoint(target, bounds);
    const searchRadius = Math.max(cellSize, findOptions.nearestSearchRadius ?? nearestSearchRadius);
    const resolvedTarget = findNearestWalkable(requestedTarget, searchRadius);
    if (!resolvedTarget) return null;

    if (segmentIsWalkable(start, resolvedTarget)) {
      return {
        requestedTarget: copyPoint(requestedTarget),
        resolvedTarget: copyPoint(resolvedTarget),
        waypoints: [copyPoint(resolvedTarget)],
        partial: false,
      };
    }

    const startCell = nearestWalkableCell(start, Math.max(cellSize * 2.5, 1.5), false);
    if (!startCell) return null;
    const targetCell = nearestWalkableCell(
      resolvedTarget,
      Math.max(cellSize * 2.5, 1.5),
      pointIsWalkable(resolvedTarget),
    );
    if (!targetCell) return null;

    const search = runAStar(startCell, targetCell, findOptions.allowPartial ?? false);
    if (!search || search.indices.length === 0) return null;

    const raw: NavigationPoint[] = [copyPoint(start)];
    for (const index of search.indices) {
      const row = Math.floor(index / columns);
      const column = index - row * columns;
      const point = cellToWorld(column, row);
      const previous = raw[raw.length - 1];
      if (distanceSquared(previous, point) > 1e-6) raw.push(point);
    }

    let finalTarget = resolvedTarget;
    if (search.partial) {
      finalTarget = raw[raw.length - 1];
    } else if (distanceSquared(raw[raw.length - 1], resolvedTarget) > 1e-6) {
      raw.push(copyPoint(resolvedTarget));
    }

    const smoothed = smoothPath(raw);
    const waypoints = smoothed.slice(1);
    if (waypoints.length === 0 && distanceSquared(start, finalTarget) > 1e-5) waypoints.push(copyPoint(finalTarget));

    return {
      requestedTarget: copyPoint(requestedTarget),
      resolvedTarget: copyPoint(finalTarget),
      waypoints,
      partial: search.partial,
    };
  };

  return {
    cellSize,
    agentRadius: options.agentRadius,
    isWalkable: pointIsWalkable,
    findNearestWalkable,
    segmentIsWalkable,
    smoothPath,
    findPath,
    getDebugSnapshot: () => ({ bounds, cellSize, columns, rows, walkable }),
  };
}

function clampInt(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampPoint(point: NavigationPoint, bounds: NavigationBounds): NavigationPoint {
  return {
    x: Math.min(bounds.maxX, Math.max(bounds.minX, point.x)),
    z: Math.min(bounds.maxZ, Math.max(bounds.minZ, point.z)),
  };
}

function copyPoint(point: NavigationPoint): NavigationPoint {
  return { x: point.x, z: point.z };
}

function distanceSquared(a: NavigationPoint, b: NavigationPoint) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}
