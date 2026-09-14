import * as THREE from 'three';
import { BASE_LAYOUT, getTeamStartBaseServiceOpening } from './mapLayout';
import { installTeamStartBase } from './teamStartBase';

type BasePresentationMaterials = {
  stoneDark: THREE.MeshStandardMaterial;
  stoneLight: THREE.MeshStandardMaterial;
  stoneWarm: THREE.MeshStandardMaterial;
  rampStoneA: THREE.MeshStandardMaterial;
  rampStoneB: THREE.MeshStandardMaterial;
  rampStoneC: THREE.MeshStandardMaterial;
  rampJoint: THREE.MeshStandardMaterial;
  factionTrim: THREE.MeshStandardMaterial;
  factionGlow: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
};

const RAMP_INNER_RADIUS = BASE_LAYOUT.radius - 1.75;
const RAMP_BASE_RADIUS = BASE_LAYOUT.radius + 0.08;
const RAMP_OUTER_RADIUS = BASE_LAYOUT.radius + BASE_LAYOUT.rampLength * 0.86;
const RAMP_HALF_WIDTH = BASE_LAYOUT.rampWidth / 2;
const RAMP_HIGH = BASE_LAYOUT.elevation + 0.19;
const RAMP_LOW = 0.045;
const RAMP_BOTTOM = 0.015;

export function upgradeBasePresentation(
  battlefield: THREE.Group,
  team: 'blue' | 'red',
  center: { x: number; z: number },
) {
  const citadel = battlefield.getObjectByName(`${team}-base`) as THREE.Group | undefined;
  if (!citadel) return;

  const materials = createPresentationMaterials(team);

  // The authored citadel is meant to sit on an elevated plaza. Keep all of its
  // architecture together and lift it as a single unit so towers/walls/core remain aligned.
  citadel.position.y = BASE_LAYOUT.elevation;

  const serviceOpening = getTeamStartBaseServiceOpening(team);
  if (serviceOpening) {
    carveCitadelServiceOpening(citadel, serviceOpening.angle, serviceOpening.halfAngle);
  }

  const elevation = buildBaseElevation(team, materials);
  elevation.position.set(center.x, 0, center.z);
  battlefield.add(elevation);

  replaceLegacyThroneCrystal(citadel, team, materials);
  if (team === 'blue') installTeamStartBase(battlefield, team);
}

function createPresentationMaterials(team: 'blue' | 'red'): BasePresentationMaterials {
  const blue = team === 'blue';
  return {
    stoneDark: new THREE.MeshStandardMaterial({
      color: blue ? 0x46545d : 0x594849,
      roughness: 0.94,
      metalness: 0.02,
    }),
    stoneLight: new THREE.MeshStandardMaterial({
      color: blue ? 0xaaa38b : 0xae988a,
      roughness: 0.9,
      metalness: 0.025,
    }),
    stoneWarm: new THREE.MeshStandardMaterial({
      color: blue ? 0x908b74 : 0x948078,
      roughness: 0.92,
      metalness: 0.02,
    }),
    rampStoneA: new THREE.MeshStandardMaterial({
      color: blue ? 0x706c5b : 0x76645e,
      roughness: 0.95,
      metalness: 0.012,
    }),
    rampStoneB: new THREE.MeshStandardMaterial({
      color: blue ? 0x807a66 : 0x806d65,
      roughness: 0.94,
      metalness: 0.014,
    }),
    rampStoneC: new THREE.MeshStandardMaterial({
      color: blue ? 0x5a594c : 0x62524f,
      roughness: 0.97,
      metalness: 0.01,
    }),
    rampJoint: new THREE.MeshStandardMaterial({
      color: blue ? 0x303535 : 0x3c3031,
      roughness: 0.98,
      metalness: 0.02,
    }),
    factionTrim: new THREE.MeshStandardMaterial({
      color: blue ? 0x3f7fac : 0x994d48,
      roughness: 0.52,
      metalness: 0.36,
    }),
    factionGlow: new THREE.MeshStandardMaterial({
      color: blue ? 0x6aa8c0 : 0xb5695f,
      emissive: blue ? 0x12394c : 0x491817,
      emissiveIntensity: 0.38,
      roughness: 0.52,
      metalness: 0.3,
    }),
    metal: new THREE.MeshStandardMaterial({
      color: blue ? 0x3d4746 : 0x4b4040,
      roughness: 0.48,
      metalness: 0.48,
    }),
  };
}

function buildBaseElevation(
  team: 'blue' | 'red',
  materials: BasePresentationMaterials,
) {
  const group = new THREE.Group();
  group.name = `${team}-base-elevation`;

  const rotation = team === 'blue' ? 0 : Math.PI;
  const gateAngles = BASE_LAYOUT.gates.map(angle => angle + rotation);
  const serviceOpening = getTeamStartBaseServiceOpening(team);

  const wallRadius = BASE_LAYOUT.radius - 0.02;
  const rampRailHalfWidth = BASE_LAYOUT.rampWidth / 2 + 0.14;
  const gateMargin = 0.10;
  const gateHalfAngle = Math.asin(
    Math.min(0.999, (rampRailHalfWidth + gateMargin) / wallRadius),
  );

  const wallThickness = 0.66;
  const wallSegments = 144;
  const segmentAngle = Math.PI * 2 / wallSegments;
  const segmentWidth = 2 * wallRadius * Math.sin(segmentAngle / 2) * 1.08;

  for (let index = 0; index < wallSegments; index++) {
    const angle = (index + 0.5) * segmentAngle;
    const blockedByGate = gateAngles.some(gate => angularDistance(angle, gate) < gateHalfAngle);
    const blockedByService = serviceOpening
      ? angularDistance(angle, serviceOpening.angle) < serviceOpening.halfAngle
      : false;
    if (blockedByGate || blockedByService) continue;

    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(segmentWidth, BASE_LAYOUT.elevation, wallThickness),
      materials.stoneDark,
    );
    wall.position.set(
      Math.cos(angle) * wallRadius,
      BASE_LAYOUT.elevation / 2,
      Math.sin(angle) * wallRadius,
    );
    wall.rotation.y = Math.PI / 2 - angle;
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);

    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(segmentWidth, 0.14, wallThickness + 0.14),
      materials.stoneLight,
    );
    cap.position.set(
      Math.cos(angle) * wallRadius,
      BASE_LAYOUT.elevation + 0.07,
      Math.sin(angle) * wallRadius,
    );
    cap.rotation.y = Math.PI / 2 - angle;
    cap.castShadow = true;
    cap.receiveShadow = true;
    group.add(cap);
  }

  const plaza = new THREE.Mesh(
    new THREE.CircleGeometry(BASE_LAYOUT.radius - 0.42, 128),
    materials.stoneWarm,
  );
  plaza.name = `${team}-base-plaza`;
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = BASE_LAYOUT.elevation + 0.018;
  plaza.userData.commandSurface = true;
  plaza.receiveShadow = true;
  group.add(plaza);

  for (const angle of gateAngles) {
    const ramp = new THREE.Mesh(createRampGeometry(angle), materials.rampJoint);
    ramp.name = `${team}-base-ramp`;
    ramp.userData.commandSurface = true;
    ramp.castShadow = true;
    ramp.receiveShadow = true;
    group.add(ramp);

    group.add(createRampSurfaceDetails(angle, materials));
    group.add(createRampThreshold(angle, materials));
    group.add(createRampApproach(angle, materials));

    for (const side of [-1, 1]) {
      group.add(createRampRail(angle, side, materials));
    }
  }

  return group;
}

function carveCitadelServiceOpening(citadel: THREE.Group, angle: number, halfAngle: number) {
  for (const child of [...citadel.children]) {
    if (!(child instanceof THREE.Mesh)) continue;
    const position = child.geometry.getAttribute('position');
    if (!position || position.count < 3) continue;

    const source = child.geometry.index ? child.geometry.toNonIndexed() : child.geometry.clone();
    const sourcePosition = source.getAttribute('position');
    const sourceUv = source.getAttribute('uv');
    const keptPositions: number[] = [];
    const keptUvs: number[] = [];
    let removed = 0;

    for (let vertex = 0; vertex + 2 < sourcePosition.count; vertex += 3) {
      const ax = sourcePosition.getX(vertex);
      const ay = sourcePosition.getY(vertex);
      const az = sourcePosition.getZ(vertex);
      const bx = sourcePosition.getX(vertex + 1);
      const by = sourcePosition.getY(vertex + 1);
      const bz = sourcePosition.getZ(vertex + 1);
      const cx = sourcePosition.getX(vertex + 2);
      const cy = sourcePosition.getY(vertex + 2);
      const cz = sourcePosition.getZ(vertex + 2);
      const x = (ax + bx + cx) / 3;
      const y = (ay + by + cy) / 3;
      const z = (az + bz + cz) / 3;
      const radius = Math.hypot(x, z);
      const triangleAngle = Math.atan2(z, x);
      const inServiceArc = radius >= BASE_LAYOUT.radius - 1.25
        && radius <= BASE_LAYOUT.radius + 1.25
        && y >= -0.6
        && y <= 4.3
        && angularDistance(triangleAngle, angle) < halfAngle + 0.035;
      if (inServiceArc) {
        removed++;
        continue;
      }
      for (let offset = 0; offset < 3; offset++) {
        const index = vertex + offset;
        keptPositions.push(
          sourcePosition.getX(index),
          sourcePosition.getY(index),
          sourcePosition.getZ(index),
        );
        if (sourceUv) keptUvs.push(sourceUv.getX(index), sourceUv.getY(index));
      }
    }

    if (removed === 0) {
      source.dispose();
      continue;
    }

    const carved = new THREE.BufferGeometry();
    carved.setAttribute('position', new THREE.Float32BufferAttribute(keptPositions, 3));
    if (sourceUv && keptUvs.length > 0) carved.setAttribute('uv', new THREE.Float32BufferAttribute(keptUvs, 2));
    carved.computeVertexNormals();
    carved.computeBoundingBox();
    carved.computeBoundingSphere();
    child.geometry.dispose();
    source.dispose();
    child.geometry = carved;
  }
}

function angularDistance(a: number, b: number) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

function rampHeightAt(radius: number) {
  if (radius <= RAMP_BASE_RADIUS) return RAMP_HIGH;
  if (radius >= RAMP_OUTER_RADIUS) return RAMP_LOW;
  const t = (RAMP_OUTER_RADIUS - radius) / (RAMP_OUTER_RADIUS - RAMP_BASE_RADIUS);
  return THREE.MathUtils.lerp(RAMP_LOW, RAMP_HIGH, t);
}

function rampPoint(angle: number, radius: number, lateral: number, yOffset = 0) {
  const radialX = Math.cos(angle);
  const radialZ = Math.sin(angle);
  const tangentX = -radialZ;
  const tangentZ = radialX;
  return new THREE.Vector3(
    radialX * radius + tangentX * lateral,
    rampHeightAt(radius) + yOffset,
    radialZ * radius + tangentZ * lateral,
  );
}

function createRampPanelGeometry(
  angle: number,
  outerRadius: number,
  innerRadius: number,
  outerMinLateral: number,
  outerMaxLateral: number,
  innerMinLateral: number,
  innerMaxLateral: number,
  yOffset: number,
) {
  const outerLeft = rampPoint(angle, outerRadius, outerMaxLateral, yOffset);
  const outerRight = rampPoint(angle, outerRadius, outerMinLateral, yOffset);
  const innerLeft = rampPoint(angle, innerRadius, innerMaxLateral, yOffset);
  const innerRight = rampPoint(angle, innerRadius, innerMinLateral, yOffset);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    ...outerLeft.toArray(), ...outerRight.toArray(),
    ...innerLeft.toArray(), ...innerRight.toArray(),
  ], 3));
  geometry.setIndex([0, 1, 2, 1, 3, 2]);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function addRampPanel(
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  name: string,
) {
  const panel = new THREE.Mesh(geometry, material);
  panel.name = name;
  panel.receiveShadow = true;
  group.add(panel);
  return panel;
}

function createRampSurfaceDetails(angle: number, materials: BasePresentationMaterials) {
  const group = new THREE.Group();
  group.name = 'base-ramp-surface-details';
  const segmentCount = 7;
  const panelHalfWidth = RAMP_HALF_WIDTH - 0.48;
  const sideBandInner = panelHalfWidth + 0.08;
  const sideBandOuter = RAMP_HALF_WIDTH - 0.10;
  const slabMaterials = [materials.rampStoneA, materials.rampStoneB, materials.rampStoneA,
    materials.rampStoneC, materials.rampStoneB, materials.rampStoneA, materials.rampStoneB];

  for (let index = 0; index < segmentCount; index++) {
    const outerT = (index + 0.055) / segmentCount;
    const innerT = (index + 0.945) / segmentCount;
    const outerRadius = THREE.MathUtils.lerp(RAMP_OUTER_RADIUS, RAMP_BASE_RADIUS, outerT);
    const innerRadius = THREE.MathUtils.lerp(RAMP_OUTER_RADIUS, RAMP_BASE_RADIUS, innerT);
    const widthVariation = index === 0 ? -0.16 : index === 1 ? -0.08 : index >= 5 ? 0.08 : 0;
    const outerHalfWidth = panelHalfWidth + widthVariation;
    const innerHalfWidth = panelHalfWidth + (index >= 4 ? 0.08 : widthVariation * 0.45);

    addRampPanel(
      group,
      createRampPanelGeometry(
        angle, outerRadius, innerRadius,
        -outerHalfWidth, outerHalfWidth, -innerHalfWidth, innerHalfWidth, 0.008,
      ),
      slabMaterials[index],
      `base-ramp-slab-${index + 1}`,
    );

    for (const side of [-1, 1]) {
      const outerMin = side > 0 ? sideBandInner : -sideBandOuter;
      const outerMax = side > 0 ? sideBandOuter : -sideBandInner;
      addRampPanel(
        group,
        createRampPanelGeometry(
          angle, outerRadius, innerRadius,
          outerMin, outerMax, outerMin, outerMax, 0.010,
        ),
        index % 2 === 0 ? materials.rampStoneB : materials.rampStoneC,
        `base-ramp-side-band-${index + 1}`,
      );
    }

    addRampPanel(
      group,
      createRampPanelGeometry(
        angle, outerRadius, innerRadius,
        -0.11, 0.11, -0.11, 0.11, 0.014,
      ),
      index === 3 ? materials.factionGlow : materials.factionTrim,
      `base-ramp-center-inlay-${index + 1}`,
    );
  }

  return group;
}

function createRampThreshold(angle: number, materials: BasePresentationMaterials) {
  const group = new THREE.Group();
  group.name = 'base-ramp-threshold';

  addRampPanel(
    group,
    createRampPanelGeometry(
      angle,
      RAMP_BASE_RADIUS - 0.04,
      RAMP_INNER_RADIUS + 0.10,
      -RAMP_HALF_WIDTH + 0.14,
      RAMP_HALF_WIDTH - 0.14,
      -RAMP_HALF_WIDTH + 0.22,
      RAMP_HALF_WIDTH - 0.22,
      0.008,
    ),
    materials.rampStoneB,
    'base-ramp-landing-stone',
  );

  const thresholdOuter = RAMP_BASE_RADIUS - 0.22;
  const thresholdInner = RAMP_BASE_RADIUS - 0.54;
  addRampPanel(
    group,
    createRampPanelGeometry(
      angle, thresholdOuter, thresholdInner,
      -RAMP_HALF_WIDTH + 0.12, RAMP_HALF_WIDTH - 0.12,
      -RAMP_HALF_WIDTH + 0.16, RAMP_HALF_WIDTH - 0.16,
      0.016,
    ),
    materials.rampStoneB,
    'base-ramp-threshold-band',
  );

  addRampPanel(
    group,
    createRampPanelGeometry(
      angle, thresholdOuter - 0.055, thresholdInner + 0.055,
      -0.78, 0.78, -0.72, 0.72, 0.022,
    ),
    materials.factionTrim,
    'base-ramp-threshold-faction-inlay',
  );

  for (const side of [-1, 1]) {
    addRampPanel(
      group,
      createRampPanelGeometry(
        angle,
        RAMP_BASE_RADIUS - 0.66,
        RAMP_INNER_RADIUS + 0.28,
        side > 0 ? 1.86 : -2.34,
        side > 0 ? 2.34 : -1.86,
        side > 0 ? 1.75 : -2.24,
        side > 0 ? 2.24 : -1.75,
        0.013,
      ),
      materials.rampStoneC,
      'base-ramp-landing-side-panel',
    );
  }

  return group;
}

function createRampApproach(angle: number, materials: BasePresentationMaterials) {
  const group = new THREE.Group();
  group.name = 'base-ramp-approach';
  const approachOuter = RAMP_OUTER_RADIUS + 0.82;
  const approachInner = RAMP_OUTER_RADIUS + 0.08;
  const stones = [
    { min: -1.82, max: -0.66, material: materials.rampStoneC },
    { min: -0.56, max: 0.56, material: materials.rampStoneA },
    { min: 0.66, max: 1.82, material: materials.rampStoneB },
  ];

  for (const [index, stone] of stones.entries()) {
    addRampPanel(
      group,
      createRampPanelGeometry(
        angle, approachOuter - index * 0.06, approachInner,
        stone.min * 0.92, stone.max * 0.92,
        stone.min, stone.max,
        0.006,
      ),
      stone.material,
      `base-ramp-approach-stone-${index + 1}`,
    );
  }
  return group;
}

function createRampBeam(
  angle: number,
  startRadius: number,
  endRadius: number,
  lateral: number,
  yOffset: number,
  width: number,
  height: number,
  material: THREE.Material,
) {
  const start = rampPoint(angle, startRadius, lateral, yOffset);
  const end = rampPoint(angle, endRadius, lateral, yOffset);
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  const xAxis = direction.clone().normalize();
  const zAxis = new THREE.Vector3(-Math.sin(angle), 0, Math.cos(angle)).normalize();
  const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis).normalize();
  const basis = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);

  const beam = new THREE.Mesh(new THREE.BoxGeometry(length, height, width), material);
  beam.position.copy(start).add(end).multiplyScalar(0.5);
  beam.quaternion.setFromRotationMatrix(basis);
  beam.castShadow = true;
  beam.receiveShadow = true;
  return beam;
}

function createRampRail(
  angle: number,
  side: number,
  materials: BasePresentationMaterials,
) {
  const group = new THREE.Group();
  group.name = 'base-ramp-architectural-edge';
  const outerLateral = side * (RAMP_HALF_WIDTH + 0.25);
  const gateLateral = side * (RAMP_HALF_WIDTH + 0.12);
  const slopeOuter = RAMP_OUTER_RADIUS + 0.02;
  const taperRadius = RAMP_BASE_RADIUS + 1.08;
  const landingInner = RAMP_INNER_RADIUS + 0.12;

  group.add(createRampBeam(
    angle, slopeOuter, taperRadius, outerLateral, 0.14, 0.42, 0.24, materials.stoneDark,
  ));
  group.add(createRampBeam(
    angle, taperRadius, RAMP_BASE_RADIUS, gateLateral, 0.14, 0.22, 0.24, materials.stoneDark,
  ));
  group.add(createRampBeam(
    angle, RAMP_BASE_RADIUS, landingInner, gateLateral, 0.14, 0.22, 0.24, materials.stoneDark,
  ));
  group.add(createRampBeam(
    angle, slopeOuter, taperRadius, outerLateral, 0.285, 0.32, 0.085, materials.rampStoneB,
  ));
  group.add(createRampBeam(
    angle, taperRadius, RAMP_BASE_RADIUS, gateLateral, 0.285, 0.16, 0.085, materials.rampStoneB,
  ));
  group.add(createRampBeam(
    angle, RAMP_BASE_RADIUS, landingInner, gateLateral, 0.285, 0.16, 0.085, materials.rampStoneB,
  ));
  group.add(createRampBeam(
    angle, slopeOuter + 0.12, taperRadius + 0.08, outerLateral, 0.345, 0.15, 0.055, materials.factionTrim,
  ));
  group.add(createRampBeam(
    angle, taperRadius - 0.06, RAMP_BASE_RADIUS - 0.10, gateLateral, 0.345, 0.09, 0.055, materials.factionTrim,
  ));

  const postRadii = [0.12, 0.42, 0.70].map(t =>
    THREE.MathUtils.lerp(RAMP_OUTER_RADIUS, RAMP_BASE_RADIUS, t));
  postRadii.push(RAMP_BASE_RADIUS + 0.62, RAMP_BASE_RADIUS - 0.72);

  for (const [index, radius] of postRadii.entries()) {
    const nearGate = index >= 3;
    const postLateral = nearGate ? gateLateral : outerLateral;
    const basePosition = rampPoint(angle, radius, postLateral, 0.11);
    const footSize = nearGate ? 0.24 : 0.36;
    const postTop = nearGate ? 0.13 : 0.17;
    const postBottom = nearGate ? 0.16 : 0.22;

    const foot = new THREE.Mesh(new THREE.BoxGeometry(footSize, 0.18, footSize), materials.stoneDark);
    foot.position.copy(basePosition);
    foot.position.y += 0.09;
    foot.rotation.y = Math.PI / 4 - angle;
    foot.castShadow = true;
    foot.receiveShadow = true;
    group.add(foot);

    const post = new THREE.Mesh(new THREE.CylinderGeometry(postTop, postBottom, 0.38, 6), materials.rampStoneB);
    post.position.copy(basePosition);
    post.position.y += 0.31;
    post.rotation.y = angle;
    post.castShadow = true;
    post.receiveShadow = true;
    group.add(post);

    const capRadius = nearGate ? 0.145 : 0.205;
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(capRadius, capRadius, 0.075, 6),
      index === postRadii.length - 1 ? materials.factionGlow : materials.metal,
    );
    cap.position.copy(basePosition);
    cap.position.y += 0.535;
    cap.rotation.y = angle;
    cap.castShadow = true;
    cap.receiveShadow = true;
    group.add(cap);
  }

  return group;
}

function createRampGeometry(angle: number) {
  const halfWidth = RAMP_HALF_WIDTH;
  const radialX = Math.cos(angle);
  const radialZ = Math.sin(angle);
  const tangentX = -radialZ;
  const tangentZ = radialX;

  const point = (radius: number, side: number, y: number) => [
    radialX * radius + tangentX * halfWidth * side,
    y,
    radialZ * radius + tangentZ * halfWidth * side,
  ] as const;

  const outerLeft = point(RAMP_OUTER_RADIUS, 1, RAMP_LOW);
  const outerRight = point(RAMP_OUTER_RADIUS, -1, RAMP_LOW);
  const baseLeft = point(RAMP_BASE_RADIUS, 1, RAMP_HIGH);
  const baseRight = point(RAMP_BASE_RADIUS, -1, RAMP_HIGH);
  const innerLeft = point(RAMP_INNER_RADIUS, 1, RAMP_HIGH);
  const innerRight = point(RAMP_INNER_RADIUS, -1, RAMP_HIGH);

  const outerLeftBottom = point(RAMP_OUTER_RADIUS, 1, RAMP_BOTTOM);
  const outerRightBottom = point(RAMP_OUTER_RADIUS, -1, RAMP_BOTTOM);
  const baseLeftBottom = point(RAMP_BASE_RADIUS, 1, RAMP_BOTTOM);
  const baseRightBottom = point(RAMP_BASE_RADIUS, -1, RAMP_BOTTOM);
  const innerLeftBottom = point(RAMP_INNER_RADIUS, 1, RAMP_BOTTOM);
  const innerRightBottom = point(RAMP_INNER_RADIUS, -1, RAMP_BOTTOM);

  const vertices = [
    ...outerLeft, ...outerRight,
    ...baseLeft, ...baseRight,
    ...innerLeft, ...innerRight,
    ...outerLeftBottom, ...outerRightBottom,
    ...baseLeftBottom, ...baseRightBottom,
    ...innerLeftBottom, ...innerRightBottom,
  ];

  const indices = [
    0, 1, 2, 1, 3, 2,
    2, 3, 4, 3, 5, 4,
    6, 8, 7, 7, 8, 9,
    8, 10, 9, 9, 10, 11,
    0, 2, 6, 6, 2, 8,
    2, 4, 8, 8, 4, 10,
    1, 7, 3, 7, 9, 3,
    3, 9, 5, 9, 11, 5,
    4, 5, 10, 5, 11, 10,
    0, 6, 1, 1, 6, 7,
  ];

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function replaceLegacyThroneCrystal(
  citadel: THREE.Group,
  team: 'blue' | 'red',
  materials: BasePresentationMaterials,
) {
  const existing = citadel.getObjectByName(`${team}-throne`);
  if (existing) {
    existing.userData.collisionRadius = 2.72;
    existing.userData.structureKind = 'throne';
    return;
  }
  for (const child of [...citadel.children]) {
    if (!(child instanceof THREE.Mesh)) continue;
    const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
    if (!childMaterials.some(material => material instanceof THREE.MeshPhysicalMaterial)) continue;
    citadel.remove(child);
    child.geometry.dispose();
  }

  const blue = team === 'blue';
  const throne = new THREE.Group();
  throne.name = `${team}-throne`;
  throne.userData.collisionRadius = 2.72;
  throne.userData.structureKind = 'throne';

  const metal = new THREE.MeshStandardMaterial({
    color: blue ? 0x344d63 : 0x633b3b,
    metalness: 0.5,
    roughness: 0.38,
  });
  const gold = new THREE.MeshStandardMaterial({
    color: blue ? 0xc8ae72 : 0xb99567,
    metalness: 0.62,
    roughness: 0.3,
  });
  const crystal = new THREE.MeshPhysicalMaterial({
    color: blue ? 0x55cfff : 0xff6658,
    emissive: blue ? 0x0876c9 : 0xb51f19,
    emissiveIntensity: 1.2,
    roughness: 0.12,
    metalness: 0.04,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    transparent: true,
    opacity: 0.97,
  });
  const innerGlow = new THREE.MeshBasicMaterial({
    color: blue ? 0xb9f4ff : 0xffc0a8,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    toneMapped: false,
  });

  const lower = new THREE.Mesh(new THREE.CylinderGeometry(2.55, 2.82, 0.28, 48), materials.stoneDark);
  lower.position.y = 0.28;
  lower.castShadow = true;
  lower.receiveShadow = true;
  throne.add(lower);

  const middle = new THREE.Mesh(new THREE.CylinderGeometry(2.22, 2.5, 0.28, 48), materials.stoneLight);
  middle.position.y = 0.52;
  middle.castShadow = true;
  middle.receiveShadow = true;
  throne.add(middle);

  const socket = new THREE.Mesh(new THREE.CylinderGeometry(1.42, 1.78, 0.58, 24), metal);
  socket.position.y = 0.91;
  socket.castShadow = true;
  socket.receiveShadow = true;
  throne.add(socket);

  const trimRing = new THREE.Mesh(new THREE.TorusGeometry(1.78, 0.11, 8, 48), gold);
  trimRing.rotation.x = Math.PI / 2;
  trimRing.position.y = 1.05;
  trimRing.castShadow = true;
  throne.add(trimRing);

  for (let arm = 0; arm < 4; arm++) {
    const angle = arm * Math.PI / 2 + Math.PI / 4;
    const brace = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.18, 0.28), gold);
    brace.position.set(Math.cos(angle) * 1.75, 0.64, Math.sin(angle) * 1.75);
    brace.rotation.y = -angle;
    brace.castShadow = true;
    throne.add(brace);

    const prong = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.2, 0.34), metal);
    prong.position.set(Math.cos(angle) * 1.38, 1.38, Math.sin(angle) * 1.38);
    prong.rotation.y = -angle;
    prong.rotation.z = arm % 2 === 0 ? 0.2 : -0.2;
    prong.castShadow = true;
    throne.add(prong);
  }

  const baseGem = new THREE.Mesh(new THREE.OctahedronGeometry(1.08, 0), crystal);
  baseGem.scale.set(0.94, 0.82, 0.94);
  baseGem.position.y = 1.55;
  baseGem.rotation.y = Math.PI / 4;
  baseGem.castShadow = true;
  throne.add(baseGem);

  const floatingPrism = new THREE.Group();
  floatingPrism.name = `${team}-throne-prism`;
  const prismBaseY = 5.05;
  const prismFloatAmplitude = 0.18;
  const prismFloatSpeed = 1.35;
  const prismRotationSpeed = blue ? 0.52 : -0.52;
  const prismPhase = blue ? 0 : Math.PI * 0.4;
  floatingPrism.position.y = prismBaseY;
  throne.add(floatingPrism);

  const spire = new THREE.Mesh(new THREE.ConeGeometry(1.14, 4.45, 6, 1, false), crystal);
  spire.rotation.y = Math.PI / 6;
  spire.castShadow = true;
  floatingPrism.add(spire);

  const glowSpire = new THREE.Mesh(new THREE.ConeGeometry(0.50, 3.7, 6, 1, false), innerGlow);
  glowSpire.position.y = -0.08;
  glowSpire.rotation.y = Math.PI / 6;
  floatingPrism.add(glowSpire);

  const light = new THREE.PointLight(blue ? 0x49c8ff : 0xff5148, 16, 9, 2);
  light.position.y = 0.12;
  floatingPrism.add(light);

  spire.onBeforeRender = () => {
    const time = performance.now() * 0.001;
    floatingPrism.position.y = prismBaseY + Math.sin(time * prismFloatSpeed + prismPhase) * prismFloatAmplitude;
    floatingPrism.rotation.y = time * prismRotationSpeed;
  };

  citadel.add(throne);
}
