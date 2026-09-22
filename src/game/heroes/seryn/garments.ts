import * as THREE from 'three';
import type { HumanoidRig } from '../../characters/humanoidRig';
import type { SerynMaterials } from './materials';
import { createSerynLoftGeometry, createTaperedCurveGeometry } from './geometry';

type Point = [number, number, number];
const mix = THREE.MathUtils.lerp;
const smooth = THREE.MathUtils.smoothstep;

function add(parent: THREE.Object3D, name: string, geometry: THREE.BufferGeometry, material: THREE.Material | THREE.Material[]) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `seryn-${name}`;
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

/** Two sewn surfaces around a shared mid-surface, including material groups for a lining. */
export function garmentGeometry(sample: (u: number, v: number) => Point, columns = 36, rows = 48, thickness = .0025) {
  const positions: number[] = [], uv: number[] = [], indices: number[] = [], flex: number[] = [], phase: number[] = [];
  const count = (columns + 1) * (rows + 1), du = new THREE.Vector3(), dv = new THREE.Vector3(), normal = new THREE.Vector3();
  const mid: Point[] = [], normals: THREE.Vector3[] = [];
  for (let row = 0; row <= rows; row++) for (let col = 0; col <= columns; col++) {
    const u = col / columns, v = row / rows;
    mid.push(sample(u, v));
    du.fromArray(sample(Math.min(1, u + .001), v)).sub(new THREE.Vector3().fromArray(sample(Math.max(0, u - .001), v)));
    dv.fromArray(sample(u, Math.min(1, v + .001))).sub(new THREE.Vector3().fromArray(sample(u, Math.max(0, v - .001))));
    normal.crossVectors(du, dv).normalize();
    normals.push(normal.clone());
  }
  for (let layer = 0; layer < 2; layer++) {
    for (let row = 0; row <= rows; row++) for (let col = 0; col <= columns; col++) {
      const k = row * (columns + 1) + col, p = mid[k], n = normals[k], offset = (layer ? -1 : 1) * thickness * .5;
      positions.push(p[0] + n.x * offset, p[1] + n.y * offset, p[2] + n.z * offset);
      uv.push(col / columns, row / rows); flex.push(smooth(row / rows, 0, 1)); phase.push(col / columns * 2 + row / rows * 3);
    }
    for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
      const a = layer * count + row * (columns + 1) + col, b = a + columns + 1;
      if (layer === 0) indices.push(a, a + 1, b, a + 1, b + 1, b);
      else indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const surfaceCount = columns * rows * 6;
  const stitch = (a: number, b: number) => indices.push(a, a + count, b, b, a + count, b + count);
  for (let row = 0; row < rows; row++) {
    stitch(row * (columns + 1), (row + 1) * (columns + 1));
    stitch((row + 1) * (columns + 1) + columns, row * (columns + 1) + columns);
  }
  for (let col = 0; col < columns; col++) {
    stitch(col + 1, col); stitch(rows * (columns + 1) + col, rows * (columns + 1) + col + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('clothFlex', new THREE.Float32BufferAttribute(flex, 1));
  geometry.setAttribute('clothPhase', new THREE.Float32BufferAttribute(phase, 1));
  geometry.setIndex(indices);
  geometry.addGroup(0, surfaceCount, 0); geometry.addGroup(surfaceCount, surfaceCount, 1);
  geometry.addGroup(surfaceCount * 2, indices.length - surfaceCount * 2, 0);
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  geometry.userData.serynClothBasePositions = new Float32Array(positions);
  return geometry;
}

function seam(parent: THREE.Object3D, name: string, points: Point[], material: THREE.Material, radius = .0025) {
  return add(parent, name, createTaperedCurveGeometry(points.map(p => new THREE.Vector3(...p)), radius, radius, 72, 6), material);
}

export function buildSerynGarments(rig: HumanoidRig, m: SerynMaterials) {
  const clothes: THREE.Mesh[] = [];
  const garment = (parent: THREE.Group, name: string, sample: (u: number, v: number) => Point, outside: THREE.Material, inside: THREE.Material, role: string, bias: number) => {
    const mesh = add(parent, name, garmentGeometry(sample), [outside, inside]);
    mesh.frustumCulled = false;
    mesh.userData.serynClothDynamics = { role, bias, anchor: parent === rig.pelvis ? 'pelvis' : 'shoulders' };
    clothes.push(mesh);
    return mesh;
  };

  // The belt and the skirt share a pelvis-local attachment surface. The cloth's
  // first 6 cm are concealed INSIDE the belt; they cannot float away with torso sway.
  add(rig.pelvis, 'fitted-waistband', createSerynLoftGeometry([
    { y: .035, rx: .236, rz: .155 }, { y: .07, rx: .226, rz: .150 },
    { y: .11, rx: .216, rz: .144 }, { y: .155, rx: .204, rz: .137 },
  ], 96, false, false), m.leather);
  for (const [y, rx, rz] of [[.038, .237, .156], [.150, .206, .139]]) {
    seam(rig.pelvis, 'waistband-stitch', Array.from({ length: 97 }, (_, i) => {
      const a = i / 96 * Math.PI * 2; return [Math.sin(a) * rx, y, Math.cos(a) * rz];
    }), m.gold, .0018);
  }
  const beltGem = add(rig.pelvis, 'waist-clasp', new THREE.OctahedronGeometry(.032), m.crystal);
  beltGem.position.set(.006, .09, .151); beltGem.scale.set(.62, 1.2, .30);

  const skirt = (name: string, start: number, end: number, length: number, drift: number, role: string, bias: number, material: THREE.Material) => {
    garment(rig.pelvis, name, (u, v) => {
      // Reversing U presents the outward +Z side on frontal panels.
      const a = mix(end, start, u), rootY = .104 + .006 * Math.sin(a);
      // Follow the full hip envelope before opening into the free skirt. The old
      // linear cone stayed narrower than the thighs for its first 20 cm.
      const hip = smooth(v, 0, .16), flare = smooth(v, .16, 1);
      const rx = .211 + .066 * hip + .065 * flare, rz = .139 + .047 * hip + .05 * flare;
      const fold = .014 * Math.sin(u * Math.PI * 5 + bias + v) * smooth(v, 0, .4);
      return [Math.sin(a) * (rx + fold) + drift * v * v,
        rootY - length * v + .044 * Math.sin(u * Math.PI * 2 + bias) * v ** 6,
        Math.cos(a) * (rz + fold) + .030 * Math.sin(v * Math.PI)];
    }, material, material, role, bias);
  };
  skirt('attached-ivory-tabard', -.72, .20, 1.12, -.12, 'front', .3, m.ivory);
  skirt('attached-ivory-side-panel', .52, 1.22, 1.09, .08, 'side-left', 1.1, m.ivory);
  skirt('attached-blue-left-skirt', 1.10, 2.62, 1.24, .06, 'side-left', 1.8, m.cloakBlue);
  skirt('attached-blue-right-skirt', -2.62, -.70, 1.23, -.065, 'side-right', 2.7, m.cloakBlue);

  // A single lined mantle grows from a curved shoulder seam into the hanging cape.
  // Its top follows the collar/back, while only the free hem stands away from the body.
  const capeSample = (u: number, v: number): Point => {
    const across = u * 2 - 1, topX = across * .276;
    const rootY = .418 - .098 * Math.abs(across) ** 1.35;
    const rootZ = -.119 + .056 * Math.abs(across) ** 1.6;
    const free = smooth(v, 0, .42);
    const width = mix(.552, .93, v ** .8);
    return [mix(topX, across * width * .5, smooth(v, 0, .3)) - .038 * v * v,
      rootY - 1.87 * v + .045 * Math.sin(u * Math.PI * 3 + .6) * v ** 6,
      rootZ - .13 * free - .035 * Math.sin(v * Math.PI) + .030 * Math.sin(u * Math.PI * 6 + v * 1.2) * free];
  };
  garment(rig.torso, 'shoulder-attached-lined-cape', capeSample, m.cloakBlue, m.ivory, 'cape', 2.2);
  seam(rig.torso, 'cape-shoulder-seam', Array.from({ length: 49 }, (_, i) => capeSample(i / 48, 0)), m.gold);

  // Fully clear the fitted blouse at the front: the old wrap was narrower than
  // the chest and exposed white stripes through every fold.
  const scarfSample = (u: number, v: number): Point => {
    const a = u * Math.PI * 2;
    const fold = Math.sin(v * Math.PI * 6 + Math.sin(a) * .6) * .009 * Math.sin(v * Math.PI);
    const rx = .088 + .22 * Math.sin(v * Math.PI * .5) + fold;
    const rz = .075 + .161 * Math.sin(v * Math.PI * .5) + fold;
    return [Math.sin(a) * rx, .487 - .255 * v + Math.sin(a) * .035 * v, Math.cos(a) * rz - .006];
  };
  const scarf = add(rig.torso, 'sculpted-wrapped-scarf', garmentGeometry(scarfSample, 96, 42, .003), [m.cloakBlue, m.cloakBlue]);
  scarf.geometry.deleteAttribute('clothFlex'); scarf.geometry.deleteAttribute('clothPhase');
  delete scarf.geometry.userData.serynClothBasePositions;
  seam(rig.torso, 'scarf-rolled-hem', Array.from({ length: 97 }, (_, i) => scarfSample(i / 96, 1)), m.gold, .0015);
  return clothes;
}
