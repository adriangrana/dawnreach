import * as THREE from 'three';
import type { GameEntity, GameEntityKind, GameEntityRegistry } from './gameEntities';

const heroIcons = import.meta.glob<string>('../heroes/*/images/*I.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

type OverlayRecord = {
  readonly entity: GameEntity;
  readonly sprite: THREE.Sprite;
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly texture: THREE.CanvasTexture;
  readonly material: THREE.SpriteMaterial;
  readonly anchorHeight: number;
  readonly worldWidth: number;
  lastSignature: string;
  icon: HTMLImageElement | null;
  iconPath: string | undefined;
  dirty: boolean;
};

export type EntityOverheadController = Readonly<{
  readonly group: THREE.Group;
  update(): void;
  dispose(): void;
}>;

function worldBarWidth(kind: GameEntityKind) {
  switch (kind) {
    case 'hero': return 4.8;
    case 'creep': return 2.15;
    case 'tower': return 3.35;
    case 'building': return 4.35;
    case 'shop': return 3.25;
    case 'jungle-creature': return 2.45;
  }
}

function healthSegments(kind: GameEntityKind) {
  switch (kind) {
    case 'tower': return 10;
    case 'building': return 12;
    case 'creep': return 5;
    case 'jungle-creature': return 6;
    default: return 6;
  }
}

function isVisibleInHierarchy(object: THREE.Object3D) {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (!current.visible) return false;
    current = current.parent;
  }
  return true;
}

function resourceFraction(current: number, maximum: number) {
  if (!Number.isFinite(current) || !Number.isFinite(maximum) || maximum <= 0) return 0;
  return THREE.MathUtils.clamp(current / maximum, 0, 1);
}

function createOverlayRecord(group: THREE.Group, entity: GameEntity): OverlayRecord {
  const hero = entity.kind === 'hero';
  const canvas = document.createElement('canvas');
  canvas.width = hero ? 440 : 320;
  canvas.height = hero ? 88 : 48;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.name = `${entity.id}-overhead`;
  sprite.renderOrder = 95;
  const worldWidth = worldBarWidth(entity.kind);
  sprite.scale.set(worldWidth, worldWidth * canvas.height / canvas.width, 1);
  sprite.visible = false;
  group.add(sprite);

  entity.root.updateWorldMatrix(true, true);
  const rootPosition = new THREE.Vector3();
  entity.root.getWorldPosition(rootPosition);
  const bounds = new THREE.Box3().setFromObject(entity.root);
  const visibleHeight = bounds.isEmpty()
    ? entity.visionHeight
    : Math.max(entity.visionHeight, bounds.max.y - rootPosition.y);
  const anchorHeight = visibleHeight + (hero ? 0.48 : 0.58);

  return {
    entity,
    sprite,
    canvas,
    ctx,
    texture,
    material,
    anchorHeight,
    worldWidth,
    lastSignature: '',
    icon: null,
    iconPath: undefined,
    dirty: true,
  };
}

function drawHeroFrame(record: OverlayRecord) {
  const { entity, ctx, canvas } = record;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const frame = ctx.createLinearGradient(0, 8, 0, 72);
  frame.addColorStop(0, '#fafafa');
  frame.addColorStop(1, '#9caaa7');
  ctx.fillStyle = frame;
  ctx.beginPath();
  ctx.moveTo(48, 8);
  ctx.lineTo(436, 8);
  ctx.lineTo(436, 68);
  ctx.lineTo(276, 68);
  ctx.lineTo(canvas.width / 2, 82);
  ctx.lineTo(164, 68);
  ctx.lineTo(48, 68);
  ctx.closePath();
  ctx.fill();

  drawHeroHealth(ctx, entity.currentHp, entity.maxHp);
  drawHeroResource(ctx, entity.currentResource, entity.maxResource);
  drawHeroLevel(ctx, entity.level);

  if (record.icon?.complete && record.icon.naturalWidth > 0) {
    const size = Math.min(80 / record.icon.naturalWidth, 80 / record.icon.naturalHeight);
    const width = record.icon.naturalWidth * size;
    const height = record.icon.naturalHeight * size;
    ctx.drawImage(record.icon, (80 - width) / 2, (80 - height) / 2, width, height);
  } else {
    ctx.font = 'bold 38px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(entity.displayName.charAt(0) || '?', 38, 40);
  }
}

function drawHeroLevel(ctx: CanvasRenderingContext2D, level: number) {
  ctx.font = 'bold 38px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#080b09';
  ctx.fillText(String(Math.max(1, Math.floor(level))), 406, 40, 50);
}

function drawHeroResource(
  ctx: CanvasRenderingContext2D,
  resource: number,
  maxResource: number,
) {
  ctx.fillStyle = '#050805';
  ctx.fillRect(78, 46, 302, 18);
  ctx.fillStyle = '#14213a';
  ctx.fillRect(82, 49, 294, 11);
  ctx.fillStyle = '#367eff';
  ctx.fillRect(82, 49, 294 * resourceFraction(resource, maxResource), 11);
}

function drawHeroHealth(ctx: CanvasRenderingContext2D, hp: number, maxHp: number) {
  ctx.fillStyle = '#050805';
  ctx.fillRect(78, 12, 302, 37);
  ctx.fillStyle = '#1c2916';
  ctx.fillRect(82, 16, 294, 29);
  const health = ctx.createLinearGradient(0, 16, 0, 45);
  health.addColorStop(0, '#83e844');
  health.addColorStop(1, '#46c526');
  ctx.fillStyle = health;
  ctx.fillRect(82, 16, 294 * resourceFraction(hp, maxHp), 29);
  ctx.fillStyle = 'rgba(5, 30, 4, 0.4)';
  for (let segment = 1; segment < 3; segment++) {
    ctx.fillRect(82 + 294 * segment / 3, 16, 2, 29);
  }
}

function drawHealthOnlyFrame(record: OverlayRecord) {
  const { entity, ctx, canvas } = record;
  const fraction = resourceFraction(entity.currentHp, entity.maxHp);
  const segments = healthSegments(entity.kind);

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Restrained metallic frame: readable at MOBA camera height without becoming a second UI panel.
  const frame = ctx.createLinearGradient(0, 4, 0, 44);
  frame.addColorStop(0, '#dbe2df');
  frame.addColorStop(0.48, '#879590');
  frame.addColorStop(1, '#3b4542');
  ctx.fillStyle = 'rgba(5, 8, 7, 0.82)';
  roundRect(ctx, 4, 6, 312, 36, 6);
  ctx.fill();
  ctx.fillStyle = frame;
  roundRect(ctx, 7, 9, 306, 30, 4);
  ctx.fill();

  ctx.fillStyle = '#101710';
  roundRect(ctx, 11, 13, 298, 22, 2);
  ctx.fill();

  const fillWidth = 294 * fraction;
  if (fillWidth > 0) {
    const health = ctx.createLinearGradient(0, 14, 0, 34);
    if (fraction > 0.5) {
      health.addColorStop(0, '#90eb52');
      health.addColorStop(1, '#43b92d');
    } else if (fraction > 0.25) {
      health.addColorStop(0, '#f0cf55');
      health.addColorStop(1, '#c59128');
    } else {
      health.addColorStop(0, '#f26759');
      health.addColorStop(1, '#b72f28');
    }
    ctx.fillStyle = health;
    ctx.fillRect(13, 15, fillWidth, 18);
  }

  // Fine subdivisions give structures/creeps an at-a-glance damage read without text.
  ctx.fillStyle = 'rgba(4, 12, 5, 0.38)';
  for (let segment = 1; segment < segments; segment++) {
    const x = 13 + 294 * segment / segments;
    ctx.fillRect(x, 15, 1.25, 18);
  }

  // Tiny team accent along the upper edge keeps ownership readable without adding labels.
  ctx.fillStyle = entity.team === 'blue'
    ? 'rgba(74, 194, 255, 0.9)'
    : entity.team === 'red'
      ? 'rgba(255, 96, 82, 0.9)'
      : 'rgba(233, 195, 89, 0.9)';
  ctx.fillRect(15, 11, 290, 2);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function heroIconPath(entity: GameEntity) {
  if (!entity.definitionId) return undefined;
  return heroIcons[`../heroes/${entity.displayName.toLowerCase()}/images/${entity.definitionId}I.png`];
}

function refreshHeroIcon(record: OverlayRecord) {
  const nextPath = heroIconPath(record.entity);
  if (nextPath === record.iconPath) return;

  if (record.icon) record.icon.onload = record.icon.onerror = null;
  record.iconPath = nextPath;
  record.icon = null;
  record.dirty = true;

  if (!nextPath) return;
  const icon = new Image();
  icon.onload = icon.onerror = () => { record.dirty = true; };
  icon.src = nextPath;
  record.icon = icon;
}

function signature(entity: GameEntity) {
  if (entity.kind === 'hero') {
    return [
      entity.displayName,
      entity.definitionId ?? '',
      entity.level,
      entity.currentHp,
      entity.maxHp,
      entity.currentResource,
      entity.maxResource,
    ].join('|');
  }
  return `${entity.currentHp}|${entity.maxHp}|${entity.team}`;
}

export function createEntityOverheadController(
  scene: THREE.Scene,
  registry: GameEntityRegistry,
  canReveal: (entity: GameEntity) => boolean = entity => entity.revealed,
): EntityOverheadController {
  const group = new THREE.Group();
  group.name = 'entity-overheads';
  scene.add(group);

  const records = new Map<string, OverlayRecord>();
  const worldPosition = new THREE.Vector3();

  const ensureRecord = (entity: GameEntity) => {
    const existing = records.get(entity.id);
    if (existing) return existing;
    if (!entity.showHealthBar) return null;
    const record = createOverlayRecord(group, entity);
    records.set(entity.id, record);
    return record;
  };

  const update = () => {
    for (const entity of registry.values()) {
      if (!entity.showHealthBar) continue;
      const record = ensureRecord(entity);
      if (!record) continue;

      const visible = entity.alive
        && entity.maxHp > 0
        && isVisibleInHierarchy(entity.root)
        && (entity.team === 'blue' || canReveal(entity));
      record.sprite.visible = visible;
      if (!visible) continue;

      entity.root.getWorldPosition(worldPosition);
      record.sprite.position.set(
        worldPosition.x,
        worldPosition.y + record.anchorHeight,
        worldPosition.z,
      );

      if (entity.kind === 'hero') refreshHeroIcon(record);
      const nextSignature = signature(entity);
      if (!record.dirty && record.lastSignature === nextSignature) continue;
      record.lastSignature = nextSignature;
      record.dirty = false;

      if (entity.kind === 'hero') drawHeroFrame(record);
      else drawHealthOnlyFrame(record);
      record.texture.needsUpdate = true;
    }
  };

  return {
    group,
    update,
    dispose() {
      for (const record of records.values()) {
        if (record.icon) record.icon.onload = record.icon.onerror = null;
        record.texture.dispose();
        record.material.dispose();
      }
      records.clear();
      scene.remove(group);
    },
  };
}
