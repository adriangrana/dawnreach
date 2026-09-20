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

type ClothVertexState = {
  velocity: Float32Array;
};

type LocalCapsule = {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  radius: number;
};

const WORLD_DOWN = new THREE.Vector3(0, -1, 0);
const TMP_WORLD_POS = new THREE.Vector3();
const TMP_PREV_POS = new THREE.Vector3();
const TMP_WORLD_VELOCITY = new THREE.Vector3();
const TMP_LOCAL_VELOCITY = new THREE.Vector3();
const TMP_WORLD_QUAT = new THREE.Quaternion();
const TMP_INV_WORLD_QUAT = new THREE.Quaternion();
const TMP_LOCAL_DOWN = new THREE.Vector3();
const TMP_SCALE = new THREE.Vector3();
const LEFT_HIP = new THREE.Vector3();
const LEFT_KNEE = new THREE.Vector3();
const LEFT_ANKLE = new THREE.Vector3();
const RIGHT_HIP = new THREE.Vector3();
const RIGHT_KNEE = new THREE.Vector3();
const RIGHT_ANKLE = new THREE.Vector3();
const PELVIS_CENTER = new THREE.Vector3();

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

function worldPointInCloth(cloth: THREE.Object3D, world: THREE.Vector3) {
  return cloth.worldToLocal(world.clone());
}

function buildLegColliders(rig: SerynRig, cloth: THREE.Mesh, margin: number): LocalCapsule[] {
  rig.leftLeg.getWorldPosition(LEFT_HIP);
  rig.leftShin.getWorldPosition(LEFT_KNEE);
  rig.leftFoot.getWorldPosition(LEFT_ANKLE);
  rig.rightLeg.getWorldPosition(RIGHT_HIP);
  rig.rightShin.getWorldPosition(RIGHT_KNEE);
  rig.rightFoot.getWorldPosition(RIGHT_ANKLE);
  rig.pelvis.getWorldPosition(PELVIS_CENTER);

  cloth.updateWorldMatrix(true, false);
  cloth.getWorldScale(TMP_SCALE);
  const localScale = Math.max(0.001, (Math.abs(TMP_SCALE.x) + Math.abs(TMP_SCALE.y) + Math.abs(TMP_SCALE.z)) / 3);

  const lh = worldPointInCloth(cloth, LEFT_HIP);
  const lk = worldPointInCloth(cloth, LEFT_KNEE);
  const la = worldPointInCloth(cloth, LEFT_ANKLE);
  const rh = worldPointInCloth(cloth, RIGHT_HIP);
  const rk = worldPointInCloth(cloth, RIGHT_KNEE);
  const ra = worldPointInCloth(cloth, RIGHT_ANKLE);
  const pelvis = worldPointInCloth(cloth, PELVIS_CENTER);

  const thighRadius = (0.138 + margin) / localScale;
  const shinRadius = (0.098 + margin) / localScale;
  const hipRadius = (0.155 + margin) / localScale;

  return [
    { ax: lh.x, ay: lh.y, az: lh.z, bx: lk.x, by: lk.y, bz: lk.z, radius: thighRadius },
    { ax: lk.x, ay: lk.y, az: lk.z, bx: la.x, by: la.y, bz: la.z, radius: shinRadius },
    { ax: rh.x, ay: rh.y, az: rh.z, bx: rk.x, by: rk.y, bz: rk.z, radius: thighRadius },
    { ax: rk.x, ay: rk.y, az: rk.z, bx: ra.x, by: ra.y, bz: ra.z, radius: shinRadius },
    // Short vertical pelvis capsule prevents the upper tunic from being swallowed by
    // the hips while still allowing the lower cloth to separate between the legs.
    {
      ax: pelvis.x,
      ay: pelvis.y + 0.10 / localScale,
      az: pelvis.z,
      bx: pelvis.x,
      by: pelvis.y - 0.16 / localScale,
      bz: pelvis.z,
      radius: hipRadius,
    },
  ];
}

function collideWithCapsule(
  x: number,
  y: number,
  z: number,
  vx: number,
  vy: number,
  vz: number,
  capsule: LocalCapsule,
  fallbackX: number,
  fallbackZ: number,
) {
  const abx = capsule.bx - capsule.ax;
  const aby = capsule.by - capsule.ay;
  const abz = capsule.bz - capsule.az;
  const apx = x - capsule.ax;
  const apy = y - capsule.ay;
  const apz = z - capsule.az;
  const lengthSq = abx * abx + aby * aby + abz * abz;
  const t = lengthSq > 1e-8
    ? THREE.MathUtils.clamp((apx * abx + apy * aby + apz * abz) / lengthSq, 0, 1)
    : 0;

  const qx = capsule.ax + abx * t;
  const qy = capsule.ay + aby * t;
  const qz = capsule.az + abz * t;
  let dx = x - qx;
  let dy = y - qy;
  let dz = z - qz;
  let distanceSq = dx * dx + dy * dy + dz * dz;
  const radiusSq = capsule.radius * capsule.radius;

  if (distanceSq >= radiusSq) return { x, y, z, vx, vy, vz, hit: false };

  let distance = Math.sqrt(Math.max(distanceSq, 1e-10));
  if (distance < 0.0001) {
    dx = fallbackX;
    dy = 0;
    dz = fallbackZ;
    distance = Math.hypot(dx, dz);
    if (distance < 0.0001) {
      dx = 0;
      dz = 1;
      distance = 1;
    }
  }

  const nx = dx / distance;
  const ny = dy / distance;
  const nz = dz / distance;
  const penetration = capsule.radius - distance + 0.002;
  x += nx * penetration;
  y += ny * penetration;
  z += nz * penetration;

  // Remove only velocity travelling into the leg. Tangential velocity is preserved so
  // the fabric slides around the limb rather than sticking to it.
  const inward = vx * nx + vy * ny + vz * nz;
  if (inward < 0) {
    vx -= nx * inward * 0.92;
    vy -= ny * inward * 0.92;
    vz -= nz * inward * 0.92;
  }

  return { x, y, z, vx, vy, vz, hit: true };
}

function updateCloth(
  rig: SerynRig,
  elapsed: number,
  moving: boolean,
  attackActive: boolean,
  attackProgress: number,
  dt: number,
) {
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
    ? Math.sin(Math.min(1, attackProgress) * Math.PI)
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

    let state = cloth.userData.serynClothVertexState as ClothVertexState | undefined;
    if (!state || state.velocity.length !== position.count * 3) {
      state = { velocity: new Float32Array(position.count * 3) };
      cloth.userData.serynClothVertexState = state;
    }
    const velocity = state.velocity;
    const colliders = buildLegColliders(rig, cloth, dynamics.collisionMargin);

    const roleScale = dynamics.role === 'cape' ? 1.45 : dynamics.role === 'front' ? 1.05 : 1.18;
    const stiffness = dynamics.role === 'cape' ? 8.5 : dynamics.role === 'front' ? 13.5 : 11.5;
    const damping = dynamics.role === 'cape' ? 3.3 : dynamics.role === 'front' ? 4.8 : 4.2;
    const maxOffset = dynamics.role === 'cape' ? 0.34 : 0.22;

    // Even in the Model Lab the hero walks in place. These forces are derived from gait
    // phase so the hanging cloth visibly reacts to every step instead of waiting for
    // world-space translation that never occurs in the preview.
    const gaitForward = Math.sin(gait) * gaitWeight;
    const gaitSide = Math.sin(gait * 2 + 0.35) * gaitWeight;
    const idleBreath = Math.sin(elapsed * 1.45) * (moving ? 0 : 1);

    const substeps = 2;
    const h = dt / substeps;
    for (let substep = 0; substep < substeps; substep++) {
      for (let index = 0; index < position.count; index++) {
        const weight = flex.getX(index);
        const v = uv.getY(index);
        const p = phase.getX(index);
        const baseIndex = index * 3;

        if (weight < 0.002) {
          position.setXYZ(index, base[baseIndex], base[baseIndex + 1], base[baseIndex + 2]);
          velocity[baseIndex] = 0;
          velocity[baseIndex + 1] = 0;
          velocity[baseIndex + 2] = 0;
          continue;
        }

        let x = position.getX(index);
        let y = position.getY(index);
        let z = position.getZ(index);
        let vx = velocity[baseIndex];
        let vy = velocity[baseIndex + 1];
        let vz = velocity[baseIndex + 2];

        const lower = Math.pow(v, 1.55);
        const restX = base[baseIndex];
        const restY = base[baseIndex + 1];
        const restZ = base[baseIndex + 2];

        // Gravity is evaluated in the animated torso's local frame. Rest shape already
        // hangs downward, so only the deviation from local -Y becomes a force.
        const gravityX = TMP_LOCAL_DOWN.x * 1.25 * dynamics.gravity;
        const gravityY = (TMP_LOCAL_DOWN.y + 1) * 1.25 * dynamics.gravity;
        const gravityZ = TMP_LOCAL_DOWN.z * 1.25 * dynamics.gravity;

        // Translation inertia, torso twist, gait and attack impulses.
        const inertiaX = -TMP_LOCAL_VELOCITY.x * 0.42 * dynamics.inertia * roleScale;
        const inertiaY = -TMP_LOCAL_VELOCITY.y * 0.15 * dynamics.inertia;
        const inertiaZ = -TMP_LOCAL_VELOCITY.z * 0.48 * dynamics.inertia * roleScale;

        const walkX = gaitSide * (dynamics.role === 'cape' ? 0.30 : 0.20) * lower;
        const walkZ = gaitForward * (dynamics.role === 'cape' ? 0.72 : 0.46) * lower;
        const twistX = -yawVelocity * (dynamics.role === 'cape' ? 0.075 : 0.045) * dynamics.inertia * lower;
        const attackX =
          attackImpulse
          * (dynamics.role === 'cape' ? -0.48 : dynamics.role === 'front' ? 0.18 : 0.34)
          * lower;
        const attackZ =
          attackImpulse
          * (dynamics.role === 'cape' ? -0.62 : 0.25)
          * lower;
        const idleZ = idleBreath * (dynamics.role === 'cape' ? 0.030 : 0.012) * lower;
        const ripple = Math.sin(elapsed * (moving ? 5.4 : 1.4) + p * 1.2) * (moving ? 0.055 : 0.018) * lower;

        const springX = (restX - x) * stiffness;
        const springY = (restY - y) * stiffness;
        const springZ = (restZ - z) * stiffness;

        vx += (springX + gravityX + inertiaX + walkX + twistX + attackX + ripple) * weight * h;
        vy += (springY + gravityY + inertiaY) * weight * h;
        vz += (springZ + gravityZ + inertiaZ + walkZ + attackZ + idleZ) * weight * h;

        const drag = Math.exp(-damping * h);
        vx *= drag;
        vy *= drag;
        vz *= drag;

        x += vx * h;
        y += vy * h;
        z += vz * h;

        // Clamp extreme displacement while leaving the lower hem appreciably freer.
        const allowed = 0.035 + maxOffset * weight;
        let dx = x - restX;
        let dy = y - restY;
        let dz = z - restZ;
        const offsetLength = Math.hypot(dx, dy, dz);
        if (offsetLength > allowed) {
          const scale = allowed / offsetLength;
          x = restX + dx * scale;
          y = restY + dy * scale;
          z = restZ + dz * scale;
          vx *= 0.82;
          vy *= 0.82;
          vz *= 0.82;
        }

        // Dynamic collision with BOTH animated legs and pelvis. This is what prevents a
        // walking thigh/knee from passing through a hanging front/side tunic panel.
        const fallbackX =
          dynamics.role === 'side-left' ? -1 :
          dynamics.role === 'side-right' ? 1 :
          Math.sign(restX || 1) * 0.35;
        const fallbackZ = dynamics.role === 'cape' ? -1 : 1;

        for (const capsule of colliders) {
          const collided = collideWithCapsule(
            x, y, z, vx, vy, vz,
            capsule,
            fallbackX,
            fallbackZ,
          );
          x = collided.x;
          y = collided.y;
          z = collided.z;
          vx = collided.vx;
          vy = collided.vy;
          vz = collided.vz;
        }

        position.setXYZ(index, x, y, z);
        velocity[baseIndex] = vx;
        velocity[baseIndex + 1] = vy;
        velocity[baseIndex + 2] = vz;
      }
    }

    position.needsUpdate = true;
    const frame = ((cloth.userData.serynClothNormalFrame as number | undefined) ?? 0) + 1;
    cloth.userData.serynClothNormalFrame = frame;
    if (frame % 3 === 0) geometry.computeVertexNormals();
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

  // Secondary motion is evaluated from the completed body pose. Hanging garments use
  // per-vertex inertia plus animated-body collision rather than one rigid offset shared
  // by the whole panel.
  updateHair(rig, elapsed, moving);
  updateCloth(rig, elapsed, moving, attackActive, attackProgress, dt);
}
