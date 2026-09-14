import * as THREE from 'three';
import { MAP_BOUNDS } from '../game/map/mapLayout';

const INSTALL_FLAG = '__dawnreachWebglWarmupInstalled';
const WARMUP_TARGET_SIZE = 4;
const HEAVY_MAIN_RENDER_MS = 10;
const RECENT_MAIN_RENDER_WINDOW_MS = 24;
const MINIMAP_FORCE_REFRESH_MS = 450;

const warmedRenderers = new WeakSet<THREE.WebGLRenderer>();
const minimapLastRenderedAt = new WeakMap<THREE.WebGLRenderer, number>();
let lastMainRenderEndedAt = Number.NEGATIVE_INFINITY;
let lastMainRenderCostMs = 0;

function isDawnreachScene(scene: THREE.Object3D): scene is THREE.Scene {
  return scene instanceof THREE.Scene && scene.getObjectByName('dawnreach-map') !== undefined;
}

function buildWarmupCamera() {
  const centerX = (MAP_BOUNDS.minX + MAP_BOUNDS.maxX) * 0.5;
  const centerZ = (MAP_BOUNDS.minZ + MAP_BOUNDS.maxZ) * 0.5;
  const halfWidth = (MAP_BOUNDS.maxX - MAP_BOUNDS.minX) * 0.55;
  const halfHeight = (MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ) * 0.55;
  const camera = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfHeight, -halfHeight, 0.1, 260);
  camera.position.set(centerX, 140, centerZ);
  camera.up.set(0, 0, -1);
  camera.lookAt(centerX, 0, centerZ);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

function warmRenderer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  render: (scene: THREE.Object3D, camera: THREE.Camera) => void,
) {
  if (warmedRenderers.has(renderer)) return;
  warmedRenderers.add(renderer);

  // Vision hides neutral/enemy entities before the first visible game frame. Temporarily
  // reveal every authored object only inside a 4x4 offscreen render target so WebGL uploads
  // geometry and compiles material variants while the boot splash is still covering the UI.
  const hiddenObjects: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if (object.visible) return;
    hiddenObjects.push(object);
    object.visible = true;
  });

  const target = new THREE.WebGLRenderTarget(WARMUP_TARGET_SIZE, WARMUP_TARGET_SIZE, {
    depthBuffer: true,
    stencilBuffer: false,
  });
  const camera = buildWarmupCamera();
  const previousTarget = renderer.getRenderTarget();
  const previousAutoClear = renderer.autoClear;
  const previousXrEnabled = renderer.xr.enabled;

  try {
    renderer.xr.enabled = false;
    renderer.autoClear = true;
    renderer.setRenderTarget(target);
    render(scene, camera);
  } catch (error) {
    // Warmup is an optimisation only. Never prevent the game from booting if a driver
    // rejects the offscreen pre-pass.
    console.warn('[Dawnreach] WebGL warmup skipped:', error);
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.autoClear = previousAutoClear;
    renderer.xr.enabled = previousXrEnabled;
    target.dispose();
    for (const object of hiddenObjects) object.visible = false;
  }
}

const prototype = THREE.WebGLRenderer.prototype as THREE.WebGLRenderer & Record<string, unknown>;

if (prototype[INSTALL_FLAG] !== true) {
  const originalRender = THREE.WebGLRenderer.prototype.render;

  THREE.WebGLRenderer.prototype.render = function patchedDawnreachRender(
    scene: THREE.Object3D,
    camera: THREE.Camera,
  ) {
    const dawnreachScene = isDawnreachScene(scene) ? scene : null;
    if (dawnreachScene) {
      warmRenderer(this, dawnreachScene, (warmScene, warmCamera) => {
        originalRender.call(this, warmScene, warmCamera);
      });
    }

    const canvas = this.domElement;
    const isMainGameRenderer = canvas.classList.contains('game-canvas');
    const isMinimapRenderer = canvas.classList.contains('minimap-canvas');
    const now = performance.now();

    // The minimap owns a second WebGL context. When the main renderer already consumed a
    // meaningful part of the frame budget, keep the previous minimap frame instead of
    // stacking another complete scene render in the same browser frame. Force a refresh
    // periodically so the minimap can never starve under sustained load.
    if (isMinimapRenderer) {
      const previousMinimapRender = minimapLastRenderedAt.get(this) ?? Number.NEGATIVE_INFINITY;
      const mainWasRecent = now - lastMainRenderEndedAt <= RECENT_MAIN_RENDER_WINDOW_MS;
      const minimapIsOverdue = now - previousMinimapRender >= MINIMAP_FORCE_REFRESH_MS;
      if (mainWasRecent && lastMainRenderCostMs >= HEAVY_MAIN_RENDER_MS && !minimapIsOverdue) return;
    }

    const startedAt = performance.now();
    originalRender.call(this, scene, camera);
    const endedAt = performance.now();

    if (isMainGameRenderer) {
      lastMainRenderCostMs = endedAt - startedAt;
      lastMainRenderEndedAt = endedAt;
    } else if (isMinimapRenderer) {
      minimapLastRenderedAt.set(this, endedAt);
    }
  } as typeof THREE.WebGLRenderer.prototype.render;

  prototype[INSTALL_FLAG] = true;
}
