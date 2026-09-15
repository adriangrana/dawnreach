import * as THREE from 'three';
import { makeCanvasTexture } from '../shared/textures';

function engravedMetalTexture() {
  return makeCanvasTexture(512, (ctx, size) => {
    ctx.fillStyle = '#b4a27b';
    ctx.fillRect(0, 0, size, size);
    for (let row = 0; row < size; row++) {
      const shade = 130 + Math.round(Math.sin(row * 2.31) * 18);
      ctx.fillStyle = `rgba(${shade},${shade},${shade},0.15)`;
      ctx.fillRect(0, row, size, 1);
    }
    for (const y of [28, size - 28]) {
      ctx.strokeStyle = '#65543b';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
      ctx.strokeStyle = '#e1cca0'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, y + 4); ctx.lineTo(size, y + 4); ctx.stroke();
    }
  });
}

function crystalTexture(blue: boolean) {
  return makeCanvasTexture(512, (ctx, size) => {
    const fill = ctx.createLinearGradient(0, size, size * 0.6, 0);
    fill.addColorStop(0, blue ? '#99f5f4' : '#ffe1a3');
    fill.addColorStop(0.25, blue ? '#149ddc' : '#eb6639');
    fill.addColorStop(0.68, blue ? '#087abb' : '#b42a31');
    fill.addColorStop(1, blue ? '#b4efff' : '#ffc793');
    ctx.fillStyle = fill; ctx.fillRect(0, 0, size, size);
    for (let vein = 0; vein < 9; vein++) {
      const x = vein * size / 8;
      ctx.beginPath(); ctx.moveTo(x - 50, size);
      ctx.bezierCurveTo(x + 90, size * 0.7, x - 80, size * 0.45, x + 50, 0);
      ctx.strokeStyle = blue ? 'rgba(185,250,255,0.17)' : 'rgba(255,227,151,0.17)';
      ctx.lineWidth = vein % 3 === 0 ? 18 : 4; ctx.stroke();
    }
    const shine = ctx.createLinearGradient(0, 0, size, 0);
    shine.addColorStop(0, 'rgba(255,255,255,0.45)');
    shine.addColorStop(0.055, 'rgba(255,255,255,0.08)');
    shine.addColorStop(0.6, 'rgba(0,20,50,0.03)');
    shine.addColorStop(1, 'rgba(0,20,50,0.3)');
    ctx.fillStyle = shine; ctx.fillRect(0, 0, size, size);
  });
}

function crystalGeometry() {
  const positions: number[] = [], uvs: number[] = [], colors: number[] = [];
  const profile = [[0, 0.58], [0.45, 0.87], [2.55, 0.69], [3.25, 0.5], [4.3, 0]];
  const sides = 6;
  for (let face = 0; face < sides; face++) {
    const a = face * Math.PI * 2 / sides, b = (face + 1) * Math.PI * 2 / sides;
    const shade = [0.86, 1, 0.68, 0.91, 0.74, 1][face];
    for (let band = 0; band < profile.length - 1; band++) {
      const [y0, r0] = profile[band], [y1, r1] = profile[band + 1];
      const vertices = [
        [Math.cos(a) * r0, y0, Math.sin(a) * r0, 0, y0 / 4.3],
        [Math.cos(b) * r0, y0, Math.sin(b) * r0, 1, y0 / 4.3],
        [Math.cos(a) * r1, y1, Math.sin(a) * r1, 0, y1 / 4.3],
        [Math.cos(b) * r1, y1, Math.sin(b) * r1, 1, y1 / 4.3],
      ];
      for (const index of [0, 2, 1, 1, 2, 3]) {
        const [x, y, z, u, v] = vertices[index];
        positions.push(x, y, z); uvs.push(u, v); colors.push(shade, shade, shade);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

export function buildThrone(team: 'blue' | 'red', stoneTexture: THREE.Texture | null) {
  const blue = team === 'blue';
  const root = new THREE.Group();
  root.name = `${team}-throne`;
  const stone = new THREE.MeshStandardMaterial({ map: stoneTexture, color: 0x54636d, roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ map: stoneTexture, color: 0x4b6070, roughness: 0.72, metalness: 0.16 });
  const enamel = new THREE.MeshPhysicalMaterial({ color: blue ? 0x3b718e : 0x80434c, metalness: 0.25, roughness: 0.34, clearcoat: 0.8 });
  const metal = new THREE.MeshStandardMaterial({ map: engravedMetalTexture(), color: 0xe3d0a4, metalness: 0.68, roughness: 0.37, bumpScale: 0.016 });
  metal.bumpMap = metal.map;
  const paleMetal = new THREE.MeshStandardMaterial({ color: 0xbdc4bc, metalness: 0.62, roughness: 0.32 });
  const energy = new THREE.MeshBasicMaterial({ color: blue ? 0x73e9ff : 0xffa775, toneMapped: false });
  const texture = crystalTexture(blue);
  const crystalMaterial = new THREE.MeshPhysicalMaterial({
    map: texture, vertexColors: true, emissiveMap: texture,
    emissive: blue ? 0x54d9ff : 0xff9165, emissiveIntensity: 0.46,
    roughness: 0.2, metalness: 0.12, clearcoat: 1, clearcoatRoughness: 0.12,
  });
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, y = 0, parent = root) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = y;
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const ring = (inner: number, outer: number, y: number, material: THREE.Material) =>
    add(new THREE.RingGeometry(inner, outer, 96).rotateX(-Math.PI / 2), material, y);
  const trim = (radius: number, y: number, thickness = 0.035) =>
    add(new THREE.TorusGeometry(radius, thickness, 8, 96).rotateX(-Math.PI / 2), metal, y);

  // Broad chamfered steps, dark reveals and brass edges give the pedestal real depth.
  add(new THREE.CylinderGeometry(3.35, 3.55, 0.20, 96), dark, 0.10);
  add(new THREE.CylinderGeometry(3.13, 3.31, 0.20, 96), stone, 0.28);
  trim(3.22, 0.37, 0.05);
  add(new THREE.CylinderGeometry(2.86, 2.98, 0.25, 96), dark, 0.49);
  ring(2.73, 2.9, 0.62, enamel); trim(2.86, 0.635);
  add(new THREE.CylinderGeometry(2.48, 2.62, 0.30, 96), enamel, 0.73);
  ring(2.1, 2.48, 0.885, dark); trim(2.43, 0.9, 0.055);
  add(new THREE.CylinderGeometry(1.87, 2.02, 0.24, 96), dark, 0.99);
  ring(1.24, 1.87, 1.12, enamel); trim(1.82, 1.135, 0.045);
  add(new THREE.CylinderGeometry(1.22, 1.34, 0.20, 64), metal, 1.2);
  ring(0.76, 1.20, 1.305, paleMetal);
  ring(0.78, 0.9, 1.315, energy);
  trim(1.1, 1.33, 0.03);

  for (let sector = 0; sector < 16; sector++) {
    const angle = sector * Math.PI / 8;
    const inlay = new THREE.RingGeometry(2.64, 3.08, 8, 1, angle + 0.035, Math.PI / 8 - 0.07).rotateX(-Math.PI / 2);
    add(inlay, sector % 2 === 0 ? enamel : stone, 0.39);
    const engraving = add(new THREE.BoxGeometry(0.025, 0.012, 0.23), metal, 0.405);
    engraving.position.set(Math.sin(angle) * 2.87, 0.405, Math.cos(angle) * 2.87);
    engraving.rotation.y = angle;
  }
  for (let glyph = 0; glyph < 20; glyph++) {
    const angle = glyph * Math.PI / 10;
    const mark = add(new THREE.BoxGeometry(0.04, 0.016, glyph % 2 ? 0.12 : 0.2), energy);
    mark.position.set(Math.sin(angle) * 1.48, 1.145, Math.cos(angle) * 1.48);
    mark.rotation.y = angle;
  }

  // Four armored buttresses replace the thin tubular spokes and floating shards.
  for (let support = 0; support < 4; support++) {
    const mount = new THREE.Group(); mount.rotation.y = support * Math.PI / 2; root.add(mount);
    const profile = new THREE.Shape();
    profile.moveTo(0.2, 0); profile.lineTo(1.7, 0); profile.lineTo(1.56, 0.35);
    profile.lineTo(0.47, 1.4); profile.lineTo(0.22, 1.5); profile.closePath();
    const geometry = new THREE.ExtrudeGeometry(profile, { depth: 0.48, bevelEnabled: true, bevelSize: 0.045, bevelThickness: 0.045, bevelSegments: 2, steps: 1 });
    geometry.translate(0, 0, -0.24); geometry.rotateY(-Math.PI / 2); geometry.translate(0, 0.22, 1.5);
    add(geometry, metal, 0, mount);
    const panel = add(new THREE.BoxGeometry(0.37, 1.3, 0.09), enamel, 0, mount);
    panel.position.set(0, 1.2, 2.5); panel.rotation.x = -0.78;
    const jewel = add(new THREE.SphereGeometry(0.12, 12, 8), energy, 0, mount);
    jewel.position.set(0, 1.3, 2.56); jewel.scale.set(0.68, 1.95, 0.55); jewel.rotation.x = -0.78;
    for (const offset of [-0.15, 0.15]) {
      const stud = add(new THREE.SphereGeometry(0.045, 8, 6), paleMetal, 0, mount);
      stud.position.set(offset, 0.76, 2.93);
    }
  }
  const prism = new THREE.Group();
  prism.name = `${team}-throne-prism`;
  prism.position.y = 1.28;
  root.add(prism);
  const crystal = add(crystalGeometry(), crystalMaterial, 0, prism);
  crystal.name = 'throne-crystal'; crystal.rotation.y = Math.PI / 6;
  crystal.scale.set(1.35, 1.25, 1.35);
  // Thin facet ridges catch light without outlining triangulation across the faces.
  for (let ridge = 0; ridge < 6; ridge++) {
    const angle = ridge * Math.PI / 3 + Math.PI / 6;
    const points = [[0, 0.58], [0.45, 0.87], [2.55, 0.69], [3.25, 0.5], [4.3, 0]].map(([y, r]) =>
      new THREE.Vector3(Math.cos(angle) * (r + 0.006), y, Math.sin(angle) * (r + 0.006)));
    const curve = new THREE.CurvePath<THREE.Vector3>();
    for (let segment = 0; segment < points.length - 1; segment++) {
      curve.add(new THREE.LineCurve3(points[segment], points[segment + 1]));
    }
    add(new THREE.TubeGeometry(curve, 20, 0.009, 4, false), energy, 0, prism);
  }
  root.userData.animate = (elapsed: number) => {
    crystalMaterial.emissiveIntensity = 0.46 + Math.sin(elapsed * 1.4) * 0.07;
    prism.rotation.y = elapsed * (blue ? 0.14 : -0.14);
    prism.position.y = 1.28 + Math.sin(elapsed * 1.35) * 0.06;
  };
  return root;
}
