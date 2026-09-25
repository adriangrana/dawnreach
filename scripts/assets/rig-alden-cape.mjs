import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { loadSkinnedGlb } from './load-skinned-glb.mjs';

// Surgical, reproducible skin-only patch. Positions, normals, UVs, indices,
// textures, materials, existing inverse binds and socket nodes stay byte-identical.
const path = process.argv[2] ?? 'src/game/heroes/alden/model/alden_rigged_socket.glb';
const output = process.argv[3] ?? path;
const source = readFileSync(path);
const sourceHash = createHash('sha256').update(source).digest('hex');
if (sourceHash !== 'bf1b121f0e30ae9ab13a74d469890aaa079f44a2553aad8c35d5fce77d628d62') {
  throw new Error('Expected the audited original Alden GLB; do not apply the cape patch twice.');
}
const jsonLength = source.readUInt32LE(12);
const json = JSON.parse(source.subarray(20, 20 + jsonLength));
const binary = source.subarray(28 + jsonLength, 28 + jsonLength + json.buffers[0].byteLength);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const original = { byteLength: binary.length, binaryHash: hash(binary),
  skin: structuredClone(json.skins[0]), mesh: structuredClone(json.meshes[0]), nodes: json.nodes.length,
  metadataHash: hash(JSON.stringify({ materials: json.materials, textures: json.textures, images: json.images,
    samplers: json.samplers, nodes: json.nodes, meshes: json.meshes, skins: json.skins })) };
const { scene } = await loadSkinnedGlb(path);
let mesh;
scene.traverse(o => { if (o.isSkinnedMesh) mesh = o; });
const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
const skin = json.skins[0], primitive = json.meshes[0].primitives[0];
const spineIndex = json.nodes.findIndex(n => n.name === 'DEF-spine.003');
const spine = mesh.skeleton.bones.find(b => b.userData.name === 'DEF-spine.003');
const inverseSpine = spine.matrixWorld.clone().invert();
const parts = [binary];
let byteLength = binary.length;
const append = (buffer, componentType, count, type) => {
  const padding = (4 - byteLength % 4) % 4;
  if (padding) { parts.push(Buffer.alloc(padding)); byteLength += padding; }
  const bufferView = json.bufferViews.length;
  json.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: buffer.length });
  parts.push(buffer); byteLength += buffer.length;
  const accessor = json.accessors.length;
  json.accessors.push({ bufferView, componentType, count, type });
  return accessor;
};
const names = [], inverseBinds = [];
const firstJoint = skin.joints.length;
for (let column = 0; column < 3; column++) {
  let parent = spineIndex, previousPosition;
  for (let row = 0; row < 5; row++) {
    const point = new Vector3(-0.433 + (column - 1) * (0.24 + row * 0.10), 0.72 - row * 0.30, -0.045 - row * 0.11);
    const world = new Matrix4().makeTranslation(...point.toArray());
    const local = row === 0 ? inverseSpine.clone().multiply(world) : new Matrix4().makeTranslation(...point.clone().sub(previousPosition).toArray());
    const translation = new Vector3(), rotation = new Quaternion(), scale = new Vector3();
    local.decompose(translation, rotation, scale);
    const name = `CAPE-${['R', 'C', 'L'][column]}.${row}`;
    const index = json.nodes.length;
    json.nodes.push({ name, translation: translation.toArray(), rotation: rotation.toArray(), scale: scale.toArray() });
    (json.nodes[parent].children ??= []).push(index);
    skin.joints.push(index);
    names.push(name);
    inverseBinds.push(...world.invert().elements);
    parent = index;
    previousPosition = point;
  }
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const joints = Buffer.alloc(position.count * 8), weights = Buffer.alloc(position.count * 16);
// GLTFLoader normalizes even untouched weights. Read the source bytes for the
// pinned/non-cloth region so the patch does not silently rewrite body weights.
const originalComponent = (name, vertex, component) => {
  const a = json.accessors[primitive.attributes[name]], v = json.bufferViews[a.bufferView];
  const size = a.componentType === 5121 ? 1 : a.componentType === 5123 ? 2 : 4;
  const offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0) + vertex * (v.byteStride ?? 4 * size) + component * size;
  return size === 1 ? binary.readUInt8(offset) : size === 2 ? binary.readUInt16LE(offset) : binary.readFloatLE(offset);
};
let changedVertices = 0;
for (let vertex = 0; vertex < position.count; vertex++) {
  const x = position.getX(vertex), y = position.getY(vertex), z = position.getZ(vertex);
  // Rear cloth below the gold shoulder attachments. The body/leg surfaces have
  // z >= -0.002 here; the seam band fades to the existing attachment weights.
  const cape = (1 - smooth(0.55, 0.78, y)) * (1 - smooth(-0.055, -0.01, z));
  let influences = [];
  if (cape > 0) {
    const v = Math.max(0, Math.min(4, (0.72 - y) / 0.30));
    const u = Math.max(0, Math.min(2, (x + 0.433) / (0.24 + v * 0.10) + 1));
    const row = Math.min(3, Math.floor(v)), column = Math.min(1, Math.floor(u));
    for (let c = 0; c < 2; c++) for (let r = 0; r < 2; r++) {
      influences.push([firstJoint + (column + c) * 5 + row + r,
        cape * (c ? u - column : 1 - u + column) * (r ? v - row : 1 - v + row)]);
    }
  }
  for (let k = 0; k < 4; k++) influences.push([skinIndex.getComponent(vertex, k), skinWeight.getComponent(vertex, k) * (1 - cape)]);
  if (cape > 0) {
    influences.sort((a, b) => b[1] - a[1]);
    influences = influences.slice(0, 4);
    const sum = influences.reduce((sum, [, weight]) => sum + weight, 0);
    influences = influences.map(([joint, weight]) => [joint, weight / sum]);
  }
  for (let k = 0; k < 4; k++) {
    joints.writeUInt16LE(cape > 0 ? influences[k][0] : originalComponent('JOINTS_0', vertex, k), vertex * 8 + k * 2);
    weights.writeFloatLE(cape > 0 ? influences[k][1] : originalComponent('WEIGHTS_0', vertex, k), vertex * 16 + k * 4);
  }
  if ([0, 1, 2, 3].some(k => joints.readUInt16LE(vertex * 8 + k * 2) !== originalComponent('JOINTS_0', vertex, k)
    || weights.readFloatLE(vertex * 16 + k * 4) !== originalComponent('WEIGHTS_0', vertex, k))) changedVertices++;
}
primitive.attributes.JOINTS_0 = append(joints, 5123, position.count, 'VEC4');
primitive.attributes.WEIGHTS_0 = append(weights, 5126, position.count, 'VEC4');
const oldAccessor = json.accessors[skin.inverseBindMatrices], oldView = json.bufferViews[oldAccessor.bufferView];
const oldStart = (oldView.byteOffset ?? 0) + (oldAccessor.byteOffset ?? 0);
const newBinds = Buffer.alloc(inverseBinds.length * 4);
inverseBinds.forEach((value, i) => newBinds.writeFloatLE(value, i * 4));
skin.inverseBindMatrices = append(Buffer.concat([binary.subarray(oldStart, oldStart + oldAccessor.count * 64), newBinds]), 5126, skin.joints.length, 'MAT4');
json.buffers[0].byteLength = byteLength;
json.extras = { ...json.extras, dawnreachCapeRig: { version: 1, sourceHash, changedVertices, joints: names, original } };
const jsonBytes = Buffer.from(JSON.stringify(json));
const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc((4 - jsonBytes.length % 4) % 4, 0x20)]);
const binChunk = Buffer.concat([...parts, Buffer.alloc((4 - byteLength % 4) % 4)]);
const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + jsonChunk.length + binChunk.length, 8);
header.writeUInt32LE(jsonChunk.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
binHeader.writeUInt32LE(binChunk.length, 0); binHeader.writeUInt32LE(0x004e4942, 4);
writeFileSync(output, Buffer.concat([header, jsonChunk, binHeader, binChunk]));
console.log(JSON.stringify({ output, sourceHash, changedVertices, addedJoints: names }));
