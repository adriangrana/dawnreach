import * as THREE from 'three';
import { subscribeWorldCombatEvents, type WorldCombatEvent } from './worldCombatBridge';
import type { GameEntity } from './gameEntities';

type FloatingCombatEntity = GameEntity;

type CombatTextKind = 'outgoing' | 'incoming';

type FloatingLabel = {
  sprite: THREE.Sprite;
  material: THREE.SpriteMaterial;
  texture: THREE.CanvasTexture;
  startMs: number;
  durationMs: number;
  origin: THREE.Vector3;
  driftX: number;
  driftZ: number;
  rise: number;
  baseWidth: number;
  baseHeight: number;
  lethal: boolean;
  finished: boolean;
};

const entitiesById = new Map<string, FloatingCombatEntity>();
const lastHpById = new Map<string, number>();
const TMP_WORLD = new THREE.Vector3();
const CANVAS_WIDTH = 512;
const CANVAS_HEIGHT = 160;
const LOCAL_HERO_ID = 'blue-hero-alden';
let fallbackLocalHeroId: string | null = null;
let serial = 0;

export function registerFloatingCombatEntity(entity: FloatingCombatEntity): void {
  entitiesById.set(entity.id, entity);
  lastHpById.set(entity.id, entity.currentHp);
  if (entity.id === LOCAL_HERO_ID) fallbackLocalHeroId = entity.id;
  else if (!fallbackLocalHeroId && entity.kind === 'hero' && entity.team === 'blue') fallbackLocalHeroId = entity.id;
}

export function unregisterFloatingCombatEntity(entity: FloatingCombatEntity): void {
  if (entitiesById.get(entity.id) === entity) {
    entitiesById.delete(entity.id);
    lastHpById.delete(entity.id);
  }
}

function currentLocalHeroId(): string | null {
  if (entitiesById.has(LOCAL_HERO_ID)) return LOCAL_HERO_ID;
  if (fallbackLocalHeroId && entitiesById.has(fallbackLocalHeroId)) return fallbackLocalHeroId;
  for (const entity of entitiesById.values()) {
    if (entity.kind === 'hero' && entity.team === 'blue') {
      fallbackLocalHeroId = entity.id;
      return entity.id;
    }
  }
  return null;
}

function handleCombatEvent(event: WorldCombatEvent): void {
  const target = entitiesById.get(event.entityId);
  if (!target) return;

  const previousHp = lastHpById.get(event.entityId) ?? target.currentHp;
  const fallbackDamage = Math.max(0, previousHp - event.currentHp);
  lastHpById.set(event.entityId, event.currentHp);

  if (event.reason !== 'damage' && event.reason !== 'death') return;

  const amount = Math.max(0, event.amount ?? fallbackDamage);
  if (amount <= 0.001) return;

  const localHeroId = currentLocalHeroId();
  if (!localHeroId) return;

  const incoming = event.entityId === localHeroId;
  const outgoing = event.sourceEntityId === localHeroId && event.entityId !== localHeroId;
  if (!incoming && !outgoing) return;

  spawnFloatingLabel(target, amount, incoming ? 'incoming' : 'outgoing', event.reason === 'death');
}

function spawnFloatingLabel(
  target: FloatingCombatEntity,
  amount: number,
  kind: CombatTextKind,
  lethal: boolean,
): void {
  const worldRoot = findWorldRoot(target.root);
  if (!worldRoot) return;

  target.root.getWorldPosition(TMP_WORLD);
  const origin = TMP_WORLD.clone();
  origin.y += labelLift(target);

  const { texture, aspect } = createDamageTexture(amount, kind, lethal);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.name = `floating-combat-text-${kind}`;
  sprite.renderOrder = 320;
  sprite.frustumCulled = false;
  sprite.position.copy(origin);

  const lane = serial++ % 5;
  const centeredLane = lane - 2;
  const baseHeight = lethal ? 1.10 : 0.92;
  const baseWidth = baseHeight * aspect;
  const label: FloatingLabel = {
    sprite,
    material,
    texture,
    startMs: performance.now(),
    durationMs: lethal ? 1120 : kind === 'incoming' ? 1040 : 960,
    origin,
    driftX: centeredLane * 0.075,
    driftZ: ((serial % 3) - 1) * 0.035,
    rise: lethal ? 1.55 : 1.32,
    baseWidth,
    baseHeight,
    lethal,
    finished: false,
  };

  sprite.scale.set(baseWidth * 0.72, baseHeight * 0.72, 1);
  sprite.onBeforeRender = (_renderer, _scene, camera) => updateFloatingLabel(label, camera);
  worldRoot.add(sprite);
}

function updateFloatingLabel(label: FloatingLabel, camera: THREE.Camera): void {
  if (label.finished) return;

  // The top-down minimap uses a Z-up orientation. Combat text belongs only to the
  // playable camera, otherwise large numbers would flash over the minimap as well.
  if (Math.abs(camera.up.y) < 0.5) {
    label.material.opacity = 0;
    return;
  }

  const progress = THREE.MathUtils.clamp((performance.now() - label.startMs) / label.durationMs, 0, 1);
  if (progress >= 1) {
    label.finished = true;
    label.sprite.visible = false;
    queueMicrotask(() => disposeFloatingLabel(label));
    return;
  }

  const eased = 1 - Math.pow(1 - progress, 3);
  const popProgress = THREE.MathUtils.clamp(progress / 0.16, 0, 1);
  const pop = popProgress < 0.68
    ? THREE.MathUtils.lerp(0.72, label.lethal ? 1.18 : 1.10, popProgress / 0.68)
    : THREE.MathUtils.lerp(label.lethal ? 1.18 : 1.10, 1, (popProgress - 0.68) / 0.32);
  const fadeIn = THREE.MathUtils.smoothstep(progress, 0, 0.08);
  const fadeOut = 1 - THREE.MathUtils.smoothstep(progress, 0.66, 1);
  const opacity = fadeIn * fadeOut;

  label.sprite.position.set(
    label.origin.x + label.driftX * eased,
    label.origin.y + label.rise * eased + Math.sin(progress * Math.PI) * 0.08,
    label.origin.z + label.driftZ * eased,
  );
  label.sprite.scale.set(label.baseWidth * pop, label.baseHeight * pop, 1);
  label.material.opacity = opacity;
}

function disposeFloatingLabel(label: FloatingLabel): void {
  label.sprite.onBeforeRender = () => {};
  label.sprite.removeFromParent();
  label.material.dispose();
  label.texture.dispose();
}

function createDamageTexture(amount: number, kind: CombatTextKind, lethal: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable for floating combat text');

  const value = Math.max(1, Math.round(amount));
  const label = kind === 'incoming' ? `−${value}` : `${value}`;
  const fontSize = lethal ? 92 : kind === 'incoming' ? 82 : 78;
  const font = `900 ${fontSize}px "Trebuchet MS", "Segoe UI", sans-serif`;

  context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = font;
  context.lineJoin = 'round';
  context.miterLimit = 2;

  if (lethal) drawLethalOrnaments(context, kind);

  const gradient = context.createLinearGradient(0, 38, 0, 125);
  if (kind === 'incoming') {
    gradient.addColorStop(0, '#fff0ec');
    gradient.addColorStop(0.38, '#ffaaa1');
    gradient.addColorStop(1, '#ff625b');
    context.shadowColor = 'rgba(224, 44, 37, 0.62)';
  } else {
    gradient.addColorStop(0, '#fffbea');
    gradient.addColorStop(0.44, '#f3df9d');
    gradient.addColorStop(1, '#d8aa53');
    context.shadowColor = 'rgba(225, 170, 67, 0.52)';
  }

  context.shadowBlur = lethal ? 25 : 18;
  context.shadowOffsetY = 2;
  context.strokeStyle = kind === 'incoming' ? 'rgba(49, 8, 8, 0.96)' : 'rgba(31, 23, 8, 0.96)';
  context.lineWidth = lethal ? 13 : 11;
  context.strokeText(label, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 3);

  context.fillStyle = gradient;
  context.fillText(label, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 3);

  context.shadowBlur = 0;
  context.shadowOffsetY = 0;
  context.strokeStyle = kind === 'incoming' ? 'rgba(255, 235, 231, 0.34)' : 'rgba(255, 250, 219, 0.38)';
  context.lineWidth = 1.5;
  context.strokeText(label, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 1.5);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  return { texture, aspect: CANVAS_WIDTH / CANVAS_HEIGHT };
}

function drawLethalOrnaments(context: CanvasRenderingContext2D, kind: CombatTextKind): void {
  const color = kind === 'incoming' ? 'rgba(255, 112, 103, 0.72)' : 'rgba(235, 196, 104, 0.72)';
  const centerY = CANVAS_HEIGHT / 2 + 3;
  context.save();
  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(54, centerY);
  context.lineTo(132, centerY);
  context.moveTo(CANVAS_WIDTH - 132, centerY);
  context.lineTo(CANVAS_WIDTH - 54, centerY);
  context.stroke();

  for (const x of [44, CANVAS_WIDTH - 44]) {
    context.save();
    context.translate(x, centerY);
    context.rotate(Math.PI / 4);
    context.fillRect(-4, -4, 8, 8);
    context.restore();
  }
  context.restore();
}

function labelLift(entity: FloatingCombatEntity): number {
  switch (entity.kind) {
    case 'hero': return 2.55;
    case 'creep': return 1.35;
    case 'tower': return Math.max(3.3, entity.visionHeight * 0.72);
    case 'building': return Math.max(2.8, entity.visionHeight * 0.62);
    case 'shop': return 2.35;
    case 'jungle-creature': return 1.8;
  }
}

function findWorldRoot(object: THREE.Object3D): THREE.Object3D | null {
  let current: THREE.Object3D | null = object;
  while (current?.parent) current = current.parent;
  return current;
}

subscribeWorldCombatEvents(handleCombatEvent);
