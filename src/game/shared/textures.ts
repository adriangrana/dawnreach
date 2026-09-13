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
    grass: makeCanvasTexture(1024, (ctx, size) => {
      const random = createSeededRandom(0xdecafbad);
      ctx.fillStyle = '#52643b';
      ctx.fillRect(0, 0, size, size);

      // Large colour variation is painted with wrapped copies so the tile has no visible square seams.
      for (let i = 0; i < 160; i += 1) {
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
          warm ? 'rgba(154,155,76,0.20)' : 'rgba(22,45,28,0.26)',
        );
      }

      for (let i = 0; i < 38000; i += 1) {
        const x = random() * size;
        const y = random() * size;
        const length = 0.8 + random() * 3.2;
        const alpha = 0.10 + random() * 0.22;
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
    }, 14, 10.5),

    pine: makeCanvasTexture(512, (ctx, size) => {
      const random = createSeededRandom(611);
      ctx.clearRect(0, 0, size, size);
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#c4c8b3';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.moveTo(size / 2, 0);
      ctx.lineTo(size / 2, size * 0.96);
      ctx.stroke();
      for (let tier = 0; tier < 23; tier++) {
        const along = tier / 23;
        const baseY = along * size * 0.83;
        const reach = size * (0.12 + along * 0.34);
        for (const side of [-1, 1]) {
          for (let needle = 0; needle < 36; needle++) {
            const fraction = needle / 36;
            const startX = size / 2 + side * reach * fraction;
            const startY = baseY + fraction * size * 0.10;
            const shade = 130 + Math.floor(random() * 115);
            ctx.strokeStyle = `rgb(${shade},${Math.min(255, shade + 7)},${shade - 12})`;
            ctx.lineWidth = 2.5 + random() * 3.5;
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            ctx.lineTo(startX + side * (9 + random() * 19), startY + 12 + random() * 24);
            ctx.stroke();
          }
        }
      }
    }, 8, 1),

    stone: makeCanvasTexture(512, (ctx, size) => {
      const random = createSeededRandom(9147);
      ctx.fillStyle = '#a3a79b';
      ctx.fillRect(0, 0, size, size);
      for (let index = 0; index < 180; index++) {
        wrappedPatch(ctx, size, random() * size, random() * size, 8 + random() * 70,
          index % 3 ? 'rgba(37,49,48,0.18)' : 'rgba(200,197,158,0.20)');
      }
      for (let index = 0; index < 22000; index++) {
        ctx.fillStyle = index % 2 ? 'rgba(25,32,29,0.12)' : 'rgba(234,230,211,0.15)';
        ctx.fillRect(random() * size, random() * size, 0.5 + random() * 2, 0.5 + random() * 2);
      }
    }),

    bark: makeCanvasTexture(256, (ctx, size) => {
      const random = createSeededRandom(531);
      ctx.fillStyle = '#8a8270';
      ctx.fillRect(0, 0, size, size);
      for (let index = 0; index < 280; index++) {
        const startX = random() * size;
        const startY = random() * size;
        ctx.strokeStyle = index % 3 ? 'rgba(24,20,16,0.4)' : 'rgba(228,219,186,0.35)';
        ctx.lineWidth = 0.5 + random() * 3;
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.bezierCurveTo(startX - 4, startY + 16, startX + 6, startY + 35, startX + 1, startY + 70);
        ctx.stroke();
      }
    }, 2, 1),

    riverBed: makeCanvasTexture(1024, (ctx, size) => {
      const random = createSeededRandom(0x714bed);
      ctx.fillStyle = '#827e66';
      ctx.fillRect(0, 0, size, size);
      for (let patch = 0; patch < 120; patch++) {
        wrappedPatch(ctx, size, random() * size, random() * size, 20 + random() * 100,
          patch % 3 ? 'rgba(38,59,42,0.22)' : 'rgba(194,181,141,0.19)');
      }
      for (let grain = 0; grain < 28000; grain++) {
        ctx.fillStyle = grain % 2 ? 'rgba(40,48,34,0.16)' : 'rgba(224,216,180,0.19)';
        ctx.fillRect(random() * size, random() * size, 1 + random() * 2, 1 + random() * 2);
      }
      for (let pebble = 0; pebble < 950; pebble++) {
        const centerX = random() * size;
        const centerY = random() * size;
        const radiusX = 3 + random() ** 2 * 22;
        const radiusY = radiusX * (0.5 + random() * 0.35);
        const rotation = random() * Math.PI;
        const shade = Math.floor(random() * 52);
        for (const offsetX of [-size, 0, size]) {
          for (const offsetY of [-size, 0, size]) {
            const x = centerX + offsetX;
            const y = centerY + offsetY;
            ctx.fillStyle = 'rgba(29,42,34,0.4)';
            ctx.beginPath();
            ctx.ellipse(x + 2, y + 2, radiusX + 2, radiusY + 2, rotation, 0, Math.PI * 2);
            ctx.fill();
            const light = ctx.createLinearGradient(x - radiusX, y - radiusX, x + radiusX, y + radiusX);
            light.addColorStop(0, `rgb(${163 + shade},${167 + shade},${143 + shade})`);
            light.addColorStop(0.45, `rgb(${106 + shade},${115 + shade},${98 + shade})`);
            light.addColorStop(1, `rgb(${63 + shade},${75 + shade},${62 + shade})`);
            ctx.fillStyle = light;
            ctx.beginPath();
            ctx.ellipse(x, y, radiusX, radiusY, rotation, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }),

    waterFlow: makeCanvasTexture(512, (ctx, size) => {
      const image = ctx.createImageData(size, size);
      for (let row = 0; row < size; row++) {
        for (let column = 0; column < size; column++) {
          const phaseX = column / size * Math.PI * 2;
          const phaseY = row / size * Math.PI * 2;
          const warp = Math.sin(phaseX * 2 + Math.sin(phaseY * 2)) * 0.75;
          const crest = Math.abs(Math.sin(phaseY * 6 + warp + Math.sin(phaseX * 3) * 0.3));
          const broken = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(phaseX * 5 - phaseY * 2));
          const alpha = Math.max(0, 1 - crest / 0.16) * broken;
          const offset = (row * size + column) * 4;
          image.data[offset] = 215;
          image.data[offset + 1] = 238;
          image.data[offset + 2] = 216;
          image.data[offset + 3] = alpha * 220;
        }
      }
      ctx.putImageData(image, 0, 0);
    }, 1.5, 1),

    water: makeCanvasTexture(512, (ctx, size) => {
      const image = ctx.createImageData(size, size);
      for (let row = 0; row < size; row++) {
        for (let column = 0; column < size; column++) {
          const phaseX = column / size * Math.PI * 2;
          const phaseY = row / size * Math.PI * 2;
          const warpX = phaseX + Math.sin(phaseY * 2) * 0.4;
          const warpY = phaseY + Math.sin(phaseX * 3) * 0.3;
          const value = 128 + 28 * Math.sin(warpX * 4 + Math.sin(warpY * 3))
            + 17 * Math.sin(warpY * 7 + warpX * 2) + 9 * Math.sin(phaseY * 13 - phaseX * 5);
          const offset = (row * size + column) * 4;
          image.data[offset] = value;
          image.data[offset + 1] = value;
          image.data[offset + 2] = value;
          image.data[offset + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
    }, 1.5, 1),

    paving: makeCanvasTexture(1024, (ctx, size) => {
      const random = createSeededRandom(71628);
      ctx.fillStyle = '#817b63';
      ctx.fillRect(0, 0, size, size);
      const count = 9;
      const cell = size / count;
      const lattice = Array.from({ length: count }, (_, row) => Array.from({ length: count }, (_, column) => [
        (column + (random() - 0.5) * 0.72) * cell,
        (row + (random() - 0.5) * 0.72) * cell,
      ]));
      const corner = (column: number, row: number) => {
        const point = lattice[((row % count) + count) % count][((column % count) + count) % count];
        return [point[0] + Math.floor(column / count) * size, point[1] + Math.floor(row / count) * size];
      };
      const paintStone = (points: number[][]) => {
        const center = points.reduce(([sumX, sumY], point) => [sumX + point[0] / points.length, sumY + point[1] / points.length], [0, 0]);
        const shade = random() * 22;
        ctx.fillStyle = `rgb(${155 + shade},${151 + shade},${129 + shade})`;
        ctx.strokeStyle = 'rgba(73,78,57,0.58)';
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        points.forEach((point, index) => {
          const next = points[(index + 1) % points.length];
          const start = [point[0] * 0.94 + center[0] * 0.06, point[1] * 0.94 + center[1] * 0.06];
          const finish = [next[0] * 0.94 + center[0] * 0.06, next[1] * 0.94 + center[1] * 0.06];
          ctx.lineTo(start[0] * 0.85 + finish[0] * 0.15, start[1] * 0.85 + finish[1] * 0.15);
          ctx.lineTo(start[0] * 0.15 + finish[0] * 0.85, start[1] * 0.15 + finish[1] * 0.85);
        });
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      };
      for (let row = -1; row <= count; row++) {
        for (let column = -1; column <= count; column++) {
          const points = [corner(column, row), corner(column + 1, row), corner(column + 1, row + 1), corner(column, row + 1)];
          if (random() > 0.64) {
            paintStone(points.slice(0, 3));
            paintStone([points[0], points[2], points[3]]);
          } else {
            paintStone(points);
          }
        }
      }
      for (let index = 0; index < 25000; index++) {
        ctx.fillStyle = index % 2 ? 'rgba(38,45,26,0.10)' : 'rgba(247,231,200,0.16)';
        ctx.fillRect(random() * size, random() * size, 1 + random() * 3, random() * 2 + 1);
      }
      for (let index = 0; index < 60; index++) {
        wrappedPatch(ctx, size, random() * size, random() * size, 15 + random() * 45, 'rgba(57,76,35,0.19)');
      }
    }),

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
