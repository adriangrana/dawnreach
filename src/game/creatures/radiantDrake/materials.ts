import * as THREE from 'three';
import { makeCanvasTexture } from '../../shared/textures';

function random(seed: number) { return (Math.sin(seed * 127.1 + 311.7) * 43758.5453) % 1 * 0.5 + 0.5; }

export function createDrakeMaterials() {
  const scales = (height: boolean) => makeCanvasTexture(1024, (ctx, size) => {
    ctx.fillStyle = height ? '#404040' : '#384e52'; ctx.fillRect(0, 0, size, size);
    const w = 64, h = 40;
    for (let row = -1; row <= size / h; row++) for (let col = -1; col <= size / w; col++) {
      const x = col * w + (row % 2) * w / 2, y = row * h;
      const shine = ctx.createLinearGradient(x, y, x + w, y + h);
      const shade = Math.round(random(row * 83 + col) * 18);
      shine.addColorStop(0, height ? '#dadada' : `rgb(${151 + shade},${171 + shade},${164 + shade})`);
      shine.addColorStop(0.6, height ? '#969696' : '#7c9999');
      shine.addColorStop(1, height ? '#555555' : '#496366');
      ctx.beginPath();ctx.moveTo(x + w / 2, y + h * 1.2);
      ctx.quadraticCurveTo(x, y + h * 0.8, x + 2, y + 3);
      ctx.quadraticCurveTo(x + w / 2, y - h * 0.15, x + w - 2, y + 3);
      ctx.quadraticCurveTo(x + w, y + h * 0.8, x + w / 2, y + h * 1.2);
      ctx.fillStyle = shine;ctx.fill();
      ctx.strokeStyle = height ? '#303030' : 'rgba(32,49,49,0.8)';ctx.lineWidth = 2;ctx.stroke();
      ctx.beginPath();ctx.moveTo(x + w / 2, y + 7);ctx.lineTo(x + w / 2, y + h * 0.8);
      ctx.strokeStyle = height ? '#eeeeee' : 'rgba(225,227,184,0.24)';ctx.lineWidth = 1;ctx.stroke();
    }
  }, 2, 4);
  const skinMap = scales(false), bumpMap = scales(true); bumpMap.colorSpace = THREE.NoColorSpace;
  const skin = new THREE.MeshPhysicalMaterial({ map: skinMap, bumpMap, bumpScale: 0.035,
    vertexColors: true, roughness: 0.47, metalness: 0.24, clearcoat: 0.18 });
  const silver = new THREE.MeshStandardMaterial({ color: 0xbed0c5, roughness: 0.36, metalness: 0.4 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xc1a66a, roughness: 0.4, metalness: 0.48 });
  const hornMap = makeCanvasTexture(512, (ctx, size) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, size);
    gradient.addColorStop(0, '#efe4bf'); gradient.addColorStop(0.68, '#bbab7b'); gradient.addColorStop(1, '#635337');
    ctx.fillStyle = gradient;ctx.fillRect(0, 0, size, size);
    for (let y = 0; y < size; y += 7) {
      ctx.fillStyle = `rgba(65,53,31,${0.03 + random(y) * 0.07})`;ctx.fillRect(0, y, size, 1);
    }
  });
  const horn = new THREE.MeshStandardMaterial({ map: hornMap, roughness: 0.4, metalness: 0.13 });
  const wingMap = makeCanvasTexture(1024, (ctx, size) => {
    const gradient = ctx.createLinearGradient(0, 0, size * 0.2, size);
    gradient.addColorStop(0, '#33494f');gradient.addColorStop(0.5, '#668078');gradient.addColorStop(1, '#a7b29a');
    ctx.fillStyle = gradient;ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 65; i++) {
      const end = i / 64 * size;
      ctx.beginPath();ctx.moveTo(size / 2, 0);
      ctx.bezierCurveTo(size / 2 + (end - size / 2) * 0.4, size * 0.35, end - 12, size * 0.72, end, size);
      ctx.strokeStyle = i % 7 ? 'rgba(28,48,46,0.10)' : 'rgba(211,201,150,0.25)';
      ctx.lineWidth = i % 7 ? 1 : 3;ctx.stroke();
    }
    for (let i = 0; i < 4000; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(242,221,170,0.03)' : 'rgba(12,35,39,0.06)';
      ctx.fillRect(random(i) * size, random(i + 187) * size, 2, 5);
    }
  });
  const membrane = new THREE.MeshPhysicalMaterial({ map: wingMap, vertexColors: true,
    side: THREE.DoubleSide, roughness: 0.62, metalness: 0.04, sheen: 0.3, sheenColor: new THREE.Color(0xabc7b8) });
  const mouth = new THREE.MeshStandardMaterial({ color: 0x302b29, roughness: 0.8 });
  const eye = new THREE.MeshStandardMaterial({ color: 0xffc66a, emissive: 0xf3a025, emissiveIntensity: 1.35, roughness: 0.14 });
  const pupil = new THREE.MeshStandardMaterial({ color: 0x080f0e, roughness: 0.2 });
  return { skin, silver, gold, horn, membrane, mouth, eye, pupil };
}
