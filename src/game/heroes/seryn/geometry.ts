import * as THREE from 'three';

export type SerynLoftSection = Readonly<{
  y: number;
  rx: number;
  rz: number;
  cx?: number;
  cz?: number;
  front?: number;
  back?: number;
}>;

export type SerynShoulderSection = Readonly<{
  x: number;
  y: number;
  z?: number;
  ry: number;
  rz: number;
}>;

export function createSerynLoftGeometry(
  sections: readonly SerynLoftSection[],
  sides = 32,
  capTop = true,
  capBottom = true,
) {
  if (sections.length < 2) throw new RangeError('A loft needs at least two sections.');
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let row = 0; row < sections.length; row++) {
    const section = sections[row];
    for (let column = 0; column <= sides; column++) {
      const angle = column / sides * Math.PI * 2;
      const sx = Math.sin(angle);
      const cz = Math.cos(angle);
      const frontWeight = Math.max(0, cz) ** 2;
      const backWeight = Math.max(0, -cz) ** 2;
      positions.push(
        (section.cx ?? 0) + sx * section.rx,
        section.y,
        (section.cz ?? 0) + cz * section.rz
          + (section.front ?? 0) * frontWeight
          - (section.back ?? 0) * backWeight,
      );
      uvs.push(column / sides, row / (sections.length - 1));
    }
  }

  const stride = sides + 1;
  const ascendsY = sections[sections.length - 1].y >= sections[0].y;
  for (let row = 0; row < sections.length - 1; row++) {
    for (let column = 0; column < sides; column++) {
      const a = row * stride + column;
      const b = a + 1;
      const d = (row + 1) * stride + column;
      const c = d + 1;

      // Torso/head lofts are authored bottom -> top, while limbs are authored
      // joint -> extremity and therefore run downward in local Y. Their exterior
      // winding is opposite. Choose the triangle order from the actual section
      // direction so every loft keeps outward-facing normals.
      if (ascendsY) indices.push(a, b, d, b, c, d);
      else indices.push(a, d, b, b, d, c);
    }
  }

  const addCap = (row: number, top: boolean) => {
    const section = sections[row];
    const center = positions.length / 3;
    positions.push(section.cx ?? 0, section.y, section.cz ?? 0);
    uvs.push(0.5, 0.5);
    const ring = row * stride;
    for (let column = 0; column < sides; column++) {
      const a = ring + column;
      const b = ring + column + 1;
      if (top) indices.push(center, a, b);
      else indices.push(center, b, a);
    }
  };

  // End-cap normals must follow the same authoring direction. For descending
  // limb lofts the first ring is physically the top end and the last ring the bottom.
  if (capBottom) addCap(0, !ascendsY);
  if (capTop) addCap(sections.length - 1, ascendsY);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  smoothPeriodicNormals(geometry, sides + 1, sections.length);
  geometry.computeBoundingSphere();
  return geometry;
}

/** UV seams need duplicate vertices, but their normals must remain continuous. */
export function smoothPeriodicNormals(geometry: THREE.BufferGeometry, stride: number, rows: number) {
  const normal = geometry.getAttribute('normal');
  const n = new THREE.Vector3();
  for (let row = 0; row < rows; row++) {
    const a = row * stride, b = a + stride - 1;
    n.set(normal.getX(a) + normal.getX(b), normal.getY(a) + normal.getY(b), normal.getZ(a) + normal.getZ(b)).normalize();
    normal.setXYZ(a, n.x, n.y, n.z); normal.setXYZ(b, n.x, n.y, n.z);
  }
}

export function createTaperedCurveGeometry(
  points: readonly THREE.Vector3[],
  radiusStart: number,
  radiusEnd = 0.004,
  steps = 30,
  sides = 10,
) {
  const curve = new THREE.CatmullRomCurve3([...points], false, 'centripetal');
  const frames = curve.computeFrenetFrames(steps, false);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let row = 0; row <= steps; row++) {
    const t = row / steps;
    const center = curve.getPointAt(t);
    const radius = THREE.MathUtils.lerp(radiusStart, radiusEnd, Math.pow(t, 0.82));
    for (let column = 0; column <= sides; column++) {
      const angle = column / sides * Math.PI * 2;
      const point = center.clone()
        .addScaledVector(frames.normals[row], Math.cos(angle) * radius)
        .addScaledVector(frames.binormals[row], Math.sin(angle) * radius);
      positions.push(point.x, point.y, point.z);
      uvs.push(column / sides, t);
      if (row < steps && column < sides) {
        const a = row * (sides + 1) + column;
        const b = a + sides + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createSerynShoulderBlendGeometry(
  sections: readonly SerynShoulderSection[],
  sides = 28,
  capStart = false,
  capEnd = false,
) {
  if (sections.length < 2) throw new RangeError('A shoulder blend needs at least two sections.');
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let row = 0; row < sections.length; row++) {
    const section = sections[row];
    for (let column = 0; column <= sides; column++) {
      const angle = column / sides * Math.PI * 2;
      positions.push(
        section.x,
        section.y + Math.sin(angle) * section.ry,
        (section.z ?? 0) + Math.cos(angle) * section.rz,
      );
      uvs.push(column / sides, row / (sections.length - 1));
    }
  }

  const stride = sides + 1;
  const increasesX = sections[sections.length - 1].x >= sections[0].x;
  for (let row = 0; row < sections.length - 1; row++) {
    for (let column = 0; column < sides; column++) {
      const a = row * stride + column;
      const b = a + 1;
      const d = (row + 1) * stride + column;
      const c = d + 1;
      if (increasesX) indices.push(a, d, b, b, d, c);
      else indices.push(a, b, d, b, c, d);
    }
  }

  const addCap = (row: number, outwardPositiveX: boolean) => {
    const section = sections[row];
    const center = positions.length / 3;
    positions.push(section.x, section.y, section.z ?? 0);
    uvs.push(0.5, 0.5);
    const ring = row * stride;
    for (let column = 0; column < sides; column++) {
      const a = ring + column;
      const b = ring + column + 1;
      if (outwardPositiveX) indices.push(center, b, a);
      else indices.push(center, a, b);
    }
  };

  if (capStart) addCap(0, !increasesX);
  if (capEnd) addCap(sections.length - 1, increasesX);

  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  result.setIndex(indices);
  result.computeVertexNormals();
  result.computeBoundingSphere();
  return result;
}

export type SerynClothPanelOptions = Readonly<{
  widthTop: number;
  widthBottom: number;
  length: number;
  zTop?: number;
  zBottom?: number;
  xDrift?: number;
  flare?: number;
  foldDepth?: number;
  curveDepth?: number;
  drape?: number;
  thickness?: number;
  edgeCurl?: number;
  hemWave?: number;
  bias?: number;
}>;

/**
 * Dense closed cloth shell with real curvature, thickness and animation metadata.
 *
 * The old garment panels were single mathematical planes. This version builds two
 * subdivided surfaces plus stitched side/top/hem edges, so light can describe actual
 * volume. Curvature and pleats are part of the geometry instead of being faked only
 * by colour.
 */
export function createSerynClothPanelGeometry(
  options: SerynClothPanelOptions,
  widthSegments = 30,
  lengthSegments = 40,
) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const flexValues: number[] = [];
  const phaseValues: number[] = [];
  const indices: number[] = [];
  const thickness = options.thickness ?? 0.012;
  const layerStride = (widthSegments + 1) * (lengthSegments + 1);

  const sample = (row: number, column: number) => {
    const v = row / lengthSegments;
    const u = column / widthSegments;
    const eased = Math.pow(v, 1.06);
    const across = u * 2 - 1;
    const width = THREE.MathUtils.lerp(options.widthTop, options.widthBottom, eased)
      * (1 + (options.flare ?? 0) * eased);
    const zBase = THREE.MathUtils.lerp(options.zTop ?? 0, options.zBottom ?? 0, eased);
    const drift = (options.xDrift ?? 0) * eased * eased;
    const centreBulge = (1 - across * across) * (options.curveDepth ?? 0.020);
    const pleatEnvelope = (0.22 + eased * 0.78) * (0.42 + 0.58 * (1 - Math.abs(across)));
    const fold =
      Math.sin(u * Math.PI * 6 + v * 1.35 + (options.bias ?? 0))
      * (options.foldDepth ?? 0.012)
      * pleatEnvelope;
    const edgeCurl = Math.sign(across)
      * Math.pow(Math.abs(across), 3.4)
      * (options.edgeCurl ?? 0.004)
      * eased;
    const hem =
      Math.sin(u * Math.PI * 3 + (options.bias ?? 0))
      * (options.hemWave ?? 0)
      * Math.pow(v, 5);

    return {
      x: across * width * 0.5 + drift + edgeCurl,
      y: -options.length * eased + hem,
      z: zBase + centreBulge + fold + Math.sin(v * Math.PI) * (options.drape ?? 0),
      u,
      v,
      flex: Math.pow(v, 2.15),
      phase: u * Math.PI * 2 + v * 2.7 + (options.bias ?? 0),
    };
  };

  // Front and back fabric surfaces. Vertices are intentionally separate so normals do
  // not smear across the cloth edge.
  for (let layer = 0; layer < 2; layer++) {
    const offset = layer === 0 ? thickness * 0.5 : -thickness * 0.5;
    for (let row = 0; row <= lengthSegments; row++) {
      for (let column = 0; column <= widthSegments; column++) {
        const p = sample(row, column);
        positions.push(p.x, p.y, p.z + offset);
        uvs.push(p.u, p.v);
        flexValues.push(p.flex);
        phaseValues.push(p.phase);
      }
    }
  }

  const stride = widthSegments + 1;
  for (let row = 0; row < lengthSegments; row++) {
    for (let column = 0; column < widthSegments; column++) {
      const a = row * stride + column;
      const b = a + 1;
      const d = (row + 1) * stride + column;
      const c = d + 1;
      // Front (+Z).
      indices.push(a, d, b, b, d, c);

      const ab = layerStride + a;
      const bb = layerStride + b;
      const db = layerStride + d;
      const cb = layerStride + c;
      // Back (-Z).
      indices.push(ab, bb, db, bb, cb, db);
    }
  }

  const stitch = (frontA: number, frontB: number, backA: number, backB: number) => {
    indices.push(frontA, backA, frontB, frontB, backA, backB);
  };

  // Stitched left/right edges.
  for (let row = 0; row < lengthSegments; row++) {
    const leftA = row * stride;
    const leftB = (row + 1) * stride;
    stitch(leftA, leftB, layerStride + leftA, layerStride + leftB);

    const rightA = row * stride + widthSegments;
    const rightB = (row + 1) * stride + widthSegments;
    stitch(rightB, rightA, layerStride + rightB, layerStride + rightA);
  }

  // Stitched top and sculpted hem.
  for (let column = 0; column < widthSegments; column++) {
    const topA = column;
    const topB = column + 1;
    stitch(topB, topA, layerStride + topB, layerStride + topA);

    const hemA = lengthSegments * stride + column;
    const hemB = hemA + 1;
    stitch(hemA, hemB, layerStride + hemA, layerStride + hemB);
  }

  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  result.setAttribute('clothFlex', new THREE.Float32BufferAttribute(flexValues, 1));
  result.setAttribute('clothPhase', new THREE.Float32BufferAttribute(phaseValues, 1));
  result.setIndex(indices);
  result.computeVertexNormals();
  result.computeBoundingBox();
  result.computeBoundingSphere();

  const position = result.getAttribute('position') as THREE.BufferAttribute;
  result.userData.serynClothBasePositions = new Float32Array(position.array as ArrayLike<number>);
  return result;
}
