import * as THREE from 'three';
import type { GameEntity } from './gameEntities';

type HeroAttackRangeIndicator = Readonly<{
  root: THREE.Group;
  dispose(): void;
}>;

const indicators = new WeakMap<GameEntity, HeroAttackRangeIndicator>();
const worldScale = new THREE.Vector3();

function paletteFor(entity: GameEntity) {
  switch (entity.team) {
    case 'blue': return { glow: 0x2db8ff, bright: 0xdcf8ff };
    case 'red': return { glow: 0xff4035, bright: 0xffe2dd };
    case 'neutral': return { glow: 0xd89b2f, bright: 0xffefb1 };
  }
}

function rangeMaterial(color: number, opacity: number, additive = false) {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: true,
    toneMapped: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -2;
  return material;
}

function horizontalMesh(
  geometry: THREE.BufferGeometry,
  material: THREE.MeshBasicMaterial,
  y: number,
  renderOrder: number,
) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  mesh.renderOrder = renderOrder;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Adds the local presentation for a hero's basic-attack radius. Selection ownership
 * remains in entitySelection: this indicator only reads root.userData.selected, so it
 * cannot alter selection or issue commands.
 */
export function attachHeroAttackRangeIndicator(entity: GameEntity): void {
  if (entity.kind !== 'hero' || entity.attackRange <= 0 || indicators.has(entity)) return;
  if (typeof window === 'undefined') return;

  const palette = paletteFor(entity);
  const root = new THREE.Group();
  root.name = `${entity.id}-basic-attack-range`;
  root.renderOrder = 70;

  const fillMaterial = rangeMaterial(palette.glow, 0, true);
  const haloMaterial = rangeMaterial(palette.glow, 0, true);
  const edgeMaterial = rangeMaterial(palette.bright, 0);

  const fill = horizontalMesh(new THREE.CircleGeometry(1, 128), fillMaterial, 0.006, 70);
  const halo = horizontalMesh(new THREE.RingGeometry(0.972, 1, 128), haloMaterial, 0.010, 71);
  const edge = horizontalMesh(new THREE.RingGeometry(0.994, 1, 128), edgeMaterial, 0.014, 72);
  root.add(fill, halo, edge);

  // Keep the helper under the hero so it follows movement without another world-space
  // update loop. Its scale is corrected each frame so the radius remains expressed in
  // world units even though Alden's presentation root is scaled down.
  entity.root.add(root);

  let altHeld = false;
  const updateAlt = (event: KeyboardEvent, held: boolean) => {
    if (event.key !== 'Alt' && event.code !== 'AltLeft' && event.code !== 'AltRight') return;
    altHeld = held;
  };
  const onKeyDown = (event: KeyboardEvent) => updateAlt(event, true);
  const onKeyUp = (event: KeyboardEvent) => updateAlt(event, false);
  const onWindowBlur = () => { altHeld = false; };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onWindowBlur);

  fill.onBeforeRender = () => {
    entity.root.getWorldScale(worldScale);
    const scaleX = Math.max(0.0001, Math.abs(worldScale.x));
    const scaleY = Math.max(0.0001, Math.abs(worldScale.y));
    const scaleZ = Math.max(0.0001, Math.abs(worldScale.z));
    root.scale.set(entity.attackRange / scaleX, 1 / scaleY, entity.attackRange / scaleZ);
    root.position.y = 0.035 / scaleY;

    const active = altHeld
      && entity.alive
      && entity.currentHp > 0
      && entity.root.userData.selected === true;
    if (!active) {
      fillMaterial.opacity = 0;
      haloMaterial.opacity = 0;
      edgeMaterial.opacity = 0;
      return;
    }

    const now = performance.now() * 0.001;
    const pulse = (Math.sin(now * 1.8) + 1) * 0.5;
    fillMaterial.opacity = 0.014 + pulse * 0.008;
    haloMaterial.opacity = 0.072 + pulse * 0.026;
    edgeMaterial.opacity = 0.36 + pulse * 0.10;
  };

  indicators.set(entity, {
    root,
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
      fill.onBeforeRender = () => {};
      root.removeFromParent();
      fill.geometry.dispose();
      halo.geometry.dispose();
      edge.geometry.dispose();
      fillMaterial.dispose();
      haloMaterial.dispose();
      edgeMaterial.dispose();
    },
  });
}

export function detachHeroAttackRangeIndicator(entity: GameEntity): void {
  const indicator = indicators.get(entity);
  if (!indicator) return;
  indicator.dispose();
  indicators.delete(entity);
}
