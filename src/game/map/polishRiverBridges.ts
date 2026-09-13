import * as THREE from 'three';

/**
 * The lane ribbons deliberately have a soft shoulder wider than the playable paving.
 * At river crossings that shoulder used to remain visible beside the bridge deck,
 * producing a conspicuous road-colored strip. Widen the authored bridge deck/rails
 * just enough to cover the complete lane transition while keeping the crossing clear.
 */
export function polishRiverBridges(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Group) || !object.name.endsWith('-river-bridge')) return;

    for (const child of object.children) {
      if (!(child instanceof THREE.Mesh) || !(child.geometry instanceof THREE.BoxGeometry)) continue;
      const { width, height, depth } = child.geometry.parameters;

      // Main deck: cover the lane plus its faded shoulder, not only the inner paving.
      if (width > 9 && depth > 3) {
        child.scale.x *= 1.06;
        child.scale.z *= 1.32;
        continue;
      }

      // Side curbs follow the widened deck.
      if (width > 9 && depth < 0.5 && height > 0.2) {
        child.scale.x *= 1.06;
        child.position.z *= 1.28;
        continue;
      }

      // Rail/post supports need to stay aligned with the curbs.
      if (width < 1 && height > 0.5 && depth < 1) {
        child.position.z *= 1.28;
        continue;
      }

      // Dark deck seams should span the full visible stone surface.
      if (width < 0.12 && depth > 3) child.scale.z *= 1.26;
    }
  });
}
