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
const SHOP_SELECTION_RADIUS = 2.55;
let disposeActiveWorldShopSystem: (() => void) | null = null;

export function ensureWorldShopSystem(
  scene: THREE.Scene,
  registry: GameEntityRegistry,
  battlefield: THREE.Object3D,
  localTeam: TeamId = 'blue',
): WorldShopSystem {
  const existing = scene.userData[SYSTEM_KEY] as WorldShopSystem | undefined;
  if (existing) return existing;

  // React StrictMode can recreate the Three.js scene in development. Keep only one set of
  // global input listeners alive at a time even when the previous scene has just been torn down.
  disposeActiveWorldShopSystem?.();

  const shopRoots = new Map<TeamId, THREE.Group>();
  for (const team of ['blue', 'red'] as const) {
    const shop = buildBaseShop(team);
    const center = team === 'blue' ? DAWNREACH_LAYOUT.blueBase : DAWNREACH_LAYOUT.redBase;
    const direction = team === 'blue' ? 1 : -1;
    shop.position.set(
      center.x + direction * 5.6,
      BASE_LAYOUT.elevation + 0.04,
      center.z - direction * 4.8,
    );
    shop.rotation.y = team === 'blue' ? -0.64 : Math.PI - 0.64;
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
      visionRadius: 9,
      visionHeight: 4.4,
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
    for (const shop of shopRoots.values()) registry.unregister(shop);
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

  const stoneTexture = buildStoneTexture(blue ? '#74766d' : '#766663', blue ? '#a09d88' : '#9f8880');
  const fabricTexture = buildFabricTexture(blue ? '#315f76' : '#793d3b', blue ? '#80c8dc' : '#cf776d');

  const stone = new THREE.MeshStandardMaterial({
    color: blue ? 0x777a70 : 0x756765,
    map: stoneTexture,
    roughness: 0.91,
    metalness: 0.03,
  });
  const stoneLight = new THREE.MeshStandardMaterial({
    color: blue ? 0xb6af99 : 0xb29d91,
    roughness: 0.86,
    metalness: 0.03,
  });
  const darkStone = new THREE.MeshStandardMaterial({
    color: blue ? 0x30383b : 0x3b3032,
    roughness: 0.94,
    metalness: 0.04,
  });
  const brass = new THREE.MeshStandardMaterial({
    color: 0xb89755,
    roughness: 0.38,
    metalness: 0.62,
  });
  const metal = new THREE.MeshStandardMaterial({
    color: blue ? 0x35484e : 0x493a3b,
    roughness: 0.5,
    metalness: 0.5,
  });
  const cloth = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: fabricTexture,
    roughness: 0.78,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const glow = new THREE.MeshStandardMaterial({
    color: blue ? 0x89dcef : 0xef8d7f,
    emissive: blue ? 0x1d718f : 0x8b2928,
    emissiveIntensity: 1.15,
    roughness: 0.28,
    metalness: 0.18,
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

  addMesh(new THREE.CylinderGeometry(3.05, 3.38, 0.42, 8), darkStone, [0, 0.21, 0], 'shop-foundation');
  addMesh(new THREE.CylinderGeometry(2.74, 2.92, 0.16, 8), stone, [0, 0.5, 0]);
  addMesh(new THREE.RingGeometry(2.24, 2.62, 8), brass, [0, 0.595, 0]).rotation.x = -Math.PI / 2;

  // Rear masonry and display alcove.
  addMesh(new THREE.BoxGeometry(4.7, 2.55, 0.46), stone, [0, 1.78, 1.6]);
  addMesh(new THREE.BoxGeometry(4.15, 0.16, 0.58), stoneLight, [0, 3.02, 1.57]);
  for (const x of [-2.18, 2.18]) {
    addMesh(new THREE.CylinderGeometry(0.28, 0.34, 3.25, 8), stoneLight, [x, 1.77, 1.35]);
    addMesh(new THREE.CylinderGeometry(0.42, 0.42, 0.16, 8), brass, [x, 3.38, 1.35]);
  }

  // Merchant counter with brass edge and inset drawers.
  addMesh(new THREE.BoxGeometry(4.35, 0.92, 0.86), darkStone, [0, 1.02, -0.56], 'shop-counter');
  addMesh(new THREE.BoxGeometry(4.55, 0.12, 1.02), brass, [0, 1.53, -0.56]);
  for (const x of [-1.42, 0, 1.42]) {
    addMesh(new THREE.BoxGeometry(1.08, 0.42, 0.06), metal, [x, 1.0, -1.01]);
    addMesh(new THREE.BoxGeometry(0.18, 0.08, 0.08), brass, [x, 1.0, -1.06]);
  }

  // Shelf stock gives the building the readable silhouette of an actual store.
  for (const shelfY of [1.52, 2.22]) {
    addMesh(new THREE.BoxGeometry(3.72, 0.1, 0.52), brass, [0, shelfY, 1.27]);
  }
  const stockColors = blue
    ? [0x83cfdf, 0xd8b76b, 0x79b98d, 0xc58bd5]
    : [0xd47870, 0xd7ad62, 0x8eaa77, 0xb984c2];
  for (let row = 0; row < 2; row++) {
    for (let column = 0; column < 6; column++) {
      const stockMaterial = new THREE.MeshStandardMaterial({
        color: stockColors[(row * 2 + column) % stockColors.length],
        emissive: stockColors[(row * 2 + column) % stockColors.length],
        emissiveIntensity: 0.12,
        roughness: 0.42,
        metalness: 0.14,
      });
      const vial = addMesh(
        new THREE.CylinderGeometry(0.11, 0.15, 0.38 + (column % 2) * 0.08, 6),
        stockMaterial,
        [-1.58 + column * 0.63, 1.82 + row * 0.7, 1.05],
      );
      vial.rotation.y = column * 0.21;
    }
  }

  // Four-sided pavilion roof and woven faction awning.
  const roof = addMesh(new THREE.ConeGeometry(3.42, 1.26, 4), metal, [0, 4.05, 0.68], 'shop-roof');
  roof.rotation.y = Math.PI / 4;
  roof.scale.z = 0.86;
  const awning = addMesh(new THREE.BoxGeometry(4.35, 0.08, 1.62), cloth, [0, 3.34, -0.44], 'shop-awning');
  awning.rotation.x = -0.16;

  // Hanging market sign: a brass coin surrounded by a faction-lit halo.
  const signFrame = addMesh(new THREE.TorusGeometry(0.58, 0.08, 10, 48), brass, [0, 3.25, -1.42], 'shop-sign-ring');
  signFrame.rotation.x = Math.PI / 2;
  const signDisc = addMesh(new THREE.CylinderGeometry(0.42, 0.42, 0.09, 32), darkStone, [0, 3.25, -1.42]);
  signDisc.rotation.x = Math.PI / 2;
  const coin = addMesh(new THREE.CylinderGeometry(0.21, 0.21, 0.12, 24), brass, [0, 3.25, -1.49]);
  coin.rotation.x = Math.PI / 2;
  const rune = addMesh(new THREE.OctahedronGeometry(0.105, 0), glow, [0, 3.25, -1.57]);
  rune.rotation.z = Math.PI / 4;

  for (const x of [-2.0, 2.0]) {
    addMesh(new THREE.CylinderGeometry(0.11, 0.14, 1.02, 8), brass, [x, 2.85, -0.84]);
    const lantern = addMesh(new THREE.OctahedronGeometry(0.27, 0), glow, [x, 2.28, -0.84], 'shop-lantern');
    lantern.rotation.y = Math.PI / 4;
    const light = new THREE.PointLight(blue ? 0x7acfe9 : 0xe88074, 1.05, 5.8, 2);
    light.position.set(x, 2.3, -0.84);
    root.add(light);
  }

  // Small side crates and bound scrolls break up the footprint without visual clutter.
  for (const side of [-1, 1]) {
    const crate = addMesh(new THREE.BoxGeometry(0.84, 0.68, 0.78), stone, [side * 2.32, 0.9, 0.22]);
    crate.rotation.y = side * 0.13;
    addMesh(new THREE.BoxGeometry(0.92, 0.08, 0.84), brass, [side * 2.32, 1.26, 0.22]);
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

function buildStoneTexture(dark: string, light: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = dark;
  ctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const offset = y % 2 === 0 ? 0 : 16;
      const shade = (x * 17 + y * 31) % 5;
      ctx.globalAlpha = 0.11 + shade * 0.018;
      ctx.fillStyle = light;
      ctx.fillRect(x * 36 - offset + 2, y * 32 + 2, 31, 27);
    }
  }
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.6, 1.6);
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
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = accent;
  ctx.lineWidth = 5;
  for (let x = -256; x < 512; x += 34) {
    ctx.beginPath();
    ctx.moveTo(x, 256);
    ctx.lineTo(x + 256, 0);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.12;
  ctx.lineWidth = 1;
  for (let y = 0; y < 256; y += 7) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(1.2, 0.8);
  return texture;
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
