import { Application, Container, Graphics, Text } from 'pixi.js';

type Point = { x: number; y: number };

const HERO_SPEED = 235;

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

  const onContextMenu = (event: MouseEvent) => event.preventDefault();

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 2) return;

    const rect = app.canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * app.screen.width;
    const y = ((event.clientY - rect.top) / rect.height) * app.screen.height;

    destination = { x, y };
    targetMarker.position.set(x, y);
    targetMarker.visible = true;
    targetMarker.alpha = 1;
  };

  app.canvas.addEventListener('contextmenu', onContextMenu);
  app.canvas.addEventListener('pointerdown', onPointerDown);

  app.ticker.add((ticker) => {
    elapsed += ticker.deltaMS / 1000;

    if (targetMarker.visible) {
      const pulse = 1 + Math.sin(elapsed * 7) * 0.12;
      targetMarker.scale.set(pulse);
    }

    if (!destination) return;

    const dx = destination.x - hero.x;
    const dy = destination.y - hero.y;
    const distance = Math.hypot(dx, dy);
    const step = HERO_SPEED * (ticker.deltaMS / 1000);

    if (distance <= Math.max(step, 3)) {
      hero.position.set(destination.x, destination.y);
      destination = null;
      targetMarker.visible = false;
      return;
    }

    hero.x += (dx / distance) * step;
    hero.y += (dy / distance) * step;

    const body = hero.getChildByLabel('body');
    if (body) body.scale.x = dx < 0 ? -1 : 1;
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
  const cape = new Graphics()
    .poly([-12, -25, -31, 10, -11, 29, 5, 4])
    .fill({ color: 0x1d4b8f });
  const legs = new Graphics()
    .roundRect(-13, 8, 9, 27, 4)
    .fill({ color: 0x333a42 })
    .roundRect(5, 8, 9, 27, 4)
    .fill({ color: 0x333a42 });
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

  body.addChild(cape, legs, torso, head, sword);
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
