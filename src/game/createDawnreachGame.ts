import * as THREE from 'three';

type Point3 = { x: number; z: number };

type HeroRig = {
  root: THREE.Group;
  model: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  cape: THREE.Group;
  sword: THREE.Group;
};

type DawnreachMaterials = {
  steel: THREE.MeshStandardMaterial;
  steelDark: THREE.MeshStandardMaterial;
  gold: THREE.MeshStandardMaterial;
  blue: THREE.MeshStandardMaterial;
  blueDark: THREE.MeshStandardMaterial;
  leather: THREE.MeshStandardMaterial;
  chain: THREE.MeshStandardMaterial;
  visor: THREE.MeshStandardMaterial;
  skin: THREE.MeshStandardMaterial;
};

const HERO_SPEED = 5.2;
const VIEW_HEIGHT = 18;

export async function createDawnreachGame(host: HTMLDivElement) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a2820);
  scene.fog = new THREE.Fog(0x1a2820, 22, 42);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
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
  const materials = createHeroMaterials(textures);

  const arena = buildArena(textures);
  scene.add(arena);

  const hero = buildAlden(materials);
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
      const step = HERO_SPEED * dt;

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

    animateHero(hero, elapsed, moving);

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
      if (renderer.domElement.parentElement === host) {
        host.removeChild(renderer.domElement);
      }
    },
  };
}

function addLighting(scene: THREE.Scene) {
  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x31402b, 1.45);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff0cc, 3.6);
  sun.position.set(-8, 16, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -18;
  sun.shadow.camera.right = 18;
  sun.shadow.camera.top = 18;
  sun.shadow.camera.bottom = -18;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 45;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x6f91ff, 0.75);
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

    steel: makeCanvasTexture(128, (ctx, size) => {
      const gradient = ctx.createLinearGradient(0, 0, size, 0);
      gradient.addColorStop(0, '#727d86');
      gradient.addColorStop(0.28, '#e8edf0');
      gradient.addColorStop(0.48, '#99a4ab');
      gradient.addColorStop(0.72, '#f0f4f6');
      gradient.addColorStop(1, '#667078');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
      for (let i = 0; i < 160; i += 1) {
        const y = Math.random() * size;
        ctx.strokeStyle = `rgba(255,255,255,${Math.random() * 0.10})`;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y + (Math.random() - 0.5) * 2);
        ctx.stroke();
      }
    }, 2, 2),

    gold: makeCanvasTexture(128, (ctx, size) => {
      const gradient = ctx.createLinearGradient(0, 0, size, size);
      gradient.addColorStop(0, '#a77121');
      gradient.addColorStop(0.32, '#f6d77b');
      gradient.addColorStop(0.55, '#c99334');
      gradient.addColorStop(0.82, '#ffe59b');
      gradient.addColorStop(1, '#8f611e');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
    }, 2, 2),

    cloth: makeCanvasTexture(128, (ctx, size) => {
      ctx.fillStyle = '#2457a1';
      ctx.fillRect(0, 0, size, size);
      for (let x = 0; x < size; x += 4) {
        ctx.strokeStyle = x % 8 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.035)';
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, size);
        ctx.stroke();
      }
      for (let y = 0; y < size; y += 5) {
        ctx.strokeStyle = 'rgba(255,255,255,0.018)';
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(size, y);
        ctx.stroke();
      }
    }, 3, 3),

    leather: makeCanvasTexture(128, (ctx, size) => {
      ctx.fillStyle = '#664426';
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

function createHeroMaterials(textures: ReturnType<typeof createProceduralTextures>): DawnreachMaterials {
  return {
    steel: new THREE.MeshStandardMaterial({ map: textures.steel, metalness: 0.72, roughness: 0.28 }),
    steelDark: new THREE.MeshStandardMaterial({ color: 0x49515a, metalness: 0.6, roughness: 0.38 }),
    gold: new THREE.MeshStandardMaterial({ map: textures.gold, metalness: 0.72, roughness: 0.24 }),
    blue: new THREE.MeshStandardMaterial({ map: textures.cloth, color: 0xffffff, roughness: 0.82 }),
    blueDark: new THREE.MeshStandardMaterial({ color: 0x163b73, roughness: 0.86 }),
    leather: new THREE.MeshStandardMaterial({ map: textures.leather, roughness: 0.9 }),
    chain: new THREE.MeshStandardMaterial({ map: textures.chain, metalness: 0.35, roughness: 0.62 }),
    visor: new THREE.MeshStandardMaterial({ color: 0x100e0b, metalness: 0.1, roughness: 0.35 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xd9b991, roughness: 0.82 }),
  };
}

function buildArena(textures: ReturnType<typeof createProceduralTextures>) {
  const arena = new THREE.Group();

  const groundMat = new THREE.MeshStandardMaterial({ map: textures.grass, roughness: 1 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(42, 32), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  arena.add(ground);

  const laneMat = new THREE.MeshStandardMaterial({ map: textures.lane, roughness: 0.95 });
  const lane = new THREE.Mesh(new THREE.PlaneGeometry(34, 5.8), laneMat);
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
  const crownC = new THREE.Mesh(new THREE.DodecahedronGeometry(0.67, 1), new THREE.MeshStandardMaterial({ color: 0x356141, roughness: 1 }));
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

function buildAlden(materials: DawnreachMaterials): HeroRig {
  const root = new THREE.Group();
  const model = new THREE.Group();
  root.add(model);

  const selection = new THREE.Mesh(
    new THREE.RingGeometry(0.62, 0.72, 64),
    new THREE.MeshBasicMaterial({ color: 0x63f0c2, transparent: true, opacity: 0.95, side: THREE.DoubleSide }),
  );
  selection.rotation.x = -Math.PI / 2;
  selection.position.y = 0.025;
  root.add(selection);

  const label = buildHeroLabel();
  label.position.set(0, 3.15, 0);
  root.add(label);

  const leftLeg = buildLeg(materials, -0.21);
  const rightLeg = buildLeg(materials, 0.21);
  model.add(leftLeg, rightLeg);

  const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.39, 0.35, 10), materials.chain);
  hips.position.y = 1.1;
  hips.castShadow = true;
  model.add(hips);

  const torso = new THREE.Group();
  torso.position.y = 1.63;
  model.add(torso);

  const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.53, 0.9, 10), materials.steelDark);
  chest.scale.z = 0.72;
  chest.castShadow = true;
  torso.add(chest);

  const chestCloth = new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.69, 0.055), materials.blue);
  chestCloth.position.set(0, -0.02, 0.355);
  chestCloth.castShadow = true;
  torso.add(chestCloth);

  const goldVertical = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.68, 0.065), materials.gold);
  goldVertical.position.set(0, -0.02, 0.39);
  torso.add(goldVertical);

  const waistBelt = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.14, 0.16), materials.leather);
  waistBelt.position.set(0, -0.47, 0.1);
  waistBelt.castShadow = true;
  torso.add(waistBelt);

  const buckle = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.055, 20), materials.gold);
  buckle.rotation.x = Math.PI / 2;
  buckle.position.set(0, -0.47, 0.42);
  torso.add(buckle);

  addShoulder(torso, materials, -0.56);
  addShoulder(torso, materials, 0.56);

  const leftArm = buildArm(materials, -0.57, false);
  const rightArm = buildArm(materials, 0.57, true);
  torso.add(leftArm, rightArm);

  const cape = buildCape(materials);
  torso.add(cape);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.18, 10), materials.chain);
  neck.position.y = 0.56;
  torso.add(neck);

  const head = buildHelmet(materials);
  head.position.y = 0.91;
  torso.add(head);

  const sword = buildSword(materials);
  sword.position.set(0.03, -0.86, 0.04);
  sword.rotation.set(-0.06, 0, -0.56);
  rightArm.add(sword);

  model.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  return { root, model, leftLeg, rightLeg, leftArm, rightArm, cape, sword };
}

function buildLeg(materials: DawnreachMaterials, x: number) {
  const pivot = new THREE.Group();
  pivot.position.set(x, 1.05, 0);

  const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.55, 10), materials.chain);
  thigh.position.y = -0.27;
  pivot.add(thigh);

  const knee = new THREE.Mesh(new THREE.SphereGeometry(0.18, 14, 10), materials.steel);
  knee.scale.set(1.05, 0.82, 1.12);
  knee.position.y = -0.57;
  pivot.add(knee);

  const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.18, 0.52, 10), materials.steel);
  shin.position.y = -0.83;
  pivot.add(shin);

  const goldBand = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 6, 18), materials.gold);
  goldBand.rotation.x = Math.PI / 2;
  goldBand.position.y = -0.67;
  pivot.add(goldBand);

  const boot = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 10), materials.leather);
  boot.scale.set(0.9, 0.55, 1.4);
  boot.position.set(0, -1.11, 0.1);
  pivot.add(boot);

  return pivot;
}

function buildArm(materials: DawnreachMaterials, x: number, swordArm: boolean) {
  const pivot = new THREE.Group();
  pivot.position.set(x, 0.28, 0);

  const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.52, 10), materials.chain);
  upper.position.y = -0.25;
  pivot.add(upper);

  const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 8), materials.steel);
  elbow.position.y = -0.52;
  pivot.add(elbow);

  const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.145, 0.48, 10), materials.steel);
  forearm.position.y = -0.75;
  pivot.add(forearm);

  const glove = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), materials.leather);
  glove.scale.y = 0.9;
  glove.position.y = -1.02;
  pivot.add(glove);

  pivot.rotation.z = x < 0 ? 0.08 : -0.08;
  if (swordArm) pivot.rotation.x = -0.12;
  return pivot;
}

function addShoulder(torso: THREE.Group, materials: DawnreachMaterials, x: number) {
  const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.31, 16, 10), materials.steel);
  pauldron.scale.set(1.25, 0.62, 1.0);
  pauldron.position.set(x, 0.3, 0);
  torso.add(pauldron);

  const trim = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.035, 7, 18, Math.PI), materials.gold);
  trim.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  trim.position.set(x, 0.31, 0.02);
  torso.add(trim);
}

function buildHelmet(materials: DawnreachMaterials) {
  const group = new THREE.Group();

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.34, 18, 14), materials.steel);
  helmet.scale.set(0.92, 1.12, 0.93);
  group.add(helmet);

  const facePlate = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.36, 0.09), materials.steel);
  facePlate.position.set(0, -0.06, 0.292);
  facePlate.rotation.x = -0.06;
  group.add(facePlate);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.045, 0.025), materials.visor);
  visor.position.set(0, 0.02, 0.35);
  group.add(visor);

  const visorVertical = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.25, 0.026), materials.visor);
  visorVertical.position.set(0, -0.09, 0.352);
  group.add(visorVertical);

  const crest = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.58, 4), materials.gold);
  crest.position.y = 0.48;
  crest.scale.z = 0.55;
  group.add(crest);

  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.055, 0.06), materials.gold);
  brow.position.set(0, 0.11, 0.33);
  group.add(brow);

  return group;
}

function buildCape(materials: DawnreachMaterials) {
  const group = new THREE.Group();
  group.position.set(0, 0.08, -0.39);
  group.rotation.x = 0.10;

  const geometry = new THREE.PlaneGeometry(1.08, 1.65, 4, 6);
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const normalized = (y + 0.825) / 1.65;
    const curve = (1 - normalized) * 0.16;
    pos.setZ(i, -curve - Math.abs(x) * 0.04);
  }
  geometry.computeVertexNormals();

  const capeMesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      map: materials.blue.map,
      color: 0xffffff,
      roughness: 0.88,
      side: THREE.DoubleSide,
    }),
  );
  capeMesh.position.y = -0.35;
  group.add(capeMesh);

  const trimLeft = new THREE.Mesh(new THREE.BoxGeometry(0.045, 1.5, 0.025), materials.gold);
  const trimRight = trimLeft.clone();
  trimLeft.position.set(-0.49, -0.35, 0.005);
  trimRight.position.set(0.49, -0.35, 0.005);
  group.add(trimLeft, trimRight);

  const emblemShape = new THREE.Shape();
  emblemShape.moveTo(0, 0.26);
  emblemShape.lineTo(0.11, 0.03);
  emblemShape.lineTo(0.05, -0.02);
  emblemShape.lineTo(0, -0.22);
  emblemShape.lineTo(-0.05, -0.02);
  emblemShape.lineTo(-0.11, 0.03);
  emblemShape.closePath();
  const emblem = new THREE.Mesh(new THREE.ShapeGeometry(emblemShape), materials.gold);
  emblem.position.set(0, -0.3, 0.018);
  emblem.rotation.y = Math.PI;
  emblem.scale.setScalar(1.3);
  group.add(emblem);

  return group;
}

function buildSword(materials: DawnreachMaterials) {
  const sword = new THREE.Group();

  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.11, 1.28, 0.055), materials.steel);
  blade.position.y = -0.74;
  sword.add(blade);

  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.078, 0.28, 4), materials.steel);
  tip.position.y = -1.52;
  tip.rotation.y = Math.PI / 4;
  sword.add(tip);

  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.09, 0.10), materials.gold);
  guard.position.y = -0.05;
  sword.add(guard);

  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.35, 10), materials.leather);
  grip.position.y = 0.17;
  sword.add(grip);

  const pommel = new THREE.Mesh(new THREE.OctahedronGeometry(0.11, 0), materials.gold);
  pommel.position.y = 0.39;
  sword.add(pommel);

  return sword;
}

function buildHeroLabel() {
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
  ctx.strokeText('Alden', 256, 39);
  ctx.fillStyle = '#f5f1e7';
  ctx.fillText('Alden', 256, 39);

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

function animateHero(rig: HeroRig, elapsed: number, moving: boolean) {
  if (moving) {
    const stride = Math.sin(elapsed * 10.5);
    const counter = Math.sin(elapsed * 10.5 + Math.PI);
    const bob = Math.abs(Math.sin(elapsed * 10.5)) * 0.055;

    rig.leftLeg.rotation.x = stride * 0.47;
    rig.rightLeg.rotation.x = counter * 0.47;
    rig.leftArm.rotation.x = counter * 0.25;
    rig.rightArm.rotation.x = stride * 0.18 - 0.12;
    rig.model.position.y = bob;
    rig.model.rotation.z = stride * 0.018;
    rig.cape.rotation.x = 0.13 + Math.abs(stride) * 0.07;
    rig.cape.rotation.z = stride * 0.025;
    rig.sword.rotation.z = -0.56 + stride * 0.07;
  } else {
    const breathe = Math.sin(elapsed * 2.25);
    rig.leftLeg.rotation.x *= 0.80;
    rig.rightLeg.rotation.x *= 0.80;
    rig.leftArm.rotation.x *= 0.82;
    rig.rightArm.rotation.x += (-0.12 - rig.rightArm.rotation.x) * 0.18;
    rig.model.position.y = breathe * 0.012;
    rig.model.rotation.z *= 0.85;
    rig.cape.rotation.x = 0.10 + Math.sin(elapsed * 1.7) * 0.018;
    rig.cape.rotation.z = Math.sin(elapsed * 1.4) * 0.01;
    rig.sword.rotation.z += (-0.56 - rig.sword.rotation.z) * 0.18;
  }
}

function disposeScene(scene: THREE.Scene) {
  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh || obj instanceof THREE.Sprite)) return;

    if (obj instanceof THREE.Mesh) obj.geometry.dispose();

    const material = obj.material;
    const disposeMaterial = (mat: THREE.Material) => {
      const withMap = mat as THREE.Material & { map?: THREE.Texture | null };
      withMap.map?.dispose();
      mat.dispose();
    };

    if (Array.isArray(material)) material.forEach(disposeMaterial);
    else disposeMaterial(material);
  });
}
