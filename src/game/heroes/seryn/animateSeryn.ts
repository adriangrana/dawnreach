import * as THREE from 'three';
import { animateHumanoid, HUMANOID_DEFAULT_MOVE_SPEED } from '../../characters/animateHumanoid';
import type { SerynRig } from './buildSeryn';

import { updateArcheryAttackPose } from './archeryPose';
export { SERYN_ATTACK_RELEASE_PROGRESS, SERYN_ATTACK_SWING_RATE } from './archeryPose';

function updateIdleHead(rig: SerynRig, elapsed: number, idle: boolean) {
  // Reset first because the humanoid locomotion animation intentionally leaves the
  // head joint free. Idle then layers sparse glances instead of continuous pendulum
  // motion, so she looks attentive rather than mechanically oscillating.
  rig.head.rotation.set(0, 0, 0);
  if (!idle) return;

  const cycle = 11.5;
  const phase = elapsed % cycle;
  const plateau = (begin: number, settle: number, release: number, end: number) =>
    THREE.MathUtils.smoothstep(phase, begin, settle)
      * (1 - THREE.MathUtils.smoothstep(phase, release, end));

  const leftGlance = plateau(1.6, 2.35, 3.55, 4.35);
  const rightGlance = plateau(6.25, 7.05, 8.55, 9.35);
  const yaw = THREE.MathUtils.degToRad(7.5) * leftGlance
    - THREE.MathUtils.degToRad(6.0) * rightGlance;
  const pitch = THREE.MathUtils.degToRad(-1.6) * leftGlance
    + THREE.MathUtils.degToRad(.9) * rightGlance;
  const roll = THREE.MathUtils.degToRad(-1.0) * leftGlance
    + THREE.MathUtils.degToRad(.8) * rightGlance;

  rig.head.rotation.set(pitch, yaw, roll);
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

/**
 * A bounded deformation field keeps neighbouring fibres together. Both sides of
 * the cloth use the same mid-surface displacement, preserving the sewn thickness.
 * Collision dimensions are in model space, so a scaled in-game hero behaves like
 * the full-size model in the laboratory.
 */
function updateCloth(rig: SerynRig, elapsed: number, moving: boolean, attackActive: boolean, attackProgress: number, _dt: number) {
  rig.root.updateMatrixWorld(true);
  const joints = [rig.leftLeg, rig.leftShin, rig.leftFoot, rig.rightLeg, rig.rightShin, rig.rightFoot];
  const world = joints.map(j => j.getWorldPosition(new THREE.Vector3()));
  const modelScale = rig.model.getWorldScale(new THREE.Vector3()).x;
  for (const cloth of rig.clothMeshes) {
    const dynamics = cloth.userData.serynClothDynamics;
    const g = cloth.geometry, p = g.getAttribute('position') as THREE.BufferAttribute;
    const uv = g.getAttribute('uv');
    const base = g.userData.serynClothBasePositions as Float32Array;
    if (!base || !dynamics) continue;
    const local = world.map(point => cloth.worldToLocal(point.clone()));
    const scale = modelScale / cloth.getWorldScale(new THREE.Vector3()).x;
    const cape = dynamics.role === 'cape', direction = cape ? -1 : 1;
    const half = p.count / 2;
    for (let i = 0; i < half; i++) {
      const k = i * 3, back = (i + half) * 3, v = uv.getY(i), u = uv.getX(i);
      const weight = smoothCloth(v), bias = Number(dynamics.bias ?? 0);
      const gait = rig.gait.phase + bias;
      const restX = (base[k] + base[back]) * .5, restY = (base[k + 1] + base[back + 1]) * .5;
      let x = restX + weight * (.012 * Math.sin(elapsed * 1.6 + v * 2 + bias) + .030 * rig.gait.weight * Math.sin(gait - v * 2));
      const y = restY + weight * .012 * Math.sin(elapsed * 1.8 + u * 2 + bias);
      const restZ = (base[k + 2] + base[back + 2]) * .5;
      let z = restZ + weight * direction * (.018 * Math.sin(elapsed * 1.7 - v * 3 + bias)
        + (moving ? .065 : .008) * Math.sin(gait - v * 2.2)
        + (attackActive ? Math.sin(attackProgress * Math.PI) * .04 : 0));
      // Capsule envelope is evaluated on the entire cloth mid-surface, not on
      // independently integrated vertices with unbounded velocities.
      for (const [a, b, radius, endRadius] of [[0, 1, .118, .077], [1, 2, .085, .052], [3, 4, .118, .077], [4, 5, .085, .052]]) {
        const start = local[a], end = local[b];
        const t = THREE.MathUtils.clamp((y - start.y) / (end.y - start.y || .001), 0, 1);
        const cy = THREE.MathUtils.lerp(start.y, end.y, t);
        const cx = THREE.MathUtils.lerp(start.x, end.x, t);
        const cz = THREE.MathUtils.lerp(start.z, end.z, t);
        const r = THREE.MathUtils.lerp(radius, endRadius, t) * scale + .009;
        const sideDirection = dynamics.role === 'side-left' ? 1 : dynamics.role === 'side-right' ? -1 : 0;
        const cross = r * r - (sideDirection ? (z - cz) ** 2 : (x - cx) ** 2) - (y - cy) ** 2;
        if (cross > 0) {
          const sign = sideDirection || direction;
          const value = sideDirection ? x : z, boundary = (sideDirection ? cx : cz) + sign * Math.sqrt(cross);
          const correction = (sign > 0 ? Math.max(0, boundary - value) : Math.min(0, boundary - value)) * THREE.MathUtils.smoothstep(v, .015, .16);
          if (sideDirection) x += correction; else z += correction;
        }
      }
      const dz = z - restZ;
      p.setXYZ(i, base[k] + x - restX, base[k + 1] + y - restY, base[k + 2] + dz);
      p.setXYZ(i + half, base[back] + x - restX, base[back + 1] + y - restY, base[back + 2] + dz);
    }
    p.needsUpdate = true;
    const frame = Number(cloth.userData.normalFrame ?? 0) + 1;
    cloth.userData.normalFrame = frame;
    if (frame % 3 === 0) g.computeVertexNormals();
  }
}

function smoothCloth(v: number) { return v * v * (3 - 2 * v); }

const walkBowTorsoWorldQ = new THREE.Quaternion();
const walkBowParentWorldQ = new THREE.Quaternion();
const walkBowTargetWorldQ = new THREE.Quaternion();
const walkBowTargetLocalQ = new THREE.Quaternion();
const walkBowJointQ = new THREE.Quaternion();

function stabilizeWalkBowOrientation(rig: SerynRig) {
  const walk = THREE.MathUtils.smoothstep(rig.gait.weight, 0, 1);
  if (walk <= 0.0001) return;

  // Preserve the GOOD part of locomotion: the whole left arm swings exactly with the
  // walk cycle and the grip therefore travels with the hand. Only compensate the bow's
  // orientation so that parent-joint rotations do not roll the longbow upright/sideways.
  //
  // The target below is the mean idle carry orientation relative to the torso. We then
  // convert that target back into the moving hand socket's local space. Translation is
  // untouched, so the bow still follows the hand perfectly while walking.
  rig.root.updateMatrixWorld(true);
  rig.torso.getWorldQuaternion(walkBowTorsoWorldQ);

  walkBowTargetWorldQ.copy(walkBowTorsoWorldQ);
  walkBowTargetWorldQ.multiply(
    walkBowJointQ.setFromEuler(new THREE.Euler(
      -0.012,
      0.18,
      0.075,
      'XYZ',
    )),
  );
  walkBowTargetWorldQ.multiply(
    walkBowJointQ.setFromEuler(new THREE.Euler(
      -THREE.MathUtils.degToRad(9),
      1.13,
      0,
      'XYZ',
    )),
  );
  walkBowTargetWorldQ.multiply(
    walkBowJointQ.setFromEuler(new THREE.Euler(
      0.025,
      0,
      0.015,
      'XYZ',
    )),
  );
  walkBowTargetWorldQ.multiply(
    walkBowJointQ.setFromEuler(rig.bowRestRotation),
  );

  rig.sockets.leftHand.getWorldQuaternion(walkBowParentWorldQ);
  walkBowTargetLocalQ.copy(walkBowParentWorldQ).invert().multiply(walkBowTargetWorldQ);

  // Blend through gait.weight so starting/stopping does not snap the weapon.
  rig.bow.quaternion.slerp(walkBowTargetLocalQ, walk);
}

export function animateSeryn(
  rig: SerynRig,
  elapsed: number,
  moving: boolean,
  delta = 1 / 60,
  speed = HUMANOID_DEFAULT_MOVE_SPEED,
) {
  const dt = Math.max(1 / 240, Math.min(delta, 0.05));
  // Locomotion only authors some Euler axes. Reset the others so an archery
  // pose cannot leave permanent shoulder/forearm twist in the next idle frame.
  rig.leftArm.rotation.set(0, 0, .075);
  rig.rightArm.rotation.set(0, 0, -.090);
  rig.leftForearm.rotation.set(0, 0, 0);
  rig.rightForearm.rotation.set(0, 0, 0);
  rig.sockets.leftHand.rotation.set(0, 0, 0);
  rig.sockets.rightHand.rotation.set(0, 0, 0);
  animateHumanoid(rig, elapsed, moving, dt, speed / rig.model.scale.x);

  const attackProgress = Number(rig.root.userData.serynAttackProgress ?? 0);
  const attackActive = attackProgress > 0 && attackProgress < 1;
  const resting = 1 - THREE.MathUtils.smoothstep(rig.gait.weight, 0, 1);
  updateIdleHead(rig, elapsed, !moving && !attackActive);
  // Author the same resting baseline on every frame. The attack solver blends over
  // it, including recovery, so the forearm cannot snap back by 65 degrees at p=1.
  const relaxed = resting;
  for (const side of [-1, 1]) {
    const arm = side > 0 ? rig.leftArm : rig.rightArm;
    const forearm = side > 0 ? rig.leftForearm : rig.rightForearm;
    const hand = side > 0 ? rig.sockets.leftHand : rig.sockets.rightHand;
    arm.rotation.x = THREE.MathUtils.lerp(arm.rotation.x, -.012 + Math.sin(elapsed * 1.35 + side) * .010, relaxed);
    arm.rotation.y = side * .18 * relaxed;
    forearm.rotation.x = THREE.MathUtils.lerp(forearm.rotation.x, -THREE.MathUtils.degToRad(side > 0 ? 9 : 7), relaxed);
    // Neutral forearm rotation: palm toward the thigh, thumb facing forward.
    forearm.rotation.y = side * 1.13 * relaxed;
    hand.rotation.x = .025 * relaxed;
    hand.rotation.z = side * .015 * relaxed;
  }

  if (attackActive) {
    updateArcheryAttackPose(rig, attackProgress);
  } else {
    updateArcheryAttackPose(rig, 0);

    if (moving || rig.gait.weight > 0.0001) {
      // Arm translation/swing remains completely locomotion-driven. Correct only the
      // bow roll so its horizontal carry orientation does not get destroyed by the
      // animated shoulder/forearm hierarchy.
      stabilizeWalkBowOrientation(rig);
    } else {
      rig.torso.rotation.y += Math.sin(elapsed * 0.8) * 0.018;
    }
  }

  // Evaluate secondary motion from the completed anatomical pose.
  updateHair(rig, elapsed, moving);
  updateCloth(rig, elapsed, moving, attackActive, attackProgress, dt);
}
