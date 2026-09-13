import * as THREE from 'three';
import { animateHumanoid, HUMANOID_DEFAULT_MOVE_SPEED } from './characters/animateHumanoid';
import { buildHumanoidBody } from './characters/buildHumanoidBody';
import { createEntitySelectionController } from './entities/entitySelection';
import { GameEntityRegistry, getGameEntity, registerAuthoredMapEntities, VISION_RANGES } from './entities/gameEntities';
import { animateAlden } from './heroes/alden/animateAlden';
import { buildAlden } from './heroes/alden/buildAlden';
import { createAldenMaterials } from './heroes/alden/materials';
import { upgradeBasePresentation } from './map/basePresentation';
import { animateRiverSurface, buildDawnreachMap } from './map/buildDawnreachMap';
import { createMapCollisionWorld } from './map/collisionWorld';
import { DAWNREACH_LAYOUT, MAP_BOUNDS } from './map/mapLayout';
import { polishRiverBridges } from './map/polishRiverBridges';
import { createWaterEffects } from './map/waterEffects';
import {
  createDawnreachNavigationWorld,
  createNavigationDebugGroup,
  NAVIGATION_DEBUG,
  updateNavigationDebugPath,
} from './navigation/dawnreachNavigation';
import type { NavigationPath } from './navigation/navigationWorld';
import { createProceduralTextures } from './shared/textures';
import type { HeroStats, MatchHeroState } from './match';
import { createVisionSystem } from './vision/visionSystem';

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
const CAMERA_PAN_SPEED = 8.5;
const MINIMAP_PADDING = 1.0;
const MINIMAP_CAMERA_HEIGHT = 90;
const GAME_HERO_SCALE = 0.68;
const GAME_MOVE_SPEED = HUMANOID_DEFAULT_MOVE_SPEED * 0.68;
const HERO_COLLISION_RADIUS = 0.48;
const HERO_GROUND_OFFSET = 0.03;
const SURFACE_RAY_HEIGHT = 64;
const ATTACK_RANGE = 1.35;
const ATTACK_COOLDOWN = 0.72;
const COMMAND_MARKER_Y = 0.12;
const WAYPOINT_REACHED_DISTANCE = 0.22;
const STUCK_REPATH_DELAY = 0.42;
const REPATH_COOLDOWN = 0.7;
const PARTIAL_ROUTE_REPATH_INTERVAL = 0.24;
const BLOCKED_ROUTE_REPATH_COOLDOWN = 0.12;
const TARGET_REPATH_DISTANCE = 0.75;
const TARGET_REPATH_COOLDOWN = 0.35;
const VISION_UPDATE_INTERVAL = 0.1;
const RESPAWN_HOLD_KEY = 'dawnreachRespawnHold';

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
  const minimapBackground = new THREE.Color(0x07100e);

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

  const minimapViewportSvg = minimapHost
    ? document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    : null;
  const minimapViewportPolygon = minimapViewportSvg
    ? document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
    : null;
  if (minimapHost && minimapViewportSvg && minimapViewportPolygon) {
    minimapViewportSvg.classList.add('minimap-camera-viewport');
    minimapViewportSvg.setAttribute('viewBox', '0 0 100 100');
    minimapViewportSvg.setAttribute('preserveAspectRatio', 'none');
    minimapViewportSvg.setAttribute('aria-hidden', 'true');
    minimapViewportSvg.appendChild(minimapViewportPolygon);
    minimapHost.appendChild(minimapViewportSvg);
  }

  const sunlight = addLighting(scene);

  const textures = createProceduralTextures();
  const battlefield = buildDawnreachMap(textures);
  upgradeBasePresentation(battlefield, 'blue', DAWNREACH_LAYOUT.blueBase);
  upgradeBasePresentation(battlefield, 'red', DAWNREACH_LAYOUT.redBase);
  polishRiverBridges(battlefield);
  scene.add(battlefield);

  const commandSurfaces: THREE.Mesh[] = [];
  battlefield.traverse(object => {
    if (object instanceof THREE.Mesh && object.userData.commandSurface) commandSurfaces.push(object);
  });
  battlefield.updateMatrixWorld(true);

  const mapAnimations: Array<(elapsed: number) => void> = [];
  battlefield.traverse(object => {
    if (typeof object.userData.animate === 'function') mapAnimations.push(object.userData.animate);
  });
  const collisionWorld = createMapCollisionWorld(battlefield);
  battlefield.userData.collisionCounts = collisionWorld.counts;
  const navigation = createDawnreachNavigationWorld(battlefield, collisionWorld, HERO_COLLISION_RADIUS);
  const navigationDebug = NAVIGATION_DEBUG ? createNavigationDebugGroup(navigation) : null;
  if (navigationDebug) scene.add(navigationDebug);

  const attackables: THREE.Object3D[] = [];
  battlefield.traverse((object) => {
    const name = object.name.toLowerCase();
    const enemyStructure = name.startsWith('red-')
      && (name.endsWith('-tower') || name.endsWith('-base') || name.endsWith('-throne') || name === 'red-defense-tower');
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
  hero.root.position.set(DAWNREACH_LAYOUT.blueSpawn.x, HERO_GROUND_OFFSET, DAWNREACH_LAYOUT.blueSpawn.z);
  scene.add(hero.root);

  const entityRegistry = new GameEntityRegistry();
  registerAuthoredMapEntities(entityRegistry, battlefield);
  entityRegistry.register(hero.root, {
    id: 'blue-hero-alden',
    displayName: alden ? 'Alden' : 'Humanoid Preview',
    kind: 'hero',
    team: 'blue',
    selectable: true,
    targetable: true,
    grantsVision: true,
    visionRadius: VISION_RANGES.hero,
    visionHeight: 1.8,
    visibilityPolicy: 'vision-only',
    interaction: 'unit',
    selectionRadius: 0.78,
  });
  const vision = createVisionSystem(entityRegistry, 'blue');
  scene.userData.entityRegistry = entityRegistry;
  scene.userData.visionSystem = vision;

  const targetMarker = buildTargetMarker('move', 0x79ff71, 0xc3ffab);
  targetMarker.visible = false;
  scene.add(targetMarker);

  const attackMarker = buildTargetMarker('attack', 0xff5f58, 0xffc27c);
  attackMarker.visible = false;
  scene.add(attackMarker);

  const raycaster = new THREE.Raycaster();
  const selection = createEntitySelectionController(
    scene,
    entityRegistry,
    entity => entity.team === 'blue' || entity.revealed,
  );
  vision.updateEntityVisibility();
  const surfaceRay = new THREE.Raycaster();
  surfaceRay.ray.direction.set(0, -1, 0);
  const pointer = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();
  const minimapHeroPosition = new THREE.Vector3();
  const attackTargetPosition = new THREE.Vector3();
  const minimapViewportRaycaster = new THREE.Raycaster();
  const minimapViewportPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const minimapViewportHit = new THREE.Vector3();
  const minimapViewportProjected = new THREE.Vector3();
  const minimapViewportCorners = [
    new THREE.Vector2(-1, 1),
    new THREE.Vector2(1, 1),
    new THREE.Vector2(1, -1),
    new THREE.Vector2(-1, -1),
  ] as const;
  const swordRestRotation = alden ? alden.sword.rotation.clone() : null;

  const sampleSurfaceHeight = (x: number, z: number, fallback = 0) => {
    surfaceRay.ray.origin.set(x, SURFACE_RAY_HEIGHT, z);
    const hit = surfaceRay.intersectObjects(commandSurfaces, false)[0];
    return hit?.point.y ?? fallback;
  };

  hero.root.position.y = sampleSurfaceHeight(
    hero.root.position.x,
    hero.root.position.z,
    0,
  ) + HERO_GROUND_OFFSET;
  const heroSpawnSurfaceY = hero.root.position.y;

  let destination: Point3 | null = null;
  let currentPath: Point3[] = [];
  let currentWaypointIndex = 0;
  let currentPathPartial = false;
  let routeRequest: Point3 | null = null;
  let stuckDuration = 0;
  let lastRepathAt = -Infinity;
  let lastRoutePlanAt = -Infinity;
  let lastRouteValidationAt = -Infinity;
  let lastAttackPathTarget: Point3 | null = null;
  let lastTargetRepathAt = -Infinity;
  let attackOrder: AttackOrder | null = null;
  let attackArmed = false;
  let attackCooldown = 0;
  let attackSwing = 0;
  let targetYaw = 0;
  let currentYaw = 0;
  let elapsed = 0;
  let animationFrame = 0;
  let lastMinimapRender = -Infinity;
  let lastVisionUpdate = -Infinity;
  let cameraFocus: Point3 | null = null;
  let movementWasLocked = false;
  const cameraAnchor = hero.root.position.clone();

  const heroPoint = (): Point3 => ({ x: hero.root.position.x, z: hero.root.position.z });

  const clearCurrentPath = () => {
    destination = null;
    currentPath = [];
    currentWaypointIndex = 0;
    currentPathPartial = false;
    stuckDuration = 0;
    updateNavigationDebugPath(navigationDebug, null, heroPoint());
  };

  const clearMovementRoute = () => {
    clearCurrentPath();
    routeRequest = null;
  };

  const resetHeroLocomotionPose = () => {
    hero.gait.phase = 0;
    hero.gait.weight = 0;
    hero.leftLeg.rotation.x = 0;
    hero.rightLeg.rotation.x = 0;
    hero.leftShin.rotation.x = 0;
    hero.rightShin.rotation.x = 0;
    hero.leftFoot.rotation.x = 0;
    hero.rightFoot.rotation.x = 0;
    hero.leftArm.rotation.x = 0;
    hero.rightArm.rotation.x = 0;
    hero.leftForearm.rotation.x = -0.35;
    hero.rightForearm.rotation.x = -0.35;
    hero.leftForearm.rotation.z = 0;
    hero.rightForearm.rotation.z = 0;
    hero.pelvis.rotation.y = 0;
    hero.pelvis.rotation.z = 0;
    hero.pelvis.position.x = 0;
    hero.torso.rotation.y = 0;
    hero.torso.rotation.z = 0;
    hero.torso.position.x = 0;
    hero.torso.position.y = hero.torsoRestY;
    hero.head.quaternion.identity();
    hero.model.position.y = 0;
    hero.model.rotation.z = 0;
    if (alden) {
      alden.capeMotion = 0;
      alden.cape.rotation.x = 0.025;
      alden.cape.rotation.z = 0;
    }
  };

  const isHeroMovementLocked = () => {
    const overlay = getHeroState?.() ?? null;
    const entity = getGameEntity(hero.root);
    return (overlay?.hero.currentHp ?? 1) <= 0
      || entity?.alive === false
      || hero.root.userData[RESPAWN_HOLD_KEY] === true;
  };

  const clearHeroOrdersForLock = () => {
    clearMovementRoute();
    attackOrder = null;
    lastAttackPathTarget = null;
    attackSwing = 0;
    targetMarker.visible = false;
    attackMarker.visible = false;
    disarmAttack();
    if (alden && swordRestRotation) alden.sword.rotation.copy(swordRestRotation);
  };

  const applyNavigationPath = (path: NavigationPath, requested: Point3) => {
    destination = { x: path.resolvedTarget.x, z: path.resolvedTarget.z };
    routeRequest = { x: requested.x, z: requested.z };
    currentPath = path.waypoints.map(point => ({ x: point.x, z: point.z }));
    currentWaypointIndex = 0;
    currentPathPartial = path.partial;
    stuckDuration = 0;
    lastRoutePlanAt = elapsed;
    updateNavigationDebugPath(navigationDebug, path, heroPoint());
  };

  const planMovementRoute = (point: Point3, allowPartial = true, keepCurrentOnFailure = false) => {
    const requested = { x: point.x, z: point.z };
    routeRequest = requested;
    const path = navigation.findPath(heroPoint(), requested, { allowPartial });
    lastRoutePlanAt = elapsed;
    if (!path) {
      if (!keepCurrentOnFailure) {
        clearCurrentPath();
        currentPathPartial = true;
      }
      routeRequest = requested;
      return null;
    }
    applyNavigationPath(path, requested);
    return path;
  };

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
      if (!attackable) continue;
      const entity = getGameEntity(attackable);
      if (entity && !vision.isEntityVisible(entity)) continue;
      return attackable;
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
    marker.userData.surfaceHeight = sampleSurfaceHeight(point.x, point.z, 0);
    marker.position.set(point.x, marker.userData.surfaceHeight + COMMAND_MARKER_Y, point.z);
    marker.rotation.set(0, 0, 0);
    marker.scale.setScalar(0.72);
    marker.userData.spawnTime = elapsed;
    marker.visible = true;
  };

  const issueMoveCommand = (point: Point3) => {
    attackOrder = null;
    lastAttackPathTarget = null;
    disarmAttack();
    attackMarker.visible = false;
    planMovementRoute(point, true);
    // The marker represents player intent, not the first partial endpoint. The order stays
    // alive while Alden advances and replans toward this exact requested point.
    showCommandMarker(targetMarker, point);
  };

  const issueGroundAttack = (point: Point3) => {
    attackOrder = { kind: 'ground', point };
    lastAttackPathTarget = null;
    planMovementRoute(point, true);
    disarmAttack();
    targetMarker.visible = false;
    showCommandMarker(attackMarker, point);
  };

  const issueTargetAttack = (target: THREE.Object3D) => {
    attackOrder = { kind: 'target', target };
    disarmAttack();
    targetMarker.visible = false;
    target.getWorldPosition(attackTargetPosition);
    const targetPoint = { x: attackTargetPosition.x, z: attackTargetPosition.z };
    lastAttackPathTarget = targetPoint;
    lastTargetRepathAt = elapsed;
    planMovementRoute(targetPoint, true);
    showCommandMarker(attackMarker, targetPoint);
  };

  const triggerAttack = () => {
    attackCooldown = ATTACK_COOLDOWN;
    attackSwing = 0.0001;
  };

  const onContextMenu = (event: MouseEvent) => event.preventDefault();

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 && event.button !== 2) return;
    const movementLocked = isHeroMovementLocked();
    setPointerFromEvent(event, renderer.domElement);
    raycaster.setFromCamera(pointer, camera);

    if (event.button === 2) {
      if (movementLocked) {
        event.preventDefault();
        return;
      }
      const ground = pickGround();
      if (ground) issueMoveCommand(ground);
      return;
    }

    if (movementLocked) {
      disarmAttack();
      selection.pick(raycaster);
      return;
    }

    if (!attackArmed) {
      selection.pick(raycaster);
      return;
    }
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
    const movementLocked = isHeroMovementLocked();
    setPointerFromEvent(event, minimapHost);
    raycaster.setFromCamera(pointer, minimapCamera);

    if (event.button === 2) {
      if (movementLocked) return;
      const ground = pickGround();
      if (ground) issueMoveCommand(ground);
      return;
    }

    if (movementLocked) {
      disarmAttack();
      const ground = pickGround();
      if (ground) cameraFocus = { x: ground.x, z: ground.z };
      return;
    }

    if (!attackArmed) {
      const ground = pickGround();
      if (ground) cameraFocus = { x: ground.x, z: ground.z };
      return;
    }

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
      if (isHeroMovementLocked()) return;
      event.preventDefault();
      attackArmed = true;
      setCommandCursor(true);
      return;
    }

    if (event.code === 'Space') {
      event.preventDefault();
      cameraFocus = null;
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

  const updateCamera = (dt = 1 / 60) => {
    if (cameraFocus) {
      const targetY = sampleSurfaceHeight(cameraFocus.x, cameraFocus.z, 0) + HERO_GROUND_OFFSET;
      const blend = 1 - Math.exp(-CAMERA_PAN_SPEED * dt);
      cameraAnchor.x = THREE.MathUtils.lerp(cameraAnchor.x, cameraFocus.x, blend);
      cameraAnchor.y = THREE.MathUtils.lerp(cameraAnchor.y, targetY, blend);
      cameraAnchor.z = THREE.MathUtils.lerp(cameraAnchor.z, cameraFocus.z, blend);
    } else {
      cameraAnchor.copy(hero.root.position);
    }

    const target = cameraAnchor;
    sunlight.position.set(target.x - 16, target.y + 32, target.z + 14);
    sunlight.target.position.set(target.x, target.y, target.z);
    sunlight.target.updateMatrixWorld(true);
    camera.position.set(
      target.x + CAMERA_OFFSET.x,
      target.y + CAMERA_OFFSET.y,
      target.z + CAMERA_OFFSET.z,
    );
    camera.lookAt(target.x, target.y, target.z);
    camera.updateMatrixWorld();
  };

  const updateMinimapCameraViewport = () => {
    if (!minimapCamera || !minimapViewportPolygon) return;

    // Intersect the four orthographic screen-corner rays with the horizontal plane
    // passing through the current camera focus. Projecting those world points into the
    // top-down minimap produces the exact visible footprint, including the isometric
    // camera pitch, instead of a misleading axis-aligned rectangle.
    minimapViewportPlane.constant = -cameraAnchor.y;
    const points: string[] = [];
    for (const corner of minimapViewportCorners) {
      minimapViewportRaycaster.setFromCamera(corner, camera);
      const intersection = minimapViewportRaycaster.ray.intersectPlane(minimapViewportPlane, minimapViewportHit);
      if (!intersection) {
        minimapViewportPolygon.setAttribute('points', '');
        return;
      }

      minimapViewportProjected
        .set(intersection.x, 0, intersection.z)
        .project(minimapCamera);
      const x = (minimapViewportProjected.x * 0.5 + 0.5) * 100;
      const y = (-minimapViewportProjected.y * 0.5 + 0.5) * 100;
      points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    }
    minimapViewportPolygon.setAttribute('points', points.join(' '));
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
    const background = scene.background;
    const heroWasVisible = hero.root.visible;
    scene.fog = null;
    scene.background = minimapBackground;
    hero.root.visible = false;
    minimapRenderer.render(scene, minimapCamera);
    hero.root.visible = heroWasVisible;
    scene.background = background;
    scene.fog = fog;
    updateMinimapHeroMarker();
  };

  updateCamera();
  updateMinimapCameraViewport();
  updateMinimapHeroMarker();

  const animate = () => {
    animationFrame = requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;
    attackCooldown = Math.max(0, attackCooldown - dt);

    if (elapsed - lastVisionUpdate >= VISION_UPDATE_INTERVAL) {
      vision.updateEntityVisibility();
      lastVisionUpdate = elapsed;
    }
    selection.update();

    const worldHeroEntity = getGameEntity(hero.root);
    if (worldHeroEntity?.alive && movementWasLocked) {
      const atSpawn = Math.hypot(
        hero.root.position.x - DAWNREACH_LAYOUT.blueSpawn.x,
        hero.root.position.z - DAWNREACH_LAYOUT.blueSpawn.z,
      ) <= 0.08;
      if (atSpawn) hero.root.position.y = heroSpawnSurfaceY;
      hero.root.visible = true;
      hero.model.visible = true;
    }

    const movementLocked = isHeroMovementLocked();
    if (movementLocked) {
      if (!movementWasLocked) clearHeroOrdersForLock();
      resetHeroLocomotionPose();
    }
    movementWasLocked = movementLocked;

    if (!movementLocked && attackOrder?.kind === 'target') {
      if (!attackOrder.target.parent) {
        attackOrder = null;
        clearMovementRoute();
        attackMarker.visible = false;
      } else {
        attackOrder.target.getWorldPosition(attackTargetPosition);
        if (attackMarker.position.x !== attackTargetPosition.x || attackMarker.position.z !== attackTargetPosition.z) {
          attackMarker.position.x = attackTargetPosition.x;
          attackMarker.position.z = attackTargetPosition.z;
          attackMarker.userData.surfaceHeight = sampleSurfaceHeight(attackTargetPosition.x, attackTargetPosition.z, 0);
        }
        const dx = attackTargetPosition.x - hero.root.position.x;
        const dz = attackTargetPosition.z - hero.root.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance > ATTACK_RANGE) {
          const targetPoint = { x: attackTargetPosition.x, z: attackTargetPosition.z };
          const targetMoved = !lastAttackPathTarget
            || Math.hypot(targetPoint.x - lastAttackPathTarget.x, targetPoint.z - lastAttackPathTarget.z) >= TARGET_REPATH_DISTANCE;
          const retryPartial = currentPathPartial && elapsed - lastRoutePlanAt >= PARTIAL_ROUTE_REPATH_INTERVAL;
          if ((targetMoved || !destination || retryPartial) && elapsed - lastTargetRepathAt >= TARGET_REPATH_COOLDOWN) {
            planMovementRoute(targetPoint, true, true);
            lastAttackPathTarget = targetPoint;
            lastTargetRepathAt = elapsed;
          }
        } else {
          clearMovementRoute();
          targetYaw = Math.atan2(dx, dz);
          if (attackCooldown <= 0) triggerAttack();
        }
      }
    }

    // Movement orders are persistent intents. A valid full route is left alone, but its
    // next segment is revalidated frequently. Partial/missing routes are retried from the
    // hero's new position until the original requested destination becomes reachable.
    if (!movementLocked && routeRequest && attackOrder?.kind !== 'target') {
      const nextWaypoint = destination && currentWaypointIndex < currentPath.length
        ? currentPath[currentWaypointIndex]
        : null;
      let segmentBlocked = false;
      if (nextWaypoint && elapsed - lastRouteValidationAt >= BLOCKED_ROUTE_REPATH_COOLDOWN) {
        lastRouteValidationAt = elapsed;
        segmentBlocked = !navigation.segmentIsWalkable(heroPoint(), nextWaypoint);
      }

      const routeMissing = !destination || currentPath.length === 0 || currentWaypointIndex >= currentPath.length;
      const retryPartial = (routeMissing || currentPathPartial)
        && elapsed - lastRoutePlanAt >= PARTIAL_ROUTE_REPATH_INTERVAL;

      if (retryPartial || segmentBlocked) {
        const requested = { ...routeRequest };
        lastRepathAt = elapsed;
        planMovementRoute(requested, true, !routeMissing && !segmentBlocked);
      }
    }

    let moving = false;
    let reachedDestination = false;

    if (!movementLocked && destination && currentPath.length > 0) {
      while (currentWaypointIndex < currentPath.length) {
        const waypoint = currentPath[currentWaypointIndex];
        if (Math.hypot(waypoint.x - hero.root.position.x, waypoint.z - hero.root.position.z) > WAYPOINT_REACHED_DISTANCE) break;
        currentWaypointIndex++;
      }

      if (currentWaypointIndex >= currentPath.length) {
        if (currentPathPartial && routeRequest) {
          const requested = { ...routeRequest };
          clearCurrentPath();
          routeRequest = requested;
          currentPathPartial = true;
          lastRoutePlanAt = -Infinity;
        } else {
          clearMovementRoute();
          reachedDestination = true;
          targetMarker.visible = false;
        }
      } else {
        const waypoint = currentPath[currentWaypointIndex];
        const dx = waypoint.x - hero.root.position.x;
        const dz = waypoint.z - hero.root.position.z;
        const distance = Math.hypot(dx, dz);
        const step = heroMoveSpeed * dt;
        const nx = distance > 1e-8 ? dx / distance : 0;
        const nz = distance > 1e-8 ? dz / distance : 0;
        const travel = Math.min(step, distance);
        const from = heroPoint();
        const desired = { x: from.x + nx * travel, z: from.z + nz * travel };
        const resolved = collisionWorld.move(from, desired, HERO_COLLISION_RADIUS);
        const movedDistance = Math.hypot(resolved.x - from.x, resolved.z - from.z);

        hero.root.position.x = resolved.x;
        hero.root.position.z = resolved.z;
        hero.root.position.y = sampleSurfaceHeight(
          resolved.x,
          resolved.z,
          Math.max(0, hero.root.position.y - HERO_GROUND_OFFSET),
        ) + HERO_GROUND_OFFSET;
        targetYaw = Math.atan2(nx, nz);
        moving = movedDistance > 0.001;
        stuckDuration = movedDistance <= 0.0005 && travel > 0.001 ? stuckDuration + dt : 0;

        const waypointRemaining = Math.hypot(waypoint.x - resolved.x, waypoint.z - resolved.z);
        if (waypointRemaining <= WAYPOINT_REACHED_DISTANCE) currentWaypointIndex++;
        if (currentWaypointIndex >= currentPath.length) {
          if (currentPathPartial && routeRequest) {
            const requested = { ...routeRequest };
            clearCurrentPath();
            routeRequest = requested;
            currentPathPartial = true;
            lastRoutePlanAt = -Infinity;
          } else {
            clearMovementRoute();
            reachedDestination = true;
            targetMarker.visible = false;
          }
        } else if (stuckDuration >= STUCK_REPATH_DELAY && routeRequest && elapsed - lastRepathAt >= REPATH_COOLDOWN) {
          const requested = { ...routeRequest };
          lastRepathAt = elapsed;
          planMovementRoute(requested, true);
        }
      }
    }

    if (!movementLocked && reachedDestination && attackOrder?.kind === 'ground') {
      triggerAttack();
      attackOrder = null;
      attackMarker.visible = false;
    }

    if (!movementLocked) {
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

    updateCamera(dt);
    updateMinimapCameraViewport();
    textures.water.offset.set(Math.sin(elapsed * 0.12) * 0.025, -elapsed * 0.055);
    textures.waterFlow.offset.set(Math.sin(elapsed * 0.17) * 0.035, -elapsed * 0.07);
    for (const surface of waterSurfaces) animateRiverSurface(surface, elapsed);
    waterEffects.update(elapsed, [hero.root]);
    for (const animateMapObject of mapAnimations) animateMapObject(elapsed);
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
      selection.dispose();
      heroOverlay.dispose();
      disposeScene(scene);
      renderer.dispose();
      minimapRenderer?.dispose();
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
      if (minimapRenderer && minimapHost && minimapRenderer.domElement.parentElement === minimapHost) {
        minimapHost.removeChild(minimapRenderer.domElement);
      }
      if (minimapViewportSvg && minimapHost && minimapViewportSvg.parentElement === minimapHost) {
        minimapHost.removeChild(minimapViewportSvg);
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
      sprite.visible = state !== null && state.hero.currentHp > 0;
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
