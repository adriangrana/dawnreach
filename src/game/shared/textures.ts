import * as THREE from 'three';

function createSeededRandom(seed = 0x5f3759df) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function makeCanvasTexture(
  size: number,
  draw: (ctx: CanvasRenderingContext2D, size: number) => void,
  repeatX = 1,
  repeatY = 1,
) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  draw(ctx, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = 8;
  return texture;
}

export function createProceduralTextures() {
  return {
    grass: makeCanvasTexture(384, (ctx, size) => {
      const random = createSeededRandom(0xdecafbad);
      const base = ctx.createLinearGradient(0, 0, size, size);
      base.addColorStop(0, '#3d563b');
      base.addColorStop(0.45, '#466141');
      base.addColorStop(1, '#354d37');
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, size, size);

      for (let i = 0; i < 90; i += 1) {
        const x = random() * size;
        const y = random() * size;
        const radius = 10 + random() * 38;
        const patch = ctx.createRadialGradient(x, y, 0, x, y, radius);
        const warm = random() > 0.52;
        patch.addColorStop(0, warm ? 'rgba(112,125,75,0.10)' : 'rgba(20,48,30,0.14)');
        patch.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = patch;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }

      for (let i = 0; i < 1900; i += 1) {
        const x = random() * size;
        const y = random() * size;
        const length = 1 + random() * 3.5;
        const alpha = 0.035 + random() * 0.10;
        ctx.strokeStyle = random() > 0.55
          ? `rgba(170,190,120,${alpha})`
          : `rgba(10,38,22,${alpha})`;
        ctx.lineWidth = 0.45 + random() * 0.55;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (random() - 0.5) * 1.5, y - length);
        ctx.stroke();
      }

      for (let i = 0; i < 320; i += 1) {
        const x = random() * size;
        const y = random() * size;
        const r = 0.4 + random() * 1.35;
        ctx.fillStyle = random() > 0.5 ? 'rgba(122,104,67,0.16)' : 'rgba(28,48,30,0.18)';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }, 10, 8),

    lane: makeCanvasTexture(384, (ctx, size) => {
      const random = createSeededRandom(0x1a2b3c4d);
      const base = ctx.createLinearGradient(0, 0, size, size);
      base.addColorStop(0, '#716958');
      base.addColorStop(0.5, '#827965');
      base.addColorStop(1, '#665f50');
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, size, size);

      for (let i = 0; i < 170; i += 1) {
        const cx = random() * size;
        const cy = random() * size;
        const w = 12 + random() * 28;
        const h = 7 + random() * 18;
        const rotation = (random() - 0.5) * 0.7;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rotation);
        ctx.beginPath();
        const sides = 5 + Math.floor(random() * 3);
        for (let p = 0; p < sides; p += 1) {
          const a = (p / sides) * Math.PI * 2;
          const jitter = 0.78 + random() * 0.32;
          const px = Math.cos(a) * w * 0.5 * jitter;
          const py = Math.sin(a) * h * 0.5 * jitter;
          if (p === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        const shade = 96 + Math.floor(random() * 28);
        ctx.fillStyle = `rgba(${shade + 18},${shade + 13},${shade},${0.12 + random() * 0.16})`;
        ctx.fill();
        ctx.strokeStyle = `rgba(45,40,33,${0.10 + random() * 0.12})`;
        ctx.lineWidth = 0.8 + random() * 1.1;
        ctx.stroke();
        ctx.restore();
      }

      for (let i = 0; i < 460; i += 1) {
        const x = random() * size;
        const y = random() * size;
        const length = 2 + random() * 8;
        const angle = random() * Math.PI * 2;
        ctx.strokeStyle = `rgba(43,37,31,${0.06 + random() * 0.13})`;
        ctx.lineWidth = 0.45 + random() * 0.7;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
        ctx.stroke();
      }

      for (let i = 0; i < 900; i += 1) {
        const x = random() * size;
        const y = random() * size;
        const r = 0.3 + random() * 1.2;
        ctx.fillStyle = random() > 0.52 ? 'rgba(39,34,28,0.15)' : 'rgba(190,177,142,0.10)';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }, 7, 2),

    steel: makeCanvasTexture(128, (ctx, size) => {
      const random = createSeededRandom(0x33aa55cc);
      const gradient = ctx.createLinearGradient(0, 0, size, 0);
      gradient.addColorStop(0, '#68737d');
      gradient.addColorStop(0.23, '#eef2f4');
      gradient.addColorStop(0.46, '#929da5');
      gradient.addColorStop(0.73, '#f5f7f8');
      gradient.addColorStop(1, '#626c74');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 150; i += 1) {
        const y = random() * size;
        ctx.strokeStyle = `rgba(255,255,255,${random() * 0.09})`;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y + (random() - 0.5) * 2);
        ctx.stroke();
      }
    }, 2, 2),

    gold: makeCanvasTexture(128, (ctx, size) => {
      const gradient = ctx.createLinearGradient(0, 0, size, size);
      gradient.addColorStop(0, '#9e6b20');
      gradient.addColorStop(0.3, '#f7dc83');
      gradient.addColorStop(0.55, '#c89232');
      gradient.addColorStop(0.82, '#ffe79f');
      gradient.addColorStop(1, '#8b5d1b');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
    }, 2, 2),

    cloth: makeCanvasTexture(128, (ctx, size) => {
      ctx.fillStyle = '#2257a4';
      ctx.fillRect(0, 0, size, size);
      for (let x = 0; x < size; x += 4) {
        ctx.strokeStyle = x % 8 === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, size);
        ctx.stroke();
      }
      for (let y = 0; y < size; y += 5) {
        ctx.strokeStyle = 'rgba(255,255,255,0.02)';
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
      }
    }, 3, 3),

    leather: makeCanvasTexture(128, (ctx, size) => {
      const random = createSeededRandom(0x7f4a7c15);
      ctx.fillStyle = '#654326';
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 250; i += 1) {
        const x = random() * size;
        const y = random() * size;
        ctx.fillStyle = `rgba(25,12,5,${random() * 0.10})`;
        ctx.fillRect(x, y, random() * 5 + 1, 1);
      }
    }, 3, 3),

    chain: makeCanvasTexture(128, (ctx, size) => {
      ctx.fillStyle = '#30363b';
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = 'rgba(190,200,205,0.45)';
      ctx.lineWidth = 1.2;
      for (let y = 0; y < size + 10; y += 9) {
        for (let x = 0; x < size + 10; x += 10) {
          ctx.beginPath();
          ctx.ellipse(x + ((y / 9) % 2) * 5, y, 4, 3, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }, 3, 3),
  };
}

export type DawnreachTextures = ReturnType<typeof createProceduralTextures>;
