import * as THREE from 'three';
import type { GameEntity, GameEntityRegistry, TeamId } from '../entities/gameEntities';
import {
  ITEM_TARGET_CONFIRM_EVENT,
  ITEM_TARGET_REQUEST_EVENT,
  ITEM_USE_EVENT,
  type ItemTargetConfirmDetail,
  type ItemTargetRequestDetail,
  type ItemUseDetail,
} from './shopEvents';
import {
  WARD_RULES,
  configureWardEntity,
  getWardDurability,
  isWardPlacementEffect,
  unregisterWardEntity,
  wardTypeFromEffect,
  type WardType,
} from './wardGameplay';

export type WardPlacementSystem = Readonly<{ dispose(): void }>;

const SYSTEM_KEY = 'dawnreachWardPlacementSystem';
const PLACEMENT_GROUND_OFFSET = 0.035;
const HERO_VISION_EDGE_MARGIN = 0.12;
const CONFIRMED_TARGET_TTL_MS = 2_000;
const OBSERVER_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='10' fill='none' stroke='%2358cfff' stroke-width='2'/%3E%3Cpath d='M16 3v5M16 24v5M3 16h5M24 16h5' stroke='%23bcefff' stroke-width='2' stroke-linecap='round'/%3E%3Cpath d='M16 10l4 6-4 6-4-6z' fill='%2358cfff' fill-opacity='.28' stroke='%23ffffff' stroke-width='1.5'/%3E%3C/svg%3E") 16 16, crosshair`;
const SENTRY_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='10' fill='none' stroke='%237a8cff' stroke-width='2'/%3E%3Cpath d='M16 2v6M16 24v6M2 16h6M24 16h6' stroke='%23d8deff' stroke-width='2' stroke-linecap='round'/%3E%3Cpath d='M8 16c4-5 12-5 16 0-4 5-12 5-16 0z' fill='%237a8cff' fill-opacity='.28' stroke='%23ffffff' stroke-width='1.5'/%3E%3Ccircle cx='16' cy='16' r='3' fill='%23ffffff'/%3E%3C/svg%3E") 16 16, crosshair`;

let disposeActiveWardPlacementSystem: (() => void) | null = null;

type PlacementPhase = 'aiming' | 'moving';

type PendingWardPlacement = {
  request: ItemTargetRequestDetail;
  actor: GameEntity;
  wardType: WardType;
  phase: PlacementPhase;
  targetPoint: THREE.Vector3 | null;
};

type ConfirmedWardPlacement = {
  actor: GameEntity;
  wardType: WardType;
  point: THREE.Vector3;
  expiresAtMs: number;
};

type TimedWard = {
  id: string;
  root: THREE.Group;
  entity: GameEntity;
  expiresAtMs: number;
};

function numeric(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function buildWard(team: TeamId, wardType: WardType) {
  const teamColor = team === 'red' ? 0xe26b68 : 0x78d8ec;
  const color = wardType === 'sentry'
    ? (team === 'red' ? 0xc77cff : 0x7d8cff)
    : teamColor;
  const root = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x5f5848, roughness: 0.45, metalness: 0.65 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x273235, roughness: 0.82, metalness: 0.08 });
  const glow = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: wardType === 'sentry' ? 1.55 : 1.25,
    roughness: 0.25,
    metalness: 0.12,
  });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.26, 0.16, 8), stone);
  base.position.y = 0.08;
  root.add(base);

  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.07, 0.58, 8), metal);
  stem.position.y = 0.41;
  root.add(stem);

  const eye = new THREE.Mesh(
    wardType === 'sentry' ? new THREE.SphereGeometry(0.145, 12, 8) : new THREE.OctahedronGeometry(0.16, 0),
    glow,
  );
  eye.position.y = 0.78;
  if (wardType === 'observer') eye.rotation.z = Math.PI / 4;
  root.add(eye);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.018, 6, 32), glow);
  ring.position.y = 0.77;
  ring.rotation.x = Math.PI / 2;
  root.add(ring);

  if (wardType === 'sentry') {
    const verticalRing = new THREE.Mesh(new THREE.TorusGeometry(0.20, 0.014, 6, 32), glow);
    verticalRing.position.y = 0.77;
    verticalRing.rotation.y = Math.PI / 2;
    root.add(verticalRing);
  }

  root.traverse(object => {
    if (object instanceof THREE.Mesh) object.castShadow = true;
  });
  return root;
}

function buildPlacementPreview() {
  const root = new THREE.Group();
  root.name = 'ward-placement-preview';
  root.visible = false;

  const targetMaterial = new THREE.MeshBasicMaterial({
    color: 0x58cfff,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const targetRing = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.46, 64), targetMaterial);
  targetRing.rotation.x = -Math.PI / 2;
  targetRing.position.y = 0.018;
  targetRing.renderOrder = 88;
  root.add(targetRing);

  const visionMaterial = new THREE.MeshBasicMaterial({
    color: 0x58cfff,
    transparent: true,
    opacity: 0.24,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const visionRing = new THREE.Mesh(new THREE.RingGeometry(0.992, 1, 128), visionMaterial);
  visionRing.name = 'ward-placement-vision-ring';
  visionRing.rotation.x = -Math.PI / 2;
  visionRing.position.y = 0.012;
  visionRing.renderOrder = 87;
  root.add(visionRing);

  return { root, visionRing, targetMaterial, visionMaterial };
}

function disposeObject3D(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse(object => {
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
}

function isGameplayCanvas(target: EventTarget | null): target is HTMLCanvasElement {
  return target instanceof HTMLCanvasElement && target.classList.contains('game-canvas');
}

export function ensureWardPlacementSystem(
  scene: THREE.Scene,
  registry: GameEntityRegistry,
): WardPlacementSystem {
  const existing = scene.userData[SYSTEM_KEY] as WardPlacementSystem | undefined;
  if (existing) return existing;

  disposeActiveWardPlacementSystem?.();

  const commandSurfaces: THREE.Mesh[] = [];
  scene.traverse(object => {
    if (object instanceof THREE.Mesh && object.userData.commandSurface) commandSurfaces.push(object);
  });

  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const actorWorldPosition = new THREE.Vector3();
  const projectedPosition = new THREE.Vector3();
  const preview = buildPlacementPreview();
  scene.add(preview.root);

  const confirmedPlacements = new Map<string, ConfirmedWardPlacement>();
  const timedWards = new Map<string, TimedWard>();
  let pending: PendingWardPlacement | null = null;
  let gameplayCamera: THREE.Camera | null = null;
  let pointerValid = false;
  let syntheticCommandInFlight = false;
  let disposed = false;

  const getCanvas = () => document.querySelector<HTMLCanvasElement>('.game-canvas');

  const setPointerFromClient = (canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    pointer.y = -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    pointerValid = true;
  };

  const pickPlacementPoint = () => {
    if (!gameplayCamera || !pointerValid) return null;
    raycaster.setFromCamera(pointer, gameplayCamera);
    const hit = raycaster.intersectObjects(commandSurfaces, false)[0];
    if (!hit) return null;
    const point = hit.point.clone();
    point.y += PLACEMENT_GROUND_OFFSET;
    return point;
  };

  const setPlacementCursor = (active: boolean, wardType: WardType = 'observer') => {
    const canvas = getCanvas();
    if (canvas) canvas.style.cursor = active
      ? (wardType === 'sentry' ? SENTRY_CURSOR : OBSERVER_CURSOR)
      : '';
  };

  const hidePreview = () => {
    preview.root.visible = false;
  };

  const applyPreviewTone = (wardType: WardType) => {
    const color = wardType === 'sentry' ? 0x7d8cff : 0x58cfff;
    preview.targetMaterial.color.setHex(color);
    preview.visionMaterial.color.setHex(color);
  };

  const setPreviewPoint = (point: THREE.Vector3, radius: number, wardType: WardType) => {
    applyPreviewTone(wardType);
    preview.root.position.copy(point);
    preview.visionRing.scale.setScalar(Math.max(0.5, radius));
    preview.root.visible = true;
  };

  const clearPending = () => {
    pending = null;
    setPlacementCursor(false);
    hidePreview();
  };

  const cancelPending = () => clearPending();

  const resolveLocalActor = () => (
    registry.values().find(entity => entity.id === 'blue-hero-alden' && entity.kind === 'hero' && entity.alive)
    ?? registry.values().find(entity => entity.kind === 'hero' && entity.team === 'blue' && entity.alive)
    ?? null
  );

  const pointIsInsideHeroVision = (actor: GameEntity, point: THREE.Vector3) => {
    actor.root.getWorldPosition(actorWorldPosition);
    const dx = point.x - actorWorldPosition.x;
    const dz = point.z - actorWorldPosition.z;
    const radius = Math.max(0.25, actor.visionRadius - HERO_VISION_EDGE_MARGIN);
    return dx * dx + dz * dz <= radius * radius;
  };

  const dispatchSyntheticPointerCommand = (
    canvas: HTMLCanvasElement,
    clientX: number,
    clientY: number,
  ) => {
    syntheticCommandInFlight = true;
    try {
      canvas.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        pointerId: 918,
        pointerType: 'mouse',
        isPrimary: true,
        button: 2,
        buttons: 2,
        clientX,
        clientY,
      }));
    } finally {
      syntheticCommandInFlight = false;
    }
  };

  const issueMoveTowardTarget = (canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
    dispatchSyntheticPointerCommand(canvas, clientX, clientY);
  };

  const issueStopAtCurrentPosition = (actor: GameEntity) => {
    const canvas = getCanvas();
    if (!canvas || !gameplayCamera) return;
    actor.root.getWorldPosition(projectedPosition);
    projectedPosition.project(gameplayCamera);
    if (projectedPosition.z < -1 || projectedPosition.z > 1) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = rect.left + (projectedPosition.x + 1) * 0.5 * rect.width;
    const clientY = rect.top + (1 - (projectedPosition.y + 1) * 0.5) * rect.height;
    dispatchSyntheticPointerCommand(canvas, clientX, clientY);
  };

  const confirmPlacement = (placement: PendingWardPlacement) => {
    const point = placement.targetPoint;
    if (!point) return;

    issueStopAtCurrentPosition(placement.actor);
    confirmedPlacements.set(placement.request.instanceId, {
      actor: placement.actor,
      wardType: placement.wardType,
      point: point.clone(),
      expiresAtMs: performance.now() + CONFIRMED_TARGET_TTL_MS,
    });
    const detail: ItemTargetConfirmDetail = { instanceId: placement.request.instanceId };
    clearPending();
    window.dispatchEvent(new CustomEvent<ItemTargetConfirmDetail>(ITEM_TARGET_CONFIRM_EVENT, { detail }));
  };

  const removeWard = (ward: TimedWard) => {
    timedWards.delete(ward.id);
    unregisterWardEntity(ward.id);
    registry.unregister(ward.root);
    ward.root.removeFromParent();
    disposeObject3D(ward.root);
  };

  const spawnConfirmedWard = (placement: ConfirmedWardPlacement, detail: ItemUseDetail) => {
    const wardType = placement.wardType;
    const rules = WARD_RULES[wardType];
    const duration = Math.max(0.1, numeric(detail.values.duration, rules.durationSeconds));
    const radius = Math.max(0.5, numeric(detail.values.radius, 8));
    const placedAtMs = detail.activatedAtMs;
    const expiresAtMs = placedAtMs + duration * 1000;
    const root = buildWard(placement.actor.team, wardType);
    root.position.copy(placement.point);
    root.userData.invisible = true;
    root.userData.itemWard = true;
    root.userData.itemWardType = wardType;
    root.userData.trueSightRadius = wardType === 'sentry' ? radius : 0;
    scene.add(root);

    const id = `item-ward:${wardType}:${placement.actor.id}:${detail.instanceId}:${Math.round(placedAtMs)}`;
    const durability = getWardDurability(wardType);
    const entity = registry.register(root, {
      id,
      displayName: rules.displayName,
      kind: 'building',
      team: placement.actor.team,
      selectable: true,
      targetable: true,
      grantsVision: rules.grantsVision,
      // Keep the radius on the entity even for sentries so selection can display the
      // True Sight halo; grantsVision=false prevents it from becoming ordinary sight.
      visionRadius: radius,
      visionHeight: 1.2,
      attackRange: 0,
      selectionRadius: 0.38,
      maxHp: durability,
      currentHp: durability,
      showHealthBar: false,
      visibilityPolicy: 'vision-only',
      interaction: 'attackable-structure',
    });
    configureWardEntity(entity, registry, {
      wardType,
      ownerEntityId: placement.actor.id,
      placedAtMs,
      expiresAtMs,
    });
    timedWards.set(id, { id, root, entity, expiresAtMs });
  };

  const onTargetRequest = (event: Event) => {
    const detail = (event as CustomEvent<ItemTargetRequestDetail>).detail;
    const wardType = detail ? wardTypeFromEffect(detail.effectId) : null;
    if (!detail || !wardType || !detail.instanceId) return;

    if (pending?.request.instanceId === detail.instanceId && pending.phase === 'aiming') {
      cancelPending();
      return;
    }

    const actor = resolveLocalActor();
    if (!actor) return;
    pending = {
      request: detail,
      actor,
      wardType,
      phase: 'aiming',
      targetPoint: null,
    };
    setPlacementCursor(true, wardType);
    hidePreview();
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!isGameplayCanvas(event.target)) return;
    setPointerFromClient(event.target, event.clientX, event.clientY);
    if (!pending || pending.phase !== 'aiming') return;
    const point = pickPlacementPoint();
    if (!point) {
      hidePreview();
      return;
    }
    setPreviewPoint(point, numeric(pending.request.values.radius, 8), pending.wardType);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (syntheticCommandInFlight || !pending || !isGameplayCanvas(event.target)) return;

    if (event.button === 2) {
      cancelPending();
      return;
    }

    if (event.button !== 0 || pending.phase !== 'aiming') return;
    setPointerFromClient(event.target, event.clientX, event.clientY);
    const point = pickPlacementPoint();
    if (!point) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    pending.targetPoint = point;
    setPreviewPoint(point, numeric(pending.request.values.radius, 8), pending.wardType);

    if (pointIsInsideHeroVision(pending.actor, point)) {
      confirmPlacement(pending);
      return;
    }

    pending.phase = 'moving';
    setPlacementCursor(false);
    issueMoveTowardTarget(event.target, event.clientX, event.clientY);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!pending) return;
    if (event.code === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      cancelPending();
      return;
    }
    if (event.code === 'KeyA' && !event.altKey && !event.ctrlKey && !event.metaKey) cancelPending();
  };

  const onItemUseCapture = (event: Event) => {
    const detail = (event as CustomEvent<ItemUseDetail>).detail;
    if (!detail || !isWardPlacementEffect(detail.effectId)) return;
    event.stopImmediatePropagation();

    const placement = confirmedPlacements.get(detail.instanceId);
    confirmedPlacements.delete(detail.instanceId);
    if (!placement || placement.expiresAtMs < performance.now()) return;
    spawnConfirmedWard(placement, detail);
  };

  const update = (nowMs: number) => {
    for (const [instanceId, placement] of confirmedPlacements) {
      if (placement.expiresAtMs <= nowMs) confirmedPlacements.delete(instanceId);
    }
    for (const ward of [...timedWards.values()]) {
      if (ward.expiresAtMs <= nowMs || !ward.entity.alive || !ward.root.parent) removeWard(ward);
    }

    if (!pending) return;
    if (!pending.actor.alive || !pending.actor.root.parent) {
      cancelPending();
      return;
    }
    if (pending.phase !== 'moving' || !pending.targetPoint) return;
    if (pointIsInsideHeroVision(pending.actor, pending.targetPoint)) confirmPlacement(pending);
  };

  const previousSceneBeforeRender = scene.onBeforeRender;
  const beforeRender: typeof scene.onBeforeRender = function(
    renderer,
    renderedScene,
    camera,
    geometry,
    material,
    group,
  ) {
    const minimapCamera = camera.position.y > 60 && camera.up.z < -0.5;
    if (!minimapCamera) {
      gameplayCamera = camera;
      if (pending?.phase === 'aiming' && pointerValid) {
        const point = pickPlacementPoint();
        if (point) setPreviewPoint(point, numeric(pending.request.values.radius, 8), pending.wardType);
      }
      const now = performance.now();
      const pulse = (Math.sin(now * 0.0045) + 1) * 0.5;
      preview.targetMaterial.opacity = 0.78 + pulse * 0.18;
      preview.visionMaterial.opacity = 0.16 + pulse * 0.12;
      update(now);
    }
    previousSceneBeforeRender.call(scene, renderer, renderedScene, camera, geometry, material, group);
  };
  scene.onBeforeRender = beforeRender;

  window.addEventListener(ITEM_TARGET_REQUEST_EVENT, onTargetRequest as EventListener);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener(ITEM_USE_EVENT, onItemUseCapture as EventListener, true);

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearPending();
    window.removeEventListener(ITEM_TARGET_REQUEST_EVENT, onTargetRequest as EventListener);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener(ITEM_USE_EVENT, onItemUseCapture as EventListener, true);
    if (scene.onBeforeRender === beforeRender) scene.onBeforeRender = previousSceneBeforeRender;
    for (const ward of [...timedWards.values()]) removeWard(ward);
    confirmedPlacements.clear();
    preview.root.removeFromParent();
    disposeObject3D(preview.root);
    delete scene.userData[SYSTEM_KEY];
    if (disposeActiveWardPlacementSystem === dispose) disposeActiveWardPlacementSystem = null;
  };

  const system: WardPlacementSystem = { dispose };
  scene.userData[SYSTEM_KEY] = system;
  disposeActiveWardPlacementSystem = dispose;
  return system;
}
