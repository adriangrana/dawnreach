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

function wrappedPatch(
  ctx: CanvasRenderingContext2D,
  size: number,
  x: number,
  y: number,
  radius: number,
  inner: string,
) {
  for (const ox of [-size, 0, size]) {
    for (const oy of [-size, 0, size]) {
      const px = x + ox;
      const py = y + oy;
      const gradient = ctx.createRadialGradient(px, py, 0, px, py, radius);
      gradient.addColorStop(0, inner);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

export function createProceduralTextures() {
  return {
    grass: makeCanvasTexture(512, (ctx, size) => {
      const random = createSeededRandom(0xdecafbad);
      ctx.fillStyle = '#3f583d';
      ctx.fillRect(0, 0, size, size);

      // Large colour variation is painted with wrapped copies so the tile has no visible square seams.
      for (let i = 0; i < 54; i += 1) {
        const x = random() * size;
        const y = random() * size;
        const radius = 18 + random() * 54;
        const warm = random() > 0.55;
        wrappedPatch(
          ctx,
          size,
          x,
          y,
          radius,
          warm ? 'rgba(124,128,74,0.055)' : 'rgba(13,39,25,0.085)',
        );
      }

      for (let i = 0; i < 3600; i += 1) {
        const x = random() * size;
        const y = random() * size;
        const length = 0.8 + random() * 3.2;
        const alpha = 0.025 + random() * 0.075;
        ctx.strokeStyle = random() > 0.58
          ? `rgba(173,190,121,${alpha})`
          : `rgba(7,31,18,${alpha})`;
        ctx.lineWidth = 0.35 + random() * 0.55;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (random() - 0.5) * 1.3, y - length);
        ctx.stroke();
      }

      for (let i = 0; i < 620; i += 1) {
        const x = random() * size;
        const y = random() * size;
        const r = 0.35 + random() * 1.15;
        ctx.fillStyle = random() > 0.55 ? 'rgba(123,102,67,0.10)' : 'rgba(20,42,25,0.14)';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }, 7, 5),

    lane: makeCanvasTexture(512, (ctx, size) => {
      const random = createSeededRandom(0x1a2b3c4d);
      ctx.fillStyle = '#776d59';
      ctx.fillRect(0, 0, size, size);

      // Soft earth and worn stone stains. No brick/plank grid: lanes should read as old battlefield roads.
      for (let i = 0; i < 78; i += 1) {
        const x = random() * size;
        const y = random() * size;
        const radius = 12 + random() * 42;
        wrappedPatch(
          ctx,
          size,
          x,
          y,
          radius,
          random() > 0.5 ? 'rgba(181,164,124,0.075)' : 'rgba(56,49,39,0.09)',
        );
      }

      for (let i = 0; i < 210; i += 1) {
        const cx = random() * size;
        const cy = random() * size;
        const rx = 3 + random() * 11;
        const ry = 1.5 + random() * 5;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(random() * Math.PI);
        ctx.fillStyle = random() > 0.5 ? 'rgba(198,183,146,0.07)' : 'rgba(45,39,32,0.085)';
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      for (let i = 0; i < 260; i += 1) {
        const x = random() * size;
        const y = random() * size;
        const length = 3 + random() * 13;
        const angle = random() * Math.PI * 2;
        ctx.strokeStyle = `rgba(45,38,30,${0.045 + random() * 0.08})`;
        ctx.lineWidth = 0.4 + random() * 0.6;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
        ctx.stroke();
      }

      for (let i = 0; i < 1500; i += 1) {
        const x = random() * size;
        const y = random() * size;
        const r = 0.25 + random() * 0.9;
        ctx.fillStyle = random() > 0.5 ? 'rgba(40,34,28,0.12)' : 'rgba(205,188,146,0.075)';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }, 1.35, 1.05),

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
