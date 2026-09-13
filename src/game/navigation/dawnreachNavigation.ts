import * as THREE from 'three';
import type { CollisionWorld } from '../map/collisionWorld';
import { MAP_BOUNDS } from '../map/mapLayout';
import {
  createNavigationWorld,
  type NavigationPath,
  type NavigationPoint,
  type NavigationWorld,
} from './navigationWorld';

const NAVIGATION_CELL_SIZE = 0.7;
const NAVIGATION_CLEARANCE = 0.07;

export const NAVIGATION_DEBUG = false;

export function createDawnreachNavigationWorld(
  battlefield: THREE.Object3D,
  collisionWorld: CollisionWorld,
  agentRadius: number,
) {
  // Keep the presentation tree settled before navigation is built. Dawnreach water is
  // intentionally playable terrain, so walkability is governed only by the collision
  // world: walls, rocks, trees, structures, elevation barriers and authored railings.
  battlefield.updateMatrixWorld(true);

  return createNavigationWorld({
    bounds: MAP_BOUNDS,
    collisionWorld,
    agentRadius,
    cellSize: NAVIGATION_CELL_SIZE,
    clearance: NAVIGATION_CLEARANCE,
    nearestSearchRadius: 5.5,
  });
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
