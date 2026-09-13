import * as THREE from 'three';
import type { CollisionWorld } from '../map/collisionWorld';
import { distanceToMapPath, sampleMapPath } from '../map/buildMapVegetation';
import { DAWNREACH_LAYOUT, MAP_BOUNDS, OBJECTIVE_LAYOUT } from '../map/mapLayout';
import {
  createNavigationWorld,
  type NavigationPath,
  type NavigationPoint,
  type NavigationWorld,
} from './navigationWorld';

const NAVIGATION_CELL_SIZE = 0.7;
const NAVIGATION_CLEARANCE = 0.07;
const RIVER_WATER_HALF_WIDTH = 3.38;
const BRIDGE_APPROACH_EXTENSION = 1.85;
const BRIDGE_REGION_PADDING = 0.08;
const OBJECTIVE_INTERIOR_RADIUS = OBJECTIVE_LAYOUT.poolRadius + 0.48;
const OBJECTIVE_GATE_CORRIDOR_RADIUS = OBJECTIVE_LAYOUT.wallRadius + RIVER_WATER_HALF_WIDTH + 0.9;
const OBJECTIVE_GATE_NAV_HALF_ANGLE = OBJECTIVE_LAYOUT.gateHalfAngle * 0.62;

export const NAVIGATION_DEBUG = false;

type BridgeRegion = Readonly<{
  inverseWorld: THREE.Matrix4;
  halfLength: number;
  halfWidth: number;
}>;

type ObjectivePitRegion = Readonly<{
  x: number;
  z: number;
  entranceAngle: number;
}>;

export function createDawnreachNavigationWorld(
  battlefield: THREE.Object3D,
  collisionWorld: CollisionWorld,
  agentRadius: number,
) {
  battlefield.updateMatrixWorld(true);
  const river = sampleMapPath(DAWNREACH_LAYOUT.river);
  const bridges = collectBridgeRegions(battlefield);
  const objectivePits = collectObjectivePitRegions(river);

  return createNavigationWorld({
    bounds: MAP_BOUNDS,
    collisionWorld,
    agentRadius,
    cellSize: NAVIGATION_CELL_SIZE,
    clearance: NAVIGATION_CLEARANCE,
    nearestSearchRadius: 5.5,
    terrainWalkable(point) {
      // Objective pools are intentionally shallow, playable water. Their wall colliders still
      // enforce the circular ruins and leave only the authored gate as a legal entrance.
      if (objectivePits.some(region => objectivePitContains(region, point))) return true;
      if (distanceToMapPath(point.x, point.z, river) > RIVER_WATER_HALF_WIDTH) return true;
      return bridges.some(region => bridgeContains(region, point));
    },
  });
}

function collectBridgeRegions(battlefield: THREE.Object3D) {
  const regions: BridgeRegion[] = [];
  battlefield.traverse((object) => {
    if (!(object instanceof THREE.Group) || !object.name.endsWith('-river-bridge')) return;
    const commandDeck = object.children.find(child =>
      child instanceof THREE.Mesh
      && child.userData.commandSurface === true
      && child.geometry instanceof THREE.BoxGeometry) as THREE.Mesh<THREE.BoxGeometry> | undefined;
    if (!commandDeck) return;

    const { width, depth } = commandDeck.geometry.parameters;
    const world = object.matrixWorld.clone();
    regions.push({
      inverseWorld: world.invert(),
      halfLength: width * Math.abs(commandDeck.scale.x) * 0.5 + BRIDGE_APPROACH_EXTENSION,
      halfWidth: depth * Math.abs(commandDeck.scale.z) * 0.5 + BRIDGE_REGION_PADDING,
    });
  });
  return regions;
}

function collectObjectivePitRegions(river: readonly THREE.Vector3[]) {
  return DAWNREACH_LAYOUT.objectivePits.map((pit): ObjectivePitRegion => {
    let nearest = river[0];
    for (const point of river) {
      if (Math.hypot(point.x - pit.x, point.z - pit.z) < Math.hypot(nearest.x - pit.x, nearest.z - pit.z)) {
        nearest = point;
      }
    }
    return {
      x: pit.x,
      z: pit.z,
      entranceAngle: Math.atan2(nearest.z - pit.z, nearest.x - pit.x),
    };
  });
}

function objectivePitContains(region: ObjectivePitRegion, point: NavigationPoint) {
  const dx = point.x - region.x;
  const dz = point.z - region.z;
  const distance = Math.hypot(dx, dz);
  if (distance <= OBJECTIVE_INTERIOR_RADIUS) return true;
  if (distance > OBJECTIVE_GATE_CORRIDOR_RADIUS) return false;

  const angle = Math.atan2(dz, dx);
  return angularDistance(angle, region.entranceAngle) <= OBJECTIVE_GATE_NAV_HALF_ANGLE;
}

function angularDistance(a: number, b: number) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

const bridgeProbe = new THREE.Vector3();
function bridgeContains(region: BridgeRegion, point: NavigationPoint) {
  bridgeProbe.set(point.x, 0, point.z).applyMatrix4(region.inverseWorld);
  return Math.abs(bridgeProbe.x) <= region.halfLength && Math.abs(bridgeProbe.z) <= region.halfWidth;
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
