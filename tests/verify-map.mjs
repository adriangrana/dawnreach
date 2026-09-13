import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const output = new URL('../node_modules/.cache/map-visual/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => {
  if (message.type() === 'error' && !message.location().url.endsWith('/favicon.ico')) errors.push(message.text());
});

try {
  await page.goto(process.env.ALDEN_URL ?? 'http://127.0.0.1:1420/', { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    const source = await (await fetch('/src/game/createDawnreachGame.ts')).text();
    const THREE = await import(source.match(/import \* as THREE from "([^"]+)"/)[1]);
    const original = THREE.Object3D.prototype.updateMatrixWorld;
    THREE.Object3D.prototype.updateMatrixWorld = function(force) {
      if (this.isScene && this.getObjectByName('dawnreach-map')) {
        this.onAfterRender = (renderer, scene, camera) => {
          if (renderer.domElement.className === 'game-canvas') window.mapCheck = { THREE, scene, camera, renderer };
        };
      }
      return original.call(this, force);
    };
  });
  await page.waitForFunction(() => Boolean(window.mapCheck));
  const placement = await page.evaluate(async () => {
    const { THREE, scene } = window.mapCheck;
    const { BASE_LAYOUT, DAWNREACH_LAYOUT, MAP_BOUNDS } = await import('/src/game/map/mapLayout.ts');
    const { sampleMapPath, distanceToMapPath, getLaneTowerSites } = await import('/src/game/map/buildMapVegetation.ts');
    const world = scene.getObjectByName('dawnreach-map');
    world.updateMatrixWorld(true);
    const bases = ['blue', 'red'].map(team => world.getObjectByName(`${team}-base`));
    const towers = [];
    world.traverse(object => {
      if (object.isGroup && object.name.endsWith('-tower')) towers.push(object);
    });
    const towerHeights = towers.map(tower => new THREE.Box3().setFromObject(tower).getSize(new THREE.Vector3()).y);
    if (Math.max(...towerHeights) - Math.min(...towerHeights) > 0.001) throw new Error('Interior and exterior tower heights differ');
    const baseCounts = bases.map(base => {
      const center = base.getWorldPosition(new THREE.Vector3());
      const inside = towers.filter(tower => {
        const position = tower.getWorldPosition(new THREE.Vector3());
        return Math.hypot(position.x - center.x, position.z - center.z) < BASE_LAYOUT.radius;
      });
      const positions = inside.map(tower => tower.getWorldPosition(new THREE.Vector3()));
      let minSpacing = Infinity;
      positions.forEach((position, index) => positions.slice(index + 1).forEach(other => {
        minSpacing = Math.min(minSpacing, position.distanceTo(other));
      }));
      return { name: base.name, total: inside.length, gates: inside.filter(tower => tower.userData.role === 'gate').length,
        throne: inside.filter(tower => tower.userData.role === 'throne').length, minSpacing };
    });
    const laneTowers = towers.filter(tower => tower.parent === world);
    const towerSites = getLaneTowerSites();
    const laneSpacing = Object.keys(DAWNREACH_LAYOUT.lanes).map(lane => {
      const sites = towerSites.filter(site => site.lane === lane);
      const blue = laneTowers.filter(tower => tower.name === `blue-${lane}-tower`);
      const red = laneTowers.filter(tower => tower.name === `red-${lane}-tower`);
      if (blue.length !== 2 || red.length !== 2) throw new Error(`${lane}: expected two towers per team`);
      const bridge = world.getObjectByName(`${lane}-river-bridge`);
      const bridgeBounds = new THREE.Box3().setFromObject(bridge);
      const distances = [...blue, ...red].map(tower => bridgeBounds.distanceToPoint(tower.position));
      if (distances.some(distance => distance < 2)) throw new Error(`${lane}: tower too close to bridge`);
      return { lane, blue: blue[0].position.distanceTo(blue[1].position), red: red[0].position.distanceTo(red[1].position),
        center: blue[1].position.distanceTo(red[0].position), bridgeClearance: Math.min(...distances),
        intervalsAlongLane: sites.slice(1).map((site, index) => site.distanceAlongLane - sites[index].distanceAlongLane) };
    });
    const lanes = Object.values(DAWNREACH_LAYOUT.lanes).map(sampleMapPath);
    const river = sampleMapPath(DAWNREACH_LAYOUT.river);
    for (const tower of laneTowers) {
      for (const base of bases) {
        const baseClearance = tower.name.includes('-mid-') ? 11 : 4;
        if (Math.hypot(tower.position.x - base.position.x, tower.position.z - base.position.z) < BASE_LAYOUT.radius + baseClearance) {
          throw new Error(`Lane tower too close to base: ${tower.name}`);
        }
      }
    }
    const coverage = { trees: [0, 0, 0, 0], grass: [0, 0, 0, 0] };
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    world.getObjectByName('map-vegetation').traverse(batch => {
      if (!batch.isInstancedMesh) return;
      const kind = batch.name.startsWith('pine-crowns:') ? 'trees' : batch.name.startsWith('grass:') ? 'grass' : null;
      for (let index = 0; index < batch.count; index++) {
        batch.getMatrixAt(index, matrix);
        position.setFromMatrixPosition(matrix).applyMatrix4(batch.matrixWorld);
        if (position.x < MAP_BOUNDS.minX || position.x > MAP_BOUNDS.maxX || position.z < MAP_BOUNDS.minZ || position.z > MAP_BOUNDS.maxZ) {
          throw new Error(`Vegetation outside map: ${batch.name}`);
        }
        for (const base of bases) {
          if (Math.hypot(position.x - base.position.x, position.z - base.position.z) < BASE_LAYOUT.radius + 1.49) {
            throw new Error(`Vegetation invades ${base.name}: ${batch.name}`);
          }
        }
        if (!kind) continue;
        const laneClearance = kind === 'trees' ? 3.54 : 2.64;
        if (lanes.some(lane => distanceToMapPath(position.x, position.z, lane) < laneClearance)
          || distanceToMapPath(position.x, position.z, river) < (kind === 'trees' ? 5.14 : 4.24)) {
          throw new Error(`Vegetation covers a lane or river: ${batch.name}`);
        }
        if (position.x < -48) coverage[kind][0]++;
        if (position.x > 48) coverage[kind][1]++;
        if (position.z < -36) coverage[kind][2]++;
        if (position.z > 36) coverage[kind][3]++;
      }
    });
    return { baseCounts, laneTowerCount: laneTowers.length, laneSpacing, coverage };
  });
  for (const base of placement.baseCounts) {
    assert.equal(base.total, 5, `${base.name}: all towers physically inside the walls`);
    assert.equal(base.gates, 3, `${base.name}: one tower per entrance`);
    assert.equal(base.throne, 2, `${base.name}: two towers before the throne`);
    assert.ok(base.minSpacing > 8, `${base.name}: towers too close (${base.minSpacing})`);
  }
  assert.equal(placement.laneTowerCount, 12, 'two exterior towers per team and lane');
  for (const spacing of placement.laneSpacing) {
    const [blueInterval, centerInterval, redInterval] = spacing.intervalsAlongLane;
    assert.ok(Math.abs(blueInterval - redInterval) < 1e-6, `${spacing.lane}: unequal team intervals`);
    if (spacing.lane !== 'mid') assert.ok(Math.abs(blueInterval - centerInterval) < 1e-6, `${spacing.lane}: unequal intervals along lane`);
    assert.ok(Math.min(spacing.blue, spacing.red) > (spacing.lane === 'mid' ? 18 : 20), `${spacing.lane}: insufficient separation`);
    assert.ok(spacing.center > 20, `${spacing.lane}: center gap reduced`);
  }
  assert.ok(placement.coverage.trees.every(count => count > 25), JSON.stringify(placement.coverage));
  assert.ok(placement.coverage.grass.every(count => count > 100), JSON.stringify(placement.coverage));
  console.log('Base tower counts and vegetation in expanded west/east/north/south:', placement);
  const structure = await page.evaluate(() => {
    const { scene } = window.mapCheck;
    const world = scene.getObjectByName('dawnreach-map');
    const counts = world.getObjectByName('map-vegetation').userData.counts;
    let meshes = 0;
    world.traverse(object => {
      if (!object.isMesh) return;
      meshes++;
      const values = object.geometry.getAttribute('position').array;
      if (!values.every(Number.isFinite)) throw new Error(`Invalid geometry: ${object.name}`);
      if (object.isInstancedMesh && !object.instanceMatrix.array.every(Number.isFinite)) throw new Error('Invalid instances');
    });
    const selection = scene.getObjectByName('H001').children.find(child => child.geometry?.type === 'RingGeometry');
    return { ...counts, meshes, scale: scene.getObjectByName('alden-model').scale.x, selectionScale: selection.geometry.parameters.outerRadius / 0.72 };
  });
  assert.ok(structure.trees > 400, JSON.stringify(structure));
  assert.ok(structure.grass > 6000, JSON.stringify(structure));
  assert.ok(Math.abs(structure.scale - structure.selectionScale) < 1e-9, 'animation overwrote the configured hero size');
  console.log('Map structure:', structure);
  await page.screenshot({ path: `${output}/spawn-desktop.png` });

  const destination = await page.evaluate(() => {
    const { THREE, scene, camera, renderer } = window.mapCheck;
    const hero = scene.getObjectByName('H001');
    const target = new THREE.Vector3(hero.position.x + 2, 0, hero.position.z - 1);
    const pixel = target.clone().project(camera);
    return { x: (pixel.x + 1) * renderer.domElement.clientWidth / 2, y: (1 - pixel.y) * renderer.domElement.clientHeight / 2, target: target.toArray() };
  });
  await page.mouse.click(destination.x, destination.y, { button: 'right' });
  await page.waitForFunction(target => {
    const hero = window.mapCheck.scene.getObjectByName('H001');
    return Math.hypot(hero.position.x - target[0], hero.position.z - target[2]) < 0.06;
  }, destination.target);
  assert.equal(await page.evaluate(() => window.mapCheck.scene.getObjectByName('alden-model').scale.x), structure.scale);

  const waterChecks = await page.evaluate(async () => {
    const state = window.mapCheck;
    const { THREE, scene, renderer } = state;
    const { DAWNREACH_LAYOUT } = await import('/src/game/map/mapLayout.ts');
    const { createWaterEffects } = await import('/src/game/map/waterEffects.ts');
    const world = scene.getObjectByName('dawnreach-map');
    const curve = new THREE.CatmullRomCurve3(DAWNREACH_LAYOUT.river.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'catmullrom', 0.35);
    const center = curve.getPointAt(0.12);
    const tangent = curve.getTangentAt(0.12);
    const river = world.getObjectByName('river-surface');
    const current = world.getObjectByName('river-current');
    const bed = world.getObjectByName('river-bed');
    const pits = DAWNREACH_LAYOUT.objectivePits.map(pit => world.getObjectByName(`${pit.kind}-objective-pit`));
    const target = new THREE.WebGLRenderTarget(128, 128);
    const camera = new THREE.OrthographicCamera(-2.4, 2.4, 2.4, -2.4, 0.1, 30);
    const oldTarget = renderer.getRenderTarget();
    const oldCallback = scene.onAfterRender;
    const oldUpdate = scene.matrixWorldAutoUpdate;
    const oldColor = bed.material.color.clone();
    const oldFlow = current.material.map.offset.clone();
    const oldBump = river.material.bumpMap.offset.clone();
    scene.matrixWorldAutoUpdate = false;
    scene.onAfterRender = () => {};
    const read = () => {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      const pixels = new Uint8Array(128 * 128 * 4);
      renderer.readRenderTargetPixels(target, 0, 0, 128, 128, pixels);
      return pixels;
    };
    const difference = (first, second) => {
      let total = 0;
      let changed = 0;
      for (let offset = 0; offset < first.length; offset += 4) {
        const delta = Math.abs(first[offset] - second[offset]) + Math.abs(first[offset + 1] - second[offset + 1]) + Math.abs(first[offset + 2] - second[offset + 2]);
        total += delta;
        if (delta > 5) changed++;
      }
      return { mean: total / (128 * 128 * 3), changed };
    };
    const pixels = [];
    try {
      for (const point of [center, ...pits.map(pit => pit.position)]) {
        camera.position.set(point.x, 18, point.z);
        camera.up.set(0, 0, -1);
        camera.lookAt(point);
        const initial = read();
        bed.material.color.set(0x161616);
        const dark = read();
        bed.material.color.set(0xffffff);
        const light = read();
        bed.material.color.copy(oldColor);
        current.material.map.offset.y -= 0.15;
        river.material.bumpMap.offset.y -= 0.13;
        const later = read();
        current.material.map.offset.copy(oldFlow);
        river.material.bumpMap.offset.copy(oldBump);
        pixels.push({ bottom: difference(dark, light), motion: difference(initial, later) });
      }
    } finally {
      bed.material.color.copy(oldColor);
      current.material.map.offset.copy(oldFlow);
      river.material.bumpMap.offset.copy(oldBump);
      scene.onAfterRender = oldCallback;
      scene.matrixWorldAutoUpdate = oldUpdate;
      renderer.setRenderTarget(oldTarget);
      target.dispose();
      window.mapCheck = state;
    }
    const probe = createWaterEffects(world);
    let time = 0;
    const emitsAt = point => {
      time += 3;
      const actor = new THREE.Object3D();
      actor.position.copy(point);
      probe.update(time, [actor]);
      actor.position.x += 0.12;
      probe.update(time + 0.1, [actor]);
      const active = probe.group.children.filter(burst => burst.visible);
      if (active.some(burst => Math.hypot(burst.position.x - actor.position.x, burst.position.z - actor.position.z) > 0.2)) throw new Error('Splash emitted away from feet');
      probe.update(time + 2, [actor]);
      if (probe.group.children.some(burst => burst.visible)) throw new Error('Stationary actor keeps splashing');
      return active.length;
    };
    const splash = {
      river: emitsAt(center),
      pools: pits.map(pit => emitsAt(pit.position)),
      bridge: emitsAt(world.getObjectByName('mid-river-bridge').position),
      dry: emitsAt(new THREE.Vector3(DAWNREACH_LAYOUT.blueSpawn.x, 0.03, DAWNREACH_LAYOUT.blueSpawn.z)),
    };
    const geometries = new Set();
    const materials = new Set();
    probe.group.traverse(object => {
      if (object.isMesh) { geometries.add(object.geometry); materials.add(object.material); }
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    const architecture = pits.map(pit => {
      const ruins = pit.getObjectByName('objective-ruins');
      const bounds = new THREE.Box3().setFromObject(ruins);
      const entrance = pit.userData.entranceAngle;
      const ray = new THREE.Raycaster(new THREE.Vector3(pit.position.x, 1, pit.position.z), new THREE.Vector3(Math.cos(entrance), 0, Math.sin(entrance)), 0, 8);
      const blocking = ray.intersectObject(ruins, true).length;
      return { height: bounds.max.y, width: bounds.max.x - bounds.min.x, blocking,
        animated: pit.getObjectByName('objective-current').material.map === current.material.map };
    });
    window.riverTestCenter = center.toArray();
    return { pixels, splash, architecture, center: center.toArray(), tangent: tangent.toArray(), flow: current.material.map.offset.y,
      vertexHeight: river.geometry.getAttribute('position').getY(73), opacity: river.material.opacity };
  });
  assert.ok(waterChecks.opacity <= 0.55, 'Water must remain transparent');
  for (const pixels of waterChecks.pixels) {
    assert.ok(pixels.bottom.mean > 15 && pixels.bottom.changed > 8000, `Bottom hidden: ${JSON.stringify(pixels)}`);
    assert.ok(pixels.motion.changed > 500, `Current not visibly animated: ${JSON.stringify(pixels)}`);
  }
  assert.ok(waterChecks.splash.river > 0 && waterChecks.splash.pools.every(count => count > 0), JSON.stringify(waterChecks.splash));
  assert.equal(waterChecks.splash.bridge, 0, 'Bridge must not splash');
  assert.equal(waterChecks.splash.dry, 0, 'Dry ground must not splash');
  for (const pit of waterChecks.architecture) {
    assert.ok(pit.height > 4.5 && pit.width > 10 && pit.blocking === 0 && pit.animated, JSON.stringify(pit));
  }
  await page.waitForFunction(previous => {
    const world = window.mapCheck.scene.getObjectByName('dawnreach-map');
    return Math.abs(world.getObjectByName('river-current').material.map.offset.y - previous.flow) > 0.025
      && Math.abs(world.getObjectByName('river-surface').geometry.getAttribute('position').getY(73) - previous.vertexHeight) > 0.0005;
  }, waterChecks);
  await page.evaluate(center => window.mapCheck.scene.getObjectByName('H001').position.set(center[0], 0.03, center[2]), waterChecks.center);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const ford = await page.evaluate(({ center, tangent }) => {
    const { THREE, renderer, camera } = window.mapCheck;
    const destination = new THREE.Vector3().fromArray(center).addScaledVector(new THREE.Vector3().fromArray(tangent), 3);
    const pixel = destination.clone().project(camera);
    return { x: (pixel.x + 1) * renderer.domElement.clientWidth / 2, y: (1 - pixel.y) * renderer.domElement.clientHeight / 2, destination: destination.toArray() };
  }, waterChecks);
  await page.mouse.click(ford.x, ford.y, { button: 'right' });
  await page.waitForFunction(() => window.mapCheck.scene.getObjectByName('water-footsteps').children.filter(burst => burst.visible).length > 1);
  const splashPixels = await page.evaluate(() => {
    const { THREE, renderer, camera, scene } = window.mapCheck;
    const effects = scene.getObjectByName('water-footsteps');
    const hero = scene.getObjectByName('H001');
    const point = new THREE.Vector3(hero.position.x, 0, hero.position.z).project(camera);
    const gl = renderer.getContext();
    const left = Math.round((point.x + 1) * gl.drawingBufferWidth / 2) - 64;
    const bottom = Math.round((point.y + 1) * gl.drawingBufferHeight / 2) - 64;
    const read = () => {
      renderer.render(scene, camera);
      const pixels = new Uint8Array(128 * 128 * 4);
      gl.readPixels(left, bottom, 128, 128, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return pixels;
    };
    try {
      const visible = read();
      effects.visible = false;
      const hidden = read();
      let changed = 0;
      for (let offset = 0; offset < visible.length; offset += 4) {
        if (Math.abs(visible[offset] - hidden[offset]) + Math.abs(visible[offset + 1] - hidden[offset + 1]) + Math.abs(visible[offset + 2] - hidden[offset + 2]) > 8) changed++;
      }
      return changed;
    } finally {
      effects.visible = true;
      renderer.render(scene, camera);
    }
  });
  assert.ok(splashPixels > 12, `Footstep particles not visible around feet: ${splashPixels}`);
  await page.screenshot({ path: `${output}/river-splashes-desktop.png` });
  await page.waitForFunction(target => {
    const hero = window.mapCheck.scene.getObjectByName('H001');
    return Math.hypot(hero.position.x - target[0], hero.position.z - target[2]) < 0.08;
  }, ford.destination);
  await page.waitForFunction(() => window.mapCheck.scene.getObjectByName('water-footsteps').children.every(burst => !burst.visible));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const mobileTarget = await page.evaluate(center => {
    const { THREE, renderer, camera } = window.mapCheck;
    const point = new THREE.Vector3().fromArray(center).project(camera);
    return { x: (point.x + 1) * renderer.domElement.clientWidth / 2, y: (1 - point.y) * renderer.domElement.clientHeight / 2 };
  }, waterChecks.center);
  await page.mouse.click(mobileTarget.x, mobileTarget.y, { button: 'right' });
  await page.waitForFunction(() => window.mapCheck.scene.getObjectByName('water-footsteps').children.filter(burst => burst.visible).length > 1);
  await page.screenshot({ path: `${output}/river-mobile.png` });
  await page.waitForFunction(target => {
    const hero = window.mapCheck.scene.getObjectByName('H001');
    return Math.hypot(hero.position.x - target[0], hero.position.z - target[2]) < 0.08;
  }, waterChecks.center);
  await page.setViewportSize({ width: 1440, height: 1000 });
  console.log('Visible footstep pixels near hero:', splashPixels);
  console.log('Water: visible bottom, current pixels, moving footsteps and open ruins:', waterChecks);

  const closeups = await page.evaluate(async () => {
    const { DAWNREACH_LAYOUT } = await import('/src/game/map/mapLayout.ts');
    return [['jungle', -27, -4], ['mid-bridge', 0, 0], ...DAWNREACH_LAYOUT.objectivePits.map(pit => [`${pit.kind}-pit`, pit.x, pit.z]), ['red-base', 33.5, -25]];
  });
  for (const [name, x, z] of closeups) {
    await page.evaluate(([x, z]) => window.mapCheck.scene.getObjectByName('H001').position.set(x, 0.03, z), [x, z]);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: `${output}/${name}.png` });
  }

  await page.evaluate(async () => {
    const { THREE } = window.mapCheck;
    const { DAWNREACH_LAYOUT } = await import('/src/game/map/mapLayout.ts');
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(1440, 1000);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    Object.assign(renderer.domElement.style, { position: 'fixed', inset: 0, zIndex: 1000 });
    document.body.appendChild(renderer.domElement);
    const halfWidth = Math.max((DAWNREACH_LAYOUT.width + 10) / 2, (DAWNREACH_LAYOUT.height + 12) / 2 * 1.44);
    const camera = new THREE.OrthographicCamera(-halfWidth, halfWidth, halfWidth / 1.44, -halfWidth / 1.44, 0.1, 240);
    window.mapInspection = { renderer, camera };
  });
  for (const view of ['overview', 'topdown']) {
    const pixels = await page.evaluate(view => {
      const { THREE, scene } = window.mapCheck;
      const { renderer, camera } = window.mapInspection;
      const oldFog = scene.fog;
      scene.fog = null;
      camera.position.set(0, 95, view === 'overview' ? 62 : 0);
      camera.up.set(0, view === 'overview' ? 1 : 0, view === 'overview' ? 0 : -1);
      camera.lookAt(0, -1, 0);
      camera.updateMatrixWorld();
      renderer.render(scene, camera);
      const gl = renderer.getContext();
      const pixels = new Uint8Array(1440 * 1000 * 4);
      gl.readPixels(0, 0, 1440, 1000, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const colors = new Set();
      let green = 0;
      let water = 0;
      for (let offset = 0; offset < pixels.length; offset += 16) {
        const [red, greenChannel, blue] = pixels.subarray(offset, offset + 3);
        colors.add((red >> 4) * 256 + (greenChannel >> 4) * 16 + (blue >> 4));
        if (greenChannel > red * 1.07 && greenChannel > blue * 1.08) green++;
        if (blue > red * 1.3 && greenChannel > red * 1.1) water++;
      }
      scene.fog = oldFog;
      return { colors: colors.size, green, water, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    }, view);
    assert.ok(pixels.colors > 80 && pixels.green > 10000 && pixels.water > 300, JSON.stringify(pixels));
    console.log(`${view}:`, pixels);
    await page.screenshot({ path: `${output}/${view}.png` });
  }
  for (const team of ['blue', 'red']) {
    await page.evaluate(team => {
      const { scene, THREE } = window.mapCheck;
      const { renderer, camera } = window.mapInspection;
      const base = scene.getObjectByName(`${team}-base`);
      const center = base.getWorldPosition(new THREE.Vector3());
      const extent = base.userData.plazaRadius + 3;
      camera.left = -extent * 1.44;
      camera.right = extent * 1.44;
      camera.top = extent;
      camera.bottom = -extent;
      camera.updateProjectionMatrix();
      camera.position.set(center.x, 65, center.z + 30);
      camera.up.set(0, 1, 0);
      camera.lookAt(center.x, 0, center.z);
      const fog = scene.fog;
      scene.fog = null;
      renderer.render(scene, camera);
      scene.fog = fog;
    }, team);
    await page.screenshot({ path: `${output}/${team}-base-layout.png` });
  }
  await page.evaluate(async () => {
    const { DAWNREACH_LAYOUT } = await import('/src/game/map/mapLayout.ts');
    window.mapInspection.renderer.domElement.remove();
    window.mapInspection.renderer.dispose();
    window.mapCheck.scene.getObjectByName('H001').position.set(DAWNREACH_LAYOUT.blueSpawn.x, 0.03, DAWNREACH_LAYOUT.blueSpawn.z);
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const mobile = await page.evaluate(() => {
    const { renderer, scene, camera } = window.mapCheck;
    renderer.render(scene, camera);
    const gl = renderer.getContext();
    const pixel = new Uint8Array(4);
    const colors = new Set();
    for (let x = 20; x < gl.drawingBufferWidth; x += 31) {
      for (let y = 200; y < gl.drawingBufferHeight - 200; y += 29) {
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
        colors.add(pixel.slice(0, 3).join(','));
      }
    }
    return { colors: colors.size, width: gl.drawingBufferWidth, height: gl.drawingBufferHeight, overflow: document.documentElement.scrollWidth > innerWidth };
  });
  assert.ok(mobile.colors > 60 && !mobile.overflow && mobile.width === 390, JSON.stringify(mobile));
  await page.screenshot({ path: `${output}/spawn-mobile.png` });
  assert.deepEqual(errors, []);
  console.log('Desktop/mobile, full map pixels, movement and hero scale OK; captures:', output);
} finally {
  await browser.close();
}