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
  for (let row = 0; row < sections.length - 1; row++) {
    for (let column = 0; column < sides; column++) {
      const a = row * stride + column;
      const b = a + 1;
      const d = (row + 1) * stride + column;
      const c = d + 1;
      // Rings are authored clockwise when viewed from +Y. Keep the side triangles
      // counter-clockwise from the exterior so WebGL front-face culling and generated
      // normals both point out of the body instead of exposing the hollow interior.
      indices.push(a, b, d, b, c, d);
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

  if (capBottom) addCap(0, false);
  if (capTop) addCap(sections.length - 1, true);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
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
        indices.push(a, b, a + 1, a + 1, b, b + 1);
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

export function createPanelGeometry(
  outline: readonly Readonly<[number, number]>[],
  depth = 0.018,
  bevel = 0.008,
) {
  const shape = new THREE.Shape();
  outline.forEach(([x, y], index) => {
    if (index === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelSegments: bevel > 0 ? 2 : 0,
    bevelSize: bevel,
    bevelThickness: bevel * 0.7,
    curveSegments: 4,
  });
  geometry.center();
  geometry.computeVertexNormals();
  return geometry;
}

export function createHairBladeGeometry(
  width: number,
  length: number,
  bend = 0.08,
  segments = 5,
) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= segments; row++) {
    const t = row / segments;
    const y = -t * length;
    const z = Math.sin(t * Math.PI) * bend;
    const half = THREE.MathUtils.lerp(width * 0.5, width * 0.10, t);
    positions.push(-half, y, z, half, y, z);
    uvs.push(0, t, 1, t);
    if (row < segments) {
      const a = row * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
