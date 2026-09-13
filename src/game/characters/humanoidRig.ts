import * as THREE from 'three';

export type HumanoidRig = {
  root: THREE.Group;
  model: THREE.Group;
  bodyScale: number;
  waistMotionScale: number;
  pelvis: THREE.Group;
  torso: THREE.Group;
  torsoRestY: number;
  head: THREE.Group;
  soleSamples: Array<{ foot: THREE.Group; points: THREE.Vector3[] }>;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  leftShin: THREE.Group;
  rightShin: THREE.Group;
  leftFoot: THREE.Group;
  rightFoot: THREE.Group;
  gait: { phase: number; weight: number };
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftForearm: THREE.Group;
  rightForearm: THREE.Group;
  sockets: Record<'leftHand' | 'rightHand' | 'head' | 'back', THREE.Group>;
};

export function createHumanoidRig({ name = 'humanoid', bodyScale = 1, armRestAngle = 0.18 } = {}): HumanoidRig {
  if (!Number.isFinite(bodyScale) || bodyScale <= 0) throw new RangeError('bodyScale must be finite and positive');
  if (!Number.isFinite(armRestAngle) || armRestAngle < 0 || armRestAngle > Math.PI / 2) throw new RangeError('armRestAngle must be between zero and PI / 2');
  const joint = (parent: THREE.Group, jointName: string, x = 0, y = 0, z = 0) => {
    const pivot = new THREE.Group();
    pivot.name = jointName;
    pivot.position.set(x * bodyScale, y * bodyScale, z * bodyScale);
    parent.add(pivot);
    return pivot;
  };
  const root = new THREE.Group();
  root.name = name;
  const model = joint(root, `${name}-model`);
  const pelvis = joint(model, 'pelvis', 0, 1.18);
  const torso = joint(model, 'torso', 0, 1.80);
  const head = joint(torso, 'head', 0, 0.86);
  const leg = (side: 'left' | 'right', direction: number) => {
    const hip = joint(pelvis, `${side}-hip`, direction * 0.205);
    const knee = joint(hip, `${side}-knee`, 0, -0.55);
    const foot = joint(knee, `${side}-ankle`, 0, -0.48);
    return { hip, knee, foot };
  };
  const arm = (side: 'left' | 'right', direction: number) => {
    const shoulder = joint(torso, `${side}-shoulder`, direction * 0.47, 0.31);
    shoulder.rotation.z = direction * armRestAngle;
    const elbow = joint(shoulder, 'elbow', 0, -0.46);
    elbow.rotation.x = -0.35;
    const hand = joint(elbow, `${side}-hand-socket`, 0, -0.46);
    return { shoulder, elbow, hand };
  };
  const leftLeg = leg('left', -1);
  const rightLeg = leg('right', 1);
  const leftArm = arm('left', -1);
  const rightArm = arm('right', 1);
  const soleSamples = [leftLeg.foot, rightLeg.foot].map(foot => ({
    foot,
    points: Array.from({ length: 12 }, (_, vertex) => {
      const angle = vertex / 12 * Math.PI * 2;
      return new THREE.Vector3(Math.cos(angle) * 0.12, -0.135, Math.sin(angle) * 0.24 + 0.065).multiplyScalar(bodyScale);
    }),
  }));
  return {
    root, model, bodyScale, pelvis, torso, head, torsoRestY: torso.position.y, soleSamples,
    waistMotionScale: 0.5,
    leftLeg: leftLeg.hip, rightLeg: rightLeg.hip,
    leftShin: leftLeg.knee, rightShin: rightLeg.knee,
    leftFoot: leftLeg.foot, rightFoot: rightLeg.foot,
    leftArm: leftArm.shoulder, rightArm: rightArm.shoulder,
    leftForearm: leftArm.elbow, rightForearm: rightArm.elbow,
    gait: { phase: 0, weight: 0 },
    sockets: {
      leftHand: leftArm.hand, rightHand: rightArm.hand,
      head: joint(head, 'head-socket'),
      back: joint(torso, 'back-socket', 0, 0.37, -0.25),
    },
  };
}