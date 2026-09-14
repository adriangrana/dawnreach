import * as THREE from 'three';
import { getGameEntity, type GameEntity, type GameEntityRegistry, type TeamId } from '../entities/gameEntities';
import { getWorldEntityRuntime } from '../entities/worldCombatBridge';
import { TOWER_GAMEPLAY } from '../gameplay/towerConfig';
import { DAWNREACH_LAYOUT } from '../map/mapLayout';
import { ITEM_USE_EVENT, type ItemUseDetail } from './shopEvents';
import { getItemActivationOwnerContext, type HeroItemRuntimeContext } from './shopRuntime';
import {
  TELEPORT_CANCEL_EVENT,
  TELEPORT_CAST_REQUEST_EVENT,
  TELEPORT_COMPLETE_EVENT,
  TELEPORT_SCROLL_EFFECT_ID,
  TELEPORT_SCROLL_ITEM_ID,
  TELEPORT_TARGET_REQUEST_EVENT,
  TELEPORT_TARGETING_STATE_EVENT,
  type TeleportCancelDetail,
  type TeleportCancelReason,
  type TeleportCastRequestDetail,
  type TeleportCompleteDetail,
  type TeleportTargetRequestDetail,
  type TeleportTargetingStateDetail,
} from './teleportScrollEvents';

export type TeleportScrollSystem = Readonly<{ dispose(): void }>;

const SYSTEM_KEY = 'dawnreachTeleportScrollSystem';
const RESPAWN_HOLD_KEY = 'dawnreachRespawnHold';
const ITEM_TELEPORT_KEY = 'dawnreachItemTeleportedAtMs';
const TRAFFIC_WINDOW_MS = 25_000;
const BASE_CHANNEL_MS = 3_000;
const CHANNEL_PENALTY_MS = 2_000;
const DOUBLE_HOTKEY_WINDOW_MS = 420;
const PENDING_CAST_LIFETIME_MS = 1_500;
const TOWER_TELEPORT_RANGE = TOWER_GAMEPLAY.attack.range;
const TOWER_PREVIEW_REVEAL_PADDING = 2.5;
const LANDING_SELECTION_Y_OFFSET = 0.055;
const TELEPORT_PORTAL_HEIGHT = 5.8;
const TELEPORT_RISE_END = 0.44;
const TELEPORT_TRANSFER_END = 0.52;
const TELEPORT_DESCENT_END = 0.96;
const HARD_CC_PATTERN = /(?:^|:|\b)(stun|root|silence|fear)(?:$|:|\b)/i;
const TELEPORT_CURSOR = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='10' fill='none' stroke='%237adfff' stroke-width='2'/%3E%3Ccircle cx='16' cy='16' r='3' fill='%23dffaff' stroke='%23173d55' stroke-width='1'/%3E%3Cpath d='M16 2v7M16 23v7M2 16h7M23 16h7' stroke='%23ffffff' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E") 16 16, crosshair`;

let disposeTeleportSystem: (() => void) | null = null;

type TargetingState = {
  instanceId: string;
  actor: GameEntity;
  lastHotkeyAtMs: number;
};

type PendingCast = {
  target: GameEntity;
  requestedAtMs: number;
  destinationWorld: THREE.Vector3 | null;
};

type TrafficEntry = {
  instanceId: string;
  team: TeamId;
  targetEntityId: string;
  state: 'channeling' | 'completed';
  startedAtMs: number;
  completedAtMs: number | null;
};

type RenderVisibilityState = Readonly<{
  object: THREE.Object3D;
  visible: boolean;
}>;

type ChannelState = {
  instanceId: string;
  actor: GameEntity;
  target: GameEntity;
  traffic: TrafficEntry;
  startedAtMs: number;
  completesAtMs: number;
  anchorWorld: THREE.Vector3;
  destinationWorld: THREE.Vector3;
  originVisual: THREE.Group;
  destinationVisual: THREE.Group;
  heroProxy: THREE.Object3D;
  actorRenderVisibility: RenderVisibilityState[];
};

type PickedDestination = Readonly<{
  target: GameEntity;
  destinationWorld: THREE.Vector3 | null;
}>;

type TargetPreviewVisuals = {
  team: TeamId;
  rangeRoot: THREE.Group;
  landingRoot: THREE.Group;
};

type SelectionPalette = Readonly<{
  primary: number;
  bright: number;
  glow: number;
  shadow: number;
}>;

type PortalMaterialEntry = Readonly<{
  material: THREE.MeshBasicMaterial;
  baseOpacity: number;
}>;

function matchTeamToWorld(team: HeroItemRuntimeContext['team']): TeamId {
  return team === 'dawn' ? 'blue' : 'red';
}

function teamTeleportColor(team: TeamId) {
  return team === 'red' ? 0xff867c : 0x7adfff;
}

function selectionPalette(team: TeamId): SelectionPalette {
  switch (team) {
    case 'blue':
      return { primary: 0x53d6ff, bright: 0xdcf8ff, glow: 0x2db8ff, shadow: 0x071821 };
    case 'red':
      return { primary: 0xff685c, bright: 0xffe2dd, glow: 0xff4035, shadow: 0x210b09 };
    case 'neutral':
      return { primary: 0xecc45c, bright: 0xffefb1, glow: 0xd89b2f, shadow: 0x201806 };
  }
}

function smootherStep01(value: number) {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
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

function makeBasicMaterial(color: number, opacity: number) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function makeSelectionMaterial(color: number, opacity: number, additive = false) {
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

function addSelectionRing(
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

function buildTeleportPortalColumn(team: TeamId) {
  const palette = selectionPalette(team);
  const root = new THREE.Group();
  root.name = 'teleport-light-column';

  const materialEntries: PortalMaterialEntry[] = [];
  const registerMaterial = (material: THREE.MeshBasicMaterial, baseOpacity: number) => {
    materialEntries.push({ material, baseOpacity });
    return material;
  };

  const shellMaterial = registerMaterial(makeSelectionMaterial(palette.glow, 0.045, true), 0.045);
  const coreMaterial = registerMaterial(makeSelectionMaterial(palette.bright, 0.07, true), 0.07);
  const arcMaterial = registerMaterial(makeSelectionMaterial(palette.primary, 0.48, true), 0.48);
  const brightArcMaterial = registerMaterial(makeSelectionMaterial(palette.bright, 0.52, true), 0.52);
  const helixMaterial = registerMaterial(makeSelectionMaterial(palette.glow, 0.58, true), 0.58);
  const helixBrightMaterial = registerMaterial(makeSelectionMaterial(palette.bright, 0.42, true), 0.42);
  const capMaterial = registerMaterial(makeSelectionMaterial(palette.primary, 0.72, true), 0.72);

  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(0.72, 0.88, TELEPORT_PORTAL_HEIGHT, 48, 1, true),
    shellMaterial,
  );
  shell.position.y = TELEPORT_PORTAL_HEIGHT * 0.5;
  shell.renderOrder = 74;
  root.add(shell);

  const core = new THREE.Mesh(
    new THREE.CylinderGeometry(0.20, 0.34, TELEPORT_PORTAL_HEIGHT * 0.96, 32, 1, true),
    coreMaterial,
  );
  core.position.y = TELEPORT_PORTAL_HEIGHT * 0.49;
  core.renderOrder = 75;
  root.add(core);

  const rotorA = new THREE.Group();
  const rotorB = new THREE.Group();
  rotorA.name = 'teleport-portal-rotor-a';
  rotorB.name = 'teleport-portal-rotor-b';
  const levelCount = 9;
  for (let level = 0; level < levelCount; level++) {
    const t = level / Math.max(1, levelCount - 1);
    const y = 0.22 + t * (TELEPORT_PORTAL_HEIGHT - 0.44);
    const radius = 0.68 + Math.sin(t * Math.PI * 2) * 0.08;
    const arcLength = Math.PI * 1.18;
    const startA = t * Math.PI * 3.2;
    const startB = -t * Math.PI * 2.8 + Math.PI;

    const arcA = new THREE.Mesh(
      new THREE.RingGeometry(radius - 0.035, radius + 0.035, 40, 1, startA, arcLength),
      level % 2 === 0 ? brightArcMaterial : arcMaterial,
    );
    arcA.rotation.x = -Math.PI / 2;
    arcA.position.y = y;
    arcA.renderOrder = 78;
    rotorA.add(arcA);

    const arcB = new THREE.Mesh(
      new THREE.RingGeometry(radius - 0.025, radius + 0.025, 36, 1, startB, Math.PI * 0.92),
      arcMaterial,
    );
    arcB.rotation.x = -Math.PI / 2;
    arcB.position.y = y + 0.08;
    arcB.renderOrder = 77;
    rotorB.add(arcB);
  }
  root.add(rotorA, rotorB);

  const helixA = new THREE.Group();
  const helixB = new THREE.Group();
  helixA.name = 'teleport-portal-helix-a';
  helixB.name = 'teleport-portal-helix-b';
  const helixSegments = 26;
  for (let index = 0; index < helixSegments; index++) {
    const t = index / Math.max(1, helixSegments - 1);
    const y = 0.12 + t * (TELEPORT_PORTAL_HEIGHT - 0.24);
    const angleA = t * Math.PI * 4.8;
    const angleB = -t * Math.PI * 4.2 + Math.PI;
    const radiusA = 0.78 + Math.sin(t * Math.PI * 4) * 0.035;
    const radiusB = 0.62 + Math.cos(t * Math.PI * 3) * 0.04;

    const moteA = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.24, 0.055), helixMaterial);
    moteA.position.set(Math.sin(angleA) * radiusA, y, Math.cos(angleA) * radiusA);
    moteA.rotation.y = angleA;
    moteA.rotation.z = 0.28;
    moteA.renderOrder = 79;
    helixA.add(moteA);

    const moteB = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.18, 0.045), helixBrightMaterial);
    moteB.position.set(Math.sin(angleB) * radiusB, y, Math.cos(angleB) * radiusB);
    moteB.rotation.y = angleB;
    moteB.rotation.z = -0.22;
    moteB.renderOrder = 80;
    helixB.add(moteB);
  }
  root.add(helixA, helixB);

  const bottomRing = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.035, 8, 64), capMaterial);
  bottomRing.rotation.x = Math.PI / 2;
  bottomRing.position.y = 0.10;
  bottomRing.renderOrder = 81;
  root.add(bottomRing);

  const topRing = new THREE.Mesh(new THREE.TorusGeometry(0.74, 0.03, 8, 64), capMaterial);
  topRing.rotation.x = Math.PI / 2;
  topRing.position.y = TELEPORT_PORTAL_HEIGHT - 0.10;
  topRing.renderOrder = 81;
  root.add(topRing);

  root.userData.portalRotorA = rotorA;
  root.userData.portalRotorB = rotorB;
  root.userData.portalHelixA = helixA;
  root.userData.portalHelixB = helixB;
  root.userData.portalMaterials = materialEntries;
  return root;
}

function animateTeleportPortal(root: THREE.Group, nowMs: number, progress: number, phaseOffset: number) {
  const seconds = nowMs * 0.001;
  const pulse = (Math.sin(seconds * 4.2 + phaseOffset) + 1) * 0.5;
  const fadeIn = smootherStep01(progress / 0.10);
  const fadeOut = smootherStep01((1 - progress) / 0.10);
  const strength = Math.min(fadeIn, fadeOut);
  const heightIntro = 0.22 + 0.78 * smootherStep01(progress / 0.12);

  const rotorA = root.userData.portalRotorA as THREE.Group | undefined;
  const rotorB = root.userData.portalRotorB as THREE.Group | undefined;
  const helixA = root.userData.portalHelixA as THREE.Group | undefined;
  const helixB = root.userData.portalHelixB as THREE.Group | undefined;
  const materials = root.userData.portalMaterials as PortalMaterialEntry[] | undefined;

  if (rotorA) rotorA.rotation.y = seconds * 1.72 + phaseOffset;
  if (rotorB) rotorB.rotation.y = -seconds * 1.18 - phaseOffset * 0.7;
  if (helixA) helixA.rotation.y = seconds * 0.88 + phaseOffset * 0.45;
  if (helixB) helixB.rotation.y = -seconds * 0.66 - phaseOffset * 0.35;

  const width = 0.96 + pulse * 0.07;
  root.scale.set(width, heightIntro, width);
  if (materials) {
    for (const entry of materials) {
      entry.material.opacity = entry.baseOpacity * strength * (0.82 + pulse * 0.18);
    }
  }
}

function shouldSkipProxyObject(object: THREE.Object3D) {
  const name = object.name.toLowerCase();
  return name.includes('basic-attack-range')
    || name.includes('overhead')
    || name.includes('status-overlay')
    || name.includes('vision-range')
    || name.includes('selection-hitbox');
}

function cloneRenderableHierarchy(source: THREE.Object3D): THREE.Object3D | null {
  if (shouldSkipProxyObject(source)) return null;

  let clone: THREE.Object3D;
  if (source instanceof THREE.Mesh) {
    const mesh = new THREE.Mesh(source.geometry, source.material);
    mesh.castShadow = source.castShadow;
    mesh.receiveShadow = source.receiveShadow;
    mesh.frustumCulled = source.frustumCulled;
    clone = mesh;
  } else if (source instanceof THREE.Group) {
    clone = new THREE.Group();
  } else {
    return null;
  }

  clone.name = source.name;
  clone.position.copy(source.position);
  clone.quaternion.copy(source.quaternion);
  clone.scale.copy(source.scale);
  clone.visible = source.visible;
  clone.renderOrder = source.renderOrder;

  for (const child of source.children) {
    const childClone = cloneRenderableHierarchy(child);
    if (childClone) clone.add(childClone);
  }
  return clone;
}

function buildHeroTransitProxy(actor: GameEntity) {
  const proxy = cloneRenderableHierarchy(actor.root) ?? new THREE.Group();
  proxy.name = `teleport-hero-proxy-${actor.id}`;
  const worldQuaternion = new THREE.Quaternion();
  const worldScale = new THREE.Vector3();
  actor.root.getWorldQuaternion(worldQuaternion);
  actor.root.getWorldScale(worldScale);
  proxy.position.set(0, 0, 0);
  proxy.quaternion.copy(worldQuaternion);
  proxy.scale.copy(worldScale);
  proxy.visible = true;
  return proxy;
}

function hideActorRenderables(actor: GameEntity) {
  const states: RenderVisibilityState[] = [];
  actor.root.traverse(object => {
    if (object === actor.root) return;
    if (
      object instanceof THREE.Mesh
      || object instanceof THREE.Sprite
      || object instanceof THREE.Line
      || object instanceof THREE.Points
    ) {
      states.push({ object, visible: object.visible });
      object.visible = false;
    }
  });
  return states;
}

function restoreActorRenderables(states: readonly RenderVisibilityState[]) {
  for (const state of states) state.object.visible = state.visible;
}

function buildTowerRangePreview(color: number) {
  const root = new THREE.Group();
  root.visible = false;

  const fillMaterial = makeBasicMaterial(color, 0.075);
  const ringMaterial = makeBasicMaterial(color, 0.64);
  const innerMaterial = makeBasicMaterial(color, 0.20);

  const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 96), fillMaterial);
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = 0.018;
  fill.renderOrder = 40;
  root.add(fill);

  const ring = new THREE.Mesh(new THREE.RingGeometry(0.965, 1, 96), ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.032;
  ring.renderOrder = 42;
  root.add(ring);

  const innerRing = new THREE.Mesh(new THREE.RingGeometry(0.89, 0.905, 96), innerMaterial);
  innerRing.rotation.x = -Math.PI / 2;
  innerRing.position.y = 0.026;
  innerRing.renderOrder = 41;
  root.add(innerRing);

  root.userData.fillMaterial = fillMaterial;
  root.userData.ringMaterial = ringMaterial;
  root.userData.innerMaterial = innerMaterial;
  return root;
}

function buildLandingPreview(team: TeamId) {
  const palette = selectionPalette(team);
  const root = new THREE.Group();
  root.name = 'teleport-landing-selection-marker';
  root.visible = false;

  const glowMaterial = makeSelectionMaterial(palette.glow, 0.13, true);
  const shadowMaterial = makeSelectionMaterial(palette.shadow, 0.50);
  const mainMaterial = makeSelectionMaterial(palette.primary, 0.95);
  const brightMaterial = makeSelectionMaterial(palette.bright, 0.72);
  const segmentMaterial = makeSelectionMaterial(palette.primary, 0.80);

  addSelectionRing(root, 0.79, 1.10, glowMaterial, 78, 0.000);
  addSelectionRing(root, 0.825, 0.91, shadowMaterial, 79, 0.003);
  addSelectionRing(root, 0.85, 0.888, mainMaterial, 80, 0.006);
  addSelectionRing(root, 0.79, 0.803, brightMaterial, 81, 0.009);

  const outerRotor = new THREE.Group();
  outerRotor.name = 'teleport-landing-outer-rotor';
  const segmentCount = 4;
  const segmentStep = Math.PI * 2 / segmentCount;
  const segmentLength = segmentStep * 0.54;
  for (let index = 0; index < segmentCount; index++) {
    const start = index * segmentStep - segmentLength / 2;
    const segment = new THREE.Mesh(
      new THREE.RingGeometry(0.982, 1.018, 24, 1, start, segmentLength),
      segmentMaterial,
    );
    segment.rotation.x = -Math.PI / 2;
    segment.position.y = 0.012;
    segment.renderOrder = 82;
    outerRotor.add(segment);
  }
  root.add(outerRotor);

  const innerRotor = new THREE.Group();
  innerRotor.name = 'teleport-landing-inner-rotor';
  for (let index = 0; index < 4; index++) {
    const angle = index * Math.PI * 2 / 4;
    const tick = new THREE.Mesh(
      new THREE.BoxGeometry(0.016, 0.012, 0.15),
      brightMaterial,
    );
    tick.position.set(
      Math.sin(angle) * 1.07,
      0.016,
      Math.cos(angle) * 1.07,
    );
    tick.rotation.y = angle;
    tick.renderOrder = 83;
    innerRotor.add(tick);
  }
  root.add(innerRotor);

  root.userData.outerRotor = outerRotor;
  root.userData.innerRotor = innerRotor;
  root.userData.glowMaterial = glowMaterial;
  root.userData.glowBaseOpacity = 0.13;
  return root;
}

function animateLandingSelectionVisual(root: THREE.Group, nowMs: number) {
  if (!root.visible) return;
  const seconds = nowMs * 0.001;
  const outerRotor = root.userData.outerRotor as THREE.Group | undefined;
  const innerRotor = root.userData.innerRotor as THREE.Group | undefined;
  const glowMaterial = root.userData.glowMaterial as THREE.MeshBasicMaterial | undefined;
  const glowBaseOpacity = Number(root.userData.glowBaseOpacity ?? 0.13);
  if (outerRotor) outerRotor.rotation.y = seconds * 0.18;
  if (innerRotor) innerRotor.rotation.y = seconds * -0.08;
  if (glowMaterial) {
    const pulse = Math.sin(seconds * 2.2);
    glowMaterial.opacity = glowBaseOpacity * (1 + pulse * 0.025);
  }
}

function isTypingTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  return Boolean(
    element?.isContentEditable
    || element instanceof HTMLInputElement
    || element instanceof HTMLTextAreaElement
    || element instanceof HTMLSelectElement
  );
}

function isGameSurface(target: EventTarget | null) {
  return target instanceof Element
    ? target.closest<HTMLElement>('.game-canvas, .minimap-live')
    : null;
}

function isMainBaseTarget(entity: GameEntity) {
  return entity.id === `${entity.team}-base`
    || entity.id === `${entity.team}-throne`
    || entity.root.name.toLowerCase() === `${entity.team}-base`;
}

function isValidTeleportDestination(actor: GameEntity, target: GameEntity | null): target is GameEntity {
  if (!target || !target.alive || target.team !== actor.team) return false;
  if (target.root.userData.itemWard === true) return false;
  return target.kind === 'tower' || target.kind === 'building';
}

function towerTeleportRange(entity: GameEntity) {
  return entity.kind === 'tower'
    ? Math.max(0.5, entity.attackRange || TOWER_TELEPORT_RANGE)
    : 0;
}

function findMainBase(actor: GameEntity, registry: GameEntityRegistry) {
  return registry.values().find(entity => entity.id === `${actor.team}-base` && isValidTeleportDestination(actor, entity))
    ?? registry.values().find(entity => entity.id === `${actor.team}-throne` && isValidTeleportDestination(actor, entity))
    ?? null;
}

function resolveActorFromOwner(
  owner: HeroItemRuntimeContext | null,
  registry: GameEntityRegistry,
): GameEntity | null {
  const heroes = registry.values().filter(entity => entity.kind === 'hero' && entity.alive);
  if (owner) {
    const exact = heroes.find(entity => entity.root.userData.matchHeroEntityId === owner.heroEntityId);
    if (exact) return exact;
    const team = matchTeamToWorld(owner.team);
    const definition = heroes.find(entity => entity.team === team && entity.definitionId === owner.definitionId);
    if (definition) return definition;
    const named = heroes.find(entity => entity.team === team && entity.displayName === owner.heroName);
    if (named) return named;
    const sameTeam = heroes.filter(entity => entity.team === team);
    if (sameTeam.length === 1) return sameTeam[0];
  }
  return heroes.find(entity => entity.root.userData.selected === true)
    ?? heroes.find(entity => entity.team === 'blue')
    ?? heroes[0]
    ?? null;
}

function resolveLocalTargetingActor(registry: GameEntityRegistry) {
  const heroes = registry.values().filter(entity => entity.kind === 'hero' && entity.alive);
  return heroes.find(entity => entity.root.userData.selected === true)
    ?? heroes.find(entity => entity.team === 'blue')
    ?? heroes[0]
    ?? null;
}

function hasHardCrowdControl(entity: GameEntity, nowMs: number) {
  const snapshot = getWorldEntityRuntime(entity.id);
  if (!snapshot?.statuses) return false;
  return snapshot.statuses.some(status => {
    if (status.expiresAtMs !== undefined && status.expiresAtMs !== null && status.expiresAtMs <= nowMs) return false;
    if (HARD_CC_PATTERN.test(status.id)) return true;
    const data = status.data ?? {};
    return data.hardCrowdControl === true
      || data.stunned === true
      || data.rooted === true
      || data.silenced === true
      || data.feared === true;
  });
}

export function ensureTeleportScrollSystem(
  scene: THREE.Scene,
  registry: GameEntityRegistry,
): TeleportScrollSystem {
  const existing = scene.userData[SYSTEM_KEY] as TeleportScrollSystem | undefined;
  if (existing) return existing;

  disposeTeleportSystem?.();

  const commandSurfaces: THREE.Mesh[] = [];
  scene.traverse(object => {
    if (object instanceof THREE.Mesh && object.userData.commandSurface) commandSurfaces.push(object);
  });

  const raycaster = new THREE.Raycaster();
  const surfaceRay = new THREE.Raycaster();
  surfaceRay.ray.direction.set(0, -1, 0);
  const pointer = new THREE.Vector2();
  const actorWorld = new THREE.Vector3();
  const targetWorld = new THREE.Vector3();
  const towerWorld = new THREE.Vector3();
  const localPoint = new THREE.Vector3();
  let gameplayCamera: THREE.Camera | null = null;
  let minimapCamera: THREE.Camera | null = null;
  let targeting: TargetingState | null = null;
  let channel: ChannelState | null = null;
  let previewVisuals: TargetPreviewVisuals | null = null;
  let disposed = false;

  const pendingCasts = new Map<string, PendingCast>();
  const trafficByTarget = new Map<string, TrafficEntry[]>();
  const cursorRestore = new Map<HTMLElement, string>();

  const sampleSurfaceHeight = (x: number, z: number, fallback = 0) => {
    surfaceRay.ray.origin.set(x, 64, z);
    const hit = surfaceRay.intersectObjects(commandSurfaces, false)[0];
    return hit?.point.y ?? fallback;
  };

  const setTargetingCursor = (active: boolean) => {
    if (typeof document === 'undefined') return;
    if (!active) {
      for (const [element, cursor] of cursorRestore) element.style.cursor = cursor;
      cursorRestore.clear();
      return;
    }

    const elements: HTMLElement[] = [];
    if (document.body) elements.push(document.body);
    document.querySelectorAll<HTMLElement>('.game-canvas, .minimap-live').forEach(element => elements.push(element));
    for (const element of elements) {
      if (!cursorRestore.has(element)) cursorRestore.set(element, element.style.cursor);
      element.style.cursor = TELEPORT_CURSOR;
    }
  };

  const ensurePreviewVisuals = (team: TeamId) => {
    if (previewVisuals?.team === team) return previewVisuals;
    if (previewVisuals) {
      previewVisuals.rangeRoot.removeFromParent();
      previewVisuals.landingRoot.removeFromParent();
      disposeObject3D(previewVisuals.rangeRoot);
      disposeObject3D(previewVisuals.landingRoot);
    }

    const color = teamTeleportColor(team);
    previewVisuals = {
      team,
      rangeRoot: buildTowerRangePreview(color),
      landingRoot: buildLandingPreview(team),
    };
    scene.add(previewVisuals.rangeRoot, previewVisuals.landingRoot);
    return previewVisuals;
  };

  const hideTargetPreview = () => {
    if (!previewVisuals) return;
    previewVisuals.rangeRoot.visible = false;
    previewVisuals.landingRoot.visible = false;
  };

  const disposeTargetPreview = () => {
    if (!previewVisuals) return;
    previewVisuals.rangeRoot.removeFromParent();
    previewVisuals.landingRoot.removeFromParent();
    disposeObject3D(previewVisuals.rangeRoot);
    disposeObject3D(previewVisuals.landingRoot);
    previewVisuals = null;
  };

  const emitTargetingState = (instanceId: string, active: boolean, targetEntityId?: string) => {
    const detail: TeleportTargetingStateDetail = { instanceId, active, targetEntityId };
    window.dispatchEvent(new CustomEvent<TeleportTargetingStateDetail>(TELEPORT_TARGETING_STATE_EVENT, { detail }));
  };

  const clearTargeting = (targetEntityId?: string) => {
    if (!targeting) return;
    emitTargetingState(targeting.instanceId, false, targetEntityId);
    targeting = null;
    hideTargetPreview();
    setTargetingCursor(false);
  };

  const requestCast = (
    instanceId: string,
    target: GameEntity,
    requestedAtMs: number,
    destinationWorld: THREE.Vector3 | null = null,
  ) => {
    pendingCasts.set(instanceId, {
      target,
      requestedAtMs,
      destinationWorld: destinationWorld?.clone() ?? null,
    });
    clearTargeting(target.id);
    const detail: TeleportCastRequestDetail = {
      instanceId,
      targetEntityId: target.id,
      requestedAtMs,
    };
    window.dispatchEvent(new CustomEvent<TeleportCastRequestDetail>(TELEPORT_CAST_REQUEST_EVENT, { detail }));
  };

  const cleanupTraffic = (nowMs: number) => {
    for (const [targetId, entries] of trafficByTarget) {
      const live = entries.filter(entry => (
        entry.state === 'channeling'
        || (entry.completedAtMs !== null && nowMs - entry.completedAtMs <= TRAFFIC_WINDOW_MS)
      ));
      if (live.length > 0) trafficByTarget.set(targetId, live);
      else trafficByTarget.delete(targetId);
    }
  };

  const channelDurationMs = (actor: GameEntity, target: GameEntity, nowMs: number) => {
    if (isMainBaseTarget(target)) return BASE_CHANNEL_MS;
    cleanupTraffic(nowMs);
    const recent = (trafficByTarget.get(target.id) ?? []).filter(entry => entry.team === actor.team).length;
    return BASE_CHANNEL_MS + recent * CHANNEL_PENALTY_MS;
  };

  const removeTrafficEntry = (entry: TrafficEntry) => {
    const entries = trafficByTarget.get(entry.targetEntityId);
    if (!entries) return;
    const next = entries.filter(candidate => candidate !== entry);
    if (next.length > 0) trafficByTarget.set(entry.targetEntityId, next);
    else trafficByTarget.delete(entry.targetEntityId);
  };

  const resolveDestinationPoint = (
    actor: GameEntity,
    target: GameEntity,
    requestedWorld: THREE.Vector3 | null,
  ) => {
    if (isMainBaseTarget(target)) {
      const spawn = actor.team === 'red' ? DAWNREACH_LAYOUT.redSpawn : DAWNREACH_LAYOUT.blueSpawn;
      return new THREE.Vector3(
        spawn.x,
        sampleSurfaceHeight(spawn.x, spawn.z, 0) + 0.03,
        spawn.z,
      );
    }

    target.root.getWorldPosition(targetWorld);

    if (target.kind === 'tower' && requestedWorld) {
      const maxRange = towerTeleportRange(target);
      const minRange = Math.max(0.9, target.selectionRadius + 0.35);
      let dx = requestedWorld.x - targetWorld.x;
      let dz = requestedWorld.z - targetWorld.z;
      let distance = Math.hypot(dx, dz);

      if (distance <= 0.001) {
        actor.root.getWorldPosition(actorWorld);
        dx = actorWorld.x - targetWorld.x;
        dz = actorWorld.z - targetWorld.z;
        distance = Math.hypot(dx, dz);
      }

      if (distance <= 0.001) {
        dx = actor.team === 'red' ? -1 : 1;
        dz = 0;
        distance = 1;
      }

      const safeDistance = THREE.MathUtils.clamp(distance, Math.min(minRange, maxRange), maxRange);
      const x = targetWorld.x + (dx / distance) * safeDistance;
      const z = targetWorld.z + (dz / distance) * safeDistance;
      return new THREE.Vector3(x, sampleSurfaceHeight(x, z, targetWorld.y) + 0.03, z);
    }

    actor.root.getWorldPosition(actorWorld);
    const dx = actorWorld.x - targetWorld.x;
    const dz = actorWorld.z - targetWorld.z;
    const length = Math.hypot(dx, dz);
    const nx = length > 0.001 ? dx / length : actor.team === 'red' ? -1 : 1;
    const nz = length > 0.001 ? dz / length : 0;
    const offset = Math.max(1.25, target.selectionRadius * 0.75 + 0.65);
    const x = targetWorld.x + nx * offset;
    const z = targetWorld.z + nz * offset;
    return new THREE.Vector3(x, sampleSurfaceHeight(x, z, targetWorld.y) + 0.03, z);
  };

  const setActorWorldPosition = (actor: GameEntity, point: THREE.Vector3, nowMs: number) => {
    if (actor.root.parent) {
      localPoint.copy(point);
      actor.root.parent.worldToLocal(localPoint);
      actor.root.position.copy(localPoint);
    } else {
      actor.root.position.copy(point);
    }
    actor.root.userData[ITEM_TELEPORT_KEY] = nowMs;
  };

  const clearChannelVisuals = (active: ChannelState) => {
    active.originVisual.removeFromParent();
    active.destinationVisual.removeFromParent();
    active.heroProxy.removeFromParent();
    disposeObject3D(active.originVisual);
    disposeObject3D(active.destinationVisual);
    restoreActorRenderables(active.actorRenderVisibility);
  };

  const cancelChannel = (reason: TeleportCancelReason, nowMs = performance.now()) => {
    const active = channel;
    if (!active) return;
    channel = null;
    active.actor.root.userData[RESPAWN_HOLD_KEY] = false;
    removeTrafficEntry(active.traffic);
    clearChannelVisuals(active);
    const detail: TeleportCancelDetail = {
      instanceId: active.instanceId,
      targetEntityId: active.target.id,
      reason,
      cancelledAtMs: nowMs,
    };
    window.dispatchEvent(new CustomEvent<TeleportCancelDetail>(TELEPORT_CANCEL_EVENT, { detail }));
  };

  const completeChannel = (nowMs: number) => {
    const active = channel;
    if (!active) return;
    channel = null;
    active.traffic.state = 'completed';
    active.traffic.completedAtMs = nowMs;
    setActorWorldPosition(active.actor, active.destinationWorld, nowMs);
    active.actor.root.userData[RESPAWN_HOLD_KEY] = false;
    clearChannelVisuals(active);
    const detail: TeleportCompleteDetail = {
      instanceId: active.instanceId,
      targetEntityId: active.target.id,
      completedAtMs: nowMs,
    };
    window.dispatchEvent(new CustomEvent<TeleportCompleteDetail>(TELEPORT_COMPLETE_EVENT, { detail }));
  };

  const beginChannel = (detail: ItemUseDetail) => {
    const pending = pendingCasts.get(detail.instanceId);
    pendingCasts.delete(detail.instanceId);
    if (!pending || performance.now() - pending.requestedAtMs > PENDING_CAST_LIFETIME_MS) return;

    const owner = getItemActivationOwnerContext(detail.instanceId);
    const actor = resolveActorFromOwner(owner, registry);
    const target = registry.values().find(entity => entity.id === pending.target.id) ?? null;
    if (!actor || !isValidTeleportDestination(actor, target)) return;

    if (channel) cancelChannel('replaced', detail.activatedAtMs);

    actor.root.getWorldPosition(actorWorld);
    const destinationWorld = resolveDestinationPoint(actor, target, pending.destinationWorld);
    const durationMs = channelDurationMs(actor, target, detail.activatedAtMs);
    const traffic: TrafficEntry = {
      instanceId: detail.instanceId,
      team: actor.team,
      targetEntityId: target.id,
      state: 'channeling',
      startedAtMs: detail.activatedAtMs,
      completedAtMs: null,
    };
    trafficByTarget.set(target.id, [...(trafficByTarget.get(target.id) ?? []), traffic]);

    const originVisual = buildTeleportPortalColumn(actor.team);
    originVisual.name = 'teleport-origin-light-column';
    originVisual.position.set(
      actorWorld.x,
      sampleSurfaceHeight(actorWorld.x, actorWorld.z, actorWorld.y) + 0.02,
      actorWorld.z,
    );

    const destinationVisual = buildTeleportPortalColumn(actor.team);
    destinationVisual.name = 'teleport-destination-light-column';
    destinationVisual.position.set(
      destinationWorld.x,
      sampleSurfaceHeight(destinationWorld.x, destinationWorld.z, destinationWorld.y) + 0.02,
      destinationWorld.z,
    );

    const heroProxy = buildHeroTransitProxy(actor);
    heroProxy.position.copy(actorWorld);
    const actorRenderVisibility = hideActorRenderables(actor);
    scene.add(originVisual, destinationVisual, heroProxy);

    actor.root.userData[RESPAWN_HOLD_KEY] = true;
    channel = {
      instanceId: detail.instanceId,
      actor,
      target,
      traffic,
      startedAtMs: detail.activatedAtMs,
      completesAtMs: detail.activatedAtMs + durationMs,
      anchorWorld: actorWorld.clone(),
      destinationWorld,
      originVisual,
      destinationVisual,
      heroProxy,
      actorRenderVisibility,
    };
  };

  const onTargetRequest = (event: Event) => {
    const detail = (event as CustomEvent<TeleportTargetRequestDetail>).detail;
    if (!detail || detail.itemId !== TELEPORT_SCROLL_ITEM_ID || !detail.instanceId) return;
    const actor = resolveLocalTargetingActor(registry);
    if (!actor) return;

    if (
      detail.source === 'hotkey'
      && targeting?.instanceId === detail.instanceId
      && detail.requestedAtMs - targeting.lastHotkeyAtMs <= DOUBLE_HOTKEY_WINDOW_MS
    ) {
      const base = findMainBase(actor, registry);
      if (base) requestCast(detail.instanceId, base, detail.requestedAtMs);
      return;
    }

    if (targeting && targeting.instanceId !== detail.instanceId) clearTargeting();
    targeting = {
      instanceId: detail.instanceId,
      actor,
      lastHotkeyAtMs: detail.source === 'hotkey' ? detail.requestedAtMs : Number.NEGATIVE_INFINITY,
    };
    hideTargetPreview();
    ensurePreviewVisuals(actor.team);
    setTargetingCursor(true);
    emitTargetingState(detail.instanceId, true);
  };

  const onItemUse = (event: Event) => {
    const detail = (event as CustomEvent<ItemUseDetail>).detail;
    if (!detail?.effectId || !detail.instanceId) return;
    if (detail.effectId === TELEPORT_SCROLL_EFFECT_ID) {
      beginChannel(detail);
      return;
    }
    if (channel) cancelChannel('player-command', detail.activatedAtMs);
  };

  const setPointerRay = (event: PointerEvent) => {
    if (!targeting) return null;
    const surface = isGameSurface(event.target);
    if (!surface) return null;
    const useMinimap = Boolean(surface.closest('.minimap-live'));
    const camera = useMinimap ? minimapCamera : gameplayCamera;
    if (!camera) return null;

    const rect = surface.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    return { surface, camera };
  };

  const findNearestTowerForPoint = (
    actor: GameEntity,
    point: THREE.Vector3,
    revealPadding: number,
  ) => {
    let nearestTower: GameEntity | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const destination of registry.values()) {
      if (destination.kind !== 'tower' || !isValidTeleportDestination(actor, destination)) continue;
      destination.root.getWorldPosition(towerWorld);
      const distance = Math.hypot(point.x - towerWorld.x, point.z - towerWorld.z);
      if (distance > towerTeleportRange(destination) + revealPadding || distance >= nearestDistance) continue;
      nearestTower = destination;
      nearestDistance = distance;
    }

    return nearestTower ? { tower: nearestTower, distance: nearestDistance } : null;
  };

  const pickDestination = (event: PointerEvent): PickedDestination | null => {
    if (!targeting || !setPointerRay(event)) return null;

    const groundHit = raycaster.intersectObjects(commandSurfaces, false)[0];
    if (groundHit) {
      const groundedPoint = new THREE.Vector3(
        groundHit.point.x,
        sampleSurfaceHeight(groundHit.point.x, groundHit.point.z, 0),
        groundHit.point.z,
      );
      const nearby = findNearestTowerForPoint(targeting.actor, groundedPoint, 0);
      if (nearby && nearby.distance <= towerTeleportRange(nearby.tower)) {
        return {
          target: nearby.tower,
          destinationWorld: groundedPoint,
        };
      }
    }

    const destinations = registry.values().filter(entity => isValidTeleportDestination(targeting!.actor, entity));
    const hits = raycaster.intersectObjects(destinations.map(entity => entity.root), true);
    for (const hit of hits) {
      const entity = getGameEntity(hit.object);
      if (isValidTeleportDestination(targeting.actor, entity)) {
        return { target: entity, destinationWorld: null };
      }
    }
    return null;
  };

  const updateTargetPreviewFromPointer = (event: PointerEvent) => {
    if (!targeting || !setPointerRay(event)) {
      hideTargetPreview();
      return;
    }

    const preview = ensurePreviewVisuals(targeting.actor.team);
    const groundHit = raycaster.intersectObjects(commandSurfaces, false)[0];
    if (groundHit) {
      const groundedPoint = new THREE.Vector3(
        groundHit.point.x,
        sampleSurfaceHeight(groundHit.point.x, groundHit.point.z, 0),
        groundHit.point.z,
      );
      const nearby = findNearestTowerForPoint(
        targeting.actor,
        groundedPoint,
        TOWER_PREVIEW_REVEAL_PADDING,
      );
      if (nearby) {
        nearby.tower.root.getWorldPosition(towerWorld);
        const range = towerTeleportRange(nearby.tower);
        const towerGroundY = sampleSurfaceHeight(towerWorld.x, towerWorld.z, towerWorld.y) + 0.025;
        preview.rangeRoot.position.set(towerWorld.x, towerGroundY, towerWorld.z);
        preview.rangeRoot.scale.set(range, 1, range);
        preview.rangeRoot.visible = true;

        if (nearby.distance <= range) {
          const landing = resolveDestinationPoint(targeting.actor, nearby.tower, groundedPoint);
          preview.landingRoot.position.set(
            landing.x,
            sampleSurfaceHeight(landing.x, landing.z, landing.y) + LANDING_SELECTION_Y_OFFSET,
            landing.z,
          );
          preview.landingRoot.scale.setScalar(Math.max(0.24, targeting.actor.selectionRadius));
          preview.landingRoot.visible = true;
        } else {
          preview.landingRoot.visible = false;
        }
        return;
      }
    }

    preview.rangeRoot.visible = false;

    const buildings = registry.values().filter(entity => (
      entity.kind === 'building' && isValidTeleportDestination(targeting!.actor, entity)
    ));
    const hits = raycaster.intersectObjects(buildings.map(entity => entity.root), true);
    for (const hit of hits) {
      const entity = getGameEntity(hit.object);
      if (!isValidTeleportDestination(targeting.actor, entity)) continue;
      const landing = resolveDestinationPoint(targeting.actor, entity, null);
      preview.landingRoot.position.set(
        landing.x,
        sampleSurfaceHeight(landing.x, landing.z, landing.y) + LANDING_SELECTION_Y_OFFSET,
        landing.z,
      );
      preview.landingRoot.scale.setScalar(Math.max(0.24, targeting.actor.selectionRadius));
      preview.landingRoot.visible = true;
      return;
    }

    preview.landingRoot.visible = false;
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!targeting) return;
    updateTargetPreviewFromPointer(event);
  };

  const onPointerDown = (event: PointerEvent) => {
    if (targeting && event.button === 0) {
      const picked = pickDestination(event);
      if (picked) {
        requestCast(
          targeting.instanceId,
          picked.target,
          performance.now(),
          picked.destinationWorld,
        );
      }
      return;
    }

    if (targeting && event.button === 2 && isGameSurface(event.target)) {
      clearTargeting();
      return;
    }

    if (channel && event.button === 2 && isGameSurface(event.target)) {
      cancelChannel('player-command');
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (targeting && !event.repeat && !isTypingTarget(event.target) && event.code === 'Escape') {
      clearTargeting();
      return;
    }

    if (!channel || event.repeat || isTypingTarget(event.target)) return;
    if (
      event.code === 'KeyA'
      || event.code === 'KeyQ'
      || event.code === 'KeyW'
      || event.code === 'KeyE'
      || event.code === 'KeyR'
      || event.code === 'KeyT'
      || /^Digit[1-6]$/.test(event.code)
    ) {
      cancelChannel('player-command');
    }
  };

  const onClick = (event: MouseEvent) => {
    if (!channel || !(event.target instanceof Element)) return;
    const ability = event.target.closest<HTMLButtonElement>('.ability-control button');
    if (ability && ability.getAttribute('aria-disabled') !== 'true') {
      cancelChannel('player-command');
      return;
    }
    const itemSlot = event.target.closest<HTMLElement>('.inventory-grid .inventory-slot--active');
    if (itemSlot && itemSlot.dataset.slot !== '6') cancelChannel('player-command');
  };

  const animateHeroTransit = (active: ChannelState, progress: number) => {
    const proxy = active.heroProxy;
    const originGroundY = active.originVisual.position.y;
    const destinationGroundY = active.destinationVisual.position.y;

    if (progress < TELEPORT_RISE_END) {
      const rise = smootherStep01(progress / TELEPORT_RISE_END);
      proxy.visible = true;
      proxy.position.set(
        active.anchorWorld.x,
        originGroundY + TELEPORT_PORTAL_HEIGHT * rise,
        active.anchorWorld.z,
      );
      return;
    }

    if (progress < TELEPORT_TRANSFER_END) {
      proxy.visible = false;
      return;
    }

    const descent = smootherStep01(
      (progress - TELEPORT_TRANSFER_END) / (TELEPORT_DESCENT_END - TELEPORT_TRANSFER_END),
    );
    proxy.visible = true;
    proxy.position.set(
      active.destinationWorld.x,
      destinationGroundY + TELEPORT_PORTAL_HEIGHT * (1 - descent),
      active.destinationWorld.z,
    );
  };

  const updateChannelVisuals = (active: ChannelState, nowMs: number) => {
    const duration = Math.max(1, active.completesAtMs - active.startedAtMs);
    const progress = THREE.MathUtils.clamp((nowMs - active.startedAtMs) / duration, 0, 1);
    animateTeleportPortal(active.originVisual, nowMs, progress, 0);
    animateTeleportPortal(active.destinationVisual, nowMs, progress, Math.PI * 0.65);
    animateHeroTransit(active, progress);

    const selectedMarker = scene.getObjectByName('selected-entity-marker');
    if (selectedMarker && active.actor.root.userData.selected === true) selectedMarker.visible = false;
  };

  const updateTargetPreviewAnimation = (nowMs: number) => {
    if (!targeting || !previewVisuals) return;
    const rangePulse = (Math.sin(nowMs * 0.009) + 1) * 0.5;
    if (previewVisuals.rangeRoot.visible) {
      const fill = previewVisuals.rangeRoot.userData.fillMaterial as THREE.MeshBasicMaterial | undefined;
      const ring = previewVisuals.rangeRoot.userData.ringMaterial as THREE.MeshBasicMaterial | undefined;
      if (fill) fill.opacity = 0.055 + rangePulse * 0.035;
      if (ring) ring.opacity = 0.52 + rangePulse * 0.22;
    }
    animateLandingSelectionVisual(previewVisuals.landingRoot, nowMs);
  };

  const update = (nowMs: number) => {
    cleanupTraffic(nowMs);
    for (const [instanceId, pending] of pendingCasts) {
      if (nowMs - pending.requestedAtMs > PENDING_CAST_LIFETIME_MS) pendingCasts.delete(instanceId);
    }

    updateTargetPreviewAnimation(nowMs);

    const active = channel;
    if (!active) return;
    const runtime = getWorldEntityRuntime(active.actor.id);
    if (!active.actor.alive || active.actor.currentHp <= 0 || runtime?.alive === false || (runtime?.currentHp ?? 1) <= 0) {
      cancelChannel('death', nowMs);
      return;
    }
    if (hasHardCrowdControl(active.actor, nowMs)) {
      cancelChannel('hard-cc', nowMs);
      return;
    }
    if (!isValidTeleportDestination(active.actor, active.target)) {
      cancelChannel('invalid-target', nowMs);
      return;
    }

    active.actor.root.getWorldPosition(actorWorld);
    if (actorWorld.distanceToSquared(active.anchorWorld) > 0.0001) {
      setActorWorldPosition(active.actor, active.anchorWorld, nowMs);
    }
    updateChannelVisuals(active, nowMs);
    if (nowMs >= active.completesAtMs) completeChannel(nowMs);
  };

  window.addEventListener(TELEPORT_TARGET_REQUEST_EVENT, onTargetRequest as EventListener);
  window.addEventListener(ITEM_USE_EVENT, onItemUse as EventListener);
  window.addEventListener('pointermove', onPointerMove, true);
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('click', onClick, true);

  const previousSceneBeforeRender = scene.onBeforeRender;
  const beforeRender: typeof scene.onBeforeRender = function(
    renderer,
    renderedScene,
    camera,
    geometry,
    material,
    group,
  ) {
    const isMinimap = camera.position.y > 60 && camera.up.z < -0.5;
    if (isMinimap) minimapCamera = camera;
    else gameplayCamera = camera;
    update(performance.now());
    previousSceneBeforeRender.call(this, renderer, renderedScene, camera, geometry, material, group);
  };
  scene.onBeforeRender = beforeRender;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearTargeting();
    setTargetingCursor(false);
    disposeTargetPreview();
    if (channel) cancelChannel('replaced');
    pendingCasts.clear();
    trafficByTarget.clear();
    window.removeEventListener(TELEPORT_TARGET_REQUEST_EVENT, onTargetRequest as EventListener);
    window.removeEventListener(ITEM_USE_EVENT, onItemUse as EventListener);
    window.removeEventListener('pointermove', onPointerMove, true);
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('click', onClick, true);
    if (scene.onBeforeRender === beforeRender) scene.onBeforeRender = previousSceneBeforeRender;
    delete scene.userData[SYSTEM_KEY];
    if (disposeTeleportSystem === dispose) disposeTeleportSystem = null;
  };

  const system: TeleportScrollSystem = { dispose };
  scene.userData[SYSTEM_KEY] = system;
  disposeTeleportSystem = dispose;
  return system;
}
