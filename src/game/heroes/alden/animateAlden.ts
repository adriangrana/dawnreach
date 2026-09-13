import type { AldenRig } from './types';

export function animateAlden(rig: AldenRig, elapsed: number, moving: boolean) {
  if (moving) {
    const stride = Math.sin(elapsed * 10.5);
    const counter = Math.sin(elapsed * 10.5 + Math.PI);
    const bob = Math.abs(Math.sin(elapsed * 10.5)) * 0.05;

    rig.leftLeg.rotation.x = stride * 0.46;
    rig.rightLeg.rotation.x = counter * 0.46;
    rig.leftArm.rotation.x = counter * 0.20;
    rig.rightArm.rotation.x = stride * 0.12 - 0.08;

    rig.model.position.y = bob;
    rig.model.rotation.z = stride * 0.012;

    rig.cape.rotation.x = 0.12 + Math.abs(stride) * 0.08;
    rig.cape.rotation.z = stride * 0.018;
    rig.cape.position.z = -0.31 - Math.abs(stride) * 0.02;

    rig.sword.rotation.z = -0.58 + stride * 0.04;
    rig.sword.rotation.x = 0.04 + Math.abs(stride) * 0.02;
  } else {
    const breathe = Math.sin(elapsed * 2.25);

    rig.leftLeg.rotation.x *= 0.80;
    rig.rightLeg.rotation.x *= 0.80;
    rig.leftArm.rotation.x *= 0.82;
    rig.rightArm.rotation.x += (-0.08 - rig.rightArm.rotation.x) * 0.16;

    rig.model.position.y = breathe * 0.012;
    rig.model.rotation.z *= 0.84;

    rig.cape.rotation.x = 0.10 + Math.sin(elapsed * 1.6) * 0.016;
    rig.cape.rotation.z = Math.sin(elapsed * 1.2) * 0.008;
    rig.cape.position.z += (-0.31 - rig.cape.position.z) * 0.12;

    rig.sword.rotation.z += (-0.58 - rig.sword.rotation.z) * 0.16;
    rig.sword.rotation.x += (0.04 - rig.sword.rotation.x) * 0.16;
  }
}
