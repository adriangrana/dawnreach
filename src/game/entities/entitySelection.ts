import * as THREE from 'three';
import type { GameEntity, GameEntityKind, GameEntityRegistry, TeamId } from './gameEntities';
import { getGameEntity } from './gameEntities';
import { createSelectionHudBridge } from './selectionHudOverlay';

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
  glowBaseOpacity: number;
  style: SelectionStyle;
}>;

type RangeVisual = Readonly<{
  root: THREE.Group;
  fillMaterial: THREE.MeshBasicMaterial;
  haloMaterial: THREE.MeshBasicMaterial;
  edgeMaterial: THREE.MeshBasicMaterial;
}>;

type AttackIntentVisual = Readonly<{
  root: THREE.Group;
  material: THREE.MeshBasicMaterial;
}>;

const COMMAND_MARKER_GROUND_OFFSET = 0.102;
const ATTACK_TARGET_CONFIRM_SECONDS = 1.5;
const ATTACK_TARGET_GROUND_OFFSET = 0.035;

const STYLE_BY_KIND: Record<GameEntityKind, SelectionStyle> = {
  hero: {
    glowInner: 0.79,
    glowOuter: 1.10,
    shadowInner: 0.825,
    shadowOuter: 0.91,
    mainInner: 0.85,
    mainOuter: 0.888,
    innerAccentInner: 0.79,
    innerAccentOuter: 0.803,
    segmentInner: 0.982,
    segmentOuter: 1.018,
    segmentCount: 4,
    segmentCoverage: 0.54,
    tickCount: 4,
    tickRadius: 1.07,
    tickLength: 0.15,
    tickWidth: 0.016,
    scale: 1,
    yOffset: 0.055,
    rotationSpeed: 0.18,
    counterRotationSpeed: -0.08,
    pulseSpeed: 2.2,
    // Heroes move continuously every render frame. Keeping the geometry size stable
    // avoids a perceived flicker/jump while the marker follows locomotion.
    pulseAmount: 0,
    glowOpacity: 0.13,
    mainOpacity: 0.95,
    accentOpacity: 0.72,
  },
  creep: {
    glowInner: 0.82,
    glowOuter: 1.065,
    shadowInner: 0.845,
    shadowOuter: 0.91,
    mainInner: 0.862,
    mainOuter: 0.892,
    innerAccentInner: 0.81,
    innerAccentOuter: 0.822,
    segmentInner: 0.98,
    segmentOuter: 1.012,
    segmentCount: 4,
    segmentCoverage: 0.38,
    tickCount: 4,
    tickRadius: 1.045,
    tickLength: 0.10,
    tickWidth: 0.012,
    scale: 0.96,
    yOffset: 0.045,
    rotationSpeed: 0.12,
    counterRotationSpeed: -0.05,
    pulseSpeed: 2,
    pulseAmount: 0.008,
    glowOpacity: 0.09,
    mainOpacity: 0.90,
    accentOpacity: 0.56,
  },
  tower: {
    glowInner: 0.77,
    glowOuter: 1.10,
    shadowInner: 0.79,
    shadowOuter: 0.895,
    mainInner: 0.815,
    mainOuter: 0.852,
    innerAccentInner: 0.77,
    innerAccentOuter: 0.784,
    segmentInner: 0.982,
    segmentOuter: 1.018,
    segmentCount: 8,
    segmentCoverage: 0.50,
    tickCount: 4,
    tickRadius: 1.075,
    tickLength: 0.18,
    tickWidth: 0.016,
    scale: 1,
    yOffset: 0.06,
    rotationSpeed: 0.11,
    counterRotationSpeed: -0.045,
    pulseSpeed: 1.65,
    pulseAmount: 0.009,
    glowOpacity: 0.11,
    mainOpacity: 0.94,
    accentOpacity: 0.74,
  },
  building: {
    glowInner: 0.75,
    glowOuter: 1.085,
    shadowInner: 0.77,
    shadowOuter: 0.885,
    mainInner: 0.805,
    mainOuter: 0.842,
    innerAccentInner: 0.75,
    innerAccentOuter: 0.764,
    segmentInner: 0.972,
    segmentOuter: 1.008,
    segmentCount: 4,
    segmentCoverage: 0.60,
    tickCount: 4,
    tickRadius: 1.06,
    tickLength: 0.22,
    tickWidth: 0.017,
    scale: 1,
    yOffset: 0.055,
    rotationSpeed: 0.055,
    counterRotationSpeed: -0.025,
    pulseSpeed: 1.35,
    pulseAmount: 0.006,
    glowOpacity: 0.095,
    mainOpacity: 0.92,
    accentOpacity: 0.66,
  },
  shop: {
    glowInner: 0.78,
    glowOuter: 1.105,
    shadowInner: 0.80,
    shadowOuter: 0.90,
    mainInner: 0.835,
    mainOuter: 0.872,
    innerAccentInner: 0.785,
    innerAccentOuter: 0.800,
    segmentInner: 0.982,
    segmentOuter: 1.020,
    segmentCount: 6,
    segmentCoverage: 0.42,
    tickCount: 4,
    tickRadius: 1.075,
    tickLength: 0.16,
    tickWidth: 0.015,
    scale: 1,
    yOffset: 0.055,
    rotationSpeed: -0.14,
    counterRotationSpeed: 0.065,
    pulseSpeed: 1.8,
    pulseAmount: 0.01,
    glowOpacity: 0.12,
    mainOpacity: 0.94,
    accentOpacity: 0.76,
  },
  'jungle-creature': {
    glowInner: 0.81,
    glowOuter: 1.075,
    shadowInner: 0.835,
    shadowOuter: 0.91,
    mainInner: 0.855,
    mainOuter: 0.89,
    innerAccentInner: 0.80,
    innerAccentOuter: 0.813,
    segmentInner: 0.977,
    segmentOuter: 1.013,
    segmentCount: 5,
    segmentCoverage: 0.40,
    tickCount: 5,
    tickRadius: 1.055,
    tickLength: 0.12,
    tickWidth: 0.014,
    scale: 0.98,
    yOffset: 0.05,
    rotationSpeed: 0.09,
    counterRotationSpeed: -0.04,
    pulseSpeed: 1.7,
    pulseAmount: 0.01,
    glowOpacity: 0.10,
    mainOpacity: 0.91,
    accentOpacity: 0.64,
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
    depthTest: true,
    toneMapped: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}

function groundOverlayMaterial(color: number, opacity: number, additive = false) {
  const material = markerMaterial(color, opacity, additive);
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -2;
  return material;
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
}

function buildSelectionVisual(entity: GameEntity): SelectionVisual {
  const style = STYLE_BY_KIND[entity.kind];
  const palette = teamPalette(entity.team);
  const root = new THREE.Group();
  root.name = `selection-${entity.kind}`;

  const glowMaterial = markerMaterial(palette.glow, style.glowOpacity, true);
  const shadowMaterial = markerMaterial(palette.shadow, 0.50);
  const mainMaterial = markerMaterial(palette.primary, style.mainOpacity);
  const brightMaterial = markerMaterial(palette.bright, style.accentOpacity);
  const segmentMaterial = markerMaterial(palette.primary, Math.min(1, style.accentOpacity + 0.08));

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
      new THREE.BoxGeometry(style.tickWidth, 0.012, style.tickLength),
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

  if (entity.kind === 'tower' || entity.kind === 'building' || entity.kind === 'shop') {
    const pipCount = entity.kind === 'shop' ? 6 : 4;
    const pipRadius = style.tickRadius - 0.02;
    const pipMaterial = markerMaterial(palette.bright, 0.62);
    for (let index = 0; index < pipCount; index++) {
      const angle = index * Math.PI * 2 / pipCount + Math.PI / 4;
      const pip = new THREE.Mesh(new THREE.PlaneGeometry(0.042, 0.042), pipMaterial);
      pip.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
      pip.position.set(Math.sin(angle) * pipRadius, 0.018, Math.cos(angle) * pipRadius);
      pip.renderOrder = 84;
      root.add(pip);
    }
  }

  return {
    root,
    outerRotor,
    innerRotor,
    glowMaterial,
    glowBaseOpacity: style.glowOpacity,
    style,
  };
}

function buildAttackIntentVisual(name: string, opacity: number): AttackIntentVisual {
  const root = new THREE.Group();
  root.name = name;
  root.visible = false;

  const material = groundOverlayMaterial(0xff3f38, opacity);
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -3;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.962, 1.0, 96), material);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.004;
  ring.renderOrder = 85;
  root.add(ring);

  return { root, material };
}

function buildTowerRangeVisual(entity: GameEntity): RangeVisual | null {
  if (entity.kind !== 'tower' || entity.attackRange <= 0) return null;

  const palette = teamPalette(entity.team);
  const root = new THREE.Group();
  root.name = 'tower-attack-range';
  root.visible = false;

  const fillMaterial = groundOverlayMaterial(palette.glow, 0.018, true);
  const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 128), fillMaterial);
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = 0.006;
  fill.renderOrder = 70;
  root.add(fill);

  const haloMaterial = groundOverlayMaterial(palette.glow, 0.085, true);
  addHorizontalRing(root, 0.972, 1.0, haloMaterial, 71, 0.010);

  const edgeMaterial = groundOverlayMaterial(palette.bright, 0.42);
  addHorizontalRing(root, 0.994, 1.0, edgeMaterial, 72, 0.014);

  root.scale.setScalar(entity.attackRange);
  return { root, fillMaterial, haloMaterial, edgeMaterial };
}

function updateRangeVisualPulse(visual: RangeVisual, now: number) {
  const rangePulse = (Math.sin(now * 1.6) + 1) * 0.5;
  visual.fillMaterial.opacity = 0.014 + rangePulse * 0.008;
  visual.haloMaterial.opacity = 0.072 + rangePulse * 0.026;
  visual.edgeMaterial.opacity = 0.36 + rangePulse * 0.10;
}

function disposeObjectVisual(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
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

function disposeSelectionVisual(visual: SelectionVisual | null) {
  if (visual) disposeObjectVisual(visual.root);
}

function disposeRangeVisual(visual: RangeVisual | null) {
  if (visual) disposeObjectVisual(visual.root);
}

function groundCommandMarkers(scene: THREE.Scene) {
  scene.traverse((object) => {
    if (!(object instanceof THREE.Group)) return;
    const kind = object.userData.kind;
    if (kind !== 'move' && kind !== 'attack') return;
    if (object.userData.dawnreachGroundedCommandMarker === true) return;
    object.userData.dawnreachGroundedCommandMarker = true;

    object.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.position.y -= COMMAND_MARKER_GROUND_OFFSET;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (!(material instanceof THREE.MeshBasicMaterial)) continue;
        material.depthTest = true;
        material.depthWrite = false;
        material.polygonOffset = true;
        material.polygonOffsetFactor = -1;
        material.polygonOffsetUnits = -1;
        material.needsUpdate = true;
      }
    });
  });
}

function hideLegacyHeroRing(hero: GameEntity | null) {
  if (!hero) return;
  hero.root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !(object.geometry instanceof THREE.RingGeometry)) return;
    const parameters = object.geometry.parameters as { innerRadius?: number; outerRadius?: number };
    const innerRadius = Number(parameters.innerRadius ?? 0);
    const outerRadius = Number(parameters.outerRadius ?? 0);
    if (Math.abs(innerRadius - 0.62) > 0.025 || Math.abs(outerRadius - 0.72) > 0.025) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const legacyMintRing = materials.some(material =>
      material instanceof THREE.MeshBasicMaterial && material.color.getHex() === 0x63f0c2,
    );
    if (legacyMintRing) object.visible = false;
  });
}

function focusLocalHeroViaGameCamera() {
  window.dispatchEvent(new KeyboardEvent('keydown', {
    key: ' ',
    code: 'Space',
    bubbles: true,
    cancelable: true,
  }));
}

export function createEntitySelectionController(
  scene: THREE.Scene,
  registry: GameEntityRegistry,
  canSelect: (entity: GameEntity) => boolean = () => true,
  localTeam: TeamId = 'blue',
): EntitySelectionController {
  groundCommandMarkers(scene);

  const marker = new THREE.Group();
  marker.name = 'selected-entity-marker';
  marker.visible = false;
  marker.renderOrder = 78;
  scene.add(marker);

  const attackHoverVisual = buildAttackIntentVisual('hostile-hover-target-marker', 0.72);
  const attackTargetVisual = buildAttackIntentVisual('confirmed-attack-target-marker', 0.94);
  scene.add(attackHoverVisual.root, attackTargetVisual.root);

  const localHero = registry.values().find(entity => entity.kind === 'hero' && entity.team === localTeam) ?? null;
  hideLegacyHeroRing(localHero);
  const hudBridge = createSelectionHudBridge(localHero);

  const worldPosition = new THREE.Vector3();
  const attackIntentWorldPosition = new THREE.Vector3();
  const enemyTowerWorldPosition = new THREE.Vector3();
  const enemyTowerRanges = new Map<GameEntity, RangeVisual>();
  const attackPointer = new THREE.Vector2();
  const attackPointerRaycaster = new THREE.Raycaster();
  const legacyAttackCommandMarker = scene.children.find(object =>
    object instanceof THREE.Group && object.userData.kind === 'attack',
  ) as THREE.Group | undefined;
  let selected: GameEntity | null = null;
  let visual: SelectionVisual | null = null;
  let rangeVisual: RangeVisual | null = null;
  let selectedAt = 0;
  let altHeld = false;
  let attackCommandArmed = false;
  let gameplayCamera: THREE.Camera | null = null;
  let hoveredAttackTarget: GameEntity | null = null;
  let confirmedAttackTarget: GameEntity | null = null;
  let confirmedAttackUntil = 0;

  const canShowAttackIntentFor = (entity: GameEntity | null): entity is GameEntity => {
    if (!entity || entity === localHero || entity.team === localTeam) return false;
    if (!entity.targetable || !entity.alive || entity.currentHp <= 0 || entity.maxHp <= 0) return false;
    if (!canSelect(entity)) return false;
    if ((entity.kind === 'tower' || entity.kind === 'building') && entity.interaction !== 'attackable-structure') return false;
    return true;
  };

  const syncAttackIntentVisual = (
    attackVisual: AttackIntentVisual,
    entity: GameEntity | null,
    visible: boolean,
  ) => {
    attackVisual.root.visible = Boolean(visible && entity && entity.root.parent && canShowAttackIntentFor(entity));
    if (!attackVisual.root.visible || !entity) return;
    entity.root.getWorldPosition(attackIntentWorldPosition);
    attackVisual.root.position.set(
      attackIntentWorldPosition.x,
      attackIntentWorldPosition.y + ATTACK_TARGET_GROUND_OFFSET,
      attackIntentWorldPosition.z,
    );
    attackVisual.root.scale.setScalar(Math.max(0.24, entity.selectionRadius * 1.06));
  };

  const syncAttackIntentMarkers = () => {
    const now = performance.now() * 0.001;
    if (confirmedAttackTarget && (now >= confirmedAttackUntil || !canShowAttackIntentFor(confirmedAttackTarget))) {
      confirmedAttackTarget = null;
      confirmedAttackUntil = 0;
    }
    if (hoveredAttackTarget && !canShowAttackIntentFor(hoveredAttackTarget)) hoveredAttackTarget = null;

    syncAttackIntentVisual(
      attackTargetVisual,
      confirmedAttackTarget,
      confirmedAttackTarget !== null && now < confirmedAttackUntil,
    );
    syncAttackIntentVisual(
      attackHoverVisual,
      hoveredAttackTarget,
      hoveredAttackTarget !== null && hoveredAttackTarget !== confirmedAttackTarget,
    );
  };

  const isGameplayCanvas = (target: EventTarget | null): target is HTMLCanvasElement => (
    target instanceof HTMLCanvasElement && target.classList.contains('game-canvas')
  );

  const pickAttackIntentTarget = (event: PointerEvent) => {
    if (!gameplayCamera || !isGameplayCanvas(event.target)) return null;
    const rect = event.target.getBoundingClientRect();
    attackPointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    attackPointer.y = -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    attackPointerRaycaster.setFromCamera(attackPointer, gameplayCamera);

    const candidates = registry.values().filter(canShowAttackIntentFor);
    if (candidates.length === 0) return null;
    const hits = attackPointerRaycaster.intersectObjects(candidates.map(entity => entity.root), true);
    for (const hit of hits) {
      const entity = getGameEntity(hit.object);
      if (canShowAttackIntentFor(entity)) return entity;
    }
    return null;
  };

  const confirmAttackIntent = (entity: GameEntity) => {
    confirmedAttackTarget = entity;
    confirmedAttackUntil = performance.now() * 0.001 + ATTACK_TARGET_CONFIRM_SECONDS;
    // Target attacks use the thin hitbox halo instead of the older ornate ground marker.
    if (legacyAttackCommandMarker) legacyAttackCommandMarker.visible = false;
    syncAttackIntentMarkers();
  };

  const previousSceneBeforeRender = scene.onBeforeRender;
  const attackIntentBeforeRender: typeof scene.onBeforeRender = function(
    renderer,
    renderedScene,
    camera,
    geometry,
    material,
    group,
  ) {
    const minimapCamera = camera.position.y > 60 && camera.up.z < -0.5;
    if (minimapCamera) {
      attackHoverVisual.root.visible = false;
      attackTargetVisual.root.visible = false;
    } else {
      gameplayCamera = camera;
      syncAttackIntentMarkers();
    }
    previousSceneBeforeRender.call(scene, renderer, renderedScene, camera, geometry, material, group);
  };
  scene.onBeforeRender = attackIntentBeforeRender;

  // Selection.update() is called before local hero locomotion in the main game loop.
  // Sync the marker again when Three.js resolves world matrices for rendering so the
  // halo uses the hero's current-frame transform instead of trailing by one frame.
  const baseMarkerUpdateMatrixWorld = marker.updateMatrixWorld.bind(marker);
  marker.updateMatrixWorld = (force?: boolean) => {
    if (selected && visual && selected.alive && selected.root.parent) {
      selected.root.getWorldPosition(worldPosition);
      marker.position.set(
        worldPosition.x,
        worldPosition.y + visual.style.yOffset,
        worldPosition.z,
      );
    }
    baseMarkerUpdateMatrixWorld(force);
  };

  for (const entity of registry.values()) {
    if (entity.kind !== 'tower' || entity.team === localTeam || entity.team === 'neutral' || entity.attackRange <= 0) continue;
    const enemyRangeVisual = buildTowerRangeVisual(entity);
    if (!enemyRangeVisual) continue;
    enemyRangeVisual.root.name = `enemy-${entity.id}-attack-range`;
    scene.add(enemyRangeVisual.root);
    enemyTowerRanges.set(entity, enemyRangeVisual);
  }

  const clearRangeVisual = () => {
    if (!rangeVisual) return;
    scene.remove(rangeVisual.root);
    disposeRangeVisual(rangeVisual);
    rangeVisual = null;
  };

  const clearSelectionVisual = () => {
    if (!visual) return;
    marker.remove(visual.root);
    disposeSelectionVisual(visual);
    visual = null;
  };

  const rebuildVisual = (entity: GameEntity) => {
    clearSelectionVisual();
    visual = buildSelectionVisual(entity);
    marker.add(visual.root);

    clearRangeVisual();
    rangeVisual = buildTowerRangeVisual(entity);
    if (rangeVisual) scene.add(rangeVisual.root);

    selectedAt = performance.now() * 0.001;
  };

  const canKeepSelected = (entity: GameEntity) => entity.selectable
    && canSelect(entity)
    && (entity.alive || entity === localHero);

  const setSelected = (entity: GameEntity | null) => {
    const next = entity && canKeepSelected(entity) ? entity : null;
    if (selected === next) {
      hudBridge.refresh(selected);
      return;
    }

    if (selected) selected.root.userData.selected = false;
    selected = next;

    if (!selected) {
      marker.visible = false;
      clearSelectionVisual();
      clearRangeVisual();
      hudBridge.setSelection(null);
      return;
    }

    selected.root.userData.selected = true;
    marker.visible = selected.alive;
    if (selected.alive) rebuildVisual(selected);
    else {
      clearSelectionVisual();
      clearRangeVisual();
    }
    hudBridge.setSelection(selected);
  };

  const pick = (raycaster: THREE.Raycaster) => {
    const selectable = registry.selectable().filter(canSelect);
    if (selectable.length === 0) return null;

    const roots = selectable.map(entity => entity.root);
    const hits = raycaster.intersectObjects(roots, true);
    for (const hit of hits) {
      const entity = getGameEntity(hit.object);
      if (!entity || !entity.selectable || !entity.alive || !canSelect(entity)) continue;
      setSelected(entity);
      return entity;
    }

    // A normal left-click miss means terrain/empty space: preserve the current selection.
    // Explicit deselection remains available through select(null) for future UI commands.
    return null;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Alt' || event.code === 'AltLeft' || event.code === 'AltRight') {
      altHeld = true;
      return;
    }
    if (event.code === 'KeyA') {
      attackCommandArmed = selected === localHero && Boolean(localHero?.alive);
      return;
    }
    if (event.code === 'Escape') {
      attackCommandArmed = false;
      return;
    }
    if (event.code !== 'F1') return;
    event.preventDefault();
    attackCommandArmed = false;
    if (localHero) setSelected(localHero);
    focusLocalHeroViaGameCamera();
  };

  const onKeyUp = (event: KeyboardEvent) => {
    if (event.key === 'Alt' || event.code === 'AltLeft' || event.code === 'AltRight') altHeld = false;
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!isGameplayCanvas(event.target)) {
      hoveredAttackTarget = null;
      return;
    }
    hoveredAttackTarget = pickAttackIntentTarget(event);
  };

  const onAttackIntentPointerDown = (event: PointerEvent) => {
    if (!isGameplayCanvas(event.target) || (event.button !== 0 && event.button !== 2)) return;
    const target = pickAttackIntentTarget(event);
    const localHeroCanIssueAttack = selected === localHero && Boolean(localHero?.alive);

    if (event.button === 2) {
      attackCommandArmed = false;
      if (localHeroCanIssueAttack && target) confirmAttackIntent(target);
      else if (localHeroCanIssueAttack) {
        confirmedAttackTarget = null;
        confirmedAttackUntil = 0;
      }
      return;
    }

    if (!attackCommandArmed) return;
    attackCommandArmed = false;
    if (localHeroCanIssueAttack && target) confirmAttackIntent(target);
    else {
      confirmedAttackTarget = null;
      confirmedAttackUntil = 0;
    }
  };

  const onWindowBlur = () => {
    altHeld = false;
    attackCommandArmed = false;
    hoveredAttackTarget = null;
  };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerdown', onAttackIntentPointerDown);
  window.addEventListener('blur', onWindowBlur);

  const updateEnemyTowerRanges = (now: number) => {
    for (const [entity, enemyRangeVisual] of enemyTowerRanges) {
      const visible = altHeld
        && entity.alive
        && entity.revealed
        && entity.root.parent !== null;
      enemyRangeVisual.root.visible = visible;
      if (!visible) continue;

      entity.root.getWorldPosition(enemyTowerWorldPosition);
      enemyRangeVisual.root.position.set(
        enemyTowerWorldPosition.x,
        enemyTowerWorldPosition.y + 0.035,
        enemyTowerWorldPosition.z,
      );
      updateRangeVisualPulse(enemyRangeVisual, now);
    }
  };

  const update = () => {
    const now = performance.now() * 0.001;
    updateEnemyTowerRanges(now);
    syncAttackIntentMarkers();
    hudBridge.refresh(selected);

    if (!selected || !selected.root.parent || !canSelect(selected) || (!selected.alive && selected !== localHero)) {
      setSelected(null);
      return;
    }

    if (!selected.alive) {
      marker.visible = false;
      clearRangeVisual();
      return;
    }

    marker.visible = true;
    if (!visual) rebuildVisual(selected);
    if (!visual) return;

    selected.root.getWorldPosition(worldPosition);
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
    const glowPulseAmount = selected.kind === 'hero' ? 0.025 : 0.08;
    visual.glowMaterial.opacity = visual.glowBaseOpacity
      * (1 - glowPulseAmount + (pulse + 1) * glowPulseAmount)
      * intro;

    if (rangeVisual) {
      rangeVisual.root.position.set(worldPosition.x, worldPosition.y + 0.035, worldPosition.z);
      const selectedRangeHandledGlobally = selected.kind === 'tower'
        && selected.team !== localTeam
        && selected.team !== 'neutral';
      rangeVisual.root.visible = altHeld
        && selected.kind === 'tower'
        && selected.attackRange > 0
        && !selectedRangeHandledGlobally;
      updateRangeVisualPulse(rangeVisual, now);
    }
  };

  // The controlled hero is the default selection from the first playable frame.
  if (localHero) setSelected(localHero);
  else hudBridge.setSelection(null);

  return {
    getSelected: () => selected,
    pick,
    select: setSelected,
    update,
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onAttackIntentPointerDown);
      window.removeEventListener('blur', onWindowBlur);
      if (scene.onBeforeRender === attackIntentBeforeRender) scene.onBeforeRender = previousSceneBeforeRender;
      if (selected) selected.root.userData.selected = false;
      selected = null;
      clearSelectionVisual();
      clearRangeVisual();
      for (const enemyRangeVisual of enemyTowerRanges.values()) {
        scene.remove(enemyRangeVisual.root);
        disposeRangeVisual(enemyRangeVisual);
      }
      enemyTowerRanges.clear();
      scene.remove(attackHoverVisual.root, attackTargetVisual.root);
      disposeObjectVisual(attackHoverVisual.root);
      disposeObjectVisual(attackTargetVisual.root);
      hudBridge.dispose();
      scene.remove(marker);
    },
  };
}
