import * as THREE from 'three';

/** Position IK through a deform chain, including fixed subdivision joints.
 * The authored knee plane is preserved. Foot pitch is an optional model-space
 * rotation over the rest orientation. Restore the pose before each solve.
 */
export function createTwoBoneLeg(
  space: THREE.Object3D,
  hip: THREE.Object3D,
  knee: THREE.Object3D,
  ankle: THREE.Object3D,
) {
  space.updateWorldMatrix(true, true);
  const inverseSpace = space.matrixWorld.clone().invert();
  const position = (bone: THREE.Object3D) => bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseSpace);
  const restHip = position(hip), restKnee = position(knee), restAnkle = position(ankle);
  const restDirection = restAnkle.clone().sub(restHip).normalize();
  const pole = restKnee.clone().sub(restHip);
  pole.addScaledVector(restDirection, -pole.dot(restDirection)).normalize();
  const restFootRotation = space.getWorldQuaternion(new THREE.Quaternion()).invert()
    .multiply(ankle.getWorldQuaternion(new THREE.Quaternion()));
  const hipPosition = new THREE.Vector3(), kneePosition = new THREE.Vector3(), anklePosition = new THREE.Vector3();
  const target = new THREE.Vector3(), direction = new THREE.Vector3(), bend = new THREE.Vector3(), desiredKnee = new THREE.Vector3();
  const from = new THREE.Vector3(), to = new THREE.Vector3();
  const delta = new THREE.Quaternion(), parentRotation = new THREE.Quaternion(), worldRotation = new THREE.Quaternion();
  const footRotation = new THREE.Quaternion(), lateralAxis = new THREE.Vector3(1, 0, 0);
  const aim = (bone: THREE.Object3D, origin: THREE.Vector3, end: THREE.Vector3, goal: THREE.Vector3) => {
    from.copy(end).sub(origin).normalize();
    to.copy(goal).sub(origin).normalize();
    delta.setFromUnitVectors(from, to);
    bone.getWorldQuaternion(worldRotation).premultiply(delta);
    bone.parent!.getWorldQuaternion(parentRotation).invert();
    bone.quaternion.copy(parentRotation).multiply(worldRotation).normalize();
    bone.updateWorldMatrix(false, true);
  };
  return {
    restHip,
    restAnkle,
    restLength: restHip.distanceTo(restKnee) + restKnee.distanceTo(restAnkle),
    reachAtFlexion(radians: number) {
      const upper = restHip.distanceTo(restKnee), lower = restKnee.distanceTo(restAnkle);
      return Math.sqrt(upper * upper + lower * lower + 2 * upper * lower * Math.cos(radians));
    },
    solve(targetInSpace: THREE.Vector3, footPitch = 0) {
      hip.getWorldPosition(hipPosition);
      knee.getWorldPosition(kneePosition);
      ankle.getWorldPosition(anklePosition);
      const upperLength = hipPosition.distanceTo(kneePosition);
      const lowerLength = kneePosition.distanceTo(anklePosition);
      target.copy(targetInSpace).applyMatrix4(space.matrixWorld);
      direction.copy(target).sub(hipPosition);
      const distance = THREE.MathUtils.clamp(direction.length(),
        Math.abs(upperLength - lowerLength) + 1e-6, (upperLength + lowerLength) * 0.9999);
      direction.normalize();
      target.copy(hipPosition).addScaledVector(direction, distance);
      bend.copy(pole).transformDirection(space.matrixWorld);
      bend.addScaledVector(direction, -bend.dot(direction)).normalize();
      const along = (upperLength * upperLength - lowerLength * lowerLength + distance * distance) / (2 * distance);
      const height = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
      desiredKnee.copy(hipPosition).addScaledVector(direction, along).addScaledVector(bend, height);
      aim(hip, hipPosition, kneePosition, desiredKnee);
      knee.getWorldPosition(kneePosition);
      ankle.getWorldPosition(anklePosition);
      aim(knee, kneePosition, anklePosition, target);
      footRotation.setFromAxisAngle(lateralAxis, footPitch).multiply(restFootRotation);
      space.getWorldQuaternion(worldRotation).multiply(footRotation);
      ankle.parent!.getWorldQuaternion(parentRotation).invert();
      ankle.quaternion.copy(parentRotation).multiply(worldRotation).normalize();
      ankle.updateWorldMatrix(false, true);
    },
  };
}
