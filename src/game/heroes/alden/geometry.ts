import * as THREE from 'three';

export type Section = {
  y: number;
  width: number;
  front: number;
  back: number;
  offset?: number;
};

export type Surface = (across: number, down: number) => THREE.Vector3;

export function createLoftGeometry(sections: Section[], sides = 12) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const [row, section] of sections.entries()) {
    for (let column = 0; column <= sides; column += 1) {
      const angle = column / sides * Math.PI * 2;
      const cosine = Math.cos(angle);
      positions.push(
        Math.sin(angle) * section.width,
        section.y,
        cosine * (cosine >= 0 ? section.front : section.back) + (section.offset ?? 0),
      );
      uvs.push(column / sides, row / (sections.length - 1));
      if (row < sections.length - 1 && column < sides) {
        const vertex = row * (sides + 1) + column;
        indices.push(vertex, vertex + 1, vertex + sides + 2, vertex, vertex + sides + 2, vertex + sides + 1);
      }
    }
  }
  for (const row of [0, sections.length - 1]) {
    const section = sections[row];
    const center = positions.length / 3;
    positions.push(0, section.y, section.offset ?? 0);
    uvs.push(0.5, row === 0 ? 0 : 1);
    for (let column = 0; column < sides; column += 1) {
      const vertex = row * (sides + 1) + column;
      if (row === 0) indices.push(center, vertex + 1, vertex);
      else indices.push(center, vertex, vertex + 1);
    }
  }
  return makeGeometry(positions, uvs, indices);
}

export function createSurfaceGeometry(surface: Surface, columns: number, rows: number, front = false) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      const across = column / columns * 2 - 1;
      const down = row / rows;
      const point = surface(across, down);
      positions.push(point.x, point.y, point.z);
      uvs.push(column / columns, 1 - down);
      if (row < rows && column < columns) {
        const vertex = row * (columns + 1) + column;
        const next = vertex + columns + 1;
        if (front) indices.push(vertex, next, vertex + 1, vertex + 1, next, next + 1);
        else indices.push(vertex, vertex + 1, next, vertex + 1, next + 1, next);
      }
    }
  }
  return makeGeometry(positions, uvs, indices);
}

function makeGeometry(positions: number[], uvs: number[], indices: number[]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

const breastplateSections: Section[] = [
    { y: -0.43, width: 0.285, front: 0.22, back: 0.19 },
    { y: -0.31, width: 0.30, front: 0.245, back: 0.20 },
    { y: -0.08, width: 0.38, front: 0.305, back: 0.23 },
    { y: 0.16, width: 0.445, front: 0.32, back: 0.235 },
    { y: 0.32, width: 0.425, front: 0.26, back: 0.21 },
    { y: 0.43, width: 0.29, front: 0.18, back: 0.17 },
];

export function createBreastplateGeometry() {
  return createLoftGeometry(breastplateSections);
}

export const breastclothSurface: Surface = (across, down) => {
  const width = THREE.MathUtils.lerp(0.29, 0.205, down) + Math.sin(down * Math.PI) * 0.032;
  const horizontal = across * width;
  const vertical = 0.335 - down * 0.745 - (1 - Math.abs(across)) * 0.032 * (1 - down);
  const upperIndex = Math.max(1, breastplateSections.findIndex(section => section.y >= vertical));
  const lower = breastplateSections[upperIndex - 1];
  const upper = breastplateSections[upperIndex];
  const fraction = (vertical - lower.y) / (upper.y - lower.y);
  const chestWidth = THREE.MathUtils.lerp(lower.width, upper.width, fraction);
  const chestDepth = THREE.MathUtils.lerp(lower.front, upper.front, fraction);
  return new THREE.Vector3(
    horizontal, vertical,
    chestDepth * Math.sqrt(1 - (horizontal / chestWidth) ** 2) + 0.018,
  );
};

export const capeSurface: Surface = (across, down) => {
  const halfWidth = 0.32 + 0.40 * Math.pow(down, 0.72);
  const pleat = Math.cos(across * Math.PI * 4) * (0.024 + 0.045 * down);
  return new THREE.Vector3(
    across * halfWidth,
    -1.86 * down + Math.pow(down, 6) * (0.13 * Math.pow(Math.abs(across), 1.5) + 0.025 * Math.cos(across * Math.PI * 3)),
    -0.05 - 0.24 * down * down - pleat + 0.065 * across * across,
  );
};

export const mantleSections: Section[] = [
  { y: 0.315, width: 0.275, front: 0.22, back: 0.23 },
  { y: 0.38, width: 0.37, front: 0.24, back: 0.24 },
  { y: 0.47, width: 0.26, front: 0.19, back: 0.19 },
  { y: 0.51, width: 0.20, front: 0.15, back: 0.16 },
];

export function createCapeSurface(neckBlend = 0): Surface {
  if (neckBlend === 0) return capeSurface;
  const height = 0.40;
  const lower = mantleSections[1];
  const upper = mantleSections[2];
  const fraction = (height - lower.y) / (upper.y - lower.y);
  const width = THREE.MathUtils.lerp(lower.width, upper.width, fraction);
  const depth = THREE.MathUtils.lerp(lower.back, upper.back, fraction);
  return (across, down) => {
    const point = capeSurface(across, down);
    const blend = (1 - THREE.MathUtils.smoothstep(down, 0, 0.20)) * neckBlend;
    if (blend === 0) return point;
    const segment = (Math.PI - across * Math.PI * 0.36) / (Math.PI * 2) * 12;
    const start = Math.floor(segment);
    const ringPoint = (index: number) => {
      const angle = index / 12 * Math.PI * 2;
      return new THREE.Vector3(Math.sin(angle) * width, 0, Math.cos(angle) * depth);
    };
    const attachment = ringPoint(start).lerp(ringPoint(start + 1), segment - start).multiplyScalar(0.94);
    attachment.y = height - 0.37;
    attachment.z += 0.25;
    return point.addScaledVector(attachment.sub(capeSurface(across, 0)), blend);
  };
}

export function createCapeGeometry(neckBlend = 0) {
  return createSurfaceGeometry(createCapeSurface(neckBlend), 32, 24);
}

export const pauldronSurface: Surface = (across, down) => {
  const angle = across * Math.PI * 0.49;
  const arch = 0.14 + down * 2.04;
  const spread = Math.sin(arch);
  return new THREE.Vector3(
    -0.035 + spread * Math.cos(angle) * 0.255,
    0.02 + Math.cos(arch) * 0.20 - Math.abs(across) * spread * 0.04,
    Math.sin(angle) * spread * 0.24,
  );
};

export function createPauldronSurface(neckBlend = 0): Surface {
  if (neckBlend === 0) return pauldronSurface;
  return (across, down) => {
    const point = pauldronSurface(across, down);
    const blend = (1 - THREE.MathUtils.smoothstep(down, 0, 0.65)) * neckBlend;
    point.x -= 0.19 * blend;
    point.y -= 0.035 * blend;
    point.z += across * 0.075 * blend;
    return point;
  };
}

export function createPauldronGeometry(neckBlend = 0) {
  return createSurfaceGeometry(createPauldronSurface(neckBlend), 10, 5);
}

export function createGreaveGeometry() {
  return createLoftGeometry([
    { y: -0.54, width: 0.092, front: 0.09, back: 0.08 },
    { y: -0.45, width: 0.10, front: 0.12, back: 0.09 },
    { y: -0.25, width: 0.132, front: 0.17, back: 0.11 },
    { y: -0.08, width: 0.143, front: 0.155, back: 0.11 },
    { y: 0.01, width: 0.12, front: 0.115, back: 0.09 },
  ], 10);
}

export function createBootGeometry(sole = false) {
  const sections = sole ? [
    { y: 0.015, width: 0.135, front: 0.30, back: 0.115, offset: 0.05 },
    { y: 0.065, width: 0.137, front: 0.30, back: 0.115, offset: 0.05 },
  ] : [
    { y: 0.055, width: 0.132, front: 0.29, back: 0.11, offset: 0.05 },
    { y: 0.115, width: 0.13, front: 0.27, back: 0.105, offset: 0.045 },
    { y: 0.175, width: 0.112, front: 0.20, back: 0.10, offset: 0.025 },
    { y: 0.23, width: 0.095, front: 0.10, back: 0.085 },
    { y: 0.31, width: 0.095, front: 0.08, back: 0.075 },
  ];
  return createLoftGeometry(sections, 12);
}

export function createSwordGeometry() {
  return createLoftGeometry([
    { y: -1.52, width: 0.002, front: 0.002, back: 0.002 },
    { y: -1.25, width: 0.068, front: 0.022, back: 0.022 },
    { y: -0.32, width: 0.10, front: 0.031, back: 0.031 },
    { y: -0.23, width: 0.095, front: 0.031, back: 0.031 },
  ], 4);
}

export function createPlateGeometry(points: Array<[number, number]>, depth = 0.035, bevel = 0.012) {
  const shape = new THREE.Shape();
  points.forEach(([horizontal, vertical], index) => {
    if (index === 0) shape.moveTo(horizontal, vertical);
    else shape.lineTo(horizontal, vertical);
  });
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel,
    bevelSegments: 1, steps: 1, curveSegments: 1,
  });
}

export function createEmblemGeometry(surface: Surface, width: number, top: number, height: number, offset: number) {
  return createProjectedShapeGeometry(
    [[0, 0], [0.18, 0.28], [0.52, 0.40], [0.17, 0.53], [0, 1], [-0.17, 0.53], [-0.52, 0.40], [-0.18, 0.28]],
    (horizontal, vertical) => {
      const point = surface(horizontal * width, top + vertical * height);
      point.z += offset;
      return point;
    },
  );
}

export function createProjectedShapeGeometry(outline: Array<[number, number]>, surface: Surface) {
  const shape = new THREE.Shape();
  outline.forEach(([horizontal, vertical], index) => {
    if (index === 0) shape.moveTo(horizontal, vertical);
    else shape.lineTo(horizontal, vertical);
  });
  shape.closePath();
  const outlineGeometry = new THREE.ShapeGeometry(shape);
  const source = outlineGeometry.toNonIndexed();
  const position = source.getAttribute('position');
  let vertices = Array.from({ length: position.count }, (_, vertex) => new THREE.Vector2(position.getX(vertex), position.getY(vertex)));
  for (let level = 0; level < 3; level += 1) {
    const subdivided: THREE.Vector2[] = [];
    for (let vertex = 0; vertex < vertices.length; vertex += 3) {
      const first = vertices[vertex];
      const second = vertices[vertex + 1];
      const third = vertices[vertex + 2];
      const firstMid = first.clone().lerp(second, 0.5);
      const secondMid = second.clone().lerp(third, 0.5);
      const thirdMid = third.clone().lerp(first, 0.5);
      subdivided.push(first, firstMid, thirdMid, firstMid, second, secondMid, thirdMid, secondMid, third, firstMid, secondMid, thirdMid);
    }
    vertices = subdivided;
  }
  const coordinates: number[] = [];
  const uvs: number[] = [];
  for (const vertex of vertices) {
    const point = surface(vertex.x, vertex.y);
    coordinates.push(point.x, point.y, point.z);
    uvs.push(vertex.x + 0.5, 1 - vertex.y);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(coordinates, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  source.dispose();
  outlineGeometry.dispose();
  return geometry;
}

export function createSurfaceRibbon(surface: Surface, start: THREE.Vector2, end: THREE.Vector2, width: number, offset: number) {
  const direction = end.clone().sub(start).normalize();
  return createSurfaceGeometry((across, down) => {
    const horizontal = THREE.MathUtils.lerp(start.x, end.x, down) + direction.y * across * width / 2;
    const vertical = THREE.MathUtils.lerp(start.y, end.y, down) - direction.x * across * width / 2;
    const point = surface(horizontal, vertical);
    point.z += offset;
    return point;
  }, 2, 24);
}