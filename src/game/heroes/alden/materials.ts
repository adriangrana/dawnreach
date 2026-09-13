import * as THREE from 'three';
import type { DawnreachTextures } from '../../shared/textures';
import type { AldenMaterials } from './types';

export function createAldenMaterials(textures: DawnreachTextures): AldenMaterials {
  return {
    steel: new THREE.MeshStandardMaterial({ map: textures.steel, metalness: 0.72, roughness: 0.27 }),
    steelDark: new THREE.MeshStandardMaterial({ color: 0x46505a, metalness: 0.58, roughness: 0.4 }),
    gold: new THREE.MeshStandardMaterial({ map: textures.gold, metalness: 0.74, roughness: 0.23 }),
    blue: new THREE.MeshStandardMaterial({ map: textures.cloth, color: 0xffffff, roughness: 0.84 }),
    blueDark: new THREE.MeshStandardMaterial({ color: 0x15396e, roughness: 0.88 }),
    leather: new THREE.MeshStandardMaterial({ map: textures.leather, roughness: 0.92 }),
    chain: new THREE.MeshStandardMaterial({ map: textures.chain, metalness: 0.35, roughness: 0.62 }),
    visor: new THREE.MeshStandardMaterial({ color: 0x100e0b, metalness: 0.12, roughness: 0.34 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xd9b991, roughness: 0.82 }),
  };
}
