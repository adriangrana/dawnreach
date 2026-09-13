import * as THREE from 'three';
import type { GameEntity, GameEntityKind, GameEntityRegistry, TeamId } from './gameEntities';
import { getGameEntity } from './gameEntities';

export type EntitySelectionController = Readonly<{
  getSelected(): GameEntity | null;
  pick(raycaster: THREE.Raycaster): GameEntity | null;
  select(entity: GameEntity | null): void;
  update(): void;
  dispose(): void;
}>;

type SelectionPalette = Readonly<{
  primary: number;
  bright: number;
  glow: number;
  shadow: number;
}>;

type SelectionStyle = Readonly<{
  glowInner: number;
  glowOuter: number;
  shadowInner: number;
  shadowOuter: number;
  mainInner: number;
  mainOuter: number;
  innerAccentInner: number;
  innerAccentOuter: number;
  segmentInner: number;
  segmentOuter: number;
  segmentCount: number;
  segmentCoverage: number;
  tickCount: number;
  tickRadius: number;
  tickLength: number;
  tickWidth: number;
  scale: number;
  yOffset: number;
  rotationSpeed: number;
  counterRotationSpeed: number;
  pulseSpeed: number;
  pulseAmount: number;
  glowOpacity: number;
  mainOpacity: number;
  accentOpacity: number;
}>;

type SelectionVisual = Readonly<{
  root: THREE.Group;
  outerRotor: THREE.Group;
  innerRotor: THREE.Group;
  glowMaterial: THREE.MeshBasicMaterial;
  pulseMaterials: readonly THREE.MeshBasicMaterial[];
  style: SelectionStyle;
}>;

const STYLE_BY_KIND: Record<GameEntityKind, SelectionStyle> = {
  hero: {
    glowInner: 0.76,
    glowOuter: 1.12,
    shadowInner: 0.80,
    shadowOuter: 0.94,
    mainInner: 0.84,
    mainOuter: 0.91,
    innerAccentInner: 0.765,
    innerAccentOuter: 0.79,
    segmentInner: 0.975,
    segmentOuter: 1.035,
    segmentCount: 4,
    segmentCoverage: 0.54,
    tickCount: 4,
    tickRadius: 1.09,
    tickLength: 0.17,
    tickWidth: 0.025,
    scale: 1,
    yOffset: 0.055,
    rotationSpeed: 0.18,
    counterRotationSpeed: -0.08,
    pulseSpeed: 2.2,
    pulseAmount: 0.012,
    glowOpacity: 0.16,
    mainOpacity: 0.95,
    accentOpacity: 0.74,
  },
  creep: {
    glowInner: 0.80,
    glowOuter: 1.08,
    shadowInner: 0.83,
    shadowOuter: 0.95,
    mainInner: 0.86,
    mainOuter: 0.92,
    innerAccentInner: 0.79,
    innerAccentOuter: 0.81,
    segmentInner: 0.97,
    segmentOuter: 1.025,
    segmentCount: 4,
    segmentCoverage: 0.38,
    tickCount: 4,
    tickRadius: 1.06,
    tickLength: 0.11,
    tickWidth: 0.018,
    scale: 0.96,
    yOffset: 0.045,
    rotationSpeed: 0.12,
    counterRotationSpeed: -0.05,
    pulseSpeed: 2,
    pulseAmount: 0.008,
    glowOpacity: 0.11,
    mainOpacity: 0.9,
    accentOpacity: 0.58,
  },
  tower: {
    glowInner: 0.72,
    glowOuter: 1.13,
    shadowInner: 0.77,
    shadowOuter: 0.92,
    mainInner: 0.81,
    mainOuter: 0.88,
    innerAccentInner: 0.735,
    innerAccentOuter: 0.76,
    segmentInner: 0.965,
    segmentOuter: 1.035,
    segmentCount: 8,
    segmentCoverage: 0.52,
    tickCount: 4,
    tickRadius: 1.095,
    tickLength: 0.21,
    tickWidth: 0.028,
    scale: 1,
    yOffset: 0.06,
    rotationSpeed: 0.11,
    counterRotationSpeed: -0.045,
    pulseSpeed: 1.65,
    pulseAmount: 0.009,
    glowOpacity: 0.14,
    mainOpacity: 0.94,
    accentOpacity: 0.76,
  },
  building: {
    glowInner: 0.70,
    glowOuter: 1.11,
    shadowInner: 0.75,
    shadowOuter: 0.91,
    mainInner: 0.80,
    mainOuter: 0.87,
    innerAccentInner: 0.72,
    innerAccentOuter: 0.745,
    segmentInner: 0.95,
    segmentOuter: 1.02,
    segmentCount: 4,
    segmentCoverage: 0.62,
    tickCount: 4,
    tickRadius: 1.08,
    tickLength: 0.25,
    tickWidth: 0.03,
    scale: 1,
    yOffset: 0.055,
    rotationSpeed: 0.055,
    counterRotationSpeed: -0.025,
    pulseSpeed: 1.35,
    pulseAmount: 0.006,
    glowOpacity: 0.12,
    mainOpacity: 0.92,
    accentOpacity: 0.68,
  },
  shop: {
    glowInner: 0.74,
    glowOuter: 1.14,
    shadowInner: 0.79,
    shadowOuter: 0.93,
    mainInner: 0.83,
    mainOuter: 0.90,
    innerAccentInner: 0.755,
    innerAccentOuter: 0.785,
    segmentInner: 0.965,
    segmentOuter: 1.04,
    segmentCount: 6,
    segmentCoverage: 0.44,
    tickCount: 4,
    tickRadius: 1.095,
    tickLength: 0.18,
    tickWidth: 0.025,
    scale: 1,
    yOffset: 0.055,
    rotationSpeed: -0.14,
    counterRotationSpeed: 0.065,
    pulseSpeed: 1.8,
    pulseAmount: 0.01,
    glowOpacity: 0.15,
    mainOpacity: 0.94,
    accentOpacity: 0.78,
  },
  'jungle-creature': {
    glowInner: 0.78,
    glowOuter: 1.10,
    shadowInner: 0.82,
    shadowOuter: 0.94,
    mainInner: 0.85,
    mainOuter: 0.91,
    innerAccentInner: 0.77,
    innerAccentOuter: 0.80,
    segmentInner: 0.96,
    segmentOuter: 1.03,
    segmentCount: 5,
    segmentCoverage: 0.40,
    tickCount: 5,
    tickRadius: 1.075,
    tickLength: 0.13,
    tickWidth: 0.021,
    scale: 0.98,
    yOffset: 0.05,
    rotationSpeed: 0.09,
    counterRotationSpeed: -0.04,
    pulseSpeed: 1.7,
    pulseAmount: 0.01,
    glowOpacity: 0.13,
    mainOpacity: 0.91,
    accentOpacity: 0.66,
  },
};

function teamPalette(team: TeamId): SelectionPalette {
  switch (team) {
    case 'blue':
      return { primary: 0x53d6ff, bright: 0xdcf8ff, glow: 0x2db8ff, shadow: 0x071821 };
    case 'red':
      return { primary: 0xff685c, bright: 0xffe2dd, glow: 0xff4035, shadow: 0x210b09 };
    case 'neutral':
      return { primary: 0xecc45c, bright: 0xffefb1, glow: 0xd89b2f, shadow: 0x201806 };
  }
}

function markerMaterial(color: number, opacity: number, additive = false) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

function addHorizontalRing(
  parent: THREE.Object3D,
  innerRadius: number,
  outerRadius: number,
  material: THREE.MeshBasicMaterial,
  renderOrder: number,
  y = 0,
) {
  const mesh = new THREE.Mesh(new THREE.RingGeometry(innerRadius, outerRadius, 96), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  mesh.renderOrder = renderOrder;
  parent.add(mesh);
  return mesh;
}

function buildSelectionVisual(entity: GameEntity): SelectionVisual {
  const style = STYLE_BY_KIND[entity.kind];
  const palette = teamPalette(entity.team);
  const root = new THREE.Group();
  root.name = `selection-${entity.kind}`;

  const glowMaterial = markerMaterial(palette.glow, style.glowOpacity, true);
  const shadowMaterial = markerMaterial(palette.shadow, 0.58);
  const mainMaterial = markerMaterial(palette.primary, style.mainOpacity);
  const brightMaterial = markerMaterial(palette.bright, style.accentOpacity);
  const segmentMaterial = markerMaterial(palette.primary, Math.min(1, style.accentOpacity + 0.08));
  const pulseMaterials = [glowMaterial, mainMaterial, brightMaterial, segmentMaterial] as const;

  addHorizontalRing(root, style.glowInner, style.glowOuter, glowMaterial, 78, 0.000);
  addHorizontalRing(root, style.shadowInner, style.shadowOuter, shadowMaterial, 79, 0.003);
  addHorizontalRing(root, style.mainInner, style.mainOuter, mainMaterial, 80, 0.006);
  addHorizontalRing(root, style.innerAccentInner, style.innerAccentOuter, brightMaterial, 81, 0.009);

  const outerRotor = new THREE.Group();
  outerRotor.name = 'selection-outer-rotor';
  const segmentStep = Math.PI * 2 / style.segmentCount;
  const segmentLength = segmentStep * style.segmentCoverage;
  for (let index = 0; index < style.segmentCount; index++) {
    const start = index * segmentStep - segmentLength / 2;
    const segment = new THREE.Mesh(
      new THREE.RingGeometry(style.segmentInner, style.segmentOuter, 24, 1, start, segmentLength),
      segmentMaterial,
    );
    segment.rotation.x = -Math.PI / 2;
    segment.position.y = 0.012;
    segment.renderOrder = 82;
    outerRotor.add(segment);
  }
  root.add(outerRotor);

  const innerRotor = new THREE.Group();
  innerRotor.name = 'selection-inner-rotor';
  for (let index = 0; index < style.tickCount; index++) {
    const angle = index * Math.PI * 2 / style.tickCount;
    const tick = new THREE.Mesh(
      new THREE.BoxGeometry(style.tickWidth, 0.014, style.tickLength),
      brightMaterial,
    );
    tick.position.set(
      Math.sin(angle) * style.tickRadius,
      0.016,
      Math.cos(angle) * style.tickRadius,
    );
    tick.rotation.y = angle;
    tick.renderOrder = 83;
    innerRotor.add(tick);
  }
  root.add(innerRotor);

  // Buildings and towers get restrained corner pips. They make large structures feel
  // deliberately framed without turning the marker into a thick arcade-style circle.
  if (entity.kind === 'tower' || entity.kind === 'building' || entity.kind === 'shop') {
    const pipCount = entity.kind === 'shop' ? 6 : 4;
    const pipRadius = style.tickRadius - 0.02;
    const pipMaterial = markerMaterial(palette.bright, 0.68);
    pulseMaterials.push?.(pipMaterial);
    for (let index = 0; index < pipCount; index++) {
      const angle = index * Math.PI * 2 / pipCount + Math.PI / 4;
      const pip = new THREE.Mesh(new THREE.PlaneGeometry(0.055, 0.055), pipMaterial);
      pip.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
      pip.position.set(Math.sin(angle) * pipRadius, 0.018, Math.cos(angle) * pipRadius);
      pip.renderOrder = 84;
      root.add(pip);
    }
  }

  return { root, outerRotor, innerRotor, glowMaterial, pulseMaterials, style };
}

function disposeSelectionVisual(visual: SelectionVisual | null) {
  if (!visual) return;
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  visual.root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (!geometries.has(object.geometry)) {
      geometries.add(object.geometry);
      object.geometry.dispose();
    }
    const materialList = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materialList) {
      if (materials.has(material)) continue;
      materials.add(material);
      material.dispose();
    }
  });
}

export function createEntitySelectionController(
  scene: THREE.Scene,
  registry: GameEntityRegistry,
  canSelect: (entity: GameEntity) => boolean = () => true,
): EntitySelectionController {
  const marker = new THREE.Group();
  marker.name = 'selected-entity-marker';
  marker.visible = false;
  marker.renderOrder = 78;
  scene.add(marker);

  const worldPosition = new THREE.Vector3();
  let selected: GameEntity | null = null;
  let visual: SelectionVisual | null = null;
  let selectedAt = 0;

  const rebuildVisual = (entity: GameEntity) => {
    if (visual) {
      marker.remove(visual.root);
      disposeSelectionVisual(visual);
    }
    visual = buildSelectionVisual(entity);
    marker.add(visual.root);
    selectedAt = performance.now() * 0.001;
  };

  const setSelected = (entity: GameEntity | null) => {
    const next = entity && entity.selectable && entity.alive && canSelect(entity) ? entity : null;
    if (selected === next) return;

    if (selected) selected.root.userData.selected = false;
    selected = next;
    marker.visible = selected !== null;

    if (!selected) {
      if (visual) {
        marker.remove(visual.root);
        disposeSelectionVisual(visual);
        visual = null;
      }
      return;
    }

    selected.root.userData.selected = true;
    rebuildVisual(selected);
  };

  const pick = (raycaster: THREE.Raycaster) => {
    const selectable = registry.selectable().filter(canSelect);
    if (selectable.length === 0) {
      setSelected(null);
      return null;
    }

    const roots = selectable.map(entity => entity.root);
    const hits = raycaster.intersectObjects(roots, true);
    for (const hit of hits) {
      const entity = getGameEntity(hit.object);
      if (!entity || !entity.selectable || !entity.alive || !canSelect(entity)) continue;
      setSelected(entity);
      return entity;
    }

    setSelected(null);
    return null;
  };

  const update = () => {
    if (!selected || !selected.alive || !selected.root.parent || !canSelect(selected)) {
      setSelected(null);
      return;
    }
    if (!visual) rebuildVisual(selected);
    if (!visual) return;

    selected.root.getWorldPosition(worldPosition);
    const now = performance.now() * 0.001;
    const age = Math.max(0, now - selectedAt);
    const intro = THREE.MathUtils.smoothstep(age, 0, 0.15);
    const pulse = Math.sin(now * visual.style.pulseSpeed);
    const scale = selected.selectionRadius
      * visual.style.scale
      * (1 + pulse * visual.style.pulseAmount)
      * (0.94 + intro * 0.06);

    marker.position.set(worldPosition.x, worldPosition.y + visual.style.yOffset, worldPosition.z);
    marker.scale.setScalar(scale);
    visual.outerRotor.rotation.y = now * visual.style.rotationSpeed;
    visual.innerRotor.rotation.y = now * visual.style.counterRotationSpeed;
    visual.glowMaterial.opacity = visual.style.glowOpacity * (0.91 + (pulse + 1) * 0.08) * intro;

    for (const material of visual.pulseMaterials) {
      if (material === visual.glowMaterial) continue;
      material.opacity = Math.min(1, material.opacity * 0.96 + intro * 0.04);
    }
  };

  return {
    getSelected: () => selected,
    pick,
    select: setSelected,
    update,
    dispose() {
      if (selected) selected.root.userData.selected = false;
      selected = null;
      if (visual) {
        marker.remove(visual.root);
        disposeSelectionVisual(visual);
        visual = null;
      }
      scene.remove(marker);
    },
  };
}
