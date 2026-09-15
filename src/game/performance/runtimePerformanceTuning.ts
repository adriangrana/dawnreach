import * as THREE from 'three';

const MAX_DEVICE_PIXEL_RATIO = 1.5;
const MINIMAP_RENDER_SCALE = 0.8;
const MOVING_SHADOW_REFRESH_INTERVAL_MS = 1000 / 15;
const IDLE_SHADOW_REFRESH_INTERVAL_MS = 1000 / 6;
const SHADOW_MAP_SIZE = 1536;
const CAMERA_MOVE_EPSILON_SQ = 0.0004;

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
  sceneShadowCastersConfigured: boolean;
  baseStaticBatchesConfigured: boolean;
  lastCameraPosition: THREE.Vector3;
  cameraPositionInitialized: boolean;
};

const rendererTiming = new WeakMap<THREE.WebGLRenderer, RendererTimingState>();

function timingFor(renderer: THREE.WebGLRenderer) {
  let state = rendererTiming.get(renderer);
  if (!state) {
    state = {
      lastShadowRefreshAt: -Infinity,
      shadowSchedulingInitialized: false,
      shadowAtlasConfigured: false,
      sceneShadowCastersConfigured: false,
      baseStaticBatchesConfigured: false,
      lastCameraPosition: new THREE.Vector3(),
      cameraPositionInitialized: false,
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

function configureKnownShadowCasters(scene: THREE.Object3D) {
  scene.traverse((object) => {
    // Pine crowns provide essentially all of the readable forest shadow silhouette.
    // Rendering the narrow trunk batches into the atlas duplicates draw work for a detail
    // that is almost completely hidden under those crowns from the gameplay camera.
    if (object.name.startsWith('pine-trunks:')) object.castShadow = false;
  });
}

function batchBaseElevationWalls(scene: THREE.Object3D) {
  const baseGroups: THREE.Group[] = [];
  scene.traverse((object) => {
    if (!(object instanceof THREE.Group)) return;
    if (object.name === 'blue-base-elevation' || object.name === 'red-base-elevation') {
      baseGroups.push(object);
    }
  });

  for (const base of baseGroups) {
    const byMaterial = new Map<THREE.Material, THREE.Mesh[]>();
    for (const child of [...base.children]) {
      if (!(child instanceof THREE.Mesh)) continue;
      if (child.name !== '' || !(child.geometry instanceof THREE.BoxGeometry)) continue;
      if (Array.isArray(child.material)) continue;
      const meshes = byMaterial.get(child.material) ?? [];
      meshes.push(child);
      byMaterial.set(child.material, meshes);
    }

    let batchIndex = 0;
    for (const [material, meshes] of byMaterial) {
      if (meshes.length < 2) continue;
      const geometry = meshes[0].geometry.clone();
      const batch = new THREE.InstancedMesh(geometry, material, meshes.length);
      batch.name = `${base.name}-static-wall-batch-${batchIndex++}`;
      batch.castShadow = meshes.some(mesh => mesh.castShadow);
      batch.receiveShadow = meshes.some(mesh => mesh.receiveShadow);

      meshes.forEach((mesh, index) => {
        mesh.updateMatrix();
        batch.setMatrixAt(index, mesh.matrix);
        base.remove(mesh);
        mesh.geometry.dispose();
      });
      batch.instanceMatrix.needsUpdate = true;
      batch.computeBoundingSphere();
      base.add(batch);
    }
  }
}

function cameraMoved(state: RendererTimingState, camera: THREE.Camera) {
  const position = camera.position;
  if (!state.cameraPositionInitialized) {
    state.lastCameraPosition.copy(position);
    state.cameraPositionInitialized = true;
    return true;
  }

  const moved = state.lastCameraPosition.distanceToSquared(position) > CAMERA_MOVE_EPSILON_SQ;
  state.lastCameraPosition.copy(position);
  return moved;
}

function publishRendererDiagnostics(renderer: THREE.WebGLRenderer, renderMs: number) {
  const canvas = renderer.domElement;
  const info = renderer.info;
  canvas.dataset.renderMs = renderMs.toFixed(2);
  canvas.dataset.drawCalls = String(info.render.calls);
  canvas.dataset.triangles = String(info.render.triangles);
  canvas.dataset.geometries = String(info.memory.geometries);
  canvas.dataset.textures = String(info.memory.textures);
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
 * Directional shadows remain enabled, but the expensive atlas is decoupled from the beauty
 * frame rate. Camera motion refreshes it at 15 Hz and an idle camera at 6 Hz so animated
 * units still receive moving shadows without forcing a full shadow pass on every frame.
 * The minimap keeps its live cadence but renders to a smaller internal surface before CSS
 * scales it to the HUD size. Hundreds of identical base-wall meshes are also collapsed into
 * instanced batches before the first visible frame, preserving geometry while removing the
 * draw-call spike around each starting base.
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
    const mainCanvas = canvas.classList.contains('game-canvas');
    const renderingOffscreen = this.getRenderTarget() !== null;

    if (mainCanvas) {
      if (!state.baseStaticBatchesConfigured) {
        batchBaseElevationWalls(scene);
        state.baseStaticBatchesConfigured = true;
      }

      if (this.shadowMap.enabled) {
        if (!state.shadowAtlasConfigured) {
          configureDirectionalShadowAtlases(scene);
          state.shadowAtlasConfigured = true;
        }
        if (!state.sceneShadowCastersConfigured) {
          configureKnownShadowCasters(scene);
          state.sceneShadowCastersConfigured = true;
        }

        if (!state.shadowSchedulingInitialized) {
          this.shadowMap.autoUpdate = false;
          this.shadowMap.needsUpdate = true;
          state.shadowSchedulingInitialized = true;
        }

        if (renderingOffscreen) {
          // Loading warmups must still compile/upload shadow variants and geometry.
          this.shadowMap.needsUpdate = true;
        } else {
          const moved = cameraMoved(state, camera);
          const refreshInterval = moved
            ? MOVING_SHADOW_REFRESH_INTERVAL_MS
            : IDLE_SHADOW_REFRESH_INTERVAL_MS;
          if (now - state.lastShadowRefreshAt >= refreshInterval) {
            this.shadowMap.needsUpdate = true;
            state.lastShadowRefreshAt = now;
          }
        }
      }
    }

    const renderStartedAt = performance.now();
    const result = originalRender.call(this, scene, camera);
    const renderMs = performance.now() - renderStartedAt;

    if (mainCanvas && !renderingOffscreen) publishRendererDiagnostics(this, renderMs);
    return result;
  };

  return () => {
    rendererPrototype.setPixelRatio = originalSetPixelRatio;
    rendererPrototype.setSize = originalSetSize;
    rendererPrototype.render = originalRender;
    objectPrototype.add = originalAdd;
  };
}
