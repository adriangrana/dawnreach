import * as THREE from 'three';
import { ensureLaneCreepSystem } from '../gameplay/laneCreeps';
import { TOWER_GAMEPLAY } from '../gameplay/towerConfig';
import { attachEntityOverhead } from './entityOverheads';

export type TeamId = 'blue' | 'red' | 'neutral';
export type GameEntityKind = 'hero' | 'creep' | 'tower' | 'building' | 'shop' | 'jungle-creature';
export type EntityInteraction = 'unit' | 'attackable-structure' | 'shop' | 'structure' | 'none';
export type EntityVisibilityPolicy = 'always' | 'vision-only' | 'structure-in-fog';

export const VISION_RANGES = {
  hero: 12.5,
  creep: 8,
  tower: TOWER_GAMEPLAY.vision.radius,
  building: 11,
  shop: 9,
  jungleCreature: 0,
} as const;

export const ATTACK_RANGES = {
  tower: TOWER_GAMEPLAY.attack.range,
} as const;

export const ENTITY_MAX_HP = {
  creep: 550,
  tower: TOWER_GAMEPLAY.maxHp,
  throne: 5000,
  jungleCreature: 900,
} as const;

export type GameEntityDefinition = Readonly<{
  id?: string;
  displayName: string;
  kind: GameEntityKind;
  team: TeamId;
  selectable?: boolean;
  targetable?: boolean;
  grantsVision?: boolean;
  visionRadius?: number;
  visionHeight?: number;
  attackRange?: number;
  visibilityPolicy?: EntityVisibilityPolicy;
  interaction?: EntityInteraction;
  selectionRadius?: number;
  maxHp?: number;
  currentHp?: number;
  showHealthBar?: boolean;
  definitionId?: string | null;
  level?: number;
  maxResource?: number;
  currentResource?: number;
  alive?: boolean;
}>;

export type GameEntity = {
  readonly id: string;
  readonly root: THREE.Object3D;
  displayName: string;
  kind: GameEntityKind;
  team: TeamId;
  selectable: boolean;
  targetable: boolean;
  grantsVision: boolean;
  visionRadius: number;
  visionHeight: number;
  attackRange: number;
  visibilityPolicy: EntityVisibilityPolicy;
  interaction: EntityInteraction;
  selectionRadius: number;
  maxHp: number;
  currentHp: number;
  showHealthBar: boolean;
  definitionId: string | null;
  level: number;
  maxResource: number;
  currentResource: number;
  alive: boolean;
  revealed: boolean;
};

const ENTITY_KEY = 'dawnreachEntity';

function defaultVisionRadius(kind: GameEntityKind) {
  switch (kind) {
    case 'hero': return VISION_RANGES.hero;
    case 'creep': return VISION_RANGES.creep;
    case 'tower': return VISION_RANGES.tower;
    case 'building': return VISION_RANGES.building;
    case 'shop': return VISION_RANGES.shop;
    case 'jungle-creature': return VISION_RANGES.jungleCreature;
  }
}

function defaultAttackRange(kind: GameEntityKind) {
  return kind === 'tower' ? ATTACK_RANGES.tower : 0;
}

function defaultMaxHp(kind: GameEntityKind) {
  switch (kind) {
    case 'creep': return ENTITY_MAX_HP.creep;
    case 'tower': return ENTITY_MAX_HP.tower;
    case 'jungle-creature': return ENTITY_MAX_HP.jungleCreature;
    default: return 0;
  }
}

function defaultShowHealthBar(kind: GameEntityKind) {
  return kind === 'hero' || kind === 'creep' || kind === 'tower' || kind === 'jungle-creature';
}

function defaultSelectionRadius(kind: GameEntityKind) {
  switch (kind) {
    case 'hero': return 0.78;
    case 'creep': return 0.62;
    case 'tower': return 1.5;
    case 'building': return 2.1;
    case 'shop': return 1.55;
    case 'jungle-creature': return 0.72;
  }
}

function defaultInteraction(kind: GameEntityKind): EntityInteraction {
  switch (kind) {
    case 'hero':
    case 'creep':
    case 'jungle-creature':
      return 'unit';
    case 'tower':
      return 'attackable-structure';
    case 'shop':
      return 'shop';
    case 'building':
      return 'structure';
  }
}

function defaultVisibilityPolicy(kind: GameEntityKind): EntityVisibilityPolicy {
  switch (kind) {
    case 'tower':
    case 'building':
    case 'shop':
      return 'structure-in-fog';
    default:
      return 'vision-only';
  }
}

export function registerGameEntity(root: THREE.Object3D, definition: GameEntityDefinition): GameEntity {
  const existing = root.userData[ENTITY_KEY] as GameEntity | undefined;
  if (existing) return existing;

  const maxHp = Math.max(0, definition.maxHp ?? defaultMaxHp(definition.kind));
  const currentHp = THREE.MathUtils.clamp(definition.currentHp ?? maxHp, 0, maxHp);
  const entity: GameEntity = {
    id: definition.id ?? `${definition.kind}:${root.name || 'entity'}:${root.uuid}`,
    root,
    displayName: definition.displayName,
    kind: definition.kind,
    team: definition.team,
    selectable: definition.selectable ?? true,
    targetable: definition.targetable ?? definition.team !== 'neutral',
    grantsVision: definition.grantsVision ?? definition.team !== 'neutral',
    visionRadius: Math.max(0, definition.visionRadius ?? defaultVisionRadius(definition.kind)),
    visionHeight: Math.max(0, definition.visionHeight ?? 1.5),
    attackRange: Math.max(0, definition.attackRange ?? defaultAttackRange(definition.kind)),
    visibilityPolicy: definition.visibilityPolicy ?? defaultVisibilityPolicy(definition.kind),
    interaction: definition.interaction ?? defaultInteraction(definition.kind),
    selectionRadius: Math.max(0.2, definition.selectionRadius ?? defaultSelectionRadius(definition.kind)),
    maxHp,
    currentHp,
    showHealthBar: definition.showHealthBar ?? defaultShowHealthBar(definition.kind),
    definitionId: definition.definitionId ?? null,
    level: Math.max(1, Math.floor(definition.level ?? 1)),
    maxResource: Math.max(0, definition.maxResource ?? 0),
    currentResource: Math.max(0, definition.currentResource ?? 0),
    alive: definition.alive ?? true,
    revealed: definition.team !== 'red',
  };

  root.userData[ENTITY_KEY] = entity;
  root.userData.selectable = entity.selectable;
  root.userData.visionRadius = entity.visionRadius;
  root.userData.attackRange = entity.attackRange;
  root.userData.maxHp = entity.maxHp;
  root.userData.currentHp = entity.currentHp;
  attachEntityOverhead(entity);
  return entity;
}

export function getGameEntity(object: THREE.Object3D | null): GameEntity | null {
  let current = object;
  while (current) {
    const entity = current.userData[ENTITY_KEY] as GameEntity | undefined;
    if (entity) return entity;
    current = current.parent;
  }
  return null;
}

function findSceneRoot(root: THREE.Object3D) {
  let current: THREE.Object3D = root;
  while (current.parent) current = current.parent;
  return current instanceof THREE.Scene ? current : null;
}

export class GameEntityRegistry {
  private readonly byRoot = new Map<THREE.Object3D, GameEntity>();
  private laneCreepSystemStarted = false;

  register(root: THREE.Object3D, definition: GameEntityDefinition) {
    const entity = registerGameEntity(root, definition);
    this.byRoot.set(root, entity);

    if (!this.laneCreepSystemStarted && entity.kind === 'hero' && (entity.team === 'blue' || entity.team === 'red')) {
      const scene = findSceneRoot(root);
      if (scene) {
        this.laneCreepSystemStarted = true;
        ensureLaneCreepSystem(scene, this);
      }
    }

    return entity;
  }

  registerExisting(entity: GameEntity) {
    this.byRoot.set(entity.root, entity);
    return entity;
  }

  unregister(root: THREE.Object3D) {
    const entity = this.byRoot.get(root);
    if (!entity) return false;
    this.byRoot.delete(root);
    delete root.userData[ENTITY_KEY];
    return true;
  }

  values() {
    return Array.from(this.byRoot.values());
  }

  selectable() {
    return this.values().filter(entity => entity.selectable && entity.alive);
  }

  visionSources(team: TeamId) {
    return this.values().filter(entity => entity.team === team && entity.alive && entity.grantsVision && entity.visionRadius > 0);
  }
}

function titleCaseName(name: string) {
  return name
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function teamFromName(name: string): TeamId | null {
  if (name.startsWith('blue-')) return 'blue';
  if (name.startsWith('red-')) return 'red';
  return null;
}

export function registerAuthoredMapEntities(registry: GameEntityRegistry, battlefield: THREE.Object3D) {
  battlefield.traverse((object) => {
    if (!(object instanceof THREE.Group)) return;
    const name = object.name.toLowerCase();
    const team = teamFromName(name);
    if (!team) return;

    if (name === `${team}-throne`) {
      registry.register(object, {
        id: `${team}-throne`,
        displayName: `${team === 'blue' ? 'Blue' : 'Red'} Throne`,
        kind: 'building',
        team,
        selectable: true,
        targetable: team === 'red',
        grantsVision: true,
        visionRadius: VISION_RANGES.building,
        visionHeight: 5.2,
        attackRange: 0,
        selectionRadius: 4.25,
        maxHp: ENTITY_MAX_HP.throne,
        currentHp: ENTITY_MAX_HP.throne,
        showHealthBar: true,
        visibilityPolicy: 'structure-in-fog',
        interaction: 'attackable-structure',
      });
      return;
    }

    if (name.endsWith('-tower') || name === `${team}-defense-tower`) {
      registry.register(object, {
        displayName: titleCaseName(name),
        kind: 'tower',
        team,
        selectable: true,
        targetable: team === 'red',
        grantsVision: true,
        visionRadius: TOWER_GAMEPLAY.vision.radius,
        visionHeight: TOWER_GAMEPLAY.vision.height,
        attackRange: TOWER_GAMEPLAY.attack.range,
        maxHp: TOWER_GAMEPLAY.maxHp,
        currentHp: TOWER_GAMEPLAY.maxHp,
        level: TOWER_GAMEPLAY.level,
        definitionId: 'defense-tower',
        showHealthBar: true,
        visibilityPolicy: 'structure-in-fog',
        interaction: 'attackable-structure',
      });
      return;
    }

    if (name === `${team}-base`) {
      registry.register(object, {
        displayName: titleCaseName(name),
        kind: 'building',
        team,
        selectable: true,
        targetable: team === 'red',
        grantsVision: true,
        visionRadius: VISION_RANGES.building,
        visionHeight: 5,
        attackRange: 0,
        maxHp: 0,
        showHealthBar: false,
        visibilityPolicy: 'structure-in-fog',
        interaction: 'structure',
      });
    }
  });
}
