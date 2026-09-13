import * as THREE from 'three';

type TowerStoneMaterials = {
  stone: THREE.MeshStandardMaterial;
  stoneDark: THREE.MeshStandardMaterial;
  stoneLight: THREE.MeshStandardMaterial;
  stoneWarm: THREE.MeshStandardMaterial;
};

type TowerMaterials = {
  foundation: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  armor: THREE.MeshPhysicalMaterial;
  armorEdge: THREE.MeshPhysicalMaterial;
  trim: THREE.MeshPhysicalMaterial;
  energy: THREE.MeshBasicMaterial;
  energySoft: THREE.MeshBasicMaterial;
  crystal: THREE.MeshPhysicalMaterial;
};

const materialCache = new Map<string, TowerMaterials>();

function towerMaterials(team: 'blue' | 'red', stone: TowerStoneMaterials): TowerMaterials {
  const key = [
    team,
    stone.stone.map?.uuid ?? 'stone-no-map',
    stone.stoneDark.map?.uuid ?? 'dark-no-map',
    stone.stoneLight.map?.uuid ?? 'light-no-map',
    stone.stone.bumpMap?.uuid ?? 'stone-no-bump',
    stone.stoneDark.bumpMap?.uuid ?? 'dark-no-bump',
    stone.stoneLight.bumpMap?.uuid ?? 'light-no-bump',
  ].join(':');
  const cached = materialCache.get(key);
  if (cached) return cached;

  const blue = team === 'blue';

  // Keep the existing authored stone textures as the material breakup instead of hiding them
  // behind dark flat tints. Blue favours the light stone source; red stays on the neutral/dark set.
  const foundationTexture = stone.stoneDark.map ?? stone.stone.map ?? stone.stoneLight.map;
  const foundationBump = stone.stoneDark.bumpMap ?? stone.stone.bumpMap ?? foundationTexture;
  const bodySource = blue ? stone.stoneLight : stone.stone;
  const bodyTexture = bodySource.map ?? stone.stone.map ?? stone.stoneLight.map ?? foundationTexture;
  const bodyBump = bodySource.bumpMap ?? stone.stone.bumpMap ?? stone.stoneLight.bumpMap ?? bodyTexture;
  const armorSource = blue ? stone.stone : stone.stoneDark;
  const armorTexture = armorSource.map ?? bodyTexture;
  const armorBump = armorSource.bumpMap ?? stone.stoneDark.bumpMap ?? armorTexture;

  const materials: TowerMaterials = {
    // Structural stone: deliberately mid-value so the pedestal remains readable in shadow.
    foundation: new THREE.MeshStandardMaterial({
      map: foundationTexture,
      bumpMap: foundationBump,
      bumpScale: 0.14,
      color: blue ? 0x929b99 : 0x5f575b,
      emissive: blue ? 0x455052 : 0x2a191c,
      emissiveIntensity: blue ? 0.055 : 0.065,
      roughness: 0.92,
      metalness: 0.025,
    }),

    // Main carved body. The blue faction is intentionally ivory-grey rather than charcoal.
    stone: new THREE.MeshStandardMaterial({
      map: bodyTexture,
      bumpMap: bodyBump,
      bumpScale: 0.16,
      color: blue ? 0xd4d1c5 : 0x857678,
      emissive: blue ? 0x5b5d58 : 0x351f22,
      emissiveIntensity: blue ? 0.052 : 0.06,
      roughness: 0.86,
      metalness: 0.018,
    }),

    // Reinforced plates retain a restrained stone grain but read as treated metal at game distance.
    armor: new THREE.MeshPhysicalMaterial({
      map: armorTexture,
      bumpMap: armorBump,
      bumpScale: 0.052,
      color: blue ? 0x748791 : 0x684b52,
      emissive: blue ? 0x24343a : 0x32171b,
      emissiveIntensity: 0.055,
      roughness: 0.43,
      metalness: 0.52,
      clearcoat: 0.18,
      clearcoatRoughness: 0.48,
    }),

    // Clean metallic ridges separate the armor layers from the textured masonry.
    armorEdge: new THREE.MeshPhysicalMaterial({
      color: blue ? 0xb4c0c2 : 0x987164,
      emissive: blue ? 0x2f3a3c : 0x351f1b,
      emissiveIntensity: 0.045,
      roughness: 0.30,
      metalness: 0.74,
      clearcoat: 0.30,
      clearcoatRoughness: 0.24,
    }),

    // Premium faction trim: soft brass for blue, aged refined bronze/copper for red.
    trim: new THREE.MeshPhysicalMaterial({
      color: blue ? 0xc5a86d : 0x9c6846,
      emissive: blue ? 0x3d3019 : 0x321b12,
      emissiveIntensity: 0.04,
      roughness: 0.31,
      metalness: 0.79,
      clearcoat: 0.38,
      clearcoatRoughness: 0.22,
    }),

    // The hard energy lines stay unlit for readability, but are tone-mapped to avoid cheap neon.
    energy: new THREE.MeshBasicMaterial({
      color: blue ? 0x55cbe5 : 0xe2574e,
      toneMapped: true,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
    }),
    energySoft: new THREE.MeshBasicMaterial({
      color: blue ? 0x88dced : 0xff887d,
      toneMapped: false,
      transparent: true,
      opacity: 0.20,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),

    // Physical crystal with a polished surface and controlled internal emission.
    crystal: new THREE.MeshPhysicalMaterial({
      color: blue ? 0x69d2ec : 0xf05b53,
      emissive: blue ? 0x137fa8 : 0xa72a24,
      emissiveIntensity: blue ? 0.80 : 0.76,
      roughness: 0.13,
      metalness: 0.035,
      ior: 1.46,
      clearcoat: 0.88,
      clearcoatRoughness: 0.065,
      transparent: true,
      opacity: 0.95,
    }),
  };
  materialCache.set(key, materials);
  return materials;
}

function addMesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position = new THREE.Vector3(),
  rotation = new THREE.Euler(),
) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(position);
  mesh.rotation.copy(rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addRing(
  parent: THREE.Object3D,
  inner: number,
  outer: number,
  y: number,
  material: THREE.Material,
  segments = 64,
) {
  const ring = addMesh(parent, new THREE.RingGeometry(inner, outer, segments), material);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = y;
  return ring;
}

function addTorus(
  parent: THREE.Object3D,
  radius: number,
  tube: number,
  y: number,
  material: THREE.Material,
) {
  const torus = addMesh(parent, new THREE.TorusGeometry(radius, tube, 8, 64), material);
  torus.rotation.x = Math.PI / 2;
  torus.position.y = y;
  return torus;
}

function armorPlateGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.48, -0.92);
  shape.lineTo(0.48, -0.92);
  shape.lineTo(0.58, -0.34);
  shape.lineTo(0.38, 0.66);
  shape.lineTo(0, 1.02);
  shape.lineTo(-0.38, 0.66);
  shape.lineTo(-0.58, -0.34);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.10,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.035,
    bevelThickness: 0.035,
    steps: 1,
  });
  geometry.center();
  return geometry;
}

function shoulderFinGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-0.31, -0.56);
  shape.lineTo(0.31, -0.56);
  shape.lineTo(0.22, 0.30);
  shape.lineTo(0, 0.78);
  shape.lineTo(-0.22, 0.30);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.16,
    bevelEnabled: true,
    bevelSize: 0.025,
    bevelThickness: 0.025,
    bevelSegments: 1,
  });
  geometry.center();
  return geometry;
}

function shardGeometry(radius = 0.34, height = 1.25) {
  const geometry = new THREE.OctahedronGeometry(radius, 0);
  geometry.scale(0.78, height / (radius * 2), 0.78);
  return geometry;
}

function createEnergyVein(
  parent: THREE.Object3D,
  angle: number,
  y: number,
  radius: number,
  height: number,
  material: THREE.Material,
) {
  const vein = addMesh(
    parent,
    new THREE.BoxGeometry(0.055, height, 0.028),
    material,
    new THREE.Vector3(Math.sin(angle) * radius, y, Math.cos(angle) * radius),
  );
  vein.rotation.y = angle;
  vein.rotation.z = Math.sin(angle * 2) * 0.11;
  return vein;
}

export function buildDefenseTowerVisual(team: 'blue' | 'red', stone: TowerStoneMaterials) {
  const materials = towerMaterials(team, stone);
  const tower = new THREE.Group();
  tower.name = `${team}-defense-tower`;
  tower.userData.structureKind = 'defense-tower';

  // Heavy stepped plinth: broad, low and faceted so the tower reads as anchored and fortified.
  addMesh(tower, new THREE.CylinderGeometry(1.16, 1.34, 0.16, 8), materials.foundation,
    new THREE.Vector3(0, 0.08, 0), new THREE.Euler(0, Math.PI / 8, 0));
  addMesh(tower, new THREE.CylinderGeometry(1.02, 1.18, 0.18, 8), materials.stone,
    new THREE.Vector3(0, 0.24, 0), new THREE.Euler(0, Math.PI / 8, 0));
  addRing(tower, 0.87, 1.05, 0.345, materials.armor, 48);
  addTorus(tower, 0.96, 0.035, 0.355, materials.trim);

  // Four armored feet create the angular silhouette seen in high-end MOBA defense towers.
  for (let side = 0; side < 4; side++) {
    const angle = side * Math.PI / 2 + Math.PI / 4;
    const foot = addMesh(
      tower,
      new THREE.BoxGeometry(0.58, 0.24, 0.74),
      materials.armor,
      new THREE.Vector3(Math.sin(angle) * 0.91, 0.24, Math.cos(angle) * 0.91),
      new THREE.Euler(0, angle, 0),
    );
    foot.scale.x = 0.86;
    const toe = addMesh(
      tower,
      new THREE.ConeGeometry(0.28, 0.58, 4),
      materials.armorEdge,
      new THREE.Vector3(Math.sin(angle) * 1.15, 0.30, Math.cos(angle) * 1.15),
      new THREE.Euler(Math.PI / 2, 0, -angle),
    );
    toe.scale.set(0.72, 1, 0.46);
  }

  // Tapered central monolith. Several overlapping faceted shells make it feel carved rather than cylindrical.
  addMesh(tower, new THREE.CylinderGeometry(0.62, 0.91, 1.48, 8), materials.foundation,
    new THREE.Vector3(0, 1.08, 0), new THREE.Euler(0, Math.PI / 8, 0));
  addMesh(tower, new THREE.CylinderGeometry(0.51, 0.75, 1.38, 8), materials.armor,
    new THREE.Vector3(0, 1.11, 0), new THREE.Euler(0, Math.PI / 8, 0));

  // Layered armor plates wrap the core and generate deep readable facets from the isometric camera.
  const plateGeometry = armorPlateGeometry();
  for (let side = 0; side < 4; side++) {
    const angle = side * Math.PI / 2;
    const plate = addMesh(
      tower,
      plateGeometry.clone(),
      side % 2 === 0 ? materials.stone : materials.armor,
      new THREE.Vector3(Math.sin(angle) * 0.67, 1.12, Math.cos(angle) * 0.67),
      new THREE.Euler(0, angle, 0),
    );
    plate.scale.set(0.84, 0.78, 0.82);

    const ridge = addMesh(
      tower,
      new THREE.BoxGeometry(0.065, 1.16, 0.08),
      materials.armorEdge,
      new THREE.Vector3(Math.sin(angle) * 0.735, 1.15, Math.cos(angle) * 0.735),
      new THREE.Euler(0, angle, side % 2 === 0 ? 0.12 : -0.12),
    );
    ridge.scale.y = side % 2 === 0 ? 0.92 : 0.78;
  }

  // Thin emissive fissures are inset into the armor, never wide enough to look neon-plastic.
  for (let vein = 0; vein < 8; vein++) {
    const angle = vein * Math.PI / 4 + Math.PI / 8;
    createEnergyVein(tower, angle, 1.05 + (vein % 2) * 0.08, 0.765, vein % 2 ? 0.72 : 0.98, materials.energy);
  }

  addMesh(tower, new THREE.CylinderGeometry(0.76, 0.62, 0.20, 8), materials.stone,
    new THREE.Vector3(0, 1.86, 0), new THREE.Euler(0, Math.PI / 8, 0));
  addRing(tower, 0.50, 0.79, 1.965, materials.armor, 48);
  addTorus(tower, 0.66, 0.045, 1.98, materials.trim);

  // Armored crown with four upward fins around the weapon crystal.
  const crown = new THREE.Group();
  crown.name = `${team}-tower-crown`;
  crown.position.y = 2.04;
  tower.add(crown);

  const finGeometry = shoulderFinGeometry();
  for (let side = 0; side < 4; side++) {
    const angle = side * Math.PI / 2 + Math.PI / 4;
    const fin = addMesh(
      crown,
      finGeometry.clone(),
      side % 2 === 0 ? materials.armor : materials.stone,
      new THREE.Vector3(Math.sin(angle) * 0.54, 0.47, Math.cos(angle) * 0.54),
      new THREE.Euler(0, angle, side % 2 === 0 ? -0.16 : 0.16),
    );
    fin.scale.set(0.78, 1.08, 0.72);

    const finEdge = addMesh(
      crown,
      new THREE.BoxGeometry(0.045, 0.72, 0.055),
      materials.trim,
      new THREE.Vector3(Math.sin(angle) * 0.61, 0.47, Math.cos(angle) * 0.61),
      new THREE.Euler(0, angle, side % 2 === 0 ? 0.18 : -0.18),
    );
    finEdge.scale.y = 0.88;
  }

  // Weapon head: a large central crystal plus asymmetrical satellite shards for a premium silhouette.
  const weapon = new THREE.Group();
  weapon.name = `${team}-tower-weapon`;
  weapon.position.y = 2.60;
  tower.add(weapon);

  const coreCrystal = addMesh(weapon, shardGeometry(0.46, 1.52), materials.crystal);
  coreCrystal.name = `${team}-tower-core-crystal`;
  coreCrystal.rotation.y = Math.PI / 4;

  const innerGlow = addMesh(weapon, shardGeometry(0.25, 1.20), materials.energySoft);
  innerGlow.position.y = -0.03;
  innerGlow.rotation.y = -Math.PI / 4;
  innerGlow.scale.set(0.82, 0.92, 0.82);

  const shardSpecs = [
    { angle: 0.45, radius: 0.52, y: 0.08, scale: 0.62, tilt: -0.28 },
    { angle: 2.18, radius: 0.48, y: -0.02, scale: 0.50, tilt: 0.32 },
    { angle: 4.16, radius: 0.50, y: 0.13, scale: 0.58, tilt: -0.24 },
  ];
  for (const spec of shardSpecs) {
    const shard = addMesh(
      weapon,
      shardGeometry(0.30, 0.94),
      materials.crystal,
      new THREE.Vector3(Math.sin(spec.angle) * spec.radius, spec.y, Math.cos(spec.angle) * spec.radius),
      new THREE.Euler(spec.tilt, spec.angle, -spec.tilt * 0.7),
    );
    shard.scale.setScalar(spec.scale);
  }

  // Discrete energy socket and pulse rings visually connect the crystal to the tower body.
  addMesh(crown, new THREE.CylinderGeometry(0.38, 0.48, 0.18, 12), materials.armor,
    new THREE.Vector3(0, 0.12, 0));
  addRing(crown, 0.28, 0.43, 0.22, materials.energy, 40);
  addTorus(crown, 0.47, 0.028, 0.235, materials.trim);

  const light = new THREE.PointLight(team === 'blue' ? 0x61cde8 : 0xe4574e, 3.2, 4.4, 2);
  light.position.set(0, 2.75, 0);
  tower.add(light);

  // The final authored proportion belongs to the asset itself. Call sites must never scale
  // towers differently by location; this keeps lane/base towers identical in footprint and height.
  tower.scale.set(0.88, 1.72, 0.88);

  tower.userData.animate = (elapsed: number) => {
    weapon.rotation.y = elapsed * (team === 'blue' ? 0.34 : -0.34);
    weapon.position.y = 2.60 + Math.sin(elapsed * 1.55 + (team === 'blue' ? 0 : 0.8)) * 0.045;
    materials.crystal.emissiveIntensity = (team === 'blue' ? 0.76 : 0.72) + Math.sin(elapsed * 2.15) * 0.09;
    materials.energy.opacity = 0.84 + Math.sin(elapsed * 2.6 + 0.5) * 0.04;
    materials.energySoft.opacity = 0.17 + (Math.sin(elapsed * 1.9) + 1) * 0.035;
    light.intensity = 2.8 + (Math.sin(elapsed * 2.1) + 1) * 0.28;
  };

  return tower;
}
