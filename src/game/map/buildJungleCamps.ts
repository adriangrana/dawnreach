import * as THREE from 'three';
import type { DawnreachTextures } from '../shared/textures';
import { CAMP_LAYOUT, DAWNREACH_LAYOUT } from './mapLayout';
import { mapRandom, sampleMapPath } from './buildMapVegetation';

// RGBA vertex colors feather the edge into the grass without a circular rim.
function groundPatch(width: number, depth: number, seed: number) {
  const positions: number[] = [], colors: number[] = [], uvs: number[] = [], indices: number[] = [];
  const segments = 64, rings = 8;
  for (let ring = 0; ring <= rings; ring++) {
    const fraction = ring / rings;
    for (let segment = 0; segment <= segments; segment++) {
      const angle = segment / segments * Math.PI * 2;
      const edge = 1 + Math.sin(angle * 5 + seed) * 0.055 + Math.cos(angle * 9 - seed) * 0.025;
      const x = Math.cos(angle) * width * fraction * edge;
      const z = Math.sin(angle) * depth * fraction * edge;
      positions.push(x, 0, z);
      uvs.push(x / 4, z / 4);
      const shade = 0.86 + mapRandom(seed, ring, segment % segments) * 0.14;
      const alpha = 1 - THREE.MathUtils.smoothstep(fraction, 0.55, 1);
      colors.push(shade, shade, shade, alpha);
      if (ring < rings && segment < segments) {
        const a = ring * (segments + 1) + segment, b = a + segments + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function weatheredRock(seed: number, material: THREE.Material) {
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const positions = geometry.getAttribute('position');
  const colors: number[] = [];
  const tint = new THREE.Color();
  for (let vertex = 0; vertex < positions.count; vertex++) {
    const x = positions.getX(vertex), y = positions.getY(vertex), z = positions.getZ(vertex);
    const variation = mapRandom(seed, x, y, z);
    const bulge = 0.83 + variation * 0.23;
    positions.setXYZ(vertex, x * bulge, Math.max(-0.48, y * bulge), z * bulge);
    tint.set(y > 0.3 && variation > 0.42 ? '#707b50' : '#898b79');
    tint.multiplyScalar(0.75 + variation * 0.3);
    colors.push(tint.r, tint.g, tint.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

const flameVertex = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const flameFragment = `
  uniform float time;
  uniform float phase;
  varying vec2 vUv;
  void main() {
    float y = vUv.y;
    float sway = sin(y * 9.0 - time * 5.4 + phase) * 0.08 * y
      + sin(y * 19.0 - time * 7.8 + phase) * 0.035 * y;
    float x = abs(vUv.x - 0.5 - sway);
    float width = (0.43 * pow(1.0 - y, 0.72))
      * (0.91 + 0.09 * sin(time * 8.0 + y * 13.0 + phase));
    float body = 1.0 - smoothstep(width * 0.5, width, x);
    float alpha = body * smoothstep(0.0, 0.09, y) * (1.0 - smoothstep(0.8, 1.0, y));
    float core = (1.0 - smoothstep(0.0, width * 0.7, x)) * (1.0 - y);
    vec3 color = mix(vec3(1.0, 0.17, 0.015), vec3(1.0, 0.82, 0.24), core);
    gl_FragColor = vec4(color, alpha * 0.87);
  }
`;

export function buildJungleCamps(textures: DawnreachTextures) {
  const root = new THREE.Group();
  root.name = 'jungle-camps';
  const paths = DAWNREACH_LAYOUT.junglePaths.flatMap(sampleMapPath);
  const time = { value: 0 };
  const dirt = new THREE.MeshStandardMaterial({
    map: textures.lane, color: 0xb79a6f, vertexColors: true, roughness: 1,
    transparent: true, depthWrite: false,
  });
  const rockMaterial = new THREE.MeshStandardMaterial({
    map: textures.stone, vertexColors: true, roughness: 0.96, flatShading: true,
  });
  const bark = new THREE.MeshStandardMaterial({ map: textures.bark, color: 0x443226, roughness: 1 });
  const cutWood = new THREE.MeshStandardMaterial({ color: 0x97724a, roughness: 1 });
  const coals = new THREE.MeshStandardMaterial({ color: 0x4b1c0b, emissive: 0xff4808, emissiveIntensity: 1.4, roughness: 1 });
  const flameGeometry = new THREE.PlaneGeometry(0.9, 1.35).translate(0, 0.675, 0);
  const glowMaterial = new THREE.ShaderMaterial({
    uniforms: { time }, vertexShader: flameVertex,
    fragmentShader: `uniform float time; varying vec2 vUv;
      void main() { float r = length(vUv - 0.5) * 2.0;
        float a = pow(max(0.0, 1.0 - r), 2.0) * (0.28 + 0.035 * sin(time * 7.0));
        gl_FragColor = vec4(1.0, 0.32, 0.035, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const emberMaterial = new THREE.ShaderMaterial({
    uniforms: { time },
    vertexShader: `uniform float time; attribute float seed; varying float life;
      void main() { life = fract(time * (0.24 + seed * 0.09) + seed);
        vec3 p = position;
        p.x += sin(life * 6.0 + seed * 40.0) * life * 0.3;
        p.z += cos(life * 5.0 + seed * 25.0) * life * 0.22;
        p.y += life * 1.65;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = 2.8 * (1.0 - life * 0.65); }`,
    fragmentShader: `varying float life;
      void main() { float a = (1.0 - smoothstep(0.15, 0.5, length(gl_PointCoord - 0.5)))
        * sin(life * 3.14159);
        gl_FragColor = vec4(1.0, 0.55, 0.08, a); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });

  DAWNREACH_LAYOUT.camps.forEach(([x, z], index) => {
    const camp = new THREE.Group();
    camp.name = `jungle-camp-${index}`;
    camp.position.set(x, 0, z);
    const nearest = paths.reduce((a, b) => Math.hypot(a.x - x, a.z - z) < Math.hypot(b.x - x, b.z - z) ? a : b);
    camp.rotation.y = Math.atan2(nearest.x - x, nearest.z - z);
    // Local +Z is the open entrance. Reserve four clear monster positions around the hearth.
    camp.userData.clearingRadius = CAMP_LAYOUT.radius;
    camp.userData.authoredEntrance = true;
    camp.userData.spawnPoints = [[-1.1, 0, -1.05], [1.1, 0, -1.05], [-1.1, 0, 1.15], [1.1, 0, 1.15]];
    const floor = new THREE.Mesh(groundPatch(CAMP_LAYOUT.radius + 0.4, CAMP_LAYOUT.radius + 0.4, index), dirt);
    floor.name = 'camp-clearing';
    floor.position.y = 0.027;
    floor.renderOrder = 1;
    floor.receiveShadow = true;
    floor.userData.commandSurface = true;
    camp.add(floor);
    const distance = Math.hypot(nearest.x - x, nearest.z - z);
    const approach = new THREE.Mesh(groundPatch(1.25, distance / 2 + 0.5, index + 30), dirt);
    approach.position.set(0, 0.024, distance / 2);
    approach.renderOrder = 1;
    approach.receiveShadow = true;
    camp.add(approach);

    // Broken clusters at the back and sides leave the entrance and interior open.
    for (let cluster = 0; cluster < 5; cluster++) {
      const angle = [1.02, 1.92, 3.18, 4.22, 5.16][cluster];
      const radius = 2.9 + mapRandom(index, cluster) * 0.18;
      for (let part = 0; part < 2; part++) {
        const rock = weatheredRock(index * 29 + cluster * 3 + part, rockMaterial);
        rock.userData.collisionRock = part === 0;
        const size = part === 0 ? 0.48 + mapRandom(index, cluster, 4) * 0.23 : 0.22;
        rock.scale.set(size * 1.22, size * (cluster === 2 ? 1.5 : 0.95), size);
        rock.rotation.y = angle + mapRandom(index, part, cluster) * 2;
        rock.position.set(Math.sin(angle) * radius + Math.cos(angle) * part * 0.63,
          size * 0.4, Math.cos(angle) * radius - Math.sin(angle) * part * 0.63);
        camp.add(rock);
      }
    }

    const ashMaterial = dirt.clone();
    ashMaterial.color.set(0x4a3c31);
    const ash = new THREE.Mesh(groundPatch(0.95, 0.85, index + 70), ashMaterial);
    ash.position.y = 0.035;
    ash.renderOrder = 2;
    camp.add(ash);
    for (let stone = 0; stone < 11; stone++) {
      const angle = stone / 11 * Math.PI * 2;
      const rock = weatheredRock(index * 37 + stone, rockMaterial);
      rock.scale.set(0.19, 0.13, 0.16);
      rock.position.set(Math.sin(angle) * 0.64, 0.08, Math.cos(angle) * 0.64);
      rock.rotation.y = angle;
      camp.add(rock);
    }
    for (let log = 0; log < 3; log++) {
      const wood = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 1.02, 9), [bark, cutWood, cutWood]);
      wood.rotation.set(Math.PI / 2, 0, log * Math.PI / 3);
      wood.position.y = 0.15 + log * 0.065;
      wood.castShadow = true;
      camp.add(wood);
    }
    for (let coal = 0; coal < 9; coal++) {
      const ember = new THREE.Mesh(new THREE.IcosahedronGeometry(0.085, 0), coals);
      ember.position.set((mapRandom(index, coal) - 0.5) * 0.7, 0.11, (mapRandom(index, coal, 1) - 0.5) * 0.7);
      ember.scale.y = 0.55;
      camp.add(ember);
    }
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 3.1).rotateX(-Math.PI / 2), glowMaterial);
    glow.position.y = 0.045;
    glow.renderOrder = 3;
    camp.add(glow);
    for (let sheet = 0; sheet < 3; sheet++) {
      const material = new THREE.ShaderMaterial({
        uniforms: { time, phase: { value: index * 1.7 + sheet * 2.1 } },
        vertexShader: flameVertex, fragmentShader: flameFragment,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const flame = new THREE.Mesh(flameGeometry, material);
      flame.name = 'campfire-flame';
      flame.rotation.y = sheet * Math.PI / 3;
      flame.position.y = 0.15;
      flame.renderOrder = 4;
      camp.add(flame);
    }
    const emberGeometry = new THREE.BufferGeometry();
    const positions = [], seeds = [];
    for (let ember = 0; ember < 14; ember++) {
      positions.push((mapRandom(index, ember, 5) - 0.5) * 0.6, 0.35, (mapRandom(index, ember, 6) - 0.5) * 0.6);
      seeds.push(mapRandom(index, ember, 7));
    }
    emberGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    emberGeometry.setAttribute('seed', new THREE.Float32BufferAttribute(seeds, 1));
    emberGeometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 2);
    const embers = new THREE.Points(emberGeometry, emberMaterial);
    embers.name = 'campfire-embers';
    embers.renderOrder = 4;
    camp.add(embers);
    root.add(camp);
  });
  root.userData.animate = (elapsed: number) => { time.value = elapsed; };
  return root;
}
