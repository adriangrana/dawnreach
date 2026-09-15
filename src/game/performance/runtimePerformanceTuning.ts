import * as THREE from 'three';

const MAX_DEVICE_PIXEL_RATIO = 1.5;
const SHADOW_REFRESH_INTERVAL_MS = 1000 / 30;
const MINIMAP_RENDER_INTERVAL_MS = 250;

const DECORATIVE_POINT_LIGHT_PARENT_NAMES = new Set([
  'blue-shop',
  'red-shop',
  'blue-team-start-fountain',
  'red-team-start-fountain',
  'team-start-gate-pylon',
  'teleport-light-column',
]);

type RendererTimingState = {
  lastShadowRefreshAt: number;
  lastMinimapRenderAt: number;
  shadowSchedulingInitialized: boolean;
};

const rendererTiming = new WeakMap<THREE.WebGLRenderer, RendererTimingState>();

function timingFor(renderer: THREE.WebGLRenderer) {
  let state = rendererTiming.get(renderer);
  if (!state) {
    state = {
      lastShadowRefreshAt: -Infinity,
      lastMinimapRenderAt: -Infinity,
      shadowSchedulingInitialized: false,
    };
    rendererTiming.set(renderer, state);
  }
  return state;
}

function isDecorativePointLightParent(object: THREE.Object3D) {
  if (DECORATIVE_POINT_LIGHT_PARENT_NAMES.has(object.name)) return true;
  return object.name.endsWith('-team-start-fountain');
}

/**
 * Installs narrow Three.js runtime tuning before the Dawnreach scene is constructed.
 *
 * The world uses emissive materials for the visible glow on shops, fountain crystals,
 * pylons and teleport portals. Their local PointLights are therefore decorative rather
 * than gameplay-critical, while every visible point light expands the lighting work of
 * MeshStandard/Physical shaders across the scene. Suppressing only those known decorative
 * lights keeps the authored glow while avoiding a high global per-fragment lighting cost
 * and, importantly, avoids first-use shader permutations when the TP portals appear.
 *
 * Directional shadows remain enabled, but the shadow map is refreshed at 30 Hz while the
 * beauty pass can run at the monitor refresh rate. This is a common split for an isometric
 * game: camera/units stay fluid while soft shadows do not need 120+ updates per second.
 */
export function installRuntimePerformanceTuning() {
  const rendererPrototype = THREE.WebGLRenderer.prototype;
  const objectPrototype = THREE.Object3D.prototype;

  const originalSetPixelRatio = rendererPrototype.setPixelRatio;
  const originalRender = rendererPrototype.render;
  const originalAdd = objectPrototype.add;

  rendererPrototype.setPixelRatio = function setPixelRatio(value: number) {
    return originalSetPixelRatio.call(this, Math.min(value, MAX_DEVICE_PIXEL_RATIO));
  };

  objectPrototype.add = function add(...objects: THREE.Object3D[]) {
    if (isDecorativePointLightParent(this)) {
      for (const object of objects) {
        if (!(object instanceof THREE.PointLight)) continue;
        object.visible = false;
        object.intensity = 0;
        object.userData.dawnreachDecorativeLightDisabled = true;
      }
    }
    return originalAdd.apply(this, objects);
  };

  rendererPrototype.render = function render(scene: THREE.Object3D, camera: THREE.Camera) {
    const state = timingFor(this);
    const now = performance.now();
    const canvas = this.domElement;

    if (canvas.classList.contains('minimap-canvas')) {
      if (now - state.lastMinimapRenderAt < MINIMAP_RENDER_INTERVAL_MS) return;
      state.lastMinimapRenderAt = now;
      return originalRender.call(this, scene, camera);
    }

    if (canvas.classList.contains('game-canvas') && this.shadowMap.enabled) {
      const renderingOffscreen = this.getRenderTarget() !== null;

      if (!state.shadowSchedulingInitialized) {
        // Three defaults to rebuilding the whole directional shadow atlas on every beauty
        // frame. Dawnreach has mostly static world geometry, so explicit scheduling is much
        // cheaper and still keeps moving-unit shadows responsive.
        this.shadowMap.autoUpdate = false;
        this.shadowMap.needsUpdate = true;
        state.shadowSchedulingInitialized = true;
      }

      if (renderingOffscreen) {
        // Loading warmups must still compile/upload the shadow variants, but should not
        // consume the cadence slot for the first visible gameplay frame.
        this.shadowMap.needsUpdate = true;
      } else if (now - state.lastShadowRefreshAt >= SHADOW_REFRESH_INTERVAL_MS) {
        this.shadowMap.needsUpdate = true;
        state.lastShadowRefreshAt = now;
      }
    }

    return originalRender.call(this, scene, camera);
  };

  return () => {
    rendererPrototype.setPixelRatio = originalSetPixelRatio;
    rendererPrototype.render = originalRender;
    objectPrototype.add = originalAdd;
  };
}
