import * as THREE from 'three';
import { calculateTowerAuraAdjustedDamage } from '../../entities/towerAuras';
import {
  emitWorldCombatEvent,
  getWorldEntityRuntime,
  publishWorldEntityRuntime,
} from '../../entities/worldCombatBridge';
import type { GameEntity, GameEntityRegistry } from '../../entities/gameEntities';
import type { AbilityKey, DamageType } from '../types';
import { SERYN } from './gameplay';

const UNIT = 0.01;
const installed = new WeakMap<THREE.Scene, SerynWorldAbilityRuntime>();

export type SerynWorldAbilityRuntimeHandle = Readonly<{
  update(nowMs: number): void;
  trigger(key: AbilityKey, rank: number, nowMs: number): boolean;
  dispose(): void;
}>;

type Pending = { atMs: number; run: () => void };
type Dash = { start: THREE.Vector3; end: THREE.Vector3; startMs: number; durationMs: number };

export function ensureSerynWorldAbilityRuntime(
  scene: THREE.Scene,
  registry: GameEntityRegistry,
  hero: GameEntity,
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
): SerynWorldAbilityRuntimeHandle {
  let runtime = installed.get(scene);
  if (!runtime) {
    runtime = new SerynWorldAbilityRuntime(scene, registry, hero, canvas, camera);
    installed.set(scene, runtime);
  }
  return runtime;
}

export function triggerSerynWorldAbility(
  scene: THREE.Scene,
  key: AbilityKey,
  rank: number,
  nowMs = performance.now(),
) {
  return installed.get(scene)?.trigger(key, rank, nowMs) ?? false;
}

class SerynWorldAbilityRuntime implements SerynWorldAbilityRuntimeHandle {
  private pointer = new THREE.Vector2(0, 0);
  private raycaster = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private hit = new THREE.Vector3();
  private pending: Pending[] = [];
  private dash: Dash | null = null;
  private disposed = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly registry: GameEntityRegistry,
    private readonly hero: GameEntity,
    private readonly canvas: HTMLCanvasElement,
    private readonly camera: THREE.Camera,
  ) {
    canvas.addEventListener('pointermove', this.onPointerMove, { passive: true });
  }

  private readonly onPointerMove = (event: PointerEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
  };

  update(nowMs: number) {
    if (this.disposed) return;
    if (this.dash) {
      const t = Math.max(0, Math.min(1, (nowMs - this.dash.startMs) / this.dash.durationMs));
      const eased = t * t * (3 - 2 * t);
      this.hero.root.position.lerpVectors(this.dash.start, this.dash.end, eased);
      if (t >= 1) this.dash = null;
    }
    for (let index = this.pending.length - 1; index >= 0; index--) {
      if (this.pending[index].atMs > nowMs) continue;
      const task = this.pending.splice(index, 1)[0];
      task.run();
    }
  }

  trigger(key: AbilityKey, rank: number, nowMs: number) {
    if (this.disposed || !this.hero.alive || this.hero.currentHp <= 0) return false;
    if (key === 'Q') this.castQ(rank, nowMs);
    else if (key === 'W') this.castW(rank, nowMs);
    else if (key === 'E') this.castE(rank, nowMs);
    else this.castR(rank, nowMs);
    return true;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.pending = [];
    this.dash = null;
    if (installed.get(this.scene) === this) installed.delete(this.scene);
  }

  private aimDirection() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.ground, this.hit);
    const dx = (hit?.x ?? this.hero.root.position.x) - this.hero.root.position.x;
    const dz = (hit?.z ?? this.hero.root.position.z + 1) - this.hero.root.position.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.001) {
      const yaw = this.hero.root.rotation.y;
      return new THREE.Vector2(Math.sin(yaw), Math.cos(yaw));
    }
    return new THREE.Vector2(dx / length, dz / length);
  }

  private aimPoint(maxRange: number) {
    const dir = this.aimDirection();
    const origin = this.hero.root.position;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.ray.intersectPlane(this.ground, this.hit);
    const distance = hit ? Math.min(maxRange, Math.hypot(hit.x - origin.x, hit.z - origin.z)) : maxRange;
    return new THREE.Vector3(origin.x + dir.x * distance, origin.y, origin.z + dir.y * distance);
  }

  private castQ(rank: number, nowMs: number) {
    const safeRank = Math.min(4, Math.max(1, rank));
    const direction = this.aimDirection();
    const impactAt = nowMs + SERYN.q.castTimeSeconds * 1000;
    this.pending.push({
      atMs: impactAt,
      run: () => {
        const stats = this.stats();
        const full = this.power(SERYN.q.ranks[safeRank - 1].baseDamage + SERYN.q.totalAdRatio * stats.attackDamage, stats.abilityPowerPercent);
        const candidates = this.lineTargets(direction, SERYN.q.range * UNIT, SERYN.q.width * UNIT);
        for (const target of candidates) {
          const normal = target.kind === 'creep';
          this.damage(target, full * (normal ? SERYN.q.normalEnemyPierceDamageMultiplier : 1), impactAt, 'physical');
          if (!normal) break;
        }
      },
    });
  }

  private castW(rank: number, nowMs: number) {
    const direction = this.aimDirection();
    const distance = SERYN.w.dashRange * UNIT;
    const start = this.hero.root.position.clone();
    const end = start.clone().add(new THREE.Vector3(direction.x * distance, 0, direction.y * distance));
    this.dash = {
      start,
      end,
      startMs: nowMs,
      durationMs: Math.max(1, SERYN.w.dashDurationSeconds * 1000),
    };
    this.hero.root.userData.serynVectorStepUntilMs = nowMs + SERYN.w.buffDurationSeconds * 1000;
    this.hero.root.userData.serynVectorStepRank = Math.min(4, Math.max(1, rank));
  }

  private castE(rank: number, nowMs: number) {
    const safeRank = Math.min(4, Math.max(1, rank));
    const center = this.aimPoint(SERYN.e.castRange * UNIT);
    const impactAt = nowMs + SERYN.e.armDelaySeconds * 1000;
    this.pending.push({
      atMs: impactAt,
      run: () => {
        const stats = this.stats();
        const data = SERYN.e.ranks[safeRank - 1];
        const damage = this.power(data.baseDamage + SERYN.e.totalAdRatio * stats.attackDamage, stats.abilityPowerPercent);
        for (const target of this.radiusTargets(center, SERYN.e.radius * UNIT)) {
          this.damage(target, damage, impactAt, 'magic');
          const distance = this.horizontalDistance(target.root, center);
          this.slow(target, data.slowPercent, SERYN.e.slowDurationSeconds, impactAt, 'seryn:e:slow');
          if (distance <= SERYN.e.centerRadius * UNIT) {
            this.slow(target, 100, data.rootDurationSeconds, impactAt, 'seryn:e:root');
          }
        }
      },
    });
  }

  private castR(rank: number, nowMs: number) {
    const safeRank = Math.min(3, Math.max(1, rank));
    const direction = this.aimDirection();
    const stats = this.stats();
    const data = SERYN.r.ranks[safeRank - 1];
    const baseShot = this.power(data.shotBaseDamage + SERYN.r.totalAdRatioPerShot * stats.attackDamage, stats.abilityPowerPercent);
    const hitCount = new Map<string, number>();
    for (let shot = 0; shot < SERYN.r.shotCount; shot++) {
      const atMs = nowMs + SERYN.r.startupSeconds * 1000 + shot * SERYN.r.shotIntervalSeconds * 1000;
      this.pending.push({
        atMs,
        run: () => {
          const candidates = this.lineTargets(direction, SERYN.r.range * UNIT, SERYN.r.width * UNIT);
          for (const target of candidates) {
            const previousHits = hitCount.get(target.id) ?? 0;
            const multiplier = previousHits > 0 ? SERYN.r.repeatedHitDamageMultiplier : 1;
            this.damage(target, baseShot * multiplier, atMs, 'physical');
            this.slow(target, data.slowPercent, SERYN.r.slowDurationSeconds, atMs, 'seryn:r:slow');
            hitCount.set(target.id, previousHits + 1);
          }
        },
      });
    }
  }

  private stats() {
    return {
      attackDamage: Math.max(0, Number(this.hero.root.userData.attackDamage ?? 54)),
      abilityPowerPercent: Math.max(0, Number(this.hero.root.userData.abilityPowerPercent ?? 0)),
    };
  }

  private power(raw: number, abilityPowerPercent: number) {
    return Math.max(0, raw) * (1 + abilityPowerPercent / 100);
  }

  private hostile(target: GameEntity) {
    if (!target.alive || !target.targetable || target.team === this.hero.team || target.kind === 'shop') return false;
    if ((target.kind === 'building' || target.kind === 'tower') && target.interaction !== 'attackable-structure') return false;
    return true;
  }

  private lineTargets(direction: THREE.Vector2, range: number, width: number) {
    const origin = this.hero.root.getWorldPosition(new THREE.Vector3());
    return this.registry.values()
      .filter(target => this.hostile(target))
      .map(target => {
        const point = target.root.getWorldPosition(new THREE.Vector3());
        const dx = point.x - origin.x;
        const dz = point.z - origin.z;
        const forward = dx * direction.x + dz * direction.y;
        const lateral = Math.abs(dx * direction.y - dz * direction.x);
        const allowance = width * 0.5 + Math.max(0.1, target.selectionRadius * 0.4);
        return { target, forward, lateral, allowance };
      })
      .filter(hit => hit.forward >= 0 && hit.forward <= range && hit.lateral <= hit.allowance)
      .sort((a, b) => a.forward - b.forward)
      .map(hit => hit.target);
  }

  private radiusTargets(center: THREE.Vector3, radius: number) {
    return this.registry.values().filter(target => (
      this.hostile(target)
      && this.horizontalDistance(target.root, center) <= radius + Math.max(0.1, target.selectionRadius * 0.35)
    ));
  }

  private horizontalDistance(root: THREE.Object3D, center: THREE.Vector3) {
    const point = root.getWorldPosition(new THREE.Vector3());
    return Math.hypot(point.x - center.x, point.z - center.z);
  }

  private slow(target: GameEntity, slowPercent: number, durationSeconds: number, nowMs: number, id: string) {
    if (target.kind !== 'creep' && target.kind !== 'jungle-creature' && target.kind !== 'hero') return;
    const statuses = target.root.userData.dawnreachItemWorldStatuses ??= {};
    statuses[`${id}:${this.hero.id}`] = {
      expiresAtMs: nowMs + Math.max(0, durationSeconds) * 1000,
      slowPercent: Math.max(0, slowPercent),
    };
  }

  private damage(target: GameEntity, rawDamage: number, atMs: number, damageType: DamageType) {
    if (!this.hostile(target)) return 0;
    const adjusted = Math.max(0, calculateTowerAuraAdjustedDamage(this.hero, target, rawDamage));
    if (adjusted <= 0) return 0;

    const networkRemoteHero = target.kind === 'hero' && target.root.userData.networkRemoteHero === true;
    const networkRemoteCreep = target.kind === 'creep' && target.root.userData.networkReplica === true;
    const networkRemoteStructure = this.scene.userData.laneCreepNetworkMode === 'replica'
      && (target.kind === 'tower' || target.kind === 'building')
      && target.interaction === 'attackable-structure';

    if (networkRemoteHero || networkRemoteCreep || networkRemoteStructure) {
      emitWorldCombatEvent({
        entityId: target.id,
        reason: 'damage',
        currentHp: target.currentHp,
        currentResource: target.currentResource,
        alive: target.alive,
        amount: adjusted,
        sourceEntityId: this.hero.id,
        damageType,
        isDirect: true,
        isFromFront: true,
        atMs,
      });
      return adjusted;
    }

    const before = target.currentHp;
    target.currentHp = Math.max(0, target.currentHp - adjusted);
    target.alive = target.currentHp > 0;
    target.root.userData.currentHp = target.currentHp;
    target.root.userData.alive = target.alive;
    const previous = getWorldEntityRuntime(target.id);
    publishWorldEntityRuntime(target.id, {
      level: target.level,
      maxHp: target.maxHp,
      currentHp: target.currentHp,
      maxResource: target.maxResource,
      currentResource: target.currentResource,
      alive: target.alive,
      physicalArmor: previous?.physicalArmor,
      magicResistance: previous?.magicResistance,
      movementSpeed: previous?.movementSpeed,
      magicPower: previous?.magicPower,
      statuses: previous?.statuses,
    });
    const dealt = Math.max(0, before - target.currentHp);
    emitWorldCombatEvent({
      entityId: target.id,
      reason: target.alive ? 'damage' : 'death',
      currentHp: target.currentHp,
      currentResource: target.currentResource,
      alive: target.alive,
      amount: dealt,
      sourceEntityId: this.hero.id,
      damageType,
      isDirect: true,
      isFromFront: true,
      atMs,
    });
    return dealt;
  }
}
