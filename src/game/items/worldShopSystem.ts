import * as THREE from 'three';
import type { GameEntityRegistry, TeamId } from '../entities/gameEntities';
import { BASE_LAYOUT, DAWNREACH_LAYOUT } from '../map/mapLayout';
import { getItemDefinition, type ItemDefinition } from './itemDatabase';
import {
  ITEM_DROP_EVENT,
  ITEM_PICKUP_REQUEST_EVENT,
  ITEM_PICKUP_RESULT_EVENT,
  SHOP_OPEN_EVENT,
  type ItemDropDetail,
  type ItemPickupRequestDetail,
  type ItemPickupResultDetail,
  type ShopOpenDetail,
} from './shopEvents';

type GroundItem = {
  id: string;
  itemId: string;
  root: THREE.Group;
  baseY: number;
  createdAt: number;
  awaitingPickup: boolean;
};

type WorldShopSystem = {
  dispose(): void;
};

const SYSTEM_KEY = 'dawnreachWorldShopSystem';
const PICKUP_DISTANCE = 1.2;
const SHOP_WORLD_SCALE = 0.52;
const SHOP_LOCAL_FOOTPRINT_RADIUS = 3.0;
const SHOP_WORLD_FOOTPRINT_RADIUS = SHOP_LOCAL_FOOTPRINT_RADIUS * SHOP_WORLD_SCALE;
const SHOP_SELECTION_RADIUS = 1.72;
const SHOP_WALL_GAP = 0.28;
let disposeActiveWorldShopSystem: (() => void) | null = null;

export function ensureWorldShopSystem(
  scene: THREE.Scene,
  registry: GameEntityRegistry,
  battlefield: THREE.Object3D,
  localTeam: TeamId = 'blue',
): WorldShopSystem {
  const existing = scene.userData[SYSTEM_KEY] as WorldShopSystem | undefined;
  if (existing) return existing;

  disposeActiveWorldShopSystem?.();

  const shopRoots = new Map<TeamId, THREE.Group>();
  for (const team of ['blue', 'red'] as const) {
    const shop = buildBaseShop(team);
    const center = team === 'blue' ? DAWNREACH_LAYOUT.blueBase : DAWNREACH_LAYOUT.redBase;

    // Put the merchant at the true rear of each citadel, just inside the retaining wall.
    // The base-center vector points away from the battlefield center and keeps both teams
    // perfectly mirrored even if the base layout changes later.
    const rear = new THREE.Vector2(center.x, center.z).normalize();
    const rearDistance = BASE_LAYOUT.radius - SHOP_WORLD_FOOTPRINT_RADIUS - SHOP_WALL_GAP;
    shop.position.set(
      center.x + rear.x * rearDistance,
      BASE_LAYOUT.elevation + 0.045,
      center.z + rear.y * rearDistance,
    );
    shop.rotation.y = Math.atan2(rear.x, rear.y);
    shop.scale.setScalar(SHOP_WORLD_SCALE);
    battlefield.add(shop);
    shopRoots.set(team, shop);

    registry.register(shop, {
      id: `${team}-shop`,
      displayName: team === 'blue' ? 'Mercado del Alba' : 'Mercado del Ocaso',
      kind: 'shop',
      team,
      selectable: true,
      targetable: false,
      grantsVision: true,
      visionRadius: 8,
      visionHeight: 2.7,
      attackRange: 0,
      visibilityPolicy: 'structure-in-fog',
      interaction: 'shop',
      selectionRadius: SHOP_SELECTION_RADIUS,
      maxHp: 0,
      showHealthBar: false,
    });
  }

  battlefield.updateMatrixWorld(true);

  const groundItems = new Map<string, GroundItem>();
  const pointer = new THREE.Vector2();
  const pointerRaycaster = new THREE.Raycaster();
  const heroPosition = new THREE.Vector3();
  let gameplayCamera: THREE.Camera | null = null;
  let pendingGroundId: string | null = null;
  let disposed = false;
  let dropCounter = 0;

  const isGameplayCanvas = (target: EventTarget | null): target is HTMLCanvasElement => (
    target instanceof HTMLCanvasElement && target.classList.contains('game-canvas')
  );

  const updatePointer = (event: PointerEvent) => {
    if (!isGameplayCanvas(event.target)) return false;
    const rect = event.target.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
    return true;
  };

  const findGroundItemFromObject = (object: THREE.Object3D | null) => {
    let current = object;
    while (current) {
      const groundId = current.userData.groundItemId as string | undefined;
      if (groundId) return groundItems.get(groundId) ?? null;
      current = current.parent;
    }
    return null;
  };

  const removeGroundItem = (ground: GroundItem) => {
    groundItems.delete(ground.id);
    if (pendingGroundId === ground.id) pendingGroundId = null;
    ground.root.removeFromParent();
    disposeObject3D(ground.root);
  };

  const onPointerDown = (event: PointerEvent) => {
    if ((event.button !== 0 && event.button !== 2) || !gameplayCamera || !updatePointer(event)) return;
    pointerRaycaster.setFromCamera(pointer, gameplayCamera);

    if (event.button === 0) {
      const localShop = shopRoots.get(localTeam);
      if (!localShop) return;
      const shopHit = pointerRaycaster.intersectObject(localShop, true)[0];
      if (!shopHit) return;
      window.dispatchEvent(new CustomEvent<ShopOpenDetail>(SHOP_OPEN_EVENT, {
        detail: { shopId: `${localTeam}-shop`, team: localTeam === 'red' ? 'red' : 'blue' },
      }));
      return;
    }

    const dropRoots = Array.from(groundItems.values(), ground => ground.root);
    if (dropRoots.length === 0) return;
    const hit = pointerRaycaster.intersectObjects(dropRoots, true)[0];
    const ground = findGroundItemFromObject(hit?.object ?? null);
    if (!ground) return;
    pendingGroundId = ground.id;
    ground.awaitingPickup = false;
  };

  const onItemDrop = (event: Event) => {
    const detail = (event as CustomEvent<ItemDropDetail>).detail;
    if (!detail?.itemId || !detail.token || groundItems.has(detail.token)) return;
    const definition = getItemDefinition(detail.itemId);
    const localHero = registry.values().find(entity => entity.kind === 'hero' && entity.team === localTeam);
    if (!definition || !localHero?.root.parent) return;

    localHero.root.getWorldPosition(heroPosition);
    const angle = (dropCounter++ * 2.399963229728653) % (Math.PI * 2);
    const distance = 0.82 + (dropCounter % 3) * 0.18;
    const root = buildGroundItem(definition, detail.token);
    root.position.set(
      heroPosition.x + Math.cos(angle) * distance,
      heroPosition.y + 0.05,
      heroPosition.z + Math.sin(angle) * distance,
    );
    scene.add(root);

    groundItems.set(detail.token, {
      id: detail.token,
      itemId: detail.itemId,
      root,
      baseY: root.position.y,
      createdAt: performance.now() * 0.001,
      awaitingPickup: false,
    });
  };

  const onPickupResult = (event: Event) => {
    const detail = (event as CustomEvent<ItemPickupResultDetail>).detail;
    if (!detail?.groundId) return;
    const ground = groundItems.get(detail.groundId);
    if (!ground) return;
    ground.awaitingPickup = false;
    if (detail.accepted) removeGroundItem(ground);
    else if (pendingGroundId === ground.id) pendingGroundId = null;
  };

  window.addEventListener('pointerdown', onPointerDown);
  window.addEventListener(ITEM_DROP_EVENT, onItemDrop as EventListener);
  window.addEventListener(ITEM_PICKUP_RESULT_EVENT, onPickupResult as EventListener);

  const previousSceneBeforeRender = scene.onBeforeRender;
  const beforeRender: typeof scene.onBeforeRender = function(
    renderer,
    renderedScene,
    camera,
    geometry,
    material,
    group,
  ) {
    const minimapCamera = camera.position.y > 60 && camera.up.z < -0.5;
    if (!minimapCamera) gameplayCamera = camera;

    const now = performance.now() * 0.001;
    for (const ground of groundItems.values()) {
      const age = Math.max(0, now - ground.createdAt);
      ground.root.position.y = ground.baseY + 0.08 + Math.sin(age * 2.7) * 0.055;
      const jewel = ground.root.getObjectByName('ground-item-jewel');
      if (jewel) jewel.rotation.y = age * 0.65;
      const ring = ground.root.getObjectByName('ground-item-ring');
      if (ring) ring.rotation.z = age * 0.24;
    }

    const pending = pendingGroundId ? groundItems.get(pendingGroundId) ?? null : null;
    if (pending && !pending.awaitingPickup) {
      const localHero = registry.values().find(entity => entity.kind === 'hero' && entity.team === localTeam);
      if (!localHero?.alive || !localHero.root.parent) {
        pendingGroundId = null;
      } else {
        localHero.root.getWorldPosition(heroPosition);
        const distance = Math.hypot(
          pending.root.position.x - heroPosition.x,
          pending.root.position.z - heroPosition.z,
        );
        if (distance <= PICKUP_DISTANCE) {
          pending.awaitingPickup = true;
          window.dispatchEvent(new CustomEvent<ItemPickupRequestDetail>(ITEM_PICKUP_REQUEST_EVENT, {
            detail: { groundId: pending.id, itemId: pending.itemId },
          }));
        }
      }
    }

    previousSceneBeforeRender.call(this, renderer, renderedScene, camera, geometry, material, group);
  };
  scene.onBeforeRender = beforeRender;

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener(ITEM_DROP_EVENT, onItemDrop as EventListener);
    window.removeEventListener(ITEM_PICKUP_RESULT_EVENT, onPickupResult as EventListener);
    if (scene.onBeforeRender === beforeRender) scene.onBeforeRender = previousSceneBeforeRender;
    for (const ground of [...groundItems.values()]) removeGroundItem(ground);
    for (const shop of shopRoots.values()) {
      registry.unregister(shop);
      shop.removeFromParent();
      disposeObject3D(shop);
    }
    delete scene.userData[SYSTEM_KEY];
    if (disposeActiveWorldShopSystem === dispose) disposeActiveWorldShopSystem = null;
  };

  const system = { dispose };
  scene.userData[SYSTEM_KEY] = system;
  disposeActiveWorldShopSystem = dispose;
  return system;
}

function buildBaseShop(team: 'blue' | 'red') {
  const blue = team === 'blue';
  const root = new THREE.Group();
  root.name = `${team}-shop`;
  root.userData.structureKind = 'shop';
  root.userData.collisionRadius = SHOP_WORLD_FOOTPRINT_RADIUS;

  const stoneTexture = buildStoneTexture(
    blue ? '#73776f' : '#756762',
    blue ? '#b9b59d' : '#b69b90',
    blue ? '#505955' : '#594a48',
  );
  const fabricTexture = buildFabricTexture(
    blue ? '#23495b' : '#672f32',
    blue ? '#8bcddd' : '#d8887d',
  );
  const roofTexture = buildRoofTexture(
    blue ? '#1f343d' : '#412b2e',
    blue ? '#496a73' : '#745052',
  );
  const woodTexture = buildWoodTexture(blue ? '#4a3c2f' : '#4b342f', blue ? '#836f54' : '#79544b');

  const stone = new THREE.MeshStandardMaterial({
    color: blue ? 0x95978a : 0x95817b,
    map: stoneTexture,
    bumpMap: stoneTexture,
    bumpScale: 0.045,
    roughness: 0.93,
    metalness: 0.02,
  });
  const stoneLight = new THREE.MeshStandardMaterial({
    color: blue ? 0xc0baa2 : 0xbfa69a,
    map: stoneTexture,
    bumpMap: stoneTexture,
    bumpScale: 0.028,
    roughness: 0.88,
    metalness: 0.025,
  });
  const darkStone = new THREE.MeshStandardMaterial({
    color: blue ? 0x454e4d : 0x524344,
    map: stoneTexture,
    bumpMap: stoneTexture,
    bumpScale: 0.055,
    roughness: 0.96,
    metalness: 0.03,
  });
  const brass = new THREE.MeshStandardMaterial({
    color: 0xc39a4d,
    roughness: 0.3,
    metalness: 0.7,
  });
  const agedBrass = new THREE.MeshStandardMaterial({
    color: 0x856b3b,
    roughness: 0.48,
    metalness: 0.54,
  });
  const roofMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: roofTexture,
    bumpMap: roofTexture,
    bumpScale: 0.025,
    roughness: 0.68,
    metalness: 0.16,
  });
  const wood = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: woodTexture,
    bumpMap: woodTexture,
    bumpScale: 0.025,
    roughness: 0.72,
    metalness: 0.02,
  });
  const cloth = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: fabricTexture,
    bumpMap: fabricTexture,
    bumpScale: 0.012,
    roughness: 0.82,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const glow = new THREE.MeshStandardMaterial({
    color: blue ? 0x96e6f5 : 0xf29c8f,
    emissive: blue ? 0x17617a : 0x7b2828,
    emissiveIntensity: 0.82,
    roughness: 0.3,
    metalness: 0.16,
  });

  const addMesh = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    position: [number, number, number],
    name?: string,
  ) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    if (name) mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  };

  // Compact two-step plinth. The brass inlay is deliberately thin so it reads as crafted
  // trim rather than another thick platform from the isometric camera.
  addMesh(new THREE.CylinderGeometry(2.78, 3.0, 0.34, 12), darkStone, [0, 0.17, 0], 'shop-foundation');
  addMesh(new THREE.CylinderGeometry(2.50, 2.70, 0.13, 12), stone, [0, 0.405, 0]);
  const plinthInlay = addMesh(new THREE.RingGeometry(2.18, 2.37, 12), agedBrass, [0, 0.482, 0]);
  plinthInlay.rotation.x = -Math.PI / 2;

  // Rear wall is treated like a small premium market alcove rather than a solid bunker.
  addMesh(new THREE.BoxGeometry(4.28, 2.28, 0.34), stone, [0, 1.62, 1.34], 'shop-rear-wall');
  addMesh(new THREE.BoxGeometry(3.84, 0.11, 0.44), brass, [0, 2.72, 1.30]);
  addMesh(new THREE.BoxGeometry(3.72, 0.08, 0.38), stoneLight, [0, 2.57, 1.29]);

  for (const x of [-1.94, 1.94]) {
    addMesh(new THREE.CylinderGeometry(0.19, 0.25, 2.82, 10), stoneLight, [x, 1.57, 1.18]);
    addMesh(new THREE.CylinderGeometry(0.31, 0.31, 0.12, 10), brass, [x, 2.98, 1.18]);
  }

  // Warm wood counter, thin metal edging, and inset brass pulls make it read as furniture.
  addMesh(new THREE.BoxGeometry(3.72, 0.74, 0.78), wood, [0, 0.92, -0.55], 'shop-counter');
  addMesh(new THREE.BoxGeometry(3.94, 0.085, 0.92), brass, [0, 1.335, -0.55]);
  addMesh(new THREE.BoxGeometry(3.62, 0.08, 0.68), darkStone, [0, 0.56, -0.55]);
  for (const x of [-1.18, 0, 1.18]) {
    addMesh(new THREE.BoxGeometry(0.92, 0.31, 0.045), darkStone, [x, 0.91, -0.955]);
    addMesh(new THREE.BoxGeometry(0.18, 0.055, 0.055), brass, [x, 0.91, -0.995]);
  }

  // Recessed shelves use wood instead of gold bars, reducing the chunky look in the screenshot.
  for (const shelfY of [1.43, 2.05]) {
    addMesh(new THREE.BoxGeometry(3.25, 0.09, 0.44), wood, [0, shelfY, 1.12]);
    addMesh(new THREE.BoxGeometry(3.30, 0.035, 0.48), agedBrass, [0, shelfY + 0.055, 1.12]);
  }

  const stockColors = blue
    ? [0x8bd9e7, 0xd8b66f, 0x86bc96, 0xb99ad2]
    : [0xdd8a80, 0xd8b66f, 0x94ae82, 0xb994c4];
  for (let row = 0; row < 2; row++) {
    for (let column = 0; column < 5; column++) {
      const stockColor = stockColors[(row * 2 + column) % stockColors.length];
      const stockMaterial = new THREE.MeshStandardMaterial({
        color: stockColor,
        emissive: stockColor,
        emissiveIntensity: 0.08,
        roughness: 0.38,
        metalness: 0.12,
      });
      const vial = addMesh(
        new THREE.CylinderGeometry(0.095, 0.13, 0.31 + (column % 2) * 0.07, 8),
        stockMaterial,
        [-1.28 + column * 0.64, 1.69 + row * 0.62, 0.96],
      );
      vial.rotation.y = column * 0.17;
      addMesh(new THREE.CylinderGeometry(0.105, 0.105, 0.055, 8), brass, [
        -1.28 + column * 0.64,
        1.87 + row * 0.62 + (column % 2) * 0.035,
        0.96,
      ]);
    }
  }

  // Layered octagonal slate roof: a much smaller, more detailed silhouette than the old
  // oversized four-sided pyramid. Brass eaves and finial catch light without dominating it.
  const eave = addMesh(new THREE.CylinderGeometry(2.58, 2.78, 0.15, 8), agedBrass, [0, 3.05, 0.42], 'shop-roof-eave');
  eave.rotation.y = Math.PI / 8;
  const roof = addMesh(new THREE.ConeGeometry(2.60, 0.92, 8), roofMaterial, [0, 3.52, 0.42], 'shop-roof');
  roof.rotation.y = Math.PI / 8;
  const roofCap = addMesh(new THREE.CylinderGeometry(0.46, 0.60, 0.16, 8), brass, [0, 4.02, 0.42]);
  roofCap.rotation.y = Math.PI / 8;
  const finial = addMesh(new THREE.OctahedronGeometry(0.22, 0), glow, [0, 4.34, 0.42], 'shop-finial');
  finial.rotation.y = Math.PI / 4;

  // Narrow woven awning with a separate brass hem instead of one thick slab.
  const awning = addMesh(new THREE.BoxGeometry(3.55, 0.055, 1.24), cloth, [0, 2.82, -0.46], 'shop-awning');
  awning.rotation.x = -0.15;
  const awningHem = addMesh(new THREE.BoxGeometry(3.60, 0.055, 0.10), brass, [0, 2.72, -1.08]);
  awningHem.rotation.x = -0.15;

  // Compact hanging guild seal.
  const signFrame = addMesh(new THREE.TorusGeometry(0.47, 0.055, 10, 48), brass, [0, 2.72, -1.26], 'shop-sign-ring');
  signFrame.rotation.x = Math.PI / 2;
  const signDisc = addMesh(new THREE.CylinderGeometry(0.34, 0.34, 0.065, 32), darkStone, [0, 2.72, -1.26]);
  signDisc.rotation.x = Math.PI / 2;
  const coin = addMesh(new THREE.CylinderGeometry(0.17, 0.17, 0.09, 24), brass, [0, 2.72, -1.31]);
  coin.rotation.x = Math.PI / 2;
  const rune = addMesh(new THREE.OctahedronGeometry(0.085, 0), glow, [0, 2.72, -1.37]);
  rune.rotation.z = Math.PI / 4;

  for (const x of [-1.58, 1.58]) {
    addMesh(new THREE.CylinderGeometry(0.075, 0.10, 0.74, 8), agedBrass, [x, 2.50, -0.76]);
    const lantern = addMesh(new THREE.OctahedronGeometry(0.20, 0), glow, [x, 2.08, -0.76], 'shop-lantern');
    lantern.rotation.y = Math.PI / 4;
    const light = new THREE.PointLight(blue ? 0x79cfe6 : 0xe98579, 0.56, 3.4, 2);
    light.position.set(x, 2.08, -0.76);
    root.add(light);
  }

  // Small merchant props keep the lower silhouette organic without stealing plaza space.
  for (const side of [-1, 1]) {
    const crate = addMesh(new THREE.BoxGeometry(0.62, 0.48, 0.58), wood, [side * 1.96, 0.75, 0.10]);
    crate.rotation.y = side * 0.16;
    const strap = addMesh(new THREE.BoxGeometry(0.68, 0.05, 0.63), agedBrass, [side * 1.96, 1.01, 0.10]);
    strap.rotation.y = side * 0.16;
  }

  root.traverse((object) => {
    object.userData.shopVisual = true;
  });
  return root;
}

function buildGroundItem(definition: ItemDefinition, groundId: string) {
  const root = new THREE.Group();
  root.name = `ground-item-${definition.id}`;
  root.userData.groundItemId = groundId;
  root.userData.itemId = definition.id;

  const tierColor = definition.tier === 'Avanzado'
    ? 0xd7ad62
    : definition.tier === 'Intermedio'
      ? 0x73bcd5
      : 0x90c98d;
  const baseMaterial = new THREE.MeshStandardMaterial({
    color: 0x252c2d,
    roughness: 0.62,
    metalness: 0.38,
  });
  const trimMaterial = new THREE.MeshStandardMaterial({
    color: tierColor,
    emissive: tierColor,
    emissiveIntensity: 0.24,
    roughness: 0.34,
    metalness: 0.48,
  });

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.025, 8, 40), trimMaterial);
  ring.name = 'ground-item-ring';
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.04;
  root.add(ring);

  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.37, 0.13, 8), baseMaterial);
  pedestal.position.y = 0.09;
  pedestal.castShadow = true;
  pedestal.receiveShadow = true;
  root.add(pedestal);

  const jewel = new THREE.Mesh(new THREE.OctahedronGeometry(0.23, 0), trimMaterial);
  jewel.name = 'ground-item-jewel';
  jewel.position.y = 0.48;
  jewel.rotation.z = Math.PI / 4;
  jewel.castShadow = true;
  root.add(jewel);

  const sprite = buildItemLabelSprite(definition, tierColor);
  sprite.position.y = 1.03;
  root.add(sprite);

  root.traverse(object => {
    object.userData.groundItemId = groundId;
  });
  return root;
}

function buildItemLabelSprite(definition: ItemDefinition, tierColor: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.Sprite(new THREE.SpriteMaterial({ color: tierColor }));

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(5, 10, 12, 0.82)';
  ctx.beginPath();
  ctx.roundRect(2, 4, 252, 56, 12);
  ctx.fill();
  ctx.strokeStyle = `#${tierColor.toString(16).padStart(6, '0')}`;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.font = '600 22px Trebuchet MS, Segoe UI, sans-serif';
  ctx.fillStyle = '#f0ead7';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = definition.name.length > 24 ? `${definition.name.slice(0, 22)}…` : definition.name;
  ctx.fillText(label, 128, 32);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(2.65, 0.66, 1);
  sprite.renderOrder = 110;
  return sprite;
}

function buildStoneTexture(dark: string, light: string, grout: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 384;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = grout;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const rowHeight = 48;
  const blockWidth = 72;
  for (let row = 0; row < 9; row++) {
    const y = row * rowHeight - 4;
    const offset = row % 2 === 0 ? -18 : -54;
    for (let column = -1; column < 7; column++) {
      const x = offset + column * blockWidth;
      const seed = hashTexture(row * 13 + column * 29 + 17);
      const inset = 3 + seed * 2;
      const gradient = ctx.createLinearGradient(x, y, x + blockWidth, y + rowHeight);
      gradient.addColorStop(0, dark);
      gradient.addColorStop(0.52, light);
      gradient.addColorStop(1, dark);
      ctx.globalAlpha = 0.76 + seed * 0.17;
      ctx.fillStyle = gradient;
      ctx.fillRect(x + inset, y + inset, blockWidth - inset * 2, rowHeight - inset * 2);

      ctx.globalAlpha = 0.16;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + inset + 2, y + inset + 2, blockWidth - inset * 2 - 4, 2);
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = '#000000';
      ctx.fillRect(x + inset + 2, y + rowHeight - inset - 4, blockWidth - inset * 2 - 4, 2);
    }
  }

  // Fine mineral flecks keep close shots from reading like flat painted rectangles.
  for (let index = 0; index < 220; index++) {
    const x = hashTexture(index * 31 + 11) * canvas.width;
    const y = hashTexture(index * 47 + 19) * canvas.height;
    const size = 0.6 + hashTexture(index * 59 + 7) * 1.5;
    ctx.globalAlpha = 0.05 + hashTexture(index * 71 + 5) * 0.08;
    ctx.fillStyle = index % 2 === 0 ? '#ffffff' : '#000000';
    ctx.fillRect(x, y, size, size);
  }

  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.75, 1.75);
  texture.anisotropy = 4;
  return texture;
}

function buildFabricTexture(base: string, accent: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);

  // Fine woven thread instead of the old broad diagonal stripes.
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.055;
  for (let x = 0; x < 256; x += 5) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 256);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.045;
  for (let y = 0; y < 256; y += 4) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }

  ctx.globalAlpha = 0.32;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 7;
  for (const x of [28, 128, 228]) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 256);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.16;
  ctx.lineWidth = 2;
  for (const x of [18, 38, 118, 138, 218, 238]) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 256);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.1, 0.8);
  texture.anisotropy = 4;
  return texture;
}

function buildRoofTexture(base: string, edge: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 320;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 320, 320);
  const tileWidth = 48;
  const tileHeight = 34;
  for (let row = 0; row < 11; row++) {
    const offset = row % 2 === 0 ? -24 : 0;
    for (let column = -1; column < 8; column++) {
      const x = offset + column * tileWidth;
      const y = row * tileHeight - 8;
      const shade = hashTexture(row * 37 + column * 23 + 9);
      ctx.globalAlpha = 0.08 + shade * 0.10;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + 2, y + 2, tileWidth - 5, tileHeight - 5);
      ctx.globalAlpha = 0.24;
      ctx.strokeStyle = edge;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, tileWidth - 3, tileHeight - 3);
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = '#000000';
      ctx.fillRect(x + 3, y + tileHeight - 5, tileWidth - 7, 2);
    }
  }
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2.1, 2.1);
  texture.anisotropy = 4;
  return texture;
}

function buildWoodTexture(base: string, grain: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  for (let line = 0; line < 34; line++) {
    const y = line * 8 + (line % 3) * 1.5;
    ctx.globalAlpha = 0.08 + hashTexture(line * 41 + 3) * 0.10;
    ctx.strokeStyle = grain;
    ctx.lineWidth = 1 + hashTexture(line * 17 + 5) * 1.4;
    ctx.beginPath();
    for (let x = 0; x <= 256; x += 16) {
      const wave = Math.sin(x * 0.045 + line * 0.7) * 2.2;
      if (x === 0) ctx.moveTo(x, y + wave);
      else ctx.lineTo(x, y + wave);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.4, 1.4);
  texture.anisotropy = 4;
  return texture;
}

function hashTexture(seed: number) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function disposeObject3D(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Sprite)) return;
    if (object instanceof THREE.Mesh && !geometries.has(object.geometry)) {
      geometries.add(object.geometry);
      object.geometry.dispose();
    }
    const materialList = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materialList) {
      if (materials.has(material)) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture && !textures.has(value)) {
          textures.add(value);
          value.dispose();
        }
      }
      material.dispose();
    }
  });
}
