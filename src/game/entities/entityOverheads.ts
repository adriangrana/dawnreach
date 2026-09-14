import * as THREE from 'three';
import type { GameEntity, GameEntityKind, TeamId } from './gameEntities';

const heroIcons = import.meta.glob<string>('../heroes/*/images/*I.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

function worldBarWidth(kind: GameEntityKind) {
  switch (kind) {
    case 'hero': return 4.8;
    case 'creep': return 1.82;
    case 'tower': return 3.15;
    case 'building': return 4.0;
    case 'shop': return 3.0;
    case 'jungle-creature': return 2.18;
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

function resourceFraction(current: number, maximum: number) {
  if (!Number.isFinite(current) || !Number.isFinite(maximum) || maximum <= 0) return 0;
  return THREE.MathUtils.clamp(current / maximum, 0, 1);
}

function healthPalette(team: TeamId) {
  switch (team) {
    case 'blue':
      return { top: '#8aeb4b', bottom: '#43bb29', dark: '#1c2916' };
    case 'red':
      return { top: '#ff6559', bottom: '#c52f2a', dark: '#30110f' };
    case 'neutral':
      return { top: '#efcf57', bottom: '#c5922e', dark: '#30270f' };
  }
}

function drawHeroHealth(
  ctx: CanvasRenderingContext2D,
  hp: number,
  maxHp: number,
  team: TeamId,
) {
  const palette = healthPalette(team);
  ctx.fillStyle = '#050805';
  ctx.fillRect(78, 12, 302, 37);
  ctx.fillStyle = palette.dark;
  ctx.fillRect(82, 16, 294, 29);
  const health = ctx.createLinearGradient(0, 16, 0, 45);
  health.addColorStop(0, palette.top);
  health.addColorStop(1, palette.bottom);
  ctx.fillStyle = health;
  ctx.fillRect(82, 16, 294 * resourceFraction(hp, maxHp), 29);
  ctx.fillStyle = team === 'red'
    ? 'rgba(45, 4, 4, 0.42)'
    : team === 'neutral'
      ? 'rgba(45, 32, 4, 0.42)'
      : 'rgba(5, 30, 4, 0.4)';
  for (let segment = 1; segment < 3; segment++) {
    ctx.fillRect(82 + 294 * segment / 3, 16, 2, 29);
  }
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

function drawHeroLevel(ctx: CanvasRenderingContext2D, level: number) {
  ctx.font = 'bold 38px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#080b09';
  ctx.fillText(String(Math.max(1, Math.floor(level))), 406, 40, 50);
}

function drawHeroFrame(
  entity: GameEntity,
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  icon: HTMLImageElement | null,
) {
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

  drawHeroHealth(ctx, entity.currentHp, entity.maxHp, entity.team);
  drawHeroResource(ctx, entity.currentResource, entity.maxResource);
  drawHeroLevel(ctx, entity.level);

  if (icon?.complete && icon.naturalWidth > 0) {
    const scale = Math.min(80 / icon.naturalWidth, 80 / icon.naturalHeight);
    const width = icon.naturalWidth * scale;
    const height = icon.naturalHeight * scale;
    ctx.drawImage(icon, (80 - width) / 2, (80 - height) / 2, width, height);
  } else {
    ctx.font = 'bold 38px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(entity.displayName.charAt(0) || '?', 38, 40);
  }
}

function drawHealthOnlyFrame(
  entity: GameEntity,
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
) {
  const fraction = resourceFraction(entity.currentHp, entity.maxHp);
  const segments = healthSegments(entity.kind);
  const palette = healthPalette(entity.team);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Non-hero bars intentionally stay flat and quiet. The previous metallic shell used
  // several nested frames, which made creeps and structures visually heavier than their
  // actual gameplay importance. Keep only a slim dark track, a flat team fill and very
  // subtle segment ticks. The hero overhead remains untouched above.
  const x = 5;
  const y = entity.kind === 'creep' ? 9 : 8;
  const width = canvas.width - 10;
  const height = entity.kind === 'creep' ? 10 : 10;

  ctx.fillStyle = 'rgba(3, 7, 8, 0.82)';
  ctx.fillRect(x, y, width, height);

  const innerX = x + 1;
  const innerY = y + 1;
  const innerWidth = width - 2;
  const innerHeight = height - 2;
  ctx.fillStyle = palette.dark;
  ctx.fillRect(innerX, innerY, innerWidth, innerHeight);

  const fillWidth = innerWidth * fraction;
  if (fillWidth > 0) {
    ctx.fillStyle = entity.team === 'blue'
      ? '#55c936'
      : entity.team === 'red'
        ? '#d7473e'
        : '#cea83c';
    ctx.fillRect(innerX, innerY, fillWidth, innerHeight);

    // A one-pixel highlight keeps the fill readable without reintroducing a bevel/frame.
    ctx.fillStyle = entity.team === 'blue'
      ? 'rgba(154, 238, 91, 0.42)'
      : entity.team === 'red'
        ? 'rgba(255, 119, 106, 0.42)'
        : 'rgba(247, 214, 95, 0.42)';
    ctx.fillRect(innerX, innerY, fillWidth, 1);
  }

  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  for (let segment = 1; segment < segments; segment++) {
    const sx = innerX + innerWidth * segment / segments;
    ctx.fillRect(sx, innerY, 1, innerHeight);
  }
}

function entitySignature(entity: GameEntity) {
  if (entity.kind === 'hero') {
    return [
      entity.displayName,
      entity.definitionId ?? '',
      entity.level,
      entity.currentHp,
      entity.maxHp,
      entity.currentResource,
      entity.maxResource,
      entity.team,
    ].join('|');
  }
  return `${entity.currentHp}|${entity.maxHp}|${entity.team}`;
}

function heroIconPath(entity: GameEntity) {
  if (!entity.definitionId) return undefined;
  return heroIcons[`../heroes/${entity.displayName.toLowerCase()}/images/${entity.definitionId}I.png`];
}

/**
 * Attaches world-space status UI directly to an entity. The sprite self-updates before
 * rendering, so future creeps/fauna/towers gain bars as soon as they are registered.
 * Existing hero overlays are respected to avoid duplicating Alden's current HUD.
 */
export function attachEntityOverhead(entity: GameEntity) {
  if (!entity.showHealthBar || entity.maxHp <= 0) return;

  if (entity.kind === 'hero' && entity.root.getObjectByName('hero-status-overlay')) return;

  const overheadName = `${entity.id}-overhead`;
  if (entity.root.getObjectByName(overheadName)) return;

  const hero = entity.kind === 'hero';
  const canvas = document.createElement('canvas');
  canvas.width = hero ? 440 : 320;
  canvas.height = hero ? 88 : 28;
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
    opacity: 1,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.name = overheadName;
  sprite.renderOrder = 95;

  entity.root.updateWorldMatrix(true, true);
  const rootPosition = new THREE.Vector3();
  const worldScale = new THREE.Vector3();
  entity.root.getWorldPosition(rootPosition);
  entity.root.getWorldScale(worldScale);
  const bounds = new THREE.Box3().setFromObject(entity.root);
  const visibleWorldHeight = bounds.isEmpty()
    ? entity.visionHeight
    : Math.max(entity.visionHeight, bounds.max.y - rootPosition.y);
  const margin = hero ? 0.48 : entity.kind === 'creep' ? 0.34 : 0.46;
  const safeScaleX = Math.max(0.001, Math.abs(worldScale.x));
  const safeScaleY = Math.max(0.001, Math.abs(worldScale.y));
  const worldWidth = worldBarWidth(entity.kind);
  const worldHeight = worldWidth * canvas.height / canvas.width;
  sprite.position.set(0, (visibleWorldHeight + margin) / safeScaleY, 0);
  sprite.scale.set(worldWidth / safeScaleX, worldHeight / safeScaleY, 1);

  let lastSignature = '';
  let icon: HTMLImageElement | null = null;
  let iconPath: string | undefined;
  let dirty = true;

  const ensureIcon = () => {
    if (!hero) return;
    const nextPath = heroIconPath(entity);
    if (nextPath === iconPath) return;
    if (icon) icon.onload = icon.onerror = null;
    iconPath = nextPath;
    icon = null;
    dirty = true;
    if (!nextPath) return;
    icon = new Image();
    icon.onload = icon.onerror = () => { dirty = true; };
    icon.src = nextPath;
  };

  const redraw = () => {
    ensureIcon();
    const nextSignature = entitySignature(entity);
    if (!dirty && nextSignature === lastSignature) return;
    lastSignature = nextSignature;
    dirty = false;
    if (hero) drawHeroFrame(entity, ctx, canvas, icon);
    else drawHealthOnlyFrame(entity, ctx, canvas);
    texture.needsUpdate = true;
  };

  redraw();
  sprite.onBeforeRender = (_renderer, _scene, camera) => {
    // Overhead UI belongs to the gameplay camera, not the top-down minimap render.
    const minimapCamera = camera.position.y > 60 && camera.up.z < -0.5;
    const revealed = entity.team === 'blue' || entity.revealed;
    material.opacity = !minimapCamera && revealed && entity.alive && entity.maxHp > 0 ? 1 : 0;
    if (material.opacity > 0) redraw();
  };

  entity.root.add(sprite);
}
