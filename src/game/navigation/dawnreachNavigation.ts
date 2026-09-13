import * as THREE from 'three';
import type { CollisionWorld } from '../map/collisionWorld';
import { MAP_BOUNDS } from '../map/mapLayout';
import {
  createNavigationWorld,
  type FindPathOptions,
  type NavigationPath,
  type NavigationPoint,
  type NavigationWorld,
} from './navigationWorld';

const NAVIGATION_CELL_SIZE = 0.5;
const NAVIGATION_CLEARANCE = 0.04;
const PRECISION_CELL_SIZE = 0.3;
const PRECISION_CLEARANCE = 0.025;
const PRECISION_FALLBACK_DISTANCE = 16;
const PRECISION_MIN_EXPANSIONS = 1800;
const PRECISION_MAX_EXPANSIONS = 4200;

export const NAVIGATION_DEBUG = false;

export function createDawnreachNavigationWorld(
  battlefield: THREE.Object3D,
  collisionWorld: CollisionWorld,
  agentRadius: number,
): NavigationWorld {
  // Keep the presentation tree settled before navigation is built. Dawnreach water is
  // intentionally playable terrain, so walkability is governed only by the collision
  // world: walls, rocks, trees, structures, elevation barriers and authored railings.
  battlefield.updateMatrixWorld(true);

  const primary = createNavigationWorld({
    bounds: MAP_BOUNDS,
    collisionWorld,
    agentRadius,
    cellSize: NAVIGATION_CELL_SIZE,
    clearance: NAVIGATION_CLEARANCE,
    nearestSearchRadius: 5.5,
  });

  // A single coarse grid can falsely disconnect a narrow but physically valid passage when
  // its cell centres happen to land on both sides of trees/rocks. Keep a finer secondary
  // grid available only as a local fallback; long/global orders still use the cheaper grid.
  const precision = createNavigationWorld({
    bounds: MAP_BOUNDS,
    collisionWorld,
    agentRadius,
    cellSize: PRECISION_CELL_SIZE,
    clearance: PRECISION_CLEARANCE,
    nearestSearchRadius: 5.5,
  });

  const findPath = (
    start: NavigationPoint,
    target: NavigationPoint,
    options: FindPathOptions = {},
  ): NavigationPath | null => {
    const primaryPath = primary.findPath(start, target, options);
    if (primaryPath && !primaryPath.partial) return primaryPath;

    const distance = Math.hypot(target.x - start.x, target.z - start.z);
    if (distance > PRECISION_FALLBACK_DISTANCE) return primaryPath;

    const precisionBudget = THREE.MathUtils.clamp(
      Math.ceil(PRECISION_MIN_EXPANSIONS + distance * 145),
      PRECISION_MIN_EXPANSIONS,
      PRECISION_MAX_EXPANSIONS,
    );
    const precisionPath = precision.findPath(start, target, {
      ...options,
      allowPartial: options.allowPartial ?? true,
      maxExpandedNodes: Math.max(options.maxExpandedNodes ?? 0, precisionBudget),
    });

    // Prefer the precision result when it proves the destination is connected. If the coarse
    // grid found nothing at all, even a precision partial route is more useful than standing.
    if (precisionPath && !precisionPath.partial) return precisionPath;
    if (!primaryPath) return precisionPath;
    return primaryPath;
  };

  return {
    cellSize: primary.cellSize,
    agentRadius: primary.agentRadius,
    isWalkable: primary.isWalkable,
    findNearestWalkable: primary.findNearestWalkable,
    segmentIsWalkable: primary.segmentIsWalkable,
    smoothPath: primary.smoothPath,
    findPath,
    getDebugSnapshot: primary.getDebugSnapshot,
  };
}

export function createNavigationDebugGroup(navigation: NavigationWorld) {
  const group = new THREE.Group();
  group.name = 'navigation-debug';
  group.visible = NAVIGATION_DEBUG;

  const snapshot = navigation.getDebugSnapshot();
  const blocked: number[] = [];
  for (let row = 0; row < snapshot.rows; row++) {
    for (let column = 0; column < snapshot.columns; column++) {
      const index = row * snapshot.columns + column;
      if (snapshot.walkable[index] !== 0) continue;
      blocked.push(
        snapshot.bounds.minX + (column + 0.5) * snapshot.cellSize,
        0.14,
        snapshot.bounds.minZ + (row + 0.5) * snapshot.cellSize,
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(blocked, 3));
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color: 0xff3155, size: 0.13, transparent: true, opacity: 0.72, depthWrite: false }),
  );
  points.name = 'navigation-blocked-cells';
  group.add(points);

  const path = new THREE.Line(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: 0x54ff9f, transparent: true, opacity: 0.95, depthTest: false }),
  );
  path.name = 'navigation-current-path';
  path.renderOrder = 50;
  group.add(path);
  return group;
}

export function updateNavigationDebugPath(group: THREE.Group | null, path: NavigationPath | null, start: NavigationPoint) {
  if (!group) return;
  const line = group.getObjectByName('navigation-current-path');
  if (!(line instanceof THREE.Line)) return;
  line.geometry.dispose();
  const points = path ? [start, ...path.waypoints] : [start];
  line.geometry = new THREE.BufferGeometry().setFromPoints(
    points.map(point => new THREE.Vector3(point.x, 0.22, point.z)),
  );
}
