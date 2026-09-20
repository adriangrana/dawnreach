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
  return makeCanvasTexture(512, (ctx, size) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);
    for (let x = 0; x < size; x += 3) {
      ctx.strokeStyle = x % 9 === 0 ? thread : 'rgba(0,0,0,0.040)';
      ctx.lineWidth = 0.55;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 1.2, size);
      ctx.stroke();
    }
    for (let y = 0; y < size; y += 4) {
      ctx.strokeStyle = y % 12 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.030)';
      ctx.lineWidth = 0.45;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }
  }, 4.2, 4.8);
}

function clothBumpTexture(seedValue = 0x728aa1) {
  const random = seeded(seedValue);
  const texture = makeCanvasTexture(512, (ctx, size) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, size, size);

    // Warp and weft.
    for (let x = 0; x < size; x += 3) {
      const shade = 118 + Math.floor(random() * 24);
      ctx.strokeStyle = `rgb(${shade},${shade},${shade})`;
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 1.0, size);
      ctx.stroke();
    }
    for (let y = 0; y < size; y += 4) {
      const shade = 122 + Math.floor(random() * 20);
      ctx.strokeStyle = `rgb(${shade},${shade},${shade})`;
      ctx.lineWidth = 0.55;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }

    // Tiny fibre irregularity.
    for (let i = 0; i < 7000; i++) {
      const shade = 112 + Math.floor(random() * 34);
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx.fillRect(random() * size, random() * size, 1, 1);
    }
  }, 4.2, 4.8);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

function ceremonialClothTexture(base: string, accent: string, gold = false) {
  const random = seeded(parseInt(base.replace('#', ''), 16) || 0x9471);
  return makeCanvasTexture(768, (ctx, size) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);

    // Fine woven fibre.
    for (let x = 0; x < size; x += 3) {
      ctx.strokeStyle = x % 9 === 0 ? accent : 'rgba(0,0,0,0.035)';
      ctx.lineWidth = 0.55;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + (x % 2 ? 1.5 : -1.5), size);
      ctx.stroke();
    }
    for (let y = 0; y < size; y += 4) {
      ctx.strokeStyle = y % 12 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.025)';
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }

    // Soft tonal clouding like worn layered fantasy fabric.
    for (let patch = 0; patch < 70; patch++) {
      const x = random() * size;
      const y = random() * size;
      const radius = 18 + random() * 70;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
      grad.addColorStop(0, random() > 0.5 ? 'rgba(255,255,255,0.028)' : 'rgba(0,0,0,0.035)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }

    if (gold) {
      ctx.strokeStyle = 'rgba(206,170,89,0.60)';
      ctx.lineWidth = 2.1;
      for (let row = 0; row < 3; row++) {
        for (let column = 0; column < 3; column++) {
          const cx = (column + 0.5) * size / 3;
          const cy = (row + 0.5) * size / 3;
          const r = 12;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
          for (let ray = 0; ray < 8; ray++) {
            const a = ray / 8 * Math.PI * 2;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * (r + 4), cy + Math.sin(a) * (r + 4));
            ctx.lineTo(cx + Math.cos(a) * (r + 13), cy + Math.sin(a) * (r + 13));
            ctx.stroke();
          }
        }
      }
    }
  }, 2.2, 2.6);
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
  return makeCanvasTexture(768, (ctx, size) => {
    const gradient = ctx.createLinearGradient(0, 0, size, 0);
    gradient.addColorStop(0.00, '#657684');
    gradient.addColorStop(0.18, '#b6c1cc');
    gradient.addColorStop(0.38, '#e7ebef');
    gradient.addColorStop(0.58, '#bdc7d1');
    gradient.addColorStop(0.80, '#f0f3f6');
    gradient.addColorStop(1.00, '#70808e');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    // Thousands of slightly curved fibres create a continuous strand flow. The UVs of
    // the unified hair shell run crown -> tips, so these strokes follow the hairstyle.
    for (let strand = 0; strand < 1650; strand++) {
      const x = random() * size;
      const width = 0.28 + random() * 0.85;
      const drift = (random() - 0.5) * 8;
      const highlight = random() > 0.52;
      const alpha = 0.025 + random() * 0.095;
      ctx.strokeStyle = highlight
        ? `rgba(255,255,255,${alpha})`
        : `rgba(33,48,62,${alpha * 0.95})`;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x, -6);
      ctx.bezierCurveTo(
        x + drift * 0.35, size * 0.30,
        x - drift * 0.22, size * 0.68,
        x + drift, size + 6,
      );
      ctx.stroke();
    }

    // Broader tonal ribbons stop the material looking like flat grey plastic.
    for (let ribbon = 0; ribbon < 42; ribbon++) {
      const x = random() * size;
      const width = 5 + random() * 14;
      const g = ctx.createLinearGradient(x - width, 0, x + width, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, random() > 0.5 ? 'rgba(255,255,255,0.055)' : 'rgba(26,38,50,0.055)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - width, 0, width * 2, size);
    }
  }, 3.0, 1);
}

function hairBumpTexture() {
  const random = seeded(0xb71f33);
  const texture = makeCanvasTexture(512, (ctx, size) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, size, size);
    for (let strand = 0; strand < 1050; strand++) {
      const x = random() * size;
      const drift = (random() - 0.5) * 5;
      const value = 112 + Math.floor(random() * 44);
      ctx.strokeStyle = `rgb(${value},${value},${value})`;
      ctx.lineWidth = 0.45 + random() * 0.65;
      ctx.beginPath();
      ctx.moveTo(x, -4);
      ctx.bezierCurveTo(
        x + drift * 0.3, size * 0.33,
        x - drift * 0.2, size * 0.68,
        x + drift, size + 4,
      );
      ctx.stroke();
    }
  }, 3.0, 1);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
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

  // The face uses vertex colours for eyes/brows/lips while retaining the skin bump
  // response. This keeps the head a single connected mesh instead of attaching
  // separate facial primitives.
  const face = skin.clone();
  face.map = null;
  face.color.setHex(0xffffff);
  face.vertexColors = true;
  face.roughness = 0.74;

  const hairMap = hairTexture();
  const hair = new THREE.MeshPhysicalMaterial({
    map: hairMap,
    bumpMap: hairBumpTexture(),
    bumpScale: 0.010,
    color: 0xf0f4f8,
    roughness: 0.52,
    metalness: 0.01,
    sheen: 0.72,
    sheenColor: new THREE.Color(0xd8efff),
    clearcoat: 0.10,
    clearcoatRoughness: 0.58,
    side: THREE.DoubleSide,
  });
  const hairShadow = hair.clone();
  hairShadow.color.setHex(0x9aa9b9);

  const clothBump = clothBumpTexture();
  const navy = new THREE.MeshPhysicalMaterial({
    map: clothTexture('#122e50', 'rgba(120,187,220,0.055)'),
    bumpMap: clothBump,
    bumpScale: 0.014,
    roughness: 0.80,
    metalness: 0.01,
    sheen: 0.26,
    sheenColor: new THREE.Color(0x6397b6),
  });
  const navyDark = new THREE.MeshPhysicalMaterial({
    map: clothTexture('#08182c', 'rgba(70,132,170,0.050)'),
    bumpMap: clothBump,
    bumpScale: 0.013,
    roughness: 0.82,
    metalness: 0.01,
    sheen: 0.20,
    sheenColor: new THREE.Color(0x416985),
  });
  const teal = new THREE.MeshPhysicalMaterial({
    map: clothTexture('#2b6670', 'rgba(154,232,229,0.055)'),
    bumpMap: clothBump,
    bumpScale: 0.014,
    roughness: 0.82,
    metalness: 0.01,
    sheen: 0.24,
    sheenColor: new THREE.Color(0x91dad9),
    side: THREE.DoubleSide,
  });
  const ivory = new THREE.MeshPhysicalMaterial({
    map: ceremonialClothTexture('#d8d4c7', 'rgba(255,255,255,0.060)'),
    bumpMap: clothBumpTexture(0xf0ece2),
    bumpScale: 0.018,
    color: 0xf0ece2,
    roughness: 0.78,
    metalness: 0,
    sheen: 0.30,
    sheenColor: new THREE.Color(0xffffff),
    side: THREE.DoubleSide,
  });
  const cloakBlue = new THREE.MeshPhysicalMaterial({
    map: ceremonialClothTexture('#173d61', 'rgba(129,190,222,0.055)', true),
    bumpMap: clothBumpTexture(0x24577b),
    bumpScale: 0.020,
    color: 0x24577b,
    roughness: 0.77,
    metalness: 0.01,
    sheen: 0.34,
    sheenColor: new THREE.Color(0x8cd8ef),
    side: THREE.DoubleSide,
  });
  const cloakBlueDark = new THREE.MeshPhysicalMaterial({
    map: ceremonialClothTexture('#0b2035', 'rgba(90,150,190,0.050)', true),
    bumpMap: clothBumpTexture(0x17314a),
    bumpScale: 0.018,
    color: 0x17314a,
    roughness: 0.80,
    metalness: 0.01,
    sheen: 0.24,
    sheenColor: new THREE.Color(0x507f9c),
    side: THREE.DoubleSide,
  });
  const blackLeather = new THREE.MeshStandardMaterial({
    map: leatherTexture(),
    color: 0x17171c,
    roughness: 0.72,
    metalness: 0.10,
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
    skin, skinShadow, face, hair, hairShadow,
    navy, navyDark, teal, ivory, cloakBlue, cloakBlueDark, blackLeather,
    silver, silverDark, gold, leather, crystal,
    eyeWhite, iris, eyeDark, lips,
  };
}

export type SerynMaterials = ReturnType<typeof createSerynMaterials>;
