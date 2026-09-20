import * as THREE from 'three';
import { makeCanvasTexture } from '../../shared/textures';

function seeded(seed = 0x51e7a2) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function skinTexture() {
  const random = seeded(0x5e12a9);
  return makeCanvasTexture(512, (ctx, size) => {
    ctx.fillStyle = '#c98773';
    ctx.fillRect(0, 0, size, size);
    for (let patch = 0; patch < 180; patch++) {
      const x = random() * size;
      const y = random() * size;
      const radius = 10 + random() * 55;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, random() > 0.5 ? 'rgba(255,204,181,0.055)' : 'rgba(119,57,51,0.045)');
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let grain = 0; grain < 4500; grain++) {
      const value = random() > 0.5 ? 255 : 80;
      ctx.fillStyle = `rgba(${value},${value * 0.72},${value * 0.65},0.022)`;
      ctx.fillRect(random() * size, random() * size, 1, 1);
    }
  }, 2.3, 2.3);
}

function skinBumpTexture() {
  const random = seeded(0x4a33f1);
  const texture = makeCanvasTexture(256, (ctx, size) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 10000; i++) {
      const shade = 112 + Math.floor(random() * 32);
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx.fillRect(random() * size, random() * size, 1, 1);
    }
  }, 4, 4);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

function clothTexture(base: string, thread: string) {
  return makeCanvasTexture(256, (ctx, size) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    for (let x = 0; x < size; x += 4) {
      ctx.strokeStyle = x % 8 === 0 ? thread : 'rgba(0,0,0,0.055)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size);
      ctx.stroke();
    }
    for (let y = 0; y < size; y += 5) {
      ctx.strokeStyle = y % 10 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.04)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }
  }, 5, 5);
}

function brushedTexture(dark: string, light: string) {
  const random = seeded(parseInt(dark.slice(1), 16) || 1);
  return makeCanvasTexture(256, (ctx, size) => {
    const gradient = ctx.createLinearGradient(0, 0, size, 0);
    gradient.addColorStop(0, dark);
    gradient.addColorStop(0.28, light);
    gradient.addColorStop(0.55, dark);
    gradient.addColorStop(0.82, light);
    gradient.addColorStop(1, dark);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 420; i++) {
      const y = random() * size;
      ctx.strokeStyle = random() > 0.55 ? 'rgba(255,255,255,0.055)' : 'rgba(10,20,30,0.065)';
      ctx.lineWidth = 0.45 + random() * 0.7;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y + (random() - 0.5) * 1.4);
      ctx.stroke();
    }
  }, 2, 2);
}

function leatherTexture() {
  const random = seeded(0x91b132);
  return makeCanvasTexture(256, (ctx, size) => {
    ctx.fillStyle = '#36272a';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 950; i++) {
      const x = random() * size;
      const y = random() * size;
      ctx.strokeStyle = random() > 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,218,181,0.04)';
      ctx.lineWidth = 0.5 + random();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 2 + random() * 10, y + (random() - 0.5) * 2);
      ctx.stroke();
    }
  }, 3, 3);
}

function hairTexture() {
  const random = seeded(0xa11ce);
  return makeCanvasTexture(256, (ctx, size) => {
    const gradient = ctx.createLinearGradient(0, 0, size, 0);
    gradient.addColorStop(0, '#748391');
    gradient.addColorStop(0.35, '#dce2e8');
    gradient.addColorStop(0.68, '#aeb9c5');
    gradient.addColorStop(1, '#667582');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    for (let x = 0; x < size; x += 2) {
      const alpha = 0.03 + random() * 0.08;
      ctx.strokeStyle = x % 4 ? `rgba(255,255,255,${alpha})` : `rgba(26,39,52,${alpha})`;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x + 3, size * 0.35, x - 2, size * 0.7, x + 1, size);
      ctx.stroke();
    }
  }, 3.5, 1);
}

export function createSerynMaterials() {
  const skin = new THREE.MeshPhysicalMaterial({
    map: skinTexture(),
    bumpMap: skinBumpTexture(),
    bumpScale: 0.006,
    roughness: 0.72,
    metalness: 0,
    clearcoat: 0.03,
    sheen: 0.06,
    sheenColor: new THREE.Color(0xf3b6a2),
  });
  const skinShadow = skin.clone();
  skinShadow.color.setHex(0xaa6d60);

  const hairMap = hairTexture();
  const hair = new THREE.MeshPhysicalMaterial({
    map: hairMap,
    color: 0xf0f4f8,
    roughness: 0.46,
    metalness: 0.02,
    sheen: 0.45,
    sheenColor: new THREE.Color(0xc7e9ff),
    side: THREE.DoubleSide,
  });
  const hairShadow = hair.clone();
  hairShadow.color.setHex(0x9aa9b9);

  const navy = new THREE.MeshStandardMaterial({
    map: clothTexture('#122e50', 'rgba(120,187,220,0.05)'),
    roughness: 0.94,
    metalness: 0.02,
  });
  const navyDark = new THREE.MeshStandardMaterial({
    map: clothTexture('#08182c', 'rgba(70,132,170,0.045)'),
    roughness: 0.96,
    metalness: 0.01,
  });
  const teal = new THREE.MeshStandardMaterial({
    map: clothTexture('#2b6670', 'rgba(154,232,229,0.045)'),
    roughness: 0.96,
    metalness: 0.01,
    side: THREE.DoubleSide,
  });

  const silver = new THREE.MeshStandardMaterial({
    map: brushedTexture('#5f6e7a', '#d7e0e8'),
    color: 0xb7c5d0,
    metalness: 0.70,
    roughness: 0.34,
  });
  const silverDark = new THREE.MeshStandardMaterial({
    map: brushedTexture('#354654', '#9aabb9'),
    color: 0x758695,
    metalness: 0.62,
    roughness: 0.41,
  });
  const gold = new THREE.MeshStandardMaterial({
    map: brushedTexture('#76541f', '#e6c67a'),
    color: 0xc39a4f,
    metalness: 0.74,
    roughness: 0.32,
  });
  const leather = new THREE.MeshStandardMaterial({
    map: leatherTexture(),
    roughness: 0.92,
    metalness: 0.02,
  });
  const crystal = new THREE.MeshPhysicalMaterial({
    color: 0x5bdcff,
    emissive: 0x157fa6,
    emissiveIntensity: 0.58,
    roughness: 0.16,
    metalness: 0.16,
    clearcoat: 0.75,
    clearcoatRoughness: 0.12,
  });

  const eyeWhite = new THREE.MeshStandardMaterial({ color: 0xe9e5df, roughness: 0.62 });
  const iris = new THREE.MeshStandardMaterial({ color: 0x42b9d7, emissive: 0x0c5971, emissiveIntensity: 0.24, roughness: 0.30 });
  const eyeDark = new THREE.MeshStandardMaterial({ color: 0x15202b, roughness: 0.78 });
  const lips = new THREE.MeshStandardMaterial({ color: 0x7c4348, roughness: 0.78 });

  return {
    skin, skinShadow, hair, hairShadow,
    navy, navyDark, teal, silver, silverDark, gold, leather, crystal,
    eyeWhite, iris, eyeDark, lips,
  };
}

export type SerynMaterials = ReturnType<typeof createSerynMaterials>;
