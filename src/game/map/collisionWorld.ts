import * as THREE from 'three';
import { BASE_LAYOUT, DAWNREACH_LAYOUT, MAP_BOUNDS, OBJECTIVE_LAYOUT } from './mapLayout';
import { distanceToMapPath, sampleMapPath } from './buildMapVegetation';

export type CollisionPoint = { x: number; z: number };

type CircleCollider = {
  x: number;
  z: number;
  radius: number;
  kind: 'tree' | 'structure';
};

type RockCollider = {
  x: number;
  z: number;
  radiusX: number;
  radiusZ: number;
  cos: number;
  sin: number;
};

type SegmentCollider = {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  radius: number;
  kind: 'wall' | 'elevation';
};

export type CollisionWorld = {
  move(from: CollisionPoint, to: CollisionPoint, radius: number): CollisionPoint;
  isBlocked(point: CollisionPoint, radius: number): boolean;
  readonly counts: Readonly<Record<'trees' | 'rocks' | 'structures' | 'walls' | 'elevations', number>>;
};

const TREE_RADIUS = 0.31;
const WALL_RADIUS = 0.48;
const ELEVATION_RADIUS = 0.62;
const MAX_SUBSTEP = 0.18;
const SOLVER_PASSES = 8;
const ROCK_FOOTPRINT_SCALE = 0.82;
const ROCK_MIN_RADIUS = 0.18;
const LANE_ROCK_CLEARANCE = 2.35;
const TRAIL_ROCK_CLEARANCE = 1.25;
const CAMP_ENTRANCE_ROCKS = 2;

export function createMapCollisionWorld(battlefield: THREE.Object3D): CollisionWorld {
  battlefield.updateMatrixWorld(true);

  // Camp rings are landmarks, not cages. Remove the two stones closest to the nearest
  // jungle route so every neutral camp has a clear, readable entrance.
  openCampEntrances(battlefield);
  battlefield.updateMatrixWorld(true);

  // Gameplay routes are authored as guaranteed walkable space. Decorative camp and
  // jungle rocks are generated independently, so occasionally one can overlap a lane
  // or jungle trail. Remove only those stone meshes whose visible footprint intrudes
  // into a route before building colliders, keeping the visual map and navigation in sync.
  pruneRouteBlockingRocks(battlefield);
  battlefield.updateMatrixWorld(true);

  const circles: CircleCollider[] = [];
  const rocks: RockCollider[] = [];
  const segments: SegmentCollider[] = [];
  const counts = { trees: 0, rocks: 0, structures: 0, walls: 0, elevations: 0 };

  collectTreeColliders(battlefield, circles, counts);
  collectRockColliders(battlefield, rocks, counts);
  collectStructureColliders(battlefield, circles, counts);
  addRetainingWallColliders(segments, counts);
  addBaseWallColliders(segments, counts);
  addObjectiveWallColliders(segments, counts);

  const isBlocked = (point: CollisionPoint, radius: number) => {
    if (point.x - radius < MAP_BOUNDS.minX || point.x + radius > MAP_BOUNDS.maxX
      || point.z - radius < MAP_BOUNDS.minZ || point.z + radius > MAP_BOUNDS.maxZ) return true;

    for (const circle of circles) {
      const required = radius + circle.radius;
      if ((point.x - circle.x) ** 2 + (point.z - circle.z) ** 2 < required ** 2) return true;
    }

    for (const rock of rocks) {
      const dx = point.x - rock.x;
      const dz = point.z - rock.z;
      const localX = rock.cos * dx - rock.sin * dz;
      const localZ = rock.sin * dx + rock.cos * dz;
      const radiusX = rock.radiusX + radius;
      const radiusZ = rock.radiusZ + radius;
      if ((localX / radiusX) ** 2 + (localZ / radiusZ) ** 2 < 1) return true;
    }

    for (const segment of segments) {
      if (distanceToSegment(point.x, point.z, segment) < radius + segment.radius) return true;
    }
    return false;
  };

  const resolvePoint = (point: CollisionPoint, previous: CollisionPoint, radius: number) => {
    const resolved = {
      x: THREE.MathUtils.clamp(point.x, MAP_BOUNDS.minX + radius, MAP_BOUNDS.maxX - radius),
      z: THREE.MathUtils.clamp(point.z, MAP_BOUNDS.minZ + radius, MAP_BOUNDS.maxZ - radius),
    };

    for (let pass = 0; pass < SOLVER_PASSES; pass++) {
      let changed = false;

      for (const circle of circles) {
        const required = radius + circle.radius;
        const dx = resolved.x - circle.x;
        const dz = resolved.z - circle.z;
        const squared = dx * dx + dz * dz;
        if (squared >= required * required) continue;

        let distance = Math.sqrt(squared);
        let nx: number;
        let nz: number;
        if (distance > 1e-6) {
          nx = dx / distance;
          nz = dz / distance;
        } else {
          const fallbackX = previous.x - circle.x;
          const fallbackZ = previous.z - circle.z;
          const fallbackLength = Math.hypot(fallbackX, fallbackZ) || 1;
          nx = fallbackX / fallbackLength;
          nz = fallbackZ / fallbackLength;
          distance = 0;
        }

        const push = required - distance + 0.003;
        resolved.x += nx * push;
        resolved.z += nz * push;
        changed = true;
      }

      for (const rock of rocks) {
        const dx = resolved.x - rock.x;
        const dz = resolved.z - rock.z;
        let localX = rock.cos * dx - rock.sin * dz;
        let localZ = rock.sin * dx + rock.cos * dz;
        const radiusX = rock.radiusX + radius;
        const radiusZ = rock.radiusZ + radius;
        let normalized = Math.hypot(localX / radiusX, localZ / radiusZ);
        if (normalized >= 1) continue;

        if (normalized <= 1e-6) {
          const previousDx = previous.x - rock.x;
          const previousDz = previous.z - rock.z;
          localX = rock.cos * previousDx - rock.sin * previousDz;
          localZ = rock.sin * previousDx + rock.cos * previousDz;
          normalized = Math.hypot(localX / radiusX, localZ / radiusZ);
          if (normalized <= 1e-6) {
            localX = radiusX;
            localZ = 0;
            normalized = 1;
          }
        }

        const boundaryScale = (1 / normalized) * 1.003;
        const targetLocalX = localX * boundaryScale;
        const targetLocalZ = localZ * boundaryScale;
        resolved.x = rock.x + rock.cos * targetLocalX + rock.sin * targetLocalZ;
        resolved.z = rock.z - rock.sin * targetLocalX + rock.cos * targetLocalZ;
        changed = true;
      }

      for (const segment of segments) {
        const vx = segment.bx - segment.ax;
        const vz = segment.bz - segment.az;
        const lengthSquared = vx * vx + vz * vz;
        if (lengthSquared <= 1e-8) continue;

        const t = THREE.MathUtils.clamp(
          ((resolved.x - segment.ax) * vx + (resolved.z - segment.az) * vz) / lengthSquared,
          0,
          1,
        );
        const closestX = segment.ax + vx * t;
        const closestZ = segment.az + vz * t;
        const dx = resolved.x - closestX;
        const dz = resolved.z - closestZ;
        const required = radius + segment.radius;
        const squared = dx * dx + dz * dz;
        if (squared >= required * required) continue;

        let distance = Math.sqrt(squared);
        let nx: number;
        let nz: number;
        if (distance > 1e-6) {
          nx = dx / distance;
          nz = dz / distance;
        } else {
          const length = Math.sqrt(lengthSquared);
          const side = Math.sign(vx * (previous.z - segment.az) - vz * (previous.x - segment.ax)) || 1;
          nx = (-vz / length) * side;
          nz = (vx / length) * side;
          distance = 0;
        }

        const push = required - distance + 0.003;
        resolved.x += nx * push;
        resolved.z += nz * push;
        changed = true;
      }

      resolved.x = THREE.MathUtils.clamp(resolved.x, MAP_BOUNDS.minX + radius, MAP_BOUNDS.maxX - radius);
      resolved.z = THREE.MathUtils.clamp(resolved.z, MAP_BOUNDS.minZ + radius, MAP_BOUNDS.maxZ - radius);
      if (!changed) break;
    }

    return resolved;
  };

  return {
    counts,
    isBlocked,
    move(from, to, radius) {
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const distance = Math.hypot(dx, dz);

      let current = resolvePoint(from, from, radius);
      if (distance <= 1e-8) return current;

      const steps = Math.max(1, Math.ceil(distance / MAX_SUBSTEP));
      const stepX = dx / steps;
      const stepZ = dz / steps;

      for (let step = 0; step < steps; step++) {
        const candidate = { x: current.x + stepX, z: current.z + stepZ };
        const resolved = resolvePoint(candidate, current, radius);
        if (!isBlocked(resolved, radius)) {
          current = resolved;
          continue;
        }

        // Dense rock/tree clusters can leave the iterative solver wedged between two
        // overlapping colliders. In that case, try axis-separated sliding and only
        // accept positions that are guaranteed collision-free.
        const slideX = resolvePoint({ x: current.x + stepX, z: current.z }, current, radius);
        const slideZ = resolvePoint({ x: current.x, z: current.z + stepZ }, current, radius);
        const xFree = !isBlocked(slideX, radius);
        const zFree = !isBlocked(slideZ, radius);

        if (xFree && zFree) {
          const xProgress = (slideX.x - current.x) ** 2 + (slideX.z - current.z) ** 2;
          const zProgress = (slideZ.x - current.x) ** 2 + (slideZ.z - current.z) ** 2;
          current = xProgress >= zProgress ? slideX : slideZ;
        } else if (xFree) {
          current = slideX;
        } else if (zFree) {
          current = slideZ;
        }
      }
      return current;
    },
  };
}

function isStoneRock(object: THREE.Object3D): object is THREE.Mesh {
  if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return false;
  if (!(object.geometry instanceof THREE.DodecahedronGeometry)) return false;

  const authoredRadius = Number(object.geometry.parameters.radius ?? 0);
  if (authoredRadius < 0.34) return false;

  const materials = Array.isArray(object.material) ? object.material : [object.material];
  return materials.some(material =>
    material instanceof THREE.MeshStandardMaterial && material.map !== null);
}

function openCampEntrances(battlefield: THREE.Object3D) {
  const trails = DAWNREACH_LAYOUT.junglePaths.map(sampleMapPath);
  const camps: THREE.Group[] = [];
  const campCenter = new THREE.Vector3();
  const rockCenter = new THREE.Vector3();

  battlefield.traverse((object) => {
    if (object instanceof THREE.Group && object.name.startsWith('jungle-camp-')) camps.push(object);
  });

  for (const camp of camps) {
    camp.getWorldPosition(campCenter);

    let nearestX = campCenter.x;
    let nearestZ = campCenter.z;
    let nearestDistanceSq = Infinity;
    for (const trail of trails) {
      for (const point of trail) {
        const dx = point.x - campCenter.x;
        const dz = point.z - campCenter.z;
        const distanceSq = dx * dx + dz * dz;
        if (distanceSq >= nearestDistanceSq) continue;
        nearestDistanceSq = distanceSq;
        nearestX = point.x;
        nearestZ = point.z;
      }
    }

    const entranceAngle = Math.atan2(nearestZ - campCenter.z, nearestX - campCenter.x);
    const ringRocks = camp.children
      .filter(isStoneRock)
      .map((rock) => {
        rock.getWorldPosition(rockCenter);
        const angle = Math.atan2(rockCenter.z - campCenter.z, rockCenter.x - campCenter.x);
        return { rock, distance: angularDistance(angle, entranceAngle) };
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, CAMP_ENTRANCE_ROCKS);

    for (const { rock } of ringRocks) {
      rock.removeFromParent();
      rock.geometry.dispose();
    }
  }
}

function pruneRouteBlockingRocks(battlefield: THREE.Object3D) {
  const lanes = Object.values(DAWNREACH_LAYOUT.lanes).map(sampleMapPath);
  const trails = DAWNREACH_LAYOUT.junglePaths.map(sampleMapPath);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  const toRemove: THREE.Mesh[] = [];

  battlefield.traverse((object) => {
    if (!isStoneRock(object)) return;

    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    box.getSize(size);
    if (size.y < 0.28 || Math.max(size.x, size.z) < 0.42) return;
    box.getCenter(center);

    // Use the visible horizontal footprint, not only the rock center. This creates
    // an actual clear corridor instead of allowing a large boulder to overhang it.
    const footprintRadius = Math.max(size.x, size.z) * 0.5;
    const overlapsLane = lanes.some(path =>
      distanceToMapPath(center.x, center.z, path) < LANE_ROCK_CLEARANCE + footprintRadius);
    const overlapsTrail = trails.some(path =>
      distanceToMapPath(center.x, center.z, path) < TRAIL_ROCK_CLEARANCE + footprintRadius);

    if (overlapsLane || overlapsTrail) toRemove.push(object);
  });

  for (const rock of toRemove) {
    rock.removeFromParent();
    rock.geometry.dispose();
  }
}

function collectTreeColliders(
  battlefield: THREE.Object3D,
  colliders: CircleCollider[],
  counts: { trees: number },
) {
  const instanceMatrix = new THREE.Matrix4();
  const worldMatrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();

  battlefield.traverse((object) => {
    if (!(object instanceof THREE.InstancedMesh) || !object.name.startsWith('pine-trunks:')) return;
    for (let index = 0; index < object.count; index++) {
      object.getMatrixAt(index, instanceMatrix);
      worldMatrix.multiplyMatrices(object.matrixWorld, instanceMatrix);
      worldMatrix.decompose(position, quaternion, scale);
      colliders.push({
        x: position.x,
        z: position.z,
        radius: TREE_RADIUS * Math.max(Math.abs(scale.x), Math.abs(scale.z)),
        kind: 'tree',
      });
      counts.trees++;
    }
  });
}

function collectRockColliders(
  battlefield: THREE.Object3D,
  colliders: RockCollider[],
  counts: { rocks: number },
) {
  const localCenter = new THREE.Vector3();
  const localSize = new THREE.Vector3();
  const worldCenter = new THREE.Vector3();
  const worldScale = new THREE.Vector3();
  const worldQuaternion = new THREE.Quaternion();
  const worldEuler = new THREE.Euler(0, 0, 0, 'YXZ');

  battlefield.traverse((object) => {
    if (!isStoneRock(object)) return;

    if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
    const box = object.geometry.boundingBox;
    if (!box) return;
    box.getSize(localSize);
    if (localSize.y < 0.28 || Math.max(localSize.x, localSize.z) < 0.42) return;
    box.getCenter(localCenter);

    worldCenter.copy(localCenter).applyMatrix4(object.matrixWorld);
    object.getWorldScale(worldScale);
    object.getWorldQuaternion(worldQuaternion);
    worldEuler.setFromQuaternion(worldQuaternion, 'YXZ');

    const radiusX = Math.max(
      ROCK_MIN_RADIUS,
      localSize.x * Math.abs(worldScale.x) * 0.5 * ROCK_FOOTPRINT_SCALE,
    );
    const radiusZ = Math.max(
      ROCK_MIN_RADIUS,
      localSize.z * Math.abs(worldScale.z) * 0.5 * ROCK_FOOTPRINT_SCALE,
    );
    const rotation = worldEuler.y;

    colliders.push({
      x: worldCenter.x,
      z: worldCenter.z,
      radiusX,
      radiusZ,
      cos: Math.cos(rotation),
      sin: Math.sin(rotation),
    });
    counts.rocks++;
  });
}

function collectStructureColliders(
  battlefield: THREE.Object3D,
  colliders: CircleCollider[],
  counts: { structures: number },
) {
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  battlefield.traverse((object) => {
    if (!(object instanceof THREE.Group)) return;
    const name = object.name.toLowerCase();
    if (!(name.endsWith('-tower') || name.endsWith('-defense-tower'))) return;
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    box.getCenter(center);
    box.getSize(size);
    colliders.push({
      x: center.x,
      z: center.z,
      radius: THREE.MathUtils.clamp(Math.min(size.x, size.z) * 0.34, 0.65, 1.45),
      kind: 'structure',
    });
    counts.structures++;
  });
}

function addRetainingWallColliders(
  colliders: SegmentCollider[],
  counts: { elevations: number },
) {
  const lanes = Object.values(DAWNREACH_LAYOUT.lanes).map(sampleMapPath);
  const river = sampleMapPath(DAWNREACH_LAYOUT.river);
  const trails = DAWNREACH_LAYOUT.junglePaths.map(sampleMapPath);
  const bases = [DAWNREACH_LAYOUT.blueBase, DAWNREACH_LAYOUT.redBase];

  const isOpening = (x: number, z: number) => distanceToMapPath(x, z, river) < 5.2
    || bases.some(base => Math.hypot(x - base.x, z - base.z) < BASE_LAYOUT.radius + 1)
    || lanes.some(lane => distanceToMapPath(x, z, lane) < 3.1)
    || trails.some(trail => distanceToMapPath(x, z, trail) < 1.7);

  for (const path of DAWNREACH_LAYOUT.retainingWalls) {
    for (let pointIndex = 0; pointIndex < path.length - 1; pointIndex++) {
      const [ax, az] = path[pointIndex];
      const [bx, bz] = path[pointIndex + 1];
      const length = Math.hypot(bx - ax, bz - az);
      const pieces = Math.max(1, Math.ceil(length / 1.1));
      for (let piece = 0; piece < pieces; piece++) {
        const start = piece / pieces;
        const end = (piece + 1) / pieces;
        const x1 = THREE.MathUtils.lerp(ax, bx, start);
        const z1 = THREE.MathUtils.lerp(az, bz, start);
        const x2 = THREE.MathUtils.lerp(ax, bx, end);
        const z2 = THREE.MathUtils.lerp(az, bz, end);
        const midX = (x1 + x2) / 2;
        const midZ = (z1 + z2) / 2;
        if (isOpening(midX, midZ)) continue;
        colliders.push({ ax: x1, az: z1, bx: x2, bz: z2, radius: ELEVATION_RADIUS, kind: 'elevation' });
        counts.elevations++;
      }
    }
  }
}

function addBaseWallColliders(
  colliders: SegmentCollider[],
  counts: { walls: number; elevations: number },
) {
  const segmentCount = 112;
  const gateHalfAngle = BASE_LAYOUT.rampWidth / (BASE_LAYOUT.radius * 2) + 0.055;

  for (const [team, center] of [
    ['blue', DAWNREACH_LAYOUT.blueBase],
    ['red', DAWNREACH_LAYOUT.redBase],
  ] as const) {
    const rotation = team === 'blue' ? 0 : Math.PI;
    const gates = BASE_LAYOUT.gates.map(angle => normalizeAngle(angle + rotation));

    for (let index = 0; index < segmentCount; index++) {
      const a = index / segmentCount * Math.PI * 2;
      const b = (index + 1) / segmentCount * Math.PI * 2;
      const middle = normalizeAngle((a + b) / 2);
      if (gates.some(gate => angularDistance(middle, gate) < gateHalfAngle)) continue;

      colliders.push({
        ax: center.x + Math.cos(a) * BASE_LAYOUT.radius,
        az: center.z + Math.sin(a) * BASE_LAYOUT.radius,
        bx: center.x + Math.cos(b) * BASE_LAYOUT.radius,
        bz: center.z + Math.sin(b) * BASE_LAYOUT.radius,
        radius: WALL_RADIUS,
        kind: 'wall',
      });
      counts.walls++;
      counts.elevations++;
    }
  }
}

function addObjectiveWallColliders(
  colliders: SegmentCollider[],
  counts: { walls: number },
) {
  const river = sampleMapPath(DAWNREACH_LAYOUT.river);
  const segmentCount = 72;

  for (const pit of DAWNREACH_LAYOUT.objectivePits) {
    let closest = river[0];
    for (const point of river) {
      if (Math.hypot(point.x - pit.x, point.z - pit.z) < Math.hypot(closest.x - pit.x, closest.z - pit.z)) closest = point;
    }
    const entranceAngle = Math.atan2(closest.z - pit.z, closest.x - pit.x);

    for (let index = 0; index < segmentCount; index++) {
      const a = index / segmentCount * Math.PI * 2;
      const b = (index + 1) / segmentCount * Math.PI * 2;
      const middle = (a + b) / 2;
      if (angularDistance(middle, entranceAngle) < OBJECTIVE_LAYOUT.gateHalfAngle) continue;
      colliders.push({
        ax: pit.x + Math.cos(a) * OBJECTIVE_LAYOUT.wallRadius,
        az: pit.z + Math.sin(a) * OBJECTIVE_LAYOUT.wallRadius,
        bx: pit.x + Math.cos(b) * OBJECTIVE_LAYOUT.wallRadius,
        bz: pit.z + Math.sin(b) * OBJECTIVE_LAYOUT.wallRadius,
        radius: WALL_RADIUS,
        kind: 'wall',
      });
      counts.walls++;
    }
  }
}

function distanceToSegment(x: number, z: number, segment: SegmentCollider) {
  const vx = segment.bx - segment.ax;
  const vz = segment.bz - segment.az;
  const lengthSquared = vx * vx + vz * vz;
  if (lengthSquared <= 1e-8) return Math.hypot(x - segment.ax, z - segment.az);
  const t = THREE.MathUtils.clamp(((x - segment.ax) * vx + (z - segment.az) * vz) / lengthSquared, 0, 1);
  return Math.hypot(x - (segment.ax + vx * t), z - (segment.az + vz * t));
}

function normalizeAngle(angle: number) {
  let normalized = angle % (Math.PI * 2);
  if (normalized < -Math.PI) normalized += Math.PI * 2;
  if (normalized > Math.PI) normalized -= Math.PI * 2;
  return normalized;
}

function angularDistance(a: number, b: number) {
  return Math.abs(normalizeAngle(a - b));
}
