import { Application, Container, Graphics, Text } from 'pixi.js';

type Point = { x: number; y: number };
type Direction = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

const HERO_SPEED = 235;
const WALK_CYCLE_SPEED = 11;

export async function createDawnreachGame(host: HTMLDivElement) {
  const app = new Application();
  await app.init({
    resizeTo: host,
    antialias: true,
    background: '#17231b',
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });

  host.appendChild(app.canvas);
  app.canvas.className = 'game-canvas';

  const world = new Container();
  app.stage.addChild(world);

  const arena = buildArena();
  world.addChild(arena);

  const targetMarker = buildTargetMarker();
  targetMarker.visible = false;
  world.addChild(targetMarker);

  const hero = buildHero();
  hero.position.set(620, 430);
  world.addChild(hero);

  let destination: Point | null = null;
  let elapsed = 0;
  let walkPhase = 0;
  let currentDirection: Direction = 's';

  setHeroDirection(hero, currentDirection);

  const onContextMenu = (event: MouseEvent) => event.preventDefault();

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 2) return;

    const rect = app.canvas.getBoundingClientRect();
    const localX = ((event.clientX - rect.left) / rect.width) * app.screen.width;
    const localY = ((event.clientY - rect.top) / rect.height) * app.screen.height;

    const x = (localX - world.x) / world.scale.x;
    const y = (localY - world.y) / world.scale.y;

    destination = { x, y };
    targetMarker.position.set(x, y);
    targetMarker.visible = true;
    targetMarker.alpha = 1;
  };

  app.canvas.addEventListener('contextmenu', onContextMenu);
  app.canvas.addEventListener('pointerdown', onPointerDown);

  app.ticker.add((ticker) => {
    const deltaSeconds = ticker.deltaMS / 1000;
    elapsed += deltaSeconds;

    if (targetMarker.visible) {
      const pulse = 1 + Math.sin(elapsed * 7) * 0.12;
      targetMarker.scale.set(pulse);
    }

    if (!destination) {
      resetWalkPose(hero);
      return;
    }

    const dx = destination.x - hero.x;
    const dy = destination.y - hero.y;
    const distance = Math.hypot(dx, dy);
    const step = HERO_SPEED * deltaSeconds;

    if (distance <= Math.max(step, 3)) {
      hero.position.set(destination.x, destination.y);
      destination = null;
      targetMarker.visible = false;
      resetWalkPose(hero);
      return;
    }

    const nextDirection = getDirection(dx, dy);
    if (nextDirection !== currentDirection) {
      currentDirection = nextDirection;
      setHeroDirection(hero, currentDirection);
    }

    hero.x += (dx / distance) * step;
    hero.y += (dy / distance) * step;

    walkPhase += deltaSeconds * WALK_CYCLE_SPEED;
    applyWalkPose(hero, walkPhase);
  });

  const resizeObserver = new ResizeObserver(() => {
    centerArena(world, app.screen.width, app.screen.height);
  });
  resizeObserver.observe(host);
  centerArena(world, app.screen.width, app.screen.height);

  return {
    destroy() {
      resizeObserver.disconnect();
      app.canvas.removeEventListener('contextmenu', onContextMenu);
      app.canvas.removeEventListener('pointerdown', onPointerDown);
      app.destroy(true, { children: true });
    },
  };
}

function centerArena(world: Container, width: number, height: number) {
  const designWidth = 1280;
  const designHeight = 720;
  const scale = Math.min(width / designWidth, height / designHeight);
  world.scale.set(scale);
  world.position.set((width - designWidth * scale) / 2, (height - designHeight * scale) / 2);
}

function getDirection(dx: number, dy: number): Direction {
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  if (angle >= -22.5 && angle < 22.5) return 'e';
  if (angle >= 22.5 && angle < 67.5) return 'se';
  if (angle >= 67.5 && angle < 112.5) return 's';
  if (angle >= 112.5 && angle < 157.5) return 'sw';
  if (angle >= 157.5 || angle < -157.5) return 'w';
  if (angle >= -157.5 && angle < -112.5) return 'nw';
  if (angle >= -112.5 && angle < -67.5) return 'n';
  return 'ne';
}

function setHeroDirection(hero: Container, direction: Direction) {
  const body = hero.getChildByLabel('body') as Container | null;
  if (!body) return;

  body.removeChildren();
  body.addChild(buildDirectionalBody(direction));
}

function applyWalkPose(hero: Container, phase: number) {
  const body = hero.getChildByLabel('body') as Container | null;
  if (!body) return;

  const pose = body.children[0] as Container | undefined;
  if (!pose) return;

  const leftLeg = pose.getChildByLabel('left-leg');
  const rightLeg = pose.getChildByLabel('right-leg');
  const torso = pose.getChildByLabel('torso-group');
  const cape = pose.getChildByLabel('cape');

  const stride = Math.sin(phase);
  const lift = Math.abs(Math.cos(phase));

  if (leftLeg) {
    leftLeg.rotation = stride * 0.22;
    leftLeg.y = 8 - Math.max(0, stride) * 3;
  }

  if (rightLeg) {
    rightLeg.rotation = -stride * 0.22;
    rightLeg.y = 8 - Math.max(0, -stride) * 3;
  }

  if (torso) torso.y = -lift * 1.5;
  if (cape) cape.rotation = -stride * 0.035;

  body.y = -lift * 1.2;
}

function resetWalkPose(hero: Container) {
  const body = hero.getChildByLabel('body') as Container | null;
  if (!body) return;

  body.y = 0;
  const pose = body.children[0] as Container | undefined;
  if (!pose) return;

  const leftLeg = pose.getChildByLabel('left-leg');
  const rightLeg = pose.getChildByLabel('right-leg');
  const torso = pose.getChildByLabel('torso-group');
  const cape = pose.getChildByLabel('cape');

  if (leftLeg) {
    leftLeg.rotation = 0;
    leftLeg.y = 8;
  }
  if (rightLeg) {
    rightLeg.rotation = 0;
    rightLeg.y = 8;
  }
  if (torso) torso.y = 0;
  if (cape) cape.rotation = 0;
}

function buildDirectionalBody(direction: Direction) {
  const mirrored = direction === 'w' || direction === 'sw' || direction === 'nw';
  const baseDirection: 'n' | 'ne' | 'e' | 'se' | 's' =
    direction === 'nw' ? 'ne' :
    direction === 'w' ? 'e' :
    direction === 'sw' ? 'se' :
    direction;

  const pose = new Container();
  pose.scale.x = mirrored ? -1 : 1;

  const leftLeg = new Graphics({ label: 'left-leg' })
    .roundRect(-4.5, 0, 9, 27, 4)
    .fill({ color: 0x333a42 });
  leftLeg.position.set(-8.5, 8);

  const rightLeg = new Graphics({ label: 'right-leg' })
    .roundRect(-4.5, 0, 9, 27, 4)
    .fill({ color: 0x2a3037 });
  rightLeg.position.set(9.5, 8);

  pose.addChild(leftLeg, rightLeg);

  if (baseDirection === 'n') {
    const cape = new Graphics({ label: 'cape' })
      .poly([-17, -24, 17, -24, 22, 23, 0, 31, -22, 23])
      .fill({ color: 0x1d4b8f })
      .poly([-12, -17, 12, -17, 15, 14, 0, 21, -15, 14])
      .fill({ color: 0x285ca6, alpha: 0.9 });

    const torsoGroup = new Container({ label: 'torso-group' });
    const shoulders = new Graphics()
      .poly([-21, -22, 21, -22, 17, 7, -17, 7])
      .fill({ color: 0xaeb5ba });
    const helmetBack = new Graphics()
      .circle(0, -35, 12)
      .fill({ color: 0x92999d })
      .arc(0, -35, 9, 0, Math.PI)
      .stroke({ color: 0xc6cbce, width: 3 });
    const sword = new Graphics()
      .moveTo(19, -3)
      .lineTo(35, -35)
      .lineTo(40, -32)
      .lineTo(24, 1)
      .closePath()
      .fill({ color: 0xe8edf1 })
      .moveTo(18, 0)
      .lineTo(27, 5)
      .stroke({ color: 0xc99d43, width: 5 });

    torsoGroup.addChild(shoulders, helmetBack, sword);
    pose.addChild(cape, torsoGroup);
    return pose;
  }

  if (baseDirection === 'e') {
    const cape = new Graphics({ label: 'cape' })
      .poly([-13, -23, 2, -18, -18, 25, -30, 18])
      .fill({ color: 0x1d4b8f });

    const torsoGroup = new Container({ label: 'torso-group' });
    const torso = new Graphics()
      .poly([-12, -22, 15, -18, 18, 9, -11, 10])
      .fill({ color: 0xbfc4c7 })
      .poly([-7, -17, 10, -14, 12, 4, -8, 5])
      .fill({ color: 0x315796 });
    const head = new Graphics()
      .circle(3, -35, 12)
      .fill({ color: 0xd9c1a1 })
      .poly([-4, -45, 10, -44, 15, -36, -2, -38])
      .fill({ color: 0x8e9394 });
    const sword = new Graphics()
      .moveTo(14, -2)
      .lineTo(50, -13)
      .lineTo(52, -8)
      .lineTo(17, 3)
      .closePath()
      .fill({ color: 0xe8edf1 })
      .moveTo(13, 0)
      .lineTo(21, 8)
      .stroke({ color: 0xc99d43, width: 5 });

    torsoGroup.addChild(torso, head, sword);
    pose.addChild(cape, torsoGroup);
    return pose;
  }

  if (baseDirection === 'ne') {
    const cape = new Graphics({ label: 'cape' })
      .poly([-15, -24, 9, -21, -8, 27, -27, 15])
      .fill({ color: 0x1d4b8f });

    const torsoGroup = new Container({ label: 'torso-group' });
    const torso = new Graphics()
      .poly([-17, -22, 18, -20, 18, 8, -15, 11])
      .fill({ color: 0xb6bdc1 })
      .poly([-9, -16, 11, -15, 11, 4, -10, 6])
      .fill({ color: 0x315796, alpha: 0.75 });
    const helmet = new Graphics()
      .circle(2, -35, 12)
      .fill({ color: 0xa1a7aa })
      .arc(1, -36, 10, Math.PI * 0.9, Math.PI * 1.9)
      .stroke({ color: 0xd0d4d6, width: 3 });
    const sword = new Graphics()
      .moveTo(16, -2)
      .lineTo(45, -31)
      .lineTo(49, -27)
      .lineTo(20, 3)
      .closePath()
      .fill({ color: 0xe8edf1 })
      .moveTo(15, 1)
      .lineTo(23, 8)
      .stroke({ color: 0xc99d43, width: 5 });

    torsoGroup.addChild(torso, helmet, sword);
    pose.addChild(cape, torsoGroup);
    return pose;
  }

  if (baseDirection === 'se') {
    const cape = new Graphics({ label: 'cape' })
      .poly([-15, -25, -29, 11, -10, 29, 5, 4])
      .fill({ color: 0x1d4b8f });

    const torsoGroup = new Container({ label: 'torso-group' });
    const torso = new Graphics()
      .poly([-18, -22, 18, -20, 22, 10, -18, 12])
      .fill({ color: 0xc2c5c7 })
      .poly([-11, -17, 12, -15, 14, 4, -11, 6])
      .fill({ color: 0x315796 });
    const head = new Graphics()
      .circle(2, -35, 12)
      .fill({ color: 0xd9c1a1 })
      .arc(1, -38, 13, Math.PI, Math.PI * 1.95)
      .fill({ color: 0x8e9394 });
    const sword = new Graphics()
      .moveTo(16, -1)
      .lineTo(44, -22)
      .lineTo(48, -18)
      .lineTo(20, 4)
      .closePath()
      .fill({ color: 0xe8edf1 })
      .moveTo(15, 1)
      .lineTo(23, 9)
      .stroke({ color: 0xc99d43, width: 5 });

    torsoGroup.addChild(torso, head, sword);
    pose.addChild(cape, torsoGroup);
    return pose;
  }

  const cape = new Graphics({ label: 'cape' })
    .poly([-12, -25, -31, 10, -11, 29, 5, 4])
    .fill({ color: 0x1d4b8f });
  const torsoGroup = new Container({ label: 'torso-group' });
  const torso = new Graphics()
    .poly([-19, -22, 17, -22, 22, 10, -19, 12])
    .fill({ color: 0xc2c5c7 })
    .poly([-13, -18, 12, -18, 14, 3, -12, 5])
    .fill({ color: 0x315796 });
  const head = new Graphics()
    .circle(0, -35, 12)
    .fill({ color: 0xd9c1a1 })
    .arc(0, -37, 13, Math.PI, Math.PI * 2)
    .fill({ color: 0x8e9394 });
  const sword = new Graphics()
    .moveTo(15, -1)
    .lineTo(43, -28)
    .lineTo(48, -25)
    .lineTo(20, 3)
    .closePath()
    .fill({ color: 0xe8edf1 })
    .moveTo(14, 1)
    .lineTo(22, 9)
    .stroke({ color: 0xc99d43, width: 5 });

  torsoGroup.addChild(torso, head, sword);
  pose.addChild(cape, torsoGroup);
  return pose;
}

function buildArena() {
  const arena = new Container();

  const ground = new Graphics()
    .rect(0, 0, 1280, 720)
    .fill({ color: 0x40583b });
  arena.addChild(ground);

  const lane = new Graphics();
  lane
    .poly([
      0, 575,
      0, 400,
      290, 300,
      610, 355,
      980, 180,
      1280, 105,
      1280, 290,
      1000, 355,
      690, 525,
      330, 470,
    ])
    .fill({ color: 0x77705a });
  arena.addChild(lane);

  const laneDetail = new Graphics();
  for (let i = 0; i < 36; i += 1) {
    const x = (i * 149) % 1260;
    const y = 170 + ((i * 83) % 380);
    laneDetail
      .roundRect(x, y, 44 + (i % 3) * 11, 18 + (i % 2) * 8, 5)
      .fill({ color: i % 2 ? 0x817a64 : 0x69644f, alpha: 0.35 });
  }
  arena.addChild(laneDetail);

  const grassTexture = new Graphics();
  for (let i = 0; i < 170; i += 1) {
    const x = (i * 97) % 1280;
    const y = (i * 173) % 720;
    const radius = 1 + (i % 3);
    grassTexture.circle(x, y, radius).fill({
      color: i % 4 === 0 ? 0x9a9c61 : 0x263c2b,
      alpha: 0.38,
    });
  }
  arena.addChild(grassTexture);

  arena.addChild(buildForestCluster(90, 70, 1.15));
  arena.addChild(buildForestCluster(1030, 505, 1.35));
  arena.addChild(buildForestCluster(1100, 25, 0.9));
  arena.addChild(buildForestCluster(80, 565, 0.8));

  arena.addChild(buildStonePillar(245, 185));
  arena.addChild(buildStonePillar(1005, 315));

  const water = new Graphics()
    .ellipse(1125, 40, 210, 95)
    .fill({ color: 0x183b48, alpha: 0.9 })
    .ellipse(1190, 45, 125, 50)
    .stroke({ color: 0x4d7981, width: 2, alpha: 0.45 });
  arena.addChild(water);

  return arena;
}

function buildForestCluster(x: number, y: number, scale: number) {
  const cluster = new Container();
  cluster.position.set(x, y);
  cluster.scale.set(scale);

  const treePositions = [
    [0, 42], [45, 12], [92, 45], [136, 4], [165, 57], [65, 78],
  ];

  for (const [tx, ty] of treePositions) {
    const tree = new Container();
    tree.position.set(tx, ty);

    const shadow = new Graphics()
      .ellipse(0, 30, 28, 13)
      .fill({ color: 0x0a130d, alpha: 0.35 });
    const trunk = new Graphics()
      .roundRect(-5, 13, 10, 26, 3)
      .fill({ color: 0x4e3927 });
    const crown = new Graphics()
      .circle(0, 0, 32)
      .fill({ color: 0x1c3d29 })
      .circle(-15, -4, 23)
      .fill({ color: 0x2b5134 })
      .circle(16, -8, 21)
      .fill({ color: 0x335b38 });

    tree.addChild(shadow, trunk, crown);
    cluster.addChild(tree);
  }

  return cluster;
}

function buildStonePillar(x: number, y: number) {
  const pillar = new Container();
  pillar.position.set(x, y);

  const shadow = new Graphics()
    .ellipse(0, 44, 26, 10)
    .fill({ color: 0x0a130d, alpha: 0.35 });
  const stone = new Graphics()
    .roundRect(-18, -10, 36, 60, 5)
    .fill({ color: 0x77776c })
    .roundRect(-15, -7, 30, 13, 4)
    .fill({ color: 0x969489 });
  const flame = new Graphics()
    .circle(0, -18, 11)
    .fill({ color: 0xffc34d, alpha: 0.85 })
    .circle(0, -20, 5)
    .fill({ color: 0xfff1a6 });

  pillar.addChild(shadow, stone, flame);
  return pillar;
}

function buildHero() {
  const hero = new Container();

  const selection = new Graphics()
    .ellipse(0, 19, 39, 18)
    .stroke({ color: 0x63f0c2, width: 3, alpha: 0.95 });
  hero.addChild(selection);

  const shadow = new Graphics()
    .ellipse(0, 17, 28, 12)
    .fill({ color: 0x08100b, alpha: 0.45 });
  hero.addChild(shadow);

  const body = new Container({ label: 'body' });
  hero.addChild(body);

  const hpBack = new Graphics()
    .roundRect(-41, -71, 82, 10, 3)
    .fill({ color: 0x101713, alpha: 0.95 });
  const hp = new Graphics()
    .roundRect(-39, -69, 78, 6, 2)
    .fill({ color: 0x45c85e });
  hero.addChild(hpBack, hp);

  const levelBadge = new Graphics()
    .roundRect(-56, -75, 17, 17, 4)
    .fill({ color: 0x0e1518 })
    .stroke({ color: 0x73818a, width: 1 });
  hero.addChild(levelBadge);

  const level = new Text({
    text: '1',
    style: {
      fill: '#ffffff',
      fontSize: 11,
      fontFamily: 'Arial',
      fontWeight: '700',
    },
  });
  level.anchor.set(0.5);
  level.position.set(-47.5, -66.5);
  hero.addChild(level);

  const name = new Text({
    text: 'Alden',
    style: {
      fill: '#f4f1e5',
      fontSize: 13,
      fontFamily: 'Arial',
      fontWeight: '600',
      stroke: { color: '#10130f', width: 4 },
    },
  });
  name.anchor.set(0.5);
  name.position.set(0, -88);
  hero.addChild(name);

  return hero;
}

function buildTargetMarker() {
  const marker = new Container();
  const outer = new Graphics()
    .circle(0, 0, 17)
    .stroke({ color: 0x6df56b, width: 3, alpha: 0.95 });
  const inner = new Graphics()
    .circle(0, 0, 5)
    .fill({ color: 0xb7ff9b, alpha: 0.75 });
  marker.addChild(outer, inner);
  return marker;
}
