import * as THREE from 'three';

export type AldenRig = {
  root: THREE.Group;
  model: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  cape: THREE.Group;
  sword: THREE.Group;
};

export type AldenMaterials = {
  steel: THREE.MeshStandardMaterial;
  steelDark: THREE.MeshStandardMaterial;
  gold: THREE.MeshStandardMaterial;
  blue: THREE.MeshStandardMaterial;
  blueDark: THREE.MeshStandardMaterial;
  leather: THREE.MeshStandardMaterial;
  chain: THREE.MeshStandardMaterial;
  visor: THREE.MeshStandardMaterial;
  skin: THREE.MeshStandardMaterial;
};
