import { readFile } from 'node:fs/promises';
import { Texture } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Offline geometry/skin inspection with the actual runtime loader. Images are
// deliberately not decoded; the source asset and its materials are never written.
export async function loadSkinnedGlb(path) {
  const bytes = await readFile(path);
  const loader = new GLTFLoader().register(() => ({
    name: 'offline-skin-inspection',
    loadTexture: () => Promise.resolve(new Texture()),
  }));
  const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  gltf.scene.updateMatrixWorld(true);
  return gltf;
}
