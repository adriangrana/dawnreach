import * as THREE from 'three';

export const DRAKE_ATTACK = { duration: 1.16, impact: 0.46 } as const;
const smooth = THREE.MathUtils.smoothstep;

// Seconds on the attack timeline; the same contact time drives combat damage.
export function sampleDrakeAttack(seconds: number) {
  const windup = smooth(seconds, 0, 0.28);
  const strike = smooth(seconds, 0.28, DRAKE_ATTACK.impact);
  const recovery = smooth(seconds, 0.58, DRAKE_ATTACK.duration);
  const active = seconds >= 0 && seconds < DRAKE_ATTACK.duration;
  return active ? {
    reach: (-0.38 * windup + 1.58 * strike) * (1 - recovery),
    lift: (0.23 * windup - 0.45 * strike) * (1 - recovery),
    jaw: 0.67 * windup * (1 - smooth(seconds, 0.37, DRAKE_ATTACK.impact)),
    brace: windup * (1 - recovery),
    snap: strike * (1 - recovery),
  } : { reach: 0, lift: 0, jaw: 0, brace: 0, snap: 0 };
}

export type DrakeAttachment = { object: THREE.Object3D; t: number };
export type DrakeAnimationController = {
  beginAttack(nowMs: number, speed?: number, heading?: number): number;
  cancelAttack(): void;
  update(elapsed: number, nowMs?: number): void;
};

export function createDrakeAnimator(
  root: THREE.Group,
  model: THREE.Group,
  body: THREE.SkinnedMesh,
  centerAt: (t: number) => THREE.Vector3,
  scales: THREE.InstancedMesh,
  scaleTimes: number[],
  attachments: DrakeAttachment[],
  head: THREE.Group,
  jaw: THREE.Group,
  wings: { group: THREE.Group; side: number }[],
): DrakeAnimationController {
  const boneCount = 33;
  const centers = Array.from({ length: boneCount }, (_, i) => centerAt(i / (boneCount - 1)));
  const bones = centers.map((center, i) => {
    const bone = new THREE.Bone(); bone.name = `drake-spine-${i}`;
    bone.position.copy(center); model.add(bone); return bone;
  });
  model.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const uv = body.geometry.getAttribute('uv');
  const indices = new Uint16Array(uv.count * 4), weights = new Float32Array(uv.count * 4);
  for (let i = 0; i < uv.count; i++) {
    const f = uv.getY(i) * (boneCount - 1), a = Math.min(boneCount - 2, Math.floor(f));
    indices[i * 4] = a; indices[i * 4 + 1] = a + 1;
    weights[i * 4] = 1 - (f - a); weights[i * 4 + 1] = f - a;
  }
  body.geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indices, 4));
  body.geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  body.bind(skeleton);
  // Bounds include the lunge and tail sweep; avoid recomputing skinned bounds every frame.
  body.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1.5, 0), 6);
  scales.boundingSphere = body.boundingSphere.clone();
  scales.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const restScales = scaleTimes.map((_, i) => { const m = new THREE.Matrix4(); scales.getMatrixAt(i, m); return m; });
  const restAttachments = attachments.map(({ object, t }) => {
    object.updateMatrix(); object.matrixAutoUpdate = false;
    return { object, t, rest: object.matrix.clone() };
  });
  const matrices = bones.map(() => new THREE.Matrix4());
  const inverseCenters = centers.map(p => new THREE.Matrix4().makeTranslation(-p.x, -p.y, -p.z));
  const blended = new THREE.Matrix4(), result = new THREE.Matrix4();
  function blend(t: number) {
    const f = THREE.MathUtils.clamp(t, 0, 1) * (boneCount - 1), a = Math.min(boneCount - 2, Math.floor(f));
    const w = f - a;
    for (let j = 0; j < 16; j++) blended.elements[j] = matrices[a].elements[j] * (1 - w) + matrices[a + 1].elements[j] * w;
    return blended;
  }
  const wingOrigins = wings.map(({ group }) => group.position.clone());
  const headRest = head.position.clone();
  let attackAt = -Infinity, attackSpeed = 1;
  let headingFrom = model.rotation.y, headingTo = model.rotation.y;

  const controller: DrakeAnimationController = {
    beginAttack(nowMs, speed = 1, heading = model.rotation.y) {
      attackAt = nowMs; attackSpeed = THREE.MathUtils.clamp(speed, 0.5, 2);
      headingFrom = model.rotation.y;
      headingTo = headingFrom + Math.atan2(Math.sin(heading - headingFrom), Math.cos(heading - headingFrom));
      return nowMs + DRAKE_ATTACK.impact * 1000 / attackSpeed;
    },
    cancelAttack() { attackAt = -Infinity; },
    update(elapsed, nowMs = performance.now()) {
      if (root.userData.bossState === 'DEAD') return;
      const seconds = (nowMs - attackAt) / 1000 * attackSpeed;
      const pose = sampleDrakeAttack(seconds);
      const breath = Math.sin(elapsed * 1.65);
      if (Number.isFinite(attackAt)) model.rotation.y = THREE.MathUtils.lerp(headingFrom, headingTo, smooth(seconds, 0, 0.28));
      for (let i = 0; i < boneCount; i++) {
        const t = i / (boneCount - 1), bone = bones[i], center = centers[i];
        const neck = 1 - smooth(t, 0, 0.25), tail = smooth(t, 0.43, 1);
        const chest = (1 - smooth(t, 0.22, 0.45)) * smooth(t, 0, 0.15);
        bone.position.copy(center);
        bone.position.x += neck * Math.sin(elapsed * 0.47) * 0.07 + tail * Math.sin(elapsed * 1.1 - t * 5) * 0.27;
        bone.position.y += neck * (breath * 0.055 + pose.lift) + chest * breath * 0.025 + tail * (Math.sin(elapsed * 1.1 - t * 5) + 1) * 0.035;
        bone.position.z += neck * pose.reach + tail * Math.sin(elapsed * 1.1 - t * 5 + 1) * 0.12;
        bone.rotation.set(neck * (0.025 * breath + pose.snap * 0.12), neck * Math.sin(elapsed * 0.47) * 0.035 + tail * Math.cos(elapsed * 1.1 - t * 5) * 0.12, 0);
        bone.scale.set(1 + chest * breath * 0.022, 1 + chest * breath * 0.025, 1);
        bone.updateMatrix(); matrices[i].multiplyMatrices(bone.matrix, inverseCenters[i]);
      }
      for (let i = 0; i < scales.count; i++) scales.setMatrixAt(i, result.multiplyMatrices(blend(scaleTimes[i]), restScales[i]));
      scales.instanceMatrix.needsUpdate = true;
      for (const { object, t, rest } of restAttachments) {
        object.matrix.multiplyMatrices(blend(t), rest); object.matrixWorldNeedsUpdate = true;
      }
      head.position.copy(headRest).applyMatrix4(matrices[0]);
      head.rotation.set(bones[0].rotation.x, 0.23 + bones[0].rotation.y, -pose.brace * 0.045);
      jaw.rotation.x = 0.025 + (breath + 1) * 0.014 + pose.jaw;
      wings.forEach(({ group, side }, i) => {
        group.position.copy(wingOrigins[i]); group.position.y += breath * 0.02;
        group.rotation.z = side * (Math.sin(elapsed * 0.825) * 0.055 + pose.brace * 0.17 - pose.snap * 0.27);
        group.rotation.x = Math.sin(elapsed * 0.825 + 0.4) * 0.028 - pose.brace * 0.09;
        group.rotation.y = side * (Math.sin(elapsed * 0.55 + 0.8) * 0.018 + pose.snap * 0.065);
      });
      root.userData.animationState = seconds >= 0 && seconds < DRAKE_ATTACK.duration ? 'BASIC_ATTACK' : 'IDLE';
    },
  };
  return controller;
}
