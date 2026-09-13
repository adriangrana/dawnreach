import { getTowerAbility } from '../gameplay/towerConfig';
import type { GameEntity } from './gameEntities';
import { getTowerAuraState } from './towerAuras';
import { getWorldEntityRuntime, type WorldStatusRuntimeSnapshot } from './worldCombatBridge';

export type EntityStatusTone = 'positive' | 'negative' | 'neutral';

export type EntityStatusView = Readonly<{
  id: string;
  name: string;
  description: string;
  tone: EntityStatusTone;
  icon: string;
  stacks?: number;
  rank?: number;
  durationLeftMs?: number | null;
  sourceLabel?: string;
}>;

export type AuthoredEntityStatusView = EntityStatusView & Readonly<{
  expiresAtMs?: number | null;
}>;

const EXTERNAL_STATUS_KEY = 'dawnreachExternalStatusViews';

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function numberData(status: WorldStatusRuntimeSnapshot, key: string): number | null {
  const value = status.data?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function runtimeStatusView(status: WorldStatusRuntimeSnapshot, atMs: number): EntityStatusView | null {
  const durationLeftMs = status.expiresAtMs == null
    ? null
    : Math.max(0, status.expiresAtMs - atMs);
  if (durationLeftMs != null && durationLeftMs <= 0) return null;

  const common = {
    id: status.id,
    rank: status.rank,
    stacks: status.stacks,
    durationLeftMs,
    sourceLabel: status.sourceEntityId ? 'Habilidad de héroe' : undefined,
  } satisfies Partial<EntityStatusView>;

  if (status.id.startsWith('cc:slow:')) {
    const slow = numberData(status, 'slowPercent');
    return {
      ...common,
      id: status.id,
      name: 'Ralentizado',
      description: slow === null
        ? 'La velocidad de movimiento está reducida temporalmente.'
        : `La velocidad de movimiento está reducida un ${Math.round(slow)}%.`,
      tone: 'negative',
      icon: 'slow',
    };
  }

  if (status.id.startsWith('cc:stun:')) {
    return {
      ...common,
      id: status.id,
      name: 'Aturdido',
      description: 'No puede actuar mientras dure el aturdimiento.',
      tone: 'negative',
      icon: 'stun',
    };
  }

  if (status.id.startsWith('cc:taunt:')) {
    return {
      ...common,
      id: status.id,
      name: 'Provocado',
      description: 'Está bajo una provocación y su prioridad de combate está forzada temporalmente.',
      tone: 'negative',
      icon: 'taunt',
    };
  }

  if (status.id === 'alden:guard') {
    return {
      ...common,
      id: status.id,
      name: 'Guardia de la Puerta',
      description: 'Alden mantiene una guardia frontal que reduce el daño directo recibido desde el frente.',
      tone: 'positive',
      icon: 'guard',
    };
  }

  if (status.id === 'alden:reprisal') {
    return {
      ...common,
      id: status.id,
      name: 'Represalia',
      description: 'El siguiente ataque básico puede consumir Represalia para infligir daño adicional y aturdir.',
      tone: 'positive',
      icon: 'reprisal',
    };
  }

  if (status.id === 'alden:majesty') {
    return {
      ...common,
      id: status.id,
      name: 'Majestad de Hierro',
      description: 'Alden recibe menos daño, gana tenacidad y puede acelerar la recuperación de sus habilidades básicas.',
      tone: 'positive',
      icon: 'majesty',
    };
  }

  if (status.id.startsWith('alden:judged:')) {
    return {
      ...common,
      id: status.id,
      name: 'Juzgado',
      description: 'Objetivo marcado por Juicio del León Coronado.',
      tone: 'negative',
      icon: 'judged',
    };
  }

  const negative = status.id.startsWith('cc:') || status.id.includes('debuff');
  return {
    ...common,
    id: status.id,
    name: status.id
      .split(':')
      .pop()!
      .split('-')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' '),
    description: 'Estado temporal activo sobre esta entidad.',
    tone: negative ? 'negative' : 'neutral',
    icon: negative ? 'debuff' : 'status',
  };
}

function towerAuraViews(entity: GameEntity): EntityStatusView[] {
  const aura = getTowerAuraState(entity);
  const views: EntityStatusView[] = [];
  const reinforced = getTowerAbility('reinforced');
  const backdoor = getTowerAbility('backdoor-protection');

  if (aura.reinforced && reinforced) {
    const sourceCount = aura.sourceTowerIds.length;
    views.push({
      id: 'tower-aura:reinforced',
      name: reinforced.name,
      description: reinforced.description,
      tone: 'positive',
      icon: 'reinforced',
      rank: reinforced.level,
      sourceLabel: sourceCount > 0
        ? `${sourceCount} torre${sourceCount === 1 ? '' : 's'} aliada${sourceCount === 1 ? '' : 's'}`
        : 'Aura de torre',
    });
  }

  if (aura.backdoorProtection && backdoor) {
    const sourceCount = aura.backdoorSourceTowerIds.length;
    views.push(aura.backdoorActive ? {
      id: 'tower-aura:backdoor-protection',
      name: backdoor.name,
      description: backdoor.description,
      tone: 'positive',
      icon: 'backdoor-protection',
      rank: backdoor.level,
      sourceLabel: sourceCount > 0
        ? `${sourceCount} torre${sourceCount === 1 ? '' : 's'} aliada${sourceCount === 1 ? '' : 's'}`
        : 'Aura de torre',
    } : {
      id: 'tower-aura:backdoor-suppressed',
      name: 'Protección de retaguardia anulada',
      description: 'Hay creeps enemigos dentro del radio de supresión. La reducción de daño y la regeneración de la protección de retaguardia están desactivadas.',
      tone: 'negative',
      icon: 'backdoor-suppressed',
      rank: backdoor.level,
      sourceLabel: 'Supresión por creeps enemigos',
    });
  }

  return views;
}

function externalViews(entity: GameEntity, atMs: number): EntityStatusView[] {
  const authored = entity.root.userData[EXTERNAL_STATUS_KEY] as readonly AuthoredEntityStatusView[] | undefined;
  if (!Array.isArray(authored)) return [];
  return authored
    .filter(status => status.expiresAtMs == null || status.expiresAtMs > atMs)
    .map(status => ({
      id: status.id,
      name: status.name,
      description: status.description,
      tone: status.tone,
      icon: status.icon,
      stacks: status.stacks,
      rank: status.rank,
      durationLeftMs: status.expiresAtMs == null ? null : Math.max(0, status.expiresAtMs - atMs),
      sourceLabel: status.sourceLabel,
    }));
}

export function setEntityExternalStatusViews(
  entity: GameEntity,
  statuses: readonly AuthoredEntityStatusView[],
): void {
  entity.root.userData[EXTERNAL_STATUS_KEY] = statuses.map(status => ({ ...status }));
}

export function clearEntityExternalStatusViews(entity: GameEntity): void {
  delete entity.root.userData[EXTERNAL_STATUS_KEY];
}

export function getEntityStatusViews(entity: GameEntity | null, atMs = nowMs()): readonly EntityStatusView[] {
  if (!entity) return [];

  const merged = new Map<string, EntityStatusView>();
  for (const status of towerAuraViews(entity)) merged.set(status.id, status);

  const runtime = getWorldEntityRuntime(entity.id);
  for (const status of runtime?.statuses ?? []) {
    const view = runtimeStatusView(status, atMs);
    if (view) merged.set(view.id, view);
  }

  for (const status of externalViews(entity, atMs)) merged.set(status.id, status);

  return [...merged.values()].sort((a, b) => {
    const priority = (tone: EntityStatusTone) => tone === 'negative' ? 0 : tone === 'positive' ? 1 : 2;
    return priority(a.tone) - priority(b.tone) || a.name.localeCompare(b.name);
  });
}

export function getEntityStatusSignature(entity: GameEntity | null, atMs = nowMs()): string {
  return getEntityStatusViews(entity, atMs)
    .map(status => [
      status.id,
      status.tone,
      status.stacks ?? 0,
      status.rank ?? 0,
      status.durationLeftMs == null ? 'inf' : Math.ceil(status.durationLeftMs / 1000),
    ].join(':'))
    .join('|');
}
