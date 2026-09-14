import * as THREE from 'three';

const REVEAL_WARMUP_TARGET_SIZE = 64;

/**
 * Uploads and compiles heavyweight fog-hidden assets on the main WebGL context while the
 * loading splash is still active. This is deliberately explicit and one-shot: no renderer
 * prototype patches, no repeated hidden renders, and no second-context warmup.
 *
 * Important: do not use compileAsync here. Some browser/driver combinations can leave the
 * parallel shader compilation promise pending indefinitely, which would keep the boot splash
 * on screen forever. The synchronous compile + real offscreen draw below has a bounded call
 * path and moves its cost into loading without making readiness depend on a driver promise.
 */
export async function prepareHeavyRevealAssets(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  gameplayCamera: THREE.OrthographicCamera,
  sunlight: THREE.DirectionalLight,
  cameraOffset: THREE.Vector3,
) {
  const drake = scene.getObjectByName('radiant-drake');
  if (!drake) return;

  const previousVisible = drake.visible;
  const previousRenderTarget = renderer.getRenderTarget();
  const previousAutoClear = renderer.autoClear;
  const previousSunPosition = sunlight.position.clone();
  const previousSunTarget = sunlight.target.position.clone();
  const target = new THREE.WebGLRenderTarget(REVEAL_WARMUP_TARGET_SIZE, REVEAL_WARMUP_TARGET_SIZE, {
    depthBuffer: true,
    stencilBuffer: false,
  });

  try {
    // Make the hidden objective renderable only for this controlled loading pass.
    drake.visible = true;
    drake.updateWorldMatrix(true, true);

    const drakePosition = new THREE.Vector3();
    drake.getWorldPosition(drakePosition);

    const warmCamera = gameplayCamera.clone();
    warmCamera.position.copy(drakePosition).add(cameraOffset);
    warmCamera.lookAt(drakePosition);
    warmCamera.updateProjectionMatrix();
    warmCamera.updateMatrixWorld(true);

    const sunOffset = previousSunPosition.clone().sub(previousSunTarget);
    sunlight.target.position.copy(drakePosition);
    sunlight.position.copy(drakePosition).add(sunOffset);
    sunlight.target.updateMatrixWorld(true);
    sunlight.updateMatrixWorld(true);

    renderer.autoClear = true;
    renderer.setRenderTarget(target);

    // Compile using the actual gameplay scene/context, then issue one real draw. This covers
    // shader programs, geometry buffers, textures and shadow variants without depending on
    // KHR_parallel_shader_compile ever resolving.
    renderer.compile(scene, warmCamera);
    renderer.render(scene, warmCamera);

    // Reading one pixel is an explicit, finite synchronization point for this render target.
    // It ensures the warmup draw has really reached the GPU before gameplay starts without
    // relying on gl.finish(), which can stall much more aggressively on some drivers.
    const probe = new Uint8Array(4);
    renderer.readRenderTargetPixels(target, 0, 0, 1, 1, probe);
  } catch (error) {
    // Warmup is optional. Failure must never prevent the match from becoming playable.
    console.warn('[Dawnreach] Heavy reveal asset preparation skipped:', error);
  } finally {
    renderer.setRenderTarget(previousRenderTarget);
    renderer.autoClear = previousAutoClear;
    sunlight.position.copy(previousSunPosition);
    sunlight.target.position.copy(previousSunTarget);
    sunlight.target.updateMatrixWorld(true);
    sunlight.updateMatrixWorld(true);
    drake.visible = previousVisible;
    target.dispose();
  }
}
