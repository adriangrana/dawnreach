import * as THREE from 'three';
import { subscribeWorldCombatEvents } from '../entities/worldCombatBridge';

const SHADOW_REFRESH_FRAMES_AFTER_DEATH = 4;

/**
 * Keeps the optimized shadow atlas coherent with destructive world-state changes.
 * A death event can be published slightly before the corresponding world object is hidden,
 * so one immediate refresh is not enough. We force a short refresh burst across the next
 * few animation frames; after that the normal shadow scheduler takes over again.
 */
export function installShadowInvalidationBridge() {
  const rendererPrototype = THREE.WebGLRenderer.prototype;
  const originalSetPixelRatio = rendererPrototype.setPixelRatio;
  const originalSetSize = rendererPrototype.setSize;
  const renderers = new Set<THREE.WebGLRenderer>();
  const refreshFrames = new WeakMap<THREE.WebGLRenderer, number>();
  let disposed = false;

  const trackRenderer = (renderer: THREE.WebGLRenderer) => {
    renderers.add(renderer);
  };

  const refreshNextFrame = (renderer: THREE.WebGLRenderer) => {
    if (disposed) return;
    const remaining = refreshFrames.get(renderer) ?? 0;
    if (remaining <= 0) return;
    if (renderer.shadowMap.enabled) renderer.shadowMap.needsUpdate = true;
    refreshFrames.set(renderer, remaining - 1);
    if (remaining > 1) window.requestAnimationFrame(() => refreshNextFrame(renderer));
  };

  const requestRefreshBurst = (renderer: THREE.WebGLRenderer) => {
    if (!renderer.shadowMap.enabled) return;
    renderer.shadowMap.needsUpdate = true;
    const alreadyPending = refreshFrames.get(renderer) ?? 0;
    refreshFrames.set(renderer, Math.max(alreadyPending, SHADOW_REFRESH_FRAMES_AFTER_DEATH));
    if (alreadyPending <= 0) window.requestAnimationFrame(() => refreshNextFrame(renderer));
  };

  rendererPrototype.setPixelRatio = function setPixelRatio(value: number) {
    trackRenderer(this);
    return originalSetPixelRatio.call(this, value);
  };

  rendererPrototype.setSize = function setSize(width: number, height: number, updateStyle?: boolean) {
    trackRenderer(this);
    return originalSetSize.call(this, width, height, updateStyle);
  };

  const unsubscribeCombat = subscribeWorldCombatEvents((event) => {
    if (event.reason !== 'death') return;
    for (const renderer of renderers) {
      if (!renderer.domElement.classList.contains('game-canvas')) continue;
      requestRefreshBurst(renderer);
    }
  });

  return () => {
    disposed = true;
    unsubscribeCombat();
    rendererPrototype.setPixelRatio = originalSetPixelRatio;
    rendererPrototype.setSize = originalSetSize;
    renderers.clear();
  };
}
