import * as THREE from 'three';

/**
 * The lane ribbons deliberately have a soft shoulder wider than the playable paving.
 * At river crossings that shoulder used to remain visible beside the bridge deck,
 * producing a conspicuous road-colored strip. Widen the authored bridge deck/rails
 * enough to cover the lane transition, then add short sloped aprons so the stone deck
 * blends into the road instead of ending in a hard rectangular seam.
 */
export function polishRiverBridges(root: THREE.Object3D) {
  root.traverse((object) => {
    if (!(object instanceof THREE.Group) || !object.name.endsWith('-river-bridge')) return;

    let deck: THREE.Mesh<THREE.BoxGeometry> | null = null;

    for (const child of object.children) {
      if (!(child instanceof THREE.Mesh) || !(child.geometry instanceof THREE.BoxGeometry)) continue;
      const { width, height, depth } = child.geometry.parameters;

      // Main deck: cover the lane plus its faded shoulder, not only the inner paving.
      if (width > 9 && depth > 3) {
        child.scale.x *= 1.06;
        child.scale.z *= 1.32;
        deck = child as THREE.Mesh<THREE.BoxGeometry>;
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

    if (!deck) return;

    const { width, height, depth } = deck.geometry.parameters;
    const deckHalfLength = width * deck.scale.x / 2;
    const deckHalfWidth = depth * deck.scale.z / 2;
    const deckTop = deck.position.y + height * deck.scale.y / 2;

    for (const direction of [-1, 1] as const) {
      const approach = buildBridgeApproach(
        direction,
        deckHalfLength,
        deckHalfWidth,
        deckTop,
        deck.material,
      );
      approach.name = `${object.name}-approach-${direction < 0 ? 'west' : 'east'}`;
      approach.userData.commandSurface = true;
      object.add(approach);
    }
  });
}

function buildBridgeApproach(
  direction: -1 | 1,
  deckHalfLength: number,
  deckHalfWidth: number,
  deckTop: number,
  material: THREE.Material | THREE.Material[],
) {
  const overlap = 0.08;
  const length = 1.75;
  const roadHalfWidth = 2.56;
  const innerX = direction * (deckHalfLength - overlap);
  const outerX = direction * (deckHalfLength + length);
  const innerY = deckTop + 0.002;
  // The bridge group itself sits at y ~= 0.02 while the lane surface is around y ~= 0.016.
  // Ending slightly below the group's origin creates a shallow ramp into the road instead
  // of leaving the bridge top floating above it with a visible step.
  const outerY = -0.003;
  const innerHalfWidth = Math.max(roadHalfWidth, deckHalfWidth * 0.985);

  const positions = new Float32Array([
    innerX, innerY, -innerHalfWidth,
    outerX, outerY, -roadHalfWidth,
    outerX, outerY, roadHalfWidth,
    innerX, innerY, innerHalfWidth,
  ]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([
    0, 0,
    1, 0,
    1, 1,
    0, 1,
  ], 2));
  geometry.setIndex(direction > 0
    ? [0, 2, 1, 0, 3, 2]
    : [0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}
