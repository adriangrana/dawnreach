import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = new URL('../node_modules/.cache/alden-visual/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) {
    errors.push(`${message.text()} (${message.location().url})`);
  }
});

try {
  await page.goto(process.env.ALDEN_URL ?? 'http://localhost:1420/');
  await page.waitForFunction(() => document.querySelector('canvas')?.width > 0);
  await page.reload();
  await page.evaluate(async () => {
    const source = await (await fetch('/src/game/createDawnreachGame.ts')).text();
    const moduleUrl = source.match(/import \* as THREE from "([^"]+)"/)[1];
    const THREE = await import(moduleUrl);
    const update = THREE.Object3D.prototype.updateMatrixWorld;
    THREE.Object3D.prototype.updateMatrixWorld = function(force) {
      if (this.isScene && this.getObjectByName('alden')) {
        this.onAfterRender = (renderer, scene, camera) => {
          window.aldenCheck = { THREE, renderer, scene, camera };
          const model = scene.getObjectByName('alden-model');
          const stats = window.aldenMotionStats ??= { knee: 0, footHeight: 0, elbowMin: 0, elbowMax: -Infinity, pelvisYaw: 0, pelvisDrop: 0, headError: 0, torsoLow: Infinity, torsoHigh: -Infinity, torsoJump: 0, torsoLeft: 0, torsoRight: 0, chestRoll: 0, rollError: 0, yawError: 0, headLateralError: 0 };
          const torso = model.getObjectByName('torso');
          const torsoHeight = torso.matrixWorld.elements[13];
          stats.torsoLeft = Math.min(stats.torsoLeft, torso.position.x);
          stats.torsoRight = Math.max(stats.torsoRight, torso.position.x);
          stats.torsoLow = Math.min(stats.torsoLow, torsoHeight);
          stats.torsoHigh = Math.max(stats.torsoHigh, torsoHeight);
          stats.torsoJump = Math.max(stats.torsoJump, Math.abs(torsoHeight - (stats.lastTorsoHeight ?? torsoHeight)));
          stats.lastTorsoHeight = torsoHeight;
          const pelvis = model.getObjectByName('pelvis');
          stats.chestRoll = Math.max(stats.chestRoll, Math.abs(torso.rotation.z));
          stats.rollError = Math.max(stats.rollError, Math.abs(torso.rotation.z + pelvis.rotation.z * 0.6));
          stats.yawError = Math.max(stats.yawError, Math.abs(torso.rotation.y + pelvis.rotation.y));
          const headPosition = model.worldToLocal(model.getObjectByName('helmet').getWorldPosition(new THREE.Vector3()));
          stats.headLateralError = Math.max(stats.headLateralError, Math.abs(headPosition.x));
          stats.pelvisYaw = Math.max(stats.pelvisYaw, Math.abs(pelvis.rotation.y));
          stats.pelvisDrop = Math.max(stats.pelvisDrop, Math.abs(pelvis.rotation.z));
          stats.headError = Math.max(stats.headError, model.getObjectByName('helmet').getWorldQuaternion(new THREE.Quaternion()).angleTo(model.getWorldQuaternion(new THREE.Quaternion())));
          for (const side of ['left', 'right']) {
            stats.knee = Math.max(stats.knee, model.getObjectByName(`${side}-knee`).rotation.x);
            stats.footHeight = Math.max(stats.footHeight, model.getObjectByName(`${side}-ankle`).matrixWorld.elements[13]);
            const elbow = model.getObjectByName(`${side}-shoulder`).getObjectByName('elbow').rotation.x;
            stats.elbowMin = Math.min(stats.elbowMin, elbow);
            stats.elbowMax = Math.max(stats.elbowMax, elbow);
          }
        };
      }
      return update.call(this, force);
    };
  });
  await page.waitForFunction(() => !!window.aldenCheck);
  const palette = await page.evaluate(async () => {
    const { createAldenMaterials } = await import('/src/game/heroes/alden/materials.ts');
    const fresh = createAldenMaterials();
    const actual = new Map();
    window.aldenCheck.scene.getObjectByName('alden-model').traverse(part => {
      if (part.isMesh) {
        actual.set(part.material.name, part.material);
        if (part.material.vertexColors && !part.geometry.getAttribute('color')) throw new Error(`Missing painted colors: ${part.name}`);
      }
    });
    const samples = {};
    for (const name of ['steel', 'gold', 'blue', 'leather', 'chain']) {
      const material = actual.get(`alden-${name}`);
      const canvas = material.map.image;
      if (canvas.toDataURL() !== fresh[name].map.image.toDataURL()) throw new Error(`Non-deterministic ${name} texture`);
      samples[name] = Array.from(canvas.getContext('2d').getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data).slice(0, 3);
      if (name !== 'chain' && !material.map.repeat.equals(new window.aldenCheck.THREE.Vector2(1, 1))) throw new Error(`Repeated painted stripes: ${name}`);
    }
    if (actual.get('alden-blue').roughness < 0.9 || actual.get('alden-steel').roughness < 0.4) throw new Error('Painted materials are too glossy');
    const textures = new Set(Object.values(fresh).map(material => material.map).filter(Boolean));
    for (const texture of textures) texture.dispose();
    for (const material of Object.values(fresh)) material.dispose();
    return samples;
  });
  assert.ok(palette.steel.every(channel => channel > 160), 'silver should retain a light base color');
  assert.ok(palette.gold[0] > palette.gold[1] && palette.gold[1] > palette.gold[2] * 1.3, 'gold must be warm');
  assert.ok(palette.blue[2] > palette.blue[1] * 1.4 && palette.blue[1] > palette.blue[0], 'cloth must remain royal blue');
  await page.screenshot({ path: `${output}/desktop.png` });

  const originalCamera = await page.evaluate(() => window.aldenCheck.camera.position.toArray());
  const headings = [0, Math.PI / 4, Math.PI / 2, Math.PI * 3 / 4, Math.PI, -Math.PI * 3 / 4, -Math.PI / 2, -Math.PI / 4];
  const destinations = [];
  const movementSpeeds = [];
  let motionObserved = false;
  for (const heading of headings) {
    const destination = await page.evaluate(angle => {
      const { THREE, scene, camera, renderer } = window.aldenCheck;
      const hero = scene.getObjectByName('alden');
      const target = new THREE.Vector3(hero.position.x + Math.sin(angle) * 1.8, 0, hero.position.z + Math.cos(angle) * 1.8);
      const projected = target.clone().project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return { target: target.toArray(), pixel: [rect.x + (projected.x + 1) * rect.width / 2, rect.y + (1 - projected.y) * rect.height / 2] };
    }, heading);
    const movementStarted = performance.now();
    await page.mouse.click(...destination.pixel, { button: 'right' });
    if (!motionObserved) {
      const before = await page.evaluate(() => {
        const model = window.aldenCheck.scene.getObjectByName('alden-model');
        return {
          elbow: model.getObjectByName('left-shoulder').getObjectByName('elbow').rotation.x,
          cape: model.getObjectByName('pleated-cape').geometry.getAttribute('position').getZ(800),
        };
      });
      await page.waitForFunction(previous => {
        const model = window.aldenCheck.scene.getObjectByName('alden-model');
        const elbow = model.getObjectByName('left-shoulder').getObjectByName('elbow').rotation.x;
        const cape = model.getObjectByName('pleated-cape').geometry.getAttribute('position').getZ(800);
        return Math.abs(elbow - previous.elbow) > 0.02 && Math.abs(cape - previous.cape) > 0.005;
      }, before);
      motionObserved = true;
    }
    await page.waitForFunction(({ target, heading }) => {
      const { scene } = window.aldenCheck;
      const hero = scene.getObjectByName('alden');
      const model = hero.getObjectByName('alden-model');
      const yawDelta = Math.atan2(Math.sin(heading - model.rotation.y), Math.cos(heading - model.rotation.y));
      return Math.hypot(hero.position.x - target[0], hero.position.z - target[2]) < 0.04 && Math.abs(yawDelta) < 0.025;
    }, { target: destination.target, heading });
    movementSpeeds.push(1.8 / ((performance.now() - movementStarted) / 1000));
    destinations.push(destination.target);
  }
  assert.equal(destinations.length, 8);
  const medianSpeed = [...movementSpeeds].sort((first, second) => first - second)[4];
  assert.ok(medianSpeed > 3.4 && medianSpeed < 4.2, `movement should default to the 3.8-unit fast walk: ${medianSpeed}`);
  const motion = await page.evaluate(() => window.aldenMotionStats);
  assert.ok(motion.knee > 0.95 && motion.knee <= Math.PI / 3 + 1e-6 && motion.footHeight > 0.24, `recovery must stay within human ranges: ${JSON.stringify(motion)}`);
  assert.ok(motion.pelvisYaw > 0.025 && motion.pelvisYaw <= Math.PI / 90 + 1e-6, 'pelvis yaw must stay near two degrees');
  assert.ok(motion.pelvisDrop > 0.035 && motion.pelvisDrop <= Math.PI / 72 + 1e-6, 'pelvic drop must stay near two and a half degrees');
  assert.ok(motion.headError < 1e-6, `head must keep the model facing: ${motion.headError}`);
  assert.ok(motion.torsoHigh - motion.torsoLow < 0.05 && motion.torsoJump < 0.018, `torso must not bounce with the foot contacts: ${JSON.stringify(motion)}`);
  assert.ok(motion.torsoLeft < -0.0175 && motion.torsoRight > 0.0175 && Math.max(-motion.torsoLeft, motion.torsoRight) < 0.023, 'chest counterbalance must remain subtle');
  assert.ok(motion.chestRoll > 0.02 && motion.chestRoll <= Math.PI / 120 + 1e-6 && motion.rollError < 1e-6 && motion.yawError < 1e-6, 'chest must subtly counter-rotate against pelvis in roll and yaw');
  assert.ok(motion.headLateralError < 1e-6, 'head center must remain on the model centerline');
  assert.ok(motion.elbowMax - motion.elbowMin > 0.25, 'forearms must flex visibly while moving');
  assert.deepEqual(await page.evaluate(() => window.aldenCheck.camera.position.toArray()), originalCamera);

  const sampleCanvas = () => page.evaluate(() => {
    const { scene, camera, renderer } = window.aldenCheck;
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
    gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let blue = 0;
    let mint = 0;
    let health = 0;
    let litSurface = 0;
    const colors = new Set();
    for (let pixel = 0; pixel < pixels.length; pixel += 4) {
      const red = pixels[pixel];
      const green = pixels[pixel + 1];
      const blueChannel = pixels[pixel + 2];
      if (blueChannel > red * 1.4 && blueChannel > green * 1.15 && blueChannel > 45) blue += 1;
      if (green > red * 1.15 && blueChannel > red * 1.05 && green > 165 && red < 220) mint += 1;
      if (green > red * 1.5 && green > blueChannel * 1.3 && green > 110) health += 1;
      if (red > 90 && green > 85 && blueChannel > 60 && red < 200) litSurface += 1;
      colors.add((red >> 4) * 256 + (green >> 4) * 16 + (blueChannel >> 4));
    }
    const hero = scene.getObjectByName('alden');
    return {
      blue, mint, health, litSurface, colors: colors.size, triangles: renderer.info.render.triangles,
      calls: renderer.info.render.calls, label: hero.children.some(child => child.isSprite),
      canvas: [gl.drawingBufferWidth, gl.drawingBufferHeight],
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  const desktop = await sampleCanvas();
  assert.ok(desktop.blue > 150 && desktop.mint > 15 && desktop.colors > 50, JSON.stringify(desktop));
  assert.ok(desktop.label && !desktop.overflow);
  assert.ok(desktop.health > 100 && desktop.litSurface > 1280 * 764 * 0.05, 'desktop textures must not be black');
  await page.screenshot({ path: `${output}/desktop-after-movement.png` });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelector('canvas').width === 390);
  const mobile = await sampleCanvas();
  assert.ok(mobile.blue > 150 && mobile.mint > 15 && !mobile.overflow, JSON.stringify(mobile));
  assert.ok(mobile.health > 100 && mobile.litSurface > 390 * 808 * 0.05, 'mobile textures must not be black');
  await page.screenshot({ path: `${output}/mobile.png` });

  await page.setViewportSize({ width: 1600, height: 700 });
  const views = await page.evaluate(async () => {
    const { THREE, scene } = window.aldenCheck;
    const { buildAlden } = await import('/src/game/heroes/alden/buildAlden.ts');
    const { createAldenMaterials } = await import('/src/game/heroes/alden/materials.ts');
    const { ALDEN_GAIT_RATE, animateAlden } = await import('/src/game/heroes/alden/animateAlden.ts');
    const stage = new THREE.Scene();
    stage.background = new THREE.Color(0x696b68);
    for (const object of scene.children) {
      if (object.isLight) stage.add(object.clone());
    }
    const inspectionRig = buildAlden(createAldenMaterials());
    const hero = inspectionRig.model;
    animateAlden(inspectionRig, 0, false, 0);
    stage.add(inspectionRig.root);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: 0x777974, roughness: 1 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    stage.add(floor);
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(400, 650);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    const camera = new THREE.OrthographicCamera(-1.5, 1.5, 2.4375, -2.4375, 0.1, 100);
    camera.position.set(0, 4.6, 10);
    camera.lookAt(0, 1.55, 0);
    const sheet = document.createElement('canvas');
    sheet.width = 1600;
    sheet.height = 700;
    const context = sheet.getContext('2d');
    context.fillStyle = '#696b68';
    context.fillRect(0, 0, 1600, 700);
    const angles = [0, -Math.PI / 4, -Math.PI / 2, Math.PI];
    const labels = ['FRONT', 'THREE QUARTER', 'PROFILE', 'BACK'];
    const pixelCounts = [];
    for (const [index, angle] of angles.entries()) {
      hero.rotation.y = angle;
      const bounds = new THREE.Box3().setFromObject(hero);
      const center = (bounds.min.x + bounds.max.x) / 2;
      camera.position.x = center;
      camera.lookAt(center, 1.55, 0);
      renderer.render(stage, camera);
      context.drawImage(renderer.domElement, index * 400, 0);
      const pixels = context.getImageData(index * 400, 0, 400, 650).data;
      let blue = 0;
      for (let pixel = 0; pixel < pixels.length; pixel += 4) {
        if (pixels[pixel + 2] > pixels[pixel] * 1.4 && pixels[pixel + 2] > pixels[pixel + 1] * 1.15) blue += 1;
      }
      pixelCounts.push(blue);
      context.font = '18px Georgia';
      context.textAlign = 'center';
      context.fillStyle = '#ece6d9';
      context.fillText(labels[index], index * 400 + 200, 678);
    }
    document.body.replaceChildren(sheet);
    document.body.style.cssText = 'margin:0; width:1600px; height:700px; overflow:hidden';
    const kneeAngles = [];
    const supportPoses = [];
    inspectionRig.gait.weight = 1;
    inspectionRig.capeMotion = 1;
    const gaitViews = [
      { name: 'aldenWalkSheet', yaw: -Math.PI / 2 + 0.20, fixedCamera: false, phases: [[0, 'LEFT CONTACT'], [0.2, 'RIGHT RECOVERY'], [0.5, 'RIGHT CONTACT'], [0.7, 'LEFT RECOVERY']] },
      { name: 'aldenWeightSheet', yaw: 0, fixedCamera: true, phases: [[0.1, 'LEFT LOADING'], [0.3, 'LEFT SUPPORT'], [0.6, 'RIGHT LOADING'], [0.8, 'RIGHT SUPPORT']] },
    ];
    for (const view of gaitViews) {
      const poseSheet = document.createElement('canvas');
      poseSheet.width = 1600;
      poseSheet.height = 700;
      const poseContext = poseSheet.getContext('2d');
      poseContext.fillStyle = '#696b68';
      poseContext.fillRect(0, 0, 1600, 700);
      for (const [frame, [cycle, label]] of view.phases.entries()) {
        inspectionRig.gait.phase = cycle * Math.PI * 2;
        hero.rotation.y = view.yaw;
        animateAlden(inspectionRig, inspectionRig.gait.phase / ALDEN_GAIT_RATE, true, 0);
        const bounds = new THREE.Box3().setFromObject(hero);
        const center = view.fixedCamera ? 0 : (bounds.min.x + bounds.max.x) / 2;
        camera.position.x = center;
        camera.lookAt(center, 1.55, 0);
        renderer.render(stage, camera);
        poseContext.drawImage(renderer.domElement, frame * 400, 0);
        poseContext.font = '18px Georgia';
        poseContext.textAlign = 'center';
        poseContext.fillStyle = '#ece6d9';
        poseContext.fillText(label, frame * 400 + 200, 678);
        if (view.fixedCamera) {
          const { foot, points } = inspectionRig.soleSamples[cycle < 0.5 ? 0 : 1];
          supportPoses.push({
            torsoX: inspectionRig.torso.position.x,
            torsoY: inspectionRig.torso.getWorldPosition(new THREE.Vector3()).y,
            pelvisX: inspectionRig.pelvis.position.x,
            pelvisRoll: inspectionRig.pelvis.rotation.z,
            chestRoll: inspectionRig.torso.rotation.z,
            headX: hero.worldToLocal(inspectionRig.head.getWorldPosition(new THREE.Vector3())).x,
            soleY: Math.min(...points.map(point => point.clone().applyMatrix4(foot.matrixWorld).y)),
          });
        } else {
          kneeAngles.push([inspectionRig.leftShin.rotation.x, inspectionRig.rightShin.rotation.x]);
        }
      }
      window[view.name] = poseSheet;
    }
    const { buildHumanoidBody } = await import('/src/game/characters/buildHumanoidBody.ts');
    const { animateHumanoid } = await import('/src/game/characters/animateHumanoid.ts');
    const body = buildHumanoidBody();
    stage.remove(inspectionRig.root);
    stage.onAfterRender = () => {};
    stage.add(body.root);
    body.gait.weight = 1;
    const bodySheet = document.createElement('canvas');
    bodySheet.width = 1600;
    bodySheet.height = 700;
    const bodyContext = bodySheet.getContext('2d');
    bodyContext.fillStyle = '#696b68';
    bodyContext.fillRect(0, 0, 1600, 700);
    const bodyPixels = [];
    for (const [index, [cycle, yaw]] of [[0, 0], [0.2, 0], [0.5, -Math.PI / 2], [0.7, -Math.PI / 2]].entries()) {
      body.gait.phase = cycle * Math.PI * 2;
      body.model.rotation.y = yaw;
      animateHumanoid(body, index, true, 0);
      camera.position.x = 0;
      camera.lookAt(0, 1.55, 0);
      renderer.render(stage, camera);
      bodyContext.drawImage(renderer.domElement, index * 400, 0);
      const pixels = bodyContext.getImageData(index * 400, 0, 400, 650).data;
      let teal = 0;
      for (let pixel = 0; pixel < pixels.length; pixel += 4) {
        if (pixels[pixel + 1] > pixels[pixel] * 1.1 && pixels[pixel + 2] > pixels[pixel] * 1.1) teal += 1;
      }
      bodyPixels.push(teal);
      bodyContext.font = '18px Georgia';
      bodyContext.textAlign = 'center';
      bodyContext.fillStyle = '#ece6d9';
      bodyContext.fillText(`HUMANOID ${cycle.toFixed(1)}`, index * 400 + 200, 678);
    }
    window.humanoidSheet = bodySheet;
    renderer.dispose();
    return { pixelCounts, kneeAngles, supportPoses, bodyPixels };
  });
  assert.ok(views.pixelCounts.every(count => count > 1200), `blank view: ${views.pixelCounts}`);
  await page.screenshot({ path: `${output}/turnaround.png` });
  await page.evaluate(() => document.body.replaceChildren(window.aldenWalkSheet));
  await page.screenshot({ path: `${output}/walk-cycle.png` });
  assert.ok(views.supportPoses.every((pose, index) => Math.abs(pose.soleY - 0.015) < 0.005 && (index < 2 ? pose.pelvisX < 0 : pose.pelvisX > 0) && pose.torsoX * pose.pelvisX <= 0 && Math.abs(pose.headX) < 1e-6), 'pelvis loading must be counterbalanced with the head centered');
  for (const index of [1, 3]) assert.ok(views.supportPoses[index].pelvisRoll * views.supportPoses[index].chestRoll < -0.00025, 'hip and shoulder roll must subtly oppose each other');
  for (const index of [0, 2]) assert.ok(views.supportPoses[index + 1].torsoY - views.supportPoses[index].torsoY > 0.03, 'the body must rise after loading');
  await page.evaluate(() => document.body.replaceChildren(window.aldenWeightSheet));
  await page.screenshot({ path: `${output}/weight-transfer.png` });
  assert.ok(views.bodyPixels.every(count => count > 1500), `blank humanoid inspection view: ${views.bodyPixels}`);
  await page.evaluate(() => document.body.replaceChildren(window.humanoidSheet));
  await page.screenshot({ path: `${output}/humanoid-walk-cycle.png` });

  await page.goto(new URL('?rig=humanoid', process.env.ALDEN_URL ?? 'http://localhost:1420/').href);
  await page.evaluate(async () => {
    const source = await (await fetch('/src/game/createDawnreachGame.ts')).text();
    const THREE = await import(source.match(/import \* as THREE from "([^"]+)"/)[1]);
    const update = THREE.Object3D.prototype.updateMatrixWorld;
    THREE.Object3D.prototype.updateMatrixWorld = function(force) {
      if (this.isScene && this.getObjectByName('humanoid')) {
        this.onAfterRender = (renderer, scene, camera) => { window.humanoidCheck = { THREE, renderer, scene, camera }; };
      }
      return update.call(this, force);
    };
  });
  await page.waitForFunction(() => !!window.humanoidCheck);
  const humanoidViews = [];
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.waitForFunction(width => document.querySelector('canvas').width === width, viewport.width);
    const target = await page.evaluate(() => {
      const { THREE, renderer, scene, camera } = window.humanoidCheck;
      const root = scene.getObjectByName('humanoid');
      if (scene.getObjectByName('alden') || root.getObjectByName('cape') || root.getObjectByName('sword-blade')) throw new Error('Basic body unexpectedly requires Alden or equipment');
      const point = root.position.clone().add(new THREE.Vector3(0.7, -root.position.y, -2));
      const projected = point.clone().project(camera);
      const rect = renderer.domElement.getBoundingClientRect();
      return { position: point.toArray(), click: [rect.x + (projected.x + 1) * rect.width / 2, rect.y + (1 - projected.y) * rect.height / 2] };
    });
    await page.mouse.click(...target.click, { button: 'right' });
    await page.waitForFunction(() => {
      const root = window.humanoidCheck.scene.getObjectByName('humanoid');
      return root.getObjectByName('left-knee').rotation.x > 0.2 && Math.abs(root.getObjectByName('left-hip').rotation.x) > 0.1;
    });
    await page.waitForFunction(destination => {
      const root = window.humanoidCheck.scene.getObjectByName('humanoid');
      return Math.hypot(root.position.x - destination[0], root.position.z - destination[2]) < 0.04 && Math.abs(root.getObjectByName('left-hip').rotation.x) < 0.00001;
    }, target.position);
    const pixels = await page.evaluate(() => {
      const { THREE, renderer, scene, camera } = window.humanoidCheck;
      renderer.render(scene, camera);
      const bounds = new THREE.Box3().setFromObject(scene.getObjectByName('humanoid-model'));
      const corners = [];
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        corners.push(new THREE.Vector3(x, y, z).project(camera));
      }
      const gl = renderer.getContext();
      const width = gl.drawingBufferWidth;
      const height = gl.drawingBufferHeight;
      const left = Math.floor(Math.min(...corners.map(point => (point.x + 1) * width / 2)));
      const right = Math.ceil(Math.max(...corners.map(point => (point.x + 1) * width / 2)));
      const bottom = Math.floor(Math.min(...corners.map(point => (point.y + 1) * height / 2)));
      const top = Math.ceil(Math.max(...corners.map(point => (point.y + 1) * height / 2)));
      const samples = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, samples);
      let teal = 0;
      let porcelain = 0;
      for (let y = bottom; y < top; y += 1) for (let x = left; x < right; x += 1) {
        const offset = (y * width + x) * 4;
        const [red, green, blue] = samples.subarray(offset, offset + 3);
        if (green > red * 1.1 && blue > red * 1.1) teal += 1;
        if (red > 170 && green > 175 && blue > 165) porcelain += 1;
      }
      return { teal, porcelain, fits: left >= 0 && right <= width && bottom >= 0 && top <= height, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.ok(pixels.teal > 100 && pixels.porcelain > 50 && pixels.fits && !pixels.overflow, JSON.stringify(pixels));
    humanoidViews.push({ viewport, ...pixels });
    await page.screenshot({ path: `${output}/humanoid-${viewport.width}.png` });
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ palette, desktop, mobile, headings: destinations.length, medianSpeed, motionObserved, motion, views, humanoidViews, errors, output }, null, 2));
} finally {
  await browser.close();
}