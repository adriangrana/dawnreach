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

const MIN_EFFECT_RENDER_ORDER = 40;
const MAX_EFFECT_RENDER_ORDER = 72;

type SoftenedRing = {
  // The mesh starts with a MeshBasicMaterial, is temporarily replaced by our
  // ShaderMaterial, then restored during cleanup. Type the slot as Material so
  // both assignments are valid under strict TypeScript.
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.Material>;
  sourceMaterial: THREE.MeshBasicMaterial;
  softMaterial: THREE.ShaderMaterial;
};

type ProcessedRoot = {
  root: THREE.Object3D;
  rings: SoftenedRing[];
};

const installed = new WeakMap<THREE.Scene, AldenAbilityEdgePolish>();
const active = new Set<AldenAbilityEdgePolish>();

function isAldenPaletteMaterial(material: THREE.Material): material is THREE.MeshBasicMaterial {
  return material instanceof THREE.MeshBasicMaterial
    && material.transparent
    && ALDEN_EFFECT_COLORS.has(material.color.getHex());
}

function isCandidateRing(object: THREE.Object3D) {
  if (!(object instanceof THREE.Mesh) || !(object.geometry instanceof THREE.RingGeometry)) return false;
  if (Array.isArray(object.material) || !isAldenPaletteMaterial(object.material)) return false;
  return object.renderOrder >= MIN_EFFECT_RENDER_ORDER && object.renderOrder <= MAX_EFFECT_RENDER_ORDER;
}

function rootContainsCandidateRing(root: THREE.Object3D) {
  let found = false;
  root.traverse((object) => {
    if (!found && isCandidateRing(object)) found = true;
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
    transparent: true,
    depthWrite: false,
    depthTest: source.depthTest,
    side: source.side,
    blending: source.blending,
    toneMapped: false,
  });
  shader.polygonOffset = true;
  shader.polygonOffsetFactor = source.polygonOffset ? source.polygonOffsetFactor : -1;
  shader.polygonOffsetUnits = source.polygonOffset ? source.polygonOffsetUnits : -2;
  return shader;
}

function softenRing(mesh: THREE.Mesh): SoftenedRing | null {
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
  const replacement = new THREE.RingGeometry(
    expandedInner,
    expandedOuter,
    radialSegments,
    1,
    thetaStart,
    thetaLength,
  );
  mesh.geometry = replacement;
  mesh.material = softMaterial;
  mesh.userData.dawnreachSoftAbilityEdge = true;
  oldGeometry.dispose();

  return {
    mesh: mesh as THREE.Mesh<THREE.RingGeometry, THREE.Material>,
    sourceMaterial,
    softMaterial,
  };
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
      if (!explicitlyAlden && !rootContainsCandidateRing(child)) continue;

      const rings: SoftenedRing[] = [];
      child.traverse((object) => {
        if (!isCandidateRing(object)) return;
        const softened = softenRing(object as THREE.Mesh);
        if (softened) rings.push(softened);
      });
      if (rings.length > 0) this.processedRoots.set(child, { root: child, rings });
    }
  }

  private syncMaterials() {
    for (const processed of this.processedRoots.values()) {
      for (const ring of processed.rings) {
        const { sourceMaterial, softMaterial } = ring;
        softMaterial.uniforms.uColor.value.copy(sourceMaterial.color);
        softMaterial.uniforms.uOpacity.value = sourceMaterial.opacity;
        softMaterial.visible = sourceMaterial.visible;
        softMaterial.blending = sourceMaterial.blending;
        softMaterial.depthTest = sourceMaterial.depthTest;
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
    for (const ring of processed.rings) {
      if (ring.mesh.material === ring.softMaterial) ring.mesh.material = ring.sourceMaterial;
      ring.softMaterial.dispose();
      delete ring.mesh.userData.dawnreachSoftAbilityEdge;
    }
  }
}
