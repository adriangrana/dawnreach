import { calculateDefinitionStatsAtLevel } from '../heroAttributes';
import {
  HeroPrimaryAttribute,
  type AbilityKey,
  type HeroAbilityDefinition,
  type HeroDefinition,
  type HeroInnateDefinition,
  type HeroStats,
} from '../types';

export const ALDEN_ID = 'H001' as const;

export const ALDEN_SKILL_SYSTEM = {
  abilityPointsPerHeroLevel: 1,
  basicAbilityRankHeroLevels: [1, 3, 5, 7] as const,
  ultimateRankHeroLevels: [6, 12, 18] as const,
} as const;

export interface AldenInnateDefinition extends HeroInnateDefinition {
  maxStacks: number;
  stackInternalCooldownSeconds: number;
  procLockoutSeconds: number;
  empoweredAttackWindowSeconds: number;
  frontalArcDegrees: number;
  bonusDamageBase: number;
  bonusDamagePerHeroLevel: number;
  totalAdRatio: number;
  healingBasePercentMaxHp: number;
  healingPercentMaxHpPerHeroLevel: number;
  normalEnemyHealingMultiplier: number;
  eliteBossPlayerHealingMultiplier: number;
}

export interface AldenQRank {
  baseDamage: number;
  manaCost: number;
  cooldownSeconds: number;
  slowPercent: number;
  slowDurationSeconds: number;
}

export interface AldenWRank {
  frontDamageReductionPercent: number;
  manaCost: number;
  cooldownSeconds: number;
  reprisalBaseDamage: number;
  stunDurationSeconds: number;
}

export interface AldenERank {
  attackSpeedPercentPerStack: number;
  activeBaseDamage: number;
  bonusDamagePerConsumedStack: number;
  healingPercentMaxHpPerStack: number;
  manaCost: number;
  cooldownSeconds: number;
}

export interface AldenRRank {
  baseDamage: number;
  manaCost: number;
  cooldownSeconds: number;
  pvpTauntDurationSeconds: number;
  eliteTauntDurationSeconds: number;
  damageReductionPercent: number;
  tenacityPercent: number;
}

export interface AldenGameplayDefinition extends HeroDefinition {
  innate: AldenInnateDefinition;
  q: {
    totalAdRatio: number;
    dashRange: number;
    cleaveRange: number;
    cleaveAngleDegrees: number;
    castTimeSeconds: number;
    cadenceStacksAppliedToFirstPriorityTarget: number;
    ranks: readonly [AldenQRank, AldenQRank, AldenQRank, AldenQRank];
  };
  w: {
    guardDurationSeconds: number;
    guardArcDegrees: number;
    movementPenaltyPercent: number;
    reprisalTriggerPreventedDamagePercentMaxHp: number;
    reprisalWindowSeconds: number;
    reprisalBonusAttackRange: number;
    reprisalTotalAdRatio: number;
    ranks: readonly [AldenWRank, AldenWRank, AldenWRank, AldenWRank];
  };
  e: {
    maxCadenceStacks: number;
    cadenceDurationSeconds: number;
    activeRadius: number;
    activeTotalAdRatio: number;
    normalEnemyHealingMultiplier: number;
    eliteBossPlayerHealingMultiplier: number;
    ranks: readonly [AldenERank, AldenERank, AldenERank, AldenERank];
  };
  r: {
    radius: number;
    castTimeSeconds: number;
    totalAdRatio: number;
    majestyDurationSeconds: number;
    qwCooldownReductionPerBasicAttackSeconds: number;
    cooldownReductionInternalCooldownSeconds: number;
    bossThreatMultiplier: number;
    ranks: readonly [AldenRRank, AldenRRank, AldenRRank];
  };
}

const qAbility: HeroAbilityDefinition = {
  key: 'Q',
  name: 'Avance de la Corona',
  type: 'active',
  lore: 'Alden irrumpe con la determinación de una guardia real rompiendo una línea enemiga y remata el avance con un corte diagonal de su espada.',
  technicalDescription: 'Avanza hasta 300 unidades y termina con un corte frontal de 110° y 285 de alcance. Inflige daño físico, ralentiza y aplica 1 Cadencia Real al primer héroe, élite o jefe alcanzado.',
  unlockLevels: ALDEN_SKILL_SYSTEM.basicAbilityRankHeroLevels,
};

const wAbility: HeroAbilityDefinition = {
  key: 'W',
  name: 'Guardia de la Puerta Inquebrantable',
  type: 'active',
  lore: 'Alden adopta la postura de los guardianes de Valebrant: pie firme, espada en guardia y toda su técnica concentrada en desviar el impacto antes de devolverlo.',
  technicalDescription: 'Mantiene guardia frontal con la espada durante 1.25 s. Reduce daño directo físico o mágico recibido desde 140° frontales, pierde 25% de movimiento y puede preparar Represalia al bloquear suficiente daño o recibir control duro frontal.',
  unlockLevels: ALDEN_SKILL_SYSTEM.basicAbilityRankHeroLevels,
};

const eAbility: HeroAbilityDefinition = {
  key: 'E',
  name: 'Cadencia del Rey de Hierro',
  type: 'active_with_passive',
  lore: 'Cada golpe de Alden mide la guardia rival y prepara el siguiente. Cuando encuentra la apertura, completa la secuencia con un corte circular capaz de quebrar una formación.',
  technicalDescription: 'Los básicos consecutivos contra un mismo objetivo acumulan hasta 3 Cadencias durante 4 s y aumentan la velocidad de ataque contra ese objetivo. La activa consume las Cadencias de los objetivos en 325 unidades para infligir daño adicional y curar a Alden.',
  unlockLevels: ALDEN_SKILL_SYSTEM.basicAbilityRankHeroLevels,
};

const rAbility: HeroAbilityDefinition = {
  key: 'R',
  name: 'Juicio del León Coronado',
  type: 'ultimate',
  lore: 'Alden pronuncia el antiguo decreto de la corona y convierte el campo cercano en su tribunal: quien amenace a los suyos deberá enfrentarlo primero a él.',
  technicalDescription: 'Tras 0.55 s golpea un radio de 475, inflige daño físico, provoca a héroes y aplica Cadencia Real. Activa Majestad de Hierro durante 6 s, reduciendo daño recibido y aumentando tenacidad. Los básicos contra objetivos juzgados reducen Q y W.',
  unlockLevels: ALDEN_SKILL_SYSTEM.ultimateRankHeroLevels,
};

export const ALDEN: AldenGameplayDefinition = {
  id: ALDEN_ID,
  displayName: 'Alden',
  version: '1.1.0',
  maxLevel: 30,
  className: 'Caballero',
  primaryRole: 'Tanque-Bruiser',
  secondaryRoles: ['Frontline', 'Iniciador', 'Daño sostenido'],
  deploymentPreferences: {
    primary: ['NORTH', 'SOUTH'],
    secondary: ['MID'],
  },
  combatProfile: {
    burst: 'Medium',
    sustainedDamage: 'Medium',
    control: 'High',
    mobility: 'Medium',
    durability: 'High',
    range: 'Low',
  },
  difficulty: 'Medium',
  weaponConfiguration: 'Espada larga de caballero, sin escudo',
  weaponDesignReason: 'Alden concentra toda su identidad de combate en una sola espada: inicia con ella, mantiene presión sostenida y convierte una guardia técnica de hoja en su principal herramienta defensiva.',
  lore: 'Alden fue el último caballero en abandonar las puertas de Valebrant cuando el reino cayó. Desde entonces lleva su espada no como símbolo de nobleza, sino como juramento: mientras él permanezca en pie, ningún enemigo cruzará la línea que protege.',
  primaryAttribute: HeroPrimaryAttribute.STR,
  baseAttackDamage: 44,
  baseAttributes: {
    strength: 22,
    agility: 14,
    intelligence: 12,
  },
  attributeProgression: {
    strength: 3.4,
    agility: 1.6,
    intelligence: 1.4,
  },
  resource: {
    type: 'mana',
    displayName: 'Maná',
    reason: 'Limita la frecuencia con la que puede encadenar iniciación, mitigación y control sin recompensar únicamente recibir daño.',
  },
  baseStats: {
    maxHp: 200,
    maxResource: 150,
    attackDamage: 44,
    physicalArmor: 29.48,
    physicalDamageResistancePercent: 0,
    magicResistance: 28,
    attackSpeed: 0.62,
    movementSpeed: 325,
    hpRegenPerSecond: 0,
    resourceRegenPerSecond: 1.2,
    magicPower: 0,
    abilityPowerPercent: 0,
    attackRange: 175,
    criticalChancePercent: 4,
  },
  statProgression: {
    maxHp: { kind: 'fixed' },
    maxResource: { kind: 'fixed' },
    attackDamage: { kind: 'fixed' },
    physicalArmor: { kind: 'fixed' },
    physicalDamageResistancePercent: { kind: 'fixed' },
    magicResistance: { kind: 'linear', perLevel: 1.15 },
    attackSpeed: { kind: 'fixed' },
    movementSpeed: { kind: 'fixed' },
    hpRegenPerSecond: { kind: 'fixed' },
    resourceRegenPerSecond: { kind: 'fixed' },
    magicPower: { kind: 'fixed' },
    abilityPowerPercent: { kind: 'fixed' },
    attackRange: { kind: 'fixed' },
    criticalChancePercent: { kind: 'fixed' },
  },
  abilities: {
    Q: qAbility,
    W: wAbility,
    E: eAbility,
    R: rAbility,
  },
  innate: {
    id: 'alden:innate:voto-del-muro-vivo',
    name: 'Voto del Muro Vivo',
    description: 'Alden transforma la presión frontal en una promesa defensiva: cuanto más sostiene la línea, más contundente se vuelve su siguiente respuesta.',
    technicalDescription: 'Los impactos directos físicos o mágicos recibidos desde el frente acumulan 1 carga, hasta 4, con 0.75 s de intervalo interno. Al completar 4 cargas, el siguiente ataque básico durante 5 s inflige 20 + 1.5 por cada nivel después del primero + 35% del AD total como daño adicional y cura 2% de la vida máxima + 0.02% por cada nivel después del primero (50% contra enemigos normales). Tras consumirse, no puede volver a acumular durante 7 s.',
    hud: {
      kind: 'persistent_aura',
      art: 'sun',
      tone: 'passive',
      counter: {
        runtimeCounterKey: 'alden:steel',
        maxStacks: 4,
        readyStatusId: 'alden:oath-ready',
      },
    },
    maxStacks: 4,
    stackInternalCooldownSeconds: 0.75,
    procLockoutSeconds: 7,
    empoweredAttackWindowSeconds: 5,
    frontalArcDegrees: 140,
    bonusDamageBase: 20,
    bonusDamagePerHeroLevel: 1.5,
    totalAdRatio: 0.35,
    healingBasePercentMaxHp: 2,
    healingPercentMaxHpPerHeroLevel: 0.02,
    normalEnemyHealingMultiplier: 0.5,
    eliteBossPlayerHealingMultiplier: 1,
  },
  q: {
    totalAdRatio: 0.9,
    dashRange: 300,
    cleaveRange: 285,
    cleaveAngleDegrees: 110,
    castTimeSeconds: 0.15,
    cadenceStacksAppliedToFirstPriorityTarget: 1,
    ranks: [
      { baseDamage: 75, manaCost: 45, cooldownSeconds: 10, slowPercent: 20, slowDurationSeconds: 1.25 },
      { baseDamage: 110, manaCost: 50, cooldownSeconds: 9, slowPercent: 25, slowDurationSeconds: 1.35 },
      { baseDamage: 145, manaCost: 55, cooldownSeconds: 8, slowPercent: 30, slowDurationSeconds: 1.45 },
      { baseDamage: 180, manaCost: 60, cooldownSeconds: 7, slowPercent: 35, slowDurationSeconds: 1.55 },
    ],
  },
  w: {
    guardDurationSeconds: 1.25,
    guardArcDegrees: 140,
    movementPenaltyPercent: 25,
    reprisalTriggerPreventedDamagePercentMaxHp: 5,
    reprisalWindowSeconds: 3,
    reprisalBonusAttackRange: 100,
    reprisalTotalAdRatio: 0.45,
    ranks: [
      { frontDamageReductionPercent: 40, manaCost: 55, cooldownSeconds: 16, reprisalBaseDamage: 45, stunDurationSeconds: 0.65 },
      { frontDamageReductionPercent: 45, manaCost: 60, cooldownSeconds: 14, reprisalBaseDamage: 75, stunDurationSeconds: 0.8 },
      { frontDamageReductionPercent: 50, manaCost: 65, cooldownSeconds: 12, reprisalBaseDamage: 105, stunDurationSeconds: 0.95 },
      { frontDamageReductionPercent: 55, manaCost: 70, cooldownSeconds: 10, reprisalBaseDamage: 135, stunDurationSeconds: 1.1 },
    ],
  },
  e: {
    maxCadenceStacks: 3,
    cadenceDurationSeconds: 4,
    activeRadius: 325,
    activeTotalAdRatio: 0.65,
    normalEnemyHealingMultiplier: 0.5,
    eliteBossPlayerHealingMultiplier: 1,
    ranks: [
      { attackSpeedPercentPerStack: 4, activeBaseDamage: 55, bonusDamagePerConsumedStack: 18, healingPercentMaxHpPerStack: 0.7, manaCost: 50, cooldownSeconds: 11 },
      { attackSpeedPercentPerStack: 5, activeBaseDamage: 85, bonusDamagePerConsumedStack: 26, healingPercentMaxHpPerStack: 0.9, manaCost: 55, cooldownSeconds: 10 },
      { attackSpeedPercentPerStack: 6, activeBaseDamage: 115, bonusDamagePerConsumedStack: 34, healingPercentMaxHpPerStack: 1.1, manaCost: 60, cooldownSeconds: 9 },
      { attackSpeedPercentPerStack: 7, activeBaseDamage: 145, bonusDamagePerConsumedStack: 42, healingPercentMaxHpPerStack: 1.3, manaCost: 65, cooldownSeconds: 8 },
    ],
  },
  r: {
    radius: 475,
    castTimeSeconds: 0.55,
    totalAdRatio: 0.75,
    majestyDurationSeconds: 6,
    qwCooldownReductionPerBasicAttackSeconds: 0.5,
    cooldownReductionInternalCooldownSeconds: 1,
    bossThreatMultiplier: 5,
    ranks: [
      { baseDamage: 130, manaCost: 100, cooldownSeconds: 90, pvpTauntDurationSeconds: 1, eliteTauntDurationSeconds: 1.5, damageReductionPercent: 15, tenacityPercent: 20 },
      { baseDamage: 220, manaCost: 125, cooldownSeconds: 75, pvpTauntDurationSeconds: 1.3, eliteTauntDurationSeconds: 1.8, damageReductionPercent: 20, tenacityPercent: 28 },
      { baseDamage: 310, manaCost: 145, cooldownSeconds: 60, pvpTauntDurationSeconds: 1.6, eliteTauntDurationSeconds: 2.1, damageReductionPercent: 24, tenacityPercent: 35 },
    ],
  },
};

export const ALDEN_ABILITY_UNLOCK_LEVELS: Record<AbilityKey, readonly number[]> = {
  Q: ALDEN.abilities.Q.unlockLevels,
  W: ALDEN.abilities.W.unlockLevels,
  E: ALDEN.abilities.E.unlockLevels,
  R: ALDEN.abilities.R.unlockLevels,
};

export function getAldenStatsAtLevel(level: number): HeroStats {
  return calculateDefinitionStatsAtLevel(ALDEN, level);
}

export function getAldenAvailableAbilityRank(key: AbilityKey, heroLevel: number): number {
  if (!Number.isInteger(heroLevel) || heroLevel < 1 || heroLevel > ALDEN.maxLevel) {
    throw new RangeError(`Alden level must be an integer from 1 to ${ALDEN.maxLevel}.`);
  }
  return ALDEN.abilities[key].unlockLevels.filter(level => level <= heroLevel).length;
}
