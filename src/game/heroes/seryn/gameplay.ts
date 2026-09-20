import { calculateDefinitionStatsAtLevel } from '../heroAttributes';
import {
  HeroPrimaryAttribute,
  type AbilityKey,
  type HeroAbilityDefinition,
  type HeroDefinition,
  type HeroInnateDefinition,
  type HeroStats,
} from '../types';

export const SERYN_ID = 'H002' as const;

export const SERYN_SKILL_SYSTEM = {
  abilityPointsPerHeroLevel: 1,
  basicAbilityRankHeroLevels: [1, 3, 5, 7] as const,
  ultimateRankHeroLevels: [6, 12, 18] as const,
} as const;

export interface SerynInnateDefinition extends HeroInnateDefinition {
  minimumRange: number;
  maxStacks: number;
  stackDurationSeconds: number;
  alignedWindowSeconds: number;
  perTargetLockoutSeconds: number;
  bonusDamageBase: number;
  bonusDamagePerHeroLevel: number;
  totalAdRatio: number;
}

export interface SerynQRank {
  baseDamage: number;
  manaCost: number;
  cooldownSeconds: number;
}

export interface SerynWRank {
  manaCost: number;
  cooldownSeconds: number;
  attackSpeedPercent: number;
}

export interface SerynERank {
  baseDamage: number;
  manaCost: number;
  cooldownSeconds: number;
  slowPercent: number;
  rootDurationSeconds: number;
}

export interface SerynRRank {
  shotBaseDamage: number;
  manaCost: number;
  cooldownSeconds: number;
  slowPercent: number;
}

export interface SerynGameplayDefinition extends HeroDefinition {
  innate: SerynInnateDefinition;
  q: {
    totalAdRatio: number;
    range: number;
    width: number;
    castTimeSeconds: number;
    normalEnemyPierceDamageMultiplier: number;
    ranks: readonly [SerynQRank, SerynQRank, SerynQRank, SerynQRank];
  };
  w: {
    dashRange: number;
    dashDurationSeconds: number;
    buffDurationSeconds: number;
    ranks: readonly [SerynWRank, SerynWRank, SerynWRank, SerynWRank];
  };
  e: {
    totalAdRatio: number;
    castRange: number;
    radius: number;
    centerRadius: number;
    armDelaySeconds: number;
    slowDurationSeconds: number;
    ranks: readonly [SerynERank, SerynERank, SerynERank, SerynERank];
  };
  r: {
    totalAdRatioPerShot: number;
    range: number;
    width: number;
    shotCount: number;
    startupSeconds: number;
    shotIntervalSeconds: number;
    repeatedHitDamageMultiplier: number;
    slowDurationSeconds: number;
    ranks: readonly [SerynRRank, SerynRRank, SerynRRank];
  };
}

const qAbility: HeroAbilityDefinition = {
  key: 'Q',
  name: 'Flecha de Refracción',
  type: 'active',
  lore: 'Seryn curva el cristal de su arco para concentrar una sola trayectoria de luz capaz de atravesar una formación antes de encontrar a su verdadero objetivo.',
  technicalDescription: 'Dispara una flecha lineal de 925 de alcance. Inflige daño físico y atraviesa enemigos normales con daño reducido, pero se detiene en el primer héroe, élite o jefe alcanzado.',
  unlockLevels: SERYN_SKILL_SYSTEM.basicAbilityRankHeroLevels,
};

const wAbility: HeroAbilityDefinition = {
  key: 'W',
  name: 'Paso de Vector',
  type: 'active',
  lore: 'La Vigía no huye del peligro: corrige el ángulo. Un impulso corto basta para recuperar la distancia exacta desde la que su arco vuelve a dominar el combate.',
  technicalDescription: 'Seryn se desplaza 300 unidades en la dirección elegida. No inflige daño. Tras el desplazamiento obtiene velocidad de ataque durante 3 s.',
  unlockLevels: SERYN_SKILL_SYSTEM.basicAbilityRankHeroLevels,
};

const eAbility: HeroAbilityDefinition = {
  key: 'E',
  name: 'Ancla Prismática',
  type: 'active',
  lore: 'Seryn clava un prisma cartográfico en el terreno. Cuando despierta, la luz revela el punto exacto donde el enemigo ya no debería estar.',
  technicalDescription: 'Lanza un ancla hasta 750 unidades. Tras 0.55 s detona en 250 de radio, inflige daño mágico y ralentiza. Los enemigos en los 95 centrales quedan enraizados brevemente.',
  unlockLevels: SERYN_SKILL_SYSTEM.basicAbilityRankHeroLevels,
};

const rAbility: HeroAbilityDefinition = {
  key: 'R',
  name: 'Meridiano Partido',
  type: 'ultimate',
  lore: 'Seryn fija un meridiano invisible sobre el campo y dispara tres veces por la misma línea, obligando al enemigo a abandonar el terreno o aceptar cada impacto.',
  technicalDescription: 'Tras una preparación visible, dispara 3 proyectiles por una línea de 1200 de alcance. El primer impacto inflige daño completo y ralentiza; impactos posteriores sobre el mismo objetivo infligen 65% del daño de cada disparo.',
  unlockLevels: SERYN_SKILL_SYSTEM.ultimateRankHeroLevels,
};

export const SERYN: SerynGameplayDefinition = {
  id: SERYN_ID,
  displayName: 'Seryn',
  version: '0.1.0',
  maxLevel: 30,
  className: 'Vigía',
  primaryRole: 'Tiradora-Escaramuzadora',
  secondaryRoles: ['Daño sostenido', 'Poke', 'Reposicionamiento'],
  deploymentPreferences: {
    primary: ['NORTH', 'SOUTH'],
    secondary: ['MID'],
  },
  combatProfile: {
    burst: 'Medium',
    sustainedDamage: 'High',
    control: 'Medium',
    mobility: 'Medium',
    durability: 'Low',
    range: 'High',
  },
  difficulty: 'Medium',
  weaponConfiguration: 'Arco largo prismático de dos brazos, con cuerda de energía y carcaj físico',
  weaponDesignReason: 'El arma debe leer a distancia y justificar tanto sus básicos de largo alcance como la geometría lineal de Q y R. El arco es grande y reconocible, pero no concede daño gratuito: Seryn depende del posicionamiento y de mantener espacio.',
  lore: 'Seryn cartografiaba las rutas altas cuando las viejas balizas del horizonte comenzaron a apagarse una a una. En lugar de regresar, convirtió las lentes de su observatorio en un arco y siguió las líneas de luz hasta el frente. Para ella, cada batalla es un problema de distancia, ángulo y tiempo: si puede ver una salida, puede abrirla.',
  primaryAttribute: HeroPrimaryAttribute.AGI,
  baseAttackDamage: 31,
  baseAttributes: {
    strength: 17,
    agility: 23,
    intelligence: 15,
  },
  attributeProgression: {
    strength: 2.0,
    agility: 3.1,
    intelligence: 1.8,
  },
  resource: {
    type: 'mana',
    displayName: 'Maná',
    reason: 'Su movilidad y control deben competir por el mismo recurso que el poke; Seryn no puede reposicionarse y hostigar sin límite.',
  },
  baseStats: {
    maxHp: 200,
    maxResource: 150,
    attackDamage: 31,
    physicalArmor: 19.86,
    physicalDamageResistancePercent: 0,
    magicResistance: 22,
    attackSpeed: 0.68,
    movementSpeed: 330,
    hpRegenPerSecond: 0,
    resourceRegenPerSecond: 0.8,
    magicPower: 0,
    abilityPowerPercent: 0,
    attackRange: 575,
    criticalChancePercent: 5,
  },
  statProgression: {
    maxHp: { kind: 'fixed' },
    maxResource: { kind: 'fixed' },
    attackDamage: { kind: 'fixed' },
    physicalArmor: { kind: 'fixed' },
    physicalDamageResistancePercent: { kind: 'fixed' },
    magicResistance: { kind: 'linear', perLevel: 0.9 },
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
    id: 'seryn:innate:linea-del-horizonte',
    name: 'Línea de Horizonte',
    description: 'Seryn recompensa la distancia mantenida. Tres impactos bien espaciados convierten al objetivo en una trayectoria resuelta para su siguiente disparo.',
    technicalDescription: 'Los ataques básicos contra héroes, élites o jefes realizados desde al menos 450 unidades aplican 1 Trazo durante 4 s, hasta 3. Al completar 3, el objetivo queda Alineado durante 4 s. El siguiente básico de Seryn contra ese objetivo consume Alineado e inflige 18 + 1.2 por nivel después del primero + 25% del AD total como daño físico adicional. El mismo objetivo no puede volver a generar el proc durante 5 s.',
    hud: {
      kind: 'persistent_aura',
      art: 'crosshair',
      tone: 'passive',
      counter: {
        runtimeCounterKey: 'seryn:sightline',
        maxStacks: 3,
        readyStatusId: 'seryn:aligned',
      },
    },
    minimumRange: 450,
    maxStacks: 3,
    stackDurationSeconds: 4,
    alignedWindowSeconds: 4,
    perTargetLockoutSeconds: 5,
    bonusDamageBase: 18,
    bonusDamagePerHeroLevel: 1.2,
    totalAdRatio: 0.25,
  },
  q: {
    totalAdRatio: 0.85,
    range: 925,
    width: 90,
    castTimeSeconds: 0.18,
    normalEnemyPierceDamageMultiplier: 0.65,
    ranks: [
      { baseDamage: 65, manaCost: 40, cooldownSeconds: 9 },
      { baseDamage: 95, manaCost: 45, cooldownSeconds: 8.5 },
      { baseDamage: 125, manaCost: 50, cooldownSeconds: 8 },
      { baseDamage: 155, manaCost: 55, cooldownSeconds: 7.5 },
    ],
  },
  w: {
    dashRange: 300,
    dashDurationSeconds: 0.18,
    buffDurationSeconds: 3,
    ranks: [
      { manaCost: 55, cooldownSeconds: 16, attackSpeedPercent: 18 },
      { manaCost: 55, cooldownSeconds: 15, attackSpeedPercent: 24 },
      { manaCost: 60, cooldownSeconds: 14, attackSpeedPercent: 30 },
      { manaCost: 60, cooldownSeconds: 13, attackSpeedPercent: 36 },
    ],
  },
  e: {
    totalAdRatio: 0.35,
    castRange: 750,
    radius: 250,
    centerRadius: 95,
    armDelaySeconds: 0.55,
    slowDurationSeconds: 1.4,
    ranks: [
      { baseDamage: 45, manaCost: 60, cooldownSeconds: 14, slowPercent: 30, rootDurationSeconds: 0.55 },
      { baseDamage: 70, manaCost: 65, cooldownSeconds: 13, slowPercent: 35, rootDurationSeconds: 0.7 },
      { baseDamage: 95, manaCost: 70, cooldownSeconds: 12, slowPercent: 40, rootDurationSeconds: 0.85 },
      { baseDamage: 120, manaCost: 75, cooldownSeconds: 11, slowPercent: 45, rootDurationSeconds: 1.0 },
    ],
  },
  r: {
    totalAdRatioPerShot: 0.5,
    range: 1200,
    width: 130,
    shotCount: 3,
    startupSeconds: 0.65,
    shotIntervalSeconds: 0.55,
    repeatedHitDamageMultiplier: 0.65,
    slowDurationSeconds: 1,
    ranks: [
      { shotBaseDamage: 75, manaCost: 110, cooldownSeconds: 100, slowPercent: 20 },
      { shotBaseDamage: 120, manaCost: 130, cooldownSeconds: 85, slowPercent: 25 },
      { shotBaseDamage: 165, manaCost: 150, cooldownSeconds: 70, slowPercent: 30 },
    ],
  },
};

export const SERYN_ABILITY_UNLOCK_LEVELS: Record<AbilityKey, readonly number[]> = {
  Q: SERYN.abilities.Q.unlockLevels,
  W: SERYN.abilities.W.unlockLevels,
  E: SERYN.abilities.E.unlockLevels,
  R: SERYN.abilities.R.unlockLevels,
};

export function getSerynStatsAtLevel(level: number): HeroStats {
  return calculateDefinitionStatsAtLevel(SERYN, level);
}

export function getSerynAvailableAbilityRank(key: AbilityKey, heroLevel: number): number {
  if (!Number.isInteger(heroLevel) || heroLevel < 1 || heroLevel > SERYN.maxLevel) {
    throw new RangeError(`Seryn level must be an integer from 1 to ${SERYN.maxLevel}.`);
  }
  return SERYN.abilities[key].unlockLevels.filter(level => level <= heroLevel).length;
}
