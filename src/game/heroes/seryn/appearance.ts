import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { HumanoidRig } from '../../characters/humanoidRig';
import { createSerynLoftGeometry, createSerynShoulderBlendGeometry, createTaperedCurveGeometry, smoothPeriodicNormals, type SerynLoftSection } from './geometry';
import type { SerynMaterials } from './materials';
import { buildSerynGarments } from './garments';
import { buildSerynPortrait } from './portrait';
import { buildSerynHair } from './hair';

type Point = [number, number, number];
const V = (p: Point) => new THREE.Vector3(...p);
const smooth = THREE.MathUtils.smoothstep;
const mix = THREE.MathUtils.lerp;
const gauss = (x: number, y: number, cx: number, cy: number, sx: number, sy: number) =>
  Math.exp(
  -(
    ((x - cx) / sx) ** 2 +
    ((y - cy) / sy) ** 2
  )
);

function mesh(parent: THREE.Object3D, name: string, geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[], at: Point = [0, 0, 0]) {
  const result = new THREE.Mesh(geometry, material);
  result.name = `seryn-${name}`;
  result.position.set(...at);
  result.castShadow = result.receiveShadow = true;
  parent.add(result);
  return result;
}

function tube(parent: THREE.Object3D, name: string, points: Point[], radius: number, material: THREE.Material, end = radius) {
  return mesh(parent, name, createTaperedCurveGeometry(points.map(V), radius, end, Math.max(12, Math.min(80, Math.ceil(points.length * 1.5))), 8), material);
}

function oval(parent: THREE.Object3D, name: string, at: Point, scale: Point, material: THREE.Material) {
  const small = Math.max(...scale) < .012;
  const geometry = new THREE.SphereGeometry(1, small ? 12 : 32, small ? 8 : 20);
  geometry.scale(...scale);
  return mesh(parent, name, geometry, material, at);
}

/** Hermite-interpolated anatomical rings; no straight conical sections between joints. */
export function smoothSections(sections: readonly SerynLoftSection[], subdivisions = 6): SerynLoftSection[] {
  const keys = ['rx', 'rz', 'cx', 'cz', 'front', 'back'] as const;
  const result: SerynLoftSection[] = [];
  for (let i = 0; i < sections.length - 1; i++) {
    const a = sections[i], b = sections[i + 1];
    const previous = sections[Math.max(0, i - 1)], next = sections[Math.min(sections.length - 1, i + 2)];
    for (let j = 0; j < subdivisions; j++) {
      const t = j / subdivisions, t2 = t * t, t3 = t2 * t;
      const row = { y: mix(a.y, b.y, t) } as { -readonly [K in keyof SerynLoftSection]: SerynLoftSection[K] };
      for (const key of keys) {
        const av = a[key] ?? 0, bv = b[key] ?? 0;
        const ma = ((b[key] ?? 0) - (previous[key] ?? 0)) / (b.y - previous.y) * (b.y - a.y);
        const mb = ((next[key] ?? 0) - (a[key] ?? 0)) / (next.y - a.y) * (b.y - a.y);
        row[key] = (2 * t3 - 3 * t2 + 1) * av + (t3 - 2 * t2 + t) * ma + (-2 * t3 + 3 * t2) * bv + (t3 - t2) * mb;
        if (key === 'rx' || key === 'rz') row[key] = Math.max(0.001, row[key]!);
      }
      result.push(row);
    }
  }
  result.push(sections[sections.length - 1]);
  return result;
}

function loft(parent: THREE.Object3D, name: string, sections: SerynLoftSection[], material: THREE.Material) {
  return mesh(parent, name, createSerynLoftGeometry(smoothSections(sections), 48), material);
}

/** A connected sleeve/boot is weighted across the elbow/knee instead of ending at a joint. */
function articulatedLoft(upper: THREE.Group, lower: THREE.Group, name: string, sections: SerynLoftSection[], material: THREE.Material, blendWidth: number) {
  const geometry = createSerynLoftGeometry(smoothSections(sections), 40);
  return bindSurface(upper, lower, name, geometry, material, (_x, y) =>
    1 - smooth(y, lower.position.y - blendWidth, lower.position.y + blendWidth));
}

function bindSurface(upper: THREE.Group, lower: THREE.Group, name: string, geometry: THREE.BufferGeometry, material: THREE.Material, influence: (x: number, y: number) => number) {
  const position = geometry.getAttribute('position');
  const indices: number[] = [], weights: number[] = [];
  for (let i = 0; i < position.count; i++) {
    const weight = influence(position.getX(i), position.getY(i));
    indices.push(0, 1, 0, 0);
    weights.push(1 - weight, weight, 0, 0);
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  const a = new THREE.Bone(), b = new THREE.Bone();
  a.name = `${name}-upper`; b.name = `${name}-lower`;
  upper.add(a); lower.add(b);
  // The authored section coordinates describe the straight limb. Bind in that pose,
  // then restore the existing animation rig's rest pose.
  const rotation = lower.quaternion.clone();
  lower.quaternion.identity();
  upper.updateWorldMatrix(true, true);
  const result = new THREE.SkinnedMesh(geometry, material);
  result.name = `seryn-${name}`;
  upper.add(result);
  result.updateWorldMatrix(true, false);
  result.bind(new THREE.Skeleton([a, b]));
  lower.quaternion.copy(rotation);
  result.frustumCulled = false;
  result.castShadow = result.receiveShadow = true;
  return result;
}

/** Parametric patches have a continuous curved surface, unlike extruded flat polygons. */
function surface(sample: (u: number, v: number) => Point, columns = 32, rows = 32) {
  const positions: number[] = [], uv: number[] = [], indices: number[] = [];
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= columns; i++) {
    positions.push(...sample(i / columns, j / rows)); uv.push(i / columns, j / rows);
    if (j < rows && i < columns) {
      const a = j * (columns + 1) + i, b = a + columns + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(indices); g.computeVertexNormals();
  return g;
}

function gem(parent: THREE.Object3D, m: SerynMaterials, at: Point, size: number) {
  const mount = mesh(parent, 'jewel-setting', new THREE.OctahedronGeometry(size * 1.22), m.gold, at);
  mount.scale.set(.65, 1.3, .27);
  const stone = mesh(parent, 'sapphire', new THREE.OctahedronGeometry(size), m.crystal, [at[0], at[1], at[2] + size * .20]);
  stone.scale.set(.63, 1.32, .30);
}

function armorLeaf(parent: THREE.Object3D, m: SerynMaterials, at: Point, width: number, length: number, bend: number, rotation: Point = [0, 0, 0]) {
  const group = new THREE.Group(); group.name = 'seryn-chased-armor'; group.position.set(...at); group.rotation.set(...rotation); parent.add(group);
  const sample = (u: number, v: number): Point => {
    const x = (u * 2 - 1) * width * (.72 + .28 * Math.sin(v * Math.PI)) * (1 - .9 * v ** 5);
    return [x, -length * v, bend * (1 - (x / width) ** 2) + .014 * Math.sin(v * Math.PI)];
  };
  const mat = m.silverDark.clone(); mat.side = THREE.DoubleSide;
  mesh(group, 'curved-plate', surface(sample, 24, 28), mat);
  for (const edge of [0, 1]) tube(group, 'rolled-gold-edge', Array.from({ length: 25 }, (_, i) => sample(edge, i / 24)), .0035, m.gold, .0018);
  tube(group, 'plate-spine', Array.from({ length: 17 }, (_, i) => { const p = sample(.5, i / 16); p[2] += .003; return p; }), .003, m.gold, .001);
  for (const s of [-1, 1]) for (let j = 0; j < 3; j++) {
    const t = .15 + j * .2;
    tube(group, 'engraved-leaf', [[0, -length * (t + .19), bend + .014], [s * width * .38, -length * (t + .08), bend * .87 + .015], [s * width * .72, -length * t, bend * .48 + .015]], .0015, m.gold, .0006);
  }
  // All engraving on a rigid plate shares one draw call. The anatomical joints
  // still animate independently, without hundreds of tiny trim submissions.
  const goldwork = group.children.filter((child): child is THREE.Mesh<THREE.BufferGeometry, THREE.Material> => child instanceof THREE.Mesh && child.material === m.gold);
  const combined = mergeGeometries(goldwork.map(part => part.geometry))!;
  for (const part of goldwork) { group.remove(part); part.geometry.dispose(); }
  mesh(group, 'chased-goldwork', combined, m.gold);
  return group;
}

function buildHands(hand: THREE.Group, side: number, m: SerynMaterials) {
  oval(hand, 'gloved-palm', [0, -.035, .005], [.042, .060, .027], m.blackLeather);
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * .017, length = [.053, .067, .062, .049][i];
    tube(hand, 'fingerless-glove', [[x, -.053, .009], [x, -.079, .014]], .0094, m.blackLeather, .0084);
    const curl = side < 0 ? .027 + i * .003 : .035;
    tube(hand, 'articulated-finger', [[x, -.075, .009], [x, -.077 - length * .40, .002], [x, -.077 - length * .72, -curl * .45], [x, -.072 - length * .83, -curl]], .0079, m.skin, .0053);
    oval(hand, 'fingernail', [x, -.071 - length * .83, -curl + .004], [.0040, .0050, .0016], m.skinShadow);
  }
  tube(hand, 'thumb', [[side * -.033, -.023, .012], [side * -.054, -.052, .023], [side * -.047, -.085, .041]], .0115, m.skin, .006);
  armorLeaf(hand, m, [0, -.013, .032], .031, .066, .011);
}

function buildOutfit(rig: HumanoidRig, m: SerynMaterials) {
  const tailoring = (x: number, y: number) => .022 * (
    gauss(x, y, -.105, .145, .082, .105) + gauss(x, y, .105, .145, .082, .105)
  ) + .0018 * Math.sin(y * 54 + x * 12) * smooth(-y, .08, .4);
  // One fitted bodice with an ivory inset sharing the SAME vertices as the dark panels.
  const sections = smoothSections([
    { y: -.58, rx: .231, rz: .152, back: .015 }, { y: -.45, rx: .207, rz: .139 },
    { y: -.28, rx: .183, rz: .120 }, { y: -.12, rx: .204, rz: .135 },
    { y: .045, rx: .248, rz: .160, front: .024 }, { y: .165, rx: .265, rz: .166, front: .038 },
    { y: .265, rx: .253, rz: .153, front: .021 }, { y: .345, rx: .222, rz: .132 },
    { y: .420, rx: .154, rz: .098 }, { y: .457, rx: .083, rz: .074 },
  ]);
  const bodice = createSerynLoftGeometry(sections, 80);
  const bodyPosition = bodice.getAttribute('position');
  for (let i = 0; i < bodyPosition.count; i++) {
    const x = bodyPosition.getX(i), y = bodyPosition.getY(i), z = bodyPosition.getZ(i);
    bodyPosition.setZ(i, z + tailoring(x, y) * smooth(z, .04, .16));
  }
  bodice.computeVertexNormals();
  smoothPeriodicNormals(bodice, 81, sections.length);
  // Material groups split around the curved center insert; no second shell can pierce it.
  bodice.clearGroups();
  for (let row = 0; row < sections.length - 1; row++) for (let column = 0; column < 80; column++) {
    const angle = (column + .5) / 80 * Math.PI * 2, y = sections[row].y;
    const inset = .44 + .17 * smooth(y, -.2, .24);
    const frontAngle = Math.min(angle, Math.PI * 2 - angle);
    bodice.addGroup((row * 80 + column) * 6, 6, frontAngle < inset ? 1 : 0);
  }
  // Consolidate consecutive groups to keep the fitted garment to a few draw calls per ring.
  const oldIndices = Array.from(bodice.index!.array), batches: number[][] = [[], []];
  for (const g of bodice.groups) batches[g.materialIndex ?? 0].push(...oldIndices.slice(g.start, g.start + g.count));
  batches[0].push(...oldIndices.slice((sections.length - 1) * 80 * 6));
  bodice.clearGroups(); bodice.setIndex([...batches[0], ...batches[1]]);
  bodice.addGroup(0, batches[0].length, 0);
  bodice.addGroup(batches[0].length, batches[1].length, 1);
  mesh(rig.torso, 'tailored-bodice', bodice, [m.blackLeather, m.ivory]);
  for (const s of [-1, 1]) {
    tube(rig.torso, 'bodice-gold-seam', sections.map(r => {
      const a = .44 + .17 * smooth(r.y, -.2, .24);
      const x = s * Math.sin(a) * r.rx;
      return [x, r.y, Math.cos(a) * r.rz + (r.front ?? 0) * Math.cos(a) ** 2 + tailoring(x, r.y) + .003];
    }), .0025, m.gold);
    if (s < 0) continue;
    // Supple broad leather straps lie on the garment, not cylindrical rods crossing it.
    const strap = surface((u, v) => {
      const y = mix(.32, -.40, v), r = sections.reduce((best, item) => Math.abs(item.y - y) < Math.abs(best.y - y) ? item : best);
      const x = s * mix(.19, -.09, v) + (u - .5) * .031;
      const cosine = Math.sqrt(Math.max(.1, 1 - (x / r.rx) ** 2));
      return [x, y, r.rz * cosine + (r.front ?? 0) * cosine ** 2 + tailoring(x, y) + .008];
    }, 6, 60);
    const strapMat = m.leather.clone(); strapMat.side = THREE.DoubleSide;
    mesh(rig.torso, 'fitted-leather-harness', strap, strapMat);
  }
  gem(rig.torso, m, [0, -.045, .18], .029);
  loft(rig.pelvis, 'hip-leather', [{ y: -.14, rx: .224, rz: .141 }, { y: -.025, rx: .242, rz: .154, back: .012 }, { y: .12, rx: .205, rz: .136 }, { y: .21, rx: .184, rz: .118 }], m.blackLeather);
  for (const s of [-1, 1]) {
    const arm = s > 0 ? rig.leftArm : rig.rightArm, forearm = s > 0 ? rig.leftForearm : rig.rightForearm;
    const thigh = s > 0 ? rig.leftLeg : rig.rightLeg, shin = s > 0 ? rig.leftShin : rig.rightShin, foot = s > 0 ? rig.leftFoot : rig.rightFoot;
    const shoulder = createSerynShoulderBlendGeometry(Array.from({ length: 25 }, (_, i) => {
      const t = i / 24;
      return { x: s * mix(.13, .389, t), y: mix(.385, .295, t), ry: mix(.051, .085, smooth(t, 0, 1)), rz: mix(.091, .098, t) };
    }), 36, true, true);
    bindSurface(rig.torso, arm, 'weighted-shoulder-yoke', shoulder, m.ivory, x => smooth(Math.abs(x), .18, .35));
    articulatedLoft(arm, forearm, 'continuous-sleeve', [
      { y: .085, rx: .035, rz: .041 }, { y: .045, rx: .086, rz: .089 },
      { y: -.04, rx: .102, rz: .102 }, { y: -.19, rx: .083, rz: .078 },
      { y: -.33, rx: .068, rz: .064 }, { y: -.46, rx: .057, rz: .056 },
      { y: -.57, rx: .068, rz: .061 }, { y: -.72, rx: .056, rz: .050 },
      { y: -.89, rx: .041, rz: .038 },
    ], m.ivory, .105);
    // Deltoid plates articulate with the arm and overlap a soft cloth cap.
    for (let j = 0; j < (s > 0 ? 3 : 2); j++) {
      armorLeaf(arm, m, [s * (.015 + j * .019), .106 - j * .068, .015], .119 - j * .014, .18, .111 - j * .005, [.02, s * -.12, s * -.40]);
    }
    gem(arm, m, [s * .013, .038, .138], .030);
    loft(forearm, 'fitted-bracer', [{ y: -.08, rx: .072, rz: .066 }, { y: -.17, rx: .076, rz: .065 }, { y: -.29, rx: .062, rz: .055 }, { y: -.414, rx: .047, rz: .044 }], m.blackLeather);
    for (let j = 0; j < 3; j++) armorLeaf(forearm, m, [0, -.09 - j * .092, .05 - j * .005], .057 - j * .006, .145, .025);
    gem(forearm, m, [0, -.20, .089], .024);
    buildHands(s > 0 ? rig.sockets.leftHand : rig.sockets.rightHand, s, m);
    loft(thigh, 'exposed-thigh', [{ y: .045, rx: .080, rz: .084 }, { y: -.08, rx: .110, rz: .110 }, { y: -.23, rx: .109, rz: .104 }, { y: -.38, rx: .10, rz: .087 }], m.skin);
    articulatedLoft(thigh, shin, 'continuous-thigh-boot', [
      { y: -.29, rx: .111, rz: .101 }, { y: -.39, rx: .107, rz: .097 },
      { y: -.53, rx: .080, rz: .073 }, { y: -.625, rx: .067, rz: .066 },
      { y: -.75, rx: .081, rz: .076 }, { y: -.88, rx: .080, rz: .073 },
      { y: -1.04, rx: .055, rz: .052 }, { y: -1.17, rx: .045, rz: .047 },
    ], m.blackLeather, .08);
    armorLeaf(thigh, m, [0, -.29, .087], .092, .24, .032);
    armorLeaf(shin, m, [0, .02, .054], .074, .21, .035);
    gem(shin, m, [0, -.08, .097], .026);
    armorLeaf(shin, m, [0, -.20, .055], .059, .28, .025);
    const shoe = oval(foot, 'shaped-boot-foot', [0, -.028, .072], [.075, .057, .172], m.blackLeather);
    const pp = shoe.geometry.getAttribute('position');
    for (let i = 0; i < pp.count; i++) if (pp.getZ(i) > .05) pp.setX(i, pp.getX(i) * (1 - smooth(pp.getZ(i), .05, .17) * .65));
    shoe.geometry.computeVertexNormals();
    armorLeaf(foot, m, [0, .006, .081], .061, .18, .026, [-Math.PI / 2, 0, 0]);
    gem(foot, m, [0, .027, .08], .021);
  }

  return buildSerynGarments(rig, m);
}

export function buildSerynAppearance(rig: HumanoidRig, materials: SerynMaterials) {
  rig.head.scale.set(1, .92, 1);
  const { eyelids } = buildSerynPortrait(rig, materials);
  const hair = buildSerynHair(rig, materials);
  const clothMeshes = buildOutfit(rig, materials);
  return { hair, eyelids, clothMeshes };
}

export function decorateSerynBow(bow: THREE.Group, m: SerynMaterials) {
  for (const side of [-1, 1]) {
    for (const [x, y] of [[.10, .34], [.15, .56], [.13, .78]]) {
      armorLeaf(bow, m, [x, side * y, .006], .034, .18, .018, [0, 0, side > 0 ? Math.PI : 0]);
    }
    gem(bow, m, [.142, side * .54, .034], .035);
    tube(bow, 'bow-filigree', [[.046, side * .98, .008], [.099, side * .88, .027], [.080, side * .79, .034], [.138, side * .70, .028], [.19, side * .60, .020], [.102, side * .46, .029], [.06, side * .25, .019]], .004, m.gold, .002);
  }
}
