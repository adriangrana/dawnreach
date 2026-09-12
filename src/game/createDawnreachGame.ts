import { Application, Container, Graphics, Text } from 'pixi.js';

type Point = { x: number; y: number };
type Direction = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';

const HERO_SPEED = 235;
const WALK_CYCLE_SPEED = 11;

const COLORS = {
  steelDark: 0x3d4650,
  steelMid: 0x7f8b94,
  steel: 0xbcc5ca,
  steelLight: 0xe4eaed,
  blueDark: 0x163a6f,
  blue: 0x245aa5,
  blueLight: 0x3977cb,
  goldDark: 0x8c6425,
  gold: 0xc99d43,
  goldLight: 0xf0ca73,
  leather: 0x5c4028,
  leatherLight: 0x8b6437,
  skin: 0xd8c0a0,
};

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
      applyIdlePose(hero, elapsed);
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

  const leftLeg = pose.getChildByLabel('left-leg') as Container | null;
  const rightLeg = pose.getChildByLabel('right-leg') as Container | null;
  const torso = pose.getChildByLabel('torso-group');
  const cape = pose.getChildByLabel('cape');
  const weapon = pose.getChildByLabel('weapon');

  const stride = Math.sin(phase);
  const lift = Math.abs(Math.cos(phase));

  if (leftLeg) {
    leftLeg.rotation = stride * 0.23;
    leftLeg.y = 6 - Math.max(0, stride) * 3.5;
  }

  if (rightLeg) {
    rightLeg.rotation = -stride * 0.23;
    rightLeg.y = 6 - Math.max(0, -stride) * 3.5;
  }

  if (torso) {
    torso.y = -lift * 1.6;
    torso.rotation = stride * 0.018;
  }

  if (cape) {
    cape.rotation = -stride * 0.055;
    cape.y = Math.abs(stride) * 1.3;
  }

  if (weapon) weapon.rotation = stride * 0.045;

  body.y = -lift * 1.1;
}

function applyIdlePose(hero: Container, elapsed: number) {
  const body = hero.getChildByLabel('body') as Container | null;
  if (!body) return;

  const pose = body.children[0] as Container | undefined;
  if (!pose) return;

  const leftLeg = pose.getChildByLabel('left-leg') as Container | null;
  const rightLeg = pose.getChildByLabel('right-leg') as Container | null;
  const torso = pose.getChildByLabel('torso-group');
  const cape = pose.getChildByLabel('cape');
  const weapon = pose.getChildByLabel('weapon');

  const breathe = Math.sin(elapsed * 2.3);

  if (leftLeg) {
    leftLeg.rotation = 0;
    leftLeg.y = 6;
  }
  if (rightLeg) {
    rightLeg.rotation = 0;
    rightLeg.y = 6;
  }
  if (torso) {
    torso.y = breathe * -0.45;
    torso.rotation = 0;
  }
  if (cape) {
    cape.rotation = Math.sin(elapsed * 1.7) * 0.012;
    cape.y = 0;
  }
  if (weapon) weapon.rotation = 0;

  body.y = 0;
}

function resetWalkPose(hero: Container) {
  const body = hero.getChildByLabel('body') as Container | null;
  if (!body) return;

  body.y = 0;
  const pose = body.children[0] as Container | undefined;
  if (!pose) return;

  const leftLeg = pose.getChildByLabel('left-leg') as Container | null;
  const rightLeg = pose.getChildByLabel('right-leg') as Container | null;
  const torso = pose.getChildByLabel('torso-group');
  const cape = pose.getChildByLabel('cape');
  const weapon = pose.getChildByLabel('weapon');

  if (leftLeg) {
    leftLeg.rotation = 0;
    leftLeg.y = 6;
  }
  if (rightLeg) {
    rightLeg.rotation = 0;
    rightLeg.y = 6;
  }
  if (torso) {
    torso.y = 0;
    torso.rotation = 0;
  }
  if (cape) {
    cape.rotation = 0;
    cape.y = 0;
  }
  if (weapon) weapon.rotation = 0;
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

  const cape = buildCape(baseDirection);
  const leftLeg = buildArmoredLeg('left-leg', true);
  const rightLeg = buildArmoredLeg('right-leg', false);
  const torsoGroup = buildTorso(baseDirection);
  const weapon = buildWeapon(baseDirection);

  leftLeg.position.set(-8.5, 6);
  rightLeg.position.set(8.5, 6);

  if (baseDirection === 'e') {
    leftLeg.position.x = -5;
    rightLeg.position.x = 7;
  }

  if (baseDirection === 'ne' || baseDirection === 'se') {
    leftLeg.position.x = -7;
    rightLeg.position.x = 7;
  }

  pose.addChild(cape, leftLeg, rightLeg, torsoGroup, weapon);
  return pose;
}

function buildArmoredLeg(label: string, lighter: boolean) {
  const leg = new Container({ label });

  const thigh = new Graphics()
    .roundRect(-5, 0, 10, 14, 5)
    .fill({ color: lighter ? 0x424c57 : 0x343c45 })
    .roundRect(-3.2, 1.5, 2.6, 10, 2)
    .fill({ color: COLORS.steelLight, alpha: 0.15 });

  const knee = new Graphics()
    .ellipse(0, 14, 5.2, 4.3)
    .fill({ color: COLORS.steelMid })
    .ellipse(-1.2, 13.1, 2.2, 1.7)
    .fill({ color: COLORS.steelLight, alpha: 0.45 });

  const shin = new Graphics()
    .poly([-4.3, 15, 4.3, 15, 3.1, 27, 0, 30, -3.2, 27])
    .fill({ color: lighter ? 0x53606b : 0x454f59 })
    .poly([-2.1, 16, 0, 16, -0.8, 26, -2.5, 27])
    .fill({ color: COLORS.steelLight, alpha: 0.18 });

  const boot = new Graphics()
    .ellipse(1.2, 29.5, 7, 4)
    .fill({ color: COLORS.leather })
    .ellipse(2.5, 28.6, 4, 1.5)
    .fill({ color: COLORS.leatherLight, alpha: 0.55 });

  leg.addChild(thigh, knee, shin, boot);
  return leg;
}

function buildCape(direction: 'n' | 'ne' | 'e' | 'se' | 's') {
  const cape = new Container({ label: 'cape' });
  const cloth = new Graphics();

  if (direction === 'n') {
    cloth
      .poly([-17, -24, 17, -24, 21, 15, 12, 29, 0, 24, -12, 30, -22, 15])
      .fill({ color: COLORS.blueDark })
      .poly([-10, -18, 11, -18, 13, 13, 6, 23, 0, 19, -7, 24, -14, 12])
      .fill({ color: COLORS.blue, alpha: 0.92 })
      .poly([-3, -16, 2, -16, 4, 18, 0, 20])
      .fill({ color: COLORS.blueLight, alpha: 0.28 });
  } else if (direction === 'e') {
    cloth
      .poly([-10, -22, 3, -18, -9, 7, -20, 27, -31, 20, -23, -2])
      .fill({ color: COLORS.blueDark })
      .poly([-8, -17, -1, -15, -10, 8, -18, 20, -24, 16, -18, 0])
      .fill({ color: COLORS.blue, alpha: 0.9 });
  } else if (direction === 'ne') {
    cloth
      .poly([-15, -23, 9, -20, 5, 5, -7, 28, -27, 15, -24, -5])
      .fill({ color: COLORS.blueDark })
      .poly([-11, -18, 5, -16, 1, 4, -7, 21, -20, 12, -18, -3])
      .fill({ color: COLORS.blue, alpha: 0.9 });
  } else if (direction === 'se') {
    cloth
      .poly([-14, -24, 4, -18, 3, 6, -10, 29, -30, 12, -24, -8])
      .fill({ color: COLORS.blueDark })
      .poly([-10, -18, 1, -14, -2, 5, -10, 21, -22, 10, -18, -5])
      .fill({ color: COLORS.blue, alpha: 0.92 });
  } else {
    cloth
      .poly([-13, -21, 13, -21, 21, 7, 12, 28, 0, 20, -12, 28, -21, 7])
      .fill({ color: COLORS.blueDark })
      .poly([-8, -16, 8, -16, 13, 6, 7, 21, 0, 16, -7, 21, -13, 6])
      .fill({ color: COLORS.blue, alpha: 0.94 });
  }

  const trim = new Graphics()
    .moveTo(-12, -19)
    .lineTo(-17, 8)
    .lineTo(-9, 24)
    .stroke({ color: COLORS.gold, width: 1.8, alpha: 0.72 });

  cape.addChild(cloth, trim);
  return cape;
}

function buildTorso(direction: 'n' | 'ne' | 'e' | 'se' | 's') {
  const torsoGroup = new Container({ label: 'torso-group' });

  const body = new Graphics();
  const armor = new Graphics();
  const detail = new Graphics();
  const shoulderBack = new Graphics();
  const shoulderFront = new Graphics();

  if (direction === 'n') {
    body
      .ellipse(0, -9, 17, 19)
      .fill({ color: COLORS.steelMid })
      .roundRect(-13, -11, 26, 21, 8)
      .fill({ color: 0x66727c });
    armor
      .poly([-14, -18, 14, -18, 17, 4, 11, 11, -11, 11, -17, 4])
      .fill({ color: COLORS.steel })
      .poly([-10, -13, 10, -13, 10, 5, 0, 9, -10, 5])
      .fill({ color: COLORS.blueDark });
    detail
      .moveTo(0, -12)
      .lineTo(0, 6)
      .stroke({ color: COLORS.gold, width: 2, alpha: 0.8 })
      .moveTo(-8, -7)
      .lineTo(8, -7)
      .stroke({ color: COLORS.steelLight, width: 1.5, alpha: 0.4 });
    shoulderBack.circle(-17, -12, 7).fill({ color: COLORS.steelMid });
    shoulderFront.circle(17, -12, 7).fill({ color: COLORS.steel });
  } else if (direction === 'e') {
    body
      .ellipse(1, -8, 13, 18)
      .fill({ color: 0x69747e });
    armor
      .poly([-10, -20, 13, -16, 16, 6, 7, 12, -9, 8])
      .fill({ color: COLORS.steel })
      .poly([-6, -15, 9, -12, 11, 5, 3, 8, -7, 5])
      .fill({ color: COLORS.blue });
    detail
      .moveTo(-2, -13)
      .lineTo(8, -10)
      .lineTo(9, 4)
      .stroke({ color: COLORS.gold, width: 1.8, alpha: 0.82 });
    shoulderBack.ellipse(-10, -13, 6, 7).fill({ color: COLORS.steelMid });
    shoulderFront.ellipse(13, -12, 8, 7).fill({ color: COLORS.steelLight });
  } else if (direction === 'ne') {
    body
      .ellipse(0, -8, 16, 19)
      .fill({ color: 0x68747d });
    armor
      .poly([-14, -20, 14, -17, 17, 6, 9, 11, -12, 9])
      .fill({ color: 0xabb5bb })
      .poly([-9, -14, 10, -13, 11, 5, 2, 8, -9, 5])
      .fill({ color: COLORS.blueDark });
    detail
      .moveTo(-3, -13)
      .lineTo(8, -11)
      .lineTo(8, 5)
      .stroke({ color: COLORS.gold, width: 1.8, alpha: 0.8 });
    shoulderBack.ellipse(-14, -13, 6, 7).fill({ color: COLORS.steelMid });
    shoulderFront.ellipse(15, -12, 8, 7).fill({ color: COLORS.steelLight });
  } else if (direction === 'se') {
    body
      .ellipse(0, -8, 16, 19)
      .fill({ color: 0x6a7580 });
    armor
      .poly([-15, -20, 14, -18, 18, 7, 10, 12, -13, 10])
      .fill({ color: COLORS.steel })
      .poly([-10, -14, 10, -13, 12, 6, 2, 9, -10, 6])
      .fill({ color: COLORS.blue });
    detail
      .moveTo(-5, -12)
      .lineTo(8, -10)
      .lineTo(9, 5)
      .stroke({ color: COLORS.gold, width: 1.8, alpha: 0.86 })
      .moveTo(-7, -7)
      .lineTo(8, -6)
      .stroke({ color: COLORS.steelLight, width: 1.2, alpha: 0.45 });
    shoulderBack.ellipse(-15, -13, 6, 7).fill({ color: COLORS.steelMid });
    shoulderFront.ellipse(16, -12, 8, 7).fill({ color: COLORS.steelLight });
  } else {
    body
      .ellipse(0, -8, 17, 19)
      .fill({ color: 0x6b7680 });
    armor
      .poly([-16, -19, 16, -19, 19, 6, 11, 12, -11, 12, -19, 6])
      .fill({ color: COLORS.steel })
      .poly([-11, -13, 11, -13, 12, 6, 0, 10, -12, 6])
      .fill({ color: COLORS.blue });
    detail
      .moveTo(0, -12)
      .lineTo(0, 7)
      .stroke({ color: COLORS.goldLight, width: 2.2, alpha: 0.9 })
      .moveTo(-8, -7)
      .lineTo(8, -7)
      .stroke({ color: COLORS.steelLight, width: 1.3, alpha: 0.45 });
    shoulderBack.circle(-17, -12, 7).fill({ color: COLORS.steelMid });
    shoulderFront.circle(17, -12, 7).fill({ color: COLORS.steelLight });
  }

  const belt = new Graphics()
    .roundRect(-11, 7, 22, 5, 2.5)
    .fill({ color: COLORS.leather })
    .circle(0, 9.5, 3.1)
    .fill({ color: COLORS.gold });

  const head = buildHead(direction);

  torsoGroup.addChild(shoulderBack, body, armor, detail, belt, shoulderFront, head);
  return torsoGroup;
}

function buildHead(direction: 'n' | 'ne' | 'e' | 'se' | 's') {
  const head = new Container();
  const helmet = new Graphics();
  const face = new Graphics();
  const crest = new Graphics();
  const glow = new Graphics();

  if (direction === 'n') {
    helmet
      .circle(0, -34, 11.5)
      .fill({ color: COLORS.steelMid })
      .arc(0, -34, 9, 0.05, Math.PI - 0.05)
      .stroke({ color: COLORS.steelLight, width: 2.2, alpha: 0.8 });
    crest
      .poly([-3, -45, 0, -51, 3, -45, 2, -35, -2, -35])
      .fill({ color: COLORS.gold });
  } else if (direction === 'e') {
    face.ellipse(3, -33, 9.5, 10.5).fill({ color: COLORS.skin });
    helmet
      .poly([-7, -39, 4, -45, 13, -40, 11, -30, 1, -24, -6, -29])
      .fill({ color: COLORS.steelMid })
      .moveTo(-2, -39)
      .lineTo(9, -38)
      .stroke({ color: COLORS.steelLight, width: 2, alpha: 0.75 });
    glow.circle(10, -33, 1.6).fill({ color: 0x8ed6ff, alpha: 0.85 });
    crest
      .poly([-2, -44, 1, -50, 4, -44, 3, -37, 0, -37])
      .fill({ color: COLORS.gold });
  } else if (direction === 'ne') {
    helmet
      .ellipse(1, -34, 11, 11)
      .fill({ color: COLORS.steelMid })
      .arc(1, -34, 9, Math.PI * 0.78, Math.PI * 1.84)
      .stroke({ color: COLORS.steelLight, width: 2.2, alpha: 0.75 });
    crest
      .poly([-2, -44, 1, -50, 4, -44, 3, -36, 0, -36])
      .fill({ color: COLORS.gold });
  } else if (direction === 'se') {
    face.ellipse(2, -33, 9.5, 10.5).fill({ color: COLORS.skin });
    helmet
      .arc(1, -35, 12, Math.PI, Math.PI * 1.98)
      .fill({ color: COLORS.steelMid })
      .moveTo(-7, -36)
      .lineTo(10, -34)
      .stroke({ color: COLORS.steelLight, width: 2, alpha: 0.72 });
    glow.circle(7, -33, 1.5).fill({ color: 0x8ed6ff, alpha: 0.9 });
    crest
      .poly([-2, -45, 1, -51, 4, -44, 3, -36, 0, -36])
      .fill({ color: COLORS.gold });
  } else {
    face.circle(0, -33, 10.5).fill({ color: COLORS.skin });
    helmet
      .arc(0, -36, 12.5, Math.PI, Math.PI * 2)
      .fill({ color: COLORS.steelMid })
      .moveTo(-9, -34)
      .lineTo(9, -34)
      .stroke({ color: COLORS.steelLight, width: 2.1, alpha: 0.75 });
    glow
      .circle(-4, -32, 1.4)
      .fill({ color: 0x8ed6ff, alpha: 0.9 })
      .circle(4, -32, 1.4)
      .fill({ color: 0x8ed6ff, alpha: 0.9 });
    crest
      .poly([-3, -45, 0, -51, 3, -45, 2, -36, -2, -36])
      .fill({ color: COLORS.gold });
  }

  head.addChild(face, helmet, crest, glow);
  return head;
}

function buildWeapon(direction: 'n' | 'ne' | 'e' | 'se' | 's') {
  const weapon = new Container({ label: 'weapon' });
  const blade = new Graphics();
  const hilt = new Graphics();

  if (direction === 'n') {
    blade
      .moveTo(17, -1)
      .lineTo(31, -35)
      .lineTo(36, -33)
      .lineTo(22, 2)
      .closePath()
      .fill({ color: COLORS.steelLight })
      .moveTo(21, -1)
      .lineTo(32, -30)
      .stroke({ color: 0xffffff, width: 1.2, alpha: 0.65 });
    hilt
      .moveTo(16, 1)
      .lineTo(25, 6)
      .stroke({ color: COLORS.gold, width: 5 })
      .circle(20, 4, 2.8)
      .fill({ color: COLORS.goldLight });
  } else if (direction === 'e') {
    blade
      .moveTo(13, -1)
      .lineTo(49, -12)
      .lineTo(52, -7)
      .lineTo(17, 4)
      .closePath()
      .fill({ color: COLORS.steelLight })
      .moveTo(18, 0)
      .lineTo(46, -9)
      .stroke({ color: 0xffffff, width: 1.2, alpha: 0.65 });
    hilt
      .moveTo(12, 1)
      .lineTo(21, 8)
      .stroke({ color: COLORS.gold, width: 5 })
      .circle(17, 4, 2.7)
      .fill({ color: COLORS.goldLight });
  } else if (direction === 'ne') {
    blade
      .moveTo(15, -2)
      .lineTo(43, -31)
      .lineTo(48, -27)
      .lineTo(19, 3)
      .closePath()
      .fill({ color: COLORS.steelLight })
      .moveTo(20, -3)
      .lineTo(43, -27)
      .stroke({ color: 0xffffff, width: 1.2, alpha: 0.62 });
    hilt
      .moveTo(14, 1)
      .lineTo(23, 8)
      .stroke({ color: COLORS.gold, width: 5 })
      .circle(18, 4, 2.7)
      .fill({ color: COLORS.goldLight });
  } else if (direction === 'se') {
    blade
      .moveTo(15, -1)
      .lineTo(44, -22)
      .lineTo(48, -18)
      .lineTo(19, 4)
      .closePath()
      .fill({ color: COLORS.steelLight })
      .moveTo(20, 0)
      .lineTo(43, -18)
      .stroke({ color: 0xffffff, width: 1.2, alpha: 0.65 });
    hilt
      .moveTo(14, 1)
      .lineTo(23, 9)
      .stroke({ color: COLORS.gold, width: 5 })
      .circle(18, 4, 2.8)
      .fill({ color: COLORS.goldLight });
  } else {
    blade
      .moveTo(14, -1)
      .lineTo(41, -27)
      .lineTo(46, -24)
      .lineTo(19, 4)
      .closePath()
      .fill({ color: COLORS.steelLight })
      .moveTo(19, 0)
      .lineTo(41, -23)
      .stroke({ color: 0xffffff, width: 1.2, alpha: 0.65 });
    hilt
      .moveTo(13, 1)
      .lineTo(22, 9)
      .stroke({ color: COLORS.gold, width: 5 })
      .circle(17, 4, 2.8)
      .fill({ color: COLORS.goldLight });
  }

  weapon.addChild(blade, hilt);
  return weapon;
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
    .ellipse(0, 18, 26, 11)
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
