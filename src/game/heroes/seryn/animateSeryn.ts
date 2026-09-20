import * as THREE from 'three';
import { animateHumanoid, HUMANOID_DEFAULT_MOVE_SPEED } from '../../characters/animateHumanoid';
import type { SerynRig } from './buildSeryn';

type ClothRole = 'front' | 'side-left' | 'side-right' | 'cape';

type ClothDynamics = {
  role: ClothRole;
  inertia: number;
  gravity: number;
  collisionMargin: number;
  basePosition: THREE.Vector3;
  baseRotation: THREE.Euler;
};

type ClothSpringState = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
};

const WORLD_DOWN = new THREE.Vector3(0, -1, 0);
const TMP_WORLD_POS = new THREE.Vector3();
const TMP_PREV_POS = new THREE.Vector3();
const TMP_WORLD_VELOCITY = new THREE.Vector3();
const TMP_LOCAL_VELOCITY = new THREE.Vector3();
const TMP_WORLD_QUAT = new THREE.Quaternion();
const TMP_INV_WORLD_QUAT = new THREE.Quaternion();
const TMP_LOCAL_DOWN = new THREE.Vector3();

function dampedSpring(
  value: number,
  velocity: number,
  target: number,
  stiffness: number,
  damping: number,
  dt: number,
) {
  const acceleration = (target - value) * stiffness - velocity * damping;
  const nextVelocity = velocity + acceleration * dt;
  return [value + nextVelocity * dt, nextVelocity] as const;
}

function wrapAngle(angle: number) {
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function updateHair(rig: SerynRig, elapsed: number, moving: boolean) {
  const geometry = rig.hair.geometry;
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const flex = geometry.getAttribute('hairFlex') as THREE.BufferAttribute;
  const phase = geometry.getAttribute('hairPhase') as THREE.BufferAttribute;
  const base = geometry.userData.serynHairBasePositions as Float32Array | undefined;
  if (!base || !flex || !phase) return;

  const walkStrength = moving ? 1 : 0.35;
  const swayX = Math.sin(elapsed * (moving ? 5.2 : 1.55)) * 0.010 * walkStrength;
  const swayZ = Math.cos(elapsed * (moving ? 4.7 : 1.35) + 0.7) * 0.007 * walkStrength;
  for (let index = 0; index < position.count; index++) {
    const weight = flex.getX(index);
    const p = phase.getX(index);
    const baseIndex = index * 3;
    const localWave = Math.sin(elapsed * 2.0 + p * 1.7) * 0.0025 * weight;
    position.setXYZ(
      index,
      base[baseIndex] + swayX * weight + localWave,
      base[baseIndex + 1] + Math.sin(elapsed * 1.35 + p) * 0.0014 * weight,
      base[baseIndex + 2] + swayZ * weight + localWave * 0.35,
    );
  }
  position.needsUpdate = true;
  const frame = ((rig.root.userData.serynHairNormalFrame as number | undefined) ?? 0) + 1;
  rig.root.userData.serynHairNormalFrame = frame;
  if (frame % 4 === 0) geometry.computeVertexNormals();
}

function updateCloth(
  rig: SerynRig,
  elapsed: number,
  moving: boolean,
  attackActive: boolean,
  attackProgress: number,
  dt: number,
) {
  // Evaluate the FINAL animated pose first. This is essential: cloth inertia must react
  // to the attack/walk/idle pose, not to the pre-pose skeleton from earlier in the frame.
  rig.root.updateMatrixWorld(true);
  rig.torso.getWorldPosition(TMP_WORLD_POS);
  rig.torso.getWorldQuaternion(TMP_WORLD_QUAT);

  const previousPosition = rig.root.userData.serynClothPreviousTorsoPosition as THREE.Vector3 | undefined;
  if (previousPosition) {
    TMP_PREV_POS.copy(previousPosition);
    TMP_WORLD_VELOCITY.copy(TMP_WORLD_POS).sub(TMP_PREV_POS).multiplyScalar(1 / Math.max(dt, 1 / 240));
  } else {
    TMP_WORLD_VELOCITY.set(0, 0, 0);
    rig.root.userData.serynClothPreviousTorsoPosition = TMP_WORLD_POS.clone();
  }
  (rig.root.userData.serynClothPreviousTorsoPosition as THREE.Vector3).copy(TMP_WORLD_POS);

  // Convert character translation to torso-local inertia. Clamp teleports/spawns so
  // they do not explode the cloth simulation.
  if (TMP_WORLD_VELOCITY.lengthSq() > 64) TMP_WORLD_VELOCITY.setLength(8);
  TMP_INV_WORLD_QUAT.copy(TMP_WORLD_QUAT).invert();
  TMP_LOCAL_VELOCITY.copy(TMP_WORLD_VELOCITY).applyQuaternion(TMP_INV_WORLD_QUAT);
  TMP_LOCAL_DOWN.copy(WORLD_DOWN).applyQuaternion(TMP_INV_WORLD_QUAT);

  const previousYaw = Number(rig.root.userData.serynClothPreviousTorsoYaw ?? rig.torso.rotation.y);
  const yawVelocity = wrapAngle(rig.torso.rotation.y - previousYaw) / Math.max(dt, 1 / 240);
  rig.root.userData.serynClothPreviousTorsoYaw = rig.torso.rotation.y;

  const gait = rig.gait.phase;
  const gaitWeight = rig.gait.weight;
  const attackImpulse = attackActive
    ? Math.sin(Math.min(1, attackProgress) * Math.PI) * 0.085
    : 0;

  for (const cloth of rig.clothMeshes) {
    const dynamics = cloth.userData.serynClothDynamics as ClothDynamics | undefined;
    if (!dynamics) continue;

    const geometry = cloth.geometry;
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    const flex = geometry.getAttribute('clothFlex') as THREE.BufferAttribute;
    const phase = geometry.getAttribute('clothPhase') as THREE.BufferAttribute;
    const base = geometry.userData.serynClothBasePositions as Float32Array | undefined;
    if (!base || !flex || !phase || !uv) continue;

    let state = cloth.userData.serynClothSpringState as ClothSpringState | undefined;
    if (!state) {
      state = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
      cloth.userData.serynClothSpringState = state;
    }

    // Inertia is opposite current body velocity; transformed gravity makes the cloth
    // continue hanging downward even while the torso rolls during locomotion.
    const roleScale = dynamics.role === 'cape' ? 1.38 : dynamics.role === 'front' ? 0.72 : 0.95;
    const gaitSide = Math.sin(gait) * gaitWeight * (dynamics.role === 'cape' ? 0.018 : 0.010);
    const targetX =
      -TMP_LOCAL_VELOCITY.x * 0.018 * dynamics.inertia * roleScale
      + TMP_LOCAL_DOWN.x * 0.17 * dynamics.gravity
      - yawVelocity * 0.0065 * dynamics.inertia
      + gaitSide;
    const targetY =
      -TMP_LOCAL_VELOCITY.y * 0.008 * dynamics.inertia
      + Math.min(0, TMP_LOCAL_DOWN.y + 1) * 0.025 * dynamics.gravity;
    const forwardLag =
      -TMP_LOCAL_VELOCITY.z * 0.020 * dynamics.inertia * roleScale
      + TMP_LOCAL_DOWN.z * 0.18 * dynamics.gravity;
    const roleAttack =
      dynamics.role === 'cape' ? -attackImpulse :
      dynamics.role === 'front' ? attackImpulse * 0.28 :
      (dynamics.role === 'side-left' ? -1 : 1) * attackImpulse * 0.45;
    const targetZ = forwardLag + roleAttack;

    const stiffness = dynamics.role === 'cape' ? 24 : 36;
    const damping = dynamics.role === 'cape' ? 8.2 : 10.5;
    [state.x, state.vx] = dampedSpring(state.x, state.vx, THREE.MathUtils.clamp(targetX, -0.12, 0.12), stiffness, damping, dt);
    [state.y, state.vy] = dampedSpring(state.y, state.vy, THREE.MathUtils.clamp(targetY, -0.045, 0.045), stiffness, damping, dt);
    [state.z, state.vz] = dampedSpring(state.z, state.vz, THREE.MathUtils.clamp(targetZ, -0.18, 0.18), stiffness, damping, dt);

    for (let index = 0; index < position.count; index++) {
      const weight = flex.getX(index);
      const p = phase.getX(index);
      const v = uv.getY(index);
      const baseIndex = index * 3;
      const lower = Math.pow(v, 1.55);
      const flutter =
        Math.sin(elapsed * (moving ? 5.1 : 1.35) + p * 1.35)
        * (moving ? 0.0048 : 0.0018)
        * weight;
      const stepKick =
        Math.sin(gait * 2 + p * 0.18)
        * gaitWeight
        * 0.005
        * lower;

      let x = base[baseIndex] + state.x * weight + flutter;
      let y = base[baseIndex + 1] + state.y * weight + stepKick;
      let z = base[baseIndex + 2] + state.z * weight;

      // Collision envelope: the anchored/top half of every garment is not allowed to
      // move through the body. The free hem gains progressively more freedom.
      const protect = 1 - THREE.MathUtils.smoothstep(v, 0.22, 0.72);
      const margin = dynamics.collisionMargin * protect;

      if (dynamics.role === 'front') {
        // Front tunic must remain in front of its authored body-contouring rest shape.
        z = Math.max(z, base[baseIndex + 2] - margin);
      } else if (dynamics.role === 'cape') {
        // Cape remains behind the back near its anchors; lower hem can swing freely.
        z = Math.min(z, base[baseIndex + 2] + margin);
      } else if (dynamics.role === 'side-left') {
        x = Math.min(x, base[baseIndex] + margin);
      } else if (dynamics.role === 'side-right') {
        x = Math.max(x, base[baseIndex] - margin);
      }

      position.setXYZ(index, x, y, z);
    }

    position.needsUpdate = true;
    const normalFrame = ((cloth.userData.serynClothNormalFrame as number | undefined) ?? 0) + 1;
    cloth.userData.serynClothNormalFrame = normalFrame;
    if (normalFrame % 4 === 0) geometry.computeVertexNormals();
  }
}

export function animateSeryn(
  rig: SerynRig,
  elapsed: number,
  moving: boolean,
  delta = 1 / 60,
  speed = HUMANOID_DEFAULT_MOVE_SPEED,
) {
  const dt = Math.max(1 / 240, Math.min(delta, 0.05));
  animateHumanoid(rig, elapsed, moving, dt, speed / rig.model.scale.x);

  const attackProgress = Number(rig.root.userData.serynAttackProgress ?? 0);
  const attackActive = attackProgress > 0 && attackProgress < 1;
  const idle = (Math.sin(elapsed * 1.7) + 1) * 0.5;

  // Finish the hero pose BEFORE evaluating secondary motion.
  if (attackActive) {
    const draw = Math.sin(Math.min(1, attackProgress / 0.55) * Math.PI * 0.5);
    const release = attackProgress > 0.55 ? (attackProgress - 0.55) / 0.45 : 0;
    rig.leftArm.rotation.x = THREE.MathUtils.lerp(rig.leftArm.rotation.x, THREE.MathUtils.degToRad(-72), draw);
    rig.leftArm.rotation.y = THREE.MathUtils.lerp(rig.leftArm.rotation.y, THREE.MathUtils.degToRad(18), draw);
    rig.leftForearm.rotation.x = THREE.MathUtils.lerp(rig.leftForearm.rotation.x, THREE.MathUtils.degToRad(-22), draw);
    rig.rightArm.rotation.x = THREE.MathUtils.lerp(rig.rightArm.rotation.x, THREE.MathUtils.degToRad(-68), draw);
    rig.rightArm.rotation.y = THREE.MathUtils.lerp(rig.rightArm.rotation.y, THREE.MathUtils.degToRad(-28), draw);
    rig.rightForearm.rotation.x = THREE.MathUtils.lerp(rig.rightForearm.rotation.x, THREE.MathUtils.degToRad(-105 + 80 * release), draw);
    rig.torso.rotation.y += THREE.MathUtils.degToRad(-12) * draw;
  } else if (!moving) {
    rig.leftArm.rotation.x += THREE.MathUtils.degToRad(-8 - idle * 2);
    rig.rightArm.rotation.x += THREE.MathUtils.degToRad(-5 + idle * 2);
    rig.torso.rotation.y += Math.sin(elapsed * 0.8) * 0.018;
  }

  // Hair and cloth now react to the final pose. Cloth additionally responds to real
  // world translation, torso gravity orientation, gait and attack angular inertia.
  updateHair(rig, elapsed, moving);
  updateCloth(rig, elapsed, moving, attackActive, attackProgress, dt);
}
