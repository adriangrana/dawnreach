import {
  Check,
  LogOut,
  LockKeyhole,
  Search,
  Send,
  Swords,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getHeroAbilityArt, getHeroFullArt, getHeroPassiveArt, getHeroPortrait } from '../game/heroes/assets';
import { ALDEN } from '../game/heroes/alden/gameplay';
import { getHeroDefinition, hasHeroDefinition, listHeroDefinitions } from '../game/heroes/catalog';
import { SERYN } from '../game/heroes/seryn/gameplay';
import { platformRealtime } from './realtimeClient';
import type { HeroSelectPlayer, HeroSelectState, PlatformUser, Team } from './types';

const HERO_NAMES: Record<string, string> = Object.fromEntries(
  listHeroDefinitions().map(hero => [hero.id, hero.displayName]),
);

function heroSelectionArt(heroId: string) {
  return getHeroPortrait(heroId) || getHeroFullArt(heroId);
}

function heroFocusArt(heroId: string) {
  return getHeroFullArt(heroId) || getHeroPortrait(heroId);
}

type AbilityTooltipRow = Readonly<{
  label: string;
  values: readonly string[];
}>;

type AbilityTooltipSection = Readonly<{
  title: string;
  rows: readonly AbilityTooltipRow[];
}>;

type AbilityTooltipDefinition = Readonly<{
  key: string;
  label: string;
  name: string;
  art: string;
  typeLabel: string;
  description: string;
  lore: string;
  rankLabels: readonly string[];
  rankHeroLevels: readonly number[];
  sections: readonly AbilityTooltipSection[];
}>;

const basicRankLabels = ['N1', 'N2', 'N3', 'N4'] as const;
const ultimateRankLabels = ['N1', 'N2', 'N3'] as const;

const ALDEN_ABILITIES: readonly AbilityTooltipDefinition[] = [
  {
    key: 'P',
    label: 'PASSIVE',
    name: ALDEN.innate.name,
    art: getHeroPassiveArt(ALDEN.id),
    typeLabel: 'Pasiva innata',
    description: ALDEN.innate.technicalDescription,
    lore: ALDEN.innate.description,
    rankLabels: ['NIVEL 1', 'NIVEL 10', 'NIVEL 20', 'NIVEL 30'],
    rankHeroLevels: [1, 10, 20, 30],
    sections: [
      {
        title: 'ESCALADO POR NIVEL DE HÉROE',
        rows: [
          {
            label: 'Daño adicional',
            values: [1, 10, 20, 30].map(level => {
              const flat = ALDEN.innate.bonusDamageBase + ALDEN.innate.bonusDamagePerHeroLevel * (level - 1);
              return `${Number(flat.toFixed(1))} + ${Math.round(ALDEN.innate.totalAdRatio * 100)}% AD total`;
            }),
          },
          {
            label: 'Curación máx. HP',
            values: [1, 10, 20, 30].map(level => {
              const heal = ALDEN.innate.healingBasePercentMaxHp + ALDEN.innate.healingPercentMaxHpPerHeroLevel * (level - 1);
              return `${Number(heal.toFixed(2))}%`;
            }),
          },
        ],
      },
      {
        title: 'VALORES FIJOS',
        rows: [
          { label: 'Cargas máximas', values: [String(ALDEN.innate.maxStacks)] },
          { label: 'Ángulo frontal', values: [`${ALDEN.innate.frontalArcDegrees}°`] },
          { label: 'ICD por carga', values: [`${ALDEN.innate.stackInternalCooldownSeconds}s`] },
          { label: 'Ventana potenciada', values: [`${ALDEN.innate.empoweredAttackWindowSeconds}s`] },
          { label: 'Bloqueo tras proc', values: [`${ALDEN.innate.procLockoutSeconds}s`] },
          { label: 'Curación vs normal', values: [`${Math.round(ALDEN.innate.normalEnemyHealingMultiplier * 100)}%`] },
          { label: 'Curación vs héroe/élite/jefe', values: [`${Math.round(ALDEN.innate.eliteBossPlayerHealingMultiplier * 100)}%`] },
        ],
      },
    ],
  },
  {
    key: 'Q',
    label: 'Q',
    name: ALDEN.abilities.Q.name,
    art: getHeroAbilityArt(ALDEN.id, 'Q'),
    typeLabel: 'Activa · daño físico / movilidad / slow',
    description: ALDEN.abilities.Q.technicalDescription,
    lore: ALDEN.abilities.Q.lore,
    rankLabels: basicRankLabels,
    rankHeroLevels: ALDEN.abilities.Q.unlockLevels,
    sections: [
      {
        title: 'ESCALADO POR RANGO',
        rows: [
          { label: 'Daño base', values: ALDEN.q.ranks.map(rank => String(rank.baseDamage)) },
          { label: 'Coste de maná', values: ALDEN.q.ranks.map(rank => String(rank.manaCost)) },
          { label: 'Cooldown', values: ALDEN.q.ranks.map(rank => `${rank.cooldownSeconds}s`) },
          { label: 'Ralentización', values: ALDEN.q.ranks.map(rank => `${rank.slowPercent}%`) },
          { label: 'Duración slow', values: ALDEN.q.ranks.map(rank => `${rank.slowDurationSeconds}s`) },
        ],
      },
      {
        title: 'VALORES FIJOS',
        rows: [
          { label: 'Escalado', values: [`${Math.round(ALDEN.q.totalAdRatio * 100)}% AD total`] },
          { label: 'Dash', values: [`${ALDEN.q.dashRange} unidades`] },
          { label: 'Corte', values: [`${ALDEN.q.cleaveRange} unidades · ${ALDEN.q.cleaveAngleDegrees}°`] },
          { label: 'Tiempo de casteo', values: [`${ALDEN.q.castTimeSeconds}s`] },
          { label: 'Cadencia aplicada', values: [String(ALDEN.q.cadenceStacksAppliedToFirstPriorityTarget)] },
        ],
      },
    ],
  },
  {
    key: 'W',
    label: 'W',
    name: ALDEN.abilities.W.name,
    art: getHeroAbilityArt(ALDEN.id, 'W'),
    typeLabel: 'Activa · defensa / represalia / control',
    description: ALDEN.abilities.W.technicalDescription,
    lore: ALDEN.abilities.W.lore,
    rankLabels: basicRankLabels,
    rankHeroLevels: ALDEN.abilities.W.unlockLevels,
    sections: [
      {
        title: 'ESCALADO POR RANGO',
        rows: [
          { label: 'Reducción frontal', values: ALDEN.w.ranks.map(rank => `${rank.frontDamageReductionPercent}%`) },
          { label: 'Daño de Represalia', values: ALDEN.w.ranks.map(rank => String(rank.reprisalBaseDamage)) },
          { label: 'Aturdimiento', values: ALDEN.w.ranks.map(rank => `${rank.stunDurationSeconds}s`) },
          { label: 'Coste de maná', values: ALDEN.w.ranks.map(rank => String(rank.manaCost)) },
          { label: 'Cooldown', values: ALDEN.w.ranks.map(rank => `${rank.cooldownSeconds}s`) },
        ],
      },
      {
        title: 'VALORES FIJOS',
        rows: [
          { label: 'Duración guardia', values: [`${ALDEN.w.guardDurationSeconds}s`] },
          { label: 'Arco frontal', values: [`${ALDEN.w.guardArcDegrees}°`] },
          { label: 'Penalización movimiento', values: [`${ALDEN.w.movementPenaltyPercent}%`] },
          { label: 'Umbral Represalia', values: [`${ALDEN.w.reprisalTriggerPreventedDamagePercentMaxHp}% HP máx. prevenido`] },
          { label: 'Ventana Represalia', values: [`${ALDEN.w.reprisalWindowSeconds}s`] },
          { label: 'Rango extra Represalia', values: [`${ALDEN.w.reprisalBonusAttackRange}`] },
          { label: 'Escalado Represalia', values: [`${Math.round(ALDEN.w.reprisalTotalAdRatio * 100)}% AD total`] },
        ],
      },
    ],
  },
  {
    key: 'E',
    label: 'E',
    name: ALDEN.abilities.E.name,
    art: getHeroAbilityArt(ALDEN.id, 'E'),
    typeLabel: 'Activa + pasiva · daño / velocidad / curación',
    description: ALDEN.abilities.E.technicalDescription,
    lore: ALDEN.abilities.E.lore,
    rankLabels: basicRankLabels,
    rankHeroLevels: ALDEN.abilities.E.unlockLevels,
    sections: [
      {
        title: 'ESCALADO POR RANGO',
        rows: [
          { label: 'Vel. ataque por carga', values: ALDEN.e.ranks.map(rank => `${rank.attackSpeedPercentPerStack}%`) },
          { label: 'Daño base activo', values: ALDEN.e.ranks.map(rank => String(rank.activeBaseDamage)) },
          { label: 'Daño por carga', values: ALDEN.e.ranks.map(rank => String(rank.bonusDamagePerConsumedStack)) },
          { label: 'Curación por carga', values: ALDEN.e.ranks.map(rank => `${rank.healingPercentMaxHpPerStack}% HP máx.`) },
          { label: 'Coste de maná', values: ALDEN.e.ranks.map(rank => String(rank.manaCost)) },
          { label: 'Cooldown', values: ALDEN.e.ranks.map(rank => `${rank.cooldownSeconds}s`) },
        ],
      },
      {
        title: 'VALORES FIJOS',
        rows: [
          { label: 'Cargas máximas', values: [String(ALDEN.e.maxCadenceStacks)] },
          { label: 'Duración cargas', values: [`${ALDEN.e.cadenceDurationSeconds}s`] },
          { label: 'Radio activo', values: [`${ALDEN.e.activeRadius}`] },
          { label: 'Escalado activo', values: [`${Math.round(ALDEN.e.activeTotalAdRatio * 100)}% AD total`] },
          { label: 'Curación vs normal', values: [`${Math.round(ALDEN.e.normalEnemyHealingMultiplier * 100)}%`] },
          { label: 'Curación vs héroe/élite/jefe', values: [`${Math.round(ALDEN.e.eliteBossPlayerHealingMultiplier * 100)}%`] },
        ],
      },
    ],
  },
  {
    key: 'R',
    label: 'R',
    name: ALDEN.abilities.R.name,
    art: getHeroAbilityArt(ALDEN.id, 'R'),
    typeLabel: 'Ultimate · daño / provocación / mitigación',
    description: ALDEN.abilities.R.technicalDescription,
    lore: ALDEN.abilities.R.lore,
    rankLabels: ultimateRankLabels,
    rankHeroLevels: ALDEN.abilities.R.unlockLevels,
    sections: [
      {
        title: 'ESCALADO POR RANGO',
        rows: [
          { label: 'Daño base', values: ALDEN.r.ranks.map(rank => String(rank.baseDamage)) },
          { label: 'Coste de maná', values: ALDEN.r.ranks.map(rank => String(rank.manaCost)) },
          { label: 'Cooldown', values: ALDEN.r.ranks.map(rank => `${rank.cooldownSeconds}s`) },
          { label: 'Provocación PvP', values: ALDEN.r.ranks.map(rank => `${rank.pvpTauntDurationSeconds}s`) },
          { label: 'Provocación élite', values: ALDEN.r.ranks.map(rank => `${rank.eliteTauntDurationSeconds}s`) },
          { label: 'Reducción de daño', values: ALDEN.r.ranks.map(rank => `${rank.damageReductionPercent}%`) },
          { label: 'Tenacidad', values: ALDEN.r.ranks.map(rank => `${rank.tenacityPercent}%`) },
        ],
      },
      {
        title: 'VALORES FIJOS',
        rows: [
          { label: 'Radio', values: [`${ALDEN.r.radius}`] },
          { label: 'Tiempo de casteo', values: [`${ALDEN.r.castTimeSeconds}s`] },
          { label: 'Escalado', values: [`${Math.round(ALDEN.r.totalAdRatio * 100)}% AD total`] },
          { label: 'Duración Majestad', values: [`${ALDEN.r.majestyDurationSeconds}s`] },
          { label: 'Reducción Q/W por básico', values: [`${ALDEN.r.qwCooldownReductionPerBasicAttackSeconds}s`] },
          { label: 'ICD reducción Q/W', values: [`${ALDEN.r.cooldownReductionInternalCooldownSeconds}s`] },
          { label: 'Multiplicador amenaza jefe', values: [`×${ALDEN.r.bossThreatMultiplier}`] },
        ],
      },
    ],
  },
];

const SERYN_ABILITIES: readonly AbilityTooltipDefinition[] = [
  {
    key: 'P',
    label: 'PASSIVE',
    name: SERYN.innate.name,
    art: getHeroPassiveArt('H002'),
    typeLabel: 'Pasiva innata · posicionamiento / daño',
    description: SERYN.innate.technicalDescription,
    lore: SERYN.innate.description,
    rankLabels: ['NIVEL 1', 'NIVEL 10', 'NIVEL 20', 'NIVEL 30'],
    rankHeroLevels: [1, 10, 20, 30],
    sections: [
      {
        title: 'ESCALADO POR NIVEL DE HÉROE',
        rows: [{
          label: 'Daño adicional',
          values: [1, 10, 20, 30].map(level => {
            const flat = SERYN.innate.bonusDamageBase + SERYN.innate.bonusDamagePerHeroLevel * (level - 1);
            return `${Number(flat.toFixed(1))} + ${Math.round(SERYN.innate.totalAdRatio * 100)}% AD total`;
          }),
        }],
      },
      {
        title: 'VALORES FIJOS',
        rows: [
          { label: 'Distancia mínima', values: [`${SERYN.innate.minimumRange}`] },
          { label: 'Trazos máximos', values: [String(SERYN.innate.maxStacks)] },
          { label: 'Duración de Trazo', values: [`${SERYN.innate.stackDurationSeconds}s`] },
          { label: 'Ventana Alineado', values: [`${SERYN.innate.alignedWindowSeconds}s`] },
          { label: 'Bloqueo por objetivo', values: [`${SERYN.innate.perTargetLockoutSeconds}s`] },
        ],
      },
    ],
  },
  {
    key: 'Q',
    label: 'Q',
    name: SERYN.abilities.Q.name,
    art: getHeroAbilityArt('H002', 'Q'),
    typeLabel: 'Activa · skillshot / daño físico / poke',
    description: SERYN.abilities.Q.technicalDescription,
    lore: SERYN.abilities.Q.lore,
    rankLabels: basicRankLabels,
    rankHeroLevels: SERYN.abilities.Q.unlockLevels,
    sections: [
      {
        title: 'ESCALADO POR RANGO',
        rows: [
          { label: 'Daño base', values: SERYN.q.ranks.map(rank => String(rank.baseDamage)) },
          { label: 'Coste de maná', values: SERYN.q.ranks.map(rank => String(rank.manaCost)) },
          { label: 'Cooldown', values: SERYN.q.ranks.map(rank => `${rank.cooldownSeconds}s`) },
        ],
      },
      {
        title: 'VALORES FIJOS',
        rows: [
          { label: 'Escalado', values: [`${Math.round(SERYN.q.totalAdRatio * 100)}% AD total`] },
          { label: 'Alcance', values: [String(SERYN.q.range)] },
          { label: 'Anchura', values: [String(SERYN.q.width)] },
          { label: 'Tiempo de casteo', values: [`${SERYN.q.castTimeSeconds}s`] },
          { label: 'Daño al atravesar unidades normales', values: [`${Math.round(SERYN.q.normalEnemyPierceDamageMultiplier * 100)}%`] },
        ],
      },
    ],
  },
  {
    key: 'W',
    label: 'W',
    name: SERYN.abilities.W.name,
    art: getHeroAbilityArt('H002', 'W'),
    typeLabel: 'Activa · movilidad / velocidad de ataque',
    description: SERYN.abilities.W.technicalDescription,
    lore: SERYN.abilities.W.lore,
    rankLabels: basicRankLabels,
    rankHeroLevels: SERYN.abilities.W.unlockLevels,
    sections: [
      {
        title: 'ESCALADO POR RANGO',
        rows: [
          { label: 'Velocidad de ataque', values: SERYN.w.ranks.map(rank => `+${rank.attackSpeedPercent}%`) },
          { label: 'Coste de maná', values: SERYN.w.ranks.map(rank => String(rank.manaCost)) },
          { label: 'Cooldown', values: SERYN.w.ranks.map(rank => `${rank.cooldownSeconds}s`) },
        ],
      },
      {
        title: 'VALORES FIJOS',
        rows: [
          { label: 'Desplazamiento', values: [`${SERYN.w.dashRange} unidades`] },
          { label: 'Duración del dash', values: [`${SERYN.w.dashDurationSeconds}s`] },
          { label: 'Duración del buff', values: [`${SERYN.w.buffDurationSeconds}s`] },
          { label: 'Daño', values: ['0'] },
        ],
      },
    ],
  },
  {
    key: 'E',
    label: 'E',
    name: SERYN.abilities.E.name,
    art: getHeroAbilityArt('H002', 'E'),
    typeLabel: 'Activa · daño mágico / slow / root',
    description: SERYN.abilities.E.technicalDescription,
    lore: SERYN.abilities.E.lore,
    rankLabels: basicRankLabels,
    rankHeroLevels: SERYN.abilities.E.unlockLevels,
    sections: [
      {
        title: 'ESCALADO POR RANGO',
        rows: [
          { label: 'Daño base', values: SERYN.e.ranks.map(rank => String(rank.baseDamage)) },
          { label: 'Ralentización', values: SERYN.e.ranks.map(rank => `${rank.slowPercent}%`) },
          { label: 'Raíz central', values: SERYN.e.ranks.map(rank => `${rank.rootDurationSeconds}s`) },
          { label: 'Coste de maná', values: SERYN.e.ranks.map(rank => String(rank.manaCost)) },
          { label: 'Cooldown', values: SERYN.e.ranks.map(rank => `${rank.cooldownSeconds}s`) },
        ],
      },
      {
        title: 'VALORES FIJOS',
        rows: [
          { label: 'Escalado', values: [`${Math.round(SERYN.e.totalAdRatio * 100)}% AD total`] },
          { label: 'Alcance', values: [String(SERYN.e.castRange)] },
          { label: 'Radio', values: [String(SERYN.e.radius)] },
          { label: 'Radio central', values: [String(SERYN.e.centerRadius)] },
          { label: 'Armado', values: [`${SERYN.e.armDelaySeconds}s`] },
          { label: 'Duración slow', values: [`${SERYN.e.slowDurationSeconds}s`] },
        ],
      },
    ],
  },
  {
    key: 'R',
    label: 'R',
    name: SERYN.abilities.R.name,
    art: getHeroAbilityArt('H002', 'R'),
    typeLabel: 'Ultimate · 3 disparos lineales / slow',
    description: SERYN.abilities.R.technicalDescription,
    lore: SERYN.abilities.R.lore,
    rankLabels: ultimateRankLabels,
    rankHeroLevels: SERYN.abilities.R.unlockLevels,
    sections: [
      {
        title: 'ESCALADO POR RANGO',
        rows: [
          { label: 'Daño por primer impacto', values: SERYN.r.ranks.map(rank => String(rank.shotBaseDamage)) },
          { label: 'Ralentización', values: SERYN.r.ranks.map(rank => `${rank.slowPercent}%`) },
          { label: 'Coste de maná', values: SERYN.r.ranks.map(rank => String(rank.manaCost)) },
          { label: 'Cooldown', values: SERYN.r.ranks.map(rank => `${rank.cooldownSeconds}s`) },
        ],
      },
      {
        title: 'VALORES FIJOS',
        rows: [
          { label: 'Disparos', values: [String(SERYN.r.shotCount)] },
          { label: 'Escalado por disparo', values: [`${Math.round(SERYN.r.totalAdRatioPerShot * 100)}% AD total`] },
          { label: 'Daño de impactos repetidos', values: [`${Math.round(SERYN.r.repeatedHitDamageMultiplier * 100)}%`] },
          { label: 'Alcance', values: [String(SERYN.r.range)] },
          { label: 'Anchura', values: [String(SERYN.r.width)] },
          { label: 'Preparación', values: [`${SERYN.r.startupSeconds}s`] },
          { label: 'Intervalo', values: [`${SERYN.r.shotIntervalSeconds}s`] },
        ],
      },
    ],
  },
];

function genericAbilitiesForHero(heroId: string): readonly AbilityTooltipDefinition[] {
  if (!hasHeroDefinition(heroId)) return [];
  const hero = getHeroDefinition(heroId);
  const generic: AbilityTooltipDefinition[] = [];
  if (hero.innate) {
    generic.push({
      key: 'P',
      label: 'PASSIVE',
      name: hero.innate.name,
      art: getHeroPassiveArt(hero.id),
      typeLabel: 'Pasiva innata',
      description: hero.innate.technicalDescription,
      lore: hero.innate.description,
      rankLabels: [],
      rankHeroLevels: [],
      sections: [],
    });
  }
  for (const key of ['Q', 'W', 'E', 'R'] as const) {
    const ability = hero.abilities[key];
    generic.push({
      key,
      label: key,
      name: ability.name,
      art: getHeroAbilityArt(hero.id, key),
      typeLabel: ability.type === 'ultimate' ? 'Ultimate' : 'Habilidad',
      description: ability.technicalDescription,
      lore: ability.lore,
      rankLabels: [],
      rankHeroLevels: ability.unlockLevels,
      sections: [],
    });
  }
  return generic;
}

const SPECIALIZED_ABILITY_TOOLTIPS = new Map<string, readonly AbilityTooltipDefinition[]>([
  [ALDEN.id, ALDEN_ABILITIES],
  [SERYN.id, SERYN_ABILITIES],
]);

function abilitiesForHero(heroId: string | null): readonly AbilityTooltipDefinition[] {
  if (!heroId) return [];
  return SPECIALIZED_ABILITY_TOOLTIPS.get(heroId) ?? genericAbilitiesForHero(heroId);
}

function percentForPowerBand(value: 'Low' | 'Medium' | 'High' | undefined) {
  return value === 'High' ? 86 : value === 'Medium' ? 58 : 32;
}

function heroSubtitle(heroId: string) {
  if (!hasHeroDefinition(heroId)) return 'DAWNREACH HERO';
  const hero = getHeroDefinition(heroId);
  return `${hero.className.toUpperCase()} · ${hero.primaryRole.toUpperCase()}`;
}


function AbilityTooltipOverlay({
  ability,
  anchor,
}: {
  ability: AbilityTooltipDefinition;
  anchor: DOMRect;
}) {
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: 16, top: 16, ready: false });

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    if (!tooltip) return;

    const margin = 14;
    const gap = 10;
    const rect = tooltip.getBoundingClientRect();

    let left = anchor.left + anchor.width / 2 - rect.width / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - rect.width - margin));

    let top = anchor.bottom + gap;
    if (top + rect.height > window.innerHeight - margin) {
      top = anchor.top - rect.height - gap;
    }
    top = Math.max(margin, Math.min(top, window.innerHeight - rect.height - margin));

    setPosition({ left, top, ready: true });
  }, [ability, anchor]);

  return createPortal(
    <div
      ref={tooltipRef}
      className="dr-hero-select-ability-tooltip-portal"
      role="tooltip"
      style={{
        left: position.left,
        top: position.top,
        visibility: position.ready ? 'visible' : 'hidden',
      }}
    >
      <header>
        <div><em>{ability.label}</em><strong>{ability.name}</strong></div>
        <span>{ability.typeLabel}</span>
      </header>

      <p className="dr-hero-select-ability-tooltip-description">{ability.description}</p>

      <div className="dr-hero-select-ability-rank-line">
        <strong>{ability.key === 'P' ? 'NIVELES DE HÉROE' : 'RANGOS'}</strong>
        <span>{ability.rankLabels.join(' / ')}</span>
      </div>
      <div className="dr-hero-select-ability-rank-line">
        <strong>{ability.key === 'P' ? 'MUESTRAS DE ESCALADO' : 'DESBLOQUEO'}</strong>
        <span>{ability.rankHeroLevels.map(level => `Nv. ${level}`).join(' / ')}</span>
      </div>

      <div className="dr-hero-select-ability-tooltip-sections">
        {ability.sections.map(section => <section key={section.title}>
          <h4>{section.title}</h4>
          <div>
            {section.rows.map(row => <p key={row.label} className="dr-hero-select-ability-stat-line">
              <strong>{row.label}:</strong>
              <span>{row.values.join(' / ')}</span>
            </p>)}
          </div>
        </section>)}
      </div>

      <blockquote>{ability.lore}</blockquote>
    </div>,
    document.body,
  );
}

function formatClock(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function teamLabel(team: Team) {
  return team === 'blue' ? 'DAWN TEAM' : 'DUSK TEAM';
}

function HeroSelectPlayerCard({
  player,
  me,
  side,
}: {
  player: HeroSelectPlayer;
  me: PlatformUser;
  side: 'left' | 'right';
}) {
  const selected = player.selection.heroId;
  const heroName = selected ? HERO_NAMES[selected] || selected : null;
  return <article className={`dr-hero-select-player is-${player.team}${player.userId === me.id ? ' is-self' : ''}${player.selection.locked ? ' is-locked' : ''}`}>
    {side === 'left' && <div className="dr-hero-select-player-portrait">
      {selected ? <img src={heroSelectionArt(selected)} alt="" draggable={false} /> : <span />}
    </div>}
    <div className="dr-hero-select-player-copy">
      <div><strong>{player.username}</strong>{player.userId === me.id && <em>YOU</em>}</div>
      <span>{player.lane}</span>
      <small>{player.selection.locked ? `LOCKED · ${heroName}` : selected ? `PICKING · ${heroName}` : 'WAITING…'}</small>
    </div>
    {side === 'right' && <div className="dr-hero-select-player-portrait">
      {selected ? <img src={heroSelectionArt(selected)} alt="" draggable={false} /> : <span />}
    </div>}
  </article>;
}

function TeamColumn({
  team,
  players,
  me,
  side,
}: {
  team: Team;
  players: readonly HeroSelectPlayer[];
  me: PlatformUser;
  side: 'left' | 'right';
}) {
  return <aside className={`dr-hero-select-team is-${team} is-${side}`}>
    <header><span>{teamLabel(team)}</span><strong>{players.filter(player => player.selection.locked).length}/{players.length}</strong></header>
    <div>
      {players.map(player => <HeroSelectPlayerCard key={player.userId} player={player} me={me} side={side} />)}
    </div>
  </aside>;
}

function BansStrip({ side, count }: { side: 'ally' | 'enemy'; count: number }) {
  return <div className={`dr-hero-select-bans is-${side}${count <= 0 ? ' is-empty' : ''}`}>
    <span>{side === 'ally' ? 'YOUR TEAM BANS' : 'ENEMY TEAM BANS'}</span>
    <div>
      {Array.from({ length: 4 }, (_, index) => index < count
        ? <i className="is-ban" key={index}><LockKeyhole /></i>
        : <i className="is-placeholder" key={index} />)}
    </div>
  </div>;
}

function HeroSelectChat({ state, me }: { state: HeroSelectState; me: PlatformUser }) {
  const [text, setText] = useState('');
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const meState = state.players.find(player => player.userId === me.id);
  const teamName = meState?.team === 'red' ? 'DUSK' : 'DAWN';

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [state.messages.length]);

  const send = () => {
    const message = text.trim();
    if (!message) return;
    platformRealtime.send('hero_select.message', { text: message });
    setText('');
  };

  return <section className="dr-hero-select-chat">
    <header><span>TEAM CHAT</span><small>{teamName}</small></header>
    <div ref={viewportRef}>
      {state.messages.map(message => <p className={message.system ? 'is-system' : ''} key={message.id}>
        <time>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
        {!message.system && <strong>{message.username}</strong>}
        <span>{message.text}</span>
      </p>)}
      {state.messages.length === 0 && <p className="is-empty"><span>Coordinate picks with your team.</span></p>}
    </div>
    <form onSubmit={event => { event.preventDefault(); send(); }}>
      <input value={text} onChange={event => setText(event.target.value)} maxLength={240} placeholder="Message your team…" />
      <button type="submit" disabled={!text.trim()} aria-label="Send team message"><Send /></button>
    </form>
  </section>;
}

export function HeroSelectScreen({
  state,
  me,
}: {
  state: HeroSelectState;
  me: PlatformUser;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [selectedHeroId, setSelectedHeroId] = useState<string | null>(() => {
    const mine = state.players.find(player => player.userId === me.id);
    return mine?.selection.heroId || state.availableHeroIds[0] || null;
  });
  const [search, setSearch] = useState('');
  const [abilityTooltip, setAbilityTooltip] = useState<{ ability: AbilityTooltipDefinition; anchor: DOMRect } | null>(null);
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState('');

  const meState = state.players.find(player => player.userId === me.id) ?? null;
  const myTeam = meState?.team ?? 'blue';
  const leftPlayers = state.players.filter(player => player.team === myTeam);
  const rightPlayers = state.players.filter(player => player.team !== myTeam);
  const selected = selectedHeroId || meState?.selection.heroId || state.availableHeroIds[0] || null;
  const selectedDefinition = selected && hasHeroDefinition(selected) ? getHeroDefinition(selected) : null;
  const selectedAbilities = abilitiesForHero(selected);
  const selectedCombatProfile = selectedDefinition?.combatProfile;
  const isLocked = Boolean(meState?.selection.locked);
  const filteredHeroes = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return state.availableHeroIds.filter(heroId => !needle || (HERO_NAMES[heroId] || heroId).toLowerCase().includes(needle));
  }, [search, state.availableHeroIds]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (meState?.selection.heroId) setSelectedHeroId(meState.selection.heroId);
  }, [meState?.selection.heroId]);

  useEffect(() => {
    if (!meState || meState.selection.heroId || !selectedHeroId || meState.selection.locked || state.phase === 'complete') return;
    platformRealtime.send('hero_select.preview', { heroId: selectedHeroId });
  }, [meState, selectedHeroId, state.phase]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (leaveConfirmOpen) {
        setLeaveConfirmOpen(false);
        setLeaveError('');
      } else {
        setLeaveConfirmOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [leaveConfirmOpen]);

  const leaveHeroSelect = () => {
    setLeaveError('');
    setLeaving(true);
    if (!platformRealtime.send('hero_select.cancel')) {
      setLeaving(false);
      setLeaveError('Realtime connection unavailable. Could not leave Hero Select.');
    }
  };

  const chooseHero = (heroId: string) => {
    if (isLocked || state.phase === 'complete') return;
    setSelectedHeroId(heroId);
    platformRealtime.send('hero_select.preview', { heroId });
  };

  const lockHero = () => {
    if (!selected || isLocked || state.phase === 'complete') return;
    platformRealtime.send('hero_select.lock', { heroId: selected });
  };

  const title = state.match.mode === 'ranked'
    ? 'RANKED DRAFT'
    : state.match.mode === 'custom'
      ? state.selectionType === 'draft' ? 'CUSTOM DRAFT' : 'CUSTOM · ALL PICK'
      : 'NORMAL · ALL PICK';

  return <main className="dr-hero-select-screen">
    <div className="dr-hero-select-backdrop" aria-hidden="true" />

    <header className="dr-hero-select-header">
      <div className="dr-hero-select-brand">
        <img src="/assets/icon/dawnreach.png" alt="" draggable={false} />
        <div><strong>DAWNREACH</strong><small>A BRIGHTER TOMORROW</small></div>
      </div>

      <BansStrip side="ally" count={state.bansPerTeam} />

      <div className="dr-hero-select-phase">
        <img
          className="dr-hero-select-phase-ornament"
          src="/assets/images/filigrana_dorada_simetrica_sobre_transparente.webp"
          alt=""
          draggable={false}
          aria-hidden="true"
        />
        <strong>{title}</strong>
        <small>{state.phase === 'complete' ? 'SELECTION COMPLETE' : 'PICK PHASE'}</small>
        <time>{state.phase === 'complete' ? '00:00' : formatClock(state.expiresAt - now)}</time>
      </div>

      <BansStrip side="enemy" count={state.bansPerTeam} />

      <div className="dr-hero-select-motto">
        <span>DIFFERENT HEROES.</span>
        <strong>A BRIGHTER TOMORROW.</strong>
      </div>

      <button
        type="button"
        className="dr-hero-select-exit-trigger"
        onClick={() => { setLeaveError(''); setLeaveConfirmOpen(true); }}
        aria-label="Leave Hero Select"
      >
        <LogOut />
        <span>LEAVE</span>
        <kbd>ESC</kbd>
      </button>
    </header>

    <section className="dr-hero-select-body">
      <TeamColumn team={myTeam} players={leftPlayers} me={me} side="left" />

      <section className="dr-hero-select-focus">
        <div className="dr-hero-select-hero-copy">
          <blockquote>
            <span>{selected === SERYN.id ? '“DISTANCE REVEALS THE PATH.' : '“STRENGTH BUILDS WALLS.'}</span>
            <strong>{selected === SERYN.id ? 'I ONLY HAVE TO FIND THE LINE.”' : 'BUT HOPE BUILDS WORLDS.”'}</strong>
          </blockquote>
          <div className="dr-hero-select-name">
            <h1>{selected ? HERO_NAMES[selected] || selected : 'CHOOSE A HERO'}</h1>
            <p>{selected ? heroSubtitle(selected) : 'DAWNREACH HERO'}</p>
            {selectedDefinition && <div>
              <span>{selectedDefinition.primaryRole.toUpperCase()}</span>
              {selectedDefinition.deploymentPreferences?.primary.map(lane => <span key={lane}>{lane}</span>)}
            </div>}
          </div>
        </div>

        {selected && <img className="dr-hero-select-main-art" src={heroFocusArt(selected)} alt={HERO_NAMES[selected] || selected} draggable={false} />}

        <aside className="dr-hero-select-overview">
          <nav><button type="button" className="is-active">OVERVIEW</button><button type="button" disabled>SKINS</button></nav>
          <p>{selectedDefinition?.lore ?? 'Select a hero to inspect their battlefield identity.'}</p>
          <div className="dr-hero-select-abilities">
            {selectedAbilities.map(ability => <article
              key={ability.key}
              className="dr-hero-select-ability"
              tabIndex={0}
              aria-label={`${ability.label} · ${ability.name}`}
              onMouseEnter={event => setAbilityTooltip({ ability, anchor: event.currentTarget.getBoundingClientRect() })}
              onMouseLeave={() => setAbilityTooltip(null)}
              onFocus={event => setAbilityTooltip({ ability, anchor: event.currentTarget.getBoundingClientRect() })}
              onBlur={() => setAbilityTooltip(null)}
            >
              <img src={ability.art} alt="" draggable={false} />
              <small>{ability.label}</small>
              <span>{ability.name}</span>
            </article>)}
          </div>
          {abilityTooltip && <AbilityTooltipOverlay ability={abilityTooltip.ability} anchor={abilityTooltip.anchor} />}
          <div className="dr-hero-select-ratings">
            <label><span>DURABILITY</span><i><b style={{ width: `${percentForPowerBand(selectedCombatProfile?.durability)}%` }} /></i></label>
            <label><span>DAMAGE</span><i><b style={{ width: `${percentForPowerBand(selectedCombatProfile?.sustainedDamage)}%` }} /></i></label>
            <label><span>MOBILITY</span><i><b style={{ width: `${percentForPowerBand(selectedCombatProfile?.mobility)}%` }} /></i></label>
            <label><span>CONTROL</span><i><b style={{ width: `${percentForPowerBand(selectedCombatProfile?.control)}%` }} /></i></label>
          </div>
        </aside>

        <button
          type="button"
          className={`dr-hero-select-lock${isLocked ? ' is-locked' : ''}`}
          disabled={!selected || isLocked || state.phase === 'complete'}
          onClick={lockHero}
        >
          {isLocked ? <><Check /> LOCKED IN</> : state.phase === 'complete' ? 'PREPARING MATCH' : 'LOCK IN'}
        </button>

        {state.rosterDevelopmentMode && <div className="dr-hero-select-dev-note">
          DEVELOPMENT ROSTER · duplicate heroes temporarily allowed until Dawnreach has enough heroes for unique team picks.
        </div>}
        {state.draftRulesDeferred && <div className="dr-hero-select-draft-note">
          Draft bans are visually reserved while the playable roster is still below the required unique-pick size.
        </div>}
      </section>

      <TeamColumn team={myTeam === 'blue' ? 'red' : 'blue'} players={rightPlayers} me={me} side="right" />
    </section>

    <footer className="dr-hero-select-footer">
      <HeroSelectChat state={state} me={me} />

      <section className="dr-hero-select-roster">
        <header>
          <div className="dr-hero-select-roster-tabs"><button className="is-active" type="button">ALL</button><button type="button" disabled>NORTH</button><button type="button" disabled>MID</button><button type="button" disabled>SOUTH</button></div>
          <label><Search /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search heroes…" /></label>
        </header>
        <div>
          {filteredHeroes.map(heroId => <button
            type="button"
            key={heroId}
            className={`${selected === heroId ? 'is-selected' : ''}${meState?.selection.heroId === heroId && isLocked ? ' is-locked' : ''}`}
            disabled={isLocked}
            onClick={() => chooseHero(heroId)}
          >
            <img src={heroSelectionArt(heroId)} alt="" draggable={false} />
            <span>{HERO_NAMES[heroId] || heroId}</span>
          </button>)}
        </div>
      </section>

      <aside className="dr-hero-select-footer-art">
        <Swords />
        <span>SAME SKIES.</span>
        <strong>NEW LEGENDS.</strong>
      </aside>
    </footer>

    {leaveConfirmOpen && createPortal(
      <div className="dr-hero-select-leave-backdrop" role="presentation" onMouseDown={event => {
        if (event.target === event.currentTarget && !leaving) {
          setLeaveConfirmOpen(false);
          setLeaveError('');
        }
      }}>
        <section className="dr-hero-select-leave-dialog" role="dialog" aria-modal="true" aria-labelledby="hero-select-leave-title">
          <button
            type="button"
            className="dr-hero-select-leave-close"
            onClick={() => { if (!leaving) { setLeaveConfirmOpen(false); setLeaveError(''); } }}
            aria-label="Close"
            disabled={leaving}
          >
            <X />
          </button>
          <div className="dr-hero-select-leave-icon"><TriangleAlert /></div>
          <small>{state.match.source === 'custom' ? 'CUSTOM MATCH' : state.match.mode === 'ranked' ? 'RANKED MATCH' : 'NORMAL MATCH'}</small>
          <h2 id="hero-select-leave-title">LEAVE HERO SELECT?</h2>
          <p>{state.match.source === 'custom'
            ? 'The current launch will be cancelled. The other players will return to the custom lobby and you will leave that lobby.'
            : 'Leaving now cancels this match for every player. You will return to the Play screen.'}</p>
          {state.match.mode === 'ranked' && <p className="dr-hero-select-leave-warning">Competitive abandonment penalties can be applied here once the penalty system is enabled.</p>}
          {leaveError && <p className="dr-hero-select-leave-error">{leaveError}</p>}
          <div className="dr-hero-select-leave-actions">
            <button
              type="button"
              className="is-cancel"
              disabled={leaving}
              onClick={() => { setLeaveConfirmOpen(false); setLeaveError(''); }}
            >
              STAY
            </button>
            <button type="button" className="is-leave" disabled={leaving} onClick={leaveHeroSelect}>
              <LogOut />
              {leaving ? 'LEAVING…' : state.match.source === 'custom' ? 'LEAVE LOBBY' : 'ABANDON MATCH'}
            </button>
          </div>
        </section>
      </div>,
      document.body,
    )}
  </main>;
}
