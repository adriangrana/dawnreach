import * as THREE from 'three';

const REVEAL_WARMUP_TARGET_SIZE = 96;

type RevealObjectState = {
  object: THREE.Object3D;
  visible: boolean;
  frustumCulled: boolean;
};

/**
 * Uploads and compiles heavyweight fog-hidden assets on the main WebGL context while the
 * loading splash is still active. The warmup deliberately exercises both a small offscreen
 * target and the actual default gameplay framebuffer: some WebGL drivers defer portions of
 * pipeline/geometry setup until a real onscreen draw, which otherwise shows up as a severe
 * one-frame hitch the first time the dragon enters vision.
 *
 * Important: do not use compileAsync here. Some browser/driver combinations can leave the
 * parallel shader compilation promise pending indefinitely, which would keep the boot splash
 * on screen forever. The synchronous compile + finite readback below has a bounded call path
 * and moves the expensive work into loading.
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
  const revealObjectStates: RevealObjectState[] = [];
  const target = new THREE.WebGLRenderTarget(REVEAL_WARMUP_TARGET_SIZE, REVEAL_WARMUP_TARGET_SIZE, {
    depthBuffer: true,
    stencilBuffer: false,
  });

  try {
    // Force every authored dragon part through the upload path, including pieces that a
    // particular warmup camera angle would normally frustum-cull. Restore all flags below.
    drake.traverse((object) => {
      revealObjectStates.push({ object, visible: object.visible, frustumCulled: object.frustumCulled });
      object.visible = true;
      object.frustumCulled = false;
    });
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

    // Compile first, then draw once to the same default framebuffer used during gameplay.
    // The boot splash is still covering the game at this point, so this frame is never seen.
    renderer.compile(scene, warmCamera);
    renderer.setRenderTarget(null);
    renderer.render(scene, warmCamera);

    // Exercise an alternate approach angle as well. Shared materials are already compiled,
    // but this guarantees every independent BufferGeometry has been submitted at least once.
    const alternateCamera = warmCamera.clone();
    alternateCamera.position.set(
      drakePosition.x + cameraOffset.z * 0.72,
      drakePosition.y + cameraOffset.y,
      drakePosition.z - Math.max(10, Math.abs(cameraOffset.z) * 0.9),
    );
    alternateCamera.lookAt(drakePosition);
    alternateCamera.updateMatrixWorld(true);
    renderer.render(scene, alternateCamera);

    // Finish with a tiny offscreen draw and finite one-pixel readback. The readback acts as
    // an explicit GPU synchronization point for all preceding warmup commands without using
    // gl.finish(), which is much more aggressive on some drivers.
    renderer.setRenderTarget(target);
    renderer.render(scene, warmCamera);
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
    for (const state of revealObjectStates) {
      state.object.visible = state.visible;
      state.object.frustumCulled = state.frustumCulled;
    }
    drake.visible = previousVisible;
    target.dispose();
  }
}
