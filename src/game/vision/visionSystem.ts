import * as THREE from 'three';
import type { GameEntity, GameEntityRegistry, TeamId } from '../entities/gameEntities';
import { MAP_BOUNDS } from '../map/mapLayout';

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
const FOG_VISIBILITY_RAYS = 128;
const FOG_SOURCE_REBUILD_DISTANCE = 0.10;
const FOG_SOURCE_REBUILD_HEIGHT = 0.08;
const FOG_RAY_ORIGIN_MIN_LIFT = 0.62;
const FOG_RAY_ORIGIN_MAX_LIFT = 0.96;
const OCCLUSION_HIT_EPSILON = 0.075;

const OCCLUDER_NAME_PATTERN = /(?:^|[-_:])(wall|walls|retaining|cliff|cliffs|ruin|ruins|rock|rocks|boulder|boulders|barrier|barriers|rampart|ramparts|citadel)(?:$|[-_:])/;

type WorldPoint3 = Readonly<{ x: number; y: number; z: number }>;
type FogTraceDistance = (source: WorldPoint3, angle: number, maxDistance: number) => number;

type FogVisibilityCache = {
  x: number;
  y: number;
  z: number;
  radius: number;
  points: Array<{ x: number; z: number }>;
};

type EnvironmentVisionOcclusion = {
  lineOfSight: VisionLineOfSight;
  traceDistance: FogTraceDistance;
  occluderCount: number;
};

function findScene(object: THREE.Object3D | undefined) {
  let current = object;
  while (current?.parent) current = current.parent;
  return current instanceof THREE.Scene ? current : null;
}

function hasOccluderAncestor(object: THREE.Object3D) {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (OCCLUDER_NAME_PATTERN.test(current.name.toLowerCase())) return true;
    current = current.parent;
  }
  return false;
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

function isEnvironmentVisionOccluder(object: THREE.Object3D) {
  if (!(object instanceof THREE.Mesh || object instanceof THREE.InstancedMesh)) return false;
  if (object.userData.blocksVision === false) return false;
  if (object.userData.blocksVision === true || object.userData.visionOccluder === true
    || object.userData.collisionBarrier === true || object.userData.collisionRock === true) return true;

  const name = object.name.toLowerCase();
  if (object instanceof THREE.InstancedMesh
    && (name.startsWith('pine-crowns:') || name.startsWith('pine-trunks:'))) return true;
  if (isStoneRock(object)) return true;
  return hasOccluderAncestor(object);
}

function createEnvironmentVisionOcclusion(scene: THREE.Scene): EnvironmentVisionOcclusion {
  const occluders: THREE.Object3D[] = [];
  scene.updateMatrixWorld(true);
  scene.traverse((object) => {
    if (isEnvironmentVisionOccluder(object)) occluders.push(object);
  });

  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();

  const firstHitDistance = (from: WorldPoint3, dirX: number, dirY: number, dirZ: number, maxDistance: number) => {
    if (maxDistance <= OCCLUSION_HIT_EPSILON || occluders.length === 0) return maxDistance;
    origin.set(from.x, from.y, from.z);
    direction.set(dirX, dirY, dirZ);
    const length = direction.length();
    if (length <= 1e-7) return maxDistance;
    direction.multiplyScalar(1 / length);
    raycaster.set(origin, direction);
    raycaster.near = OCCLUSION_HIT_EPSILON;
    raycaster.far = Math.max(OCCLUSION_HIT_EPSILON, maxDistance - OCCLUSION_HIT_EPSILON);
    const hit = raycaster.intersectObjects(occluders, false)[0];
    return hit ? Math.max(0, hit.distance - OCCLUSION_HIT_EPSILON) : maxDistance;
  };

  const lineOfSight: VisionLineOfSight = (source, target) => {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const dz = target.z - source.z;
    const distance = Math.hypot(dx, dy, dz);
    if (distance <= OCCLUSION_HIT_EPSILON) return true;
    return firstHitDistance(source, dx, dy, dz, distance) >= distance - OCCLUSION_HIT_EPSILON * 2;
  };

  const traceDistance: FogTraceDistance = (source, angle, maxDistance) => firstHitDistance(
    source,
    Math.cos(angle),
    0,
    Math.sin(angle),
    maxDistance,
  );

  return { lineOfSight, traceDistance, occluderCount: occluders.length };
}

function createFogOverlay(registry: GameEntityRegistry, traceDistance?: FogTraceDistance) {
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
    const eyeLift = THREE.MathUtils.clamp(
      source.visionHeight * 0.52,
      FOG_RAY_ORIGIN_MIN_LIFT,
      FOG_RAY_ORIGIN_MAX_LIFT,
    );
    const eyeY = sourcePosition.y + eyeLift;
    const cached = visibilityCache.get(source.id);
    const moved = !cached
      || Math.hypot(sourcePosition.x - cached.x, sourcePosition.z - cached.z) > FOG_SOURCE_REBUILD_DISTANCE
      || Math.abs(eyeY - cached.y) > FOG_SOURCE_REBUILD_HEIGHT
      || Math.abs(radius - cached.radius) > 1e-4;
    if (!moved && cached) return cached.points;

    const points: Array<{ x: number; z: number }> = [];
    const eye = { x: sourcePosition.x, y: eyeY, z: sourcePosition.z };
    for (let ray = 0; ray < FOG_VISIBILITY_RAYS; ray++) {
      const angle = ray / FOG_VISIBILITY_RAYS * Math.PI * 2;
      const visibleDistance = traceDistance ? traceDistance(eye, angle, radius) : radius;
      points.push({
        x: sourcePosition.x + Math.cos(angle) * visibleDistance,
        z: sourcePosition.z + Math.sin(angle) * visibleDistance,
      });
    }
    visibilityCache.set(source.id, {
      x: sourcePosition.x,
      y: eyeY,
      z: sourcePosition.z,
      radius,
      points,
    });
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
          center.x,
          center.y,
          radius * FOG_INNER_FRACTION,
          center.x,
          center.y,
          radius,
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
      const dx = point.x - sourcePosition.x;
      const dz = point.z - sourcePosition.z;
      if (dx * dx + dz * dz > source.visionRadius * source.visionRadius) continue;
      if (!resolvedLineOfSight) return true;

      const from = {
        x: sourcePosition.x,
        y: sourcePosition.y + source.visionHeight,
        z: sourcePosition.z,
      };
      const to = { x: point.x, y, z: point.z };
      if (resolvedLineOfSight(from, to)) return true;
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

      // Living/dynamic entities vanish completely outside allied vision. Structures remain
      // present so the transparent fog can preserve their static silhouette. Animated or
      // emissive structure effects can later be tagged as vision-only child entities.
      if (entity.visibilityPolicy === 'vision-only' && entity.team !== team) {
        entity.root.visible = visible;
      } else if (!entity.root.visible && entity.alive) {
        entity.root.visible = true;
      }
    }
  };

  return {
    team,
    isPointVisible,
    isEntityVisible,
    updateEntityVisibility,
    getSources,
  };
}
