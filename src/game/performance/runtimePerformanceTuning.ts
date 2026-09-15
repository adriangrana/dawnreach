import * as THREE from 'three';

const MAX_DEVICE_PIXEL_RATIO = 1.5;
const MINIMAP_RENDER_SCALE = 0.8;
const SHADOW_REFRESH_INTERVAL_MS = 1000 / 30;
const SHADOW_MAP_SIZE = 1536;

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
  shadowSchedulingInitialized: boolean;
  shadowAtlasConfigured: boolean;
};

const rendererTiming = new WeakMap<THREE.WebGLRenderer, RendererTimingState>();

function timingFor(renderer: THREE.WebGLRenderer) {
  let state = rendererTiming.get(renderer);
  if (!state) {
    state = {
      lastShadowRefreshAt: -Infinity,
      shadowSchedulingInitialized: false,
      shadowAtlasConfigured: false,
    };
    rendererTiming.set(renderer, state);
  }
  return state;
}

function isDecorativePointLightParent(object: THREE.Object3D) {
  if (DECORATIVE_POINT_LIGHT_PARENT_NAMES.has(object.name)) return true;
  return object.name.endsWith('-team-start-fountain');
}

function configureDirectionalShadowAtlases(scene: THREE.Object3D) {
  scene.traverse((object) => {
    if (!(object instanceof THREE.DirectionalLight) || !object.castShadow) return;
    object.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    object.shadow.needsUpdate = true;
  });
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
 * Directional shadows remain enabled, but their atlas is slightly smaller and refreshed
 * at 30 Hz while the beauty pass can run at the monitor refresh rate. The minimap keeps
 * its live cadence but renders to a smaller internal surface before CSS scales it to the
 * HUD size, avoiding another full-resolution scene pass.
 */
export function installRuntimePerformanceTuning() {
  const rendererPrototype = THREE.WebGLRenderer.prototype;
  const objectPrototype = THREE.Object3D.prototype;

  const originalSetPixelRatio = rendererPrototype.setPixelRatio;
  const originalSetSize = rendererPrototype.setSize;
  const originalRender = rendererPrototype.render;
  const originalAdd = objectPrototype.add;

  rendererPrototype.setPixelRatio = function setPixelRatio(value: number) {
    return originalSetPixelRatio.call(this, Math.min(value, MAX_DEVICE_PIXEL_RATIO));
  };

  rendererPrototype.setSize = function setSize(width: number, height: number, updateStyle?: boolean) {
    if (this.domElement.classList.contains('minimap-canvas')) {
      return originalSetSize.call(
        this,
        Math.max(1, Math.round(width * MINIMAP_RENDER_SCALE)),
        Math.max(1, Math.round(height * MINIMAP_RENDER_SCALE)),
        updateStyle,
      );
    }
    return originalSetSize.call(this, width, height, updateStyle);
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
    return originalAdd.call(this, ...objects);
  };

  rendererPrototype.render = function render(scene: THREE.Object3D, camera: THREE.Camera) {
    const state = timingFor(this);
    const now = performance.now();
    const canvas = this.domElement;

    if (canvas.classList.contains('game-canvas') && this.shadowMap.enabled) {
      const renderingOffscreen = this.getRenderTarget() !== null;

      if (!state.shadowAtlasConfigured) {
        configureDirectionalShadowAtlases(scene);
        state.shadowAtlasConfigured = true;
      }

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
    rendererPrototype.setSize = originalSetSize;
    rendererPrototype.render = originalRender;
    objectPrototype.add = originalAdd;
  };
}
