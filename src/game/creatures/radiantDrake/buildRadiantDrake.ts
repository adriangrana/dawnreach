import * as THREE from 'three';
import { createLoft, membranePanel, scaleGeometry, taperedCurve, v, type Section } from './geometry';
import { createDrakeMaterials } from './materials';
import { createDrakeAnimator, type DrakeAttachment } from './animateRadiantDrake';

const DRAKE_SHADOW_CASTER_NAMES = new Set([
  'continuous-scaled-neck-body-tail',
  'angular-cranial-surface',
  'mandible',
  'muscular-limb',
  'taloned-paw',
  'wing-upper-arm',
  'wing-forearm',
  'wing-wrist',
  'veined-wing-membrane',
]);

export function buildRadiantDrake() {
  const root = new THREE.Group();
  root.name = 'radiant-drake';
  root.userData.objectiveKind = 'upper-dragon';
  const model = new THREE.Group(); model.name = 'radiant-drake-model'; root.add(model);
  const materials = createDrakeMaterials();
  const scale = scaleGeometry();
  const mesh = (parent: THREE.Object3D, name: string, geometry: THREE.BufferGeometry, material: THREE.Material) => {
    const result = new THREE.Mesh(geometry, material);result.name = name;
    result.castShadow = result.receiveShadow = true;parent.add(result);return result;
  };
  const ellipsoid = (parent: THREE.Object3D, name: string, position: THREE.Vector3, size: THREE.Vector3, material: THREE.Material) => {
    const part = mesh(parent, name, new THREE.SphereGeometry(1, 24, 16), material);
    part.position.copy(position);part.scale.copy(size);return part;
  };
  const horn = (parent: THREE.Object3D, name: string, points: THREE.Vector3[], radius: number, material = materials.horn) =>
    mesh(parent, name, taperedCurve(points, radius), material);
  const plate = (parent: THREE.Object3D, position: THREE.Vector3, normal: THREE.Vector3, forward: THREE.Vector3, width: number, length: number, material = materials.silver) => {
    const right = new THREE.Vector3().crossVectors(forward, normal).normalize();
    const tangent = new THREE.Vector3().crossVectors(normal, right).normalize();
    const part = mesh(parent, 'sculpted-scute', scale, material);
    part.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, tangent, normal));
    part.position.copy(position);part.scale.set(width, length, 1);return part;
  };

  const sections: Section[] = [
    [0.05, 2.38, 1.45, 0.34, 0.34], [-0.55, 2.05, 0.82, 0.43, 0.46],
    [-0.8, 1.38, 0, 0.66, 0.64], [-0.43, 1.12, -0.95, 0.78, 0.65],
    [0.4, 0.91, -1.65, 0.63, 0.55], [1.45, 0.5, -1.65, 0.43, 0.34],
    [2.25, 0.3, -0.85, 0.29, 0.22], [2.35, 0.25, 0.3, 0.22, 0.17],
    [1.95, 0.24, 1.35, 0.17, 0.13], [1.1, 0.27, 2.15, 0.115, 0.10],
    [0.25, 0.31, 2.25, 0.065, 0.055], [-0.55, 0.38, 1.95, 0.006, 0.008],
  ].map(([x, y, z, width, height]) => ({ center: v(x, y, z), width, height }));
  const body = createLoft(sections, 220, 36);
  const skin = new THREE.SkinnedMesh(body.geometry, materials.skin);
  skin.name = 'continuous-scaled-neck-body-tail';
  skin.castShadow = skin.receiveShadow = true; model.add(skin);
  const attachments: DrakeAttachment[] = [];
  const scaleTimes: number[] = [];

  // Hundreds of overlapping keeled scutes catch actual light above the micro-scale texture.
  const count = 110 * 11;
  const scales = new THREE.InstancedMesh(scale, materials.silver, count);
  scales.name = 'overlapping-body-scales';scales.castShadow = scales.receiveShadow = true;
  const transform = new THREE.Object3D(), basis = new THREE.Matrix4();
  const color = new THREE.Color();
  let instance = 0;
  for (let row = 0; row < 110; row++) for (let col = 0; col < 11; col++) {
    const t = 0.015 + row / 110 * 0.95 + (col % 2) * 0.003;
    scaleTimes.push(t);
    const s = body.sample(t), angle = 0.11 + col / 10 * (Math.PI - 0.22);
    const normal = s.right.clone().multiplyScalar(Math.cos(angle)).addScaledVector(s.up, Math.sin(angle)).normalize();
    transform.position.copy(s.center).addScaledVector(s.right, Math.cos(angle) * (s.width + 0.005))
      .addScaledVector(s.up, Math.sin(angle) * (s.height + 0.005));
    const right = new THREE.Vector3().crossVectors(s.tangent, normal).normalize();
    const forward = new THREE.Vector3().crossVectors(normal, right).normalize();
    transform.quaternion.setFromRotationMatrix(basis.makeBasis(right, forward, normal));
    transform.scale.set(s.width * 1.27, Math.max(0.15, 0.58 - t * 0.4), Math.max(0.15, s.width * 0.55));
    transform.updateMatrix();scales.setMatrixAt(instance, transform.matrix);
    color.set(col === 5 && row % 4 === 0 ? '#d1be88' : row % 3 === 0 ? '#b8c8c0' : '#cad4ca');
    scales.setColorAt(instance++, color);
  }
  model.add(scales);
  for (let spine = 0; spine < 27; spine++) {
    const t = 0.04 + spine / 27 * 0.91, s = body.sample(t);
    const start = s.center.clone().addScaledVector(s.up, s.height - 0.015);
    const height = THREE.MathUtils.lerp(0.46, 0.10, t);
    const object = horn(model, 'dorsal-ivory-spine', [start, start.clone().addScaledVector(s.up, height * 0.7).addScaledVector(s.tangent, 0.09),
      start.clone().addScaledVector(s.up, height).addScaledVector(s.tangent, 0.28 * (1 - t))], 0.095 * (1 - t) + 0.014);
    attachments.push({ object, t });
  }
  for (let belly = 0; belly < 22; belly++) {
    const t = 0.018 + belly / 22 * 0.44, s = body.sample(t);
    const object = plate(model, s.center.clone().addScaledVector(s.up, -s.height - 0.007), s.up.clone().negate(), s.tangent,
      s.width * 5.1, 0.7, materials.gold);
    attachments.push({ object, t });
  }

  const head = new THREE.Group();head.name = 'sculpted-dragon-head';head.position.set(0.05, 2.38, 1.45);model.add(head);
  head.rotation.y = 0.23;
  const skull = createLoft([
    { center: v(0, 0, -0.38), width: 0.32, height: 0.31 },
    { center: v(0, 0.06, 0), width: 0.51, height: 0.36 },
    { center: v(0, 0.015, 0.46), width: 0.4, height: 0.23 },
    { center: v(0, -0.06, 1), width: 0.27, height: 0.14 },
    { center: v(0, -0.09, 1.42), width: 0.095, height: 0.08 },
  ], 56, 28);
  mesh(head, 'angular-cranial-surface', skull.geometry, materials.skin);
  ellipsoid(head, 'mouth-cavity', v(0, -0.19, 0.72), v(0.33, 0.085, 0.6), materials.mouth);
  const jaw = new THREE.Group();jaw.name = 'lower-jaw';head.add(jaw);
  const jawSkin = createLoft([
    { center: v(0, -0.20, -0.05), width: 0.33, height: 0.14 },
    { center: v(0, -0.31, 0.52), width: 0.30, height: 0.085 },
    { center: v(0, -0.29, 1.16), width: 0.13, height: 0.06 },
    { center: v(0, -0.22, 1.4), width: 0.025, height: 0.015 },
  ], 40, 22);
  mesh(jaw, 'mandible', jawSkin.geometry, materials.skin);
  for (let i = 0; i < 5; i++) {
    plate(head, v(0, 0.42 - i * 0.075, -0.02 + i * 0.25), v(0, 1, 0.15).normalize(), v(0, 0, 1),
      2.7 - i * 0.32, 1.25, i === 0 ? materials.gold : materials.silver);
  }
  for (const side of [-1, 1]) {
    ellipsoid(head, 'cheek-muscle', v(side * 0.39, -0.035, 0.02), v(0.19, 0.23, 0.35), materials.silver);
    horn(head, 'swept-crown-horn', [v(side * 0.34, 0.22, -0.13), v(side * 0.58, 0.61, -0.46),
      v(side * 0.74, 1.03, -0.94), v(side * 0.68, 1.4, -1.39)], 0.175);
    horn(head, 'cheek-horn', [v(side * 0.4, -0.01, 0.13), v(side * 0.74, 0.05, -0.27),
      v(side * 0.96, 0.36, -0.76)], 0.125);
    horn(head, 'temple-horn', [v(side * 0.4, 0.16, -0.24), v(side * 0.82, 0.35, -0.64),
      v(side * 1.08, 0.72, -0.98)], 0.105);
    ellipsoid(head, 'obsidian-eye-socket', v(side * 0.392, 0.15, 0.42), v(0.10, 0.103, 0.18), materials.mouth);
    ellipsoid(head, 'amber-eye', v(side * 0.445, 0.16, 0.43), v(0.076, 0.064, 0.115), materials.eye);
    ellipsoid(head, 'vertical-slit-pupil', v(side * 0.508, 0.16, 0.44), v(0.012, 0.055, 0.023), materials.pupil);
    horn(head, 'armored-brow', [v(side * 0.47, 0.25, 0.13), v(side * 0.49, 0.265, 0.42),
      v(side * 0.32, 0.16, 0.82)], 0.075, materials.gold);
    ellipsoid(head, 'nostril', v(side * 0.215, 0.005, 1.045), v(0.035, 0.027, 0.092), materials.pupil);
    horn(head, 'snout-ridge', [v(side * 0.24, 0.12, 0.66), v(side * 0.20, 0.05, 1.08),
      v(side * 0.075, -0.045, 1.4)], 0.035, materials.silver);
    for (let tooth = 0; tooth < 7; tooth++) {
      const z = 0.27 + tooth * 0.145, x = side * (0.35 - tooth * 0.033);
      const length = tooth === 1 ? 0.17 : 0.09;
      horn(head, 'upper-fang', [v(x, -0.12, z), v(x * 0.96, -0.12 - length, z + 0.025)], 0.031);
      horn(jaw, 'lower-tooth', [v(x * 0.9, -0.27, z + 0.06), v(x * 0.88, -0.19, z + 0.065)], 0.021);
    }
    horn(jaw, 'jaw-spur', [v(side * 0.24, -0.27, 0.06), v(side * 0.32, -0.48, -0.15), v(side * 0.3, -0.54, -0.42)], 0.07);
    for (let scute = 0; scute < 4; scute++) {
      plate(head, v(side * 0.47, 0.02 + scute * 0.035, 0.07 - scute * 0.12),
        v(side, 0.25, 0).normalize(), v(0, 0, -1), 0.85, 1.0, materials.gold);
    }
  }

  for (const side of [-1, 1]) for (const hind of [false, true]) {
    const limb = new THREE.Group();limb.name = `${side < 0 ? 'left' : 'right'}-${hind ? 'hind' : 'fore'}leg`;model.add(limb);
    const points = hind ? [v(side * 0.51, 0.94, -1.2), v(side * 1.08, 0.56, -1.35), v(side * 1.25, 0.29, -0.92), v(side * 1.46, 0.14, -0.61)]
      : [v(-0.62 + side * 0.49, 1.25, 0.08), v(-0.55 + side * 0.91, 0.71, 0.15), v(-0.37 + side * 1.0, 0.24, 0.65), v(-0.32 + side * 1.02, 0.14, 0.95)];
    const radii = hind ? [0.33, 0.3, 0.15, 0.115] : [0.25, 0.22, 0.13, 0.10];
    const skin = createLoft(points.map((center, i) => ({ center, width: radii[i], height: radii[i] * 0.87 })), 44, 22);
    mesh(limb, 'muscular-limb', skin.geometry, materials.skin);
    const foot = points[3];
    ellipsoid(limb, 'taloned-paw', foot.clone().add(v(0, 0.015, 0.14)), v(0.25, 0.115, 0.25), materials.silver);
    for (let toe = -1; toe <= 1; toe++) {
      const start = foot.clone().add(v(toe * 0.13, 0.025, 0.20));
      horn(limb, 'scaled-toe', [start, start.clone().add(v(toe * 0.05, -0.005, 0.19)), start.clone().add(v(toe * 0.08, -0.025, 0.29))], 0.065, materials.silver);
      horn(limb, 'ivory-talon', [start.clone().add(v(toe * 0.07, 0.01, 0.25)), start.clone().add(v(toe * 0.10, 0.02, 0.39)), start.clone().add(v(toe * 0.10, -0.08, 0.45))], 0.044);
    }
    for (let scute = 0; scute < 5; scute++) {
      const p = skin.sample(0.15 + scute * 0.15);
      plate(limb, p.center.clone().addScaledVector(p.up, p.height), p.up, p.tangent, p.width * 3.5, 0.65);
    }
    horn(limb, 'elbow-spur', [points[1].clone(), points[1].clone().add(v(side * 0.15, 0.23, -0.14)), points[1].clone().add(v(side * 0.15, 0.27, -0.43))], 0.075);
  }

  const wings: { group: THREE.Group; side: number }[] = [];
  for (const side of [-1, 1]) {
    const wing = new THREE.Group();wing.name = `${side < 0 ? 'left' : 'right'}-articulated-wing`;
    wing.position.set(-0.6 + side * 0.5, 1.55, -0.6);model.add(wing);wings.push({ group: wing, side });
    const elbow = v(side * 0.86, 0.78, -0.68), wrist = v(side * 1.58, 1.48, -0.9);
    horn(wing, 'wing-upper-arm', [v(0, 0, 0), elbow.clone().multiplyScalar(0.55).add(v(0, 0.09, 0)), elbow], 0.19, materials.silver);
    horn(wing, 'wing-forearm', [elbow, elbow.clone().lerp(wrist, 0.5), wrist], 0.14, materials.gold);
    ellipsoid(wing, 'wing-wrist', wrist, v(0.16, 0.16, 0.19), materials.silver);
    const tips = [v(side * 3.6, 1.9, -1.65), v(side * 3.8, 0.75, 0.5),
      v(side * 3.1, -0.05, 2.0), v(side * 1.6, -0.36, 2.1), v(side * 0.15, -0.47, 0.66), v(0, -0.15, 0.08)];
    for (let panel = 0; panel < tips.length - 1; panel++) {
      mesh(wing, 'veined-wing-membrane', membranePanel(wrist, tips[panel], tips[panel + 1], side), materials.membrane);
      const middle = tips[panel].clone().lerp(tips[panel + 1], 0.5).lerp(wrist, 0.19);
      horn(wing, 'scalloped-membrane-edge', [tips[panel], middle, tips[panel + 1]], 0.025, materials.gold);
    }
    tips.forEach((tip, i) => {
      horn(wing, 'elongated-wing-finger', [wrist, wrist.clone().lerp(tip, 0.48).add(v(0, 0.04, 0)), tip], i === 0 ? 0.093 : 0.058, materials.horn);
      if (i < 3) horn(wing, 'wing-tip-claw', [tip.clone().add(v(-side * 0.07, 0.015, 0.05)), tip, tip.clone().add(v(side * 0.18, 0.035, -0.15))], 0.036);
    });
    horn(wing, 'thumb-hook', [wrist, wrist.clone().add(v(side * 0.07, 0.36, -0.15)), wrist.clone().add(v(side * 0.26, 0.46, -0.33))], 0.075);
    for (let i = 0; i < 8; i++) {
      const p = elbow.clone().lerp(wrist, i / 8);
      plate(wing, p.add(v(0, 0.105, 0)), v(0, 1, 0), wrist.clone().sub(elbow).normalize(), 0.9, 0.85, materials.gold);
    }
  }

  // Move the jaw pivot to its hinge without moving the authored teeth and mandible.
  const hinge = v(0, -0.20, -0.05);
  jaw.position.copy(hinge);
  for (const child of jaw.children) child.position.sub(hinge);
  const animator = createDrakeAnimator(root, model, skin, t => body.sample(t).center,
    scales, scaleTimes, attachments, head, jaw, wings);
  root.userData.drakeAnimator = animator;
  root.userData.animate = animator.update;

  // Resolve static culling bounds during construction, while the loading splash owns the
  // frame budget. The first reveal must never spend its frame computing hundreds of bounds.
  // Only the silhouette-bearing pieces participate in the directional-light shadow pass;
  // tiny scales, teeth and trim remain fully visible in the beauty pass.
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    if (!object.geometry.boundingSphere) object.geometry.computeBoundingSphere();
    object.castShadow = DRAKE_SHADOW_CASTER_NAMES.has(object.name);
  });

  return root;
}
