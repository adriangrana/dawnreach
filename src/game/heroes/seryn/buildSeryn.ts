import * as THREE from 'three';
import { buildHumanoidBody } from '../../characters/buildHumanoidBody';

export type SerynRig = ReturnType<typeof buildHumanoidBody> & {
  bow: THREE.Group;
  bowString: THREE.Line;
  quiver: THREE.Group;
};

function material(color: number, metalness: number, roughness: number, emissive = 0x000000) {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness, emissive, emissiveIntensity: emissive ? 0.22 : 0 });
}

function addMesh(parent: THREE.Object3D, geometry: THREE.BufferGeometry, mat: THREE.Material, name: string) {
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function curvedLimb(points: THREE.Vector3[], mat: THREE.Material) {
  return new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 18, 0.035, 7, false),
    mat,
  );
}

export function buildSeryn(): SerynRig {
  const rig = buildHumanoidBody({
    name: 'seryn',
    color: 0x173760,
    armRestAngle: 0.13,
  });

  const silver = material(0xb9c7d4, 0.78, 0.24);
  const midnight = material(0x10233f, 0.35, 0.54);
  const gold = material(0xcaa45e, 0.82, 0.22);
  const crystal = material(0x45cfff, 0.38, 0.16, 0x136b99);
  const leather = material(0x2b2526, 0.12, 0.78);

  // Distinct light-ranged silhouette: narrow shoulder guards and a bright chest prism.
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.47, 0.29, 0.02);
    shoulder.rotation.z = side * -0.18;
    rig.torso.add(shoulder);
    addMesh(shoulder, new THREE.BoxGeometry(0.34, 0.11, 0.38), silver, 'seryn-shoulder-plate');
    const fin = addMesh(shoulder, new THREE.ConeGeometry(0.09, 0.42, 4), gold, 'seryn-shoulder-fin');
    fin.rotation.z = side * -Math.PI / 2;
    fin.position.x = side * 0.20;
  }
  const chest = addMesh(rig.torso, new THREE.OctahedronGeometry(0.11, 0), crystal, 'seryn-chest-prism');
  chest.scale.set(0.72, 1.42, 0.45);
  chest.position.set(0, 0.12, 0.34);

  const hood = addMesh(rig.head, new THREE.SphereGeometry(0.255, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), midnight, 'seryn-hood');
  hood.position.y = 0.03;
  hood.scale.z = 1.05;

  const bow = new THREE.Group();
  bow.name = 'seryn-prism-bow';
  const upper = curvedLimb([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.12, 0.34, 0.02),
    new THREE.Vector3(0.25, 0.67, 0.06),
    new THREE.Vector3(0.19, 0.94, 0.09),
  ], gold);
  const lower = curvedLimb([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(-0.12, -0.34, 0.02),
    new THREE.Vector3(-0.25, -0.67, 0.06),
    new THREE.Vector3(-0.19, -0.94, 0.09),
  ], gold);
  bow.add(upper, lower);
  const upperCrystal = addMesh(bow, new THREE.OctahedronGeometry(0.085, 0), crystal, 'seryn-bow-upper-prism');
  upperCrystal.position.set(0.20, 0.72, 0.07);
  upperCrystal.scale.y = 1.65;
  const lowerCrystal = upperCrystal.clone();
  lowerCrystal.name = 'seryn-bow-lower-prism';
  lowerCrystal.position.set(-0.20, -0.72, 0.07);
  bow.add(lowerCrystal);

  const stringGeometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0.19, 0.94, 0.09),
    new THREE.Vector3(0, 0, -0.12),
    new THREE.Vector3(-0.19, -0.94, 0.09),
  ]);
  const bowString = new THREE.Line(stringGeometry, new THREE.LineBasicMaterial({ color: 0xb8f4ff, transparent: true, opacity: 0.9 }));
  bowString.name = 'seryn-bow-string';
  bow.add(bowString);
  bow.rotation.set(0, 0, Math.PI / 2);
  bow.position.set(0, -0.08, 0.05);
  rig.sockets.leftHand.add(bow);

  const quiver = new THREE.Group();
  quiver.name = 'seryn-quiver';
  const caseMesh = addMesh(quiver, new THREE.CylinderGeometry(0.12, 0.15, 0.92, 12), leather, 'seryn-quiver-case');
  caseMesh.rotation.z = 0.18;
  for (let index = 0; index < 5; index++) {
    const arrow = new THREE.Group();
    const shaft = addMesh(arrow, new THREE.CylinderGeometry(0.012, 0.012, 0.78, 6), silver, 'seryn-quiver-arrow');
    shaft.position.y = 0.34;
    const tip = addMesh(arrow, new THREE.ConeGeometry(0.038, 0.12, 5), crystal, 'seryn-quiver-arrow-tip');
    tip.position.y = 0.79;
    arrow.position.x = (index - 2) * 0.035;
    arrow.position.z = Math.abs(index - 2) * 0.016;
    quiver.add(arrow);
  }
  quiver.position.set(-0.24, 0.10, -0.08);
  quiver.rotation.set(0.12, 0, 0.35);
  rig.sockets.back.add(quiver);

  rig.root.userData.heroDefinitionId = 'H002';
  rig.root.userData.heroAttackStyle = 'ranged';
  return Object.assign(rig, { bow, bowString, quiver });
}
