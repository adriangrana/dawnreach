import * as THREE from 'three';

const ALDEN_EFFECT_COLORS = new Set([
  0x53d6ff,
  0xdcf8ff,
  0x2db8ff,
  0xe7bd66,
  0xfff0b8,
  0x8de6ff,
  0xffd27a,
]);

const GOLD = 0xe7bd66;
const GOLD_BRIGHT = 0xfff0b8;
const MIN_EFFECT_RENDER_ORDER = 40;
const MAX_EFFECT_RENDER_ORDER = 72;

type MaterialSwap = {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  sourceMaterial: THREE.MeshBasicMaterial;
  softMaterial: THREE.ShaderMaterial;
  colorOverride: THREE.Color | null;
};

type TeleportHalo = {
  mesh: THREE.Mesh;
  sourceMaterial: THREE.MeshBasicMaterial;
  haloMaterial: THREE.MeshBasicMaterial;
};

type ProcessedRoot = {
  root: THREE.Object3D;
  swaps: MaterialSwap[];
  halos: TeleportHalo[];
};

const installed = new WeakMap<THREE.Scene, AldenAbilityEdgePolish>();
const active = new Set<AldenAbilityEdgePolish>();

function isAldenPaletteMaterial(material: THREE.Material): material is THREE.MeshBasicMaterial {
  return material instanceof THREE.MeshBasicMaterial
    && material.transparent
    && ALDEN_EFFECT_COLORS.has(material.color.getHex());
}

function copyMaterialRenderState(source: THREE.MeshBasicMaterial, target: THREE.ShaderMaterial) {
  target.transparent = true;
  target.depthWrite = false;
  target.depthTest = source.depthTest;
  target.side = source.side;
  target.blending = source.blending;
  target.toneMapped = false;
  target.polygonOffset = true;
  target.polygonOffsetFactor = source.polygonOffset ? source.polygonOffsetFactor : -1;
  target.polygonOffsetUnits = source.polygonOffset ? source.polygonOffsetUnits : -2;
}

function goldOverrideFor(source: THREE.MeshBasicMaterial) {
  const hex = source.color.getHex();
  if (hex === 0x53d6ff || hex === 0x2db8ff || hex === 0x8de6ff) return new THREE.Color(GOLD);
  if (hex === 0xdcf8ff) return new THREE.Color(GOLD_BRIGHT);
  return null;
}

function isCandidateRing(object: THREE.Object3D) {
  if (!(object instanceof THREE.Mesh) || !(object.geometry instanceof THREE.RingGeometry)) return false;
  if (Array.isArray(object.material) || !isAldenPaletteMaterial(object.material)) return false;
  return object.renderOrder >= MIN_EFFECT_RENDER_ORDER && object.renderOrder <= MAX_EFFECT_RENDER_ORDER;
}

function isCandidateAbilitySurface(object: THREE.Object3D) {
  if (!(object instanceof THREE.Mesh) || object.geometry instanceof THREE.RingGeometry) return false;
  if (object.userData.dawnreachSoftAbilitySurface === true) return false;
  if (Array.isArray(object.material) || !isAldenPaletteMaterial(object.material)) return false;
  if (object.renderOrder < MIN_EFFECT_RENDER_ORDER || object.renderOrder > MAX_EFFECT_RENDER_ORDER) return false;
  return object.geometry instanceof THREE.BoxGeometry || object.geometry.type === 'BufferGeometry';
}

function rootContainsAbilityPresentation(root: THREE.Object3D) {
  let found = false;
  root.traverse((object) => {
    if (found) return;
    if (isCandidateRing(object) || isCandidateAbilitySurface(object)) found = true;
  });
  return found;
}

function createSoftRingMaterial(
  source: THREE.MeshBasicMaterial,
  innerRadius: number,
  outerRadius: number,
  feather: number,
) {
  const shader = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: source.color.clone() },
      uOpacity: { value: source.opacity },
      uInnerRadius: { value: innerRadius },
      uOuterRadius: { value: outerRadius },
      uFeather: { value: feather },
    },
    vertexShader: `
      varying vec2 vLocal;
      void main() {
        vLocal = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uInnerRadius;
      uniform float uOuterRadius;
      uniform float uFeather;
      varying vec2 vLocal;

      void main() {
        float radius = length(vLocal);
        float innerStart = max(0.0, uInnerRadius - uFeather);
        float innerEnd = uInnerRadius + uFeather * 0.38;
        float outerStart = max(innerEnd, uOuterRadius - uFeather * 0.38);
        float outerEnd = uOuterRadius + uFeather;
        float innerFade = smoothstep(innerStart, innerEnd, radius);
        float outerFade = 1.0 - smoothstep(outerStart, outerEnd, radius);
        float alpha = uOpacity * innerFade * outerFade;
        if (alpha <= 0.002) discard;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  });
  copyMaterialRenderState(source, shader);
  return shader;
}

function createSoftStripMaterial(source: THREE.MeshBasicMaterial, colorOverride: THREE.Color | null) {
  const shader = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: (colorOverride ?? source.color).clone() },
      uOpacity: { value: source.opacity },
    },
    vertexShader: `
      varying vec2 vUvSoft;
      void main() {
        vUvSoft = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUvSoft;

      void main() {
        float sideFade = smoothstep(0.0, 0.22, vUvSoft.x) * (1.0 - smoothstep(0.78, 1.0, vUvSoft.x));
        float endFade = smoothstep(0.0, 0.13, vUvSoft.y) * (1.0 - smoothstep(0.87, 1.0, vUvSoft.y));
        float alpha = uOpacity * sideFade * endFade;
        if (alpha <= 0.002) discard;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  });
  copyMaterialRenderState(source, shader);
  return shader;
}

function measureArcGeometry(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position');
  let minRadius = Number.POSITIVE_INFINITY;
  let maxRadius = 0;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxAbsAngle = 0;

  for (let index = 0; index < position.count; index++) {
    const x = position.getX(index);
    const y = position.getY(index);
    const z = position.getZ(index);
    const radius = Math.hypot(x, z);
    minRadius = Math.min(minRadius, radius);
    maxRadius = Math.max(maxRadius, radius);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    maxAbsAngle = Math.max(maxAbsAngle, Math.abs(Math.atan2(x, z)));
  }

  return {
    minRadius: Number.isFinite(minRadius) ? minRadius : 0,
    maxRadius,
    minY: Number.isFinite(minY) ? minY : 0,
    maxY: Number.isFinite(maxY) ? maxY : 0,
    maxAbsAngle: Math.max(0.01, maxAbsAngle),
  };
}

function createSoftArcMaterial(
  source: THREE.MeshBasicMaterial,
  geometry: THREE.BufferGeometry,
  colorOverride: THREE.Color | null,
) {
  const bounds = measureArcGeometry(geometry);
  const radialSpan = bounds.maxRadius - bounds.minRadius;
  const heightSpan = bounds.maxY - bounds.minY;
  const shader = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: (colorOverride ?? source.color).clone() },
      uOpacity: { value: source.opacity },
      uMinRadius: { value: bounds.minRadius },
      uMaxRadius: { value: bounds.maxRadius },
      uMinY: { value: bounds.minY },
      uMaxY: { value: bounds.maxY },
      uMaxAbsAngle: { value: bounds.maxAbsAngle },
      uUseRadial: { value: radialSpan > 0.035 ? 1 : 0 },
      uUseHeight: { value: heightSpan > 0.035 ? 1 : 0 },
    },
    vertexShader: `
      varying vec3 vLocalSoft;
      void main() {
        vLocalSoft = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uMinRadius;
      uniform float uMaxRadius;
      uniform float uMinY;
      uniform float uMaxY;
      uniform float uMaxAbsAngle;
      uniform float uUseRadial;
      uniform float uUseHeight;
      varying vec3 vLocalSoft;

      void main() {
        float radius = length(vLocalSoft.xz);
        float radialSpan = max(0.001, uMaxRadius - uMinRadius);
        float radialFeather = max(0.012, radialSpan * 0.28);
        float radialFade = smoothstep(uMinRadius, uMinRadius + radialFeather, radius)
          * (1.0 - smoothstep(uMaxRadius - radialFeather, uMaxRadius, radius));

        float heightSpan = max(0.001, uMaxY - uMinY);
        float heightFeather = max(0.03, heightSpan * 0.16);
        float heightFade = smoothstep(uMinY, uMinY + heightFeather, vLocalSoft.y)
          * (1.0 - smoothstep(uMaxY - heightFeather, uMaxY, vLocalSoft.y));

        float angle = abs(atan(vLocalSoft.x, vLocalSoft.z));
        float angularStart = uMaxAbsAngle * 0.82;
        float angularFade = 1.0 - smoothstep(angularStart, uMaxAbsAngle, angle);
        float shapeFade = angularFade
          * mix(1.0, radialFade, uUseRadial)
          * mix(1.0, heightFade, uUseHeight);
        float alpha = uOpacity * shapeFade;
        if (alpha <= 0.002) discard;
        gl_FragColor = vec4(uColor, alpha);
      }
    `,
  });
  copyMaterialRenderState(source, shader);
  return shader;
}

function softenRing(mesh: THREE.Mesh): MaterialSwap | null {
  if (!(mesh.geometry instanceof THREE.RingGeometry)) return null;
  if (Array.isArray(mesh.material) || !isAldenPaletteMaterial(mesh.material)) return null;
  if (mesh.userData.dawnreachSoftAbilityEdge) return null;

  const parameters = mesh.geometry.parameters;
  const innerRadius = Number(parameters.innerRadius ?? 0);
  const outerRadius = Number(parameters.outerRadius ?? 0);
  if (!Number.isFinite(innerRadius) || !Number.isFinite(outerRadius) || outerRadius <= 0) return null;

  const thickness = Math.max(0.01, outerRadius - innerRadius);
  const feather = THREE.MathUtils.clamp(
    Math.max(thickness * 1.25, outerRadius * 0.018, 0.025),
    0.025,
    Math.max(0.035, outerRadius * 0.10),
  );
  const expandedInner = Math.max(0.001, innerRadius - feather);
  const expandedOuter = outerRadius + feather;
  const sourceMaterial = mesh.material;
  const softMaterial = createSoftRingMaterial(sourceMaterial, innerRadius, outerRadius, feather);
  const radialSegments = Math.max(96, Number(parameters.thetaSegments ?? 96));
  const thetaStart = Number(parameters.thetaStart ?? 0);
  const thetaLength = Number(parameters.thetaLength ?? Math.PI * 2);
  const oldGeometry = mesh.geometry;

  mesh.geometry = new THREE.RingGeometry(
    expandedInner,
    expandedOuter,
    radialSegments,
    1,
    thetaStart,
    thetaLength,
  );
  mesh.material = softMaterial;
  mesh.userData.dawnreachSoftAbilityEdge = true;
  oldGeometry.dispose();

  return {
    mesh: mesh as THREE.Mesh<THREE.BufferGeometry, THREE.Material>,
    sourceMaterial,
    softMaterial,
    colorOverride: null,
  };
}

function softenAbilitySurface(mesh: THREE.Mesh): MaterialSwap | null {
  if (Array.isArray(mesh.material) || !isAldenPaletteMaterial(mesh.material)) return null;
  if (mesh.userData.dawnreachSoftAbilitySurface) return null;
  const sourceMaterial = mesh.material;
  const colorOverride = goldOverrideFor(sourceMaterial);
  const softMaterial = mesh.geometry instanceof THREE.BoxGeometry
    ? createSoftStripMaterial(sourceMaterial, colorOverride)
    : createSoftArcMaterial(sourceMaterial, mesh.geometry, colorOverride);

  mesh.material = softMaterial;
  mesh.userData.dawnreachSoftAbilitySurface = true;
  return {
    mesh: mesh as THREE.Mesh<THREE.BufferGeometry, THREE.Material>,
    sourceMaterial,
    softMaterial,
    colorOverride,
  };
}

function createTeleportHalo(mesh: THREE.Mesh): TeleportHalo | null {
  if (!(mesh.geometry instanceof THREE.TubeGeometry)) return null;
  if (mesh.userData.dawnreachTeleportSoftHalo === true) return null;
  if (Array.isArray(mesh.material) || !(mesh.material instanceof THREE.MeshBasicMaterial)) return null;
  if (!mesh.material.transparent) return null;

  const sourceMaterial = mesh.material;
  const parameters = mesh.geometry.parameters;
  const haloGeometry = new THREE.TubeGeometry(
    parameters.path,
    parameters.tubularSegments,
    parameters.radius * 2.45,
    Math.max(6, parameters.radialSegments),
    parameters.closed,
  );
  const haloMaterial = new THREE.MeshBasicMaterial({
    color: sourceMaterial.color,
    transparent: true,
    opacity: sourceMaterial.opacity * 0.22,
    depthWrite: false,
    depthTest: sourceMaterial.depthTest,
    side: THREE.DoubleSide,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  });
  const halo = new THREE.Mesh(haloGeometry, haloMaterial);
  halo.name = 'teleport-filament-soft-halo';
  halo.renderOrder = Math.max(0, mesh.renderOrder - 1);
  halo.frustumCulled = false;
  halo.raycast = () => {};
  mesh.userData.dawnreachTeleportSoftHalo = true;
  mesh.add(halo);
  return { mesh: halo, sourceMaterial, haloMaterial };
}

export function ensureAldenAbilityEdgePolish(scene: THREE.Scene) {
  let polish = installed.get(scene);
  if (!polish) {
    polish = new AldenAbilityEdgePolish(scene);
    installed.set(scene, polish);
    active.add(polish);
  }
  return polish;
}

export function disposeAldenAbilityEdgePolishes() {
  for (const polish of [...active]) polish.dispose();
  active.clear();
}

class AldenAbilityEdgePolish {
  private readonly processedRoots = new Map<THREE.Object3D, ProcessedRoot>();
  private disposed = false;

  constructor(private readonly scene: THREE.Scene) {}

  update() {
    if (this.disposed) return;
    this.discoverNewEffects();
    this.syncMaterials();
    this.releaseExpiredEffects();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const processed of this.processedRoots.values()) this.releaseRoot(processed);
    this.processedRoots.clear();
    active.delete(this);
  }

  private discoverNewEffects() {
    for (const child of this.scene.children) {
      if (this.processedRoots.has(child)) continue;
      const explicitlyAlden = child.name.startsWith('alden-');
      const teleportPortal = child.name === 'teleport-light-column';
      if (!explicitlyAlden && !teleportPortal && !rootContainsAbilityPresentation(child)) continue;

      const ringCandidates: THREE.Mesh[] = [];
      const surfaceCandidates: THREE.Mesh[] = [];
      const teleportCandidates: THREE.Mesh[] = [];
      child.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        if (isCandidateRing(object)) ringCandidates.push(object);
        else if (isCandidateAbilitySurface(object)) surfaceCandidates.push(object);
        if (teleportPortal && object.geometry instanceof THREE.TubeGeometry) teleportCandidates.push(object);
      });

      const swaps: MaterialSwap[] = [];
      for (const mesh of ringCandidates) {
        const softened = softenRing(mesh);
        if (softened) swaps.push(softened);
      }
      for (const mesh of surfaceCandidates) {
        const softened = softenAbilitySurface(mesh);
        if (softened) swaps.push(softened);
      }
      const halos: TeleportHalo[] = [];
      for (const mesh of teleportCandidates) {
        const halo = createTeleportHalo(mesh);
        if (halo) halos.push(halo);
      }

      if (swaps.length > 0 || halos.length > 0) {
        this.processedRoots.set(child, { root: child, swaps, halos });
      }
    }
  }

  private syncMaterials() {
    for (const processed of this.processedRoots.values()) {
      for (const swap of processed.swaps) {
        const { sourceMaterial, softMaterial, colorOverride } = swap;
        softMaterial.uniforms.uColor.value.copy(colorOverride ?? sourceMaterial.color);
        softMaterial.uniforms.uOpacity.value = sourceMaterial.opacity;
        softMaterial.visible = sourceMaterial.visible;
        softMaterial.blending = sourceMaterial.blending;
        softMaterial.depthTest = sourceMaterial.depthTest;
      }
      for (const halo of processed.halos) {
        halo.haloMaterial.color.copy(halo.sourceMaterial.color);
        halo.haloMaterial.opacity = halo.sourceMaterial.opacity * 0.22;
        halo.haloMaterial.visible = halo.sourceMaterial.visible;
      }
    }
  }

  private releaseExpiredEffects() {
    for (const [root, processed] of [...this.processedRoots]) {
      if (root.parent === this.scene) continue;
      this.releaseRoot(processed);
      this.processedRoots.delete(root);
    }
  }

  private releaseRoot(processed: ProcessedRoot) {
    for (const swap of processed.swaps) {
      if (swap.mesh.material === swap.softMaterial) swap.mesh.material = swap.sourceMaterial;
      swap.softMaterial.dispose();
      delete swap.mesh.userData.dawnreachSoftAbilityEdge;
      delete swap.mesh.userData.dawnreachSoftAbilitySurface;
    }
    for (const halo of processed.halos) {
      const parent = halo.mesh.parent;
      if (parent) delete parent.userData.dawnreachTeleportSoftHalo;
      halo.mesh.removeFromParent();
      halo.mesh.geometry.dispose();
      halo.haloMaterial.dispose();
    }
  }
}
