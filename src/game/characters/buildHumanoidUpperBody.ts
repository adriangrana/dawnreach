import * as THREE from 'three';
import type { HumanoidRig } from './humanoidRig.js';

export function buildHumanoidUpperBody(
  rig: HumanoidRig,
  regions: { torso: THREE.Group; leftArm: THREE.Group; rightArm: THREE.Group },
  material: THREE.Material,
) {
  const segments = 32;
  const sections = [
    { y: -0.40, width: 0.24, depth: 0.158 },
    { y: -0.30, width: 0.255, depth: 0.17 },
    { y: -0.18, width: 0.29, depth: 0.191 },
    { y: 0, width: 0.355, depth: 0.237 },
    { y: 0.12, width: 0.38, depth: 0.251 },
    { y: 0.24, width: 0.40, depth: 0.257 },
    { y: 0.34, width: 0.37, depth: 0.224 },
    { y: 0.43, width: 0.27, depth: 0.17 },
    { y: 0.49, width: 0.115, depth: 0.105 },
  ];
  const positions: number[] = [];
  const skinIndices: number[] = [];
  const skinWeights: number[] = [];
  const indices: number[][] = [[], [], []];
  const vertex = (point: THREE.Vector3, bone = 0, weight = 0) => {
    const index = positions.length / 3;
    positions.push(point.x * rig.bodyScale, point.y * rig.bodyScale, point.z * rig.bodyScale);
    skinIndices.push(0, bone, 0, 0);
    skinWeights.push(1 - weight, weight, 0, 0);
    return index;
  };
  const ringIndex = (row: number, column: number) => row * segments + (column + segments) % segments;
  const joinRings = (previous: number[], next: number[], target: number[], reverse = false) => {
    for (let column = 0; column < previous.length; column += 1) {
      const following = (column + 1) % previous.length;
      const corners = [previous[column], next[column], previous[following], previous[following], next[column], next[following]];
      target.push(...(reverse ? corners.reverse() : corners));
    }
  };
  for (const section of sections) {
    for (let column = 0; column < segments; column += 1) {
      const angle = column / segments * Math.PI * 2;
      vertex(new THREE.Vector3(Math.cos(angle) * section.width, section.y, Math.sin(angle) * section.depth));
    }
  }
  for (let row = 0; row < sections.length - 1; row += 1) {
    for (let column = 0; column < segments; column += 1) {
      const armOpening = row >= 3 && row < 7 && (column < 4 || column >= 28 || (column >= 12 && column < 20));
      if (armOpening) continue;
      indices[0].push(ringIndex(row, column), ringIndex(row + 1, column), ringIndex(row, column + 1),
        ringIndex(row, column + 1), ringIndex(row + 1, column), ringIndex(row + 1, column + 1));
    }
  }
  for (const row of [0, sections.length - 1]) {
    const center = vertex(new THREE.Vector3(0, sections[row].y, 0));
    for (let column = 0; column < segments; column += 1) {
      const edge = [ringIndex(row, column), ringIndex(row, column + 1)];
      indices[0].push(center, ...(row === 0 ? edge : edge.reverse()));
    }
  }

  rig.root.updateMatrixWorld(true);
  const torsoInverse = rig.torso.matrixWorld.clone().invert();
  for (const [regionIndex, side, shoulder] of [[1, -1, rig.leftArm], [2, 1, rig.rightArm]] as const) {
    const centerColumn = side < 0 ? 16 : 0;
    const boundary: number[] = [];
    const boundaryVertex = (row: number, offset: number) => ringIndex(row, centerColumn + offset * side);
    for (let column = 0; column < 4; column += 1) boundary.push(boundaryVertex(7, column));
    for (let row = 7; row > 3; row -= 1) boundary.push(boundaryVertex(row, 4));
    for (let column = 4; column > -4; column -= 1) boundary.push(boundaryVertex(3, column));
    for (let row = 3; row < 7; row += 1) boundary.push(boundaryVertex(row, -4));
    for (let column = -4; column < 0; column += 1) boundary.push(boundaryVertex(7, column));
    const shoulderToTorso = torsoInverse.clone().multiply(shoulder.matrixWorld);
    const armPoint = (angle: number, height: number, radius: number) => new THREE.Vector3(
      side * Math.cos(angle) * radius * rig.bodyScale,
      height * rig.bodyScale,
      Math.sin(angle) * radius * 0.95 * rig.bodyScale,
    ).applyMatrix4(shoulderToTorso).divideScalar(rig.bodyScale);
    const down = new THREE.Vector3(0, -1, 0).transformDirection(shoulderToTorso);
    let previous = boundary;
    for (let step = 1; step <= 8; step += 1) {
      const fraction = step / 8;
      const next = boundary.map((boundaryIndex, column) => {
        const start = new THREE.Vector3().fromArray(positions, boundaryIndex * 3).divideScalar(rig.bodyScale);
        const angle = column / boundary.length * Math.PI * 2;
        const end = armPoint(angle, -0.18, 0.113);
        const firstControl = start.clone().add(new THREE.Vector3(side * 0.17, 0, 0));
        const secondControl = end.clone().addScaledVector(down, -0.13);
        const point = new THREE.CubicBezierCurve3(start, firstControl, secondControl, end).getPoint(fraction);
        return vertex(point, regionIndex, THREE.MathUtils.smoothstep(fraction, 0, 1));
      });
      joinRings(previous, next, indices[regionIndex], side > 0);
      previous = next;
    }
    for (const [height, radius] of [[-0.25, 0.10], [-0.35, 0.083], [-0.435, 0.071]]) {
      const next = boundary.map((_, column) => vertex(armPoint(column / boundary.length * Math.PI * 2, height, radius), regionIndex, 1));
      joinRings(previous, next, indices[regionIndex], side > 0);
      previous = next;
    }
    const center = vertex(armPoint(0, -0.435, 0), regionIndex, 1);
    for (let column = 0; column < previous.length; column += 1) {
      const edge = [previous[column], previous[(column + 1) % previous.length]];
      indices[regionIndex].push(center, ...(side < 0 ? edge.reverse() : edge));
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));
  geometry.setIndex(indices.flat());
  geometry.computeVertexNormals();
  const bones = [rig.torso, rig.leftArm, rig.rightArm].map((parent, index) => {
    const bone = new THREE.Bone();
    bone.name = `upper-body-bone-${index}`;
    parent.add(bone);
    return bone;
  });
  rig.root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  const meshes = [regions.torso, regions.leftArm, regions.rightArm].map((parent, index) => {
    const surface = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(geometry.attributes)) surface.setAttribute(name, attribute);
    surface.setIndex(indices[index]);
    const part = new THREE.SkinnedMesh(surface, material);
    part.name = ['thoracic-shell', 'left-shoulder-surface', 'right-shoulder-surface'][index];
    const local = parent.matrixWorld.clone().invert().multiply(rig.torso.matrixWorld);
    local.decompose(part.position, part.quaternion, part.scale);
    parent.add(part);
    part.bind(skeleton, rig.torso.matrixWorld.clone());
    part.castShadow = true;
    part.receiveShadow = true;
    part.frustumCulled = false;
    return part;
  });
  geometry.dispose();
  return meshes;
}