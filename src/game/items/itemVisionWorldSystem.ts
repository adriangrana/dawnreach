import * as THREE from 'three';
import type { GameEntity, GameEntityRegistry, TeamId } from '../entities/gameEntities';
import {
  getWardOwnerEntityId,
  getWardType,
  markWardRevealCredit,
} from './wardGameplay';
import { ensureWardPlacementSystem } from './wardPlacementSystem';

export type ItemVisionWorldSystem = Readonly<{ dispose(): void }>;

const SYSTEM_KEY = 'dawnreachItemVisionWorldSystem';
const DETECTED_BLUE_KEY = 'dawnreachItemDetectedBlueUntilMs';
const DETECTED_RED_KEY = 'dawnreachItemDetectedRedUntilMs';
const TOWER_TRUE_SIGHT_BLUE_KEY = 'dawnreachTrueSightBlue';
const TOWER_TRUE_SIGHT_RED_KEY = 'dawnreachTrueSightRed';
const ITEM_TRUE_SIGHT_BLUE_KEY = 'dawnreachItemTrueSightBlue';
const ITEM_TRUE_SIGHT_RED_KEY = 'dawnreachItemTrueSightRed';
const BASE_TARGETABLE_KEY = 'dawnreachInvisibleBaseTargetable';

let disposeActiveVisionSystem: (() => void) | null = null;
const sourcePosition = new THREE.Vector3();
const targetPosition = new THREE.Vector3();

function numeric(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getViewerTeam(scene: THREE.Scene): TeamId {
  const vision = scene.userData.visionSystem as { team?: TeamId } | undefined;
  return vision?.team === 'red' ? 'red' : 'blue';
}

function planarDistanceSquared(a: THREE.Vector3, b: THREE.Vector3) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

function clearItemTrueSight(entities: readonly GameEntity[]) {
  for (const entity of entities) {
    entity.root.userData[ITEM_TRUE_SIGHT_BLUE_KEY] = false;
    entity.root.userData[ITEM_TRUE_SIGHT_RED_KEY] = false;
  }
}

function projectSentryTrueSight(entities: readonly GameEntity[]) {
  clearItemTrueSight(entities);

  for (const source of entities) {
    if (!source.alive || source.currentHp <= 0 || getWardType(source) !== 'sentry') continue;
    if (source.team !== 'blue' && source.team !== 'red') continue;

    const radius = Math.max(0, Number(source.root.userData.trueSightRadius ?? source.visionRadius));
    if (radius <= 0) continue;
    const radiusSquared = radius * radius;
    const key = source.team === 'blue' ? ITEM_TRUE_SIGHT_BLUE_KEY : ITEM_TRUE_SIGHT_RED_KEY;
    const ownerEntityId = getWardOwnerEntityId(source);
    source.root.getWorldPosition(sourcePosition);

    for (const candidate of entities) {
      if (!candidate.alive || candidate.currentHp <= 0) continue;
      if (candidate.team === source.team || candidate.team === 'neutral') continue;
      if (candidate.root.userData.invisible !== true) continue;

      candidate.root.getWorldPosition(targetPosition);
      if (planarDistanceSquared(sourcePosition, targetPosition) > radiusSquared) continue;
      candidate.root.userData[key] = true;
      if (ownerEntityId) markWardRevealCredit(candidate, source.team, ownerEntityId);
    }
  }
}

function syncInvisibleTargetability(entity: GameEntity, visible: boolean) {
  if (typeof entity.root.userData[BASE_TARGETABLE_KEY] !== 'boolean') {
    entity.root.userData[BASE_TARGETABLE_KEY] = entity.targetable;
  }
  const baseTargetable = entity.root.userData[BASE_TARGETABLE_KEY] === true;
  entity.targetable = baseTargetable && visible;
}

export function ensureItemVisionWorldSystem(
  scene: THREE.Scene,
  registry: GameEntityRegistry,
): ItemVisionWorldSystem {
  const existing = scene.userData[SYSTEM_KEY] as ItemVisionWorldSystem | undefined;
  if (existing) return existing;

  disposeActiveVisionSystem?.();
  let disposed = false;
  const wardPlacementSystem = ensureWardPlacementSystem(scene, registry);

  const previousSceneBeforeRender = scene.onBeforeRender;
  const beforeRender: typeof scene.onBeforeRender = function(
    renderer,
    renderedScene,
    camera,
    geometry,
    material,
    group,
  ) {
    const minimapCamera = camera.position.y > 60 && camera.up.z < -0.5;
    if (!minimapCamera) {
      const entities = registry.values();
      projectSentryTrueSight(entities);

      const viewerTeam = getViewerTeam(scene);
      const detectedKey = viewerTeam === 'red' ? DETECTED_RED_KEY : DETECTED_BLUE_KEY;
      const towerTrueSightKey = viewerTeam === 'red' ? TOWER_TRUE_SIGHT_RED_KEY : TOWER_TRUE_SIGHT_BLUE_KEY;
      const itemTrueSightKey = viewerTeam === 'red' ? ITEM_TRUE_SIGHT_RED_KEY : ITEM_TRUE_SIGHT_BLUE_KEY;
      const nowMs = performance.now();

      for (const entity of entities) {
        if (!entity.alive || entity.team === viewerTeam || entity.team === 'neutral') continue;
        if (entity.root.userData.invisible !== true) continue;

        // True Sight detects invisibility but does not itself create ordinary fog vision.
        // The target must still be inside normal line of sight from a hero/creep/observer.
        const inLineOfSight = entity.root.userData.inVision === true;
        const detected = numeric(entity.root.userData[detectedKey], 0) > nowMs;
        const towerTrueSight = entity.root.userData[towerTrueSightKey] === true;
        const itemTrueSight = entity.root.userData[itemTrueSightKey] === true;
        const visible = inLineOfSight && (detected || towerTrueSight || itemTrueSight);
        entity.revealed = visible;
        syncInvisibleTargetability(entity, visible);
        if (entity.visibilityPolicy === 'vision-only') entity.root.visible = visible;
      }
    }

    previousSceneBeforeRender.call(this, renderer, renderedScene, camera, geometry, material, group);
  };
  scene.onBeforeRender = beforeRender;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (scene.onBeforeRender === beforeRender) scene.onBeforeRender = previousSceneBeforeRender;
    wardPlacementSystem.dispose();
    delete scene.userData[SYSTEM_KEY];
    if (disposeActiveVisionSystem === dispose) disposeActiveVisionSystem = null;
  };
  scene.userData[SYSTEM_KEY] = { dispose } satisfies ItemVisionWorldSystem;
  disposeActiveVisionSystem = dispose;
  return scene.userData[SYSTEM_KEY] as ItemVisionWorldSystem;
}
