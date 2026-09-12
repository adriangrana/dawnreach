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
  const materials = createHeroMaterials(textures);
  scene.add(buildArena(textures));

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
    steel: new THREE.MeshStandardMaterial({ map: textures.steel, metalness: 0.72, roughness: 0.27 }),
    steelDark: new THREE.MeshStandardMaterial({ color: 0x46505a, metalness: 0.58, roughness: 0.4 }),
    gold: new THREE.MeshStandardMaterial({ map: textures.gold, metalness: 0.74, roughness: 0.23 }),
    blue: new THREE.MeshStandardMaterial({ map: textures.cloth, color: 0xffffff, roughness: 0.84 }),
    blueDark: new THREE.MeshStandardMaterial({ color: 0x15396e, roughness: 0.88 }),
    leather: new THREE.MeshStandardMaterial({ map: textures.leather, roughness: 0.92 }),
    chain: new THREE.MeshStandardMaterial({ map: textures.chain, metalness: 0.35, roughness: 0.62 }),
    visor: new THREE.MeshStandardMaterial({ color: 0x100e0b, metalness: 0.12, roughness: 0.34 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xd9b991, roughness: 0.82 }),
  };
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

function buildAlden(materials: DawnreachMaterials): HeroRig {
  const root = new THREE.Group();
  const model = new THREE.Group();
  root.add(model);

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

  const label = buildHeroLabel();
  label.position.set(0, 3.22, 0);
  root.add(label);

  const leftLeg = buildLeg(materials, -0.20);
  const rightLeg = buildLeg(materials, 0.20);
  model.add(leftLeg, rightLeg);

  const hips = new THREE.Mesh(
    new THREE.CylinderGeometry(0.31, 0.37, 0.34, 14),
    materials.chain,
  );
  hips.position.y = 1.08;
  model.add(hips);

  const torso = new THREE.Group();
  torso.position.y = 1.69;
  model.add(torso);

  const breastplateProfile = [
    new THREE.Vector2(0.20, -0.49),
    new THREE.Vector2(0.28, -0.34),
    new THREE.Vector2(0.35, -0.10),
    new THREE.Vector2(0.43, 0.17),
    new THREE.Vector2(0.40, 0.40),
  ];
  const chest = new THREE.Mesh(
    new THREE.LatheGeometry(breastplateProfile, 24),
    materials.steelDark,
  );
  chest.scale.z = 0.66;
  chest.castShadow = true;
  torso.add(chest);

  const tabardShape = new THREE.Shape();
  tabardShape.moveTo(-0.27, 0.31);
  tabardShape.quadraticCurveTo(-0.28, 0.10, -0.20, -0.43);
  tabardShape.lineTo(0.20, -0.43);
  tabardShape.quadraticCurveTo(0.28, 0.10, 0.27, 0.31);
  tabardShape.closePath();

  const tabard = new THREE.Mesh(
    new THREE.ExtrudeGeometry(tabardShape, {
      depth: 0.03,
      bevelEnabled: true,
      bevelSize: 0.012,
      bevelThickness: 0.01,
      bevelSegments: 2,
    }),
    materials.blue,
  );
  tabard.position.set(0, -0.01, 0.305);
  tabard.castShadow = true;
  torso.add(tabard);

  const leftTrim = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 0.71, 0.035),
    materials.gold,
  );
  leftTrim.position.set(-0.225, -0.04, 0.34);
  leftTrim.rotation.z = -0.07;

  const rightTrim = leftTrim.clone();
  rightTrim.position.x = 0.225;
  rightTrim.rotation.z = 0.07;

  torso.add(leftTrim, rightTrim);

  const emblemShape = new THREE.Shape();
  emblemShape.moveTo(0, 0.17);
  emblemShape.lineTo(0.055, 0.055);
  emblemShape.lineTo(0.022, 0.01);
  emblemShape.lineTo(0, -0.17);
  emblemShape.lineTo(-0.022, 0.01);
  emblemShape.lineTo(-0.055, 0.055);
  emblemShape.closePath();

  const chestEmblem = new THREE.Mesh(
    new THREE.ShapeGeometry(emblemShape),
    materials.gold,
  );
  chestEmblem.position.set(0, 0.02, 0.35);
  torso.add(chestEmblem);

  const collar = new THREE.Mesh(
    new THREE.TorusGeometry(0.28, 0.03, 8, 28, Math.PI),
    materials.gold,
  );
  collar.rotation.set(Math.PI / 2, 0, Math.PI);
  collar.position.set(0, 0.34, 0.10);
  collar.scale.z = 0.68;
  torso.add(collar);

  const waistBelt = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.34, 0.13, 20),
    materials.leather,
  );
  waistBelt.scale.z = 0.68;
  waistBelt.position.y = -0.47;
  torso.add(waistBelt);

  const buckle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.12, 0.05, 20),
    materials.gold,
  );
  buckle.rotation.x = Math.PI / 2;
  buckle.position.set(0, -0.47, 0.27);
  torso.add(buckle);

  addShoulder(torso, materials, -0.47);
  addShoulder(torso, materials, 0.47);

  const leftArm = buildArm(materials, -0.49, false);
  const rightArm = buildArm(materials, 0.49, true);
  torso.add(leftArm, rightArm);

  const cape = buildCape(materials);
  torso.add(cape);

  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.17, 0.18, 12),
    materials.chain,
  );
  neck.position.y = 0.56;
  torso.add(neck);

  const head = buildHelmet(materials);
  head.position.y = 0.92;
  torso.add(head);

  const sword = buildSword(materials);
  sword.position.set(0.03, -1.00, 0.01);
  sword.rotation.set(0.04, 0.10, -0.58);
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

  const thigh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.155, 0.56, 12),
    materials.chain,
  );
  thigh.position.y = -0.27;
  pivot.add(thigh);

  const knee = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 14, 10),
    materials.steel,
  );
  knee.scale.set(1.0, 0.82, 1.08);
  knee.position.y = -0.57;
  pivot.add(knee);

  const shin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.16, 0.56, 12),
    materials.steel,
  );
  shin.position.y = -0.86;
  pivot.add(shin);

  const goldBand = new THREE.Mesh(
    new THREE.TorusGeometry(0.145, 0.022, 8, 18),
    materials.gold,
  );
  goldBand.rotation.x = Math.PI / 2;
  goldBand.position.y = -0.69;
  pivot.add(goldBand);

  const boot = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.20, 0.44),
    materials.leather,
  );
  boot.position.set(0, -1.16, 0.11);
  boot.geometry.translate(0, 0, 0.06);
  pivot.add(boot);

  const toe = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 14, 10),
    materials.leather,
  );
  toe.scale.set(1.1, 0.72, 1.55);
  toe.position.set(0, -1.15, 0.26);
  pivot.add(toe);

  return pivot;
}

function buildArm(materials: DawnreachMaterials, x: number, swordArm: boolean) {
  const pivot = new THREE.Group();
  pivot.position.set(x, 0.28, 0);

  const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.145, 0.51, 12), materials.chain);
  upper.position.y = -0.25;
  pivot.add(upper);

  const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.135, 12, 8), materials.steel);
  elbow.position.y = -0.52;
  pivot.add(elbow);

  const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.14, 0.47, 12), materials.steel);
  forearm.position.y = -0.75;
  pivot.add(forearm);

  const glove = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), materials.leather);
  glove.scale.set(0.92, 0.9, 1.08);
  glove.position.y = -1.02;
  pivot.add(glove);

  pivot.rotation.z = x < 0 ? 0.08 : -0.08;
  if (swordArm) pivot.rotation.x = -0.08;
  return pivot;
}

function addShoulder(torso: THREE.Group, materials: DawnreachMaterials, x: number) {
  const pauldron = new THREE.Mesh(
    new THREE.SphereGeometry(0.24, 18, 12),
    materials.steel,
  );
  pauldron.scale.set(1.24, 0.58, 0.96);
  pauldron.position.set(x, 0.25, 0.0);
  torso.add(pauldron);

  const trim = new THREE.Mesh(
    new THREE.TorusGeometry(0.185, 0.028, 8, 20, Math.PI),
    materials.gold,
  );
  trim.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  trim.position.set(x, 0.26, 0.015);
  torso.add(trim);
}

function buildHelmet(materials: DawnreachMaterials) {
  const group = new THREE.Group();

  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 16), materials.steel);
  helmet.scale.set(0.92, 1.12, 0.93);
  group.add(helmet);

  const facePlateShape = new THREE.Shape();
  facePlateShape.moveTo(-0.23, 0.15);
  facePlateShape.lineTo(0.23, 0.15);
  facePlateShape.lineTo(0.20, -0.15);
  facePlateShape.lineTo(0, -0.24);
  facePlateShape.lineTo(-0.20, -0.15);
  facePlateShape.closePath();
  const facePlate = new THREE.Mesh(
    new THREE.ExtrudeGeometry(facePlateShape, { depth: 0.065, bevelEnabled: true, bevelSize: 0.012, bevelThickness: 0.01, bevelSegments: 2 }),
    materials.steel,
  );
  facePlate.position.set(0, -0.04, 0.285);
  group.add(facePlate);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.31, 0.045, 0.025), materials.visor);
  visor.position.set(0, 0.02, 0.36);
  group.add(visor);

  const visorVertical = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.25, 0.026), materials.visor);
  visorVertical.position.set(0, -0.09, 0.362);
  group.add(visorVertical);

  const crest = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.58, 4), materials.gold);
  crest.position.y = 0.48;
  crest.scale.z = 0.55;
  group.add(crest);

  const brow = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.055, 0.06), materials.gold);
  brow.position.set(0, 0.11, 0.34);
  group.add(brow);
  return group;
}

function buildCape(materials: DawnreachMaterials) {
  const group = new THREE.Group();
  group.position.set(0, 0.18, -0.31);
  group.rotation.x = 0.10;

  const width = 1.34;
  const height = 1.92;
  const geometry = new THREE.PlaneGeometry(width, height, 12, 14);
  const pos = geometry.attributes.position as THREE.BufferAttribute;

  for (let i = 0; i < pos.count; i += 1) {
    const x = pos.getX(i);
    const y = pos.getY(i);

    const t = (y + height / 2) / height; // 0 abajo, 1 arriba
    const n = x / (width / 2);

    const widthFactor = 0.74 + (1 - t) * 0.38;
    const shapedX = x * widthFactor;

    const topPinch = t * 0.12;
    const sideCurve = Math.pow(Math.abs(n), 1.7) * (1 - t) * 0.15;
    const bottomDip = (1 - t) * 0.08;
    const hemWave = Math.cos(n * Math.PI * 2.4) * (1 - t) * 0.03;

    const shapedY = y + sideCurve - bottomDip + hemWave + topPinch;
    const drape = -(1 - t) * 0.24 - Math.abs(n) * 0.05;
    const fold = Math.sin(n * Math.PI * 3.0) * 0.04 * (1 - t * 0.25);

    pos.setXYZ(i, shapedX, shapedY, drape + fold);
  }

  geometry.computeVertexNormals();

  const capeMat = new THREE.MeshStandardMaterial({
    map: materials.blue.map,
    color: 0xffffff,
    roughness: 0.92,
    side: THREE.DoubleSide,
  });

  const capeMesh = new THREE.Mesh(geometry, capeMat);
  capeMesh.position.y = -0.60;
  group.add(capeMesh);

  const edgeLeft = new THREE.Mesh(
    new THREE.BoxGeometry(0.035, 1.58, 0.02),
    materials.gold,
  );
  edgeLeft.position.set(-0.47, -0.58, -0.01);
  edgeLeft.rotation.z = -0.10;

  const edgeRight = edgeLeft.clone();
  edgeRight.position.x = 0.47;
  edgeRight.rotation.z = 0.10;

  group.add(edgeLeft, edgeRight);

  const hem = new THREE.Mesh(
    new THREE.TorusGeometry(0.48, 0.018, 6, 30, Math.PI),
    materials.gold,
  );
  hem.rotation.set(Math.PI / 2, 0, Math.PI);
  hem.position.set(0, -1.53, -0.18);
  hem.scale.set(1.12, 1, 0.72);
  group.add(hem);

  const emblemShape = new THREE.Shape();
  emblemShape.moveTo(0, 0.26);
  emblemShape.lineTo(0.10, 0.05);
  emblemShape.lineTo(0.04, -0.02);
  emblemShape.lineTo(0, -0.22);
  emblemShape.lineTo(-0.04, -0.02);
  emblemShape.lineTo(-0.10, 0.05);
  emblemShape.closePath();

  const emblem = new THREE.Mesh(
    new THREE.ShapeGeometry(emblemShape),
    materials.gold,
  );
  emblem.position.set(0, -0.62, 0.02);
  emblem.rotation.y = Math.PI;
  emblem.scale.setScalar(1.24);
  group.add(emblem);

  return group;
}

function buildSword(materials: DawnreachMaterials) {
  const sword = new THREE.Group();

  // El origen queda en la empuñadura, donde la mano “agarra”.
  const grip = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.05, 0.34, 12),
    materials.leather,
  );
  grip.rotation.z = 0;
  grip.position.y = 0.00;
  sword.add(grip);

  const pommel = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.09, 0),
    materials.gold,
  );
  pommel.position.y = 0.22;
  sword.add(pommel);

  const guard = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.07, 0.09),
    materials.gold,
  );
  guard.position.y = -0.17;
  sword.add(guard);

  const ricasso = new THREE.Mesh(
    new THREE.BoxGeometry(0.085, 0.14, 0.05),
    materials.steel,
  );
  ricasso.position.y = -0.29;
  sword.add(ricasso);

  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 1.05, 0.045),
    materials.steel,
  );
  blade.position.y = -0.86;
  sword.add(blade);

  const fuller = new THREE.Mesh(
    new THREE.BoxGeometry(0.018, 0.76, 0.006),
    materials.steelDark,
  );
  fuller.position.set(0, -0.86, 0.021);
  sword.add(fuller);

  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(0.06, 0.22, 4),
    materials.steel,
  );
  tip.position.y = -1.49;
  tip.rotation.y = Math.PI / 4;
  sword.add(tip);

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
    const bob = Math.abs(Math.sin(elapsed * 10.5)) * 0.05;

    rig.leftLeg.rotation.x = stride * 0.46;
    rig.rightLeg.rotation.x = counter * 0.46;

    rig.leftArm.rotation.x = counter * 0.20;
    rig.rightArm.rotation.x = stride * 0.12 - 0.08;

    rig.model.position.y = bob;
    rig.model.rotation.z = stride * 0.012;

    rig.cape.rotation.x = 0.12 + Math.abs(stride) * 0.08;
    rig.cape.rotation.z = stride * 0.018;
    rig.cape.position.z = -0.31 - Math.abs(stride) * 0.02;

    rig.sword.rotation.z = -0.58 + stride * 0.04;
    rig.sword.rotation.x = 0.04 + Math.abs(stride) * 0.02;
  } else {
    const breathe = Math.sin(elapsed * 2.25);

    rig.leftLeg.rotation.x *= 0.80;
    rig.rightLeg.rotation.x *= 0.80;
    rig.leftArm.rotation.x *= 0.82;
    rig.rightArm.rotation.x += (-0.08 - rig.rightArm.rotation.x) * 0.16;

    rig.model.position.y = breathe * 0.012;
    rig.model.rotation.z *= 0.84;

    rig.cape.rotation.x = 0.10 + Math.sin(elapsed * 1.6) * 0.016;
    rig.cape.rotation.z = Math.sin(elapsed * 1.2) * 0.008;
    rig.cape.position.z += (-0.31 - rig.cape.position.z) * 0.12;

    rig.sword.rotation.z += (-0.58 - rig.sword.rotation.z) * 0.16;
    rig.sword.rotation.x += (0.04 - rig.sword.rotation.x) * 0.16;
  }
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
