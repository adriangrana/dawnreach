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
const HARD_CC_PATTERN = /(?:^|:|\b)(stun|root|silence|fear)(?:$|:|\b)/i;

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
};

type PickedDestination = Readonly<{
  target: GameEntity;
  destinationWorld: THREE.Vector3 | null;
}>;

function matchTeamToWorld(team: HeroItemRuntimeContext['team']): TeamId {
  return team === 'dawn' ? 'blue' : 'red';
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

function buildChannelVisual(color: number) {
  const root = new THREE.Group();
  const ringMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const glowMaterial = ringMaterial.clone();
  glowMaterial.opacity = 0.18;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.66, 0.82, 64), ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  root.add(ring);
  const glow = new THREE.Mesh(new THREE.CircleGeometry(0.78, 64), glowMaterial);
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.025;
  root.add(glow);
  root.userData.ringMaterial = ringMaterial;
  root.userData.glowMaterial = glowMaterial;
  return root;
}

function setVisualWorldPosition(root: THREE.Object3D, point: THREE.Vector3) {
  root.position.copy(point);
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
  let disposed = false;

  const pendingCasts = new Map<string, PendingCast>();
  const trafficByTarget = new Map<string, TrafficEntry[]>();

  const sampleSurfaceHeight = (x: number, z: number, fallback = 0) => {
    surfaceRay.ray.origin.set(x, 64, z);
    const hit = surfaceRay.intersectObjects(commandSurfaces, false)[0];
    return hit?.point.y ?? fallback;
  };

  const emitTargetingState = (instanceId: string, active: boolean, targetEntityId?: string) => {
    const detail: TeleportTargetingStateDetail = { instanceId, active, targetEntityId };
    window.dispatchEvent(new CustomEvent<TeleportTargetingStateDetail>(TELEPORT_TARGETING_STATE_EVENT, { detail }));
  };

  const clearTargeting = (targetEntityId?: string) => {
    if (!targeting) return;
    emitTargetingState(targeting.instanceId, false, targetEntityId);
    targeting = null;
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
      return new THREE.Vector3(x, sampleSurfaceHeight(x, z, requestedWorld.y) + 0.03, z);
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
    disposeObject3D(active.originVisual);
    disposeObject3D(active.destinationVisual);
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

    const color = actor.team === 'red' ? 0xff867c : 0x7adfff;
    const originVisual = buildChannelVisual(color);
    const destinationVisual = buildChannelVisual(color);
    setVisualWorldPosition(originVisual, actorWorld.clone().setY(sampleSurfaceHeight(actorWorld.x, actorWorld.z, actorWorld.y) + 0.02));
    setVisualWorldPosition(destinationVisual, destinationWorld.clone().setY(destinationWorld.y + 0.01));
    scene.add(originVisual, destinationVisual);

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

  const pickDestination = (event: PointerEvent): PickedDestination | null => {
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

    const destinations = registry.values().filter(entity => isValidTeleportDestination(targeting!.actor, entity));
    if (destinations.length === 0) return null;

    // A tower enables its complete gameplay range as a teleport zone. The player targets
    // the ground inside that range; the tower is only the structure that owns the zone.
    const groundHit = raycaster.intersectObjects(commandSurfaces, false)[0];
    if (groundHit) {
      const point = groundHit.point;
      let nearestTower: GameEntity | null = null;
      let nearestDistance = Number.POSITIVE_INFINITY;

      for (const destination of destinations) {
        if (destination.kind !== 'tower') continue;
        destination.root.getWorldPosition(towerWorld);
        const distance = Math.hypot(point.x - towerWorld.x, point.z - towerWorld.z);
        if (distance > towerTeleportRange(destination) || distance >= nearestDistance) continue;
        nearestTower = destination;
        nearestDistance = distance;
      }

      if (nearestTower) {
        return {
          target: nearestTower,
          destinationWorld: point.clone(),
        };
      }
    }

    // Buildings that are explicit teleport destinations (base/throne/outpost-type entities)
    // keep their authored structure targeting behavior.
    const hits = raycaster.intersectObjects(destinations.map(entity => entity.root), true);
    for (const hit of hits) {
      const entity = getGameEntity(hit.object);
      if (isValidTeleportDestination(targeting.actor, entity)) {
        return { target: entity, destinationWorld: null };
      }
    }
    return null;
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

    if (channel && event.button === 2 && isGameSurface(event.target)) {
      cancelChannel('player-command');
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
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

  const updateChannelVisuals = (active: ChannelState, nowMs: number) => {
    const duration = Math.max(1, active.completesAtMs - active.startedAtMs);
    const progress = THREE.MathUtils.clamp((nowMs - active.startedAtMs) / duration, 0, 1);
    const pulse = (Math.sin(nowMs * 0.012) + 1) * 0.5;
    for (const visual of [active.originVisual, active.destinationVisual]) {
      const ring = visual.userData.ringMaterial as THREE.MeshBasicMaterial | undefined;
      const glow = visual.userData.glowMaterial as THREE.MeshBasicMaterial | undefined;
      if (ring) ring.opacity = 0.58 + pulse * 0.28;
      if (glow) glow.opacity = 0.10 + progress * 0.18 + pulse * 0.04;
      visual.rotation.y = nowMs * 0.0018;
      visual.scale.setScalar(0.92 + progress * 0.18 + pulse * 0.035);
    }
  };

  const update = (nowMs: number) => {
    cleanupTraffic(nowMs);
    for (const [instanceId, pending] of pendingCasts) {
      if (nowMs - pending.requestedAtMs > PENDING_CAST_LIFETIME_MS) pendingCasts.delete(instanceId);
    }

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

    // Keep the world representation exactly at the channel origin. The shared respawn-hold
    // flag also makes the local command controller clear its pre-existing route/order once.
    active.actor.root.getWorldPosition(actorWorld);
    if (actorWorld.distanceToSquared(active.anchorWorld) > 0.0001) {
      setActorWorldPosition(active.actor, active.anchorWorld, nowMs);
    }
    updateChannelVisuals(active, nowMs);
    if (nowMs >= active.completesAtMs) completeChannel(nowMs);
  };

  window.addEventListener(TELEPORT_TARGET_REQUEST_EVENT, onTargetRequest as EventListener);
  window.addEventListener(ITEM_USE_EVENT, onItemUse as EventListener);
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
    if (channel) cancelChannel('replaced');
    pendingCasts.clear();
    trafficByTarget.clear();
    window.removeEventListener(TELEPORT_TARGET_REQUEST_EVENT, onTargetRequest as EventListener);
    window.removeEventListener(ITEM_USE_EVENT, onItemUse as EventListener);
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
