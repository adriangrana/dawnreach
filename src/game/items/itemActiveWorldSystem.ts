import * as THREE from 'three';
import type { GameEntity, GameEntityRegistry, TeamId } from '../entities/gameEntities';
import { emitWorldCombatEvent, getWorldEntityRuntime } from '../entities/worldCombatBridge';
import { calculateDamageAfterResistance } from '../match/combat';
import { createMapCollisionWorld } from '../map/collisionWorld';
import { createDawnreachNavigationWorld } from '../navigation/dawnreachNavigation';
import { ITEM_USE_EVENT, type ItemUseDetail } from './shopEvents';
import {
  getHeroItemRuntimeContexts,
  getItemActivationOwnerContext,
  type HeroItemRuntimeContext,
} from './shopRuntime';

export type ItemActiveWorldSystem = Readonly<{ dispose(): void }>;

const SYSTEM_KEY = 'dawnreachItemActiveWorldSystem';
const WORLD_STATUS_KEY = 'dawnreachItemWorldStatuses';
const SHIELD_KEY = 'dawnreachItemShields';
const TELEPORT_KEY = 'dawnreachItemTeleportedAtMs';
const DETECTED_BLUE_KEY = 'dawnreachItemDetectedBlueUntilMs';
const DETECTED_RED_KEY = 'dawnreachItemDetectedRedUntilMs';
const WORLD_UPDATE_INTERVAL_MS = 50;
const DAMAGE_TICK_INTERVAL_MS = 100;
const HERO_NAVIGATION_RADIUS = 0.48;
const HERO_GROUND_OFFSET = 0.03;
const SURFACE_RAY_HEIGHT = 64;

let disposeActiveItemWorldSystem: (() => void) | null = null;

type WorldItemStatus = {
  id: string;
  expiresAtMs: number;
  slowPercent?: number;
  ignoreUnitCollision?: boolean;
};

type ItemShield = {
  id: string;
  remaining: number;
  expiresAtMs: number;
};

type DelayedBurst = {
  id: string;
  actor: GameEntity;
  point: THREE.Vector3;
  radius: number;
  rawDamage: number;
  fireAtMs: number;
  visual: THREE.Group;
};

type PersistentZone = {
  id: string;
  actor: GameEntity;
  point: THREE.Vector3;
  radius: number;
  slowPercent: number;
  damagePerSecond: number;
  expiresAtMs: number;
  lastTickAtMs: number;
  visual: THREE.Group;
};

type TimedWorldObject = {
  id: string;
  root: THREE.Object3D;
  expiresAtMs: number;
  entity?: GameEntity;
};

type MovementSample = {
  position: THREE.Vector3;
  teleportAtMs: number;
};

function numeric(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function matchTeamToWorld(team: HeroItemRuntimeContext['team']): TeamId {
  return team === 'dawn' ? 'blue' : 'red';
}

function getWorldStatuses(root: THREE.Object3D): Record<string, WorldItemStatus> {
  const existing = root.userData[WORLD_STATUS_KEY] as Record<string, WorldItemStatus> | undefined;
  if (existing) return existing;
  const created: Record<string, WorldItemStatus> = {};
  root.userData[WORLD_STATUS_KEY] = created;
  return created;
}

function clearExpiredWorldStatuses(root: THREE.Object3D, nowMs: number) {
  const statuses = root.userData[WORLD_STATUS_KEY] as Record<string, WorldItemStatus> | undefined;
  if (!statuses) return;
  for (const [id, status] of Object.entries(statuses)) {
    if (status.expiresAtMs <= nowMs) delete statuses[id];
  }
}

export function getWorldItemMovementMultiplier(root: THREE.Object3D, nowMs = performance.now()) {
  clearExpiredWorldStatuses(root, nowMs);
  const statuses = root.userData[WORLD_STATUS_KEY] as Record<string, WorldItemStatus> | undefined;
  let strongestSlow = 0;
  for (const status of Object.values(statuses ?? {})) {
    strongestSlow = Math.max(strongestSlow, Math.max(0, status.slowPercent ?? 0));
  }
  return Math.max(0.12, 1 - strongestSlow / 100);
}

export function isWorldItemUnitCollisionIgnored(root: THREE.Object3D, nowMs = performance.now()) {
  clearExpiredWorldStatuses(root, nowMs);
  const statuses = root.userData[WORLD_STATUS_KEY] as Record<string, WorldItemStatus> | undefined;
  return Object.values(statuses ?? {}).some(status => status.ignoreUnitCollision === true && status.expiresAtMs > nowMs);
}

function removeWorldSlows(root: THREE.Object3D) {
  const statuses = root.userData[WORLD_STATUS_KEY] as Record<string, WorldItemStatus> | undefined;
  if (!statuses) return;
  for (const [id, status] of Object.entries(statuses)) {
    if ((status.slowPercent ?? 0) > 0) delete statuses[id];
  }
}

function addWorldStatus(root: THREE.Object3D, status: WorldItemStatus) {
  getWorldStatuses(root)[status.id] = status;
}

function getShieldList(entity: GameEntity): ItemShield[] {
  const existing = entity.root.userData[SHIELD_KEY] as ItemShield[] | undefined;
  if (existing) return existing;
  const created: ItemShield[] = [];
  entity.root.userData[SHIELD_KEY] = created;
  return created;
}

function grantShield(entity: GameEntity, id: string, amount: number, expiresAtMs: number) {
  if (amount <= 0 || expiresAtMs <= performance.now()) return;
  installShieldInterceptor(entity);
  const shields = getShieldList(entity);
  const existing = shields.find(shield => shield.id === id);
  if (existing) {
    existing.remaining = Math.max(existing.remaining, amount);
    existing.expiresAtMs = Math.max(existing.expiresAtMs, expiresAtMs);
  } else {
    shields.push({ id, remaining: amount, expiresAtMs });
  }
}

const shieldUninstallers = new Map<GameEntity, () => void>();

function installShieldInterceptor(entity: GameEntity) {
  if (shieldUninstallers.has(entity)) return;
  let hp = entity.currentHp;
  Object.defineProperty(entity, 'currentHp', {
    configurable: true,
    enumerable: true,
    get: () => hp,
    set: (requested: number) => {
      let next = Number.isFinite(requested) ? requested : hp;
      if (next < hp) {
        let incoming = hp - next;
        const nowMs = performance.now();
        const shields = getShieldList(entity);
        for (let index = shields.length - 1; index >= 0; index--) {
          const shield = shields[index];
          if (shield.expiresAtMs <= nowMs || shield.remaining <= 0) shields.splice(index, 1);
        }
        for (const shield of shields) {
          if (incoming <= 0) break;
          const absorbed = Math.min(incoming, shield.remaining);
          shield.remaining -= absorbed;
          incoming -= absorbed;
        }
        for (let index = shields.length - 1; index >= 0; index--) {
          if (shields[index].remaining <= 0) shields.splice(index, 1);
        }
        next = hp - incoming;
      }
      hp = Math.max(0, next);
      entity.root.userData.currentHp = hp;
    },
  });

  shieldUninstallers.set(entity, () => {
    const current = hp;
    delete entity.root.userData[SHIELD_KEY];
    Object.defineProperty(entity, 'currentHp', {
      configurable: true,
      enumerable: true,
      writable: true,
      value: current,
    });
  });
}

function disposeObject3D(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse(object => {
    if (object instanceof THREE.Mesh) {
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
    }
  });
}

function buildGroundTelegraph(radius: number, color: number, filled = false) {
  const root = new THREE.Group();
  const ringMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.72,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.05, radius - 0.07), radius, 64), ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.025;
  root.add(ring);
  if (filled) {
    const fillMaterial = ringMaterial.clone();
    fillMaterial.opacity = 0.09;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.985, 64), fillMaterial);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.018;
    root.add(disc);
  }
  return root;
}

function buildWard(team: TeamId) {
  const color = team === 'red' ? 0xe26b68 : 0x78d8ec;
  const root = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x5f5848, roughness: 0.45, metalness: 0.65 });
  const stone = new THREE.MeshStandardMaterial({ color: 0x273235, roughness: 0.82, metalness: 0.08 });
  const glow = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 1.25,
    roughness: 0.25,
    metalness: 0.12,
  });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.26, 0.16, 8), stone);
  base.position.y = 0.08;
  root.add(base);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.07, 0.58, 8), metal);
  stem.position.y = 0.41;
  root.add(stem);
  const eye = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), glow);
  eye.position.y = 0.78;
  eye.rotation.z = Math.PI / 4;
  root.add(eye);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.018, 6, 32), glow);
  ring.position.y = 0.77;
  ring.rotation.x = Math.PI / 2;
  root.add(ring);
  root.traverse(object => {
    if (object instanceof THREE.Mesh) object.castShadow = true;
  });
  return root;
}

export function ensureItemActiveWorldSystem(
  scene: THREE.Scene,
  registry: GameEntityRegistry,
  battlefield: THREE.Object3D,
): ItemActiveWorldSystem {
  const existing = scene.userData[SYSTEM_KEY] as ItemActiveWorldSystem | undefined;
  if (existing) return existing;

  disposeActiveItemWorldSystem?.();

  const commandSurfaces: THREE.Mesh[] = [];
  battlefield.traverse(object => {
    if (object instanceof THREE.Mesh && object.userData.commandSurface) commandSurfaces.push(object);
  });

  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  const surfaceRay = new THREE.Raycaster();
  surfaceRay.ray.direction.set(0, -1, 0);
  const actorPosition = new THREE.Vector3();
  const candidatePosition = new THREE.Vector3();
  const parentLocal = new THREE.Vector3();
  let gameplayCamera: THREE.Camera | null = null;
  let pointerValid = false;
  let lastWorldUpdateAtMs = -Infinity;
  let navigation: ReturnType<typeof createDawnreachNavigationWorld> | null = null;
  let disposed = false;

  const bursts = new Map<string, DelayedBurst>();
  const zones = new Map<string, PersistentZone>();
  const timedObjects = new Map<string, TimedWorldObject>();
  const movementSamples = new Map<string, MovementSample>();

  const ensureNavigation = () => {
    if (navigation) return navigation;
    const collisionWorld = createMapCollisionWorld(battlefield);
    navigation = createDawnreachNavigationWorld(battlefield, collisionWorld, HERO_NAVIGATION_RADIUS);
    return navigation;
  };

  const sampleSurfaceHeight = (x: number, z: number, fallback = 0) => {
    surfaceRay.ray.origin.set(x, SURFACE_RAY_HEIGHT, z);
    const hit = surfaceRay.intersectObjects(commandSurfaces, false)[0];
    return hit?.point.y ?? fallback;
  };

  const setWorldPosition = (entity: GameEntity, point: THREE.Vector3) => {
    if (entity.root.parent) {
      parentLocal.copy(point);
      entity.root.parent.worldToLocal(parentLocal);
      entity.root.position.copy(parentLocal);
    } else {
      entity.root.position.copy(point);
    }
    entity.root.userData[TELEPORT_KEY] = performance.now();
    movementSamples.delete(entity.id);
  };

  const resolveOwner = (detail: ItemUseDetail) => getItemActivationOwnerContext(detail.instanceId);

  const resolveActor = (detail: ItemUseDetail): { actor: GameEntity; owner: HeroItemRuntimeContext | null } | null => {
    const owner = resolveOwner(detail);
    const worldTeam = owner ? matchTeamToWorld(owner.team) : null;
    const heroes = registry.values().filter(entity => entity.kind === 'hero' && entity.alive);
    if (owner) {
      const exact = heroes.find(entity => entity.root.userData.matchHeroEntityId === owner.heroEntityId);
      if (exact) return { actor: exact, owner };
      const definition = heroes.find(entity => entity.team === worldTeam && entity.definitionId === owner.definitionId);
      if (definition) return { actor: definition, owner };
      const named = heroes.find(entity => entity.team === worldTeam && entity.displayName === owner.heroName);
      if (named) return { actor: named, owner };
      const sameTeam = heroes.filter(entity => entity.team === worldTeam);
      if (sameTeam.length === 1) return { actor: sameTeam[0], owner };
    }
    if (heroes.length === 1) return { actor: heroes[0], owner: null };
    return null;
  };

  const resolveCastPoint = (actor: GameEntity, castRange: number) => {
    actor.root.getWorldPosition(actorPosition);
    let point: THREE.Vector3 | null = null;
    if (pointerValid && gameplayCamera) {
      raycaster.setFromCamera(pointer, gameplayCamera);
      const hit = raycaster.intersectObjects(commandSurfaces, false)[0];
      if (hit) point = hit.point.clone();
    }
    if (!point) {
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(actor.root.getWorldQuaternion(new THREE.Quaternion()));
      point = actorPosition.clone().addScaledVector(forward, Math.max(0.5, castRange * 0.75));
    }
    const dx = point.x - actorPosition.x;
    const dz = point.z - actorPosition.z;
    const distance = Math.hypot(dx, dz);
    const limit = Math.max(0, castRange);
    if (limit > 0 && distance > limit) {
      point.x = actorPosition.x + dx / distance * limit;
      point.z = actorPosition.z + dz / distance * limit;
    }
    point.y = sampleSurfaceHeight(point.x, point.z, actorPosition.y - HERO_GROUND_OFFSET) + 0.035;
    return point;
  };

  const damageEntity = (actor: GameEntity, target: GameEntity, rawDamage: number, atMs: number) => {
    if (!target.alive || target.currentHp <= 0 || target.maxHp <= 0) return 0;
    const runtime = getWorldEntityRuntime(target.id);
    const resistance = numeric(runtime?.magicResistance, numeric(target.root.userData.magicResistance, 0));
    const mitigated = calculateDamageAfterResistance(Math.max(0, rawDamage), 'magic', 0, resistance);
    const before = target.currentHp;
    target.currentHp = Math.max(0, before - mitigated);
    target.root.userData.currentHp = target.currentHp;
    const dealt = Math.max(0, before - target.currentHp);
    if (target.currentHp <= 0) {
      target.alive = false;
      target.root.userData.alive = false;
    }
    if (dealt > 0) {
      emitWorldCombatEvent({
        entityId: target.id,
        reason: target.alive ? 'damage' : 'death',
        currentHp: target.currentHp,
        currentResource: runtime?.currentResource,
        alive: target.alive,
        atMs,
        amount: dealt,
        sourceEntityId: actor.id,
      });
    }
    return dealt;
  };

  const hostileDamageTargets = (actor: GameEntity, point: THREE.Vector3, radius: number) => {
    const radiusSquared = radius * radius;
    return registry.values().filter(target => {
      if (!target.alive || target.currentHp <= 0 || target.maxHp <= 0 || target.team === actor.team) return false;
      if (target.kind !== 'hero' && target.kind !== 'creep' && target.kind !== 'jungle-creature') return false;
      target.root.getWorldPosition(candidatePosition);
      const dx = candidatePosition.x - point.x;
      const dz = candidatePosition.z - point.z;
      return dx * dx + dz * dz <= radiusSquared;
    });
  };

  const addVisualAt = (root: THREE.Object3D, point: THREE.Vector3) => {
    root.position.copy(point);
    scene.add(root);
  };

  const spawnWard = (actor: GameEntity, detail: ItemUseDetail) => {
    const duration = Math.max(0.1, numeric(detail.values.duration, 90));
    const radius = Math.max(0.5, numeric(detail.values.radius, 8));
    const castRange = Math.max(0.5, numeric(detail.values.cast_range, 5));
    const point = resolveCastPoint(actor, castRange);
    const root = buildWard(actor.team);
    root.position.copy(point);
    root.userData.invisible = true;
    root.userData.itemWard = true;
    scene.add(root);
    const id = `item-ward:${actor.id}:${detail.instanceId}:${Math.round(detail.activatedAtMs)}`;
    const ward = registry.register(root, {
      id,
      displayName: 'Ojo del Vigía',
      kind: 'building',
      team: actor.team,
      selectable: false,
      targetable: true,
      grantsVision: true,
      visionRadius: radius,
      visionHeight: 1.2,
      attackRange: 0,
      selectionRadius: 0.32,
      maxHp: 1,
      currentHp: 1,
      showHealthBar: false,
      visibilityPolicy: 'vision-only',
      interaction: 'structure',
    });
    timedObjects.set(id, { id, root, entity: ward, expiresAtMs: detail.activatedAtMs + duration * 1000 });
  };

  const revealArea = (actor: GameEntity, detail: ItemUseDetail) => {
    actor.root.getWorldPosition(actorPosition);
    const radius = Math.max(0.5, numeric(detail.values.radius, 6));
    const expiresAtMs = detail.activatedAtMs + Math.max(0.1, numeric(detail.values.duration, 8)) * 1000;
    const key = actor.team === 'red' ? DETECTED_RED_KEY : DETECTED_BLUE_KEY;
    const radiusSquared = radius * radius;
    for (const target of registry.values()) {
      if (!target.alive || target.team === actor.team || target.team === 'neutral') continue;
      target.root.getWorldPosition(candidatePosition);
      const dx = candidatePosition.x - actorPosition.x;
      const dz = candidatePosition.z - actorPosition.z;
      if (dx * dx + dz * dz > radiusSquared) continue;
      target.root.userData[key] = Math.max(numeric(target.root.userData[key], 0), expiresAtMs);
      target.root.userData.revealedByItem = true;
    }
    const pulse = buildGroundTelegraph(radius, actor.team === 'red' ? 0xe77d73 : 0x8be3f3, true);
    addVisualAt(pulse, actorPosition.clone().setY(sampleSurfaceHeight(actorPosition.x, actorPosition.z, actorPosition.y) + 0.04));
    timedObjects.set(`reveal:${detail.instanceId}:${detail.activatedAtMs}`, {
      id: `reveal:${detail.instanceId}:${detail.activatedAtMs}`,
      root: pulse,
      expiresAtMs: detail.activatedAtMs + 700,
    });
  };

  const queueNova = (actor: GameEntity, owner: HeroItemRuntimeContext | null, detail: ItemUseDetail) => {
    const radius = Math.max(0.25, numeric(detail.values.radius, 2.8));
    const point = resolveCastPoint(actor, Math.max(radius, numeric(detail.values.cast_range, 7)));
    const magicPower = owner?.magicPower ?? 0;
    const rawDamage = numeric(detail.values.base_magic_damage, 0)
      + magicPower * numeric(detail.values.magic_power_ratio, 0);
    const delayMs = Math.max(0, numeric(detail.values.delay, 0)) * 1000;
    const visual = buildGroundTelegraph(radius, 0xf0b15e, true);
    addVisualAt(visual, point);
    const id = `nova:${detail.instanceId}:${detail.activatedAtMs}`;
    bursts.set(id, {
      id,
      actor,
      point,
      radius,
      rawDamage,
      fireAtMs: detail.activatedAtMs + delayMs,
      visual,
    });
  };

  const spawnSingularity = (actor: GameEntity, owner: HeroItemRuntimeContext | null, detail: ItemUseDetail) => {
    const radius = Math.max(0.25, numeric(detail.values.radius, 4));
    const point = resolveCastPoint(actor, Math.max(radius, numeric(detail.values.cast_range, 7)));
    const magicPower = owner?.magicPower ?? 0;
    const damagePerSecond = numeric(detail.values.damage_per_second, 0)
      + magicPower * numeric(detail.values.magic_power_ratio_per_second, 0);
    const durationMs = Math.max(100, numeric(detail.values.duration, 4) * 1000);
    const visual = buildGroundTelegraph(radius, 0x9b74d8, true);
    addVisualAt(visual, point);
    const id = `singularity:${detail.instanceId}:${detail.activatedAtMs}`;
    zones.set(id, {
      id,
      actor,
      point,
      radius,
      slowPercent: Math.max(0, numeric(detail.values.slow_pct, 0)),
      damagePerSecond: Math.max(0, damagePerSecond),
      expiresAtMs: detail.activatedAtMs + durationMs,
      lastTickAtMs: detail.activatedAtMs,
      visual,
    });
  };

  const blink = (actor: GameEntity, detail: ItemUseDetail) => {
    const maxDistance = Math.max(0.25, numeric(detail.values.blink_distance, 5));
    const requested = resolveCastPoint(actor, maxDistance);
    actor.root.getWorldPosition(actorPosition);
    let resolved = requested.clone();
    if (detail.values.cannot_cross_impassable_terrain === true) {
      const nav = ensureNavigation();
      const from = { x: actorPosition.x, z: actorPosition.z };
      const desired = { x: requested.x, z: requested.z };
      if (!nav.segmentIsWalkable(from, desired)) {
        let low = 0;
        let high = 1;
        for (let index = 0; index < 12; index++) {
          const mid = (low + high) * 0.5;
          const probe = {
            x: THREE.MathUtils.lerp(from.x, desired.x, mid),
            z: THREE.MathUtils.lerp(from.z, desired.z, mid),
          };
          if (nav.segmentIsWalkable(from, probe)) low = mid;
          else high = mid;
        }
        resolved.x = THREE.MathUtils.lerp(from.x, desired.x, low);
        resolved.z = THREE.MathUtils.lerp(from.z, desired.z, low);
      }
    }
    resolved.y = sampleSurfaceHeight(resolved.x, resolved.z, actorPosition.y - HERO_GROUND_OFFSET) + HERO_GROUND_OFFSET;
    const originPulse = buildGroundTelegraph(0.52, 0x8bd5e9, true);
    addVisualAt(originPulse, actorPosition.clone().setY(sampleSurfaceHeight(actorPosition.x, actorPosition.z, actorPosition.y) + 0.04));
    const destinationPulse = buildGroundTelegraph(0.52, 0xd3b6f1, true);
    addVisualAt(destinationPulse, resolved.clone().setY(resolved.y + 0.01));
    const baseId = `blink:${detail.instanceId}:${detail.activatedAtMs}`;
    timedObjects.set(`${baseId}:a`, { id: `${baseId}:a`, root: originPulse, expiresAtMs: detail.activatedAtMs + 450 });
    timedObjects.set(`${baseId}:b`, { id: `${baseId}:b`, root: destinationPulse, expiresAtMs: detail.activatedAtMs + 450 });
    setWorldPosition(actor, resolved);
  };

  const onItemUse = (event: Event) => {
    const detail = (event as CustomEvent<ItemUseDetail>).detail;
    if (!detail?.effectId || !detail.instanceId) return;
    const resolved = resolveActor(detail);
    if (!resolved) return;
    const { actor, owner } = resolved;
    const durationMs = Math.max(0, numeric(detail.values.duration, 0) * 1000);

    if (detail.values.remove_slow === true || detail.effectId === 'cleanse_slow_and_haste' || detail.effectId === 'short_blink_cleanse_slow') {
      removeWorldSlows(actor.root);
    }

    if (detail.values.ignore_unit_collision === true && durationMs > 0) {
      addWorldStatus(actor.root, {
        id: `phase:${detail.instanceId}:${detail.activatedAtMs}`,
        expiresAtMs: detail.activatedAtMs + durationMs,
        ignoreUnitCollision: true,
      });
    }

    switch (detail.effectId) {
      case 'place_vision_ward':
        spawnWard(actor, detail);
        break;
      case 'reveal_area':
        revealArea(actor, detail);
        break;
      case 'ground_aoe_magic_damage':
        queueNova(actor, owner, detail);
        break;
      case 'persistent_aoe_slow_damage':
        spawnSingularity(actor, owner, detail);
        break;
      case 'short_blink_cleanse_slow':
        blink(actor, detail);
        break;
      case 'mana_restore_and_shield': {
        const amount = Math.max(0, (owner?.maxResource ?? 0) * numeric(detail.values.shield_pct_max_mana, 0) / 100);
        grantShield(actor, `shield:${detail.instanceId}:${detail.activatedAtMs}`, amount, detail.activatedAtMs + Math.max(100, durationMs));
        break;
      }
      default:
        break;
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!(event.target instanceof HTMLCanvasElement) || !event.target.classList.contains('game-canvas')) return;
    const rect = event.target.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    pointerValid = true;
  };

  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener(ITEM_USE_EVENT, onItemUse as EventListener);

  const removeTimedObject = (entry: TimedWorldObject) => {
    timedObjects.delete(entry.id);
    if (entry.entity) registry.unregister(entry.root);
    entry.root.removeFromParent();
    disposeObject3D(entry.root);
  };

  const findContextForEntity = (entity: GameEntity, contexts: readonly HeroItemRuntimeContext[]) => {
    const matchHeroId = entity.root.userData.matchHeroEntityId as string | undefined;
    if (matchHeroId) {
      const exact = contexts.find(context => context.heroEntityId === matchHeroId);
      if (exact) return exact;
    }
    return contexts.find(context => (
      matchTeamToWorld(context.team) === entity.team
      && (context.definitionId === entity.definitionId || context.heroName === entity.displayName)
    ));
  };

  const applyMovementCorrection = (nowMs: number) => {
    const contexts = getHeroItemRuntimeContexts();
    for (const entity of registry.values()) {
      if (entity.kind !== 'hero' || !entity.alive || !entity.root.parent) continue;
      entity.root.getWorldPosition(actorPosition);
      const teleportAtMs = numeric(entity.root.userData[TELEPORT_KEY], 0);
      const previous = movementSamples.get(entity.id);
      if (!previous || previous.teleportAtMs !== teleportAtMs) {
        movementSamples.set(entity.id, { position: actorPosition.clone(), teleportAtMs });
        continue;
      }
      const dx = actorPosition.x - previous.position.x;
      const dz = actorPosition.z - previous.position.z;
      const moved = Math.hypot(dx, dz);
      const context = findContextForEntity(entity, contexts);
      const itemRatio = context && context.baseMovementSpeed > 0
        ? context.movementSpeed / context.baseMovementSpeed
        : 1;
      const worldRatio = getWorldItemMovementMultiplier(entity.root, nowMs);
      const multiplier = THREE.MathUtils.clamp(itemRatio * worldRatio, 0.12, 2.5);
      if (moved > 0.0001 && moved < 2.5 && Math.abs(multiplier - 1) > 0.001 && entity.root.parent) {
        const correctedWorld = actorPosition.clone();
        correctedWorld.x = previous.position.x + dx * multiplier;
        correctedWorld.z = previous.position.z + dz * multiplier;
        parentLocal.copy(correctedWorld);
        entity.root.parent.worldToLocal(parentLocal);
        entity.root.position.x = parentLocal.x;
        entity.root.position.z = parentLocal.z;
        entity.root.getWorldPosition(actorPosition);
      }
      previous.position.copy(actorPosition);
      previous.teleportAtMs = teleportAtMs;
    }
  };

  const update = (nowMs: number) => {
    if (nowMs - lastWorldUpdateAtMs < WORLD_UPDATE_INTERVAL_MS) return;
    lastWorldUpdateAtMs = nowMs;

    for (const entry of [...timedObjects.values()]) {
      if (entry.expiresAtMs <= nowMs) removeTimedObject(entry);
    }

    for (const burst of [...bursts.values()]) {
      if (burst.fireAtMs > nowMs) continue;
      for (const target of hostileDamageTargets(burst.actor, burst.point, burst.radius)) {
        damageEntity(burst.actor, target, burst.rawDamage, nowMs);
      }
      bursts.delete(burst.id);
      burst.visual.removeFromParent();
      disposeObject3D(burst.visual);
    }

    for (const zone of [...zones.values()]) {
      if (zone.expiresAtMs <= nowMs) {
        zones.delete(zone.id);
        zone.visual.removeFromParent();
        disposeObject3D(zone.visual);
        continue;
      }
      const elapsedMs = Math.min(DAMAGE_TICK_INTERVAL_MS, Math.max(0, nowMs - zone.lastTickAtMs));
      if (elapsedMs <= 0) continue;
      zone.lastTickAtMs = nowMs;
      const damage = zone.damagePerSecond * elapsedMs / 1000;
      for (const target of hostileDamageTargets(zone.actor, zone.point, zone.radius)) {
        damageEntity(zone.actor, target, damage, nowMs);
        if (zone.slowPercent > 0) {
          addWorldStatus(target.root, {
            id: `slow:${zone.id}`,
            expiresAtMs: nowMs + DAMAGE_TICK_INTERVAL_MS * 2.25,
            slowPercent: zone.slowPercent,
          });
        }
      }
    }

    for (const entity of registry.values()) {
      clearExpiredWorldStatuses(entity.root, nowMs);
      const shields = entity.root.userData[SHIELD_KEY] as ItemShield[] | undefined;
      if (shields) {
        for (let index = shields.length - 1; index >= 0; index--) {
          if (shields[index].expiresAtMs <= nowMs || shields[index].remaining <= 0) shields.splice(index, 1);
        }
      }
      const detectedUntil = Math.max(
        numeric(entity.root.userData[DETECTED_BLUE_KEY], 0),
        numeric(entity.root.userData[DETECTED_RED_KEY], 0),
      );
      if (detectedUntil <= nowMs && entity.root.userData.revealedByItem === true) {
        entity.root.userData.revealedByItem = false;
      }
    }

    applyMovementCorrection(nowMs);
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
      update(performance.now());
    }
    previousSceneBeforeRender.call(this, renderer, renderedScene, camera, geometry, material, group);
  };
  scene.onBeforeRender = beforeRender;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener(ITEM_USE_EVENT, onItemUse as EventListener);
    if (scene.onBeforeRender === beforeRender) scene.onBeforeRender = previousSceneBeforeRender;
    for (const burst of bursts.values()) {
      burst.visual.removeFromParent();
      disposeObject3D(burst.visual);
    }
    bursts.clear();
    for (const zone of zones.values()) {
      zone.visual.removeFromParent();
      disposeObject3D(zone.visual);
    }
    zones.clear();
    for (const entry of [...timedObjects.values()]) removeTimedObject(entry);
    movementSamples.clear();
    for (const uninstall of shieldUninstallers.values()) uninstall();
    shieldUninstallers.clear();
    delete scene.userData[SYSTEM_KEY];
    if (disposeActiveItemWorldSystem === dispose) disposeActiveItemWorldSystem = null;
  };

  const system: ItemActiveWorldSystem = { dispose };
  scene.userData[SYSTEM_KEY] = system;
  disposeActiveItemWorldSystem = dispose;
  return system;
}
