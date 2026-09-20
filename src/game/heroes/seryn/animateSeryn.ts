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
