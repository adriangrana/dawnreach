import * as THREE from 'three';
import { makeCanvasTexture } from '../shared/textures';

export type LaneCreepVisualType = 'melee' | 'ranged' | 'flagbearer' | 'siege';
export type LaneCreepVisualTeam = 'blue' | 'red';

type JointSet = {
  pelvis: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  leftHip: THREE.Group;
  rightHip: THREE.Group;
  leftKnee: THREE.Group;
  rightKnee: THREE.Group;
  leftFoot: THREE.Group;
  rightFoot: THREE.Group;
  leftShoulder: THREE.Group;
  rightShoulder: THREE.Group;
  leftElbow: THREE.Group;
  rightElbow: THREE.Group;
  leftHand: THREE.Group;
  rightHand: THREE.Group;
};

export type LaneCreepVisual = {
  root: THREE.Group;
  model: THREE.Group;
  type: LaneCreepVisualType;
  team: LaneCreepVisualTeam;
  phase: number;
  joints: JointSet | null;
  flag: THREE.Group | null;
  weapon: THREE.Group | null;
  wheels: THREE.Group[];
  siegeArm: THREE.Group | null;
  walkWeight: number;
  attackStartedAt: number;
  attackDuration: number;
  lastAnimationAt: number;
};

export type LaneCreepVisualResources = ReturnType<typeof createLaneCreepVisualResources>;

function makeBrocadeTexture(base: string, accent: string, highlight: string) {
  return makeCanvasTexture(128, (ctx, size) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);

    const gradient = ctx.createLinearGradient(0, 0, size, size);
    gradient.addColorStop(0, 'rgba(255,255,255,0.09)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.14)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    for (let offset = -size; offset < size * 2; offset += 24) {
      ctx.beginPath();
      ctx.moveTo(offset, 0);
      ctx.lineTo(offset + size, size);
      ctx.stroke();
    }

    ctx.strokeStyle = highlight;
    ctx.lineWidth = 1;
    for (let y = 12; y < size; y += 24) {
      for (let x = 12; x < size; x += 24) {
        ctx.beginPath();
        ctx.moveTo(x - 4, y);
        ctx.lineTo(x, y - 4);
        ctx.lineTo(x + 4, y);
        ctx.lineTo(x, y + 4);
        ctx.closePath();
        ctx.stroke();
      }
    }
  }, 2, 2);
}

function makeMetalTexture() {
  return makeCanvasTexture(128, (ctx, size) => {
    const gradient = ctx.createLinearGradient(0, 0, size, 0);
    gradient.addColorStop(0, '#7f8c98');
    gradient.addColorStop(0.18, '#c9d3d9');
    gradient.addColorStop(0.42, '#7f8b94');
    gradient.addColorStop(0.62, '#e5ebee');
    gradient.addColorStop(1, '#74808a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    ctx.globalAlpha = 0.18;
    for (let y = 0; y < size; y += 5) {
      ctx.fillStyle = y % 10 === 0 ? '#ffffff' : '#24313b';
      ctx.fillRect(0, y, size, 1);
    }
    ctx.globalAlpha = 1;
  }, 1.5, 1.5);
}

function makeLeatherTexture() {
  return makeCanvasTexture(96, (ctx, size) => {
    ctx.fillStyle = '#4f382a';
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(220,177,111,0.18)';
    ctx.lineWidth = 1;
    for (let y = 3; y < size; y += 6) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y + Math.sin(y) * 2);
      ctx.stroke();
    }
    for (let x = 4; x < size; x += 12) {
      ctx.fillStyle = 'rgba(18,10,7,0.16)';
      ctx.fillRect(x, 0, 1, size);
    }
  }, 2, 2);
}

function makeWoodTexture() {
  return makeCanvasTexture(128, (ctx, size) => {
    ctx.fillStyle = '#6d4a2f';
    ctx.fillRect(0, 0, size, size);
    for (let x = 4; x < size; x += 7) {
      ctx.strokeStyle = x % 14 === 0 ? 'rgba(32,16,8,0.35)' : 'rgba(232,184,111,0.18)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.bezierCurveTo(x - 3, size * 0.25, x + 4, size * 0.65, x - 1, size);
      ctx.stroke();
    }
  }, 2, 1);
}

function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  name: string,
  scale?: [number, number, number],
  position?: [number, number, number],
  rotation?: [number, number, number],
) {
  const result = new THREE.Mesh(geometry, material);
  result.name = name;
  result.castShadow = false;
  result.receiveShadow = false;
  if (scale) result.scale.set(...scale);
  if (position) result.position.set(...position);
  if (rotation) result.rotation.set(...rotation);
  return result;
}

function pivot(parent: THREE.Object3D, name: string, position: [number, number, number]) {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(...position);
  parent.add(group);
  return group;
}

export function createLaneCreepVisualResources() {
  const textures = {
    blueCloth: makeBrocadeTexture('#1f4f93', 'rgba(80,158,255,0.34)', 'rgba(226,198,111,0.52)'),
    redCloth: makeBrocadeTexture('#7a2d31', 'rgba(224,85,79,0.34)', 'rgba(236,190,103,0.52)'),
    metal: makeMetalTexture(),
    leather: makeLeatherTexture(),
    wood: makeWoodTexture(),
  };

  const materials = {
    blueCloth: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.blueCloth,
      roughness: 0.56,
      metalness: 0.08,
    }),
    redCloth: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.redCloth,
      roughness: 0.56,
      metalness: 0.08,
    }),
    polishedSteel: new THREE.MeshStandardMaterial({
      color: 0xbfcbd2,
      map: textures.metal,
      roughness: 0.28,
      metalness: 0.88,
    }),
    darkSteel: new THREE.MeshStandardMaterial({
      color: 0x2f3943,
      map: textures.metal,
      roughness: 0.36,
      metalness: 0.76,
    }),
    gold: new THREE.MeshStandardMaterial({
      color: 0xd9aa4f,
      roughness: 0.28,
      metalness: 0.82,
    }),
    leather: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.leather,
      roughness: 0.82,
      metalness: 0.03,
    }),
    wood: new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: textures.wood,
      roughness: 0.78,
      metalness: 0.04,
    }),
    blueGlow: new THREE.MeshStandardMaterial({
      color: 0x9ed8ff,
      emissive: 0x246bc9,
      emissiveIntensity: 2.2,
      roughness: 0.2,
      metalness: 0.18,
    }),
    redGlow: new THREE.MeshStandardMaterial({
      color: 0xffb09b,
      emissive: 0xb43b36,
      emissiveIntensity: 2.1,
      roughness: 0.2,
      metalness: 0.18,
    }),
    black: new THREE.MeshStandardMaterial({ color: 0x15191d, roughness: 0.72, metalness: 0.4 }),
  };

  const geometries = {
    torso: new THREE.CylinderGeometry(0.31, 0.25, 0.62, 12, 2),
    chestPlate: new THREE.BoxGeometry(0.54, 0.42, 0.12, 2, 2, 1),
    waist: new THREE.CylinderGeometry(0.23, 0.25, 0.22, 10),
    belt: new THREE.TorusGeometry(0.245, 0.032, 6, 16),
    head: new THREE.SphereGeometry(0.21, 12, 8),
    helmet: new THREE.SphereGeometry(0.235, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.67),
    visor: new THREE.BoxGeometry(0.31, 0.08, 0.055),
    crest: new THREE.ConeGeometry(0.09, 0.34, 8),
    shoulder: new THREE.SphereGeometry(0.17, 9, 6),
    upperArm: new THREE.CylinderGeometry(0.085, 0.105, 0.43, 8),
    forearm: new THREE.CylinderGeometry(0.075, 0.095, 0.39, 8),
    gauntlet: new THREE.BoxGeometry(0.13, 0.16, 0.12),
    thigh: new THREE.CylinderGeometry(0.105, 0.13, 0.48, 8),
    shin: new THREE.CylinderGeometry(0.085, 0.115, 0.44, 8),
    knee: new THREE.SphereGeometry(0.12, 8, 6),
    boot: new THREE.BoxGeometry(0.18, 0.16, 0.31),
    tabard: new THREE.PlaneGeometry(0.36, 0.58, 1, 3),
    buckle: new THREE.BoxGeometry(0.11, 0.09, 0.045),
    swordBlade: new THREE.BoxGeometry(0.075, 0.78, 0.045),
    swordCore: new THREE.BoxGeometry(0.018, 0.7, 0.052),
    swordGuard: new THREE.BoxGeometry(0.42, 0.065, 0.08),
    swordGrip: new THREE.CylinderGeometry(0.036, 0.036, 0.27, 8),
    pommel: new THREE.SphereGeometry(0.075, 8, 6),
    shield: new THREE.CylinderGeometry(0.33, 0.33, 0.065, 12),
    shieldBoss: new THREE.SphereGeometry(0.11, 8, 6),
    staff: new THREE.CylinderGeometry(0.037, 0.045, 1.35, 8),
    crystal: new THREE.OctahedronGeometry(0.14, 0),
    ring: new THREE.TorusGeometry(0.19, 0.025, 6, 14),
    flag: new THREE.PlaneGeometry(0.76, 0.5, 3, 2),
    siegeBody: new THREE.BoxGeometry(0.92, 0.34, 1.14),
    siegeDeck: new THREE.BoxGeometry(0.74, 0.10, 0.88),
    siegeWheel: new THREE.CylinderGeometry(0.29, 0.29, 0.12, 12),
    siegeHub: new THREE.CylinderGeometry(0.09, 0.09, 0.16, 10),
    siegeArm: new THREE.BoxGeometry(0.13, 0.13, 1.18),
    siegeSling: new THREE.BoxGeometry(0.34, 0.12, 0.28),
    axle: new THREE.CylinderGeometry(0.055, 0.055, 0.95, 8),
    plate: new THREE.BoxGeometry(0.58, 0.34, 0.07),
    spike: new THREE.ConeGeometry(0.055, 0.26, 7),
  };

  return {
    textures,
    materials,
    geometries,
    dispose() {
      Object.values(geometries).forEach(geometry => geometry.dispose());
      Object.values(materials).forEach(material => material.dispose());
      Object.values(textures).forEach(texture => texture.dispose());
    },
  };
}

function teamCloth(resources: LaneCreepVisualResources, team: LaneCreepVisualTeam) {
  return team === 'blue' ? resources.materials.blueCloth : resources.materials.redCloth;
}

function teamGlow(resources: LaneCreepVisualResources, team: LaneCreepVisualTeam) {
  return team === 'blue' ? resources.materials.blueGlow : resources.materials.redGlow;
}

function addArmorRivet(
  parent: THREE.Object3D,
  resources: LaneCreepVisualResources,
  x: number,
  y: number,
  z: number,
) {
  const rivet = mesh(resources.geometries.pommel, resources.materials.gold, 'armor-rivet', [0.25, 0.25, 0.18], [x, y, z]);
  parent.add(rivet);
}

function buildHumanoid(
  resources: LaneCreepVisualResources,
  team: LaneCreepVisualTeam,
  type: Exclude<LaneCreepVisualType, 'siege'>,
) {
  const root = new THREE.Group();
  const model = new THREE.Group();
  model.name = 'lane-creep-model';
  root.add(model);

  const pelvis = pivot(model, 'creep-pelvis', [0, 0.78, 0]);
  const torso = pivot(pelvis, 'creep-torso', [0, 0.52, 0]);
  const head = pivot(torso, 'creep-head', [0, 0.58, 0]);

  const leftHip = pivot(pelvis, 'left-hip', [-0.16, -0.03, 0]);
  const rightHip = pivot(pelvis, 'right-hip', [0.16, -0.03, 0]);
  const leftKnee = pivot(leftHip, 'left-knee', [0, -0.43, 0]);
  const rightKnee = pivot(rightHip, 'right-knee', [0, -0.43, 0]);
  const leftFoot = pivot(leftKnee, 'left-foot', [0, -0.39, 0]);
  const rightFoot = pivot(rightKnee, 'right-foot', [0, -0.39, 0]);

  const leftShoulder = pivot(torso, 'left-shoulder', [-0.36, 0.27, 0]);
  const rightShoulder = pivot(torso, 'right-shoulder', [0.36, 0.27, 0]);
  const leftElbow = pivot(leftShoulder, 'left-elbow', [0, -0.39, 0]);
  const rightElbow = pivot(rightShoulder, 'right-elbow', [0, -0.39, 0]);
  const leftHand = pivot(leftElbow, 'left-hand', [0, -0.34, 0]);
  const rightHand = pivot(rightElbow, 'right-hand', [0, -0.34, 0]);

  const cloth = teamCloth(resources, team);
  torso.add(mesh(resources.geometries.torso, resources.materials.darkSteel, 'chainmail-torso'));
  torso.add(mesh(resources.geometries.chestPlate, resources.materials.polishedSteel, 'ornate-chest', [1, 1, 1], [0, 0.08, 0.23]));
  torso.add(mesh(resources.geometries.chestPlate, cloth, 'team-chest-inlay', [0.62, 0.72, 0.4], [0, 0.04, 0.30]));
  torso.add(mesh(resources.geometries.waist, resources.materials.leather, 'waist-guard', [1, 1, 1], [0, -0.33, 0]));
  const belt = mesh(resources.geometries.belt, resources.materials.gold, 'gilded-belt', [1, 1, 0.78], [0, -0.25, 0], [Math.PI / 2, 0, 0]);
  torso.add(belt);
  torso.add(mesh(resources.geometries.buckle, resources.materials.gold, 'belt-buckle', [1, 1, 1], [0, -0.25, 0.28]));

  const frontTabard = mesh(resources.geometries.tabard, cloth, 'front-tabard', [1, 1, 1], [0, -0.48, 0.12], [-0.08, 0, 0]);
  torso.add(frontTabard);
  const backTabard = mesh(resources.geometries.tabard, cloth, 'back-tabard', [0.85, 0.9, 1], [0, -0.46, -0.16], [0.06, Math.PI, 0]);
  torso.add(backTabard);

  const helmet = mesh(resources.geometries.helmet, resources.materials.polishedSteel, 'helmet-shell', [1, 1.05, 1], [0, 0.02, 0]);
  head.add(helmet);
  head.add(mesh(resources.geometries.head, resources.materials.black, 'helmet-shadow', [0.86, 0.82, 0.86], [0, -0.03, 0]));
  head.add(mesh(resources.geometries.visor, resources.materials.darkSteel, 'visor', [1, 1, 1], [0, 0.00, 0.20]));
  const eyeStrip = mesh(resources.geometries.visor, teamGlow(resources, team), 'eye-glow', [0.72, 0.18, 0.32], [0, 0.005, 0.235]);
  head.add(eyeStrip);
  head.add(mesh(resources.geometries.crest, resources.materials.gold, 'helmet-crest', [0.66, 0.75, 0.5], [0, 0.30, -0.02], [0, 0, Math.PI]));

  for (const shoulder of [leftShoulder, rightShoulder]) {
    shoulder.add(mesh(resources.geometries.shoulder, resources.materials.polishedSteel, 'pauldron', [1.25, 0.7, 1.05], [0, -0.02, 0]));
  }

  leftShoulder.add(mesh(resources.geometries.upperArm, resources.materials.darkSteel, 'left-upper-arm', undefined, [0, -0.20, 0]));
  rightShoulder.add(mesh(resources.geometries.upperArm, resources.materials.darkSteel, 'right-upper-arm', undefined, [0, -0.20, 0]));
  leftElbow.add(mesh(resources.geometries.forearm, resources.materials.polishedSteel, 'left-forearm', undefined, [0, -0.18, 0]));
  rightElbow.add(mesh(resources.geometries.forearm, resources.materials.polishedSteel, 'right-forearm', undefined, [0, -0.18, 0]));
  leftHand.add(mesh(resources.geometries.gauntlet, resources.materials.darkSteel, 'left-gauntlet', undefined, [0, -0.04, 0]));
  rightHand.add(mesh(resources.geometries.gauntlet, resources.materials.darkSteel, 'right-gauntlet', undefined, [0, -0.04, 0]));

  leftHip.add(mesh(resources.geometries.thigh, resources.materials.darkSteel, 'left-thigh', undefined, [0, -0.22, 0]));
  rightHip.add(mesh(resources.geometries.thigh, resources.materials.darkSteel, 'right-thigh', undefined, [0, -0.22, 0]));
  leftKnee.add(mesh(resources.geometries.knee, resources.materials.gold, 'left-knee-plate', [1, 0.8, 0.85], [0, -0.01, 0.08]));
  rightKnee.add(mesh(resources.geometries.knee, resources.materials.gold, 'right-knee-plate', [1, 0.8, 0.85], [0, -0.01, 0.08]));
  leftKnee.add(mesh(resources.geometries.shin, resources.materials.polishedSteel, 'left-shin', undefined, [0, -0.20, 0]));
  rightKnee.add(mesh(resources.geometries.shin, resources.materials.polishedSteel, 'right-shin', undefined, [0, -0.20, 0]));
  leftFoot.add(mesh(resources.geometries.boot, resources.materials.leather, 'left-boot', undefined, [0, -0.05, 0.08]));
  rightFoot.add(mesh(resources.geometries.boot, resources.materials.leather, 'right-boot', undefined, [0, -0.05, 0.08]));

  addArmorRivet(torso, resources, -0.23, 0.22, 0.29);
  addArmorRivet(torso, resources, 0.23, 0.22, 0.29);
  addArmorRivet(torso, resources, -0.23, -0.06, 0.29);
  addArmorRivet(torso, resources, 0.23, -0.06, 0.29);

  const joints: JointSet = {
    pelvis,
    torso,
    head,
    leftHip,
    rightHip,
    leftKnee,
    rightKnee,
    leftFoot,
    rightFoot,
    leftShoulder,
    rightShoulder,
    leftElbow,
    rightElbow,
    leftHand,
    rightHand,
  };

  let weapon: THREE.Group | null = null;
  let flag: THREE.Group | null = null;

  if (type === 'melee' || type === 'flagbearer') {
    weapon = new THREE.Group();
    weapon.name = 'creep-sword';
    weapon.position.set(0, -0.07, 0.04);
    weapon.rotation.z = -0.12;
    rightHand.add(weapon);

    weapon.add(mesh(resources.geometries.swordGrip, resources.materials.leather, 'sword-grip', undefined, [0, -0.12, 0]));
    weapon.add(mesh(resources.geometries.pommel, resources.materials.gold, 'sword-pommel', undefined, [0, -0.30, 0]));
    weapon.add(mesh(resources.geometries.swordGuard, resources.materials.gold, 'sword-guard', undefined, [0, 0.04, 0]));
    weapon.add(mesh(resources.geometries.swordBlade, resources.materials.polishedSteel, 'sword-blade', undefined, [0, 0.44, 0]));
    weapon.add(mesh(resources.geometries.swordCore, teamGlow(resources, team), 'sword-rune', undefined, [0, 0.44, 0.026]));

    if (type === 'melee') {
      const shield = new THREE.Group();
      shield.name = 'creep-shield';
      shield.position.set(0, -0.04, 0.06);
      shield.rotation.set(Math.PI / 2, 0, 0.05);
      leftHand.add(shield);
      shield.add(mesh(resources.geometries.shield, resources.materials.darkSteel, 'shield-shell', [1, 1, 0.7]));
      shield.add(mesh(resources.geometries.shield, cloth, 'shield-team-inlay', [0.78, 0.78, 0.72], [0, 0.01, 0]));
      shield.add(mesh(resources.geometries.shieldBoss, resources.materials.gold, 'shield-boss', [1, 0.4, 1], [0, 0.06, 0]));
    }
  }

  if (type === 'ranged') {
    weapon = new THREE.Group();
    weapon.name = 'creep-arcane-staff';
    weapon.position.set(0.02, -0.08, 0.04);
    rightHand.add(weapon);
    weapon.add(mesh(resources.geometries.staff, resources.materials.wood, 'staff-shaft', undefined, [0, 0.43, 0]));
    weapon.add(mesh(resources.geometries.ring, resources.materials.gold, 'staff-ring', undefined, [0, 1.04, 0], [Math.PI / 2, 0, 0]));
    weapon.add(mesh(resources.geometries.crystal, teamGlow(resources, team), 'staff-crystal', undefined, [0, 1.04, 0]));
    leftShoulder.rotation.z = -0.18;
    rightShoulder.rotation.z = 0.18;
  }

  if (type === 'flagbearer') {
    flag = new THREE.Group();
    flag.name = 'creep-standard';
    flag.position.set(-0.02, -0.08, -0.03);
    leftHand.add(flag);
    flag.add(mesh(resources.geometries.staff, resources.materials.wood, 'standard-pole', [1, 1.55, 1], [0, 0.52, 0]));
    flag.add(mesh(resources.geometries.pommel, resources.materials.gold, 'standard-finial', [1.1, 1.1, 1.1], [0, 1.24, 0]));
    const clothFlag = mesh(resources.geometries.flag, cloth, 'standard-cloth', undefined, [0.37, 0.92, 0.01], [0, Math.PI / 2, 0]);
    flag.add(clothFlag);
  }

  model.scale.setScalar(type === 'ranged' ? 0.68 : 0.72);
  return { root, model, joints, weapon, flag };
}

function buildSiege(resources: LaneCreepVisualResources, team: LaneCreepVisualTeam) {
  const root = new THREE.Group();
  const model = new THREE.Group();
  model.name = 'lane-creep-model';
  root.add(model);

  const cloth = teamCloth(resources, team);
  const chassis = mesh(resources.geometries.siegeBody, resources.materials.wood, 'siege-chassis', undefined, [0, 0.42, 0]);
  model.add(chassis);
  model.add(mesh(resources.geometries.siegeDeck, resources.materials.darkSteel, 'siege-deck', undefined, [0, 0.65, -0.03]));
  model.add(mesh(resources.geometries.plate, cloth, 'siege-front-banner', undefined, [0, 0.51, 0.59]));
  model.add(mesh(resources.geometries.plate, resources.materials.gold, 'siege-front-trim', [1.08, 1.08, 0.55], [0, 0.51, 0.615]));

  const axle = mesh(resources.geometries.axle, resources.materials.darkSteel, 'siege-axle', undefined, [0, 0.28, 0], [0, 0, Math.PI / 2]);
  model.add(axle);

  const wheels: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    for (const forward of [-0.34, 0.34]) {
      const wheelPivot = pivot(model, 'siege-wheel', [side * 0.49, 0.28, forward]);
      wheelPivot.rotation.z = Math.PI / 2;
      wheelPivot.add(mesh(resources.geometries.siegeWheel, resources.materials.wood, 'wheel-rim'));
      wheelPivot.add(mesh(resources.geometries.siegeHub, resources.materials.gold, 'wheel-hub'));
      wheels.push(wheelPivot);
    }
  }

  const armPivot = pivot(model, 'siege-arm-pivot', [0, 0.72, -0.30]);
  armPivot.rotation.x = -0.46;
  armPivot.add(mesh(resources.geometries.siegeArm, resources.materials.polishedSteel, 'siege-throw-arm', undefined, [0, 0, 0.43]));
  armPivot.add(mesh(resources.geometries.siegeSling, resources.materials.leather, 'siege-sling', undefined, [0, 0, 1.00]));
  armPivot.add(mesh(resources.geometries.crystal, teamGlow(resources, team), 'siege-energy-core', [0.92, 0.92, 0.92], [0, 0.02, 1.02]));

  for (const side of [-1, 1]) {
    const spike = mesh(resources.geometries.spike, resources.materials.polishedSteel, 'siege-spike', undefined, [side * 0.30, 0.73, 0.59], [Math.PI / 2, 0, side > 0 ? -0.15 : 0.15]);
    model.add(spike);
  }

  model.scale.setScalar(0.88);
  return { root, model, wheels, siegeArm: armPivot };
}

export function buildLaneCreepVisual(
  resources: LaneCreepVisualResources,
  team: LaneCreepVisualTeam,
  type: LaneCreepVisualType,
  seed = 0,
): LaneCreepVisual {
  if (type === 'siege') {
    const built = buildSiege(resources, team);
    return {
      root: built.root,
      model: built.model,
      type,
      team,
      phase: (seed % 19) / 19 * Math.PI * 2,
      joints: null,
      flag: null,
      weapon: null,
      wheels: built.wheels,
      siegeArm: built.siegeArm,
      walkWeight: 0,
      attackStartedAt: Number.NEGATIVE_INFINITY,
      attackDuration: 0.82,
      lastAnimationAt: 0,
    };
  }

  const built = buildHumanoid(resources, team, type);
  return {
    root: built.root,
    model: built.model,
    type,
    team,
    phase: (seed % 19) / 19 * Math.PI * 2,
    joints: built.joints,
    flag: built.flag,
    weapon: built.weapon,
    wheels: [],
    siegeArm: null,
    walkWeight: 0,
    attackStartedAt: Number.NEGATIVE_INFINITY,
    attackDuration: type === 'ranged' ? 0.66 : 0.52,
    lastAnimationAt: 0,
  };
}

export function triggerLaneCreepAttack(visual: LaneCreepVisual, now: number) {
  visual.attackStartedAt = now;
}

function damp(current: number, target: number, speed: number, dt: number) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-speed * dt));
}

function attackProgress(visual: LaneCreepVisual, now: number) {
  const elapsed = now - visual.attackStartedAt;
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= visual.attackDuration) return 0;
  return THREE.MathUtils.clamp(elapsed / visual.attackDuration, 0, 1);
}

export function animateLaneCreepVisual(
  visual: LaneCreepVisual,
  now: number,
  moving: boolean,
) {
  const dt = visual.lastAnimationAt > 0
    ? THREE.MathUtils.clamp(now - visual.lastAnimationAt, 0, 0.05)
    : 1 / 60;
  visual.lastAnimationAt = now;
  visual.walkWeight = damp(visual.walkWeight, moving ? 1 : 0, 9, dt);

  if (visual.type === 'siege') {
    const travel = visual.walkWeight;
    for (let index = 0; index < visual.wheels.length; index++) {
      visual.wheels[index].rotation.y += dt * 7.5 * travel;
    }

    visual.model.position.y = damp(
      visual.model.position.y,
      moving ? Math.abs(Math.sin(now * 6.5 + visual.phase)) * 0.012 : 0,
      11,
      dt,
    );

    if (visual.siegeArm) {
      const attack = attackProgress(visual, now);
      let target = -0.46;
      if (attack > 0) {
        const windup = THREE.MathUtils.clamp(attack / 0.38, 0, 1);
        const release = THREE.MathUtils.clamp((attack - 0.38) / 0.26, 0, 1);
        const recover = THREE.MathUtils.clamp((attack - 0.64) / 0.36, 0, 1);
        target = -0.46 - windup * 0.72 + release * 1.46 - recover * 0.74;
      }
      visual.siegeArm.rotation.x = damp(visual.siegeArm.rotation.x, target, 22, dt);
    }
    return;
  }

  const joints = visual.joints;
  if (!joints) return;

  const gait = Math.sin(now * 8.8 + visual.phase);
  const stride = gait * 0.58 * visual.walkWeight;
  const kneeLeft = Math.max(0, -gait) * 0.52 * visual.walkWeight;
  const kneeRight = Math.max(0, gait) * 0.52 * visual.walkWeight;
  const armSwing = -stride * 0.72;

  joints.leftHip.rotation.x = damp(joints.leftHip.rotation.x, stride, 14, dt);
  joints.rightHip.rotation.x = damp(joints.rightHip.rotation.x, -stride, 14, dt);
  joints.leftKnee.rotation.x = damp(joints.leftKnee.rotation.x, kneeLeft, 16, dt);
  joints.rightKnee.rotation.x = damp(joints.rightKnee.rotation.x, kneeRight, 16, dt);
  joints.leftFoot.rotation.x = damp(joints.leftFoot.rotation.x, -kneeLeft * 0.42, 16, dt);
  joints.rightFoot.rotation.x = damp(joints.rightFoot.rotation.x, -kneeRight * 0.42, 16, dt);
  joints.leftShoulder.rotation.x = damp(joints.leftShoulder.rotation.x, armSwing, 13, dt);
  joints.rightShoulder.rotation.x = damp(joints.rightShoulder.rotation.x, -armSwing, 13, dt);
  joints.leftElbow.rotation.x = damp(joints.leftElbow.rotation.x, -0.22 + Math.max(0, gait) * 0.15 * visual.walkWeight, 14, dt);
  joints.rightElbow.rotation.x = damp(joints.rightElbow.rotation.x, -0.22 + Math.max(0, -gait) * 0.15 * visual.walkWeight, 14, dt);
  joints.pelvis.rotation.z = damp(joints.pelvis.rotation.z, gait * 0.045 * visual.walkWeight, 12, dt);
  joints.torso.rotation.y = damp(joints.torso.rotation.y, -gait * 0.06 * visual.walkWeight, 11, dt);
  joints.head.rotation.y = damp(joints.head.rotation.y, gait * 0.035 * visual.walkWeight, 10, dt);

  const bob = visual.walkWeight * (0.012 + Math.abs(Math.sin(now * 8.8 + visual.phase)) * 0.025);
  visual.model.position.y = damp(visual.model.position.y, bob, 14, dt);

  if (visual.flag) {
    visual.flag.rotation.z = damp(
      visual.flag.rotation.z,
      -0.06 + Math.sin(now * 4.4 + visual.phase) * 0.05,
      7,
      dt,
    );
    visual.flag.rotation.x = damp(
      visual.flag.rotation.x,
      Math.sin(now * 3.1 + visual.phase) * 0.035,
      7,
      dt,
    );
  }

  const attack = attackProgress(visual, now);
  if (attack <= 0) return;

  if (visual.type === 'ranged') {
    const windup = THREE.MathUtils.smoothstep(attack, 0, 0.42);
    const release = THREE.MathUtils.smoothstep(attack, 0.42, 0.68);
    const recover = THREE.MathUtils.smoothstep(attack, 0.68, 1);
    const cast = windup * 0.95 - release * 1.62 + recover * 0.67;
    joints.rightShoulder.rotation.x = -0.65 - cast;
    joints.rightElbow.rotation.x = -0.48 + windup * 0.58 - release * 0.45;
    joints.leftShoulder.rotation.x = -0.26 - windup * 0.35 + release * 0.22;
    joints.torso.rotation.x = -windup * 0.10 + release * 0.16 - recover * 0.06;
  } else {
    const windup = THREE.MathUtils.smoothstep(attack, 0, 0.34);
    const slash = THREE.MathUtils.smoothstep(attack, 0.34, 0.66);
    const recover = THREE.MathUtils.smoothstep(attack, 0.66, 1);
    joints.rightShoulder.rotation.x = -0.25 - windup * 1.1 + slash * 1.95 - recover * 0.60;
    joints.rightShoulder.rotation.z = 0.08 + windup * 0.36 - slash * 0.54 + recover * 0.10;
    joints.rightElbow.rotation.x = -0.28 - windup * 0.55 + slash * 0.95 - recover * 0.12;
    joints.torso.rotation.y = -windup * 0.36 + slash * 0.68 - recover * 0.32;
    joints.leftShoulder.rotation.x = visual.type === 'flagbearer'
      ? -0.12
      : -0.18 + windup * 0.22 - slash * 0.18;
  }
}
