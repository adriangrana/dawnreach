import * as THREE from 'three';
import type { GameEntityRegistry, TeamId } from '../entities/gameEntities';

export type ItemVisionWorldSystem = Readonly<{ dispose(): void }>;

const SYSTEM_KEY = 'dawnreachItemVisionWorldSystem';
const DETECTED_BLUE_KEY = 'dawnreachItemDetectedBlueUntilMs';
const DETECTED_RED_KEY = 'dawnreachItemDetectedRedUntilMs';
const TRUE_SIGHT_BLUE_KEY = 'dawnreachTrueSightBlue';
const TRUE_SIGHT_RED_KEY = 'dawnreachTrueSightRed';

let disposeActiveVisionSystem: (() => void) | null = null;

function numeric(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function getViewerTeam(scene: THREE.Scene): TeamId {
  const vision = scene.userData.visionSystem as { team?: TeamId } | undefined;
  return vision?.team === 'red' ? 'red' : 'blue';
}

export function ensureItemVisionWorldSystem(
  scene: THREE.Scene,
  registry: GameEntityRegistry,
): ItemVisionWorldSystem {
  const existing = scene.userData[SYSTEM_KEY] as ItemVisionWorldSystem | undefined;
  if (existing) return existing;

  disposeActiveVisionSystem?.();
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
      const viewerTeam = getViewerTeam(scene);
      const detectedKey = viewerTeam === 'red' ? DETECTED_RED_KEY : DETECTED_BLUE_KEY;
      const trueSightKey = viewerTeam === 'red' ? TRUE_SIGHT_RED_KEY : TRUE_SIGHT_BLUE_KEY;
      const nowMs = performance.now();

      for (const entity of registry.values()) {
        if (!entity.alive || entity.team === viewerTeam || entity.team === 'neutral') continue;
        if (entity.root.userData.invisible !== true) continue;

        // The base vision system writes inVision before this presentation pass. Detection
        // never grants sight through fog; it only reveals an invisible unit already inside
        // ordinary line of sight, or one covered by tower True Sight.
        const inLineOfSight = entity.root.userData.inVision === true;
        const detected = numeric(entity.root.userData[detectedKey], 0) > nowMs;
        const trueSight = entity.root.userData[trueSightKey] === true;
        const visible = inLineOfSight && (detected || trueSight);
        entity.revealed = visible;
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
    delete scene.userData[SYSTEM_KEY];
    if (disposeActiveVisionSystem === dispose) disposeActiveVisionSystem = null;
  };

  const system: ItemVisionWorldSystem = { dispose };
  scene.userData[SYSTEM_KEY] = system;
  disposeActiveVisionSystem = dispose;
  return system;
}
