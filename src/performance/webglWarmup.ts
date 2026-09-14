import * as THREE from 'three';
import { MAP_BOUNDS } from '../game/map/mapLayout';

const INSTALL_FLAG = '__dawnreachWebglWarmupInstalled';
const WARMUP_TARGET_SIZE = 4;
const HEAVY_MAIN_RENDER_MS = 10;
const RECENT_MAIN_RENDER_WINDOW_MS = 24;
const MINIMAP_FORCE_REFRESH_MS = 450;

const DRAKE_PRIMARY_SHADOW_CASTERS = new Set([
  'continuous-scaled-neck-body-tail',
  'angular-cranial-surface',
  'mandible',
  'muscular-limb',
  'taloned-paw',
  'wing-upper-arm',
  'wing-forearm',
  'wing-wrist',
  'veined-wing-membrane',
]);

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

function prepareRadiantDrakeForStableFrames(scene: THREE.Scene) {
  const drake = scene.getObjectByName('radiant-drake');
  if (!drake) return null;

  // The dragon contains a large amount of tiny authored surface detail. Those meshes are
  // important in the beauty pass but almost none contribute a readable shadow at the game
  // camera distance. Keep only the large silhouette pieces in the 2048x2048 shadow pass.
  // This removes a burst of shadow draw calls when the pit first enters the sun frustum.
  if (drake.userData.shadowCastersOptimized !== true) {
    drake.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = DRAKE_PRIMARY_SHADOW_CASTERS.has(object.name);
    });
    drake.userData.shadowCastersOptimized = true;
  }

  return drake;
}

function primeRadiantDrakeAnimation(drake: THREE.Object3D | null) {
  if (!drake) return;
  const animate = drake.userData.animate;
  if (typeof animate !== 'function') return;

  // The animator normally sleeps while fog hides the objective. Execute its expensive path
  // twice while the boot splash is still present so skeleton buffers, the 1,210 instance
  // matrices and the JS/JIT path are all hot before the first real reveal frame.
  const nowMs = performance.now();
  animate(0, nowMs);
  animate(1 / 30, nowMs + 1000 / 30);
  drake.updateMatrixWorld(true);
}

type DirectionalShadowSnapshot = Readonly<{
  light: THREE.DirectionalLight;
  lightPosition: THREE.Vector3;
  targetPosition: THREE.Vector3;
}>;

function centerDirectionalShadowsOn(scene: THREE.Scene, point: THREE.Vector3) {
  const snapshots: DirectionalShadowSnapshot[] = [];
  scene.traverse((object) => {
    if (!(object instanceof THREE.DirectionalLight) || !object.castShadow) return;
    const target = object.target;
    const lightPosition = object.position.clone();
    const targetPosition = target.position.clone();
    const offset = lightPosition.clone().sub(targetPosition);
    snapshots.push({ light: object, lightPosition, targetPosition });
    target.position.copy(point);
    object.position.copy(point).add(offset);
    target.updateMatrixWorld(true);
    object.updateMatrixWorld(true);
  });

  return () => {
    for (const snapshot of snapshots) {
      snapshot.light.position.copy(snapshot.lightPosition);
      snapshot.light.target.position.copy(snapshot.targetPosition);
      snapshot.light.target.updateMatrixWorld(true);
      snapshot.light.updateMatrixWorld(true);
    }
  };
}

function warmRenderer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  render: (scene: THREE.Object3D, camera: THREE.Camera) => void,
) {
  if (warmedRenderers.has(renderer)) return;
  warmedRenderers.add(renderer);

  const drake = prepareRadiantDrakeForStableFrames(scene);

  // Vision hides neutral/enemy entities before the first visible game frame. Temporarily
  // reveal every authored object only inside a 4x4 offscreen render target so WebGL uploads
  // geometry and compiles material variants while the boot splash is still covering the UI.
  const hiddenObjects: THREE.Object3D[] = [];
  scene.traverse((object) => {
    if (object.visible) return;
    hiddenObjects.push(object);
    object.visible = true;
  });

  // root.visible must be true here; otherwise the drake animator intentionally sleeps.
  primeRadiantDrakeAnimation(drake);

  const target = new THREE.WebGLRenderTarget(WARMUP_TARGET_SIZE, WARMUP_TARGET_SIZE, {
    depthBuffer: true,
    stencilBuffer: false,
  });
  const camera = buildWarmupCamera();
  const previousTarget = renderer.getRenderTarget();
  const previousAutoClear = renderer.autoClear;
  const previousXrEnabled = renderer.xr.enabled;
  let restoreShadowLights: (() => void) | null = null;

  try {
    renderer.xr.enabled = false;
    renderer.autoClear = true;
    renderer.setRenderTarget(target);
    render(scene, camera);

    // The sun follows the gameplay camera and only covers a limited shadow frustum. A
    // map-wide warmup therefore did not guarantee that the dragon ever entered the shadow
    // pass. Center the real directional shadow camera on the pit once, offscreen, so the
    // skinned/instanced shadow variants are compiled before the player can discover it.
    if (renderer.shadowMap.enabled && drake) {
      const drakePosition = new THREE.Vector3();
      drake.getWorldPosition(drakePosition);
      restoreShadowLights = centerDirectionalShadowsOn(scene, drakePosition);
      render(scene, camera);
    }
  } catch (error) {
    // Warmup is an optimisation only. Never prevent the game from booting if a driver
    // rejects the offscreen pre-pass.
    console.warn('[Dawnreach] WebGL warmup skipped:', error);
  } finally {
    restoreShadowLights?.();
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
