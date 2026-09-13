import * as THREE from 'three';
import type { GameEntity, GameEntityRegistry, TeamId } from '../entities/gameEntities';

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

export function createVisionSystem(
  registry: GameEntityRegistry,
  team: TeamId,
  lineOfSight?: VisionLineOfSight,
): VisionSystem {
  const sourcePosition = new THREE.Vector3();
  const targetPosition = new THREE.Vector3();

  const getSources = () => registry.visionSources(team);

  const isPointVisible = (point: VisionPoint, y = 0) => {
    for (const source of getSources()) {
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

  const isEntityVisible = (entity: GameEntity) => {
    if (!entity.alive) return false;
    if (entity.team === team) return true;
    if (entity.visibilityPolicy === 'always') return true;
    entity.root.getWorldPosition(targetPosition);
    return isPointVisible({ x: targetPosition.x, z: targetPosition.z }, targetPosition.y + entity.visionHeight * 0.5);
  };

  const updateEntityVisibility = () => {
    for (const entity of registry.values()) {
      const visible = isEntityVisible(entity);
      entity.revealed = visible;
      entity.root.userData.inVision = visible;

      // Living/dynamic entities vanish completely outside allied vision. Structures remain
      // present so the fog renderer can still show their static silhouette while suppressing
      // active effects separately.
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
