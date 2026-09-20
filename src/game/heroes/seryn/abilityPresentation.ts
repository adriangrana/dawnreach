import * as THREE from 'three';
import type { GameEntity, GameEntityRegistry } from '../../entities/gameEntities';
import type { AbilityKey } from '../types';
import { SERYN } from './gameplay';

const UNIT = 0.01;
const installed = new WeakMap<THREE.Object3D, SerynAbilityPresentation>();

export type SerynAbilityPresentationHandle = Readonly<{
  update(nowMs: number, applyPose?: boolean): void;
  presentCast(key: AbilityKey, nowMs: number, facingYaw?: number): void;
  dispose(): void;
}>;

type Fx = { root: THREE.Object3D; mats: THREE.Material[]; start: number; duration: number };

function glow(color: number, opacity = 0.65) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, toneMapped: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
}

export function ensureSerynAbilityPresentation(
  scene: THREE.Scene,
  _registry: GameEntityRegistry,
  hero: GameEntity,
  _canvas: HTMLCanvasElement,
  _camera: THREE.Camera,
): SerynAbilityPresentationHandle {
  let existing = installed.get(hero.root);
  if (!existing) {
    existing = new SerynAbilityPresentation(scene, hero);
    installed.set(hero.root, existing);
  }
  return existing;
}

class SerynAbilityPresentation implements SerynAbilityPresentationHandle {
  private effects: Fx[] = [];
  private disposed = false;

  constructor(private readonly scene: THREE.Scene, private readonly hero: GameEntity) {}

  presentCast(key: AbilityKey, nowMs: number, facingYaw = this.hero.root.rotation.y) {
    if (this.disposed) return;
    if (key === 'Q') this.line(nowMs, facingYaw, SERYN.q.range * UNIT, 0x63ddff, 280);
    if (key === 'W') this.dash(nowMs, facingYaw);
    if (key === 'E') this.ring(nowMs, SERYN.e.radius * UNIT, 0x79e9ff, 720);
    if (key === 'R') {
      for (let index = 0; index < SERYN.r.shotCount; index++) {
        const delay = SERYN.r.startupSeconds * 1000 + index * SERYN.r.shotIntervalSeconds * 1000;
        window.setTimeout(() => {
          if (!this.disposed) this.line(performance.now(), facingYaw, SERYN.r.range * UNIT, 0xe6f8ff, 300);
        }, delay);
      }
    }
  }

  update(nowMs: number) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const fx = this.effects[i];
      const t = Math.max(0, Math.min(1, (nowMs - fx.start) / fx.duration));
      fx.root.scale.y = 1 + t * 0.12;
      for (const mat of fx.mats) {
        if ('opacity' in mat) (mat as THREE.MeshBasicMaterial).opacity = Math.max(0, (1 - t) * 0.72);
      }
      if (t < 1) continue;
      fx.root.removeFromParent();
      fx.root.traverse(object => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      for (const mat of fx.mats) mat.dispose();
      this.effects.splice(i, 1);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const fx of this.effects) {
      fx.root.removeFromParent();
      fx.root.traverse(object => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      for (const mat of fx.mats) mat.dispose();
    }
    this.effects = [];
    installed.delete(this.hero.root);
  }

  private line(nowMs: number, yaw: number, length: number, color: number, duration: number) {
    const root = new THREE.Group();
    const mat = glow(color, 0.72);
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.025, length), mat);
    core.position.z = length * 0.5;
    root.add(core);
    root.position.copy(this.hero.root.position);
    root.position.y += 0.18;
    root.rotation.y = yaw;
    this.scene.add(root);
    this.effects.push({ root, mats: [mat], start: nowMs, duration });
  }

  private dash(nowMs: number, yaw: number) {
    const root = new THREE.Group();
    const mat = glow(0x4fd9ff, 0.52);
    for (let i = 0; i < 4; i++) {
      const shard = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.02, 1.2 + i * 0.32), mat);
      shard.position.set((i - 1.5) * 0.14, 0.08 + i * 0.025, -0.45);
      root.add(shard);
    }
    root.position.copy(this.hero.root.position);
    root.rotation.y = yaw;
    this.scene.add(root);
    this.effects.push({ root, mats: [mat], start: nowMs, duration: 360 });
  }

  private ring(nowMs: number, radius: number, color: number, duration: number) {
    const root = new THREE.Group();
    const mat = glow(color, 0.58);
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.88, radius, 72), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    root.add(ring);
    const prism = new THREE.Mesh(new THREE.OctahedronGeometry(0.24, 0), mat);
    prism.position.y = 0.34;
    prism.scale.y = 1.8;
    root.add(prism);
    root.position.copy(this.hero.root.position);
    this.scene.add(root);
    this.effects.push({ root, mats: [mat], start: nowMs, duration });
  }
}
