import * as THREE from 'three';
import type { SerynRig } from './buildSeryn';

export const SERYN_ATTACK_RELEASE_PROGRESS = .64;
export const SERYN_ATTACK_SWING_RATE = 2.2;

// Contact points are on the curled fingers / palm, not at the wrist pivots.
export const SERYN_STRING_FINGERS = new THREE.Vector3(0, -.108, -.025);
const palm = new THREE.Vector3(0, -.060, -.018);
const grip = new THREE.Vector3(-.052, 0, 0);
const arrowRest = new THREE.Vector3(-.052, .075, .018);
const up = new THREE.Vector3(0, 1, 0);
const bowAim = new THREE.Quaternion().setFromAxisAngle(up, Math.PI / 2);

function modelPoint(rig: SerynRig, object: THREE.Object3D, local = new THREE.Vector3()) {
  object.updateWorldMatrix(true, false);
  return rig.model.worldToLocal(object.localToWorld(local.clone()));
}

function handAim(side: number) {
  // Fingers continue toward +Z, with the palm facing into the grip/string.
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, -side, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(side, 0, 0),
  ));
}

/** Two-bone solve in torso space. Lengths stay fixed and the pole controls the
 * anatomical elbow plane, avoiding independent Euler rotations and hyperflexion. */
function solveArm(rig: SerynRig, side: number, contact: THREE.Vector3, offset: THREE.Vector3,
  pole: THREE.Vector3, weight: number) {
  const arm = side > 0 ? rig.leftArm : rig.rightArm;
  const forearm = side > 0 ? rig.leftForearm : rig.rightForearm;
  const hand = side > 0 ? rig.sockets.leftHand : rig.sockets.rightHand;
  const handModelQ = handAim(side);
  const wrist = contact.clone().sub(offset.clone().applyQuaternion(handModelQ));
  const toTorso = (v: THREE.Vector3) => rig.torso.worldToLocal(rig.model.localToWorld(v.clone()));
  const target = toTorso(wrist), start = arm.position.clone();
  const direction = target.clone().sub(start);
  const upper = forearm.position.length(), lower = hand.position.length();
  const distance = THREE.MathUtils.clamp(direction.length(), Math.abs(upper - lower) + .01, upper + lower - .004);
  direction.normalize();
  const bend = toTorso(pole).sub(start);
  bend.addScaledVector(direction, -bend.dot(direction)).normalize();
  const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
  const elbow = start.clone().addScaledVector(direction, along)
    .addScaledVector(bend, Math.sqrt(Math.max(0, upper * upper - along * along)));
  const end = start.clone().addScaledVector(direction, distance);
  const upperDirection = elbow.clone().sub(start).normalize();
  const lowerDirection = end.clone().sub(elbow).normalize();
  const hinge = new THREE.Vector3().crossVectors(upperDirection, lowerDirection).normalize();
  const frame = (direction: THREE.Vector3) => {
    const y = direction.clone().negate(), z = new THREE.Vector3().crossVectors(hinge, y).normalize();
    return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(hinge, y, z));
  };
  const upperQ = frame(upperDirection), lowerQ = frame(lowerDirection);
  arm.quaternion.slerp(upperQ, weight);
  forearm.quaternion.slerp(upperQ.clone().invert().multiply(lowerQ), weight);
  rig.root.updateMatrixWorld(true);
  const worldHandQ = rig.model.getWorldQuaternion(new THREE.Quaternion()).multiply(handModelQ);
  const localHandQ = forearm.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(worldHandQ);
  hand.quaternion.slerp(localHandQ, weight);
}

function poseBow(rig: SerynRig, weight: number, tilt: number) {
  rig.root.updateMatrixWorld(true);
  const worldQ = rig.model.getWorldQuaternion(new THREE.Quaternion()).multiply(bowAim)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), tilt));
  const localQ = rig.sockets.leftHand.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(worldQ);
  rig.bow.quaternion.setFromEuler(rig.bowRestRotation).slerp(localQ, weight);
  // Compensate orientation about the actual grip: rotating the bow cannot make it
  // orbit the wrist or pull its handle out of the palm.
  const heldPosition = palm.clone().sub(grip.clone().applyQuaternion(rig.bow.quaternion));
  rig.bow.position.copy(rig.bowRestPosition).lerp(heldPosition, weight);
  rig.root.updateMatrixWorld(true);
}

export function updateArcheryAttackPose(rig: SerynRig, progress: number) {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  const active = p > 0 && p < 1;
  const smooth = THREE.MathUtils.smoothstep;
  const recover = smooth(p, .82, 1);
  const engage = smooth(p, 0, .12) * (1 - recover);
  const raise = smooth(p, .16, .46);
  const draw = smooth(p, .34, .57);
  const loose = smooth(p, SERYN_ATTACK_RELEASE_PROGRESS, .685);

  rig.bow.position.copy(rig.bowRestPosition);
  rig.bow.rotation.copy(rig.bowRestRotation);
  rig.handArrow.visible = false;
  rig.nockedArrow.visible = false;
  for (const arrow of rig.quiverArrows) arrow.visible = true;

  if (active) {
    // Open stance: the left shoulder faces the target, while the eyes continue to
    // look along model +Z. The body turns before the arm reaches full extension.
    rig.torso.rotation.y = -1.15 * raise * engage;
    rig.pelvis.rotation.y -= .55 * raise * engage;
    rig.head.rotation.y = -rig.torso.rotation.y;
    rig.root.updateMatrixWorld(true);

    const bowContact = new THREE.Vector3(.22, 1.83, .49).lerp(new THREE.Vector3(-.115, 2.37, 1.16), raise);
    solveArm(rig, 1, bowContact, palm, new THREE.Vector3(.48, 1.96, .56), engage);
    poseBow(rig, engage, -.055 * loose * (1 - recover));

    // The string rests behind the grip in bow-local +X. A quarter-turn around Y
    // maps this to model -Z; the old animation pulled perpendicular to this plane.
    const nockRest = rig.bowStringRestNock.clone();
    nockRest.y = arrowRest.y;
    const nockModel = modelPoint(rig, rig.bow, nockRest);
    const anchor = new THREE.Vector3(-.097, 2.445, .22);
    const stringContact = nockModel.clone().lerp(anchor, draw);
    const transfer = smooth(p, .13, .34);
    const quiverPoint = modelPoint(rig, rig.quiverArrows[rig.quiverArrows.length - 1], new THREE.Vector3(0, .75, 0));
    const rightContact = quiverPoint.lerp(stringContact, transfer);
    rightContact.z -= .07 * loose;
    rightContact.x -= .035 * loose;
    solveArm(rig, -1, rightContact, SERYN_STRING_FINGERS,
      new THREE.Vector3(-.68, 2.48, -.38), engage);

    rig.handArrow.visible = p >= .12 && p < .34;
    rig.root.updateMatrixWorld(true);
    const carryAxis = up.clone().applyQuaternion(rig.quiver.getWorldQuaternion(new THREE.Quaternion()));
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(rig.model.getWorldQuaternion(new THREE.Quaternion()));
    carryAxis.lerp(forward, transfer).normalize()
      .applyQuaternion(rig.sockets.rightHand.getWorldQuaternion(new THREE.Quaternion()).invert());
    rig.handArrow.quaternion.setFromUnitVectors(up, carryAxis);
    rig.handArrow.position.copy(SERYN_STRING_FINGERS).addScaledVector(carryAxis, -.72 * (1 - transfer));
    rig.quiverArrows[rig.quiverArrows.length - 1].visible = p < .12 || p > .94;
    rig.nockedArrow.visible = p >= .34 && p < SERYN_ATTACK_RELEASE_PROGRESS;
  }

  rig.root.updateMatrixWorld(true);
  const string = rig.bowString.geometry.getAttribute('position') as THREE.BufferAttribute;
  const nock = rig.bowStringRestNock.clone();
  if (active) nock.y = arrowRest.y * smooth(p, .16, .34) * (1 - recover);
  if (active && p >= .34 && p < SERYN_ATTACK_RELEASE_PROGRESS) {
    // Exact finger contact, without clamping axes or blending the draw a second time.
    const world = rig.sockets.rightHand.localToWorld(SERYN_STRING_FINGERS.clone());
    nock.copy(rig.bow.worldToLocal(world));
  } else if (active && p >= SERYN_ATTACK_RELEASE_PROGRESS) {
    const releaseTime = p - SERYN_ATTACK_RELEASE_PROGRESS;
    nock.y = arrowRest.y * (1 - recover);
    nock.x += Math.sin(releaseTime * 150) * Math.exp(-releaseTime * 24) * .016;
  }
  for (const [i, point] of [rig.bowStringUpperAnchor, nock, rig.bowStringLowerAnchor].entries()) {
    string.setXYZ(i, point.x, point.y, point.z);
  }
  string.needsUpdate = true;
  rig.nockedArrow.position.copy(nock);
  rig.nockedArrow.quaternion.setFromUnitVectors(up, arrowRest.clone().sub(nock).normalize());
  // Release starts on the string plane, following the same physical line as the
  // nocked arrow; gameplay may then steer the projectile toward its chosen target.
  rig.arrowLaunchSocket.position.copy(rig.bowStringRestNock);
  rig.arrowLaunchSocket.position.y = arrowRest.y;
}
