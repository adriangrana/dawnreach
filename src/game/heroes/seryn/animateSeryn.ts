import * as THREE from 'three';
import { animateHumanoid, HUMANOID_DEFAULT_MOVE_SPEED } from '../../characters/animateHumanoid';
import type { SerynRig } from './buildSeryn';

export const SERYN_ATTACK_RELEASE_PROGRESS = 0.64;
export const SERYN_ATTACK_SWING_RATE = 2.2;

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

function setBowStringDraw(rig: SerynRig, draw: number) {
  const position = rig.bowString.geometry.getAttribute('position') as THREE.BufferAttribute;
  if (!position || position.count < 3) return;
  const centerZ = THREE.MathUtils.lerp(-0.105, -0.305, draw);
  position.setXYZ(1, 0.046, 0, centerZ);
  position.needsUpdate = true;
}

function updateArcheryAttackPose(rig: SerynRig, progress: number) {
  const active = progress > 0 && progress < 1;

  if (!active) {
    rig.bow.position.copy(rig.bowRestPosition);
    rig.bow.rotation.copy(rig.bowRestRotation);
    rig.handArrow.visible = false;
    rig.nockedArrow.visible = false;
    for (const arrow of rig.quiverArrows) arrow.visible = true;
    setBowStringDraw(rig, 0);
    return;
  }

  const p = THREE.MathUtils.clamp(progress, 0, 1);
  const reach = THREE.MathUtils.smoothstep(p, 0.02, 0.24);
  const transfer = THREE.MathUtils.smoothstep(p, 0.22, 0.46);
  const raise = THREE.MathUtils.smoothstep(p, 0.24, 0.52);
  const draw = THREE.MathUtils.smoothstep(p, 0.46, SERYN_ATTACK_RELEASE_PROGRESS);
  const release = THREE.MathUtils.smoothstep(p, SERYN_ATTACK_RELEASE_PROGRESS, 0.77);
  const recover = THREE.MathUtils.smoothstep(p, 0.78, 1);

  // Left arm extends the bow toward the target. Dawnreach humanoids face local +Z, so
  // -90 degrees around X takes the hanging arm from -Y into the forward direction.
  const bowPose = Math.max(raise, draw);
  rig.leftArm.rotation.x = THREE.MathUtils.lerp(rig.leftArm.rotation.x, -Math.PI * 0.49, bowPose);
  rig.leftArm.rotation.y = THREE.MathUtils.lerp(rig.leftArm.rotation.y, 0.12, bowPose);
  rig.leftArm.rotation.z = THREE.MathUtils.lerp(rig.leftArm.rotation.z, 0.04, bowPose);
  rig.leftForearm.rotation.x = THREE.MathUtils.lerp(rig.leftForearm.rotation.x, -0.10, bowPose);
  rig.leftForearm.rotation.z = THREE.MathUtils.lerp(rig.leftForearm.rotation.z, -0.03, bowPose);

  // The raised left arm contributes roughly -90° around X. Counter-rotate the bow
  // roughly +90° around X so its limbs remain vertical while bow-local +Z points
  // straight toward the target. This is the canonical archer orientation:
  // vertical bow, horizontal/forward arrow.
  rig.bow.position.set(
    THREE.MathUtils.lerp(rig.bowRestPosition.x, 0.014, bowPose),
    THREE.MathUtils.lerp(rig.bowRestPosition.y, -0.070, bowPose),
    THREE.MathUtils.lerp(rig.bowRestPosition.z, 0.028, bowPose),
  );
  rig.bow.rotation.set(
    THREE.MathUtils.lerp(rig.bowRestRotation.x, Math.PI / 2, bowPose),
    THREE.MathUtils.lerp(rig.bowRestRotation.y, 0, bowPose),
    THREE.MathUtils.lerp(rig.bowRestRotation.z, -0.018, bowPose),
  );

  // Phase 1: the right hand reaches back to the quiver.
  if (p < 0.30) {
    rig.rightArm.rotation.x = THREE.MathUtils.lerp(rig.rightArm.rotation.x, 1.10, reach);
    rig.rightArm.rotation.y = THREE.MathUtils.lerp(rig.rightArm.rotation.y, -0.32, reach);
    rig.rightArm.rotation.z = THREE.MathUtils.lerp(rig.rightArm.rotation.z, -0.24, reach);
    rig.rightForearm.rotation.x = THREE.MathUtils.lerp(rig.rightForearm.rotation.x, -1.18, reach);
    rig.rightForearm.rotation.z = THREE.MathUtils.lerp(rig.rightForearm.rotation.z, 0.18, reach);
  } else {
    // Phase 2: carry the arrow forward to the string, then pull it back beside the face.
    const handForward = THREE.MathUtils.smoothstep(p, 0.28, 0.49);
    rig.rightArm.rotation.x = THREE.MathUtils.lerp(1.10, -1.02, handForward);
    rig.rightArm.rotation.y = THREE.MathUtils.lerp(-0.32, -0.58, handForward);
    rig.rightArm.rotation.z = THREE.MathUtils.lerp(-0.24, -0.12, handForward);
    rig.rightForearm.rotation.x = THREE.MathUtils.lerp(-1.18, -1.52, Math.max(handForward, draw));
    rig.rightForearm.rotation.z = THREE.MathUtils.lerp(0.18, -0.08, handForward);

    // At full draw the elbow opens slightly so the hand reads as pulling the string
    // rather than folding into the chest.
    rig.rightArm.rotation.y -= draw * 0.18;
    rig.rightArm.rotation.z -= draw * 0.16;
  }

  // The top arrow visibly leaves the quiver, is carried in the hand, then appears
  // nocked on the bow. This keeps the attack readable without teleporting an arrow from
  // nowhere directly onto the string.
  const quiverArrow = rig.quiverArrows[rig.quiverArrows.length - 1];
  if (quiverArrow) quiverArrow.visible = p < 0.12 || p > 0.94;

  rig.handArrow.visible = p >= 0.12 && p < 0.44;
  if (rig.handArrow.visible) {
    const carry = THREE.MathUtils.smoothstep(p, 0.12, 0.44);
    rig.handArrow.position.set(
      THREE.MathUtils.lerp(-0.015, 0.018, carry),
      THREE.MathUtils.lerp(-0.020, 0.020, carry),
      THREE.MathUtils.lerp(0.005, 0.030, carry),
    );
    rig.handArrow.rotation.set(
      THREE.MathUtils.lerp(0.18, -0.08, carry),
      THREE.MathUtils.lerp(0.18, -0.28, carry),
      THREE.MathUtils.lerp(-0.44, -Math.PI / 2, carry),
    );
  }

  const arrowOnString = p >= 0.40 && p < SERYN_ATTACK_RELEASE_PROGRESS;
  rig.nockedArrow.visible = arrowOnString;
  const stringDraw = draw * (1 - release);
  setBowStringDraw(rig, stringDraw);
  rig.nockedArrow.position.set(
    0.046,
    0,
    THREE.MathUtils.lerp(-0.105, -0.305, stringDraw),
  );

  // Release recoil and recovery.
  if (release > 0) {
    rig.leftArm.rotation.x += release * 0.035;
    rig.rightForearm.rotation.x += release * 0.30;
    rig.torso.rotation.y += release * 0.045;
  }
  if (recover > 0) {
    rig.bow.position.lerp(rig.bowRestPosition, recover);
    rig.bow.rotation.x = THREE.MathUtils.lerp(rig.bow.rotation.x, rig.bowRestRotation.x, recover);
    rig.bow.rotation.y = THREE.MathUtils.lerp(rig.bow.rotation.y, rig.bowRestRotation.y, recover);
    rig.bow.rotation.z = THREE.MathUtils.lerp(rig.bow.rotation.z, rig.bowRestRotation.z, recover);
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
  const easeIntoAttack = attackActive ? 1 - THREE.MathUtils.smoothstep(attackProgress, 0, .28) : 1;
  const relaxed = resting * easeIntoAttack;
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
    if (!moving) {
      rig.torso.rotation.y += Math.sin(elapsed * 0.8) * 0.018;
    }
  }

  // Evaluate secondary motion from the completed anatomical pose.
  updateHair(rig, elapsed, moving);
  updateCloth(rig, elapsed, moving, attackActive, attackProgress, dt);
}
