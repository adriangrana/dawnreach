import * as THREE from 'three';

const Q_TRAIL_NAME = 'alden-q-crown-advance-trail';
const TELEPORT_COLUMN_NAMES = new Set([
  'teleport-light-column',
  'teleport-origin-light-column',
  'teleport-destination-light-column',
]);
const GOLD = 0xe7bd66;
const GOLD_BRIGHT = 0xfff0b8;

type QSwap = {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  source: THREE.MeshBasicMaterial;
  soft: THREE.ShaderMaterial;
  color: THREE.Color;
};

type TeleportHalo = {
  sourceMesh: THREE.Mesh;
  sourceMaterial: THREE.MeshBasicMaterial;
  halo: THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial>;
};

const installed = new WeakMap<THREE.Scene, WorldLineVfxPolish>();
const active = new Set<WorldLineVfxPolish>();

function softStripMaterial(source: THREE.MeshBasicMaterial, color: THREE.Color) {
  const shader = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone() },
      uOpacity: { value: source.opacity },
    },
    vertexShader: `
      varying vec2 vSoftUv;
      void main() {
        vSoftUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vSoftUv;
      void main() {
        float widthFade = smoothstep(0.0, 0.24, vSoftUv.x)
          * (1.0 - smoothstep(0.76, 1.0, vSoftUv.x));
        float lengthFade = smoothstep(0.0, 0.10, vSoftUv.y)
          * (1.0 - smoothstep(0.90, 1.0, vSoftUv.y));
        float alpha = uOpacity * widthFade * lengthFade;
        if (alpha <= 0.002) discard;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: source.depthTest,
    side: source.side,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  shader.polygonOffset = true;
  shader.polygonOffsetFactor = source.polygonOffset ? source.polygonOffsetFactor : -1;
  shader.polygonOffsetUnits = source.polygonOffset ? source.polygonOffsetUnits : -2;
  return shader;
}

function qColor(source: THREE.MeshBasicMaterial) {
  const hex = source.color.getHex();
  if (hex === 0xdcf8ff || hex === 0xfff0b8) return new THREE.Color(GOLD_BRIGHT);
  return new THREE.Color(GOLD);
}

function makeTeleportHalo(sourceMesh: THREE.Mesh): TeleportHalo | null {
  if (!(sourceMesh.geometry instanceof THREE.TubeGeometry)) return null;
  if (sourceMesh.userData.dawnreachTeleportSoftHalo === true) return null;
  if (Array.isArray(sourceMesh.material) || !(sourceMesh.material instanceof THREE.MeshBasicMaterial)) return null;

  const sourceMaterial = sourceMesh.material;
  const parameters = sourceMesh.geometry.parameters;
  const haloGeometry = new THREE.TubeGeometry(
    parameters.path,
    parameters.tubularSegments,
    parameters.radius * 2.55,
    Math.max(6, parameters.radialSegments),
    parameters.closed,
  );
  const haloMaterial = new THREE.MeshBasicMaterial({
    color: sourceMaterial.color,
    transparent: true,
    opacity: sourceMaterial.opacity * 0.20,
    depthWrite: false,
    depthTest: sourceMaterial.depthTest,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const halo = new THREE.Mesh(haloGeometry, haloMaterial);
  halo.name = 'teleport-filament-soft-halo';
  halo.renderOrder = Math.max(0, sourceMesh.renderOrder - 1);
  halo.frustumCulled = false;
  halo.raycast = () => {};
  sourceMesh.userData.dawnreachTeleportSoftHalo = true;
  sourceMesh.add(halo);
  return { sourceMesh, sourceMaterial, halo };
}

export function ensureWorldLineVfxPolish(scene: THREE.Scene) {
  let polish = installed.get(scene);
  if (!polish) {
    polish = new WorldLineVfxPolish(scene);
    installed.set(scene, polish);
    active.add(polish);
  }
  return polish;
}

export function disposeWorldLineVfxPolishes() {
  for (const polish of [...active]) polish.dispose();
  active.clear();
}

class WorldLineVfxPolish {
  private readonly qRoots = new Map<THREE.Object3D, QSwap[]>();
  private readonly teleportRoots = new Map<THREE.Object3D, TeleportHalo[]>();
  private disposed = false;

  constructor(private readonly scene: THREE.Scene) {}

  update() {
    if (this.disposed) return;
    this.discoverQTrails();
    this.discoverTeleportColumns();
    this.sync();
    this.releaseExpired();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const [root, swaps] of this.qRoots) this.releaseQ(root, swaps);
    for (const [root, halos] of this.teleportRoots) this.releaseTeleport(root, halos);
    this.qRoots.clear();
    this.teleportRoots.clear();
    active.delete(this);
  }

  private discoverQTrails() {
    for (const root of this.scene.children) {
      if (root.name !== Q_TRAIL_NAME || this.qRoots.has(root)) continue;
      const swaps: QSwap[] = [];
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh) || !(object.geometry instanceof THREE.BoxGeometry)) return;
        if (Array.isArray(object.material) || !(object.material instanceof THREE.MeshBasicMaterial)) return;
        if (object.userData.dawnreachSoftQTrail === true) return;
        const source = object.material;
        const color = qColor(source);
        const soft = softStripMaterial(source, color);
        object.material = soft;
        object.userData.dawnreachSoftQTrail = true;
        swaps.push({
          mesh: object as THREE.Mesh<THREE.BufferGeometry, THREE.Material>,
          source,
          soft,
          color,
        });
      });
      if (swaps.length > 0) this.qRoots.set(root, swaps);
    }
  }

  private discoverTeleportColumns() {
    const candidates: THREE.Object3D[] = [];
    this.scene.traverse((object) => {
      if (!TELEPORT_COLUMN_NAMES.has(object.name) || this.teleportRoots.has(object)) return;
      candidates.push(object);
    });

    for (const root of candidates) {
      const tubeMeshes: THREE.Mesh[] = [];
      root.traverse((object) => {
        if (object instanceof THREE.Mesh && object.geometry instanceof THREE.TubeGeometry) tubeMeshes.push(object);
      });
      const halos: TeleportHalo[] = [];
      for (const mesh of tubeMeshes) {
        const halo = makeTeleportHalo(mesh);
        if (halo) halos.push(halo);
      }
      if (halos.length > 0) this.teleportRoots.set(root, halos);
    }
  }

  private sync() {
    for (const swaps of this.qRoots.values()) {
      for (const swap of swaps) {
        swap.soft.uniforms.uColor.value.copy(swap.color);
        swap.soft.uniforms.uOpacity.value = swap.source.opacity;
        swap.soft.visible = swap.source.visible;
      }
    }
    for (const halos of this.teleportRoots.values()) {
      for (const entry of halos) {
        entry.halo.material.color.copy(entry.sourceMaterial.color);
        entry.halo.material.opacity = entry.sourceMaterial.opacity * 0.20;
        entry.halo.material.visible = entry.sourceMaterial.visible;
      }
    }
  }

  private releaseExpired() {
    for (const [root, swaps] of [...this.qRoots]) {
      if (root.parent) continue;
      this.releaseQ(root, swaps);
      this.qRoots.delete(root);
    }
    for (const [root, halos] of [...this.teleportRoots]) {
      if (root.parent) continue;
      this.releaseTeleport(root, halos);
      this.teleportRoots.delete(root);
    }
  }

  private releaseQ(_root: THREE.Object3D, swaps: QSwap[]) {
    for (const swap of swaps) {
      if (swap.mesh.material === swap.soft) swap.mesh.material = swap.source;
      swap.soft.dispose();
      delete swap.mesh.userData.dawnreachSoftQTrail;
    }
  }

  private releaseTeleport(_root: THREE.Object3D, halos: TeleportHalo[]) {
    for (const entry of halos) {
      delete entry.sourceMesh.userData.dawnreachTeleportSoftHalo;
      entry.halo.removeFromParent();
      entry.halo.geometry.dispose();
      entry.halo.material.dispose();
    }
  }
}
