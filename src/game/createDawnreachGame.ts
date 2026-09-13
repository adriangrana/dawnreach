import * as THREE from 'three';
import { buildAlden } from './heroes/alden/buildAlden';
import { createAldenMaterials } from './heroes/alden/materials';
import { animateAlden } from './heroes/alden/animateAlden';
import { buildHumanoidBody } from './characters/buildHumanoidBody';
import { HUMANOID_DEFAULT_MOVE_SPEED, animateHumanoid } from './characters/animateHumanoid';

type Point3 = { x: number; z: number };

const VIEW_HEIGHT = 18;

export async function createDawnreachGame(host: HTMLDivElement) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a2820);
  scene.fog = new THREE.Fog(0x1a2820, 23, 43);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.domElement.className = 'game-canvas';
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  host.appendChild(renderer.domElement);

  const camera = new THREE.OrthographicCamera(-10, 10, 9, -9, 0.1, 100);
  camera.position.set(10.5, 14, 12.5);
  camera.lookAt(0, 0, 0);

  addLighting(scene);

  const textures = createProceduralTextures();
  scene.add(buildArena(textures));

  const previewHumanoid = new URLSearchParams(window.location.search).get('rig') === 'humanoid';
  const alden = previewHumanoid ? null : buildAlden(createAldenMaterials());
  const hero = alden ?? buildHumanoidBody();
  addHeroOverlay(hero.root, alden ? 'Alden' : 'Humanoide');
  hero.root.position.set(0, 0.03, 1.2);
  scene.add(hero.root);

  const targetMarker = buildTargetMarker();
  targetMarker.visible = false;
  scene.add(targetMarker);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();

  let destination: Point3 | null = null;
  let targetYaw = 0;
  let currentYaw = 0;
  let elapsed = 0;
  let animationFrame = 0;

  const onContextMenu = (event: MouseEvent) => event.preventDefault();

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 2) return;

    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    if (!raycaster.ray.intersectPlane(groundPlane, hitPoint)) return;

    destination = { x: hitPoint.x, z: hitPoint.z };
    targetMarker.position.set(hitPoint.x, 0.035, hitPoint.z);
    targetMarker.visible = true;
  };

  renderer.domElement.addEventListener('contextmenu', onContextMenu);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);

  const resize = () => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    const aspect = width / height;
    const halfH = VIEW_HEIGHT / 2;
    const halfW = halfH * aspect;

    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  resize();

  const clock = new THREE.Clock();

  const animate = () => {
    animationFrame = requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;

    let moving = false;

    if (destination) {
      const dx = destination.x - hero.root.position.x;
      const dz = destination.z - hero.root.position.z;
      const distance = Math.hypot(dx, dz);
      const step = HUMANOID_DEFAULT_MOVE_SPEED * dt;

      if (distance <= Math.max(step, 0.035)) {
        hero.root.position.x = destination.x;
        hero.root.position.z = destination.z;
        destination = null;
        targetMarker.visible = false;
      } else {
        moving = true;
        const nx = dx / distance;
        const nz = dz / distance;
        hero.root.position.x += nx * step;
        hero.root.position.z += nz * step;
        targetYaw = Math.atan2(nx, nz);
      }
    }

    const yawDelta = Math.atan2(
      Math.sin(targetYaw - currentYaw),
      Math.cos(targetYaw - currentYaw),
    );
    currentYaw += yawDelta * Math.min(1, dt * 11);
    hero.model.rotation.y = currentYaw;

    if (alden) animateAlden(alden, elapsed, moving, dt, HUMANOID_DEFAULT_MOVE_SPEED);
    else animateHumanoid(hero, elapsed, moving, dt, HUMANOID_DEFAULT_MOVE_SPEED);

    if (targetMarker.visible) {
      const pulse = 1 + Math.sin(elapsed * 8) * 0.12;
      targetMarker.scale.setScalar(pulse);
      targetMarker.rotation.z += dt * 0.8;
    }

    renderer.render(scene, camera);
  };

  animate();

  return {
    destroy() {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      disposeScene(scene);
      renderer.dispose();
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
    },
  };
}

function addLighting(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x31402b, 1.45));

  const sun = new THREE.DirectionalLight(0xfff0cc, 3.6);
  sun.position.set(-8, 16, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.00012;
  sun.shadow.normalBias = 0.025;
  sun.shadow.camera.left = -18;
  sun.shadow.camera.right = 18;
  sun.shadow.camera.top = 18;
  sun.shadow.camera.bottom = -18;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 45;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x6f91ff, 0.72);
  fill.position.set(12, 7, -10);
  scene.add(fill);
}

function createProceduralTextures() {
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
    }, 5, 5),

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
    }, 4, 4),

  };
}

function makeCanvasTexture(
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

function buildArena(textures: ReturnType<typeof createProceduralTextures>) {
  const arena = new THREE.Group();

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(42, 32),
    new THREE.MeshStandardMaterial({ map: textures.grass, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  arena.add(ground);

  const lane = new THREE.Mesh(
    new THREE.PlaneGeometry(34, 5.8),
    new THREE.MeshStandardMaterial({ map: textures.lane, roughness: 0.95 }),
  );
  lane.rotation.x = -Math.PI / 2;
  lane.rotation.z = -0.29;
  lane.position.y = 0.018;
  lane.receiveShadow = true;
  arena.add(lane);

  const water = new THREE.Mesh(
    new THREE.CircleGeometry(5.2, 48),
    new THREE.MeshStandardMaterial({ color: 0x234f63, roughness: 0.25, metalness: 0.05, transparent: true, opacity: 0.93 }),
  );
  water.rotation.x = -Math.PI / 2;
  water.scale.y = 0.58;
  water.position.set(10, 0.03, -7.2);
  arena.add(water);

  const treePositions: Array<[number, number, number]> = [
    [-11.5, -5.6, 1.15], [-9.4, -6.4, 0.9], [-12.4, -3.8, 1.0],
    [10.8, 6.1, 1.25], [8.8, 6.6, 0.95], [12.6, 4.3, 1.05],
    [-12.8, 6.2, 1.0], [-10.6, 7.4, 0.9], [12.3, -3.7, 0.95],
  ];
  for (const [x, z, scale] of treePositions) arena.add(buildTree(x, z, scale));

  arena.add(buildPillar(-7.3, -2.8));
  arena.add(buildPillar(8.0, 2.7));
  return arena;
}

function buildTree(x: number, z: number, scale: number) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.scale.setScalar(scale);

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.25, 1.25, 8),
    new THREE.MeshStandardMaterial({ color: 0x513923, roughness: 1 }),
  );
  trunk.position.y = 0.63;
  trunk.castShadow = true;
  group.add(trunk);

  const foliageMat = new THREE.MeshStandardMaterial({ color: 0x285036, roughness: 1 });
  const crownA = new THREE.Mesh(new THREE.DodecahedronGeometry(0.9, 1), foliageMat);
  const crownB = new THREE.Mesh(new THREE.DodecahedronGeometry(0.75, 1), foliageMat);
  const crownC = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.67, 1),
    new THREE.MeshStandardMaterial({ color: 0x356141, roughness: 1 }),
  );
  crownA.position.set(0, 1.55, 0);
  crownB.position.set(-0.52, 1.45, 0.12);
  crownC.position.set(0.5, 1.5, -0.1);
  for (const crown of [crownA, crownB, crownC]) {
    crown.castShadow = true;
    crown.receiveShadow = true;
    group.add(crown);
  }

  return group;
}

function buildPillar(x: number, z: number) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x77786f, roughness: 0.93 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.25, 0.85), stoneMat);
  base.position.y = 0.125;
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.5, 0.55), stoneMat);
  shaft.position.y = 1.0;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.22, 0.72), stoneMat);
  cap.position.y = 1.82;

  for (const part of [base, shaft, cap]) {
    part.castShadow = true;
    part.receiveShadow = true;
    group.add(part);
  }

  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.18, 0.55, 10),
    new THREE.MeshStandardMaterial({ color: 0xffb33b, emissive: 0xff7a10, emissiveIntensity: 2.2, roughness: 0.4 }),
  );
  flame.position.y = 2.17;
  group.add(flame);

  const point = new THREE.PointLight(0xff9b33, 8, 5, 2);
  point.position.y = 2.1;
  group.add(point);
  return group;
}

function addHeroOverlay(root: THREE.Group, name: string) {
  const selection = new THREE.Mesh(
    new THREE.RingGeometry(0.62, 0.72, 64),
    new THREE.MeshBasicMaterial({
      color: 0x63f0c2,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide,
    }),
  );
  selection.rotation.x = -Math.PI / 2;
  selection.position.y = 0.025;
  root.add(selection);

  const label = buildHeroLabel(name);
  label.position.set(0, 3.57, 0);
  root.add(label);
}

function buildHeroLabel(name: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 34px Arial';
  ctx.textAlign = 'center';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(10,14,12,0.9)';
  ctx.strokeText(name, 256, 39);
  ctx.fillStyle = '#f5f1e7';
  ctx.fillText(name, 256, 39);

  ctx.fillStyle = 'rgba(8,15,13,0.96)';
  ctx.fillRect(90, 57, 332, 38);
  ctx.fillStyle = '#49ce61';
  ctx.fillRect(98, 65, 316, 22);
  ctx.strokeStyle = '#0a0f0d';
  ctx.lineWidth = 5;
  ctx.strokeRect(90, 57, 332, 38);

  ctx.fillStyle = '#0d1519';
  ctx.fillRect(42, 56, 40, 40);
  ctx.strokeStyle = '#70818c';
  ctx.lineWidth = 3;
  ctx.strokeRect(42, 56, 40, 40);
  ctx.font = 'bold 24px Arial';
  ctx.fillStyle = '#ffffff';
  ctx.fillText('1', 62, 84);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(3.3, 0.82, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function buildTargetMarker() {
  const group = new THREE.Group();

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.28, 0.38, 40),
    new THREE.MeshBasicMaterial({ color: 0x79ff71, transparent: true, opacity: 0.95, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  group.add(ring);

  const inner = new THREE.Mesh(
    new THREE.CircleGeometry(0.07, 24),
    new THREE.MeshBasicMaterial({ color: 0xc3ffab, transparent: true, opacity: 0.82, side: THREE.DoubleSide }),
  );
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = 0.003;
  group.add(inner);
  return group;
}

function disposeScene(scene: THREE.Scene) {
  const disposedTextures = new Set<THREE.Texture>();
  const disposedMaterials = new Set<THREE.Material>();

  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh || obj instanceof THREE.Sprite)) return;
    if (obj instanceof THREE.Mesh) obj.geometry.dispose();

    const material = obj.material;
    const disposeMaterial = (mat: THREE.Material) => {
      if (disposedMaterials.has(mat)) return;
      disposedMaterials.add(mat);
      const withMap = mat as THREE.Material & { map?: THREE.Texture | null };
      if (withMap.map && !disposedTextures.has(withMap.map)) {
        disposedTextures.add(withMap.map);
        withMap.map.dispose();
      }
      mat.dispose();
    };

    if (Array.isArray(material)) material.forEach(disposeMaterial);
    else disposeMaterial(material);
  });
}
