import * as THREE from 'three';
import type { GameEntityRegistry } from '../../entities/gameEntities';
import { getGameSettingsSnapshot, type GameSettings } from '../../settings/gameSettings';
import {
  disposeAldenAbilityEdgePolishes,
  ensureAldenAbilityEdgePolish,
} from './abilityEdgePolish';
import {
  disposeAldenAbilityPresentations,
  ensureAldenAbilityPresentation,
} from './abilityPresentation';
import {
  disposeWorldLineVfxPolishes,
  ensureWorldLineVfxPolish,
} from './lineVfxPolish';
import {
  ensureAldenWorldAbilityRuntime,
  mountAldenWorldAbilityRuntime,
} from './worldAbilityRuntime';

const LOCAL_WORLD_HERO_ENTITY_ID = 'blue-hero-alden';
const DEFAULT_SHADOW_EXTENT = 24;
const DEFAULT_SHADOW_DISTANCE_PERCENT = 75;

type RendererRender = THREE.WebGLRenderer['render'];

type PresentationPoseGuard = {
  joints: THREE.Object3D[];
  rotations: Float64Array;
};

type ShadowPresentationState = {
  quality: string;
  distancePercent: number;
};

const presentationPoseGuards = new WeakMap<THREE.Object3D, PresentationPoseGuard>();
const rendererLastPresentedAt = new WeakMap<THREE.WebGLRenderer, number>();
const sceneShadowState = new WeakMap<THREE.Scene, ShadowPresentationState>();

function getPresentationPoseGuard(heroRoot: THREE.Object3D): PresentationPoseGuard {
  const cached = presentationPoseGuards.get(heroRoot);
  if (cached) return cached;

  const leftShoulder = heroRoot.getObjectByName('left-shoulder') ?? null;
  const rightShoulder = heroRoot.getObjectByName('right-shoulder') ?? null;
  const candidates = [
    heroRoot.getObjectByName('pelvis') ?? null,
    heroRoot.getObjectByName('torso') ?? null,
    leftShoulder,
    rightShoulder,
    leftShoulder?.getObjectByName('elbow') ?? null,
    rightShoulder?.getObjectByName('elbow') ?? null,
    heroRoot.getObjectByName('right-wrist-attack-pivot') ?? null,
  ];
  const joints = candidates.filter((joint): joint is THREE.Object3D => joint !== null);
  const guard = {
    joints,
    rotations: new Float64Array(joints.length * 3),
  };
  presentationPoseGuards.set(heroRoot, guard);
  return guard;
}

function capturePresentationPose(guard: PresentationPoseGuard) {
  guard.joints.forEach((joint, index) => {
    const offset = index * 3;
    guard.rotations[offset] = joint.rotation.x;
    guard.rotations[offset + 1] = joint.rotation.y;
    guard.rotations[offset + 2] = joint.rotation.z;
  });
}

function restorePresentationPose(guard: PresentationPoseGuard) {
  guard.joints.forEach((joint, index) => {
    const offset = index * 3;
    joint.rotation.x = guard.rotations[offset];
    joint.rotation.y = guard.rotations[offset + 1];
    joint.rotation.z = guard.rotations[offset + 2];
  });
}

function frameIntervalMs(settings: GameSettings) {
  const raw = String(settings['graphics.frameLimit'] ?? 'unlimited');
  if (raw === 'unlimited') return 0;
  const fps = Number(raw);
  return Number.isFinite(fps) && fps > 0 ? 1000 / fps : 0;
}

function shouldPresentFrame(renderer: THREE.WebGLRenderer, nowMs: number, settings: GameSettings) {
  const interval = frameIntervalMs(settings);
  if (interval <= 0) {
    rendererLastPresentedAt.set(renderer, nowMs);
    return true;
  }

  const previous = rendererLastPresentedAt.get(renderer) ?? -Infinity;
  // Small tolerance avoids a nominal 60 FPS cap accidentally presenting at ~30 FPS because
  // requestAnimationFrame can arrive a few tenths of a millisecond before 16.67 ms.
  if (nowMs - previous + 0.35 < interval) return false;
  rendererLastPresentedAt.set(renderer, nowMs);
  return true;
}

function shadowMapSize(quality: string) {
  if (quality === 'low') return 768;
  if (quality === 'medium') return 1024;
  if (quality === 'ultra') return 2048;
  return 1536;
}

function applyShadowSettings(scene: THREE.Scene, renderer: THREE.WebGLRenderer, settings: GameSettings) {
  if (!renderer.shadowMap.enabled) return;
  const quality = String(settings['graphics.shadowQuality'] ?? 'high');
  const rawDistance = Number(settings['graphics.shadowDistance']);
  const distancePercent = Number.isFinite(rawDistance)
    ? THREE.MathUtils.clamp(rawDistance, 25, 100)
    : DEFAULT_SHADOW_DISTANCE_PERCENT;
  const previous = sceneShadowState.get(scene);
  if (previous?.quality === quality && previous.distancePercent === distancePercent) return;

  const size = shadowMapSize(quality);
  const extent = DEFAULT_SHADOW_EXTENT * distancePercent / DEFAULT_SHADOW_DISTANCE_PERCENT;
  scene.traverse((object) => {
    if (!(object instanceof THREE.DirectionalLight) || !object.castShadow) return;
    object.shadow.mapSize.set(size, size);
    const shadowCamera = object.shadow.camera;
    if (shadowCamera instanceof THREE.OrthographicCamera) {
      shadowCamera.left = -extent;
      shadowCamera.right = extent;
      shadowCamera.top = extent;
      shadowCamera.bottom = -extent;
      shadowCamera.updateProjectionMatrix();
    }
    object.shadow.needsUpdate = true;
  });
  renderer.shadowMap.needsUpdate = true;
  sceneShadowState.set(scene, { quality, distancePercent });
}

/**
 * Three.js r180 assigns WebGLRenderer.render directly on every renderer instance from inside
 * the constructor. Patching WebGLRenderer.prototype.render therefore does not intercept the
 * game renderer. Install an inherited setter before any renderer is constructed so the actual
 * instance render function is wrapped at assignment time.
 */
export function mountAldenWorldAbilityBootstrap() {
  const rendererPrototype = THREE.WebGLRenderer.prototype as THREE.WebGLRenderer;
  const previousDescriptor = Object.getOwnPropertyDescriptor(rendererPrototype, 'render');
  const disposeRuntimes = mountAldenWorldAbilityRuntime();
  let disposed = false;

  function interceptRenderAssignment(this: THREE.WebGLRenderer, assignedRender: RendererRender) {
    const renderer = this;
    const wrappedRender: RendererRender = function render(scene, camera) {
      let settings: GameSettings | null = null;
      let shouldPresent = true;

      if (
        !disposed
        && scene instanceof THREE.Scene
        && renderer.domElement.classList.contains('game-canvas')
      ) {
        settings = getGameSettingsSnapshot();
        const registry = scene.userData.entityRegistry as GameEntityRegistry | undefined;
        const hero = registry?.values().find(entity => entity.id === LOCAL_WORLD_HERO_ENTITY_ID) ?? null;
        if (registry && hero) {
          const runtime = ensureAldenWorldAbilityRuntime(
            scene,
            registry,
            hero,
            renderer.domElement,
            camera,
          );
          const presentation = ensureAldenAbilityPresentation(
            scene,
            registry,
            hero,
            renderer.domElement,
            camera,
          );
          const edgePolish = ensureAldenAbilityEdgePolish(scene);
          const linePolish = ensureWorldLineVfxPolish(scene);
          if (renderer.getRenderTarget() === null) {
            const nowMs = performance.now();
            runtime.update(nowMs);

            // abilityPresentation owns VFX only. Its legacy pose layer used additive Euler
            // rotations every rendered frame, so Q permanently pitched the pelvis forward and
            // each later cast compounded the error. Preserve the authoritative pose produced by
            // animateAlden/worldAbilityRuntime while presentation updates its VFX.
            const poseGuard = getPresentationPoseGuard(hero.root);
            capturePresentationPose(poseGuard);
            presentation.update(nowMs);
            restorePresentationPose(poseGuard);

            edgePolish.update();
            linePolish.update();
            applyShadowSettings(scene, renderer, settings);
            shouldPresent = shouldPresentFrame(renderer, nowMs, settings);
          }
        }
      }

      if (!shouldPresent) return;
      return assignedRender.call(renderer, scene, camera);
    };

    Object.defineProperty(renderer, 'render', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: wrappedRender,
    });
  }

  Object.defineProperty(rendererPrototype, 'render', {
    configurable: true,
    enumerable: previousDescriptor?.enumerable ?? false,
    set: interceptRenderAssignment,
    get: previousDescriptor?.get
      ? function getRender(this: THREE.WebGLRenderer) {
        return previousDescriptor.get?.call(this) as RendererRender | undefined;
      }
      : function getRender() {
        return previousDescriptor?.value as RendererRender | undefined;
      },
  });

  return () => {
    disposed = true;
    disposeWorldLineVfxPolishes();
    disposeAldenAbilityEdgePolishes();
    disposeAldenAbilityPresentations();
    disposeRuntimes();
    if (previousDescriptor) Object.defineProperty(rendererPrototype, 'render', previousDescriptor);
    else delete (rendererPrototype as Partial<THREE.WebGLRenderer>).render;
  };
}
