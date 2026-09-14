import * as THREE from 'three';

const REVEAL_WARMUP_TARGET_SIZE = 64;

/**
 * Uploads and compiles heavyweight fog-hidden assets on the main WebGL context while the
 * loading splash is still active. This is deliberately explicit and one-shot: no renderer
 * prototype patches, no repeated hidden renders, and no second-context warmup.
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

    // compileAsync waits for KHR_parallel_shader_compile when the browser/driver exposes it.
    // The following real offscreen draw then creates/uploads every geometry buffer and the
    // shadow variants using the same renderer/context that gameplay will use.
    await renderer.compileAsync(scene, warmCamera);
    renderer.autoClear = true;
    renderer.setRenderTarget(target);
    renderer.render(scene, warmCamera);

    // WebGL command submission can otherwise remain queued until the first on-screen use.
    // Finishing here intentionally moves that synchronization cost into the loading phase.
    renderer.getContext().finish();
  } catch (error) {
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
