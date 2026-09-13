import * as THREE from 'three';

export type Section = { center: THREE.Vector3; width: number; height: number };
export const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// An elliptical loft keeps the neck, torso and curling tail on one continuous skin.
export function createLoft(sections: Section[], steps = 96, sides = 24) {
  const curve = new THREE.CatmullRomCurve3(sections.map(s => s.center), false, 'centripetal');
  const sample = (t: number) => {
    const f = THREE.MathUtils.clamp(t, 0, 1) * (sections.length - 1);
    const index = Math.min(sections.length - 2, Math.floor(f));
    const u = THREE.MathUtils.smoothstep(f - index, 0, 1);
    const center = curve.getPoint(t), tangent = curve.getTangent(t).normalize();
    const right = new THREE.Vector3().crossVectors(v(0, 1, 0), tangent).normalize();
    if (right.lengthSq() < 0.01) right.set(1, 0, 0);
    const up = new THREE.Vector3().crossVectors(tangent, right).normalize();
    return { center, tangent, right, up,
      width: THREE.MathUtils.lerp(sections[index].width, sections[index + 1].width, u),
      height: THREE.MathUtils.lerp(sections[index].height, sections[index + 1].height, u) };
  };
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [], colors: number[] = [];
  const dark = new THREE.Color('#829da0'), light = new THREE.Color('#e0d8b4');
  for (let row = 0; row <= steps; row++) {
    const s = sample(row / steps);
    for (let column = 0; column <= sides; column++) {
      const angle = column / sides * Math.PI * 2;
      const normal = s.right.clone().multiplyScalar(Math.cos(angle)).addScaledVector(s.up, Math.sin(angle));
      const point = s.center.clone().addScaledVector(s.right, Math.cos(angle) * s.width).addScaledVector(s.up, Math.sin(angle) * s.height);
      positions.push(point.x, point.y, point.z); normals.push(normal.x, normal.y, normal.z);
      uvs.push(column / sides, row / steps);
      const color = dark.clone().lerp(light, THREE.MathUtils.smoothstep(-Math.sin(angle), -0.1, 0.8));
      colors.push(color.r, color.g, color.b);
      if (row < steps && column < sides) {
        const a = row * (sides + 1) + column, b = a + sides + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return { geometry, sample, curve };
}

export function taperedCurve(points: THREE.Vector3[], radius: number, tip = 0.005, steps = 28, sides = 12) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const frames = curve.computeFrenetFrames(steps, false);
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, point = curve.getPointAt(t);
    const r = THREE.MathUtils.lerp(radius, tip, Math.pow(t, 0.8)) * (1 + Math.sin(t * 70) * 0.015);
    for (let j = 0; j <= sides; j++) {
      const a = j / sides * Math.PI * 2;
      const p = point.clone().addScaledVector(frames.normals[i], Math.cos(a) * r).addScaledVector(frames.binormals[i], Math.sin(a) * r);
      positions.push(p.x, p.y, p.z); uvs.push(j / sides, t);
      if (i < steps && j < sides) {
        const a = i * (sides + 1) + j, b = a + sides + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

export function scaleGeometry() {
  const outline = [[0, 0.17], [-0.115, 0.075], [-0.105, -0.055], [0, -0.18], [0.105, -0.055], [0.115, 0.075]];
  const positions: number[] = [], uvs: number[] = [];
  for (let i = 0; i < outline.length; i++) {
    for (const [x, y, z] of [[0, 0.015, 0.045], [...outline[i], 0], [...outline[(i + 1) % outline.length], 0]]) {
      positions.push(x, y, z); uvs.push(x / 0.24 + 0.5, y / 0.36 + 0.5);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

export function membranePanel(wrist: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, side: number) {
  const positions: number[] = [], uvs: number[] = [], colors: number[] = [], indices: number[] = [];
  const steps = 22, columns = 18;
  for (let row = 0; row <= steps; row++) {
    const t = row / steps;
    for (let col = 0; col <= columns; col++) {
      const u = col / columns;
      const trailing = a.clone().lerp(b, u).lerp(wrist, Math.sin(u * Math.PI) * 0.19);
      const point = wrist.clone().lerp(trailing, t);
      point.y += Math.sin(u * Math.PI) * Math.sin(t * Math.PI) * 0.18;
      point.y += Math.sin(u * 30 + t * 10) * Math.sin(u * Math.PI) * Math.sin(t * Math.PI) * 0.015;
      positions.push(point.x, point.y, point.z); uvs.push(u, t);
      const tone = 0.62 + 0.38 * Math.pow(Math.abs(u - 0.5) * 2, 0.5);
      colors.push(tone, tone, tone);
      if (row < steps && col < columns) {
        const a = row * (columns + 1) + col, b = a + columns + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(side > 0 ? indices : indices.reduce<number[]>((all, _, i) => {
    if (i % 3 === 0) all.push(indices[i], indices[i + 2], indices[i + 1]);
    return all;
  }, []));
  geometry.computeVertexNormals();
  return geometry;
}
