import * as THREE from 'three';
import { animateHumanoid, HUMANOID_DEFAULT_MOVE_SPEED } from './characters/animateHumanoid';
import { buildHumanoidBody } from './characters/buildHumanoidBody';
import { animateAlden } from './heroes/alden/animateAlden';
import { buildAlden } from './heroes/alden/buildAlden';
import { createAldenMaterials } from './heroes/alden/materials';
import { buildDawnreachMap } from './map/buildDawnreachMap';
import { DAWNREACH_LAYOUT, MAP_BOUNDS } from './map/mapLayout';
import { createProceduralTextures } from './shared/textures';

type Point3 = { x: number; z: number };

const VIEW_HEIGHT = 18;
const MAP_EDGE_PADDING = 1.25;
const CAMERA_OFFSET = new THREE.Vector3(10.5, 14, 12.5);
const MINIMAP_PADDING = 1.06;
const MINIMAP_CAMERA_HEIGHT = 90;
const GAME_HERO_SCALE = 0.68;
const GAME_MOVE_SPEED = HUMANOID_DEFAULT_MOVE_SPEED * GAME_HERO_SCALE;

export async function createDawnreachGame(
  host: HTMLDivElement,
  minimapHost?: HTMLDivElement | null,
  minimapHeroMarker?: HTMLImageElement | null,
) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x17261f);
  scene.fog = new THREE.Fog(0x17261f, 25, 50);

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

  const camera = new THREE.OrthographicCamera(-10, 10, 9, -9, 0.1, 120);

  const minimapRenderer = minimapHost
    ? new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'low-power' })
    : null;
  const minimapCamera = minimapRenderer
    ? new THREE.OrthographicCamera(-48, 48, 48, -48, 0.1, 180)
    : null;

  if (minimapRenderer && minimapCamera && minimapHost) {
    minimapRenderer.setPixelRatio(1);
    minimapRenderer.shadowMap.enabled = false;
    minimapRenderer.outputColorSpace = THREE.SRGBColorSpace;
    minimapRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    minimapRenderer.toneMappingExposure = 1.08;
    minimapRenderer.domElement.className = 'minimap-canvas';
    minimapRenderer.domElement.style.display = 'block';
    minimapRenderer.domElement.style.width = '100%';
    minimapRenderer.domElement.style.height = '100%';
    minimapRenderer.domElement.style.pointerEvents = 'none';
    minimapHost.appendChild(minimapRenderer.domElement);

    minimapCamera.position.set(0, MINIMAP_CAMERA_HEIGHT, 0);
    minimapCamera.up.set(0, 0, -1);
    minimapCamera.lookAt(0, 0, 0);
    minimapCamera.updateMatrixWorld();
  }

  addLighting(scene);

  const textures = createProceduralTextures();
  const battlefield = buildDawnreachMap(textures);
  scene.add(battlefield);

  const previewHumanoid = new URLSearchParams(window.location.search).get('rig') === 'humanoid';
  const alden = previewHumanoid ? null : buildAlden(createAldenMaterials());
  const hero = alden ?? buildHumanoidBody();
  const heroPresentationScale = alden ? GAME_HERO_SCALE : 1;
  const heroMoveSpeed = alden ? GAME_MOVE_SPEED : HUMANOID_DEFAULT_MOVE_SPEED;

  hero.model.scale.setScalar(heroPresentationScale);
  addHeroOverlay(hero.root, alden ? 'Alden' : 'Humanoide', heroPresentationScale);
  hero.root.position.set(DAWNREACH_LAYOUT.blueSpawn.x, 0.03, DAWNREACH_LAYOUT.blueSpawn.z);
  scene.add(hero.root);

  const targetMarker = buildTargetMarker();
  targetMarker.visible = false;
  scene.add(targetMarker);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();
  const minimapHeroPosition = new THREE.Vector3();

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

    const x = THREE.MathUtils.clamp(
      hitPoint.x,
      MAP_BOUNDS.minX + MAP_EDGE_PADDING,
      MAP_BOUNDS.maxX - MAP_EDGE_PADDING,
    );
    const z = THREE.MathUtils.clamp(
      hitPoint.z,
      MAP_BOUNDS.minZ + MAP_EDGE_PADDING,
      MAP_BOUNDS.maxZ - MAP_EDGE_PADDING,
    );

    destination = { x, z };
    targetMarker.position.set(x, 0.055, z);
    targetMarker.visible = true;
  };

  renderer.domElement.addEventListener('contextmenu', onContextMenu);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);

  const resizeMinimap = () => {
    if (!minimapRenderer || !minimapCamera || !minimapHost) return;

    const width = Math.max(1, minimapHost.clientWidth);
    const height = Math.max(1, minimapHost.clientHeight);
    const viewportAspect = width / height;
    const mapWidth = MAP_BOUNDS.maxX - MAP_BOUNDS.minX;
    const mapHeight = MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ;
    const mapAspect = mapWidth / mapHeight;

    let halfWidth: number;
    let halfHeight: number;

    if (viewportAspect >= mapAspect) {
      halfHeight = (mapHeight / 2) * MINIMAP_PADDING;
      halfWidth = halfHeight * viewportAspect;
    } else {
      halfWidth = (mapWidth / 2) * MINIMAP_PADDING;
      halfHeight = halfWidth / viewportAspect;
    }

    minimapCamera.left = -halfWidth;
    minimapCamera.right = halfWidth;
    minimapCamera.top = halfHeight;
    minimapCamera.bottom = -halfHeight;
    minimapCamera.updateProjectionMatrix();
    minimapRenderer.setSize(width, height, false);
  };

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
    resizeMinimap();
  };

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  if (minimapHost) resizeObserver.observe(minimapHost);
  resize();

  const clock = new THREE.Clock();

  const updateCamera = () => {
    const target = hero.root.position;
    camera.position.set(
      target.x + CAMERA_OFFSET.x,
      CAMERA_OFFSET.y,
      target.z + CAMERA_OFFSET.z,
    );
    camera.lookAt(target.x, 0, target.z);
    camera.updateMatrixWorld();
  };

  const updateMinimapHeroMarker = () => {
    if (!minimapCamera || !minimapHeroMarker) return;

    minimapHeroPosition
      .set(hero.root.position.x, 0, hero.root.position.z)
      .project(minimapCamera);

    const left = (minimapHeroPosition.x * 0.5 + 0.5) * 100;
    const top = (-minimapHeroPosition.y * 0.5 + 0.5) * 100;

    minimapHeroMarker.style.left = `${left}%`;
    minimapHeroMarker.style.top = `${top}%`;
  };

  const renderMinimap = () => {
    if (!minimapRenderer || !minimapCamera) return;

    // The minimap is a second live view of the same scene. Alden's 3D model is hidden
    // only for this render pass because the HUD overlays his dedicated H001I head icon.
    const fog = scene.fog;
    const heroWasVisible = hero.root.visible;
    scene.fog = null;
    hero.root.visible = false;
    minimapRenderer.render(scene, minimapCamera);
    hero.root.visible = heroWasVisible;
    scene.fog = fog;
    updateMinimapHeroMarker();
  };

  updateCamera();
  updateMinimapHeroMarker();

  const animate = () => {
    animationFrame = requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;

    let moving = false;

    if (destination) {
      const dx = destination.x - hero.root.position.x;
      const dz = destination.z - hero.root.position.z;
      const distance = Math.hypot(dx, dz);
      const step = heroMoveSpeed * dt;

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

    if (alden) animateAlden(alden, elapsed, moving, dt, heroMoveSpeed);
    else animateHumanoid(hero, elapsed, moving, dt, heroMoveSpeed);

    if (targetMarker.visible) {
      const pulse = 1 + Math.sin(elapsed * 8) * 0.12;
      targetMarker.scale.setScalar(pulse);
      targetMarker.rotation.z += dt * 0.8;
    }

    updateCamera();
    renderer.render(scene, camera);
    renderMinimap();
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
      minimapRenderer?.dispose();
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
      if (minimapRenderer && minimapHost && minimapRenderer.domElement.parentElement === minimapHost) {
        minimapHost.removeChild(minimapRenderer.domElement);
      }
    },
  };
}

function addLighting(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x31402b, 1.45));

  const sun = new THREE.DirectionalLight(0xfff0cc, 3.6);
  sun.position.set(-8, 22, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.00012;
  sun.shadow.normalBias = 0.025;
  sun.shadow.camera.left = -20;
  sun.shadow.camera.right = 20;
  sun.shadow.camera.top = 20;
  sun.shadow.camera.bottom = -20;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 60;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x6f91ff, 0.72);
  fill.position.set(12, 7, -10);
  scene.add(fill);
}

function addHeroOverlay(root: THREE.Group, name: string, scale = 1) {
  const selection = new THREE.Mesh(
    new THREE.RingGeometry(0.62 * scale, 0.72 * scale, 64),
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

  const label = buildHeroLabel(name, scale);
  label.position.set(0, 3.57 * scale, 0);
  root.add(label);
}

function buildHeroLabel(name: string, scale = 1) {
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
  sprite.scale.set(3.3 * scale, 0.82 * scale, 1);
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
