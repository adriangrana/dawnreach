import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { createNavigationWorld } = require('../node_modules/.cache/alden-test/navigation/navigationWorld.js');

function createTestWorld({
  bounds = { minX: 0, maxX: 8, minZ: 0, maxZ: 8 },
  blocked = () => false,
  terrainWalkable,
  cellSize = 1,
  nearestSearchRadius = 4,
} = {}) {
  return createNavigationWorld({
    bounds,
    collisionWorld: { isBlocked: blocked },
    agentRadius: 0,
    clearance: 0,
    cellSize,
    nearestSearchRadius,
    terrainWalkable,
  });
}

test('navigation smooths an unobstructed route to a direct target', () => {
  const navigation = createTestWorld();
  const path = navigation.findPath({ x: 0.5, z: 0.5 }, { x: 7.5, z: 7.5 });
  assert.ok(path);
  assert.equal(path.partial, false);
  assert.deepEqual(path.waypoints, [{ x: 7.5, z: 7.5 }]);
});

test('A* routes around an obstacle instead of intersecting it', () => {
  const navigation = createTestWorld({
    blocked: point => point.x > 3 && point.x < 5 && point.z > 2 && point.z < 6,
  });
  const start = { x: 1.5, z: 4 };
  const path = navigation.findPath(start, { x: 6.5, z: 4 });
  assert.ok(path);
  assert.ok(path.waypoints.length >= 2);

  let previous = start;
  for (const waypoint of path.waypoints) {
    assert.equal(navigation.segmentIsWalkable(previous, waypoint), true);
    previous = waypoint;
  }
});

test('replanning sees an obstacle that appears after the navigation grid was built', () => {
  let obstacleActive = false;
  const navigation = createTestWorld({
    blocked: point => obstacleActive && point.x > 3 && point.x < 5 && point.z > 2 && point.z < 6,
  });
  const start = { x: 1.5, z: 4 };
  const target = { x: 6.5, z: 4 };

  const direct = navigation.findPath(start, target);
  assert.ok(direct);
  assert.deepEqual(direct.waypoints, [target]);

  obstacleActive = true;
  assert.equal(navigation.segmentIsWalkable(start, target), false);

  const rerouted = navigation.findPath(start, target);
  assert.ok(rerouted);
  assert.equal(rerouted.partial, false);
  assert.ok(rerouted.waypoints.length >= 2);

  let previous = start;
  for (const waypoint of rerouted.waypoints) {
    assert.equal(navigation.segmentIsWalkable(previous, waypoint), true);
    previous = waypoint;
  }

  obstacleActive = false;
  const directAgain = navigation.findPath(start, target);
  assert.ok(directAgain);
  assert.deepEqual(directAgain.waypoints, [target]);
});

test('unreachable destination returns null when partial routing is disabled', () => {
  const navigation = createTestWorld({ blocked: point => point.x > 3.4 && point.x < 4.6 });
  assert.equal(navigation.findPath({ x: 1.5, z: 4 }, { x: 6.5, z: 4 }), null);
});

test('destination inside a collider resolves to a nearby walkable point', () => {
  const navigation = createTestWorld({
    blocked: point => Math.hypot(point.x - 4, point.z - 4) < 1.3,
  });
  const path = navigation.findPath({ x: 1.5, z: 4 }, { x: 4, z: 4 });
  assert.ok(path);
  assert.equal(navigation.isWalkable(path.resolvedTarget), true);
  assert.ok(Math.hypot(path.resolvedTarget.x - 4, path.resolvedTarget.z - 4) >= 1.3);
});

test('diagonal routing does not cut through two blocked orthogonal cells', () => {
  const navigation = createTestWorld({
    bounds: { minX: 0, maxX: 2, minZ: 0, maxZ: 2 },
    cellSize: 1,
    nearestSearchRadius: 1,
    terrainWalkable: point => !((point.x > 1 && point.z < 1) || (point.x < 1 && point.z > 1)),
  });
  assert.equal(navigation.findPath({ x: 0.5, z: 0.5 }, { x: 1.5, z: 1.5 }), null);
});

test('line-of-sight smoothing removes unnecessary intermediate waypoints', () => {
  const navigation = createTestWorld();
  const smoothed = navigation.smoothPath([
    { x: 0.5, z: 0.5 },
    { x: 1.5, z: 0.5 },
    { x: 2.5, z: 1.5 },
    { x: 3.5, z: 2.5 },
    { x: 6.5, z: 6.5 },
  ]);
  assert.deepEqual(smoothed, [{ x: 0.5, z: 0.5 }, { x: 6.5, z: 6.5 }]);
});
