import * as THREE from 'three';
import { DRAKE_ATTACK, type DrakeAnimationController } from '../creatures/radiantDrake/animateRadiantDrake';
import type { GameEntity, GameEntityRegistry, TeamId } from '../entities/gameEntities';
import {
  emitWorldCombatEvent,
  emitWorldHeroProgressionEvent,
  getMostRecentAttackOnTarget,
  publishWorldAttackEvent,
  publishWorldEntityRuntime,
  subscribeWorldCombatEvents,
} from '../entities/worldCombatBridge';

export const RADIANT_DRAKE_GAMEPLAY = {
  id: 'radiant-drake',
  definitionId: 'objective-radiant-drake',
  displayName: 'Aurelios, Guardián de la Fosa Radiante',
  level: 10,
  maxHp: 6_500,
  attackDamage: 110,
  attackRange: 5.4,
  attackIntervalSeconds: 1.8,
  selectionRadius: 3.2,
  visionHeight: 3.4,
  scanIntervalSeconds: 0.14,
  retaliationMemoryMs: 4_500,
  enrageHealthFraction: 0.35,
  enrageAttackIntervalMultiplier: 0.70,
  goldReward: 250,
  experienceReward: 500,
} as const;

const managerByScene = new WeakMap<THREE.Scene, RadiantDrakeManager>();
const BOSS_POSITION = new THREE.Vector3();
const TARGET_POSITION = new THREE.Vector3();
const VALID_TEAMS = new Set<TeamId>(['blue', 'red']);

export function ensureRadiantDrakeGameplay(
  scene: THREE.Scene,
  registry: GameEntityRegistry,
  dragon: GameEntity,
) {
  const existing = managerByScene.get(scene);
  if (existing) return existing;
  const manager = new RadiantDrakeManager(scene, registry, dragon);
  managerByScene.set(scene, manager);
  manager.start();
  return manager;
}

class RadiantDrakeManager {
  private target: GameEntity | null = null;
  private nextScanAtMs = 0;
  private nextAttackAtMs = 0;
  private pendingAttack: { target: GameEntity; impactAtMs: number } | null = null;
  private readonly localTarget = new THREE.Vector3();
  private animationFrame = 0;
  private disposed = false;
  private deathResolved = false;
  private readonly gameCanvas: HTMLCanvasElement | null;
  private readonly unsubscribeCombat: () => void;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly registry: GameEntityRegistry,
    private readonly dragon: GameEntity,
  ) {
    const canvases = document.querySelectorAll<HTMLCanvasElement>('.game-canvas');
    this.gameCanvas = canvases.length > 0 ? canvases[canvases.length - 1] : null;
    this.unsubscribeCombat = subscribeWorldCombatEvents(this.onCombatEvent);
  }

  start() {
    const { dragon } = this;
    dragon.root.userData.bossGameplay = RADIANT_DRAKE_GAMEPLAY;
    dragon.root.userData.attackDamage = RADIANT_DRAKE_GAMEPLAY.attackDamage;
    dragon.root.userData.goldReward = RADIANT_DRAKE_GAMEPLAY.goldReward;
    dragon.root.userData.experienceReward = RADIANT_DRAKE_GAMEPLAY.experienceReward;
    dragon.root.userData.bossState = 'IDLE';
    publishWorldEntityRuntime(dragon.id, runtimeSnapshot(dragon));
    this.animationFrame = requestAnimationFrame(this.frame);
  }

  private frame = (nowMs: number) => {
    if (this.disposed) return;
    if (this.gameCanvas && !this.gameCanvas.isConnected) {
      this.dispose();
      return;
    }

    if (!this.dragon.alive || this.dragon.currentHp <= 0) {
      this.resolveDeath(nowMs);
      this.animationFrame = requestAnimationFrame(this.frame);
      return;
    }

    if (this.pendingAttack && nowMs >= this.pendingAttack.impactAtMs) {
      const { target } = this.pendingAttack;
      this.pendingAttack = null;
      // A bite can miss if its target leaves the pit or dies during the windup.
      if (this.isValidTarget(target) && this.inAttackRange(target)) this.applyAttackHit(target, nowMs);
    }

    if (nowMs >= this.nextScanAtMs) {
      this.nextScanAtMs = nowMs + RADIANT_DRAKE_GAMEPLAY.scanIntervalSeconds * 1000;
      this.target = this.chooseTarget(nowMs);
      this.dragon.root.userData.bossState = this.target ? 'COMBAT' : 'IDLE';
    }

    if (this.target && !this.pendingAttack && nowMs >= this.nextAttackAtMs) {
      if (!this.isValidTarget(this.target)) {
        this.target = null;
      } else {
        this.dragon.root.getWorldPosition(BOSS_POSITION);
        this.target.root.getWorldPosition(TARGET_POSITION);
        const dx = TARGET_POSITION.x - BOSS_POSITION.x;
        const dz = TARGET_POSITION.z - BOSS_POSITION.z;
        const distanceSq = dx * dx + dz * dz;
        if (distanceSq <= RADIANT_DRAKE_GAMEPLAY.attackRange ** 2) {
          this.attack(this.target, nowMs);
        }
      }
    }

    this.animationFrame = requestAnimationFrame(this.frame);
  };

  private chooseTarget(nowMs: number): GameEntity | null {
    const retaliator = getMostRecentAttackOnTarget(
      this.dragon.id,
      nowMs,
      RADIANT_DRAKE_GAMEPLAY.retaliationMemoryMs,
    );
    if (retaliator) {
      const attacker = this.registry.values().find(entity => entity.id === retaliator.attackerId) ?? null;
      if (attacker && this.isValidTarget(attacker) && this.inAttackRange(attacker)) return attacker;
    }

    this.dragon.root.getWorldPosition(BOSS_POSITION);
    let best: GameEntity | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const candidate of this.registry.values()) {
      if (!this.isValidTarget(candidate)) continue;
      candidate.root.getWorldPosition(TARGET_POSITION);
      const dx = TARGET_POSITION.x - BOSS_POSITION.x;
      const dz = TARGET_POSITION.z - BOSS_POSITION.z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq > RADIANT_DRAKE_GAMEPLAY.attackRange ** 2) continue;

      // Heroes are the primary threat when several units enter the pit together.
      const roleBias = candidate.kind === 'hero' ? -2 : 0;
      const score = distanceSq + roleBias;
      if (score >= bestScore) continue;
      best = candidate;
      bestScore = score;
    }

    return best;
  }

  private isValidTarget(entity: GameEntity) {
    if (entity === this.dragon || !entity.root.parent || !entity.alive || entity.currentHp <= 0) return false;
    if (!VALID_TEAMS.has(entity.team)) return false;
    return entity.kind === 'hero' || entity.kind === 'creep';
  }

  private inAttackRange(entity: GameEntity) {
    this.dragon.root.getWorldPosition(BOSS_POSITION);
    entity.root.getWorldPosition(TARGET_POSITION);
    const dx = TARGET_POSITION.x - BOSS_POSITION.x;
    const dz = TARGET_POSITION.z - BOSS_POSITION.z;
    return dx * dx + dz * dz <= RADIANT_DRAKE_GAMEPLAY.attackRange ** 2;
  }

  private attack(target: GameEntity, nowMs: number) {
    const enraged = this.dragon.currentHp / this.dragon.maxHp <= RADIANT_DRAKE_GAMEPLAY.enrageHealthFraction;
    const interval = RADIANT_DRAKE_GAMEPLAY.attackIntervalSeconds
      * (enraged ? RADIANT_DRAKE_GAMEPLAY.enrageAttackIntervalMultiplier : 1);
    this.nextAttackAtMs = nowMs + interval * 1000;
    this.dragon.root.userData.bossState = enraged ? 'ENRAGED' : 'COMBAT';
    this.dragon.root.userData.lastAttackAtMs = nowMs;

    target.root.getWorldPosition(this.localTarget);
    this.dragon.root.worldToLocal(this.localTarget);
    const animator = this.dragon.root.userData.drakeAnimator as DrakeAnimationController | undefined;
    const speed = enraged ? 1 / RADIANT_DRAKE_GAMEPLAY.enrageAttackIntervalMultiplier : 1;
    // The authored head faces slightly right of local +Z.
    const heading = Math.atan2(this.localTarget.x, this.localTarget.z) - 0.23;
    const impactAtMs = animator?.beginAttack(nowMs, speed, heading) ?? nowMs + DRAKE_ATTACK.impact * 1000 / speed;
    this.pendingAttack = { target, impactAtMs };
  }

  private applyAttackHit(target: GameEntity, nowMs: number) {
    this.dragon.root.getWorldPosition(BOSS_POSITION);
    target.root.getWorldPosition(TARGET_POSITION);
    publishWorldAttackEvent({
      attackerId: this.dragon.id,
      targetId: target.id,
      attackerTeam: 'neutral',
      targetTeam: target.team,
      attackerKind: 'jungle-creature',
      targetKind: target.kind,
      attackerPosition: { x: BOSS_POSITION.x, z: BOSS_POSITION.z },
      targetPosition: { x: TARGET_POSITION.x, z: TARGET_POSITION.z },
      atMs: nowMs,
    });

    const damage = RADIANT_DRAKE_GAMEPLAY.attackDamage;
    target.currentHp = Math.max(0, target.currentHp - damage);
    target.root.userData.currentHp = target.currentHp;
    const aliveAfterHit = target.currentHp > 0;
    if (!aliveAfterHit) target.alive = false;

    publishWorldEntityRuntime(target.id, runtimeSnapshot(target));
    emitWorldCombatEvent({
      entityId: target.id,
      reason: aliveAfterHit ? 'damage' : 'death',
      currentHp: target.currentHp,
      currentResource: target.currentResource,
      alive: aliveAfterHit,
      atMs: nowMs,
      amount: damage,
      sourceEntityId: this.dragon.id,
    });

    if (!aliveAfterHit) this.target = null;
  }

  private onCombatEvent = (event: { entityId: string; reason: string; atMs: number }) => {
    if (event.entityId !== this.dragon.id || event.reason !== 'death') return;
    this.resolveDeath(event.atMs);
  };

  private resolveDeath(atMs: number) {
    if (this.deathResolved) return;
    this.deathResolved = true;
    this.dragon.alive = false;
    this.dragon.currentHp = 0;
    this.dragon.targetable = false;
    this.dragon.root.userData.currentHp = 0;
    this.dragon.root.userData.bossState = 'DEAD';
    this.target = null;
    this.pendingAttack = null;
    (this.dragon.root.userData.drakeAnimator as DrakeAnimationController | undefined)?.cancelAttack();

    const lastAttack = getMostRecentAttackOnTarget(this.dragon.id, atMs, 3_000);
    const killer = lastAttack
      ? this.registry.values().find(entity => entity.id === lastAttack.attackerId) ?? null
      : null;

    if (killer?.kind === 'hero' && VALID_TEAMS.has(killer.team)) {
      emitWorldHeroProgressionEvent({
        heroEntityId: killer.id,
        atMs,
        experienceDelta: RADIANT_DRAKE_GAMEPLAY.experienceReward,
        goldDelta: RADIANT_DRAKE_GAMEPLAY.goldReward,
        lastHitsDelta: 0,
        deniesDelta: 0,
        reason: 'objective-kill',
      });
    }

    window.setTimeout(() => {
      if (!this.disposed) this.dragon.root.visible = false;
    }, 350);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.pendingAttack = null;
    (this.dragon.root.userData.drakeAnimator as DrakeAnimationController | undefined)?.cancelAttack();
    cancelAnimationFrame(this.animationFrame);
    this.unsubscribeCombat();
    managerByScene.delete(this.scene);
  }
}

function runtimeSnapshot(entity: GameEntity) {
  return {
    level: entity.level,
    maxHp: entity.maxHp,
    currentHp: entity.currentHp,
    maxResource: entity.maxResource,
    currentResource: entity.currentResource,
    alive: entity.alive,
  };
}
