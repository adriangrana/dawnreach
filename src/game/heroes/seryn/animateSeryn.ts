import * as THREE from 'three';
import { animateHumanoid, HUMANOID_DEFAULT_MOVE_SPEED } from '../../characters/animateHumanoid';
import type { SerynRig } from './buildSeryn';

export function animateSeryn(
  rig: SerynRig,
  elapsed: number,
  moving: boolean,
  delta = 1 / 60,
  speed = HUMANOID_DEFAULT_MOVE_SPEED,
) {
  animateHumanoid(rig, elapsed, moving, delta, speed / rig.model.scale.x);
  const attackProgress = Number(rig.root.userData.serynAttackProgress ?? 0);
  const attackActive = attackProgress > 0 && attackProgress < 1;
  const idle = (Math.sin(elapsed * 1.7) + 1) * 0.5;

  // Secondary motion for the single connected hair shell. The crown remains fixed to
  // the skull while progressively more of the lower hair follows a delayed lateral /
  // backward sway. This keeps it animatable without reverting to detached hair tubes.
  const hairGeometry = rig.hair.geometry;
  const hairPosition = hairGeometry.getAttribute('position') as THREE.BufferAttribute;
  const hairFlex = hairGeometry.getAttribute('hairFlex') as THREE.BufferAttribute;
  const hairPhase = hairGeometry.getAttribute('hairPhase') as THREE.BufferAttribute;
  const basePositions = hairGeometry.userData.serynHairBasePositions as Float32Array | undefined;
  if (basePositions && hairFlex && hairPhase) {
    const walkStrength = moving ? 1 : 0.35;
    const swayX = Math.sin(elapsed * (moving ? 5.2 : 1.55)) * 0.010 * walkStrength;
    const swayZ = Math.cos(elapsed * (moving ? 4.7 : 1.35) + 0.7) * 0.007 * walkStrength;
    for (let index = 0; index < hairPosition.count; index++) {
      const flex = hairFlex.getX(index);
      const phase = hairPhase.getX(index);
      const baseIndex = index * 3;
      const localWave = Math.sin(elapsed * 2.0 + phase * 1.7) * 0.0025 * flex;
      hairPosition.setXYZ(
        index,
        basePositions[baseIndex] + swayX * flex + localWave,
        basePositions[baseIndex + 1] + Math.sin(elapsed * 1.35 + phase) * 0.0014 * flex,
        basePositions[baseIndex + 2] + swayZ * flex + localWave * 0.35,
      );
    }
    hairPosition.needsUpdate = true;
    const normalFrame = ((rig.root.userData.serynHairNormalFrame as number | undefined) ?? 0) + 1;
    rig.root.userData.serynHairNormalFrame = normalFrame;
    if (normalFrame % 4 === 0) hairGeometry.computeVertexNormals();
  }

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
}
