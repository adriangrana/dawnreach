import * as THREE from 'three';
import { animateHumanoid, HUMANOID_DEFAULT_MOVE_SPEED } from './characters/animateHumanoid';
import { buildHumanoidBody } from './characters/buildHumanoidBody';
import { animateAlden } from './heroes/alden/animateAlden';
import { buildAlden } from './heroes/alden/buildAlden';
import { createAldenMaterials } from './heroes/alden/materials';
import { animateRiverSurface, buildDawnreachMap } from './map/buildDawnreachMap';
import { DAWNREACH_LAYOUT, MAP_BOUNDS } from './map/mapLayout';
import { polishRiverBridges } from './map/polishRiverBridges';
import { createWaterEffects } from './map/waterEffects';
import { createProceduralTextures } from './shared/textures';

type Point3 = { x: number; z: number };
type AttackOrder =
  | { kind: 'ground'; point: Point3 }
  | { kind: 'target'; target: THREE.Object3D };

const VIEW_HEIGHT = 18;
const MAP_EDGE_PADDING = 1.25;
const CAMERA_OFFSET = new THREE.Vector3(0, 34, 16.3);
const MINIMAP_PADDING = 1.06;
const MINIMAP_CAMERA_HEIGHT = 90;
const GAME_HERO_SCALE = 0.68;
const GAME_MOVE_SPEED = HUMANOID_DEFAULT_MOVE_SPEED * 0.68;
const ATTACK_RANGE = 1.35;
const ATTACK_COOLDOWN = 0.72;

// The Three.js game is created once from App.useEffect(). React Fast Refresh preserves
// that mounted effect, so editing constants in this module used to leave the old game
// instance alive. Force a page reload whenever this module changes during development.
if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}

export async function createDawnreachGame(
  host: HTMLDivElement,
  minimapHost?: HTMLDivElement | null,
  minimapHeroMarker?: HTMLImageElement | null,
) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x758994);
  scene.fog = new THREE.Fog(0x758994, 42, 100);

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

  if (minimapHeroMarker) minimapHeroMarker.style.pointerEvents = 'none';

  const sunlight = addLighting(scene);

  const textures = createProceduralTextures();
  const battlefield = buildDawnreachMap(textures);
  polishRiverBridges(battlefield);
  scene.add(battlefield);

  const attackables: THREE.Object3D[] = [];
  battlefield.traverse((object) => {
    const name = object.name.toLowerCase();
    const enemyStructure = name.startsWith('red-')
      && (name.endsWith('-tower') || name.endsWith('-base') || name === 'red-defense-tower');
    if (!enemyStructure) return;
    object.userData.attackable = true;
    attackables.push(object);
  });

  const waterSurfaces: THREE.Mesh<THREE.BufferGeometry>[] = [];
  battlefield.traverse(object => {
    if (object instanceof THREE.Mesh && object.userData.waterSurface) waterSurfaces.push(object);
  });
  const waterEffects = createWaterEffects(battlefield);
  scene.add(waterEffects.group);

  const previewHumanoid = new URLSearchParams(window.location.search).get('rig') === 'humanoid';
  const alden = previewHumanoid ? null : buildAlden(createAldenMaterials());
  const hero = alden ?? buildHumanoidBody();
  const heroPresentationScale = alden ? GAME_HERO_SCALE : 1;
  const heroMoveSpeed = alden ? GAME_MOVE_SPEED : HUMANOID_DEFAULT_MOVE_SPEED;
  const heroAnimationSpeed = alden ? heroMoveSpeed / heroPresentationScale : heroMoveSpeed;

  // Scale the whole gameplay presentation root rather than only `model`. This keeps
  // every visible Alden child (including attachments) on one authoritative scale.
  // The root's world position remains the navigation position used by camera/minimap.
  hero.root.scale.setScalar(heroPresentationScale);
  addHeroOverlay(hero.root, alden ? 'Alden' : 'Humanoide');
  hero.root.position.set(DAWNREACH_LAYOUT.blueSpawn.x, 0.03, DAWNREACH_LAYOUT.blueSpawn.z);
  scene.add(hero.root);

  const targetMarker = buildTargetMarker(0x79ff71, 0xc3ffab);
  targetMarker.visible = false;
  scene.add(targetMarker);

  const attackMarker = buildTargetMarker(0xff5f58, 0xffc27c);
  attackMarker.visible = false;
  scene.add(attackMarker);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();
  const minimapHeroPosition = new THREE.Vector3();
  const attackTargetPosition = new THREE.Vector3();
  const swordRestRotation = alden ? alden.sword.rotation.clone() : null;

  let destination: Point3 | null = null;
  let attackOrder: AttackOrder | null = null;
  let attackArmed = false;
  let attackCooldown = 0;
  let attackSwing = 0;
  let targetYaw = 0;
  let currentYaw = 0;
  let elapsed = 0;
  let animationFrame = 0;
  let lastMinimapRender = -Infinity;

  const clampMapPoint = (point: THREE.Vector3): Point3 => ({
    x: THREE.MathUtils.clamp(point.x, MAP_BOUNDS.minX + MAP_EDGE_PADDING, MAP_BOUNDS.maxX - MAP_EDGE_PADDING),
    z: THREE.MathUtils.clamp(point.z, MAP_BOUNDS.minZ + MAP_EDGE_PADDING, MAP_BOUNDS.maxZ - MAP_EDGE_PADDING),
  });

  const setPointerFromEvent = (event: PointerEvent, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
  };

  const findAttackableAncestor = (object: THREE.Object3D | null) => {
    let current = object;
    while (current) {
      if (current.userData.attackable === true) return current;
      current = current.parent;
    }
    return null;
  };

  const pickAttackable = () => {
    const hits = raycaster.intersectObjects(attackables, true);
    for (const hit of hits) {
      const attackable = findAttackableAncestor(hit.object);
      if (attackable) return attackable;
    }
    return null;
  };

  const pickGround = () => {
    if (!raycaster.ray.intersectPlane(groundPlane, hitPoint)) return null;
    return clampMapPoint(hitPoint);
  };

  const setCommandCursor = (armed: boolean) => {
    renderer.domElement.style.cursor = armed ? 'crosshair' : '';
    if (minimapHost) minimapHost.style.cursor = armed ? 'crosshair' : 'default';
  };

  const disarmAttack = () => {
    attackArmed = false;
    setCommandCursor(false);
  };

  const issueMoveCommand = (point: Point3) => {
    attackOrder = null;
    destination = point;
    disarmAttack();
    attackMarker.visible = false;
    targetMarker.position.set(point.x, 0.055, point.z);
    targetMarker.visible = true;
  };

  const issueGroundAttack = (point: Point3) => {
    attackOrder = { kind: 'ground', point };
    destination = point;
    disarmAttack();
    targetMarker.visible = false;
    attackMarker.position.set(point.x, 0.058, point.z);
    attackMarker.visible = true;
  };

  const issueTargetAttack = (target: THREE.Object3D) => {
    attackOrder = { kind: 'target', target };
    destination = null;
    disarmAttack();
    targetMarker.visible = false;
    target.getWorldPosition(attackTargetPosition);
    attackMarker.position.set(attackTargetPosition.x, 0.058, attackTargetPosition.z);
    attackMarker.visible = true;
  };

  const triggerAttack = () => {
    attackCooldown = ATTACK_COOLDOWN;
    attackSwing = 0.0001;
  };

  const onContextMenu = (event: MouseEvent) => event.preventDefault();

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 && event.button !== 2) return;
    setPointerFromEvent(event, renderer.domElement);
    raycaster.setFromCamera(pointer, camera);

    if (event.button === 2) {
      const ground = pickGround();
      if (ground) issueMoveCommand(ground);
      return;
    }

    if (!attackArmed) return;
    const target = pickAttackable();
    if (target) {
      issueTargetAttack(target);
      return;
    }
    const ground = pickGround();
    if (ground) issueGroundAttack(ground);
  };

  const onMinimapPointerDown = (event: PointerEvent) => {
    if (!minimapHost || !minimapCamera || (event.button !== 0 && event.button !== 2)) return;
    event.preventDefault();
    event.stopPropagation();
    setPointerFromEvent(event, minimapHost);
    raycaster.setFromCamera(pointer, minimapCamera);

    if (event.button === 2) {
      const ground = pickGround();
      if (ground) issueMoveCommand(ground);
      return;
    }

    if (!attackArmed) return;
    const target = pickAttackable();
    if (target) {
      issueTargetAttack(target);
      return;
    }
    const ground = pickGround();
    if (ground) issueGroundAttack(ground);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) return;
    const target = event.target as HTMLElement | null;
    if (target?.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;

    if (event.code === 'KeyA') {
      event.preventDefault();
      attackArmed = true;
      setCommandCursor(true);
      return;
    }

    if (event.code === 'Escape' && attackArmed) {
      event.preventDefault();
      disarmAttack();
    }
  };

  renderer.domElement.addEventListener('contextmenu', onContextMenu);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  minimapHost?.addEventListener('contextmenu', onContextMenu);
  minimapHost?.addEventListener('pointerdown', onMinimapPointerDown);
  window.addEventListener('keydown', onKeyDown);

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
    sunlight.position.set(target.x - 16, 32, target.z + 14);
    sunlight.target.position.set(target.x, 0, target.z);
    sunlight.target.updateMatrixWorld(true);
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
    attackCooldown = Math.max(0, attackCooldown - dt);

    if (attackOrder?.kind === 'target') {
      if (!attackOrder.target.parent) {
        attackOrder = null;
        attackMarker.visible = false;
      } else {
        attackOrder.target.getWorldPosition(attackTargetPosition);
        attackMarker.position.set(attackTargetPosition.x, 0.058, attackTargetPosition.z);
        const dx = attackTargetPosition.x - hero.root.position.x;
        const dz = attackTargetPosition.z - hero.root.position.z;
        const distance = Math.hypot(dx, dz);
        targetYaw = Math.atan2(dx, dz);
        if (distance > ATTACK_RANGE) {
          destination = { x: attackTargetPosition.x, z: attackTargetPosition.z };
        } else {
          destination = null;
          if (attackCooldown <= 0) triggerAttack();
        }
      }
    }

    let moving = false;
    let reachedDestination = false;

    if (destination) {
      const dx = destination.x - hero.root.position.x;
      const dz = destination.z - hero.root.position.z;
      const distance = Math.hypot(dx, dz);
      const step = heroMoveSpeed * dt;

      if (distance <= Math.max(step, 0.035)) {
        hero.root.position.x = destination.x;
        hero.root.position.z = destination.z;
        destination = null;
        reachedDestination = true;
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

    if (reachedDestination && attackOrder?.kind === 'ground') {
      triggerAttack();
      attackOrder = null;
      attackMarker.visible = false;
    }

    const yawDelta = Math.atan2(
      Math.sin(targetYaw - currentYaw),
      Math.cos(targetYaw - currentYaw),
    );
    currentYaw += yawDelta * Math.min(1, dt * 11);
    hero.model.rotation.y = currentYaw;

    if (alden) animateAlden(alden, elapsed, moving, dt, heroAnimationSpeed);
    else animateHumanoid(hero, elapsed, moving, dt, heroAnimationSpeed);

    if (alden && swordRestRotation) {
      if (attackSwing > 0) {
        attackSwing = Math.min(1, attackSwing + dt * 3.4);
        const slash = Math.sin(attackSwing * Math.PI);
        alden.sword.rotation.set(
          swordRestRotation.x - slash * 0.95,
          swordRestRotation.y + slash * 0.12,
          swordRestRotation.z + slash * 0.34,
        );
        if (attackSwing >= 1) {
          attackSwing = 0;
          alden.sword.rotation.copy(swordRestRotation);
        }
      }
    }

    for (const marker of [targetMarker, attackMarker]) {
      if (!marker.visible) continue;
      const pulse = 1 + Math.sin(elapsed * 8) * 0.12;
      marker.scale.setScalar(pulse);
      marker.rotation.z += dt * 0.8;
    }

    updateCamera();
    textures.water.offset.set(Math.sin(elapsed * 0.12) * 0.025, -elapsed * 0.055);
    textures.waterFlow.offset.set(Math.sin(elapsed * 0.17) * 0.035, -elapsed * 0.07);
    for (const surface of waterSurfaces) animateRiverSurface(surface, elapsed);
    waterEffects.update(elapsed, [hero.root]);
    renderer.render(scene, camera);
    if (elapsed - lastMinimapRender >= 0.16) {
      renderMinimap();
      lastMinimapRender = elapsed;
    } else {
      updateMinimapHeroMarker();
    }
  };

  animate();

  return {
    destroy() {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('contextmenu', onContextMenu);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      minimapHost?.removeEventListener('contextmenu', onContextMenu);
      minimapHost?.removeEventListener('pointerdown', onMinimapPointerDown);
      window.removeEventListener('keydown', onKeyDown);
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
  scene.add(new THREE.HemisphereLight(0xc7deed, 0x384632, 1.05));

  const sun = new THREE.DirectionalLight(0xffeed2, 3.0);
  sun.position.set(-8, 22, 10);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.00012;
  sun.shadow.normalBias = 0.025;
  sun.shadow.camera.left = -24;
  sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 90;
  scene.add(sun, sun.target);

  const fill = new THREE.DirectionalLight(0x6f91ff, 0.72);
  fill.position.set(12, 7, -10);
  scene.add(fill);
  return sun;
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

  // Name, level, HP and mana are rendered in one billboard. Keeping them in a single
  // sprite makes their screen-space alignment independent from the camera inclination.
  const statusLabel = buildHeroStatusLabel(name, 1, scale);
  statusLabel.position.set(0, 4.25 * scale, 0);
  root.add(statusLabel);
}

function buildHeroStatusLabel(name: string, level: number, scale = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 160;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  const barX = 90;
  const barWidth = 332;
  const barHeight = 38;
  const hpY = 54;
  const manaY = 96;
  const innerX = 98;
  const innerWidth = 316;
  const innerHeight = 22;
  const innerYOffset = 8;
  const levelX = 42;
  const levelWidth = 40;
  const levelY = hpY;
  const levelHeight = manaY + barHeight - hpY;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.font = 'bold 50px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(10,14,12,0.9)';
  ctx.strokeText(name, 256, 44);
  ctx.fillStyle = '#f5f1e7';
  ctx.fillText(name, 256, 44);

  const drawBar = (y: number, fill: string) => {
    ctx.fillStyle = 'rgba(8,15,13,0.96)';
    ctx.fillRect(barX, y, barWidth, barHeight);
    ctx.fillStyle = fill;
    ctx.fillRect(innerX, y + innerYOffset, innerWidth, innerHeight);
    ctx.strokeStyle = '#0a0f0d';
    ctx.lineWidth = 5;
    ctx.strokeRect(barX, y, barWidth, barHeight);
  };

  drawBar(hpY, '#49ce61');
  drawBar(manaY, '#4a90e2');

  // The level tile uses the exact top of the HP bar and bottom of the mana bar, so it
  // always occupies the full combined height of both bars including the small gap.
  ctx.fillStyle = '#0d1519';
  ctx.fillRect(levelX, levelY, levelWidth, levelHeight);
  ctx.strokeStyle = '#70818c';
  ctx.lineWidth = 3;
  ctx.strokeRect(levelX, levelY, levelWidth, levelHeight);
  ctx.font = 'bold 26px Arial';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(level.toString(), levelX + levelWidth / 2, levelY + levelHeight / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);

  // Preserve the same pixel density/width that the old 512x128 / 3.3x0.82 sprite used.
  sprite.scale.set(3.3 * scale, 0.82 * (canvas.height / 128) * scale, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function buildTargetMarker(color: number, innerColor: number) {
  const group = new THREE.Group();

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.28, 0.38, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  group.add(ring);

  const inner = new THREE.Mesh(
    new THREE.CircleGeometry(0.07, 24),
    new THREE.MeshBasicMaterial({ color: innerColor, transparent: true, opacity: 0.82, side: THREE.DoubleSide }),
  );
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = 0.003;
  group.add(inner);
  return group;
}

function disposeScene(scene: THREE.Scene) {
  const disposedTextures = new Set<THREE.Texture>();
  const disposedMaterials = new Set<THREE.Material>();
  const disposedGeometries = new Set<THREE.BufferGeometry>();

  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh || obj instanceof THREE.Sprite)) return;
    if (obj instanceof THREE.Mesh && !disposedGeometries.has(obj.geometry)) {
      disposedGeometries.add(obj.geometry);
      obj.geometry.dispose();
    }

    const material = obj.material;
    const disposeMaterial = (mat: THREE.Material) => {
      if (disposedMaterials.has(mat)) return;
      disposedMaterials.add(mat);
      for (const value of Object.values(mat)) {
        if (value instanceof THREE.Texture && !disposedTextures.has(value)) {
          disposedTextures.add(value);
          value.dispose();
        }
      }
      mat.dispose();
    };

    if (Array.isArray(material)) material.forEach(disposeMaterial);
    else disposeMaterial(material);
  });
}
