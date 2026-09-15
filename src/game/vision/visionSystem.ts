import * as THREE from 'three';
import type { GameEntity, GameEntityRegistry, TeamId } from '../entities/gameEntities';
import { BASE_LAYOUT, DAWNREACH_LAYOUT, MAP_BOUNDS, OBJECTIVE_LAYOUT } from '../map/mapLayout';
import { distanceToMapPath, sampleMapPath } from '../map/buildMapVegetation';

export type VisionPoint = Readonly<{ x: number; z: number }>;
export type VisionLineOfSight = (
  source: Readonly<{ x: number; y: number; z: number }>,
  target: Readonly<{ x: number; y: number; z: number }>,
) => boolean;

export type VisionSystem = Readonly<{
  team: TeamId;
  isPointVisible(point: VisionPoint, y?: number): boolean;
  isEntityVisible(entity: GameEntity): boolean;
  updateEntityVisibility(): void;
  getSources(): GameEntity[];
}>;

const FOG_PIXELS_PER_WORLD_UNIT = 4;
const FOG_ALPHA = 0.56;
const FOG_INNER_FRACTION = 0.82;
const FOG_RENDER_ORDER = 20;
const FOG_VISIBILITY_RAYS = 64;
const FOG_SOURCE_REBUILD_DISTANCE = 0.16;
const FOG_SOURCE_REBUILD_HEIGHT = 0.12;
const FOG_OCCLUDER_REVEAL_MARGIN = 0.025;
const VISION_EPSILON = 0.06;
const TREE_VISION_RADIUS = 0.34;
const WALL_RADIUS = 0.48;
const ELEVATION_RADIUS = 0.42;
const OCCLUDER_SPATIAL_CELL_SIZE = 6;
const BASE_VISION_CONFINEMENT_RADIUS = BASE_LAYOUT.radius - 0.22;

type WorldPoint3 = Readonly<{ x: number; y: number; z: number }>;
type BaseVisionConfinement = Readonly<{ x: number; z: number; radius: number }>;

type CircleOccluder = {
  kind: 'circle';
  x: number;
  z: number;
  radius: number;
  minY: number;
  maxY: number;
  fogProjectionPadding?: number;
};

type EllipseOccluder = {
  kind: 'ellipse';
  x: number;
  z: number;
  radiusX: number;
  radiusZ: number;
  cos: number;
  sin: number;
  minY: number;
  maxY: number;
  fogProjectionPadding?: number;
};

type SegmentOccluder = {
  kind: 'segment';
  ax: number;
  az: number;
  bx: number;
  bz: number;
  radius: number;
  minY: number;
  maxY: number;
  fogProjectionPadding?: number;
};

type VisionOccluder = CircleOccluder | EllipseOccluder | SegmentOccluder;

type FogVisibilityCache = {
  x: number;
  y: number;
  z: number;
  radius: number;
  points: Array<{ x: number; z: number }>;
};

function findScene(object: THREE.Object3D | undefined) {
  let current = object;
  while (current?.parent) current = current.parent;
  return current instanceof THREE.Scene ? current : null;
}

function isItemVisionWard(source: GameEntity) {
  return source.root.userData.itemWard === true;
}

function getBaseVisionConfinement(
  source: GameEntity,
  position: Readonly<{ x: number; z: number }>,
): BaseVisionConfinement | null {
  // Wards are the deliberate exception: placing an Ojo inside a base is allowed to scout
  // across the citadel perimeter. Every ordinary unit/structure inside its own base remains
  // vision-confined so tall towers cannot reveal terrain by looking over the authored wall.
  if (isItemVisionWard(source)) return null;
  if (source.team !== 'blue' && source.team !== 'red') return null;
  const center = source.team === 'blue' ? DAWNREACH_LAYOUT.blueBase : DAWNREACH_LAYOUT.redBase;
  const dx = position.x - center.x;
  const dz = position.z - center.z;
  if (dx * dx + dz * dz > BASE_VISION_CONFINEMENT_RADIUS * BASE_VISION_CONFINEMENT_RADIUS) return null;
  return { x: center.x, z: center.z, radius: BASE_VISION_CONFINEMENT_RADIUS };
}

function pointInsideBaseConfinement(point: VisionPoint, confinement: BaseVisionConfinement) {
  const dx = point.x - confinement.x;
  const dz = point.z - confinement.z;
  return dx * dx + dz * dz <= confinement.radius * confinement.radius;
}

function isStoneRock(object: THREE.Object3D): object is THREE.Mesh {
  if (!(object instanceof THREE.Mesh) || object instanceof THREE.InstancedMesh) return false;
  if (object.userData.collisionRock === true || object.userData.visionOccluder === true) return true;
  if (!(object.geometry instanceof THREE.DodecahedronGeometry)) return false;
  const authoredRadius = Number(object.geometry.parameters.radius ?? 0);
  if (authoredRadius < 0.34) return false;
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  return materials.some(material => material instanceof THREE.MeshStandardMaterial && material.map !== null);
}

function pointInsideOccluder(occluder: VisionOccluder, x: number, z: number) {
  if (occluder.kind === 'circle') {
    return (x - occluder.x) ** 2 + (z - occluder.z) ** 2 <= occluder.radius ** 2;
  }
  if (occluder.kind === 'ellipse') {
    const dx = x - occluder.x;
    const dz = z - occluder.z;
    const localX = occluder.cos * dx - occluder.sin * dz;
    const localZ = occluder.sin * dx + occluder.cos * dz;
    return (localX / occluder.radiusX) ** 2 + (localZ / occluder.radiusZ) ** 2 <= 1;
  }
  return distancePointToSegment(x, z, occluder.ax, occluder.az, occluder.bx, occluder.bz) <= occluder.radius;
}

function rayCircleEntry(
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  maxDistance: number,
  cx: number,
  cz: number,
  radius: number,
) {
  const mx = ox - cx;
  const mz = oz - cz;
  const b = mx * dx + mz * dz;
  const c = mx * mx + mz * mz - radius * radius;
  if (c <= 0) return 0;
  if (b > 0) return Infinity;
  const discriminant = b * b - c;
  if (discriminant < 0) return Infinity;
  const distance = -b - Math.sqrt(discriminant);
  return distance >= 0 && distance <= maxDistance ? distance : Infinity;
}

function rayCircleExit(
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  maxDistance: number,
  cx: number,
  cz: number,
  radius: number,
) {
  const mx = ox - cx;
  const mz = oz - cz;
  const b = mx * dx + mz * dz;
  const c = mx * mx + mz * mz - radius * radius;
  const discriminant = b * b - c;
  if (discriminant < 0) return Infinity;
  const near = -b - Math.sqrt(discriminant);
  const far = -b + Math.sqrt(discriminant);
  if (far < 0 || near > maxDistance) return Infinity;
  return Math.min(maxDistance, far);
}

function rayEllipseEntry(
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  maxDistance: number,
  ellipse: EllipseOccluder,
) {
  const worldX = ox - ellipse.x;
  const worldZ = oz - ellipse.z;
  const localX = ellipse.cos * worldX - ellipse.sin * worldZ;
  const localZ = ellipse.sin * worldX + ellipse.cos * worldZ;
  const localDx = ellipse.cos * dx - ellipse.sin * dz;
  const localDz = ellipse.sin * dx + ellipse.cos * dz;
  const nx = localX / ellipse.radiusX;
  const nz = localZ / ellipse.radiusZ;
  const ndx = localDx / ellipse.radiusX;
  const ndz = localDz / ellipse.radiusZ;
  const a = ndx * ndx + ndz * ndz;
  const b = 2 * (nx * ndx + nz * ndz);
  const c = nx * nx + nz * nz - 1;
  if (c <= 0) return 0;
  const discriminant = b * b - 4 * a * c;
  if (a <= 1e-9 || discriminant < 0) return Infinity;
  const distance = (-b - Math.sqrt(discriminant)) / (2 * a);
  return distance >= 0 && distance <= maxDistance ? distance : Infinity;
}

function rayEllipseExit(
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  maxDistance: number,
  ellipse: EllipseOccluder,
) {
  const worldX = ox - ellipse.x;
  const worldZ = oz - ellipse.z;
  const localX = ellipse.cos * worldX - ellipse.sin * worldZ;
  const localZ = ellipse.sin * worldX + ellipse.cos * worldZ;
  const localDx = ellipse.cos * dx - ellipse.sin * dz;
  const localDz = ellipse.sin * dx + ellipse.cos * dz;
  const nx = localX / ellipse.radiusX;
  const nz = localZ / ellipse.radiusZ;
  const ndx = localDx / ellipse.radiusX;
  const ndz = localDz / ellipse.radiusZ;
  const a = ndx * ndx + ndz * ndz;
  const b = 2 * (nx * ndx + nz * ndz);
  const c = nx * nx + nz * nz - 1;
  const discriminant = b * b - 4 * a * c;
  if (a <= 1e-9 || discriminant < 0) return Infinity;
  const near = (-b - Math.sqrt(discriminant)) / (2 * a);
  const far = (-b + Math.sqrt(discriminant)) / (2 * a);
  if (far < 0 || near > maxDistance) return Infinity;
  return Math.min(maxDistance, far);
}

function raySlabEntry(position: number, direction: number, minimum: number, maximum: number) {
  if (Math.abs(direction) <= 1e-9) {
    return position >= minimum && position <= maximum
      ? { near: -Infinity, far: Infinity }
      : null;
  }
  const first = (minimum - position) / direction;
  const second = (maximum - position) / direction;
  return { near: Math.min(first, second), far: Math.max(first, second) };
}

function rayCapsuleEntry(
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  maxDistance: number,
  segment: SegmentOccluder,
) {
  const sx = segment.bx - segment.ax;
  const sz = segment.bz - segment.az;
  const length = Math.hypot(sx, sz);
  if (length <= 1e-6) {
    return rayCircleEntry(ox, oz, dx, dz, maxDistance, segment.ax, segment.az, segment.radius);
  }

  const ux = sx / length;
  const uz = sz / length;
  const nx = -uz;
  const nz = ux;
  const px = ox - segment.ax;
  const pz = oz - segment.az;
  const localX = px * ux + pz * uz;
  const localZ = px * nx + pz * nz;
  const localDx = dx * ux + dz * uz;
  const localDz = dx * nx + dz * nz;

  let best = Infinity;
  const xSlab = raySlabEntry(localX, localDx, 0, length);
  const zSlab = raySlabEntry(localZ, localDz, -segment.radius, segment.radius);
  if (xSlab && zSlab) {
    const near = Math.max(xSlab.near, zSlab.near, 0);
    const far = Math.min(xSlab.far, zSlab.far, maxDistance);
    if (near <= far) best = near;
  }

  best = Math.min(
    best,
    rayCircleEntry(ox, oz, dx, dz, maxDistance, segment.ax, segment.az, segment.radius),
    rayCircleEntry(ox, oz, dx, dz, maxDistance, segment.bx, segment.bz, segment.radius),
  );
  return best;
}

function rayCapsuleExit(
  ox: number,
  oz: number,
  dx: number,
  dz: number,
  maxDistance: number,
  segment: SegmentOccluder,
) {
  const sx = segment.bx - segment.ax;
  const sz = segment.bz - segment.az;
  const length = Math.hypot(sx, sz);
  if (length <= 1e-6) {
    return rayCircleExit(ox, oz, dx, dz, maxDistance, segment.ax, segment.az, segment.radius);
  }

  const ux = sx / length;
  const uz = sz / length;
  const nx = -uz;
  const nz = ux;
  const px = ox - segment.ax;
  const pz = oz - segment.az;
  const localX = px * ux + pz * uz;
  const localZ = px * nx + pz * nz;
  const localDx = dx * ux + dz * uz;
  const localDz = dx * nx + dz * nz;

  let farthest = -Infinity;
  const xSlab = raySlabEntry(localX, localDx, 0, length);
  const zSlab = raySlabEntry(localZ, localDz, -segment.radius, segment.radius);
  if (xSlab && zSlab) {
    const near = Math.max(xSlab.near, zSlab.near, 0);
    const far = Math.min(xSlab.far, zSlab.far, maxDistance);
    if (near <= far) farthest = Math.max(farthest, far);
  }

  const startEntry = rayCircleEntry(ox, oz, dx, dz, maxDistance, segment.ax, segment.az, segment.radius);
  if (Number.isFinite(startEntry)) {
    farthest = Math.max(
      farthest,
      rayCircleExit(ox, oz, dx, dz, maxDistance, segment.ax, segment.az, segment.radius),
    );
  }
  const endEntry = rayCircleEntry(ox, oz, dx, dz, maxDistance, segment.bx, segment.bz, segment.radius);
  if (Number.isFinite(endEntry)) {
    farthest = Math.max(
      farthest,
      rayCircleExit(ox, oz, dx, dz, maxDistance, segment.bx, segment.bz, segment.radius),
    );
  }
  return farthest >= 0 ? farthest : Infinity;
}

function rayOccluderEntry(
  occluder: VisionOccluder,
  source: WorldPoint3,
  dx: number,
  dz: number,
  maxDistance: number,
) {
  if (source.y < occluder.minY - VISION_EPSILON || source.y > occluder.maxY + VISION_EPSILON) return Infinity;
  if (pointInsideOccluder(occluder, source.x, source.z)) return Infinity;
  if (occluder.kind === 'circle') {
    return rayCircleEntry(source.x, source.z, dx, dz, maxDistance, occluder.x, occluder.z, occluder.radius);
  }
  if (occluder.kind === 'ellipse') {
    return rayEllipseEntry(source.x, source.z, dx, dz, maxDistance, occluder);
  }
  return rayCapsuleEntry(source.x, source.z, dx, dz, maxDistance, occluder);
}

function rayOccluderExit(
  occluder: VisionOccluder,
  source: WorldPoint3,
  dx: number,
  dz: number,
  maxDistance: number,
) {
  if (occluder.kind === 'circle') {
    return rayCircleExit(source.x, source.z, dx, dz, maxDistance, occluder.x, occluder.z, occluder.radius);
  }
  if (occluder.kind === 'ellipse') {
    return rayEllipseExit(source.x, source.z, dx, dz, maxDistance, occluder);
  }
  return rayCapsuleExit(source.x, source.z, dx, dz, maxDistance, occluder);
}

function distancePointToSegment(
  x: number,
  z: number,
  ax: number,
  az: number,
  bx: number,
  bz: number,
) {
  const vx = bx - ax;
  const vz = bz - az;
  const lengthSquared = vx * vx + vz * vz;
  if (lengthSquared <= 1e-9) return Math.hypot(x - ax, z - az);
  const t = THREE.MathUtils.clamp(((x - ax) * vx + (z - az) * vz) / lengthSquared, 0, 1);
  return Math.hypot(x - (ax + vx * t), z - (az + vz * t));
}

function occluderBounds(occluder: VisionOccluder) {
  if (occluder.kind === 'circle') {
    return {
      minX: occluder.x - occluder.radius,
      maxX: occluder.x + occluder.radius,
      minZ: occluder.z - occluder.radius,
      maxZ: occluder.z + occluder.radius,
    };
  }
  if (occluder.kind === 'ellipse') {
    // A max-radius square is conservative for every rotation and only affects the
    // broad phase; the exact ellipse test still decides visibility.
    const radius = Math.max(occluder.radiusX, occluder.radiusZ);
    return {
      minX: occluder.x - radius,
      maxX: occluder.x + radius,
      minZ: occluder.z - radius,
      maxZ: occluder.z + radius,
    };
  }
  return {
    minX: Math.min(occluder.ax, occluder.bx) - occluder.radius,
    maxX: Math.max(occluder.ax, occluder.bx) + occluder.radius,
    minZ: Math.min(occluder.az, occluder.bz) - occluder.radius,
    maxZ: Math.max(occluder.az, occluder.bz) + occluder.radius,
  };
}

function createOccluderSpatialIndex(occluders: readonly VisionOccluder[]) {
  const cells = new Map<string, number[]>();
  const marks = new Uint32Array(occluders.length);
  let queryRevision = 0;
  const cellCoordinate = (value: number) => Math.floor(value / OCCLUDER_SPATIAL_CELL_SIZE);
  const cellKey = (x: number, z: number) => `${x}:${z}`;

  occluders.forEach((occluder, index) => {
    const bounds = occluderBounds(occluder);
    const minCellX = cellCoordinate(bounds.minX);
    const maxCellX = cellCoordinate(bounds.maxX);
    const minCellZ = cellCoordinate(bounds.minZ);
    const maxCellZ = cellCoordinate(bounds.maxZ);
    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
        const key = cellKey(cellX, cellZ);
        const bucket = cells.get(key) ?? [];
        bucket.push(index);
        cells.set(key, bucket);
      }
    }
  });

  const forEachCandidate = (
    minX: number,
    minZ: number,
    maxX: number,
    maxZ: number,
    visit: (occluder: VisionOccluder) => boolean,
  ) => {
    queryRevision = (queryRevision + 1) >>> 0;
    if (queryRevision === 0) {
      marks.fill(0);
      queryRevision = 1;
    }

    const minCellX = cellCoordinate(Math.min(minX, maxX));
    const maxCellX = cellCoordinate(Math.max(minX, maxX));
    const minCellZ = cellCoordinate(Math.min(minZ, maxZ));
    const maxCellZ = cellCoordinate(Math.max(minZ, maxZ));

    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ++) {
        const bucket = cells.get(cellKey(cellX, cellZ));
        if (!bucket) continue;
        for (const index of bucket) {
          if (marks[index] === queryRevision) continue;
          marks[index] = queryRevision;
          if (visit(occluders[index])) return true;
        }
      }
    }
    return false;
  };

  return { forEachCandidate };
}

function collectVisionOccluders(scene: THREE.Scene) {
  const occluders: VisionOccluder[] = [];
  const instanceMatrix = new THREE.Matrix4();
  const worldMatrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const worldEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const localCenter = new THREE.Vector3();
  const localSize = new THREE.Vector3();
  const worldCenter = new THREE.Vector3();

  scene.updateMatrixWorld(true);

  scene.traverse((object) => {
    if (object instanceof THREE.InstancedMesh && object.name.startsWith('pine-trunks:')) {
      for (let index = 0; index < object.count; index++) {
        object.getMatrixAt(index, instanceMatrix);
        worldMatrix.multiplyMatrices(object.matrixWorld, instanceMatrix);
        worldMatrix.decompose(position, quaternion, scale);
        occluders.push({
          kind: 'circle',
          x: position.x,
          z: position.z,
          radius: TREE_VISION_RADIUS * Math.max(Math.abs(scale.x), Math.abs(scale.z)),
          minY: position.y,
          maxY: position.y + 4.7 * Math.abs(scale.y),
          fogProjectionPadding: 0.04,
        });
      }
      return;
    }

    if (isStoneRock(object)) {
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      const box = object.geometry.boundingBox;
      if (!box) return;
      box.getSize(localSize);
      if (localSize.y < 0.28 || Math.max(localSize.x, localSize.z) < 0.42) return;
      box.getCenter(localCenter);
      worldCenter.copy(localCenter).applyMatrix4(object.matrixWorld);
      object.getWorldScale(scale);
      object.getWorldQuaternion(quaternion);
      worldEuler.setFromQuaternion(quaternion, 'YXZ');
      const bounds = new THREE.Box3().setFromObject(object);
      occluders.push({
        kind: 'ellipse',
        x: worldCenter.x,
        z: worldCenter.z,
        radiusX: Math.max(0.18, localSize.x * Math.abs(scale.x) * 0.41),
        radiusZ: Math.max(0.18, localSize.z * Math.abs(scale.z) * 0.41),
        cos: Math.cos(worldEuler.y),
        sin: Math.sin(worldEuler.y),
        minY: bounds.min.y,
        maxY: bounds.max.y,
        fogProjectionPadding: 0.06,
      });
      return;
    }

    if (!(object instanceof THREE.Group)) return;
    const authoredRadius = Number(object.userData.collisionRadius ?? 0);
    const name = object.name.toLowerCase();
    if (authoredRadius <= 0 && !(name.endsWith('-tower') || name.endsWith('-defense-tower'))) return;
    const bounds = new THREE.Box3().setFromObject(object);
    if (bounds.isEmpty()) return;
    bounds.getCenter(worldCenter);
    bounds.getSize(localSize);
    const visualRadius = authoredRadius > 0
      ? authoredRadius
      : THREE.MathUtils.clamp(Math.min(localSize.x, localSize.z) * 0.34, 0.65, 1.45);
    occluders.push({
      kind: 'circle',
      x: worldCenter.x,
      z: worldCenter.z,
      radius: visualRadius,
      minY: bounds.min.y,
      maxY: bounds.max.y,
      // Keep the fog almost flush with the rear footprint. This margin only prevents
      // the depth-independent fog plane from tinting the source-facing surface.
      fogProjectionPadding: THREE.MathUtils.clamp(visualRadius * 0.08, 0.06, 0.12),
    });
  });

  addRetainingWallOccluders(occluders);
  addBaseWallOccluders(occluders);
  addObjectiveWallOccluders(occluders);
  return occluders;
}

function addRetainingWallOccluders(occluders: VisionOccluder[]) {
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
        if (isOpening((x1 + x2) * 0.5, (z1 + z2) * 0.5)) continue;
        occluders.push({
          kind: 'segment', ax: x1, az: z1, bx: x2, bz: z2,
          radius: ELEVATION_RADIUS, minY: -0.5, maxY: 2.8,
          fogProjectionPadding: 0.05,
        });
      }
    }
  }
}

function addBaseWallOccluders(occluders: VisionOccluder[]) {
  const segmentCount = 80;
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
      occluders.push({
        kind: 'segment',
        ax: center.x + Math.cos(a) * BASE_LAYOUT.radius,
        az: center.z + Math.sin(a) * BASE_LAYOUT.radius,
        bx: center.x + Math.cos(b) * BASE_LAYOUT.radius,
        bz: center.z + Math.sin(b) * BASE_LAYOUT.radius,
        radius: WALL_RADIUS,
        minY: -0.5,
        maxY: BASE_LAYOUT.elevation + 1.55,
        fogProjectionPadding: 0.06,
      });
    }
  }
}

function addObjectiveWallOccluders(occluders: VisionOccluder[]) {
  const river = sampleMapPath(DAWNREACH_LAYOUT.river);
  const segmentCount = 52;
  for (const pit of DAWNREACH_LAYOUT.objectivePits) {
    let closest = river[0];
    for (const point of river) {
      if (Math.hypot(point.x - pit.x, point.z - pit.z) < Math.hypot(closest.x - pit.x, closest.z - pit.z)) closest = point;
    }
    const entranceAngle = Math.atan2(closest.z - pit.z, closest.x - pit.x);
    for (let index = 0; index < segmentCount; index++) {
      const a = index / segmentCount * Math.PI * 2;
      const b = (index + 1) / segmentCount * Math.PI * 2;
      if (angularDistance((a + b) * 0.5, entranceAngle) < OBJECTIVE_LAYOUT.gateHalfAngle) continue;
      occluders.push({
        kind: 'segment',
        ax: pit.x + Math.cos(a) * OBJECTIVE_LAYOUT.wallRadius,
        az: pit.z + Math.sin(a) * OBJECTIVE_LAYOUT.wallRadius,
        bx: pit.x + Math.cos(b) * OBJECTIVE_LAYOUT.wallRadius,
        bz: pit.z + Math.sin(b) * OBJECTIVE_LAYOUT.wallRadius,
        radius: WALL_RADIUS,
        minY: -0.5,
        maxY: 4.2,
        fogProjectionPadding: 0.06,
      });
    }
  }
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

function createEnvironmentVisionOcclusion(scene: THREE.Scene) {
  const occluders = collectVisionOccluders(scene);
  const spatialIndex = createOccluderSpatialIndex(occluders);

  const traceDistance = (source: WorldPoint3, angle: number, maxDistance: number) => {
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const endX = source.x + dx * maxDistance;
    const endZ = source.z + dz * maxDistance;
    let nearestEntry = maxDistance;
    let nearestOccluder: VisionOccluder | null = null;

    spatialIndex.forEachCandidate(source.x, source.z, endX, endZ, (occluder) => {
      const entry = rayOccluderEntry(occluder, source, dx, dz, nearestEntry);
      if (entry < nearestEntry) {
        nearestEntry = entry;
        nearestOccluder = occluder;
      }
      return false;
    });

    // TypeScript does not track assignments performed inside the callback above, so
    // re-establish the declared union before narrowing it here.
    const resolvedOccluder = nearestOccluder as VisionOccluder | null;
    if (!resolvedOccluder) return maxDistance;

    // Gameplay LOS still stops at the source-facing surface. The fog mask alone is
    // allowed to clear the blocker footprint so the blocker itself remains readable.
    const exit = rayOccluderExit(resolvedOccluder, source, dx, dz, maxDistance);
    if (!Number.isFinite(exit)) return nearestEntry;
    return Math.min(
      maxDistance,
      exit + (resolvedOccluder.fogProjectionPadding ?? 0) + FOG_OCCLUDER_REVEAL_MARGIN,
    );
  };

  const lineOfSight: VisionLineOfSight = (source, target) => {
    const dx = target.x - source.x;
    const dz = target.z - source.z;
    const horizontalDistance = Math.hypot(dx, dz);
    if (horizontalDistance <= VISION_EPSILON) return true;
    const nx = dx / horizontalDistance;
    const nz = dz / horizontalDistance;
    let blocked = false;

    spatialIndex.forEachCandidate(source.x, source.z, target.x, target.z, (occluder) => {
      if (pointInsideOccluder(occluder, source.x, source.z)) return false;
      // An occluder must not block visibility of a target that lies inside that same
      // volume. This is essential for towers/structures: the tower blocks what is behind
      // it, but its own front-facing body is still a valid visible target.
      if (pointInsideOccluder(occluder, target.x, target.z)
        && target.y >= occluder.minY - VISION_EPSILON
        && target.y <= occluder.maxY + VISION_EPSILON) return false;
      const entry = rayOccluderEntry(occluder, source, nx, nz, horizontalDistance);
      if (!Number.isFinite(entry) || entry >= horizontalDistance - VISION_EPSILON) return false;
      const progress = entry / horizontalDistance;
      const sightY = THREE.MathUtils.lerp(source.y, target.y, progress);
      if (sightY < occluder.minY - VISION_EPSILON || sightY > occluder.maxY + VISION_EPSILON) return false;
      blocked = true;
      return true;
    });
    return !blocked;
  };

  return { lineOfSight, traceDistance };
}

function createFogOverlay(
  registry: GameEntityRegistry,
  traceDistance?: (source: WorldPoint3, angle: number, maxDistance: number) => number,
) {
  const scene = findScene(registry.values()[0]?.root);
  if (!scene || typeof document === 'undefined') return null;

  const width = MAP_BOUNDS.maxX - MAP_BOUNDS.minX;
  const height = MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(64, Math.round(width * FOG_PIXELS_PER_WORLD_UNIT));
  canvas.height = Math.max(64, Math.round(height * FOG_PIXELS_PER_WORLD_UNIT));
  const context = canvas.getContext('2d');
  if (!context) return null;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const geometry = new THREE.PlaneGeometry(width, height);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'allied-vision-fog';
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(
    (MAP_BOUNDS.minX + MAP_BOUNDS.maxX) * 0.5,
    0.11,
    (MAP_BOUNDS.minZ + MAP_BOUNDS.maxZ) * 0.5,
  );
  mesh.renderOrder = FOG_RENDER_ORDER;
  mesh.frustumCulled = false;
  scene.add(mesh);

  const sourcePosition = new THREE.Vector3();
  const visibilityCache = new Map<string, FogVisibilityCache>();
  const worldToCanvas = (x: number, z: number) => ({
    x: (x - MAP_BOUNDS.minX) / width * canvas.width,
    y: (z - MAP_BOUNDS.minZ) / height * canvas.height,
  });

  const getVisibilityPoints = (source: GameEntity) => {
    source.root.getWorldPosition(sourcePosition);
    const radius = source.visionRadius;
    const eyeY = sourcePosition.y + source.visionHeight;
    const cached = visibilityCache.get(source.id);
    const moved = !cached
      || Math.hypot(sourcePosition.x - cached.x, sourcePosition.z - cached.z) > FOG_SOURCE_REBUILD_DISTANCE
      || Math.abs(eyeY - cached.y) > FOG_SOURCE_REBUILD_HEIGHT
      || Math.abs(radius - cached.radius) > 1e-4;
    if (!moved && cached) return cached.points;

    const points: Array<{ x: number; z: number }> = [];
    const eye = { x: sourcePosition.x, y: eyeY, z: sourcePosition.z };
    const confinement = getBaseVisionConfinement(source, sourcePosition);
    for (let ray = 0; ray < FOG_VISIBILITY_RAYS; ray++) {
      const angle = ray / FOG_VISIBILITY_RAYS * Math.PI * 2;
      const rayX = Math.cos(angle);
      const rayZ = Math.sin(angle);
      let maxVisibleDistance = radius;
      if (confinement) {
        const boundaryDistance = rayCircleExit(
          sourcePosition.x,
          sourcePosition.z,
          rayX,
          rayZ,
          radius,
          confinement.x,
          confinement.z,
          confinement.radius,
        );
        if (Number.isFinite(boundaryDistance)) {
          maxVisibleDistance = Math.min(maxVisibleDistance, Math.max(0, boundaryDistance - VISION_EPSILON));
        }
      }
      const visibleDistance = traceDistance ? traceDistance(eye, angle, maxVisibleDistance) : maxVisibleDistance;
      points.push({
        x: sourcePosition.x + rayX * visibleDistance,
        z: sourcePosition.z + rayZ * visibleDistance,
      });
    }
    visibilityCache.set(source.id, { x: sourcePosition.x, y: eyeY, z: sourcePosition.z, radius, points });
    return points;
  };

  return {
    update(sources: readonly GameEntity[]) {
      context.globalCompositeOperation = 'source-over';
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = `rgba(5, 10, 15, ${FOG_ALPHA})`;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.globalCompositeOperation = 'destination-out';

      for (const source of sources) {
        source.root.getWorldPosition(sourcePosition);
        const center = worldToCanvas(sourcePosition.x, sourcePosition.z);
        const radius = source.visionRadius * FOG_PIXELS_PER_WORLD_UNIT;
        if (radius <= 0) continue;
        const gradient = context.createRadialGradient(
          center.x, center.y, radius * FOG_INNER_FRACTION,
          center.x, center.y, radius,
        );
        gradient.addColorStop(0, 'rgba(0, 0, 0, 1)');
        gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
        context.fillStyle = gradient;

        const points = getVisibilityPoints(source);
        if (points.length === 0) continue;
        const first = worldToCanvas(points[0].x, points[0].z);
        context.beginPath();
        context.moveTo(first.x, first.y);
        for (let index = 1; index < points.length; index++) {
          const point = worldToCanvas(points[index].x, points[index].z);
          context.lineTo(point.x, point.y);
        }
        context.closePath();
        context.fill();
      }

      context.globalCompositeOperation = 'source-over';
      texture.needsUpdate = true;
    },
  };
}

export function createVisionSystem(
  registry: GameEntityRegistry,
  team: TeamId,
  lineOfSight?: VisionLineOfSight,
): VisionSystem {
  const sourcePosition = new THREE.Vector3();
  const targetPosition = new THREE.Vector3();
  const scene = findScene(registry.values()[0]?.root);
  const environmentOcclusion = scene ? createEnvironmentVisionOcclusion(scene) : null;
  const resolvedLineOfSight = lineOfSight ?? environmentOcclusion?.lineOfSight;
  const fogOverlay = createFogOverlay(registry, environmentOcclusion?.traceDistance);

  const getSources = () => registry.visionSources(team);

  const isPointVisibleAgainst = (sources: readonly GameEntity[], point: VisionPoint, y = 0) => {
    for (const source of sources) {
      source.root.getWorldPosition(sourcePosition);
      const confinement = getBaseVisionConfinement(source, sourcePosition);
      if (confinement && !pointInsideBaseConfinement(point, confinement)) continue;
      const dx = point.x - sourcePosition.x;
      const dz = point.z - sourcePosition.z;
      if (dx * dx + dz * dz > source.visionRadius * source.visionRadius) continue;
      if (!resolvedLineOfSight) return true;
      const from = {
        x: sourcePosition.x,
        y: sourcePosition.y + source.visionHeight,
        z: sourcePosition.z,
      };
      if (resolvedLineOfSight(from, { x: point.x, y, z: point.z })) return true;
    }
    return false;
  };

  const isPointVisible = (point: VisionPoint, y = 0) => isPointVisibleAgainst(getSources(), point, y);

  const isEntityVisibleAgainst = (entity: GameEntity, sources: readonly GameEntity[]) => {
    if (!entity.alive) return false;
    if (entity.team === team) return true;
    if (entity.visibilityPolicy === 'always') return true;
    entity.root.getWorldPosition(targetPosition);
    return isPointVisibleAgainst(
      sources,
      { x: targetPosition.x, z: targetPosition.z },
      targetPosition.y + entity.visionHeight * 0.5,
    );
  };

  const isEntityVisible = (entity: GameEntity) => isEntityVisibleAgainst(entity, getSources());

  const updateEntityVisibility = () => {
    const sources = getSources();
    fogOverlay?.update(sources);

    for (const entity of registry.values()) {
      const visible = isEntityVisibleAgainst(entity, sources);
      entity.revealed = visible;
      entity.root.userData.inVision = visible;
      if (entity.visibilityPolicy === 'vision-only' && entity.team !== team) {
        entity.root.visible = visible;
      } else if (!entity.root.visible && entity.alive) {
        entity.root.visible = true;
      }
    }
  };

  return { team, isPointVisible, isEntityVisible, updateEntityVisibility, getSources };
}
