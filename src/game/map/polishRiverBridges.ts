import * as THREE from 'three';

type BridgeMaterials = {
  foundation: THREE.MeshStandardMaterial;
  stoneA: THREE.MeshStandardMaterial;
  stoneB: THREE.MeshStandardMaterial;
  stoneC: THREE.MeshStandardMaterial;
  coping: THREE.MeshStandardMaterial;
  joint: THREE.MeshStandardMaterial;
  wetStone: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
};

const DECK_LENGTH_SCALE = 1.06;
const DECK_WIDTH_SCALE = 1.32;
const APPROACH_LENGTH = 1.75;
const ROAD_HALF_WIDTH = 2.56;

/**
 * Rebuild the authored river crossings as finished Dawnreach masonry while preserving the
 * original command/raycast surface height. The primitive curbs, cube posts and black seams
 * created by buildDawnreachMap are intentionally removed here and replaced with visual-only
 * stonework; gameplay continues to use one continuous deck plus the two sloped approaches.
 */
export function polishRiverBridges(root: THREE.Object3D) {
  let sharedMaterials: BridgeMaterials | null = null;

  root.traverse((object) => {
    if (!(object instanceof THREE.Group) || !object.name.endsWith('-river-bridge')) return;
    if (object.userData.bridgePresentation === 'dawnreach-masonry-v2') return;

    const deck = findAuthoredDeck(object);
    if (!deck) return;

    const sourceMaterial = Array.isArray(deck.material) ? deck.material[0] : deck.material;
    sharedMaterials ??= createBridgeMaterials(sourceMaterial);

    const authored = deck.geometry.parameters;
    const deckLength = authored.width * deck.scale.x * DECK_LENGTH_SCALE;
    const deckWidth = authored.depth * deck.scale.z * DECK_WIDTH_SCALE;
    const deckTop = deck.position.y + authored.height * deck.scale.y / 2;
    const deckThickness = Math.max(0.16, authored.height * deck.scale.y);

    // Strip only the old bridge placeholder pieces. Their materials are shared with the map,
    // so dispose geometry only and leave the shared map materials alive.
    for (const child of [...object.children]) {
      if (child === deck) continue;
      object.remove(child);
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    }

    // Keep this mesh as the sole authoritative bridge command surface. Preserve the top
    // elevation that already works with hero ground-height sampling and right-click orders.
    deck.geometry.dispose();
    deck.geometry = new THREE.BoxGeometry(deckLength, deckThickness, deckWidth);
    deck.material = sharedMaterials.joint;
    deck.scale.set(1, 1, 1);
    deck.position.set(0, deckTop - deckThickness / 2, 0);
    deck.name = `${object.name}-command-deck`;
    deck.userData.commandSurface = true;
    deck.castShadow = true;
    deck.receiveShadow = true;

    object.add(buildDeckMasonry(deckLength, deckWidth, deckTop, sharedMaterials, object.name));
    object.add(buildBridgeRails(deckLength, deckWidth, deckTop, sharedMaterials));
    object.add(buildBridgeUnderstructure(deckLength, deckWidth, deckTop, sharedMaterials));

    const deckHalfLength = deckLength / 2;
    const deckHalfWidth = deckWidth / 2;
    for (const direction of [-1, 1] as const) {
      const approach = buildBridgeApproach(
        direction,
        deckHalfLength,
        deckHalfWidth,
        deckTop,
        sharedMaterials.stoneA,
      );
      approach.name = `${object.name}-approach-${direction < 0 ? 'west' : 'east'}`;
      approach.userData.commandSurface = true;
      object.add(approach);

      object.add(buildApproachMasonry(
        direction,
        deckHalfLength,
        deckHalfWidth,
        deckTop,
        sharedMaterials,
      ));
      object.add(buildBridgeAbutment(
        direction,
        deckHalfLength,
        deckHalfWidth,
        deckTop,
        sharedMaterials,
      ));
    }

    object.userData.bridgePresentation = 'dawnreach-masonry-v2';
  });
}

function findAuthoredDeck(group: THREE.Group) {
  for (const child of group.children) {
    if (!(child instanceof THREE.Mesh) || !(child.geometry instanceof THREE.BoxGeometry)) continue;
    const { width, depth } = child.geometry.parameters;
    if (width > 9 && depth > 3) return child as THREE.Mesh<THREE.BoxGeometry>;
  }
  return null;
}

function createBridgeMaterials(reference: THREE.Material): BridgeMaterials {
  const source = reference instanceof THREE.MeshStandardMaterial
    ? reference
    : new THREE.MeshStandardMaterial({ roughness: 0.95 });

  const stone = (color: number, roughness: number) => {
    const material = source.clone();
    material.color.setHex(color);
    material.roughness = roughness;
    material.metalness = 0.015;
    material.transparent = false;
    material.opacity = 1;
    material.depthWrite = true;
    material.vertexColors = false;
    return material;
  };

  return {
    foundation: stone(0x585a50, 0.98),
    stoneA: stone(0x858371, 0.96),
    stoneB: stone(0x96917b, 0.94),
    stoneC: stone(0x747568, 0.97),
    coping: stone(0xa19a82, 0.93),
    joint: stone(0x626257, 0.99),
    wetStone: stone(0x47504d, 1),
    metal: new THREE.MeshStandardMaterial({
      color: 0x5d574b,
      roughness: 0.62,
      metalness: 0.42,
    }),
  };
}

function buildDeckMasonry(
  deckLength: number,
  deckWidth: number,
  deckTop: number,
  materials: BridgeMaterials,
  bridgeName: string,
) {
  const group = new THREE.Group();
  group.name = `${bridgeName}-masonry-deck`;

  const rows = 7;
  const usableLength = deckLength - 0.46;
  const rowLength = usableLength / rows;
  const stoneHalfWidth = deckWidth / 2 - 0.46;
  const seamOffsets = [-0.18, 0.21, -0.08, 0.24, -0.22, 0.12, -0.14];
  const palette = [materials.stoneA, materials.stoneB, materials.stoneA,
    materials.stoneC, materials.stoneB, materials.stoneA, materials.stoneB];

  for (let row = 0; row < rows; row++) {
    const x = -usableLength / 2 + rowLength * (row + 0.5);
    const seam = seamOffsets[row];
    const gap = 0.055;
    const leftMin = -stoneHalfWidth;
    const leftMax = seam - gap / 2;
    const rightMin = seam + gap / 2;
    const rightMax = stoneHalfWidth;

    addSlab(group, x, (leftMin + leftMax) / 2, rowLength - 0.065,
      leftMax - leftMin, deckTop + 0.013, palette[row]);
    addSlab(group, x, (rightMin + rightMax) / 2, rowLength - 0.065,
      rightMax - rightMin, deckTop + 0.013,
      row % 3 === 0 ? materials.stoneB : row % 3 === 1 ? materials.stoneA : materials.stoneC);
  }

  // Longitudinal edge courses frame the paving without becoming tall collision geometry.
  for (const side of [-1, 1]) {
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(deckLength - 0.24, 0.032, 0.31),
      materials.coping,
    );
    band.position.set(0, deckTop + 0.016, side * (deckWidth / 2 - 0.27));
    band.receiveShadow = true;
    group.add(band);
  }

  // Warm metal plaques give the bridge a crafted identity without reading as dark debug lines.
  for (const x of [-2.65, 0, 2.65]) {
    const inset = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.024, 0.16), materials.metal);
    inset.position.set(x, deckTop + 0.027, 0);
    inset.receiveShadow = true;
    group.add(inset);
  }

  return group;
}

function addSlab(
  group: THREE.Group,
  x: number,
  z: number,
  length: number,
  width: number,
  y: number,
  material: THREE.Material,
) {
  const slab = new THREE.Mesh(new THREE.BoxGeometry(length, 0.025, width), material);
  slab.position.set(x, y, z);
  slab.receiveShadow = true;
  group.add(slab);
}

function buildBridgeRails(
  deckLength: number,
  deckWidth: number,
  deckTop: number,
  materials: BridgeMaterials,
) {
  const group = new THREE.Group();
  group.name = 'river-bridge-rails';
  const halfWidth = deckWidth / 2;
  const postX = [-4.72, -2.36, 0, 2.36, 4.72]
    .map(value => THREE.MathUtils.clamp(value, -deckLength / 2 + 0.55, deckLength / 2 - 0.55));

  const postFootGeometry = new THREE.BoxGeometry(0.5, 0.18, 0.5);
  const postGeometry = new THREE.CylinderGeometry(0.16, 0.21, 0.50, 6);
  const postCapGeometry = new THREE.CylinderGeometry(0.235, 0.235, 0.10, 6);

  for (const side of [-1, 1]) {
    const z = side * (halfWidth - 0.12);

    const parapet = new THREE.Mesh(
      new THREE.BoxGeometry(deckLength - 0.18, 0.23, 0.34),
      materials.foundation,
    );
    parapet.position.set(0, deckTop + 0.115, z);
    parapet.castShadow = true;
    parapet.receiveShadow = true;
    group.add(parapet);

    const coping = new THREE.Mesh(
      new THREE.BoxGeometry(deckLength - 0.12, 0.10, 0.43),
      materials.coping,
    );
    coping.position.set(0, deckTop + 0.275, z);
    coping.castShadow = true;
    coping.receiveShadow = true;
    group.add(coping);

    for (const x of postX) {
      const foot = new THREE.Mesh(postFootGeometry, materials.foundation);
      foot.position.set(x, deckTop + 0.34, z);
      foot.castShadow = true;
      foot.receiveShadow = true;
      group.add(foot);

      const post = new THREE.Mesh(postGeometry, materials.stoneC);
      post.position.set(x, deckTop + 0.66, z);
      post.rotation.y = Math.PI / 6;
      post.castShadow = true;
      post.receiveShadow = true;
      group.add(post);

      const cap = new THREE.Mesh(postCapGeometry, materials.coping);
      cap.position.set(x, deckTop + 0.955, z);
      cap.rotation.y = Math.PI / 6;
      cap.castShadow = true;
      cap.receiveShadow = true;
      group.add(cap);
    }

    for (let index = 0; index < postX.length - 1; index++) {
      const start = postX[index] + 0.28;
      const end = postX[index + 1] - 0.28;
      const length = Math.max(0.2, end - start);
      const center = (start + end) / 2;

      const lowerRail = new THREE.Mesh(new THREE.BoxGeometry(length, 0.075, 0.11), materials.metal);
      lowerRail.position.set(center, deckTop + 0.64, z);
      lowerRail.castShadow = true;
      group.add(lowerRail);

      const handRail = new THREE.Mesh(new THREE.BoxGeometry(length, 0.12, 0.16), materials.metal);
      handRail.position.set(center, deckTop + 0.91, z);
      handRail.castShadow = true;
      group.add(handRail);
    }
  }

  return group;
}

function buildBridgeUnderstructure(
  deckLength: number,
  deckWidth: number,
  deckTop: number,
  materials: BridgeMaterials,
) {
  const group = new THREE.Group();
  group.name = 'river-bridge-understructure';

  for (const side of [-1, 1]) {
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(deckLength - 0.5, 0.32, 0.36),
      materials.wetStone,
    );
    beam.position.set(0, deckTop - 0.26, side * (deckWidth / 2 - 0.34));
    beam.castShadow = true;
    beam.receiveShadow = true;
    group.add(beam);

    const arch = new THREE.Mesh(
      createBridgeArchGeometry(deckLength - 0.72, 0.22),
      materials.foundation,
    );
    arch.position.set(0, deckTop - 0.08, side * (deckWidth / 2 - 0.17));
    arch.castShadow = true;
    arch.receiveShadow = true;
    group.add(arch);
  }

  for (const x of [-3.15, 0, 3.15]) {
    const rib = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.34, deckWidth - 0.64),
      materials.wetStone,
    );
    rib.position.set(x, deckTop - 0.28, 0);
    rib.castShadow = true;
    rib.receiveShadow = true;
    group.add(rib);
  }

  return group;
}

function createBridgeArchGeometry(length: number, depth: number) {
  const half = length / 2;
  const openingHalf = half - 0.52;
  const shape = new THREE.Shape();
  shape.moveTo(-half, -0.72);
  shape.lineTo(half, -0.72);
  shape.lineTo(half, 0.02);
  shape.lineTo(-half, 0.02);
  shape.closePath();

  const opening = new THREE.Path();
  opening.moveTo(-openingHalf, -0.68);
  opening.quadraticCurveTo(-openingHalf * 0.44, -0.12, 0, -0.075);
  opening.quadraticCurveTo(openingHalf * 0.44, -0.12, openingHalf, -0.68);
  opening.lineTo(openingHalf, -0.715);
  opening.lineTo(-openingHalf, -0.715);
  opening.closePath();
  shape.holes.push(opening);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.025,
    bevelThickness: 0.025,
  });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeVertexNormals();
  return geometry;
}

function buildBridgeAbutment(
  direction: -1 | 1,
  deckHalfLength: number,
  deckHalfWidth: number,
  deckTop: number,
  materials: BridgeMaterials,
) {
  const group = new THREE.Group();
  group.name = `river-bridge-abutment-${direction < 0 ? 'west' : 'east'}`;
  const centerX = direction * (deckHalfLength + 0.66);

  for (const side of [-1, 1]) {
    const yaw = side * direction * 0.14;
    const z = side * (deckHalfWidth + 0.13);

    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.48, 0.56), materials.foundation);
    wing.position.set(centerX, deckTop - 0.13, z);
    wing.rotation.y = yaw;
    wing.castShadow = true;
    wing.receiveShadow = true;
    group.add(wing);

    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.11, 0.68), materials.coping);
    cap.position.set(centerX, deckTop + 0.15, z);
    cap.rotation.y = yaw;
    cap.castShadow = true;
    cap.receiveShadow = true;
    group.add(cap);

    const bankFoot = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.34, 0.72), materials.wetStone);
    bankFoot.position.set(direction * (deckHalfLength + 0.08), deckTop - 0.31, z);
    bankFoot.rotation.y = yaw;
    bankFoot.castShadow = true;
    bankFoot.receiveShadow = true;
    group.add(bankFoot);
  }

  return group;
}

function buildApproachMasonry(
  direction: -1 | 1,
  deckHalfLength: number,
  deckHalfWidth: number,
  deckTop: number,
  materials: BridgeMaterials,
) {
  const group = new THREE.Group();
  group.name = `river-bridge-entry-paving-${direction < 0 ? 'west' : 'east'}`;
  const materialsByBand = [materials.stoneB, materials.stoneA, materials.stoneC];

  for (let band = 0; band < 3; band++) {
    const t0 = band / 3 + 0.025;
    const t1 = (band + 1) / 3 - 0.025;
    const geometry = createApproachBandGeometry(
      direction,
      deckHalfLength,
      deckHalfWidth,
      deckTop,
      t0,
      t1,
      0.008,
    );
    const paving = new THREE.Mesh(geometry, materialsByBand[band]);
    paving.receiveShadow = true;
    group.add(paving);
  }

  return group;
}

function createApproachBandGeometry(
  direction: -1 | 1,
  deckHalfLength: number,
  deckHalfWidth: number,
  deckTop: number,
  t0: number,
  t1: number,
  yOffset: number,
) {
  const innerHalfWidth = Math.max(ROAD_HALF_WIDTH, deckHalfWidth * 0.985);
  const sample = (t: number) => ({
    x: direction * THREE.MathUtils.lerp(deckHalfLength - 0.08, deckHalfLength + APPROACH_LENGTH, t),
    y: THREE.MathUtils.lerp(deckTop + 0.002, -0.003, t) + yOffset,
    halfWidth: THREE.MathUtils.lerp(innerHalfWidth, ROAD_HALF_WIDTH, t),
  });
  const a = sample(t0);
  const b = sample(t1);

  const positions = new Float32Array([
    a.x, a.y, -a.halfWidth,
    b.x, b.y, -b.halfWidth,
    b.x, b.y, b.halfWidth,
    a.x, a.y, a.halfWidth,
  ]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geometry.setIndex(direction > 0
    ? [0, 2, 1, 0, 3, 2]
    : [0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  return geometry;
}

function buildBridgeApproach(
  direction: -1 | 1,
  deckHalfLength: number,
  deckHalfWidth: number,
  deckTop: number,
  material: THREE.Material,
) {
  const overlap = 0.08;
  const innerX = direction * (deckHalfLength - overlap);
  const outerX = direction * (deckHalfLength + APPROACH_LENGTH);
  const innerY = deckTop + 0.002;
  // The bridge group sits at y ~= 0.02 while the lane surface is around y ~= 0.016.
  // Preserve the existing shallow transition so Alden never encounters a height step.
  const outerY = -0.003;
  const innerHalfWidth = Math.max(ROAD_HALF_WIDTH, deckHalfWidth * 0.985);

  const positions = new Float32Array([
    innerX, innerY, -innerHalfWidth,
    outerX, outerY, -ROAD_HALF_WIDTH,
    outerX, outerY, ROAD_HALF_WIDTH,
    innerX, innerY, innerHalfWidth,
  ]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geometry.setIndex(direction > 0
    ? [0, 2, 1, 0, 3, 2]
    : [0, 1, 2, 0, 2, 3]);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}
