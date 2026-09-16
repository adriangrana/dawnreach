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
            presentation.update(nowMs);
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
