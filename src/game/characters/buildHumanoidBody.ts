import * as THREE from 'three';
import { createHumanoidRig } from './humanoidRig.js';
import { buildHumanoidUpperBody } from './buildHumanoidUpperBody.js';

export function buildHumanoidBody({ name = 'humanoid', bodyScale = 1, color = 0x428b83, armRestAngle = 0.18 } = {}) {
  const rig = createHumanoidRig({ name, bodyScale, armRestAngle });
  const shell = new THREE.MeshStandardMaterial({ name: 'body-shell', color, roughness: 0.72, metalness: 0.12 });
  const joint = new THREE.MeshStandardMaterial({ name: 'body-joints', color: 0x303b3b, roughness: 0.94 });
  const porcelain = new THREE.MeshStandardMaterial({ name: 'body-porcelain', color: 0xdde6df, roughness: 0.65, metalness: 0.08 });
  const accent = new THREE.MeshStandardMaterial({ name: 'body-accent', color: 0xd6a34b, roughness: 0.62, metalness: 0.2 });
  const region = (parent: THREE.Group, regionName: string) => {
    const part = new THREE.Group();
    part.name = `body-${regionName}`;
    parent.add(part);
    return part;
  };
  const bodyParts = {
    pelvis: region(rig.pelvis, 'pelvis'), torso: region(rig.torso, 'torso'), head: region(rig.head, 'head'),
    leftLeg: region(rig.leftLeg, 'left-thigh'), rightLeg: region(rig.rightLeg, 'right-thigh'),
    leftShin: region(rig.leftShin, 'left-shin'), rightShin: region(rig.rightShin, 'right-shin'),
    leftFoot: region(rig.leftFoot, 'left-foot'), rightFoot: region(rig.rightFoot, 'right-foot'),
    leftArm: region(rig.leftArm, 'left-arm'), rightArm: region(rig.rightArm, 'right-arm'),
    leftForearm: region(rig.leftForearm, 'left-forearm'), rightForearm: region(rig.rightForearm, 'right-forearm'),
    leftHand: region(rig.sockets.leftHand, 'left-hand'), rightHand: region(rig.sockets.rightHand, 'right-hand'),
  };
  const mesh = (parent: THREE.Group, meshName: string, geometry: THREE.BufferGeometry, material: THREE.Material) => {
    geometry.scale(bodyScale, bodyScale, bodyScale);
    const part = new THREE.Mesh(geometry, material);
    part.name = meshName;
    part.castShadow = true;
    part.receiveShadow = true;
    parent.add(part);
    return part;
  };
  const contour = (parent: THREE.Group, meshName: string, sections: Array<[number, number]>, depth: number, material: THREE.Material) => {
    const geometry = new THREE.LatheGeometry(sections.map(([radius, height]) => new THREE.Vector2(radius, height)), 16);
    geometry.scale(1, 1, depth);
    return mesh(parent, meshName, geometry, material);
  };
  const rounded = (parent: THREE.Group, meshName: string, size: [number, number, number], position: [number, number, number], material: THREE.Material) => {
    const geometry = new THREE.SphereGeometry(1, 16, 10);
    geometry.scale(...size);
    geometry.translate(...position);
    return mesh(parent, meshName, geometry, material);
  };

  contour(bodyParts.pelvis, 'pelvic-shell', [[0, -0.18], [0.20, -0.17], [0.30, 0.02], [0.26, 0.23], [0, 0.24]], 0.72, shell);
  contour(bodyParts.torso, 'waist-joint', [[0, -0.53], [0.23, -0.53], [0.25, -0.30], [0, -0.30]], 0.78, joint);
  buildHumanoidUpperBody(rig, bodyParts, shell);
  contour(bodyParts.torso, 'neck-joint', [[0, 0.45], [0.105, 0.45], [0.11, 0.73], [0, 0.73]], 0.9, joint);
  rounded(bodyParts.torso, 'chest-inlay', [0.055, 0.18, 0.012], [0, 0.11, 0.255], accent);
  rounded(bodyParts.head, 'head-shell', [0.215, 0.275, 0.22], [0, 0.005, 0], porcelain);
  rounded(bodyParts.head, 'face-inlay', [0.15, 0.025, 0.028], [0, 0.06, 0.20], joint);

  const soles = [];
  for (const side of ['left', 'right'] as const) {
    const thigh = bodyParts[`${side}Leg`];
    const shin = bodyParts[`${side}Shin`];
    const foot = bodyParts[`${side}Foot`];
    const forearm = bodyParts[`${side}Forearm`];
    rounded(thigh, 'hip-joint', [0.115, 0.115, 0.115], [0, 0, 0], joint);
    contour(thigh, 'thigh-shell', [[0, -0.52], [0.085, -0.50], [0.13, -0.30], [0.145, -0.09], [0.10, -0.015], [0, 0]], 0.90, shell);
    rounded(shin, 'knee-joint', [0.09, 0.095, 0.09], [0, 0, 0], joint);
    contour(shin, 'calf-shell', [[0, -0.47], [0.067, -0.45], [0.095, -0.27], [0.112, -0.14], [0.086, -0.04], [0, -0.035]], 0.95, porcelain);
    rounded(foot, 'ankle-joint', [0.075, 0.075, 0.075], [0, 0, 0], joint);
    rounded(foot, 'foot-shell', [0.12, 0.08, 0.24], [0, -0.025, 0.065], shell);
    const soleGeometry = new THREE.CylinderGeometry(1, 1, 0.06, 12);
    soleGeometry.scale(0.12, 1, 0.24);
    soleGeometry.translate(0, -0.105, 0.065);
    const sole = mesh(foot, 'body-sole', soleGeometry, joint);
    const position = sole.geometry.getAttribute('position');
    soles.push({ foot: rig[`${side}Foot`], points: Array.from({ length: position.count }, (_, vertex) => new THREE.Vector3().fromBufferAttribute(position, vertex)) });

    rounded(forearm, 'elbow-joint', [0.08, 0.085, 0.08], [0, 0, 0], joint);
    contour(forearm, 'forearm-shell', [[0, -0.435], [0.057, -0.42], [0.075, -0.25], [0.10, -0.09], [0.077, -0.04], [0, -0.035]], 0.9, porcelain);
    rounded(bodyParts[`${side}Hand`], 'hand-shell', [0.068, 0.11, 0.072], [0, -0.025, 0], joint);
  }
  rig.soleSamples = soles;
  return { ...rig, bodyParts };
}