import * as THREE from 'three';

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
    grass: makeCanvasTexture(256, (ctx, size) => {
      ctx.fillStyle = '#445e3e';
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 1100; i += 1) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const shade = 50 + Math.floor(Math.random() * 45);
        ctx.fillStyle = `rgba(${shade}, ${90 + Math.floor(Math.random() * 45)}, ${shade}, ${0.08 + Math.random() * 0.14})`;
        ctx.fillRect(x, y, 1 + Math.random() * 2, 1 + Math.random() * 3);
      }
    }, 12, 9),

    lane: makeCanvasTexture(256, (ctx, size) => {
      ctx.fillStyle = '#807760';
      ctx.fillRect(0, 0, size, size);
      for (let y = 0; y < size; y += 32) {
        for (let x = 0; x < size; x += 46) {
          const offset = ((y / 32) % 2) * 23;
          ctx.fillStyle = 'rgba(92,85,68,0.28)';
          ctx.fillRect(x + offset, y, 38, 23);
          ctx.strokeStyle = 'rgba(190,178,145,0.10)';
          ctx.strokeRect(x + offset, y, 38, 23);
        }
      }
    }, 8, 2),

    steel: makeCanvasTexture(128, (ctx, size) => {
      const gradient = ctx.createLinearGradient(0, 0, size, 0);
      gradient.addColorStop(0, '#68737d');
      gradient.addColorStop(0.23, '#eef2f4');
      gradient.addColorStop(0.46, '#929da5');
      gradient.addColorStop(0.73, '#f5f7f8');
      gradient.addColorStop(1, '#626c74');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 150; i += 1) {
        const y = Math.random() * size;
        ctx.strokeStyle = `rgba(255,255,255,${Math.random() * 0.09})`;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y + (Math.random() - 0.5) * 2);
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
      ctx.fillStyle = '#654326';
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 250; i += 1) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        ctx.fillStyle = `rgba(25,12,5,${Math.random() * 0.10})`;
        ctx.fillRect(x, y, Math.random() * 5 + 1, 1);
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
