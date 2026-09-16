import * as THREE from 'three';
import type { GameEntityRegistry } from '../../entities/gameEntities';
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

type RendererRender = THREE.WebGLRenderer['render'];

type PresentationPoseGuard = {
  joints: THREE.Object3D[];
  rotations: Float64Array;
};

const presentationPoseGuards = new WeakMap<THREE.Object3D, PresentationPoseGuard>();

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
      if (
        !disposed
        && scene instanceof THREE.Scene
        && renderer.domElement.classList.contains('game-canvas')
      ) {
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
            // each later cast compounded the error (the visible "sitting in the air" pose).
            // Preserve the authoritative pose produced by animateAlden/worldAbilityRuntime,
            // allow presentation to spawn/update VFX, then restore those joint rotations before
            // the frame is rendered. This also prevents W/E/R from accumulating pose residue.
            const poseGuard = getPresentationPoseGuard(hero.root);
            capturePresentationPose(poseGuard);
            presentation.update(nowMs);
            restorePresentationPose(poseGuard);

            edgePolish.update();
            linePolish.update();
          }
        }
      }
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
