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

function findScene(object: THREE.Object3D | undefined) {
  let current = object;
  while (current?.parent) current = current.parent;
  return current instanceof THREE.Scene ? current : null;
}

function createFogOverlay(registry: GameEntityRegistry) {
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
  const worldToCanvas = (x: number, z: number) => ({
    x: (x - MAP_BOUNDS.minX) / width * canvas.width,
    y: (z - MAP_BOUNDS.minZ) / height * canvas.height,
  });

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
        context.beginPath();
        context.arc(center.x, center.y, radius, 0, Math.PI * 2);
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
  const fogOverlay = createFogOverlay(registry);

  const getSources = () => registry.visionSources(team);

  const isPointVisibleAgainst = (sources: readonly GameEntity[], point: VisionPoint, y = 0) => {
    for (const source of sources) {
      source.root.getWorldPosition(sourcePosition);
      const dx = point.x - sourcePosition.x;
      const dz = point.z - sourcePosition.z;
      if (dx * dx + dz * dz > source.visionRadius * source.visionRadius) continue;
      if (!lineOfSight) return true;

      const from = {
        x: sourcePosition.x,
        y: sourcePosition.y + source.visionHeight,
        z: sourcePosition.z,
      };
      const to = { x: point.x, y, z: point.z };
      if (lineOfSight(from, to)) return true;
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
