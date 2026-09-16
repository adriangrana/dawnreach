import * as THREE from 'three';
import type { GameEntity, GameEntityRegistry } from '../../entities/gameEntities';
import type { AbilityKey } from '../types';
import { ALDEN } from './gameplay';

const GAME_UNIT_TO_WORLD = 0.01;
const Q_DASH_RANGE = ALDEN.q.dashRange * GAME_UNIT_TO_WORLD;
const Q_CLEAVE_RANGE = ALDEN.q.cleaveRange * GAME_UNIT_TO_WORLD;
const E_RADIUS = ALDEN.e.activeRadius * GAME_UNIT_TO_WORLD;
const R_RADIUS = ALDEN.r.radius * GAME_UNIT_TO_WORLD;
const W_PRESENTATION_RANGE = 1.75;
const GROUND_Y = 0.075;

const BLUE = 0x53d6ff;
const BLUE_BRIGHT = 0xdcf8ff;
const BLUE_GLOW = 0x2db8ff;
const GOLD = 0xe7bd66;
const GOLD_BRIGHT = 0xfff0b8;
const GUARD_BLUE = 0x8de6ff;
const JUDGEMENT_GOLD = 0xffd27a;

const RANGE_BY_ABILITY: Record<AbilityKey, number> = {
  Q: Q_DASH_RANGE,
  W: W_PRESENTATION_RANGE,
  E: E_RADIUS,
  R: R_RADIUS,
};

type AbilityPoseKey = AbilityKey;

type AbilityPose = {
  key: AbilityPoseKey;
  startedAtMs: number;
  durationMs: number;
};

type Joints = {
  model: THREE.Object3D | null;
  pelvis: THREE.Object3D | null;
  torso: THREE.Object3D | null;
  leftShoulder: THREE.Object3D | null;
  rightShoulder: THREE.Object3D | null;
  leftElbow: THREE.Object3D | null;
  rightElbow: THREE.Object3D | null;
  wrist: THREE.Object3D | null;
};

type FxEntry = {
  root: THREE.Object3D;
  materials: THREE.Material[];
  startedAtMs: number;
  durationMs: number;
  update?: (t: number, nowMs: number) => void;
};

type ScheduledFx = {
  atMs: number;
  run: () => void;
};

type RangeVisual = {
  root: THREE.Group;
  fillMaterial: THREE.MeshBasicMaterial;
  haloMaterial: THREE.MeshBasicMaterial;
  edgeMaterial: THREE.MeshBasicMaterial;
};

const installed = new WeakMap<THREE.Scene, AldenAbilityPresentation>();
const active = new Set<AldenAbilityPresentation>();

function material(color: number, opacity: number, additive = true) {
  const value = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    toneMapped: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  value.polygonOffset = true;
  value.polygonOffsetFactor = -1;
  value.polygonOffsetUnits = -2;
  return value;
}

function addHorizontalRing(
  parent: THREE.Object3D,
  innerRadius: number,
  outerRadius: number,
  ringMaterial: THREE.MeshBasicMaterial,
  renderOrder: number,
  y = 0,
) {
  const mesh = new THREE.Mesh(new THREE.RingGeometry(innerRadius, outerRadius, 96), ringMaterial);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;
  mesh.renderOrder = renderOrder;
  parent.add(mesh);
  return mesh;
}

/** Uses the same layered fill/halo/edge language as entitySelection's attack-range indicator. */
function buildRangeVisual(): RangeVisual {
  const root = new THREE.Group();
  root.name = 'alden-ability-hover-range';
  root.visible = false;

  const fillMaterial = material(BLUE_GLOW, 0.018, true);
  const fill = new THREE.Mesh(new THREE.CircleGeometry(1, 128), fillMaterial);
  fill.rotation.x = -Math.PI / 2;
  fill.position.y = 0.006;
  fill.renderOrder = 70;
  root.add(fill);

  const haloMaterial = material(BLUE_GLOW, 0.085, true);
  addHorizontalRing(root, 0.972, 1.0, haloMaterial, 71, 0.010);

  const edgeMaterial = material(BLUE_BRIGHT, 0.42, false);
  addHorizontalRing(root, 0.994, 1.0, edgeMaterial, 72, 0.014);

  return { root, fillMaterial, haloMaterial, edgeMaterial };
}

function createArcRibbonGeometry(innerRadius: number, outerRadius: number, angleDegrees: number, segments = 42) {
  const half = THREE.MathUtils.degToRad(angleDegrees * 0.5);
  const positions: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index <= segments; index++) {
    const angle = THREE.MathUtils.lerp(-half, half, index / segments);
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    positions.push(
      sin * innerRadius, 0, cos * innerRadius,
      sin * outerRadius, 0, cos * outerRadius,
    );
    if (index < segments) {
      const base = index * 2;
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createArcWallGeometry(radius: number, angleDegrees: number, height: number, segments = 48) {
  const half = THREE.MathUtils.degToRad(angleDegrees * 0.5);
  const positions: number[] = [];
  const indices: number[] = [];
  for (let index = 0; index <= segments; index++) {
    const angle = THREE.MathUtils.lerp(-half, half, index / segments);
    const x = Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;
    positions.push(x, 0.08, z, x, height, z);
    if (index < segments) {
      const base = index * 2;
      indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function yawFromDirection(direction: THREE.Vector2) {
  return Math.atan2(direction.x, direction.y);
}

function isAbilityKey(value: string | undefined): value is AbilityKey {
  return value === 'Q' || value === 'W' || value === 'E' || value === 'R';
}

export function ensureAldenAbilityPresentation(
  scene: THREE.Scene,
  registry: GameEntityRegistry,
  hero: GameEntity,
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
) {
  let presentation = installed.get(scene);
  if (!presentation) {
    presentation = new AldenAbilityPresentation(scene, registry, hero, canvas, camera);
    installed.set(scene, presentation);
    active.add(presentation);
  } else {
    presentation.setCamera(camera);
  }
  return presentation;
}

export function disposeAldenAbilityPresentations() {
  for (const presentation of [...active]) presentation.dispose();
  active.clear();
}

class AldenAbilityPresentation {
  private readonly effects: FxEntry[] = [];
  private readonly scheduled: ScheduledFx[] = [];
  private readonly cooldownWasActive = new Map<AbilityKey, boolean>();
  private readonly pointerNdc = new THREE.Vector2();
  private readonly raycaster = new THREE.Raycaster();
  private readonly commandSurfaces: THREE.Mesh[] = [];
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly hitPoint = new THREE.Vector3();
  private readonly tempA = new THREE.Vector3();
  private readonly tempB = new THREE.Vector3();
  private readonly joints: Joints;
  private readonly rangeVisual = buildRangeVisual();

  private camera: THREE.Camera;
  private pointerSeen = false;
  private hoverKey: AbilityKey | null = null;
  private pose: AbilityPose | null = null;
  private disposed = false;
  private cameraShakeUntilMs = 0;
  private cameraShakeAmplitude = 0;
  private readonly observer: MutationObserver;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly registry: GameEntityRegistry,
    private readonly hero: GameEntity,
    private readonly canvas: HTMLCanvasElement,
    camera: THREE.Camera,
  ) {
    this.camera = camera;
    scene.traverse(object => {
      if (object instanceof THREE.Mesh && object.userData.commandSurface) this.commandSurfaces.push(object);
    });
    this.joints = this.resolveJoints();
    scene.add(this.rangeVisual.root);

    this.canvas.addEventListener('pointermove', this.onPointerMove, { passive: true });
    document.addEventListener('mouseover', this.onAbilityMouseOver, true);
    document.addEventListener('mouseout', this.onAbilityMouseOut, true);

    this.observer = new MutationObserver(this.onHudMutation);
    this.observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-cooldown'],
    });
    this.captureCooldownState();
  }

  setCamera(camera: THREE.Camera) {
    this.camera = camera;
  }

  update(nowMs: number) {
    if (this.disposed) return;
    this.runScheduled(nowMs);
    this.updateRangeVisual(nowMs);
    this.updateEffects(nowMs);
    this.applyPresentationPose(nowMs);
    this.applyCameraShake(nowMs);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    document.removeEventListener('mouseover', this.onAbilityMouseOver, true);
    document.removeEventListener('mouseout', this.onAbilityMouseOut, true);
    this.observer.disconnect();
    this.rangeVisual.root.removeFromParent();
    this.disposeObject(this.rangeVisual.root, [
      this.rangeVisual.fillMaterial,
      this.rangeVisual.haloMaterial,
      this.rangeVisual.edgeMaterial,
    ]);
    for (const effect of [...this.effects]) this.disposeEffect(effect);
    this.effects.length = 0;
    this.scheduled.length = 0;
    active.delete(this);
  }

  private readonly onPointerMove = (event: PointerEvent) => {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.pointerNdc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.pointerSeen = true;
  };

  private readonly onAbilityMouseOver = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    const control = target?.closest<HTMLElement>('.ability-control[data-ability]') ?? null;
    if (!control) return;
    if (event.relatedTarget instanceof Node && control.contains(event.relatedTarget)) return;
    const key = control.dataset.ability;
    if (!isAbilityKey(key)) return;
    this.hoverKey = key;
  };

  private readonly onAbilityMouseOut = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    const control = target?.closest<HTMLElement>('.ability-control[data-ability]') ?? null;
    if (!control) return;
    if (event.relatedTarget instanceof Node && control.contains(event.relatedTarget)) return;
    const key = control.dataset.ability;
    if (isAbilityKey(key) && this.hoverKey === key) this.hoverKey = null;
  };

  private captureCooldownState() {
    for (const key of Object.keys(RANGE_BY_ABILITY) as AbilityKey[]) {
      const button = this.getAbilityButton(key);
      this.cooldownWasActive.set(key, Number(button?.dataset.cooldown ?? 0) > 1);
    }
  }

  private readonly onHudMutation = (mutations: MutationRecord[]) => {
    for (const mutation of mutations) {
      const button = mutation.target;
      if (!(button instanceof HTMLButtonElement) || !button.classList.contains('ability-slot')) continue;
      const key = button.closest<HTMLElement>('.ability-control')?.dataset.ability;
      if (!isAbilityKey(key)) continue;
      const cooling = Number(button.dataset.cooldown ?? 0) > 1;
      const wasCooling = this.cooldownWasActive.get(key) ?? false;
      this.cooldownWasActive.set(key, cooling);
      if (wasCooling || !cooling || !this.hero.alive || this.hero.currentHp <= 0) continue;
      this.presentCast(key, performance.now());
    }
  };

  private getAbilityButton(key: AbilityKey) {
    return document.querySelector<HTMLButtonElement>(`.ability-control[data-ability="${key}"] .ability-slot`);
  }

  private presentCast(key: AbilityKey, nowMs: number) {
    switch (key) {
      case 'Q': this.presentQ(nowMs); break;
      case 'W': this.presentW(nowMs); break;
      case 'E': this.presentE(nowMs); break;
      case 'R': this.presentR(nowMs); break;
    }
  }

  private presentQ(nowMs: number) {
    const direction = this.resolveAimDirection();
    const yaw = yawFromDirection(direction);
    const start = this.hero.root.getWorldPosition(new THREE.Vector3());
    const end = start.clone().add(new THREE.Vector3(direction.x * Q_DASH_RANGE, 0, direction.y * Q_DASH_RANGE));
    const center = start.clone().lerp(end, 0.5);

    this.pose = { key: 'Q', startedAtMs: nowMs, durationMs: 470 };

    const root = new THREE.Group();
    root.name = 'alden-q-crown-advance-trail';
    root.position.set(center.x, start.y + GROUND_Y, center.z);
    root.rotation.y = yaw;
    const mats = [material(BLUE_GLOW, 0.22), material(GOLD_BRIGHT, 0.24)];

    const outer = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.012, Q_DASH_RANGE), mats[0]);
    outer.position.y = 0.01;
    root.add(outer);
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.018, Q_DASH_RANGE * 0.92), mats[1]);
    core.position.y = 0.026;
    root.add(core);
    this.scene.add(root);
    this.addFx(root, mats, 310, (t) => {
      root.scale.x = 1 + t * 0.7;
      for (const mat of mats) mat.opacity *= 0.90;
    }, nowMs);

    this.spawnSparks(start, direction, BLUE_BRIGHT, 12, 380, nowMs, 1.15);

    this.scheduled.push({
      atMs: nowMs + ALDEN.q.castTimeSeconds * 1000,
      run: () => {
        const heroWorld = this.hero.root.getWorldPosition(new THREE.Vector3());
        this.spawnSlashArc(heroWorld, yaw, Q_CLEAVE_RANGE, BLUE, GOLD_BRIGHT, 430, nowMs + ALDEN.q.castTimeSeconds * 1000);
        this.spawnShockwave(heroWorld, Q_CLEAVE_RANGE * 0.72, BLUE_GLOW, 360, 0.48);
        for (const target of this.findEnemiesInCone(Q_CLEAVE_RANGE, ALDEN.q.cleaveAngleDegrees, direction)) {
          this.spawnTargetImpact(target, BLUE_BRIGHT, GOLD, 420);
        }
        this.kickCameraShake(0.055, 150);
      },
    });
  }

  private presentW(nowMs: number) {
    const yaw = this.currentFacingYaw();
    this.pose = { key: 'W', startedAtMs: nowMs, durationMs: ALDEN.w.guardDurationSeconds * 1000 };

    const root = new THREE.Group();
    root.name = 'alden-w-guard-aegis';
    root.rotation.y = yaw;
    const mats = [
      material(GUARD_BLUE, 0.16),
      material(BLUE_BRIGHT, 0.60, false),
      material(GOLD_BRIGHT, 0.40),
    ];

    const wall = new THREE.Mesh(createArcWallGeometry(W_PRESENTATION_RANGE, ALDEN.w.guardArcDegrees, 2.4), mats[0]);
    wall.renderOrder = 56;
    root.add(wall);
    const groundArc = new THREE.Mesh(createArcRibbonGeometry(1.52, 1.78, ALDEN.w.guardArcDegrees), mats[1]);
    groundArc.position.y = 0.03;
    groundArc.renderOrder = 57;
    root.add(groundArc);

    const runeCount = 7;
    const half = THREE.MathUtils.degToRad(ALDEN.w.guardArcDegrees * 0.5);
    for (let index = 0; index < runeCount; index++) {
      const angle = THREE.MathUtils.lerp(-half, half, index / (runeCount - 1));
      const rune = new THREE.Mesh(new THREE.OctahedronGeometry(0.075), mats[2]);
      rune.position.set(Math.sin(angle) * 1.68, 0.65 + (index % 2) * 0.22, Math.cos(angle) * 1.68);
      rune.scale.y = 1.45;
      root.add(rune);
    }

    this.scene.add(root);
    this.addFx(root, mats, ALDEN.w.guardDurationSeconds * 1000, (t, frameNow) => {
      const world = this.hero.root.getWorldPosition(this.tempA);
      root.position.set(world.x, world.y + GROUND_Y, world.z);
      root.rotation.y = this.currentFacingYaw();
      const pulse = 0.94 + Math.sin(frameNow * 0.012) * 0.035;
      root.scale.setScalar(pulse);
      mats[0].opacity = (1 - t * 0.25) * 0.16;
    }, nowMs);
  }

  private presentE(nowMs: number) {
    this.pose = { key: 'E', startedAtMs: nowMs, durationMs: 620 };
    const center = this.hero.root.getWorldPosition(new THREE.Vector3());

    const root = new THREE.Group();
    root.name = 'alden-e-iron-cadence-sweep';
    root.position.set(center.x, center.y + GROUND_Y, center.z);
    const mats = [material(GOLD, 0.48), material(GOLD_BRIGHT, 0.62), material(BLUE_GLOW, 0.18)];

    const arcA = new THREE.Mesh(createArcRibbonGeometry(E_RADIUS * 0.52, E_RADIUS * 0.58, 205, 56), mats[0]);
    arcA.position.y = 0.04;
    root.add(arcA);
    const arcB = new THREE.Mesh(createArcRibbonGeometry(E_RADIUS * 0.72, E_RADIUS * 0.76, 155, 48), mats[1]);
    arcB.position.y = 0.07;
    arcB.rotation.y = Math.PI;
    root.add(arcB);
    addHorizontalRing(root, E_RADIUS * 0.94, E_RADIUS, mats[2], 47, 0.02);

    this.scene.add(root);
    this.addFx(root, mats, 620, (t) => {
      root.rotation.y = t * Math.PI * 2.25;
      root.scale.setScalar(0.82 + t * 0.28);
      mats[0].opacity = 0.48 * (1 - t);
      mats[1].opacity = 0.62 * (1 - t * 0.85);
      mats[2].opacity = 0.18 * (1 - t);
    }, nowMs);

    this.spawnSparks(center, new THREE.Vector2(1, 0), GOLD_BRIGHT, 18, 520, nowMs, 2.0, true);
    this.spawnShockwave(center, E_RADIUS, GOLD, 500, 0.66);
    for (const target of this.findEnemiesInRadius(E_RADIUS)) this.spawnTargetImpact(target, GOLD_BRIGHT, BLUE, 430);
    this.kickCameraShake(0.035, 120);
  }

  private presentR(nowMs: number) {
    const castMs = ALDEN.r.castTimeSeconds * 1000;
    this.pose = { key: 'R', startedAtMs: nowMs, durationMs: 980 };

    const telegraph = new THREE.Group();
    telegraph.name = 'alden-r-judgement-telegraph';
    const mats = [material(JUDGEMENT_GOLD, 0.20), material(GOLD_BRIGHT, 0.58), material(BLUE_GLOW, 0.10)];
    addHorizontalRing(telegraph, R_RADIUS * 0.965, R_RADIUS, mats[0], 48, 0.02);
    addHorizontalRing(telegraph, R_RADIUS * 0.70, R_RADIUS * 0.715, mats[2], 48, 0.025);

    const runeCount = 12;
    for (let index = 0; index < runeCount; index++) {
      const angle = index / runeCount * Math.PI * 2;
      const rune = new THREE.Mesh(new THREE.OctahedronGeometry(0.10), mats[1]);
      rune.position.set(Math.sin(angle) * R_RADIUS * 0.88, 0.055, Math.cos(angle) * R_RADIUS * 0.88);
      rune.rotation.y = angle;
      rune.scale.set(0.55, 0.16, 1.35);
      telegraph.add(rune);
    }

    this.scene.add(telegraph);
    this.addFx(telegraph, mats, castMs, (t, frameNow) => {
      const world = this.hero.root.getWorldPosition(this.tempA);
      telegraph.position.set(world.x, world.y + GROUND_Y, world.z);
      telegraph.rotation.y = frameNow * 0.00045;
      const gather = 0.94 + t * 0.06;
      telegraph.scale.setScalar(gather);
      mats[1].opacity = 0.38 + t * 0.34;
    }, nowMs);

    this.scheduled.push({
      atMs: nowMs + castMs,
      run: () => {
        const center = this.hero.root.getWorldPosition(new THREE.Vector3());
        this.spawnJudgementImpact(center, nowMs + castMs);
        for (const target of this.findEnemiesInRadius(R_RADIUS)) this.spawnTargetImpact(target, JUDGEMENT_GOLD, GOLD_BRIGHT, 620);
        this.spawnMajestyAura(nowMs + castMs);
        this.kickCameraShake(0.11, 260);
      },
    });
  }

  private spawnSlashArc(center: THREE.Vector3, yaw: number, radius: number, colorA: number, colorB: number, durationMs: number, nowMs: number) {
    const root = new THREE.Group();
    root.position.set(center.x, center.y + GROUND_Y + 0.06, center.z);
    root.rotation.y = yaw;
    const mats = [material(colorA, 0.64), material(colorB, 0.84, false)];
    const outer = new THREE.Mesh(createArcRibbonGeometry(radius * 0.44, radius, 118, 60), mats[0]);
    outer.renderOrder = 60;
    root.add(outer);
    const edge = new THREE.Mesh(createArcRibbonGeometry(radius * 0.92, radius, 118, 60), mats[1]);
    edge.position.y = 0.02;
    edge.renderOrder = 61;
    root.add(edge);
    this.scene.add(root);
    this.addFx(root, mats, durationMs, (t) => {
      root.scale.setScalar(0.86 + t * 0.30);
      root.rotation.y = yaw + (t - 0.5) * 0.22;
      mats[0].opacity = 0.64 * (1 - t);
      mats[1].opacity = 0.84 * (1 - t * 0.88);
    }, nowMs);
  }

  private spawnShockwave(center: THREE.Vector3, radius: number, color: number, durationMs: number, opacity: number) {
    const root = new THREE.Group();
    root.position.set(center.x, center.y + GROUND_Y, center.z);
    const mat = material(color, opacity);
    const ring = addHorizontalRing(root, Math.max(0.04, radius * 0.88), radius, mat, 52, 0.02);
    ring.scale.setScalar(0.25);
    this.scene.add(root);
    this.addFx(root, [mat], durationMs, (t) => {
      ring.scale.setScalar(0.25 + t * 0.95);
      mat.opacity = opacity * (1 - t);
    });
  }

  private spawnTargetImpact(target: GameEntity, colorA: number, colorB: number, durationMs: number) {
    const center = target.root.getWorldPosition(new THREE.Vector3());
    const root = new THREE.Group();
    root.position.set(center.x, center.y + GROUND_Y, center.z);
    const mats = [material(colorA, 0.82), material(colorB, 0.54)];
    addHorizontalRing(root, 0.18, Math.max(0.44, target.selectionRadius * 0.72), mats[0], 64, 0.03);

    for (let index = 0; index < 7; index++) {
      const angle = index / 7 * Math.PI * 2;
      const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.055), mats[1]);
      shard.position.set(Math.sin(angle) * 0.28, 0.18, Math.cos(angle) * 0.28);
      shard.userData.baseAngle = angle;
      root.add(shard);
    }

    this.scene.add(root);
    this.addFx(root, mats, durationMs, (t) => {
      root.scale.setScalar(0.85 + t * 0.45);
      root.children.forEach((child, index) => {
        if (index === 0) return;
        const angle = Number(child.userData.baseAngle ?? 0);
        child.position.x = Math.sin(angle) * (0.28 + t * 0.55);
        child.position.z = Math.cos(angle) * (0.28 + t * 0.55);
        child.position.y = 0.18 + Math.sin(t * Math.PI) * 0.42;
      });
      mats[0].opacity = 0.82 * (1 - t);
      mats[1].opacity = 0.54 * (1 - t);
    });
  }

  private spawnSparks(
    center: THREE.Vector3,
    direction: THREE.Vector2,
    color: number,
    count: number,
    durationMs: number,
    nowMs: number,
    spread = 1,
    radial = false,
  ) {
    const root = new THREE.Group();
    root.position.set(center.x, center.y + 0.18, center.z);
    const mat = material(color, 0.72);
    for (let index = 0; index < count; index++) {
      const spark = new THREE.Mesh(new THREE.OctahedronGeometry(0.035 + (index % 3) * 0.008), mat);
      const randomAngle = radial
        ? index / count * Math.PI * 2
        : Math.atan2(direction.x, direction.y) + (index / Math.max(1, count - 1) - 0.5) * spread;
      const speed = 0.65 + (index % 5) * 0.16;
      spark.userData.vx = Math.sin(randomAngle) * speed;
      spark.userData.vz = Math.cos(randomAngle) * speed;
      spark.userData.vy = 0.45 + (index % 4) * 0.12;
      root.add(spark);
    }
    this.scene.add(root);
    this.addFx(root, [mat], durationMs, (t) => {
      const seconds = durationMs * 0.001;
      for (const spark of root.children) {
        spark.position.x = Number(spark.userData.vx ?? 0) * seconds * t;
        spark.position.z = Number(spark.userData.vz ?? 0) * seconds * t;
        spark.position.y = Number(spark.userData.vy ?? 0) * seconds * t - 0.52 * t * t;
        spark.scale.setScalar(1 - t * 0.65);
      }
      mat.opacity = 0.72 * (1 - t);
    }, nowMs);
  }

  private spawnJudgementImpact(center: THREE.Vector3, nowMs: number) {
    const root = new THREE.Group();
    root.name = 'alden-r-judgement-impact';
    root.position.set(center.x, center.y + GROUND_Y, center.z);
    const mats = [material(JUDGEMENT_GOLD, 0.64), material(GOLD_BRIGHT, 0.42), material(BLUE_GLOW, 0.14)];

    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.72, 5.6, 28, 1, true), mats[1]);
    beam.position.y = 2.8;
    root.add(beam);
    addHorizontalRing(root, R_RADIUS * 0.18, R_RADIUS * 0.22, mats[0], 62, 0.04);
    addHorizontalRing(root, R_RADIUS * 0.74, R_RADIUS * 0.80, mats[2], 61, 0.03);

    for (let index = 0; index < 8; index++) {
      const angle = index / 8 * Math.PI * 2;
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.07, 1.8, 8, 1, true), mats[0]);
      pillar.position.set(Math.sin(angle) * R_RADIUS * 0.62, 0.9, Math.cos(angle) * R_RADIUS * 0.62);
      pillar.rotation.z = Math.sin(angle) * 0.08;
      root.add(pillar);
    }

    this.scene.add(root);
    this.addFx(root, mats, 720, (t) => {
      beam.scale.x = beam.scale.z = 0.75 + t * 0.65;
      beam.scale.y = 1 - t * 0.35;
      mats[0].opacity = 0.64 * (1 - t);
      mats[1].opacity = 0.42 * (1 - t);
      mats[2].opacity = 0.14 * (1 - t);
      root.rotation.y = t * 0.28;
    }, nowMs);
    this.spawnShockwave(center, R_RADIUS, JUDGEMENT_GOLD, 680, 0.74);
  }

  private spawnMajestyAura(nowMs: number) {
    const root = new THREE.Group();
    root.name = 'alden-r-majesty-aura';
    const mats = [material(GOLD, 0.20), material(GOLD_BRIGHT, 0.64)];
    addHorizontalRing(root, 1.28, 1.38, mats[0], 55, 0.025);
    for (let index = 0; index < 8; index++) {
      const pip = new THREE.Mesh(new THREE.OctahedronGeometry(0.055), mats[1]);
      const angle = index / 8 * Math.PI * 2;
      pip.position.set(Math.sin(angle) * 1.55, 0.18 + (index % 2) * 0.08, Math.cos(angle) * 1.55);
      pip.userData.angle = angle;
      root.add(pip);
    }
    this.scene.add(root);
    const durationMs = ALDEN.r.majestyDurationSeconds * 1000;
    this.addFx(root, mats, durationMs, (t, frameNow) => {
      const center = this.hero.root.getWorldPosition(this.tempA);
      root.position.set(center.x, center.y + GROUND_Y, center.z);
      root.rotation.y = frameNow * 0.00055;
      const pulse = 0.96 + Math.sin(frameNow * 0.008) * 0.04;
      root.scale.setScalar(pulse);
      mats[0].opacity = 0.20 * (1 - t * 0.55);
      mats[1].opacity = 0.64 * (1 - t * 0.45);
    }, nowMs);
  }

  private addFx(
    root: THREE.Object3D,
    materials: THREE.Material[],
    durationMs: number,
    update?: (t: number, nowMs: number) => void,
    startedAtMs = performance.now(),
  ) {
    this.effects.push({ root, materials, durationMs, update, startedAtMs });
  }

  private updateEffects(nowMs: number) {
    for (let index = this.effects.length - 1; index >= 0; index--) {
      const effect = this.effects[index];
      const t = THREE.MathUtils.clamp((nowMs - effect.startedAtMs) / Math.max(1, effect.durationMs), 0, 1);
      effect.update?.(t, nowMs);
      if (t < 1) continue;
      this.effects.splice(index, 1);
      this.disposeEffect(effect);
    }
  }

  private runScheduled(nowMs: number) {
    for (let index = this.scheduled.length - 1; index >= 0; index--) {
      const entry = this.scheduled[index];
      if (nowMs < entry.atMs) continue;
      this.scheduled.splice(index, 1);
      entry.run();
    }
  }

  private updateRangeVisual(nowMs: number) {
    const range = this.hoverKey ? RANGE_BY_ABILITY[this.hoverKey] : 0;
    const visible = range > 0 && this.hero.alive && this.hero.currentHp > 0;
    this.rangeVisual.root.visible = visible;
    if (!visible) return;

    const world = this.hero.root.getWorldPosition(this.tempA);
    this.rangeVisual.root.position.set(world.x, world.y + GROUND_Y, world.z);
    this.rangeVisual.root.scale.setScalar(range);
    const pulse = (Math.sin(nowMs * 0.0016) + 1) * 0.5;
    this.rangeVisual.fillMaterial.opacity = 0.014 + pulse * 0.008;
    this.rangeVisual.haloMaterial.opacity = 0.072 + pulse * 0.026;
    this.rangeVisual.edgeMaterial.opacity = 0.36 + pulse * 0.10;
  }

  private resolveAimDirection() {
    const heroWorld = this.hero.root.getWorldPosition(this.tempA);
    if (this.pointerSeen) {
      this.raycaster.setFromCamera(this.pointerNdc, this.camera);
      const surface = this.raycaster.intersectObjects(this.commandSurfaces, false)[0];
      const hit = surface?.point ?? this.raycaster.ray.intersectPlane(this.groundPlane, this.hitPoint);
      if (hit) {
        const dx = hit.x - heroWorld.x;
        const dz = hit.z - heroWorld.z;
        const length = Math.hypot(dx, dz);
        if (length > 0.08) return new THREE.Vector2(dx / length, dz / length);
      }
    }
    const yaw = this.currentFacingYaw();
    return new THREE.Vector2(Math.sin(yaw), Math.cos(yaw)).normalize();
  }

  private currentFacingYaw() {
    const model = this.joints.model;
    if (!model) return 0;
    const quaternion = model.getWorldQuaternion(new THREE.Quaternion());
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion);
    return Math.atan2(forward.x, forward.z);
  }

  private findEnemiesInRadius(radius: number) {
    const origin = this.hero.root.getWorldPosition(this.tempA);
    return this.registry.values().filter(target => {
      if (!this.isEnemyTarget(target)) return false;
      target.root.getWorldPosition(this.tempB);
      return Math.hypot(this.tempB.x - origin.x, this.tempB.z - origin.z)
        <= radius + Math.max(0, target.selectionRadius * 0.45);
    });
  }

  private findEnemiesInCone(radius: number, angleDegrees: number, direction: THREE.Vector2) {
    const origin = this.hero.root.getWorldPosition(this.tempA);
    const threshold = Math.cos(THREE.MathUtils.degToRad(angleDegrees * 0.5));
    return this.registry.values().filter(target => {
      if (!this.isEnemyTarget(target)) return false;
      target.root.getWorldPosition(this.tempB);
      const dx = this.tempB.x - origin.x;
      const dz = this.tempB.z - origin.z;
      const distance = Math.hypot(dx, dz);
      if (distance > radius + Math.max(0, target.selectionRadius * 0.45)) return false;
      if (distance <= 0.001) return true;
      return dx / distance * direction.x + dz / distance * direction.y >= threshold;
    });
  }

  private isEnemyTarget(target: GameEntity) {
    if (target === this.hero || !target.alive || target.currentHp <= 0 || !target.targetable) return false;
    if (target.team === this.hero.team || target.kind === 'shop') return false;
    if ((target.kind === 'tower' || target.kind === 'building') && target.interaction !== 'attackable-structure') return false;
    return true;
  }

  private resolveJoints(): Joints {
    const leftShoulder = this.hero.root.getObjectByName('left-shoulder') ?? null;
    const rightShoulder = this.hero.root.getObjectByName('right-shoulder') ?? null;
    return {
      model: this.hero.root.getObjectByName('H001-model') ?? null,
      pelvis: this.hero.root.getObjectByName('pelvis') ?? null,
      torso: this.hero.root.getObjectByName('torso') ?? null,
      leftShoulder,
      rightShoulder,
      leftElbow: leftShoulder?.getObjectByName('elbow') ?? null,
      rightElbow: rightShoulder?.getObjectByName('elbow') ?? null,
      wrist: this.hero.root.getObjectByName('right-wrist-attack-pivot') ?? null,
    };
  }

  private applyPresentationPose(nowMs: number) {
    const pose = this.pose;
    if (!pose) return;
    const t = THREE.MathUtils.clamp((nowMs - pose.startedAtMs) / Math.max(1, pose.durationMs), 0, 1);
    if (t >= 1) {
      this.pose = null;
      return;
    }

    const wave = Math.sin(t * Math.PI);
    const { pelvis, torso, leftShoulder, rightShoulder, leftElbow, rightElbow, wrist } = this.joints;

    if (pose.key === 'Q') {
      if (torso) {
        torso.rotation.x += 0.18 * wave;
        torso.rotation.y += 0.24 * Math.sin(t * Math.PI * 2) * wave;
      }
      if (pelvis) pelvis.rotation.x -= 0.08 * wave;
      if (rightShoulder) rightShoulder.rotation.x -= 0.32 * wave;
      if (rightElbow) rightElbow.rotation.x += 0.22 * wave;
      if (wrist) wrist.rotation.z += 0.36 * wave;
      return;
    }

    if (pose.key === 'W') {
      if (torso) torso.rotation.x -= 0.12 * wave;
      if (rightShoulder) rightShoulder.rotation.x -= 0.36 * wave;
      if (rightElbow) rightElbow.rotation.x -= 0.30 * wave;
      if (leftShoulder) leftShoulder.rotation.x += 0.18 * wave;
      if (leftElbow) leftElbow.rotation.x -= 0.12 * wave;
      if (wrist) wrist.rotation.z -= 0.26 * wave;
      return;
    }

    if (pose.key === 'E') {
      if (torso) torso.rotation.y += Math.sin(t * Math.PI * 2) * 0.42 * wave;
      if (pelvis) pelvis.rotation.y -= Math.sin(t * Math.PI * 2) * 0.18 * wave;
      if (rightShoulder) rightShoulder.rotation.x += 0.26 * wave;
      if (wrist) wrist.rotation.z += 0.52 * wave;
      return;
    }

    if (pose.key === 'R') {
      const gather = THREE.MathUtils.clamp(t / 0.56, 0, 1);
      const slam = THREE.MathUtils.clamp((t - 0.56) / 0.22, 0, 1);
      if (torso) torso.rotation.x += (-0.18 * gather + 0.36 * slam) * wave;
      if (rightShoulder) rightShoulder.rotation.x -= (0.48 * gather - 0.82 * slam) * wave;
      if (rightElbow) rightElbow.rotation.x -= 0.32 * gather * wave;
      if (leftShoulder) leftShoulder.rotation.x -= 0.28 * gather * wave;
      if (wrist) wrist.rotation.z += (0.22 * gather + 0.30 * slam) * wave;
    }
  }

  private kickCameraShake(amplitude: number, durationMs: number) {
    this.cameraShakeAmplitude = Math.max(this.cameraShakeAmplitude, amplitude);
    this.cameraShakeUntilMs = Math.max(this.cameraShakeUntilMs, performance.now() + durationMs);
  }

  private applyCameraShake(nowMs: number) {
    if (nowMs >= this.cameraShakeUntilMs || this.cameraShakeAmplitude <= 0) {
      this.cameraShakeAmplitude = 0;
      return;
    }
    const remaining = THREE.MathUtils.clamp((this.cameraShakeUntilMs - nowMs) / 260, 0, 1);
    const amplitude = this.cameraShakeAmplitude * remaining;
    this.camera.position.x += Math.sin(nowMs * 0.071) * amplitude;
    this.camera.position.z += Math.cos(nowMs * 0.083) * amplitude;
  }

  private disposeEffect(effect: FxEntry) {
    effect.root.removeFromParent();
    this.disposeObject(effect.root, effect.materials);
  }

  private disposeObject(root: THREE.Object3D, materials: THREE.Material[]) {
    const geometries = new Set<THREE.BufferGeometry>();
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh) || geometries.has(object.geometry)) return;
      geometries.add(object.geometry);
      object.geometry.dispose();
    });
    for (const value of new Set(materials)) value.dispose();
  }
}
