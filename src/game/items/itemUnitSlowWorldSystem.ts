import * as THREE from 'three';
import type { GameEntityRegistry } from '../entities/gameEntities';

export type ItemUnitSlowWorldSystem = Readonly<{ dispose(): void }>;

const SYSTEM_KEY = 'dawnreachItemUnitSlowWorldSystem';
const WORLD_STATUS_KEY = 'dawnreachItemWorldStatuses';
let disposeActiveSystem: (() => void) | null = null;

type WorldItemStatus = {
  expiresAtMs: number;
  slowPercent?: number;
};

type MotionSample = {
  position: THREE.Vector3;
};

function slowMultiplier(root: THREE.Object3D, nowMs: number) {
  const statuses = root.userData[WORLD_STATUS_KEY] as Record<string, WorldItemStatus> | undefined;
  if (!statuses) return 1;
  let strongest = 0;
  for (const [id, status] of Object.entries(statuses)) {
    if (status.expiresAtMs <= nowMs) {
      delete statuses[id];
      continue;
    }
    strongest = Math.max(strongest, Math.max(0, status.slowPercent ?? 0));
  }
  return Math.max(0.12, 1 - strongest / 100);
}

export function ensureItemUnitSlowWorldSystem(
  scene: THREE.Scene,
  registry: GameEntityRegistry,
): ItemUnitSlowWorldSystem {
  const existing = scene.userData[SYSTEM_KEY] as ItemUnitSlowWorldSystem | undefined;
  if (existing) return existing;
  disposeActiveSystem?.();

  const samples = new Map<string, MotionSample>();
  const worldPosition = new THREE.Vector3();
  const localPosition = new THREE.Vector3();
  let disposed = false;

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
      const nowMs = performance.now();
      for (const entity of registry.values()) {
        if (!entity.alive || !entity.root.parent) continue;
        if (entity.kind !== 'creep' && entity.kind !== 'jungle-creature') continue;

        entity.root.getWorldPosition(worldPosition);
        const sample = samples.get(entity.id);
        if (!sample) {
          samples.set(entity.id, { position: worldPosition.clone() });
          continue;
        }

        const multiplier = slowMultiplier(entity.root, nowMs);
        const dx = worldPosition.x - sample.position.x;
        const dz = worldPosition.z - sample.position.z;
        const moved = Math.hypot(dx, dz);
        if (moved > 0.0001 && moved < 2.5 && multiplier < 0.999) {
          const corrected = worldPosition.clone();
          corrected.x = sample.position.x + dx * multiplier;
          corrected.z = sample.position.z + dz * multiplier;
          localPosition.copy(corrected);
          entity.root.parent.worldToLocal(localPosition);
          entity.root.position.x = localPosition.x;
          entity.root.position.z = localPosition.z;
          entity.root.getWorldPosition(worldPosition);
        }
        sample.position.copy(worldPosition);
      }
    }

    previousSceneBeforeRender.call(this, renderer, renderedScene, camera, geometry, material, group);
  };
  scene.onBeforeRender = beforeRender;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (scene.onBeforeRender === beforeRender) scene.onBeforeRender = previousSceneBeforeRender;
    samples.clear();
    delete scene.userData[SYSTEM_KEY];
    if (disposeActiveSystem === dispose) disposeActiveSystem = null;
  };

  const system: ItemUnitSlowWorldSystem = { dispose };
  scene.userData[SYSTEM_KEY] = system;
  disposeActiveSystem = dispose;
  return system;
}
