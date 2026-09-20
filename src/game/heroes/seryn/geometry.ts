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
export function createSerynHeadGeometry(widthSegments = 128, heightSegments = 92) {
  const geometry = new THREE.SphereGeometry(1, widthSegments, heightSegments);
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const colors: number[] = [];

  const skin = new THREE.Color(0xc98773);
  const skinWarm = new THREE.Color(0xd79a84);
  const skinShadow = new THREE.Color(0xa96559);
  const eyeWhite = new THREE.Color(0xd9dcda);
  const iris = new THREE.Color(0x4aa5bd);
  const irisDark = new THREE.Color(0x244e61);
  const dark = new THREE.Color(0x1d242a);
  const brow = new THREE.Color(0x5a5258);
  const lip = new THREE.Color(0x7d4148);
  const innerEar = new THREE.Color(0xb56f66);

  const blendColor = (base: THREE.Color, target: THREE.Color, amount: number) => {
    base.lerp(target, THREE.MathUtils.clamp(amount, 0, 1));
  };

  for (let index = 0; index < position.count; index++) {
    let x = position.getX(index) * 0.162;
    let y = position.getY(index) * 0.235;
    let z = position.getZ(index) * 0.160;

    const rawX = x;
    const rawY = y;
    const rawZ = z;
    const front = smoothstep(0.010, 0.155, rawZ);

    // Feminine skull proportions with a tapered jaw and fuller cranium.
    const jawTaper = y < -0.010
      ? THREE.MathUtils.lerp(1, 0.64, smoothstep(-0.010, -0.198, y))
      : 1;
    x *= jawTaper;

    if (front > 0) {
      const central = Math.exp(-Math.pow(x / 0.127, 4));
      z -= 0.011 * central * front;

      for (const side of [-1, 1]) {
        const eyeSocket = gaussian2d(x, y, side * 0.057, 0.043, 0.043, 0.029);
        const upperLid = gaussian2d(x, y, side * 0.057, 0.062, 0.043, 0.013);
        const lowerLid = gaussian2d(x, y, side * 0.057, 0.024, 0.041, 0.012);
        const browShelf = gaussian2d(x, y, side * 0.057, 0.092, 0.050, 0.022);
        const cheek = gaussian2d(x, y, side * 0.084, -0.020, 0.053, 0.046);
        z -= 0.018 * eyeSocket * front;
        z += 0.0045 * upperLid * front;
        z += 0.0020 * lowerLid * front;
        z += 0.0065 * browShelf * front;
        z += 0.009 * cheek * front;
      }

      const noseBridge = gaussian2d(x, y, 0, 0.045, 0.020, 0.073);
      const noseTip = gaussian2d(x, y, 0, -0.024, 0.026, 0.022);
      const noseWingLeft = gaussian2d(x, y, -0.017, -0.029, 0.014, 0.014);
      const noseWingRight = gaussian2d(x, y, 0.017, -0.029, 0.014, 0.014);
      z += (0.029 * noseBridge + 0.026 * noseTip
        + 0.005 * noseWingLeft + 0.005 * noseWingRight) * front;

      const philtrum = gaussian2d(x, y, 0, -0.059, 0.016, 0.020);
      const upperLip = gaussian2d(x, y, 0, -0.081, 0.040, 0.011);
      const lowerLip = gaussian2d(x, y, 0, -0.101, 0.038, 0.014);
      const chin = gaussian2d(x, y, 0, -0.155, 0.054, 0.036);
      z -= 0.0035 * philtrum * front;
      z += 0.0085 * upperLip * front;
      z += 0.010 * lowerLip * front;
      z += 0.007 * chin * front;
    }

    // Sculpt a thin pointed ear from the side vertices of the SAME head shell.
    // The ear is flattened in depth, stretched laterally and then given helix/concha
    // relief instead of simply pushing the side of the skull into a round bump.
    const sign = rawX < 0 ? -1 : 1;
    const sideAbs = Math.abs(rawX);
    const lateral = smoothstep(0.118, 0.158, sideAbs);
    const earY = (rawY - 0.034) / 0.080;
    const earZ = (rawZ + 0.002) / 0.060;
    const earRadius = Math.sqrt(earY * earY + earZ * earZ);
    const earMask = lateral * (1 - smoothstep(0.78, 1.08, earRadius));

    if (earMask > 0.001) {
      const middleHeight = 1 - Math.min(1, Math.abs(earY));
      const tipBias = Math.pow(Math.max(0, middleHeight), 1.7)
        * Math.pow(Math.max(0, 1 - Math.abs(earZ)), 1.8);
      const outerTarget = 0.168 + 0.078 * tipBias;
      x = THREE.MathUtils.lerp(x, sign * outerTarget, earMask * 0.96);

      // Keep the ear thin like cartilage rather than a spherical lobe.
      const flattenedZ = -0.003 + rawZ * 0.30;
      z = THREE.MathUtils.lerp(z, flattenedZ, earMask * 0.88);

      // Slight upward lift at the pointed tip and natural lower lobe drop.
      y += earMask * (0.010 * tipBias - 0.004 * Math.max(0, -earY));

      // Helix rim and concha are relief on the connected surface.
      const rim = Math.exp(-Math.pow((earRadius - 0.72) / 0.14, 2));
      const concha = gaussian2d(rawZ, rawY, -0.002, 0.030, 0.030, 0.040);
      z += 0.007 * rim * earMask;
      z -= 0.010 * concha * earMask;
    }

    position.setXYZ(index, x, y, z);

    let color = skin.clone();

    // Smooth painted eye treatment on the connected face shell. The almond mask
    // avoids the large blocky white patches of the previous version.
    if (front > 0.52) {
      for (const side of [-1, 1]) {
        const dx = Math.abs((x - side * 0.057) / 0.041);
        const halfHeight = 0.0145 * Math.pow(Math.max(0, 1 - dx * dx), 0.62);
        const dy = Math.abs(y - 0.043);

        if (dx < 1 && halfHeight > 0) {
          const edge = 1 - THREE.MathUtils.clamp(dy / halfHeight, 0, 1);
          const eyeBlend = smoothstep(0.02, 0.70, edge);
          blendColor(color, eyeWhite, eyeBlend * 0.86);

          const irisRadius = Math.hypot(
            (x - side * 0.057) / 0.0115,
            (y - 0.043) / 0.0125,
          );
          if (irisRadius < 1.25) {
            const irisBlend = 1 - smoothstep(0.65, 1.25, irisRadius);
            blendColor(color, iris, irisBlend * 0.96);
            const pupilRadius = Math.hypot(
              (x - side * 0.057) / 0.0048,
              (y - 0.043) / 0.0062,
            );
            if (pupilRadius < 1.2) {
              blendColor(color, irisDark, 1 - smoothstep(0.50, 1.20, pupilRadius));
            }
          }
        }

        // Upper lid / lash and eyebrow are thin shaded bands on the same mesh.
        const lash = gaussian2d(x, y, side * 0.057, 0.058, 0.043, 0.0058);
        if (lash > 0.44) blendColor(color, dark, (lash - 0.44) * 1.45);

        const browBand = gaussian2d(x, y, side * 0.060, 0.091, 0.045, 0.0085);
        if (browBand > 0.48) blendColor(color, brow, (browBand - 0.48) * 1.70);
      }

      const mouth = gaussian2d(x, y, 0, -0.091, 0.040, 0.010);
      if (mouth > 0.42) blendColor(color, lip, (mouth - 0.42) * 1.55);

      const nostrilLeft = gaussian2d(x, y, -0.013, -0.031, 0.0055, 0.0042);
      const nostrilRight = gaussian2d(x, y, 0.013, -0.031, 0.0055, 0.0042);
      const nostril = Math.max(nostrilLeft, nostrilRight);
      if (nostril > 0.48) blendColor(color, dark, (nostril - 0.48) * 1.55);

      const cheekWarm = Math.max(
        gaussian2d(x, y, -0.092, -0.018, 0.050, 0.040),
        gaussian2d(x, y, 0.092, -0.018, 0.050, 0.040),
      );
      if (cheekWarm > 0.30) blendColor(color, skinWarm, cheekWarm * 0.18);
    }

    if (earMask > 0.001) {
      const conchaShade = gaussian2d(rawZ, rawY, -0.002, 0.030, 0.032, 0.042) * earMask;
      blendColor(color, innerEar, conchaShade * 0.42);
      const rimLight = Math.exp(-Math.pow((earRadius - 0.72) / 0.15, 2)) * earMask;
      blendColor(color, skinWarm, rimLight * 0.16);
      if (earY < -0.40) blendColor(color, skinShadow, earMask * 0.10);
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


/**
 * One connected hairstyle shell fitted to Seryn's skull.
 *
 * The crown, parting, temple curtains and shoulder-length back hair all belong to one
 * indexed surface. No tubes, cones or detached locks are used. The lower vertices carry
 * flex/phase attributes so the same mesh can be animated with secondary hair motion.
 */
export function createSerynHairGeometry(radialSegments = 112, verticalSegments = 52) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const flexValues: number[] = [];
  const phaseValues: number[] = [];
  const indices: number[] = [];

  const crownY = 0.255;
  const crownRadiusX = 0.178;
  const crownRadiusZ = 0.174;

  for (let row = 0; row <= verticalSegments; row++) {
    const v = row / verticalSegments;
    const capProgress = smoothstep(0, 0.44, v);
    const hanging = smoothstep(0.36, 1, v);

    for (let column = 0; column <= radialSegments; column++) {
      const u = column / radialSegments;
      const theta = -Math.PI + u * Math.PI * 2;
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);
      const frontness = Math.max(0, cosTheta);
      const backness = Math.max(0, -cosTheta);
      const side = Math.abs(sinTheta);

      // Hairline stays high in the centre of the forehead, then falls rapidly into
      // long temple curtains. Back/side hair reaches the upper shoulder line.
      const frontCenter = Math.exp(-0.5 * Math.pow(theta / 0.39, 2));
      const temple = Math.exp(-0.5 * Math.pow((Math.abs(theta) - 0.82) / 0.24, 2));
      const bottomY = -0.455 + 0.555 * frontCenter + 0.105 * temple;

      const yCurve = Math.pow(v, 0.92);
      const y = THREE.MathUtils.lerp(crownY, bottomY, yCurve);

      // Crown grows smoothly out of the part instead of starting as a hard cap.
      const crownSpread = Math.sin(capProgress * Math.PI * 0.5);
      const lowerTaper = 1 - 0.075 * hanging;
      const rx = crownRadiusX * crownSpread * lowerTaper;
      const rz = crownRadiusZ * crownSpread * (1 - 0.035 * hanging);

      // A real parting: upper-front vertices separate subtly left/right and the crown
      // gains a shallow central valley instead of a perfect hemisphere.
      const partInfluence = Math.exp(-Math.pow(theta / 0.34, 2)) * (1 - smoothstep(0.18, 0.58, v));
      const partDirection = theta === 0 ? 0 : Math.sign(theta);
      const partOffsetX = partDirection * 0.010 * partInfluence;
      const partValleyY = 0.009 * partInfluence;

      // Lower front-side hair falls almost vertically beside the face; back hair keeps
      // a fuller rounded silhouette. This prevents a helmet/bowl-cut appearance.
      const faceCurtain = hanging * frontness * side;
      const backFullness = hanging * backness;
      const x = sinTheta * rx
        + partOffsetX
        + Math.sign(sinTheta || 1) * 0.010 * faceCurtain;
      let z = cosTheta * rz;
      z = THREE.MathUtils.lerp(z, 0.068 * cosTheta, faceCurtain * 0.52);
      z -= 0.012 * backFullness;

      // Broad waves are actual surface undulation, while the fine strand detail comes
      // from the anisotropic-looking procedural hair material.
      const wave = Math.sin(theta * 5.0 + v * 3.2) * 0.0045 * hanging;
      const fine = Math.sin(theta * 23.0 + v * 5.0) * 0.0015 * (0.25 + hanging * 0.75);
      const radialNormalX = sinTheta;
      const radialNormalZ = cosTheta;

      positions.push(
        x + radialNormalX * (wave + fine),
        y - partValleyY,
        z + radialNormalZ * (wave + fine),
      );
      uvs.push(u, v);

      // Only the hanging lengths flex strongly. Crown vertices remain stable against
      // the skull so the hairstyle can be animated without looking rubbery.
      const flex = hanging * hanging * (0.55 + 0.45 * Math.max(side, backness));
      flexValues.push(flex);
      phaseValues.push(theta + v * 2.6);
    }
  }

  const stride = radialSegments + 1;
  for (let row = 0; row < verticalSegments; row++) {
    for (let column = 0; column < radialSegments; column++) {
      const a = row * stride + column;
      const b = a + 1;
      const d = (row + 1) * stride + column;
      const c = d + 1;
      // Outward-facing winding for the shell.
      indices.push(a, d, b, b, d, c);
    }
  }

  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  result.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  result.setAttribute('hairFlex', new THREE.Float32BufferAttribute(flexValues, 1));
  result.setAttribute('hairPhase', new THREE.Float32BufferAttribute(phaseValues, 1));
  result.setIndex(indices);
  result.computeVertexNormals();
  result.computeBoundingBox();
  result.computeBoundingSphere();

  const position = result.getAttribute('position') as THREE.BufferAttribute;
  result.userData.serynHairBasePositions = new Float32Array(position.array as ArrayLike<number>);
  return result;
}
