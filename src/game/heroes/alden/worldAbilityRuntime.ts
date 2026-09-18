import * as THREE from 'three';
import type { GameEntity, GameEntityRegistry } from '../../entities/gameEntities';
import { calculateTowerAuraAdjustedDamage } from '../../entities/towerAuras';
import {
  emitWorldCombatEvent,
  getWorldEntityRuntime,
  publishWorldAttackEvent,
  publishWorldEntityRuntime,
  queueWorldDamageAdjustment,
  registerWorldAttackEventGuard,
  registerWorldCombatEventGuard,
  subscribeWorldAttackEvents,
} from '../../entities/worldCombatBridge';
import { MAP_BOUNDS } from '../../map/mapLayout';
import { LOCAL_HERO_ENTITY_ID, reduceHeroAbilityCooldown } from '../../match/abilityControls';
import { toMatchGameTimeMs } from '../../match/matchPauseRuntime';
import { calculateDefinitionStatsAtLevel } from '../heroAttributes';
import type { AbilityKey } from '../types';
import { ALDEN } from './gameplay';

const GAME_UNIT_TO_WORLD = 0.01;
const WORLD_STATUS_KEY = 'dawnreachItemWorldStatuses';
const ABILITY_KEYS: readonly AbilityKey[] = ['Q', 'W', 'E', 'R'];
const HERO_GROUND_EFFECT_Y = 0.08;
const EPSILON = 1e-5;

const Q_DASH_RANGE = ALDEN.q.dashRange * GAME_UNIT_TO_WORLD;
const Q_CLEAVE_RANGE = ALDEN.q.cleaveRange * GAME_UNIT_TO_WORLD;
const E_RADIUS = ALDEN.e.activeRadius * GAME_UNIT_TO_WORLD;
const R_RADIUS = ALDEN.r.radius * GAME_UNIT_TO_WORLD;

const GOLD = 0xe7bd66;
const BLUE = 0x59c9f2;
const GUARD_BLUE = 0x8de6ff;
const JUDGEMENT_GOLD = 0xffd27a;

const installedScenes = new WeakMap<THREE.Scene, AldenWorldRuntime>();
const activeRuntimes = new Set<AldenWorldRuntime>();

type HudCombatStats = {
  attackDamage: number;
  abilityPowerPercent: number;
  maxHp: number;
};

type CadenceState = {
  stacks: number;
  expiresAtMs: number;
};

type FrozenTarget = {
  entity: GameEntity;
  untilMs: number;
  worldPosition: THREE.Vector3;
};

type DashState = {
  startedAtMs: number;
  durationMs: number;
  start: THREE.Vector3;
  end: THREE.Vector3;
};

type PendingImpact = {
  atMs: number;
  run: () => void;
};

type AbilityAnimationKey = AbilityKey | 'REPRISAL';

type AbilityAnimation = {
  key: AbilityAnimationKey;
  startedAtMs: number;
  durationMs: number;
  facingYaw?: number;
};

type WorldFx = {
  object: THREE.Object3D;
  material: THREE.MeshBasicMaterial;
  startedAtMs: number;
  durationMs: number;
  initialOpacity: number;
  grow: number;
  follow?: THREE.Object3D;
  yOffset: number;
};

type AbilityJoints = {
  model: THREE.Object3D | null;
  pelvis: THREE.Object3D | null;
  torso: THREE.Object3D | null;
  leftShoulder: THREE.Object3D | null;
  rightShoulder: THREE.Object3D | null;
  leftElbow: THREE.Object3D | null;
  rightElbow: THREE.Object3D | null;
  wrist: THREE.Object3D | null;
};

export type AldenWorldAbilityRuntimeHandle = Readonly<{
  update(nowMs: number): void;
  castAbility(key: AbilityKey, rank: number, nowMs: number): void;
  dispose(): void;
}>;

/**
 * The old implementation discovered the game by monkey-patching WebGLRenderer.prototype.render.
 * Three.js r180 defines render on each WebGLRenderer instance, so that prototype hook never ran
 * in the actual Dawnreach renderer. The ability runtime is now mounted explicitly by
 * createDawnreachGame with the authoritative scene, registry, hero, canvas and camera.
 */
export function ensureAldenWorldAbilityRuntime(
  scene: THREE.Scene,
  registry: GameEntityRegistry,
  hero: GameEntity,
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
): AldenWorldAbilityRuntimeHandle {
  let runtime = installedScenes.get(scene);
  if (!runtime) {
    runtime = new AldenWorldRuntime(scene, registry, hero, canvas, camera);
    installedScenes.set(scene, runtime);
    activeRuntimes.add(runtime);
  } else {
    runtime.setCamera(camera);
  }
  return runtime;
}

/**
 * Kept for the bootstrap/HMR contract. Runtime discovery no longer happens here; live game
 * instances register themselves through ensureAldenWorldAbilityRuntime.
 */
export function mountAldenWorldAbilityRuntime() {
  return () => {
    for (const runtime of [...activeRuntimes]) runtime.dispose();
    activeRuntimes.clear();
  };
}

export function triggerAldenWorldAbility(
  scene: THREE.Scene,
  key: AbilityKey,
  rank: number,
  nowMs = toMatchGameTimeMs(performance.now()),
) {
  const runtime = installedScenes.get(scene);
  if (!runtime) return false;
  runtime.castAbility(key, rank, nowMs);
  return true;
}

class AldenWorldRuntime implements AldenWorldAbilityRuntimeHandle {
  private readonly commandSurfaces: THREE.Mesh[] = [];
  private readonly cadenceByTarget = new Map<string, CadenceState>();
  private readonly judgedUntilByTarget = new Map<string, number>();
  private readonly frozenTargets = new Map<string, FrozenTarget>();
  private readonly pendingImpacts: PendingImpact[] = [];
  private readonly effects: WorldFx[] = [];
  private readonly pointerNdc = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hitPoint = new THREE.Vector3();
  private readonly tempSource = new THREE.Vector3();
  private readonly tempTarget = new THREE.Vector3();
  private readonly lastHeroPosition = new THREE.Vector3();
  private readonly cooldownWasActive = new Map<AbilityKey, boolean>();
  private readonly lastCastAtMs = new Map<AbilityKey, number>();
  private readonly joints: AbilityJoints;

  private camera: THREE.Camera;
  private pointerSeen = false;
  private disposed = false;
  private suppressAbilityAttackBroadcast = false;
  private forwardingAdjustedDamage = false;
  private guardUntilMs = 0;
  private guardRank = 0;
  private guardPreventedDamage = 0;
  private reprisalUntilMs = 0;
  private reprisalRank = 0;
  private majestyUntilMs = 0;
  private majestyRank = 0;
  private lastMajestyCooldownProcAtMs = -Infinity;
  private movementLockUntilMs = 0;
  private readonly movementLockPosition = new THREE.Vector3();
  private dash: DashState | null = null;
  private animation: AbilityAnimation | null = null;

  private readonly observer: MutationObserver;
  private readonly disposeAttackSubscription: () => void;
  private readonly disposeAttackGuard: () => void;
  private readonly disposeCombatGuard: () => void;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly registry: GameEntityRegistry,
    private readonly hero: GameEntity,
    private readonly canvas: HTMLCanvasElement,
    camera: THREE.Camera,
  ) {
    this.camera = camera;
    scene.traverse(object => {
      if (object instanceof THREE.Mesh && object.userData.commandSurface) this.commandSurfaces.push(object);
    });

    this.joints = this.resolveAbilityJoints();
    this.hero.root.getWorldPosition(this.lastHeroPosition);
    this.canvas.addEventListener('pointermove', this.onPointerMove, { passive: true });

    this.observer = new MutationObserver(this.onHudMutation);
    this.observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-cooldown'],
    });
    this.captureCurrentCooldownStates();

    this.disposeAttackSubscription = subscribeWorldAttackEvents(this.onWorldAttack);
    this.disposeAttackGuard = registerWorldAttackEventGuard(
      `alden-world-ability-attack:${scene.uuid}`,
      event => !(this.suppressAbilityAttackBroadcast && event.attackerId === this.hero.id),
    );
    this.disposeCombatGuard = registerWorldCombatEventGuard(
      `alden-world-defense:${scene.uuid}`,
      this.guardIncomingHeroDamage,
    );
  }

  setCamera(camera: THREE.Camera) {
    this.camera = camera;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.observer.disconnect();
    this.disposeAttackSubscription();
    this.disposeAttackGuard();
    this.disposeCombatGuard();
    for (const effect of [...this.effects]) this.disposeEffect(effect);
    this.effects.length = 0;
    this.pendingImpacts.length = 0;
    this.frozenTargets.clear();
    this.cadenceByTarget.clear();
    this.judgedUntilByTarget.clear();
    activeRuntimes.delete(this);
  }

  update(nowMs: number) {
    if (this.disposed) return;
    this.updateDash(nowMs);
    this.updateMovementModifiers(nowMs);
    this.updateFrozenTargets(nowMs);
    this.runPendingImpacts(nowMs);
    this.updateEffects(nowMs);
    this.applyAbilityPose(nowMs);
    this.pruneRuntimeState(nowMs);
  }

  private readonly onPointerMove = (event: PointerEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.pointerNdc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.pointerSeen = true;
  };

  private captureCurrentCooldownStates() {
    for (const key of ABILITY_KEYS) {
      const button = this.getAbilityButton(key);
      this.cooldownWasActive.set(key, Number(button?.dataset.cooldown ?? 0) > 1);
    }
  }

  private readonly onHudMutation = (mutations: MutationRecord[]) => {
    for (const mutation of mutations) {
      const button = mutation.target;
      if (!(button instanceof HTMLButtonElement) || !button.classList.contains('ability-slot')) continue;
      const control = button.closest<HTMLElement>('.ability-control');
      const key = control?.dataset.ability as AbilityKey | undefined;
      if (!key || !ABILITY_KEYS.includes(key)) continue;

      const cooling = Number(button.dataset.cooldown ?? 0) > 1;
      const wasCooling = this.cooldownWasActive.get(key) ?? false;
      this.cooldownWasActive.set(key, cooling);
      if (wasCooling || !cooling) continue;

      const rank = this.readAbilityRank(key);
      if (rank <= 0 || !this.hero.alive || this.hero.currentHp <= 0) continue;
      this.castAbility(key, rank, toMatchGameTimeMs(performance.now()));
    }
  };

  private getAbilityButton(key: AbilityKey) {
    return document.querySelector<HTMLButtonElement>(`.ability-control[data-ability="${key}"] .ability-slot`);
  }

  private readAbilityRank(key: AbilityKey) {
    const label = document.querySelector<HTMLElement>(`.ability-control[data-ability="${key}"] .ability-rank b`)?.textContent ?? '0';
    const value = Number.parseInt(label.split('/')[0] ?? '0', 10);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }

  castAbility(key: AbilityKey, rank: number, nowMs: number) {
    const previousCastAt = this.lastCastAtMs.get(key) ?? -Infinity;
    if (nowMs - previousCastAt < 120) return;
    const safeRank = Math.max(1, Math.floor(rank));
    this.lastCastAtMs.set(key, nowMs);
    this.cooldownWasActive.set(key, true);
    switch (key) {
      case 'Q': this.castQ(safeRank, nowMs); break;
      case 'W': this.castW(safeRank, nowMs); break;
      case 'E': this.castE(safeRank, nowMs); break;
      case 'R': this.castR(safeRank, nowMs); break;
    }
  }

  private castQ(rank: number, nowMs: number) {
    const rankData = ALDEN.q.ranks[Math.min(ALDEN.q.ranks.length, Math.max(1, rank)) - 1];
    const direction = this.resolveAimDirection();
    const start = this.hero.root.position.clone();
    const end = this.findDashEndpoint(start, direction, Q_DASH_RANGE);
    const facingYaw = Math.atan2(direction.x, direction.y);
    const impactAt = nowMs + ALDEN.q.castTimeSeconds * 1000;

    this.dash = {
      startedAtMs: nowMs,
      durationMs: ALDEN.q.castTimeSeconds * 1000,
      start,
      end,
    };
    this.animation = { key: 'Q', startedAtMs: nowMs, durationMs: 460, facingYaw };
    this.spawnSectorFx(this.hero.root, Q_CLEAVE_RANGE, ALDEN.q.cleaveAngleDegrees, facingYaw, BLUE, 360, 0.22);

    this.pendingImpacts.push({
      atMs: impactAt,
      run: () => {
        const stats = this.readHudCombatStats();
        const damage = this.applyAbilityPower(
          rankData.baseDamage + ALDEN.q.totalAdRatio * stats.attackDamage,
          stats.abilityPowerPercent,
        );
        const hits = this.findEnemiesInCone(Q_CLEAVE_RANGE, ALDEN.q.cleaveAngleDegrees, direction);
        const priority = [...hits]
          .filter(target => target.kind !== 'creep')
          .sort((a, b) => this.priorityForCadence(a) - this.priorityForCadence(b))[0] ?? null;

        for (const target of hits) {
          this.damageTarget(target, damage, impactAt);
          this.publishAbilityAggro(target, impactAt);
          if (target.kind === 'creep' || target.kind === 'jungle-creature' || target.kind === 'hero') {
            this.applyMovementSlow(target, rankData.slowPercent, rankData.slowDurationSeconds, impactAt);
          }
        }
        if (priority) this.addCadence(priority, ALDEN.q.cadenceStacksAppliedToFirstPriorityTarget, impactAt);
        this.spawnGroundRing(this.hero.root, Q_CLEAVE_RANGE * 0.84, BLUE, 320, 0.62);
      },
    });
  }

  private castW(rank: number, nowMs: number) {
    const safeRank = Math.min(ALDEN.w.ranks.length, Math.max(1, rank));
    this.guardRank = safeRank;
    this.guardUntilMs = nowMs + ALDEN.w.guardDurationSeconds * 1000;
    this.guardPreventedDamage = 0;
    this.animation = { key: 'W', startedAtMs: nowMs, durationMs: ALDEN.w.guardDurationSeconds * 1000 };
    this.spawnArcRingFx(
      this.hero.root,
      1.75,
      ALDEN.w.guardArcDegrees,
      this.currentFacingYaw(),
      GUARD_BLUE,
      ALDEN.w.guardDurationSeconds * 1000,
      0.70,
      true,
    );
  }

  private castE(rank: number, nowMs: number) {
    const safeRank = Math.min(ALDEN.e.ranks.length, Math.max(1, rank));
    const rankData = ALDEN.e.ranks[safeRank - 1];
    const stats = this.readHudCombatStats();
    const targets = this.findEnemiesInRadius(E_RADIUS);
    let healing = 0;

    this.animation = { key: 'E', startedAtMs: nowMs, durationMs: 560 };
    this.spawnGroundRing(this.hero.root, E_RADIUS, GOLD, 520, 0.72);

    for (const target of targets) {
      const cadence = this.getCadence(target.id, nowMs);
      const stacks = cadence?.stacks ?? 0;
      const damage = this.applyAbilityPower(
        rankData.activeBaseDamage
          + ALDEN.e.activeTotalAdRatio * stats.attackDamage
          + rankData.bonusDamagePerConsumedStack * stacks,
        stats.abilityPowerPercent,
      );
      this.damageTarget(target, damage, nowMs);
      this.publishAbilityAggro(target, nowMs);

      if (stacks <= 0) continue;
      const healingMultiplier = target.kind === 'creep'
        ? ALDEN.e.normalEnemyHealingMultiplier
        : ALDEN.e.eliteBossPlayerHealingMultiplier;
      healing += stats.maxHp
        * (rankData.healingPercentMaxHpPerStack / 100)
        * stacks
        * healingMultiplier;
      this.cadenceByTarget.delete(target.id);
    }

    if (healing > 0) this.healHero(healing, nowMs);
  }

  private castR(rank: number, nowMs: number) {
    const safeRank = Math.min(ALDEN.r.ranks.length, Math.max(1, rank));
    const rankData = ALDEN.r.ranks[safeRank - 1];
    const impactAt = nowMs + ALDEN.r.castTimeSeconds * 1000;

    this.majestyRank = safeRank;
    this.majestyUntilMs = impactAt + ALDEN.r.majestyDurationSeconds * 1000;
    this.lastMajestyCooldownProcAtMs = -Infinity;
    this.movementLockUntilMs = impactAt;
    this.movementLockPosition.copy(this.hero.root.position);
    this.animation = { key: 'R', startedAtMs: nowMs, durationMs: 900 };

    this.spawnGroundRing(this.hero.root, R_RADIUS, JUDGEMENT_GOLD, ALDEN.r.castTimeSeconds * 1000, 0.50, true);
    this.pendingImpacts.push({
      atMs: impactAt,
      run: () => {
        const stats = this.readHudCombatStats();
        const damage = this.applyAbilityPower(
          rankData.baseDamage + ALDEN.r.totalAdRatio * stats.attackDamage,
          stats.abilityPowerPercent,
        );
        const targets = this.findEnemiesInRadius(R_RADIUS);

        for (const target of targets) {
          this.damageTarget(target, damage, impactAt);
          this.publishAbilityAggro(target, impactAt);
          this.addCadence(target, 1, impactAt);
          this.judgedUntilByTarget.set(target.id, impactAt + ALDEN.r.majestyDurationSeconds * 1000);

          if (target.kind === 'hero') {
            target.root.userData.aldenTauntedUntilMs = impactAt + rankData.pvpTauntDurationSeconds * 1000;
            target.root.userData.aldenForcedTargetEntityId = this.hero.id;
          } else if (target.kind === 'creep') {
            target.root.userData.aldenTauntedUntilMs = impactAt + rankData.eliteTauntDurationSeconds * 1000;
            target.root.userData.aldenForcedTargetEntityId = this.hero.id;
          } else if (target.kind === 'jungle-creature') {
            target.root.userData.aldenThreatMultiplier = ALDEN.r.bossThreatMultiplier;
            target.root.userData.aldenThreatSourceEntityId = this.hero.id;
          }
          this.spawnGroundRing(target.root, Math.max(0.5, target.selectionRadius * 0.8), GOLD, 420, 0.68, true);
        }

        this.spawnGroundRing(this.hero.root, R_RADIUS, JUDGEMENT_GOLD, 620, 0.86);
        this.spawnGroundRing(this.hero.root, 1.5, GOLD, ALDEN.r.majestyDurationSeconds * 1000, 0.28, true);
      },
    });
  }

  private readonly onWorldAttack = (event: Parameters<Parameters<typeof subscribeWorldAttackEvents>[0]>[0]) => {
    if (event.attackerId !== this.hero.id || this.suppressAbilityAttackBroadcast) return;
    const nowMs = event.atMs;
    const target = this.registry.values().find(entity => entity.id === event.targetId) ?? null;
    if (!target) return;

    const eRank = this.readAbilityRank('E');
    if (eRank > 0) {
      this.addCadence(target, 1, nowMs);
      const cadence = this.getCadence(target.id, nowMs);
      if (cadence) {
        const rankData = ALDEN.e.ranks[Math.min(ALDEN.e.ranks.length, eRank) - 1];
        this.hero.root.userData.aldenCadenceTargetId = target.id;
        this.hero.root.userData.aldenCadenceStacks = cadence.stacks;
        this.hero.root.userData.aldenCadenceAttackSpeedPercent = rankData.attackSpeedPercentPerStack * cadence.stacks;
      }
    }

    if (this.reprisalUntilMs > nowMs && this.reprisalRank > 0) {
      const stats = this.readHudCombatStats();
      const rankData = ALDEN.w.ranks[this.reprisalRank - 1];
      const bonusDamage = this.applyAbilityPower(
        rankData.reprisalBaseDamage + ALDEN.w.reprisalTotalAdRatio * stats.attackDamage,
        stats.abilityPowerPercent,
      );
      queueWorldDamageAdjustment(target.id, bonusDamage);
      this.freezeTarget(target, rankData.stunDurationSeconds, nowMs);
      this.reprisalUntilMs = 0;
      this.reprisalRank = 0;
      this.animation = { key: 'REPRISAL', startedAtMs: nowMs, durationMs: 430 };
      this.spawnGroundRing(target.root, Math.max(0.45, target.selectionRadius * 0.72), GUARD_BLUE, 360, 0.85, true);
    }

    const judgedUntil = this.judgedUntilByTarget.get(target.id) ?? 0;
    if (
      this.majestyUntilMs > nowMs
      && judgedUntil > nowMs
      && nowMs - this.lastMajestyCooldownProcAtMs >= ALDEN.r.cooldownReductionInternalCooldownSeconds * 1000
    ) {
      const reductionMs = ALDEN.r.qwCooldownReductionPerBasicAttackSeconds * 1000;
      reduceHeroAbilityCooldown(LOCAL_HERO_ENTITY_ID, 'Q', reductionMs);
      reduceHeroAbilityCooldown(LOCAL_HERO_ENTITY_ID, 'W', reductionMs);
      this.lastMajestyCooldownProcAtMs = nowMs;
    }
  };

  private readonly guardIncomingHeroDamage = (event: Parameters<Parameters<typeof registerWorldCombatEventGuard>[1]>[0]) => {
    if (this.forwardingAdjustedDamage || event.entityId !== this.hero.id) return true;
    if (event.reason !== 'damage' && event.reason !== 'death') return true;
    const amount = Math.max(0, event.amount ?? 0);
    if (amount <= EPSILON) return true;

    const nowMs = event.atMs;
    let remaining = amount;
    let preventedByGuard = 0;

    if (this.majestyUntilMs > nowMs && this.majestyRank > 0) {
      const rankData = ALDEN.r.ranks[this.majestyRank - 1];
      remaining *= 1 - rankData.damageReductionPercent / 100;
    }

    const guardCanBlock = this.guardUntilMs > nowMs
      && this.guardRank > 0
      && event.damageType !== 'true'
      && event.isDirect !== false
      && this.isSourceInsideGuardArc(event.sourceEntityId);
    if (guardCanBlock) {
      const rankData = ALDEN.w.ranks[this.guardRank - 1];
      preventedByGuard = remaining * rankData.frontDamageReductionPercent / 100;
      remaining -= preventedByGuard;
    }

    const preventedTotal = amount - remaining;
    if (preventedTotal <= EPSILON) return true;

    if (preventedByGuard > 0) {
      this.guardPreventedDamage += preventedByGuard;
      const threshold = Math.max(1, this.hero.maxHp) * ALDEN.w.reprisalTriggerPreventedDamagePercentMaxHp / 100;
      if (this.guardPreventedDamage + EPSILON >= threshold) {
        this.reprisalRank = this.guardRank;
        this.reprisalUntilMs = nowMs + ALDEN.w.reprisalWindowSeconds * 1000;
        this.spawnGroundRing(this.hero.root, 1.05, GUARD_BLUE, ALDEN.w.reprisalWindowSeconds * 1000, 0.48, true);
      }
    }

    const correctedHp = Math.min(this.hero.maxHp, Math.max(0, event.currentHp + preventedTotal));
    this.hero.currentHp = correctedHp;
    this.hero.alive = correctedHp > 0;
    this.hero.root.userData.currentHp = correctedHp;
    this.publishRuntime(this.hero);

    this.forwardingAdjustedDamage = true;
    try {
      emitWorldCombatEvent({
        ...event,
        reason: correctedHp > 0 ? 'damage' : 'death',
        currentHp: correctedHp,
        alive: correctedHp > 0,
        amount: remaining,
      });
    } finally {
      this.forwardingAdjustedDamage = false;
    }
    return false;
  };

  private updateDash(nowMs: number) {
    const dash = this.dash;
    if (!dash) return;
    const t = THREE.MathUtils.clamp((nowMs - dash.startedAtMs) / Math.max(1, dash.durationMs), 0, 1);
    const eased = 1 - (1 - t) * (1 - t);
    this.hero.root.position.lerpVectors(dash.start, dash.end, eased);
    if (t >= 1) this.dash = null;
  }

  private updateMovementModifiers(nowMs: number) {
    const current = this.hero.root.position;
    if (this.movementLockUntilMs > nowMs) {
      current.x = this.movementLockPosition.x;
      current.z = this.movementLockPosition.z;
      this.lastHeroPosition.copy(current);
      return;
    }

    if (!this.dash && this.guardUntilMs > nowMs) {
      const dx = current.x - this.lastHeroPosition.x;
      const dz = current.z - this.lastHeroPosition.z;
      const moved = Math.hypot(dx, dz);
      if (moved > 0.0001 && moved < 2.5) {
        const multiplier = 1 - ALDEN.w.movementPenaltyPercent / 100;
        current.x = this.lastHeroPosition.x + dx * multiplier;
        current.z = this.lastHeroPosition.z + dz * multiplier;
      }
    }
    this.lastHeroPosition.copy(current);
  }

  private updateFrozenTargets(nowMs: number) {
    for (const [id, frozen] of this.frozenTargets) {
      if (nowMs >= frozen.untilMs || !frozen.entity.alive || !frozen.entity.root.parent) {
        this.frozenTargets.delete(id);
        continue;
      }
      const local = frozen.worldPosition.clone();
      frozen.entity.root.parent.worldToLocal(local);
      frozen.entity.root.position.copy(local);
    }
  }

  private runPendingImpacts(nowMs: number) {
    for (let index = this.pendingImpacts.length - 1; index >= 0; index--) {
      const impact = this.pendingImpacts[index];
      if (nowMs < impact.atMs) continue;
      this.pendingImpacts.splice(index, 1);
      impact.run();
    }
  }

  private pruneRuntimeState(nowMs: number) {
    for (const [id, cadence] of this.cadenceByTarget) {
      if (cadence.expiresAtMs <= nowMs) this.cadenceByTarget.delete(id);
    }
    for (const [id, until] of this.judgedUntilByTarget) {
      if (until <= nowMs) this.judgedUntilByTarget.delete(id);
    }
    if (this.reprisalUntilMs > 0 && this.reprisalUntilMs <= nowMs) {
      this.reprisalUntilMs = 0;
      this.reprisalRank = 0;
    }
    if (this.guardUntilMs > 0 && this.guardUntilMs <= nowMs) {
      this.guardUntilMs = 0;
      this.guardRank = 0;
      this.guardPreventedDamage = 0;
    }
    if (this.majestyUntilMs > 0 && this.majestyUntilMs <= nowMs) {
      this.majestyUntilMs = 0;
      this.majestyRank = 0;
    }
  }

  private resolveAimDirection() {
    const heroWorld = this.hero.root.getWorldPosition(this.tempSource);
    if (this.pointerSeen) {
      this.raycaster.setFromCamera(this.pointerNdc, this.camera);
      const surface = this.raycaster.intersectObjects(this.commandSurfaces, false)[0];
      if (surface) {
        const dx = surface.point.x - heroWorld.x;
        const dz = surface.point.z - heroWorld.z;
        const length = Math.hypot(dx, dz);
        if (length > 0.08) return new THREE.Vector2(dx / length, dz / length);
      }
      if (this.raycaster.ray.intersectPlane(this.groundPlane, this.hitPoint)) {
        const dx = this.hitPoint.x - heroWorld.x;
        const dz = this.hitPoint.z - heroWorld.z;
        const length = Math.hypot(dx, dz);
        if (length > 0.08) return new THREE.Vector2(dx / length, dz / length);
      }
    }

    const yaw = this.currentFacingYaw();
    return new THREE.Vector2(Math.sin(yaw), Math.cos(yaw)).normalize();
  }

  private currentFacingYaw() {
    const model = this.joints.model;
    if (!model) return 0;
    const quaternion = model.getWorldQuaternion(new THREE.Quaternion());
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
    return Math.atan2(forward.x, forward.z);
  }

  private findDashEndpoint(start: THREE.Vector3, direction: THREE.Vector2, distance: number) {
    const steps = Math.max(1, Math.ceil(distance / 0.12));
    const endpoint = start.clone();
    for (let step = 1; step <= steps; step++) {
      const travelled = Math.min(distance, step / steps * distance);
      const x = THREE.MathUtils.clamp(start.x + direction.x * travelled, MAP_BOUNDS.minX + 0.5, MAP_BOUNDS.maxX - 0.5);
      const z = THREE.MathUtils.clamp(start.z + direction.y * travelled, MAP_BOUNDS.minZ + 0.5, MAP_BOUNDS.maxZ - 0.5);
      if (this.isDashBlockedByStructure(x, z)) break;
      endpoint.x = x;
      endpoint.z = z;
    }
    endpoint.y = start.y;
    return endpoint;
  }

  private isDashBlockedByStructure(x: number, z: number) {
    for (const entity of this.registry.values()) {
      if (entity === this.hero || !entity.alive || !entity.root.parent) continue;
      if (entity.kind !== 'tower' && entity.kind !== 'building' && entity.kind !== 'shop') continue;
      entity.root.getWorldPosition(this.tempTarget);
      const radius = Math.max(0.35, entity.selectionRadius * 0.72) + 0.42;
      if (Math.hypot(x - this.tempTarget.x, z - this.tempTarget.z) < radius) return true;
    }
    return false;
  }

  private findEnemiesInRadius(radius: number) {
    const origin = this.hero.root.getWorldPosition(this.tempSource);
    return this.registry.values().filter(target => {
      if (!this.isAbilityTarget(target)) return false;
      target.root.getWorldPosition(this.tempTarget);
      return Math.hypot(this.tempTarget.x - origin.x, this.tempTarget.z - origin.z)
        <= radius + Math.max(0, target.selectionRadius * 0.45);
    });
  }

  private findEnemiesInCone(radius: number, angleDegrees: number, direction: THREE.Vector2) {
    const origin = this.hero.root.getWorldPosition(this.tempSource);
    const cosThreshold = Math.cos(THREE.MathUtils.degToRad(angleDegrees * 0.5));
    return this.registry.values().filter(target => {
      if (!this.isAbilityTarget(target)) return false;
      target.root.getWorldPosition(this.tempTarget);
      const dx = this.tempTarget.x - origin.x;
      const dz = this.tempTarget.z - origin.z;
      const distance = Math.hypot(dx, dz);
      if (distance > radius + Math.max(0, target.selectionRadius * 0.45)) return false;
      if (distance <= 0.001) return true;
      return (dx / distance) * direction.x + (dz / distance) * direction.y >= cosThreshold;
    });
  }

  private isAbilityTarget(target: GameEntity) {
    if (target === this.hero || !target.alive || target.currentHp <= 0 || target.maxHp <= 0) return false;
    if (!target.targetable || target.team === this.hero.team) return false;
    if (target.kind === 'shop') return false;
    if ((target.kind === 'building' || target.kind === 'tower') && target.interaction !== 'attackable-structure') return false;
    return true;
  }

  private priorityForCadence(target: GameEntity) {
    if (target.kind === 'hero') return 0;
    if (target.kind === 'jungle-creature') return 1;
    if (target.kind === 'tower' || target.kind === 'building') return 2;
    return 3;
  }

  private damageTarget(target: GameEntity, rawDamage: number, atMs: number) {
    if (!this.isAbilityTarget(target)) return 0;
    const adjustedDamage = Math.max(0, calculateTowerAuraAdjustedDamage(this.hero, target, rawDamage));
    if (adjustedDamage <= EPSILON) return 0;

    const networkRemoteHero = target.kind === 'hero' && target.root.userData.networkRemoteHero === true;
    if (networkRemoteHero) {
      // Multiplayer hero health is reconciled by the victim/server path. Keep the cast
      // responsive, but do not mutate/predict remote HP or death on the attacker's client.
      emitWorldCombatEvent({
        entityId: target.id,
        reason: 'damage',
        currentHp: target.currentHp,
        currentResource: target.currentResource,
        alive: target.alive,
        atMs,
        amount: adjustedDamage,
        sourceEntityId: this.hero.id,
        damageType: 'physical',
        isDirect: true,
        isFromFront: true,
      });
      return adjustedDamage;
    }

    const before = target.currentHp;
    target.currentHp = Math.max(0, target.currentHp - adjustedDamage);
    target.alive = target.currentHp > 0;
    target.root.userData.currentHp = target.currentHp;
    target.root.userData.alive = target.alive;
    this.publishRuntime(target);

    const dealt = Math.max(0, before - target.currentHp);
    emitWorldCombatEvent({
      entityId: target.id,
      reason: target.alive ? 'damage' : 'death',
      currentHp: target.currentHp,
      currentResource: target.currentResource,
      alive: target.alive,
      atMs,
      amount: dealt,
      sourceEntityId: this.hero.id,
      damageType: 'physical',
      isDirect: true,
      isFromFront: true,
    });
    return dealt;
  }

  private healHero(amount: number, atMs: number) {
    if (amount <= 0 || !this.hero.alive) return 0;
    const before = this.hero.currentHp;
    this.hero.currentHp = Math.min(this.hero.maxHp, this.hero.currentHp + amount);
    this.hero.root.userData.currentHp = this.hero.currentHp;
    this.publishRuntime(this.hero);
    const healed = Math.max(0, this.hero.currentHp - before);
    if (healed <= EPSILON) return 0;
    emitWorldCombatEvent({
      entityId: this.hero.id,
      reason: 'heal',
      currentHp: this.hero.currentHp,
      currentResource: this.hero.currentResource,
      alive: true,
      atMs,
      amount: healed,
      sourceEntityId: this.hero.id,
    });
    return healed;
  }

  private publishRuntime(entity: GameEntity) {
    const previous = getWorldEntityRuntime(entity.id);
    publishWorldEntityRuntime(entity.id, {
      level: entity.level,
      maxHp: entity.maxHp,
      currentHp: entity.currentHp,
      maxResource: entity.maxResource,
      currentResource: entity.currentResource,
      alive: entity.alive,
      physicalArmor: previous?.physicalArmor,
      magicResistance: previous?.magicResistance,
      movementSpeed: previous?.movementSpeed,
      magicPower: previous?.magicPower,
      statuses: previous?.statuses,
    });
  }

  private publishAbilityAggro(target: GameEntity, atMs: number) {
    this.hero.root.getWorldPosition(this.tempSource);
    target.root.getWorldPosition(this.tempTarget);
    this.suppressAbilityAttackBroadcast = true;
    try {
      publishWorldAttackEvent({
        attackerId: this.hero.id,
        targetId: target.id,
        attackerTeam: this.hero.team,
        targetTeam: target.team,
        attackerKind: this.hero.kind,
        targetKind: target.kind,
        attackerPosition: { x: this.tempSource.x, z: this.tempSource.z },
        targetPosition: { x: this.tempTarget.x, z: this.tempTarget.z },
        atMs,
      });
    } finally {
      this.suppressAbilityAttackBroadcast = false;
    }
  }

  private addCadence(target: GameEntity, amount: number, nowMs: number) {
    if (amount <= 0) return;
    const previous = this.getCadence(target.id, nowMs);
    this.cadenceByTarget.set(target.id, {
      stacks: Math.min(ALDEN.e.maxCadenceStacks, (previous?.stacks ?? 0) + amount),
      expiresAtMs: nowMs + ALDEN.e.cadenceDurationSeconds * 1000,
    });
  }

  private getCadence(targetId: string, nowMs: number) {
    const cadence = this.cadenceByTarget.get(targetId);
    if (!cadence) return null;
    if (cadence.expiresAtMs <= nowMs) {
      this.cadenceByTarget.delete(targetId);
      return null;
    }
    return cadence;
  }

  private applyMovementSlow(target: GameEntity, slowPercent: number, durationSeconds: number, nowMs: number) {
    const statuses = (target.root.userData[WORLD_STATUS_KEY] ??= {}) as Record<string, { expiresAtMs: number; slowPercent?: number }>;
    statuses[`alden:q-slow:${this.hero.id}`] = {
      expiresAtMs: nowMs + durationSeconds * 1000,
      slowPercent,
    };
  }

  private freezeTarget(target: GameEntity, durationSeconds: number, nowMs: number) {
    this.frozenTargets.set(target.id, {
      entity: target,
      untilMs: nowMs + durationSeconds * 1000,
      worldPosition: target.root.getWorldPosition(new THREE.Vector3()),
    });
    target.root.userData.aldenStunnedUntilMs = nowMs + durationSeconds * 1000;
  }

  private isSourceInsideGuardArc(sourceEntityId: string | undefined) {
    if (!sourceEntityId) return true;
    const source = this.registry.values().find(entity => entity.id === sourceEntityId);
    if (!source?.root.parent) return true;

    this.hero.root.getWorldPosition(this.tempSource);
    source.root.getWorldPosition(this.tempTarget);
    const dx = this.tempTarget.x - this.tempSource.x;
    const dz = this.tempTarget.z - this.tempSource.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 0.001) return true;

    const yaw = this.currentFacingYaw();
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const dot = THREE.MathUtils.clamp(fx * dx / distance + fz * dz / distance, -1, 1);
    const angle = Math.acos(dot);
    return angle <= THREE.MathUtils.degToRad(ALDEN.w.guardArcDegrees * 0.5);
  }

  private readHudCombatStats(): HudCombatStats {
    const level = THREE.MathUtils.clamp(Math.floor(this.hero.level || 1), 1, ALDEN.maxLevel);
    const fallback = calculateDefinitionStatsAtLevel(ALDEN, level);

    const damageText = document.querySelector<HTMLElement>('.hero-combat-stat--damage')?.textContent ?? '';
    const damageNumbers = damageText.match(/-?\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) ?? [];
    const attackDamage = damageNumbers.length > 0
      ? damageNumbers.reduce((sum, value) => sum + Math.max(0, value), 0)
      : fallback.attackDamage;

    const intElement = Array.from(document.querySelectorAll<HTMLElement>('.hero-core-attribute'))
      .find(element => element.querySelector('small')?.textContent?.trim() === 'INT');
    const intelligence = Number.parseFloat(intElement?.querySelector<HTMLElement>('.hero-core-attribute__value')?.textContent ?? '');
    const abilityPowerPercent = Number.isFinite(intelligence)
      ? Math.max(0, intelligence) * 0.8
      : fallback.abilityPowerPercent;

    return {
      attackDamage: Math.max(0, attackDamage),
      abilityPowerPercent: Math.max(0, abilityPowerPercent),
      maxHp: Math.max(1, this.hero.maxHp || fallback.maxHp),
    };
  }

  private applyAbilityPower(rawDamage: number, abilityPowerPercent: number) {
    return Math.max(0, rawDamage) * (1 + Math.max(0, abilityPowerPercent) / 100);
  }

  private resolveAbilityJoints(): AbilityJoints {
    const leftShoulder = this.hero.root.getObjectByName('left-shoulder') ?? null;
    const rightShoulder = this.hero.root.getObjectByName('right-shoulder') ?? null;
    return {
      model: this.hero.root.getObjectByName('H001-model') ?? null,
      pelvis: this.hero.root.getObjectByName('pelvis') ?? null,
      torso: this.hero.root.getObjectByName('torso') ?? null,
      leftShoulder,
      rightShoulder,
      leftElbow: leftShoulder?.getObjectByName('elbow') ?? null,
      rightElbow: rightShoulder?.getObjectByName('elbow') ?? null,
      wrist: this.hero.root.getObjectByName('right-wrist-attack-pivot') ?? null,
    };
  }

  private applyAbilityPose(nowMs: number) {
    const animation = this.animation;
    if (!animation) return;
    const t = THREE.MathUtils.clamp((nowMs - animation.startedAtMs) / Math.max(1, animation.durationMs), 0, 1);
    if (t >= 1) {
      this.animation = null;
      return;
    }

    const ease = t * t * (3 - 2 * t);
    const envelope = Math.max(0, Math.min(1, t / 0.14, (1 - t) / 0.16));
    const { model, pelvis, torso, leftShoulder, rightShoulder, leftElbow, rightElbow, wrist } = this.joints;

    if (animation.key === 'Q') {
      if (model && animation.facingYaw !== undefined) model.rotation.y = animation.facingYaw;
      if (pelvis) pelvis.rotation.y += THREE.MathUtils.lerp(-0.16, 0.26, ease) * envelope;
      if (torso) {
        torso.rotation.y += THREE.MathUtils.lerp(-0.48, 0.72, ease) * envelope;
        torso.rotation.x += 0.12 * Math.sin(t * Math.PI) * envelope;
      }
      if (rightShoulder) rightShoulder.rotation.x += THREE.MathUtils.lerp(-1.15, 0.88, ease) * envelope;
      if (rightElbow) rightElbow.rotation.x += THREE.MathUtils.lerp(-0.95, 0.34, ease) * envelope;
      if (leftShoulder) leftShoulder.rotation.x += 0.30 * Math.sin(t * Math.PI) * envelope;
      if (wrist) wrist.rotation.z += THREE.MathUtils.lerp(-0.42, 0.74, ease) * envelope;
      return;
    }

    if (animation.key === 'W') {
      const hold = Math.max(0, Math.min(1, t / 0.12, (1 - t) / 0.12));
      if (torso) {
        torso.rotation.y -= 0.22 * hold;
        torso.rotation.x -= 0.08 * hold;
      }
      if (rightShoulder) rightShoulder.rotation.x -= 0.78 * hold;
      if (rightElbow) rightElbow.rotation.x -= 0.72 * hold;
      if (leftShoulder) leftShoulder.rotation.x += 0.20 * hold;
      if (leftElbow) leftElbow.rotation.x -= 0.24 * hold;
      if (wrist) {
        wrist.rotation.x -= 0.34 * hold;
        wrist.rotation.z -= 0.52 * hold;
      }
      return;
    }

    if (animation.key === 'E') {
      const spin = Math.sin(t * Math.PI) * envelope;
      if (pelvis) pelvis.rotation.y += (t < 0.55 ? -0.65 * ease : 0.75 * (1 - ease)) * envelope;
      if (torso) torso.rotation.y += THREE.MathUtils.lerp(-0.9, 1.05, ease) * envelope;
      if (rightShoulder) rightShoulder.rotation.x += THREE.MathUtils.lerp(-0.75, 0.95, ease) * envelope;
      if (rightElbow) rightElbow.rotation.x -= 0.55 * spin;
      if (leftShoulder) leftShoulder.rotation.x += 0.42 * spin;
      if (wrist) wrist.rotation.z += 0.88 * spin;
      return;
    }

    if (animation.key === 'R') {
      const raise = THREE.MathUtils.clamp(t / 0.58, 0, 1);
      const slam = THREE.MathUtils.clamp((t - 0.58) / 0.24, 0, 1);
      const recover = THREE.MathUtils.clamp((t - 0.82) / 0.18, 0, 1);
      const power = (1 - recover) * envelope;
      if (torso) {
        torso.rotation.x += THREE.MathUtils.lerp(-0.20, 0.30, slam) * power;
        torso.rotation.y += 0.10 * Math.sin(t * Math.PI) * power;
      }
      if (rightShoulder) rightShoulder.rotation.x += THREE.MathUtils.lerp(-1.75, 0.92, slam) * power;
      if (rightElbow) rightElbow.rotation.x += THREE.MathUtils.lerp(-1.15, -0.12, slam) * power;
      if (leftShoulder) leftShoulder.rotation.x += THREE.MathUtils.lerp(-1.10, 0.28, slam) * power;
      if (leftElbow) leftElbow.rotation.x -= 0.52 * raise * power;
      if (wrist) wrist.rotation.z += THREE.MathUtils.lerp(-0.28, 0.42, slam) * power;
      return;
    }

    if (animation.key === 'REPRISAL') {
      if (torso) torso.rotation.y += THREE.MathUtils.lerp(-0.32, 0.55, ease) * envelope;
      if (rightShoulder) rightShoulder.rotation.x += THREE.MathUtils.lerp(-0.92, 0.62, ease) * envelope;
      if (rightElbow) rightElbow.rotation.x += THREE.MathUtils.lerp(-0.85, 0.18, ease) * envelope;
      if (wrist) wrist.rotation.z += THREE.MathUtils.lerp(-0.36, 0.58, ease) * envelope;
    }
  }

  private spawnGroundRing(
    follow: THREE.Object3D,
    radius: number,
    color: number,
    durationMs: number,
    opacity: number,
    persistentFollow = false,
  ) {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(Math.max(0.04, radius - Math.max(0.06, radius * 0.055)), radius, 72),
      material,
    );
    mesh.rotation.x = -Math.PI / 2;
    const world = follow.getWorldPosition(new THREE.Vector3());
    mesh.position.set(world.x, world.y + HERO_GROUND_EFFECT_Y, world.z);
    mesh.renderOrder = 42;
    this.scene.add(mesh);
    this.effects.push({
      object: mesh,
      material,
      startedAtMs: toMatchGameTimeMs(performance.now()),
      durationMs,
      initialOpacity: opacity,
      grow: persistentFollow ? 0.025 : 0.20,
      follow: persistentFollow ? follow : undefined,
      yOffset: HERO_GROUND_EFFECT_Y,
    });
  }

  private spawnSectorFx(
    follow: THREE.Object3D,
    radius: number,
    angleDegrees: number,
    yaw: number,
    color: number,
    durationMs: number,
    opacity: number,
  ) {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(createSectorGeometry(radius, angleDegrees), material);
    mesh.rotation.y = yaw;
    const world = follow.getWorldPosition(new THREE.Vector3());
    mesh.position.set(world.x, world.y + HERO_GROUND_EFFECT_Y, world.z);
    mesh.renderOrder = 41;
    this.scene.add(mesh);
    this.effects.push({
      object: mesh,
      material,
      startedAtMs: toMatchGameTimeMs(performance.now()),
      durationMs,
      initialOpacity: opacity,
      grow: 0.08,
      follow,
      yOffset: HERO_GROUND_EFFECT_Y,
    });
  }

  private spawnArcRingFx(
    follow: THREE.Object3D,
    radius: number,
    angleDegrees: number,
    yaw: number,
    color: number,
    durationMs: number,
    opacity: number,
    persistentFollow: boolean,
  ) {
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(createArcRingGeometry(radius, angleDegrees), material);
    mesh.rotation.y = yaw;
    const world = follow.getWorldPosition(new THREE.Vector3());
    mesh.position.set(world.x, world.y + HERO_GROUND_EFFECT_Y, world.z);
    mesh.renderOrder = 43;
    this.scene.add(mesh);
    this.effects.push({
      object: mesh,
      material,
      startedAtMs: toMatchGameTimeMs(performance.now()),
      durationMs,
      initialOpacity: opacity,
      grow: 0.02,
      follow: persistentFollow ? follow : undefined,
      yOffset: HERO_GROUND_EFFECT_Y,
    });
  }

  private updateEffects(nowMs: number) {
    for (let index = this.effects.length - 1; index >= 0; index--) {
      const effect = this.effects[index];
      const t = THREE.MathUtils.clamp((nowMs - effect.startedAtMs) / Math.max(1, effect.durationMs), 0, 1);
      if (effect.follow?.parent) {
        const world = effect.follow.getWorldPosition(new THREE.Vector3());
        effect.object.position.set(world.x, world.y + effect.yOffset, world.z);
      }
      const scale = 1 + t * effect.grow;
      effect.object.scale.setScalar(scale);
      effect.material.opacity = effect.initialOpacity * Math.sin(Math.max(0, Math.min(1, 1 - t)) * Math.PI * 0.5);
      if (t < 1) continue;
      this.effects.splice(index, 1);
      this.disposeEffect(effect);
    }
  }

  private disposeEffect(effect: WorldFx) {
    effect.object.removeFromParent();
    effect.object.traverse(object => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    effect.material.dispose();
  }
}

function createSectorGeometry(radius: number, angleDegrees: number) {
  const half = THREE.MathUtils.degToRad(angleDegrees * 0.5);
  const segments = 32;
  const positions: number[] = [0, 0, 0];
  const indices: number[] = [];
  for (let index = 0; index <= segments; index++) {
    const angle = THREE.MathUtils.lerp(-half, half, index / segments);
    positions.push(Math.sin(angle) * radius, 0, Math.cos(angle) * radius);
    if (index > 0) indices.push(0, index, index + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createArcRingGeometry(radius: number, angleDegrees: number) {
  const half = THREE.MathUtils.degToRad(angleDegrees * 0.5);
  const inner = Math.max(0.05, radius - 0.10);
  const segments = 42;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index <= segments; index++) {
    const angle = THREE.MathUtils.lerp(-half, half, index / segments);
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    positions.push(sin * inner, 0, cos * inner, sin * radius, 0, cos * radius);
    if (index < segments) {
      const base = index * 2;
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
