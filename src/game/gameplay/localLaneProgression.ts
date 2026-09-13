import * as THREE from 'three';
import type { GameEntity, GameEntityRegistry } from '../entities/gameEntities';
import {
  emitWorldCreepDeathEvent,
  emitWorldHeroProgressionEvent,
  getMostRecentAttackOnTarget,
  subscribeWorldCombatEvents,
  type WorldCreepType,
} from '../entities/worldCombatBridge';
import { getCreepReward, HERO_PROGRESSION_TUNING } from '../match/progression';

const CREEP_TYPES = new Set<WorldCreepType>(['melee', 'ranged', 'flagbearer', 'siege']);
const heroPosition = new THREE.Vector3();
const creepPosition = new THREE.Vector3();

export function connectLocalLaneProgression(
  registry: GameEntityRegistry,
  localHero: GameEntity,
) {
  return subscribeWorldCombatEvents((event) => {
    if (event.reason !== 'death') return;

    const creep = registry.values().find(entity => entity.id === event.entityId);
    if (!creep || creep.kind !== 'creep') return;

    const authoredType = creep.root.userData.laneCreepType;
    if (typeof authoredType !== 'string' || !CREEP_TYPES.has(authoredType as WorldCreepType)) return;
    const creepType = authoredType as WorldCreepType;

    creep.root.getWorldPosition(creepPosition);
    const attack = getMostRecentAttackOnTarget(creep.id, event.atMs, 3_000);
    const deathEvent = {
      creepEntityId: creep.id,
      creepType,
      creepTeam: creep.team,
      killerEntityId: attack?.attackerId ?? null,
      killerTeam: attack?.attackerTeam ?? null,
      killerKind: attack?.attackerKind ?? null,
      position: { x: creepPosition.x, z: creepPosition.z },
      atMs: event.atMs,
    } as const;
    emitWorldCreepDeathEvent(deathEvent);

    const enemyCreep = creep.team !== localHero.team;
    const localLastHit = enemyCreep && attack?.attackerId === localHero.id;
    const localDeny = !enemyCreep && attack?.attackerId === localHero.id;
    const denied = attack?.attackerKind === 'hero' && attack.attackerTeam === creep.team;

    localHero.root.getWorldPosition(heroPosition);
    const dx = heroPosition.x - creepPosition.x;
    const dz = heroPosition.z - creepPosition.z;
    const inExperienceRange = dx * dx + dz * dz
      <= HERO_PROGRESSION_TUNING.experienceRadiusWorld ** 2;
    const reward = getCreepReward(creepType);
    const experienceDelta = enemyCreep && !denied && inExperienceRange && localHero.alive
      ? reward.experience
      : 0;
    const goldDelta = localLastHit ? reward.gold : 0;
    const lastHitsDelta = localLastHit ? 1 : 0;
    const deniesDelta = localDeny ? 1 : 0;

    if (experienceDelta === 0 && goldDelta === 0 && lastHitsDelta === 0 && deniesDelta === 0) return;
    emitWorldHeroProgressionEvent({
      heroEntityId: localHero.id,
      atMs: event.atMs,
      experienceDelta,
      goldDelta,
      lastHitsDelta,
      deniesDelta,
      reason: 'creep-death',
    });
  });
}
