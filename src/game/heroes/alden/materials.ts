import * as THREE from 'three';
import type { AldenMaterials } from './buildAlden.js';

type Palette = [string, string, string];
type Pigment = 'steel' | 'gold' | 'cloth' | 'leather';

const palettes: Record<Pigment, Palette> = {
  steel: ['#8993a6', '#c3c8d2', '#eef0ed'],
  gold: ['#a47a38', '#d6b363', '#f7dfa0'],
  cloth: ['#1c345f', '#2d508c', '#4b6da5'],
  leather: ['#3c2c24', '#6a4c36', '#99754e'],
};

export function createAldenMaterials(): AldenMaterials {
  const steel = paintedTexture('steel');
  const gold = paintedTexture('gold');
  const cloth = paintedTexture('cloth');
  const leather = paintedTexture('leather');
  const materials: AldenMaterials = {
    steel: new THREE.MeshStandardMaterial({ map: steel, metalness: 0.58, roughness: 0.47 }),
    steelDark: new THREE.MeshStandardMaterial({ map: steel, color: 0x8791a1, metalness: 0.42, roughness: 0.58 }),
    gold: new THREE.MeshStandardMaterial({ map: gold, metalness: 0.60, roughness: 0.44 }),
    blue: new THREE.MeshStandardMaterial({ map: cloth, roughness: 0.96 }),
    blueDark: new THREE.MeshStandardMaterial({ map: cloth, color: 0xa6b5d4, roughness: 0.98 }),
    leather: new THREE.MeshStandardMaterial({ map: leather, roughness: 0.94 }),
    chain: new THREE.MeshStandardMaterial({ map: chainTexture(), metalness: 0.24, roughness: 0.82 }),
    visor: new THREE.MeshStandardMaterial({ color: 0x10151d, metalness: 0.08, roughness: 0.76 }),
  };
  for (const [name, material] of Object.entries(materials)) {
    material.name = `alden-${name}`;
    material.side = THREE.DoubleSide;
    material.vertexColors = name !== 'visor' && name !== 'chain';
  }
  return materials;
}

function paintedTexture(pigment: Pigment) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable');
  const pixels = context.createImageData(size, size);
  const palette = palettes[pigment].map(hex => [
    parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16),
  ]);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const across = column / size;
      const down = row / size;
      const wash = Math.sin(across * Math.PI * 2 + Math.sin(down * Math.PI * 2) * 0.65);
      const cloud = Math.cos((across * 2 - down) * Math.PI * 2) * 0.035;
      const brush = Math.sin((across * 5 + down * 3) * Math.PI * 2) * Math.cos(down * Math.PI * 8) * 0.012;
      const grain = (Math.sin(column * 12.9898 + row * 78.233) * 43758.5453) % 1 * 0.004;
      const cloth = pigment === 'cloth';
      const value = THREE.MathUtils.clamp(0.53 + wash * (cloth ? 0.055 : 0.13) + cloud + brush + grain, 0, 1);
      const lower = value < 0.5 ? palette[0] : palette[1];
      const upper = value < 0.5 ? palette[1] : palette[2];
      const blend = value < 0.5 ? value * 2 : (value - 0.5) * 2;
      const offset = (row * size + column) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        pixels.data[offset + channel] = Math.round(THREE.MathUtils.lerp(lower[channel], upper[channel], blend));
      }
      pixels.data[offset + 3] = 255;
    }
  }
  context.putImageData(pixels, 0, 0);
  return textureFromCanvas(canvas, `alden-painted-${pigment}`);
}

function chainTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context unavailable');
  context.fillStyle = '#303640';
  context.fillRect(0, 0, 128, 128);
  context.lineWidth = 1;
  for (let row = -1; row < 17; row += 1) {
    for (let column = -1; column < 17; column += 1) {
      const horizontal = column * 8 + (row % 2) * 4;
      const vertical = row * 8;
      context.strokeStyle = '#20252d';
      context.beginPath();
      context.ellipse(horizontal, vertical + 1, 3, 2.5, -0.35, 0, Math.PI * 2);
      context.stroke();
      context.strokeStyle = '#4f5661';
      context.beginPath();
      context.ellipse(horizontal, vertical, 3, 2.5, -0.35, Math.PI, Math.PI * 2);
      context.stroke();
    }
  }
  const texture = textureFromCanvas(canvas, 'alden-painted-mail');
  texture.repeat.set(2, 2);
  return texture;
}

function textureFromCanvas(canvas: HTMLCanvasElement, name: string) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.name = name;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  return texture;
}

export function applyPaintedFinish(model: THREE.Group) {
  model.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.MeshStandardMaterial) || !object.material.vertexColors) return;
    const geometry = object.geometry as THREE.BufferGeometry;
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox!;
    const height = Math.max(0.001, bounds.max.y - bounds.min.y);
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const colors = new Float32Array(position.count * 3);
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      const vertical = (position.getY(vertex) - bounds.min.y) / height;
      const heightWash = THREE.MathUtils.smoothstep(vertical, 0.02, 0.85);
      const upward = Math.max(0, normal.getY(vertex));
      const value = 0.83 + heightWash * 0.13 + upward * 0.04;
      colors[vertex * 3] = value;
      colors[vertex * 3 + 1] = value;
      colors[vertex * 3 + 2] = Math.min(1, value + (1 - heightWash) * 0.035);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  });
}