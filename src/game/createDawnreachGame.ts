import * as THREE from 'three';
import { animateHumanoid, HUMANOID_DEFAULT_MOVE_SPEED } from './characters/animateHumanoid';
import { buildHumanoidBody } from './characters/buildHumanoidBody';
import { animateAlden } from './heroes/alden/animateAlden';
import { buildAlden } from './heroes/alden/buildAlden';
import { createAldenMaterials } from './heroes/alden/materials';
import { animateRiverSurface, buildDawnreachMap } from './map/buildDawnreachMap';
import { createMapCollisionWorld } from './map/collisionWorld';
import { DAWNREACH_LAYOUT, MAP_BOUNDS } from './map/mapLayout';
import { polishRiverBridges } from './map/polishRiverBridges';
import { createWaterEffects } from './map/waterEffects';
import { createProceduralTextures } from './shared/textures';
import type { HeroStats, MatchHeroState } from './match';

type HeroOverlayState = {
  hero: MatchHeroState;
  stats: Pick<HeroStats, 'maxHp' | 'maxResource'>;
};

const heroIcons = import.meta.glob<string>('./heroes/*/images/*I.png', {
  eager: true, query: '?url', import: 'default',
});

type Point3 = { x: number; z: number };
type AttackOrder =
  | { kind: 'ground'; point: Point3 }
  | { kind: 'target'; target: THREE.Object3D };
type CommandMarkerKind = 'move' | 'attack';

const VIEW_HEIGHT = 18;
const MAP_EDGE_PADDING = 1.25;
const CAMERA_OFFSET = new THREE.Vector3(0, 34, 16.3);
const MINIMAP_PADDING = 1.06;
const MINIMAP_CAMERA_HEIGHT = 90;
const GAME_HERO_SCALE = 0.68;
const GAME_MOVE_SPEED = HUMANOID_DEFAULT_MOVE_SPEED * 0.68;
const HERO_COLLISION_RADIUS = 0.48;
const ATTACK_RANGE = 1.35;
const ATTACK_COOLDOWN = 0.72;
const COMMAND_MARKER_Y = 0.12;

if (import.meta.hot) {
  import.meta.hot.accept(() => window.location.reload());
}

export async function createDawnreachGame(
  host: HTMLDivElement,
  minimapHost?: HTMLDivElement | null,
  minimapHeroMarker?: HTMLImageElement | null,
  getHeroState?: () => HeroOverlayState | null,
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
  const commandSurfaces: THREE.Mesh[] = [];
  battlefield.traverse(object => {
    if (object instanceof THREE.Mesh && object.userData.commandSurface) commandSurfaces.push(object);
  });
  battlefield.updateMatrixWorld(true);
  const animateCamps = battlefield.getObjectByName('jungle-camps')?.userData.animate as
    ((elapsed: number) => void) | undefined;
  const collisionWorld = createMapCollisionWorld(battlefield);
  battlefield.userData.collisionCounts = collisionWorld.counts;

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

  hero.root.scale.setScalar(heroPresentationScale);
  const heroOverlay = addHeroOverlay(hero.root);
  hero.root.position.set(DAWNREACH_LAYOUT.blueSpawn.x, 0.03, DAWNREACH_LAYOUT.blueSpawn.z);
  scene.add(hero.root);

  const targetMarker = buildTargetMarker('move', 0x79ff71, 0xc3ffab);
  targetMarker.visible = false;
  scene.add(targetMarker);

  const attackMarker = buildTargetMarker('attack', 0xff5f58, 0xffc27c);
  attackMarker.visible = false;
  scene.add(attackMarker);

  const raycaster = new THREE.Raycaster();
  const surfaceRay = new THREE.Raycaster();
  surfaceRay.ray.direction.set(0, -1, 0);
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
    const surface = raycaster.intersectObjects(commandSurfaces, false)[0];
    if (surface) return clampMapPoint(surface.point);
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

  const showCommandMarker = (marker: THREE.Group, point: Point3) => {
    surfaceRay.ray.origin.set(point.x, 20, point.z);
    const surface = surfaceRay.intersectObjects(commandSurfaces, false)[0];
    marker.userData.surfaceHeight = surface?.point.y ?? 0;
    marker.position.set(point.x, marker.userData.surfaceHeight + COMMAND_MARKER_Y, point.z);
    marker.rotation.set(0, 0, 0);
    marker.scale.setScalar(0.72);
    marker.userData.spawnTime = elapsed;
    marker.visible = true;
  };

  const issueMoveCommand = (point: Point3) => {
    attackOrder = null;
    destination = point;
    disarmAttack();
    attackMarker.visible = false;
    showCommandMarker(targetMarker, point);
  };

  const issueGroundAttack = (point: Point3) => {
    attackOrder = { kind: 'ground', point };
    destination = point;
    disarmAttack();
    targetMarker.visible = false;
    showCommandMarker(attackMarker, point);
  };

  const issueTargetAttack = (target: THREE.Object3D) => {
    attackOrder = { kind: 'target', target };
    destination = null;
    disarmAttack();
    targetMarker.visible = false;
    target.getWorldPosition(attackTargetPosition);
    showCommandMarker(attackMarker, { x: attackTargetPosition.x, z: attackTargetPosition.z });
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
        if (attackMarker.position.x !== attackTargetPosition.x || attackMarker.position.z !== attackTargetPosition.z) {
          attackMarker.position.x = attackTargetPosition.x;
          attackMarker.position.z = attackTargetPosition.z;
          surfaceRay.ray.origin.set(attackTargetPosition.x, 20, attackTargetPosition.z);
          attackMarker.userData.surfaceHeight = surfaceRay.intersectObjects(commandSurfaces, false)[0]?.point.y ?? 0;
        }
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

      if (distance <= 1e-6) {
        destination = null;
        reachedDestination = true;
        targetMarker.visible = false;
      } else {
        const nx = dx / distance;
        const nz = dz / distance;
        const travel = Math.min(step, distance);
        const from = { x: hero.root.position.x, z: hero.root.position.z };
        const desired = { x: from.x + nx * travel, z: from.z + nz * travel };
        const resolved = collisionWorld.move(from, desired, HERO_COLLISION_RADIUS);
        const movedDistance = Math.hypot(resolved.x - from.x, resolved.z - from.z);

        hero.root.position.x = resolved.x;
        hero.root.position.z = resolved.z;
        targetYaw = Math.atan2(nx, nz);
        moving = movedDistance > 0.001;

        const remaining = Math.hypot(destination.x - resolved.x, destination.z - resolved.z);
        if (remaining <= 0.04) {
          destination = null;
          reachedDestination = true;
          targetMarker.visible = false;
        } else if (movedDistance <= 0.0005 && attackOrder?.kind !== 'target') {
          // Direct movement has reached a hard obstacle. Do not tunnel or attack through it.
          destination = null;
          targetMarker.visible = false;
          if (attackOrder?.kind === 'ground') {
            attackOrder = null;
            attackMarker.visible = false;
          }
        }
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

    if (alden && swordRestRotation && attackSwing > 0) {
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

    for (const marker of [targetMarker, attackMarker]) {
      if (!marker.visible) continue;
      const kind = marker.userData.kind as CommandMarkerKind;
      const age = Math.max(0, elapsed - Number(marker.userData.spawnTime ?? elapsed));
      const intro = THREE.MathUtils.smoothstep(age, 0, 0.16);
      const pulse = 1 + Math.sin(age * (kind === 'attack' ? 4.5 : 3.5)) * 0.035;
      marker.scale.setScalar((0.72 + intro * 0.28) * pulse);
      marker.rotation.y = age * (kind === 'attack' ? 1.05 : 0.65);
      marker.position.y = Number(marker.userData.surfaceHeight ?? 0) + COMMAND_MARKER_Y
        + Math.sin(age * 5 + (kind === 'attack' ? 0.8 : 0)) * 0.006;

      const accentMaterial = marker.userData.accentMaterial as THREE.MeshBasicMaterial | undefined;
      const glowMaterial = marker.userData.glowMaterial as THREE.MeshBasicMaterial | undefined;
      if (accentMaterial) accentMaterial.opacity = (kind === 'attack' ? 0.92 : 0.86) + Math.sin(elapsed * 7) * 0.07;
      if (glowMaterial) glowMaterial.opacity = 0.16 + (Math.sin(elapsed * 5) + 1) * 0.055;
    }

    updateCamera();
    textures.water.offset.set(Math.sin(elapsed * 0.12) * 0.025, -elapsed * 0.055);
    textures.waterFlow.offset.set(Math.sin(elapsed * 0.17) * 0.035, -elapsed * 0.07);
    for (const surface of waterSurfaces) animateRiverSurface(surface, elapsed);
    waterEffects.update(elapsed, [hero.root]);
    animateCamps?.(elapsed);
    heroOverlay.update(getHeroState?.() ?? null);
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
      heroOverlay.dispose();
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

function addHeroOverlay(root: THREE.Group, scale = 1) {
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

  const canvas = document.createElement('canvas');
  canvas.width = 440;
  canvas.height = 88;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const material = new THREE.SpriteMaterial({
    map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.name = 'hero-status-overlay';
  sprite.scale.set(4.8 * scale, 4.8 * canvas.height / canvas.width * scale, 1);
  sprite.position.set(0, 5.75 * scale, 0);
  sprite.renderOrder = 10;
  sprite.visible = false;
  root.add(sprite);

  let icon: HTMLImageElement | null = null;
  let iconPath: string | undefined;
  let lastValues: (string | number)[] = [];
  let dirty = true;

  return {
    update(state: HeroOverlayState | null) {
      sprite.visible = state !== null;
      if (!state) return;
      const { hero, stats } = state;
      const nextIconPath = heroIcons[`./heroes/${hero.heroName?.toLowerCase()}/images/${hero.definitionId}I.png`];
      if (nextIconPath !== iconPath) {
        if (icon) icon.onload = icon.onerror = null;
        iconPath = nextIconPath;
        icon = null;
        dirty = true;
        if (iconPath) {
          icon = new Image();
          icon.onload = icon.onerror = () => { dirty = true; };
          icon.src = iconPath;
        }
      }
      const values = [hero.heroName, hero.definitionId, hero.level,
        hero.currentHp, stats.maxHp, hero.currentResource, stats.maxResource];
      if (!dirty && values.every((value, index) => value === lastValues[index])) return;
      lastValues = values;
      dirty = false;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const frame = ctx.createLinearGradient(0, 8, 0, 72);
      frame.addColorStop(0, '#fafafa');
      frame.addColorStop(1, '#9caaa7');
      ctx.fillStyle = frame;
      ctx.beginPath();
      ctx.moveTo(48, 8);
      ctx.lineTo(436, 8);
      ctx.lineTo(436, 68);
      ctx.lineTo(276, 68);
      ctx.lineTo(canvas.width / 2, 82);
      ctx.lineTo(164, 68);
      ctx.lineTo(48, 68);
      ctx.closePath();
      ctx.fill();

      buildHeroLabel(ctx, hero.currentHp, stats.maxHp);
      buildManaLabel(ctx, hero.currentResource, stats.maxResource);
      buildLevelLabel(ctx, hero.level);
      if (icon?.complete && icon.naturalWidth > 0) {
        const size = Math.min(80 / icon.naturalWidth, 80 / icon.naturalHeight);
        const width = icon.naturalWidth * size;
        const height = icon.naturalHeight * size;
        ctx.drawImage(icon, (80 - width) / 2, (80 - height) / 2, width, height);
      } else {
        ctx.font = 'bold 38px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(hero.heroName?.charAt(0) ?? '?', 38, 40);
      }
      texture.needsUpdate = true;
    },
    dispose() {
      if (icon) icon.onload = icon.onerror = null;
      icon = null;
    },
  };
}

function buildLevelLabel(ctx: CanvasRenderingContext2D, level: number) {
  ctx.font = 'bold 38px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#080b09';
  ctx.fillText(String(level), 406, 40, 50);
}

function resourceFraction(current: number, maximum: number) {
  if (!Number.isFinite(current) || !Number.isFinite(maximum) || maximum <= 0) return 0;
  return THREE.MathUtils.clamp(current / maximum, 0, 1);
}

function buildManaLabel(ctx: CanvasRenderingContext2D, mana: number, maxMana: number) {
  ctx.fillStyle = '#050805';
  ctx.fillRect(78, 46, 302, 18);
  ctx.fillStyle = '#14213a';
  ctx.fillRect(82, 49, 294, 11);
  ctx.fillStyle = '#367eff';
  ctx.fillRect(82, 49, 294 * resourceFraction(mana, maxMana), 11);
}

function buildHeroLabel(ctx: CanvasRenderingContext2D, hp: number, maxHp: number) {
  ctx.fillStyle = '#050805';
  ctx.fillRect(78, 12, 302, 37);
  ctx.fillStyle = '#1c2916';
  ctx.fillRect(82, 16, 294, 29);
  const health = ctx.createLinearGradient(0, 16, 0, 45);
  health.addColorStop(0, '#83e844');
  health.addColorStop(1, '#46c526');
  ctx.fillStyle = health;
  ctx.fillRect(82, 16, 294 * resourceFraction(hp, maxHp), 29);
  ctx.fillStyle = 'rgba(5, 30, 4, 0.4)';
  for (let segment = 1; segment < 3; segment++) {
    ctx.fillRect(82 + 294 * segment / 3, 16, 2, 29);
  }
}

function buildTargetMarker(kind: CommandMarkerKind, color: number, innerColor: number) {
  const group = new THREE.Group();
  group.userData.kind = kind;
  group.userData.spawnTime = 0;

  const glowMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const accentMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const coreMaterial = new THREE.MeshBasicMaterial({
    color: innerColor,
    transparent: true,
    opacity: 0.96,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });

  group.userData.glowMaterial = glowMaterial;
  group.userData.accentMaterial = accentMaterial;

  const halo = new THREE.Mesh(new THREE.RingGeometry(0.25, 0.53, 64), glowMaterial);
  halo.rotation.x = -Math.PI / 2;
  halo.renderOrder = 30;
  group.add(halo);

  for (let segment = 0; segment < 4; segment++) {
    const start = segment * Math.PI / 2 + 0.14;
    const arc = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.43, 28, 1, start, Math.PI / 2 - 0.28),
      accentMaterial,
    );
    arc.rotation.x = -Math.PI / 2;
    arc.position.y = 0.004;
    arc.renderOrder = 31;
    group.add(arc);
  }

  const innerRing = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.215, 40), coreMaterial);
  innerRing.rotation.x = -Math.PI / 2;
  innerRing.position.y = 0.007;
  innerRing.renderOrder = 32;
  group.add(innerRing);

  const coreGeometry = new THREE.CircleGeometry(kind === 'attack' ? 0.09 : 0.072, 4);
  coreGeometry.rotateZ(Math.PI / 4);
  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  core.rotation.x = -Math.PI / 2;
  core.position.y = 0.01;
  core.renderOrder = 33;
  group.add(core);

  if (kind === 'attack') {
    for (let spokeIndex = 0; spokeIndex < 4; spokeIndex++) {
      const spokeGeometry = new THREE.PlaneGeometry(0.035, 0.13);
      spokeGeometry.rotateZ(spokeIndex * Math.PI / 2);
      const spoke = new THREE.Mesh(spokeGeometry, coreMaterial);
      spoke.rotation.x = -Math.PI / 2;
      const angle = spokeIndex * Math.PI / 2;
      spoke.position.set(Math.sin(angle) * 0.27, 0.009, Math.cos(angle) * 0.27);
      spoke.renderOrder = 33;
      group.add(spoke);
    }
  }

  return group;
}

function disposeScene(scene: THREE.Scene) {
  const disposedTextures = new Set<THREE.Texture>();
  const disposedMaterials = new Set<THREE.Material>();
  const disposedGeometries = new Set<THREE.BufferGeometry>();

  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh || obj instanceof THREE.Sprite || obj instanceof THREE.Points)) return;
    if ((obj instanceof THREE.Mesh || obj instanceof THREE.Points) && !disposedGeometries.has(obj.geometry)) {
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
