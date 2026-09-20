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

function gaussian2d(x: number, y: number, cx: number, cy: number, sx: number, sy: number) {
  const dx = (x - cx) / sx;
  const dy = (y - cy) / sy;
  return Math.exp(-(dx * dx + dy * dy) * 0.5);
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * High-density single-shell head mesh for Seryn.
 *
 * Nose bridge/tip, eye sockets, brow ridge, cheekbones, lips, chin and pointed ears are
 * all deformations of this one connected surface. Facial colour details are stored as
 * vertex colours on the same geometry so the face does not rely on separate eyeball,
 * nose or lip meshes.
 */
export function createSerynHeadGeometry(widthSegments = 112, heightSegments = 80) {
  const geometry = new THREE.SphereGeometry(1, widthSegments, heightSegments);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const colors: number[] = [];

  const skin = new THREE.Color(0xc98773);
  const skinWarm = new THREE.Color(0xd39680);
  const eyeWhite = new THREE.Color(0xe9e5df);
  const iris = new THREE.Color(0x46bdd9);
  const dark = new THREE.Color(0x17222c);
  const brow = new THREE.Color(0x707e8c);
  const lip = new THREE.Color(0x82474c);

  for (let index = 0; index < position.count; index++) {
    let x = position.getX(index) * 0.162;
    let y = position.getY(index) * 0.235;
    let z = position.getZ(index) * 0.160;

    const originalZ = z;
    const front = smoothstep(0.010, 0.155, originalZ);

    // Feminine skull / jaw proportions: full cranium, tapered lower face and a
    // slightly narrower chin without a separate jaw piece.
    const jawTaper = y < -0.015
      ? THREE.MathUtils.lerp(1, 0.66, smoothstep(-0.015, -0.195, y))
      : 1;
    x *= jawTaper;

    if (front > 0) {
      // Flatten the central face slightly before sculpting features, leaving the
      // temples and cranium round.
      const central = Math.exp(-Math.pow(x / 0.125, 4));
      z -= 0.012 * central * front;

      // Eye sockets and upper eyelid shelf are carved into the same skin shell.
      for (const side of [-1, 1]) {
        const eyeSocket = gaussian2d(x, y, side * 0.057, 0.044, 0.040, 0.027);
        const browShelf = gaussian2d(x, y, side * 0.056, 0.092, 0.047, 0.021);
        const cheek = gaussian2d(x, y, side * 0.083, -0.020, 0.052, 0.046);
        const temple = gaussian2d(x, y, side * 0.132, 0.055, 0.035, 0.065);
        z -= 0.021 * eyeSocket * front;
        z += 0.008 * browShelf * front;
        z += 0.010 * cheek * front;
        z -= 0.004 * temple * front;
      }

      // Nose: bridge, nasal ridge and tip are continuous displacements of the face.
      const noseBridge = gaussian2d(x, y, 0, 0.042, 0.021, 0.075);
      const noseTip = gaussian2d(x, y, 0, -0.024, 0.026, 0.022);
      const noseRoot = gaussian2d(x, y, 0, 0.095, 0.024, 0.030);
      z += (0.029 * noseBridge + 0.028 * noseTip - 0.004 * noseRoot) * front;

      // Philtrum, upper/lower lip and chin are part of the shell as well.
      const philtrum = gaussian2d(x, y, 0, -0.058, 0.018, 0.020);
      const upperLip = gaussian2d(x, y, 0, -0.082, 0.043, 0.012);
      const lowerLip = gaussian2d(x, y, 0, -0.100, 0.039, 0.014);
      const chin = gaussian2d(x, y, 0, -0.154, 0.055, 0.036);
      z -= 0.004 * philtrum * front;
      z += 0.010 * upperLip * front;
      z += 0.011 * lowerLip * front;
      z += 0.007 * chin * front;
    }

    // Integrated elf-like ears. Vertices already belonging to the side of the cranium
    // are pulled outward; no cone or separate ear object is attached.
    const sideAbs = Math.abs(x);
    const sideWeight = smoothstep(0.112, 0.153, sideAbs);
    const earBand = gaussian2d(originalZ, y, 0.000, 0.035, 0.070, 0.058);
    if (sideWeight > 0 && earBand > 0.02) {
      const sign = x < 0 ? -1 : 1;
      x += sign * 0.050 * sideWeight * earBand;
      y += 0.012 * sideWeight * earBand;
    }

    position.setXYZ(index, x, y, z);

    // One connected face mesh, with facial details painted through vertex colours.
    let color = skin.clone();
    if (front > 0.58) {
      for (const side of [-1, 1]) {
        const ex = (x - side * 0.057) / 0.042;
        const ey = (y - 0.044) / 0.0165;
        const eyeRadius = ex * ex + ey * ey;
        if (eyeRadius < 1) color = eyeWhite.clone();

        const ix = (x - side * 0.057) / 0.013;
        const iy = (y - 0.044) / 0.013;
        if (ix * ix + iy * iy < 1) color = iris.clone();

        const px = (x - side * 0.057) / 0.0055;
        const py = (y - 0.044) / 0.007;
        if (px * px + py * py < 1) color = dark.clone();

        const browBand = gaussian2d(x, y, side * 0.060, 0.091, 0.045, 0.009);
        if (browBand > 0.56) color = brow.clone();
      }

      const mouth = gaussian2d(x, y, 0, -0.091, 0.044, 0.012);
      if (mouth > 0.52) color = lip.clone();

      const nostrilLeft = gaussian2d(x, y, -0.013, -0.031, 0.006, 0.0045);
      const nostrilRight = gaussian2d(x, y, 0.013, -0.031, 0.006, 0.0045);
      if (nostrilLeft > 0.55 || nostrilRight > 0.55) color = dark.clone();

      const cheekWarm = Math.max(
        gaussian2d(x, y, -0.092, -0.018, 0.050, 0.040),
        gaussian2d(x, y, 0.092, -0.018, 0.050, 0.040),
      );
      if (cheekWarm > 0.36 && color.equals(skin)) {
        color.lerp(skinWarm, Math.min(0.24, cheekWarm * 0.20));
      }
    }

    colors.push(color.r, color.g, color.b);
  }

  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
