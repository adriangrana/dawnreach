import * as THREE from 'three';

const TELEPORT_PORTAL_HEIGHT = 5.8;
let warmupPromise: Promise<void> | null = null;

function nextFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function portalMaterial(color: number, opacity: number) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  });
}

function buildPortalHelix(
  radius: number,
  turns: number,
  phase: number,
  material: THREE.MeshBasicMaterial,
  tubeRadius: number,
) {
  const points: THREE.Vector3[] = [];
  const samples = 56;
  for (let index = 0; index <= samples; index++) {
    const t = index / samples;
    const angle = phase + t * Math.PI * 2 * turns;
    const breathing = 1 + Math.sin(t * Math.PI * 3 + phase) * 0.055;
    points.push(new THREE.Vector3(
      Math.cos(angle) * radius * breathing,
      0.12 + t * (TELEPORT_PORTAL_HEIGHT - 0.24),
      Math.sin(angle) * radius * breathing,
    ));
  }
  return new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 112, tubeRadius, 5, false),
    material,
  );
}

function buildPortalWisp(
  angle: number,
  radius: number,
  phase: number,
  material: THREE.MeshBasicMaterial,
) {
  const points: THREE.Vector3[] = [];
  const samples = 28;
  for (let index = 0; index <= samples; index++) {
    const t = index / samples;
    const drift = Math.sin(t * Math.PI * 2.4 + phase) * 0.08;
    const twist = angle + Math.sin(t * Math.PI * 1.6 + phase) * 0.16;
    const r = radius + drift;
    points.push(new THREE.Vector3(
      Math.cos(twist) * r,
      0.18 + t * (TELEPORT_PORTAL_HEIGHT - 0.36),
      Math.sin(twist) * r,
    ));
  }
  return new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 56, 0.006, 4, false),
    material,
  );
}

function buildWarmPortal() {
  const root = new THREE.Group();
  const gold = 0xffc94d;
  const paleGold = 0xffe79a;
  const whiteGold = 0xfff8dc;

  const outerVolumeMaterial = portalMaterial(gold, 0.022);
  const middleVolumeMaterial = portalMaterial(paleGold, 0.036);
  const coreVolumeMaterial = portalMaterial(whiteGold, 0.058);
  const filamentMaterial = portalMaterial(gold, 0.32);
  const filamentBrightMaterial = portalMaterial(whiteGold, 0.26);
  const wispMaterial = portalMaterial(paleGold, 0.12);
  const ringMaterial = portalMaterial(paleGold, 0.40);
  const floorGlowMaterial = portalMaterial(gold, 0.075);
  const floorCoreMaterial = portalMaterial(whiteGold, 0.055);
  const particleMaterial = portalMaterial(paleGold, 0.62);
  const brightParticleMaterial = portalMaterial(whiteGold, 0.78);

  const outerVolume = new THREE.Mesh(
    new THREE.CylinderGeometry(0.98, 1.08, TELEPORT_PORTAL_HEIGHT, 64, 1, true),
    outerVolumeMaterial,
  );
  outerVolume.position.y = TELEPORT_PORTAL_HEIGHT * 0.5;
  root.add(outerVolume);

  const middleVolume = new THREE.Mesh(
    new THREE.CylinderGeometry(0.69, 0.82, TELEPORT_PORTAL_HEIGHT * 0.985, 64, 1, true),
    middleVolumeMaterial,
  );
  middleVolume.position.y = TELEPORT_PORTAL_HEIGHT * 0.495;
  root.add(middleVolume);

  const coreVolume = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.42, TELEPORT_PORTAL_HEIGHT * 0.95, 48, 1, true),
    coreVolumeMaterial,
  );
  coreVolume.position.y = TELEPORT_PORTAL_HEIGHT * 0.49;
  root.add(coreVolume);

  const floorGlow = new THREE.Mesh(new THREE.CircleGeometry(1.02, 80), floorGlowMaterial);
  floorGlow.rotation.x = -Math.PI / 2;
  root.add(floorGlow);

  const floorCore = new THREE.Mesh(new THREE.CircleGeometry(0.62, 64), floorCoreMaterial);
  floorCore.rotation.x = -Math.PI / 2;
  root.add(floorCore);

  const baseRing = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.018, 6, 80), ringMaterial);
  baseRing.rotation.x = Math.PI / 2;
  root.add(baseRing);

  const crownRing = new THREE.Mesh(new THREE.TorusGeometry(0.72, 0.014, 6, 72), ringMaterial);
  crownRing.rotation.x = Math.PI / 2;
  root.add(crownRing);

  root.add(
    buildPortalHelix(0.76, 1.65, 0.2, filamentMaterial, 0.012),
    buildPortalHelix(0.48, 1.18, Math.PI * 0.76, wispMaterial, 0.007),
    buildPortalHelix(0.66, -1.42, Math.PI, filamentBrightMaterial, 0.009),
    buildPortalHelix(0.37, -1.02, Math.PI * 1.42, wispMaterial, 0.006),
  );

  for (let index = 0; index < 7; index++) {
    const angle = index / 7 * Math.PI * 2;
    const radius = 0.30 + (index % 3) * 0.16;
    root.add(buildPortalWisp(angle, radius, index * 0.91, wispMaterial));
  }

  const particleGeometry = new THREE.SphereGeometry(0.035, 8, 6);
  for (let index = 0; index < 30; index++) {
    root.add(new THREE.Mesh(
      particleGeometry,
      index % 5 === 0 ? brightParticleMaterial : particleMaterial,
    ));
  }

  root.add(new THREE.PointLight(0xf4b942, 0, 4.8, 2));
  root.updateMatrixWorld(true);
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) object.geometry.computeBoundingSphere();
  });
  return root;
}

function disposeWarmPortal(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (!geometries.has(object.geometry)) {
      geometries.add(object.geometry);
      object.geometry.dispose();
    }
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list) {
      if (materials.has(material)) continue;
      materials.add(material);
      material.dispose();
    }
  });
  root.clear();
}

/**
 * Exercises the exact heavy geometry paths used by the premium TP portal while the
 * loading splash is still covering the game. The portal itself is unchanged; this only
 * moves the one-time V8/Three.js allocation/JIT cost out of the first player cast.
 */
export function warmTeleportPortalGeometry() {
  if (warmupPromise) return warmupPromise;
  warmupPromise = (async () => {
    await nextFrame();
    const first = buildWarmPortal();
    disposeWarmPortal(first);

    // A second pass makes the first real cast use already-hot constructor/code paths for
    // both origin and destination portals without keeping duplicate world resources alive.
    await nextFrame();
    const second = buildWarmPortal();
    disposeWarmPortal(second);
  })();
  return warmupPromise;
}
