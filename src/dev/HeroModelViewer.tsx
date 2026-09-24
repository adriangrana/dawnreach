import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { getHeroPortrait } from '../game/heroes/assets';
import { getHeroDefinition } from '../game/heroes/catalog';
import { buildDevHeroModel, listDevViewableHeroes, type DevHeroModel } from '../game/heroes/devModels';
import type { HeroId } from '../game/heroes/types';

type AnimationMode = 'idle' | 'walk' | 'attack' | 'paused';
type ViewPreset = 'front' | 'back' | 'left' | 'right';

type OrbitState = {
  azimuth: number;
  elevation: number;
  distance: number;
  target: THREE.Vector3;
};

const HEROES = listDevViewableHeroes();
const DEFAULT_HERO = HEROES.find(hero => hero.id === 'H002')?.id ?? HEROES[0]?.id ?? 'H001';

function queryHeroId(): HeroId {
  const params = new URLSearchParams(window.location.search);
  const requested = (params.get('hero') || params.get('hero-viewer') || '').toUpperCase() as HeroId;
  return HEROES.some(hero => hero.id === requested) ? requested : DEFAULT_HERO;
}

function disposeObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points)) return;
    if (object instanceof THREE.SkinnedMesh && !skeletons.has(object.skeleton)) {
      skeletons.add(object.skeleton);
      object.skeleton.dispose();
    }
    const geometry = (object as THREE.Mesh).geometry;
    if (geometry && !geometries.has(geometry)) {
      geometries.add(geometry);
      geometry.dispose();
    }
    const value = (object as THREE.Mesh).material;
    const list = Array.isArray(value) ? value : [value];
    for (const material of list) {
      if (!material || materials.has(material)) continue;
      materials.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture && !textures.has(value)) { textures.add(value); value.dispose(); }
      }
      material.dispose();
    }
  });
}

function setWireframe(root: THREE.Object3D, enabled: boolean) {
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if ('wireframe' in material) {
        (material as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial).wireframe = enabled;
        material.needsUpdate = true;
      }
    }
  });
}

function cameraPosition(orbit: OrbitState) {
  const cosElevation = Math.cos(orbit.elevation);
  return new THREE.Vector3(
    orbit.target.x + Math.sin(orbit.azimuth) * cosElevation * orbit.distance,
    orbit.target.y + Math.sin(orbit.elevation) * orbit.distance,
    orbit.target.z + Math.cos(orbit.azimuth) * cosElevation * orbit.distance,
  );
}

export default function HeroModelViewer() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    model: DevHeroModel;
    bounds: THREE.Box3Helper;
    axes: THREE.AxesHelper;
    orbit: OrbitState;
    pointer: { active: boolean; x: number; y: number };
    elapsed: number;
    attackClock: number;
    frame: number;
    resize: ResizeObserver;
  } | null>(null);

  const [heroId, setHeroId] = useState<HeroId>(() => queryHeroId());
  const [animation, setAnimation] = useState<AnimationMode>('idle');
  const animationRef = useRef<AnimationMode>('idle');
  const [attackPreview, setAttackPreview] = useState<number | null>(null);
  const attackPreviewRef = useRef<number | null>(null);
  const [wireframe, setWireframeState] = useState(false);
  const [showBounds, setShowBounds] = useState(false);
  const [showAxes, setShowAxes] = useState(false);
  const definition = useMemo(() => getHeroDefinition(heroId), [heroId]);

  useEffect(() => {
    animationRef.current = animation;
    if (animation !== 'attack' && animation !== 'paused') {
      runtimeRef.current?.model.resetAttack();
      if (runtimeRef.current) runtimeRef.current.attackClock = 0;
    }
  }, [animation]);

  useEffect(() => {
    let disposed = false;
    let teardown: (() => void) | null = null;

    const initialize = async () => {
      const host = hostRef.current;
      if (!host) return;

      const model = await buildDevHeroModel(heroId);
      if (disposed) {
        disposeObject(model.rig.root);
        return;
      }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x071019);
    scene.fog = new THREE.Fog(0x071019, 12, 28);

    const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 80);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = 'hero-model-viewer-canvas';
    host.appendChild(renderer.domElement);

      const hemi = new THREE.HemisphereLight(0xcbdcf0, 0x51444a, 2.0);
    scene.add(hemi);

      const key = new THREE.DirectionalLight(0xfff4e8, 3.0);
    key.position.set(4.5, 7, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    scene.add(key);

    const rim = new THREE.DirectionalLight(0x66ccff, 2.2);
    rim.position.set(-5, 4.5, -4);
    scene.add(rim);

    const warm = new THREE.DirectionalLight(0xffd59c, 1.25);
    warm.position.set(3, 2.2, -5);
    scene.add(warm);

    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x111a22,
      roughness: 0.9,
      metalness: 0.05,
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(5.5, 96), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const grid = new THREE.GridHelper(10, 40, 0x31516b, 0x182a38);
    grid.position.y = 0.004;
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const material of gridMaterials) {
      material.transparent = true;
      material.opacity = 0.32;
    }
    scene.add(grid);

    model.rig.root.position.set(0, 0.03, 0);
    model.rig.root.scale.setScalar(1.45);
    scene.add(model.rig.root);

    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model.rig.root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const target = new THREE.Vector3(center.x, Math.max(0.8, center.y), center.z);
    const distance = Math.max(4.8, size.y * 2.0);

    const orbit: OrbitState = {
      azimuth: 0,
      elevation: THREE.MathUtils.degToRad(4),
      distance,
      target,
    };
    camera.position.copy(cameraPosition(orbit));
    camera.lookAt(orbit.target);

    const bounds = new THREE.Box3Helper(box, 0x61d6ff);
    bounds.visible = showBounds;
    scene.add(bounds);

    const axes = new THREE.AxesHelper(1.5);
    axes.visible = showAxes;
    scene.add(axes);

    const pointer = { active: false, x: 0, y: 0 };
    const onPointerDown = (event: PointerEvent) => {
      pointer.active = true;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!pointer.active) return;
      const dx = event.clientX - pointer.x;
      const dy = event.clientY - pointer.y;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      orbit.azimuth -= dx * 0.008;
      orbit.elevation = THREE.MathUtils.clamp(
        orbit.elevation + dy * 0.006,
        THREE.MathUtils.degToRad(-25),
        THREE.MathUtils.degToRad(55),
      );
    };
    const onPointerUp = (event: PointerEvent) => {
      pointer.active = false;
      try { renderer.domElement.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    };
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      orbit.distance = THREE.MathUtils.clamp(orbit.distance * Math.exp(event.deltaY * 0.001), 2.2, 16);
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

    const resize = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
    });
    resize.observe(host);

    let previous = performance.now();
    const runtime = {
      renderer, scene, camera, model, bounds, axes, orbit, pointer,
      elapsed: 0, attackClock: 0, frame: 0, resize,
    };
    runtimeRef.current = runtime;

    const animateFrame = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - previous) / 1000));
      previous = now;
      runtime.elapsed += dt;

      const mode = animationRef.current;
        if (attackPreviewRef.current !== null) {
          model.setAttackProgress(attackPreviewRef.current);
          model.animate(attackPreviewRef.current, false, 0);
        } else if (mode !== 'paused') {
        const moving = mode === 'walk';
        if (mode === 'attack') {
          runtime.attackClock = (runtime.attackClock + dt) % 1.15;
          const progress = THREE.MathUtils.clamp(runtime.attackClock / 0.72, 0, 1);
          model.setAttackProgress(progress < 1 ? progress : 0);
        } else {
          runtime.attackClock = 0;
          model.resetAttack();
        }
        model.animate(runtime.elapsed, moving, dt);
      }

      camera.position.copy(cameraPosition(orbit));
      camera.lookAt(orbit.target);
      renderer.render(scene, camera);
      runtime.frame = requestAnimationFrame(animateFrame);
    };
    runtime.frame = requestAnimationFrame(animateFrame);

    teardown = () => {
      cancelAnimationFrame(runtime.frame);
      resize.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      runtimeRef.current = null;
      model.resetAttack();
      bounds.geometry.dispose();
      (bounds.material as THREE.Material).dispose();
      axes.geometry.dispose();
      (axes.material as THREE.Material).dispose();
      floor.geometry.dispose();
      floorMaterial.dispose();
      disposeObject(model.rig.root);
      renderer.dispose();
      try { renderer.forceContextLoss(); } catch { /* context may already be lost */ }
      renderer.domElement.remove();
    };
    };

    void initialize().catch(error => {
      console.error('[HeroModelViewer] Failed to load hero model', error);
    });

    return () => {
      disposed = true;
      teardown?.();
    };
  }, [heroId]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    setWireframe(runtime.model.rig.root, wireframe);
  }, [wireframe, heroId]);

  useEffect(() => {
    if (runtimeRef.current) runtimeRef.current.bounds.visible = showBounds;
  }, [showBounds, heroId]);

  useEffect(() => {
    if (runtimeRef.current) runtimeRef.current.axes.visible = showAxes;
  }, [showAxes, heroId]);

  const setView = (preset: ViewPreset) => {
    const orbit = runtimeRef.current?.orbit;
    if (!orbit) return;
    orbit.elevation = THREE.MathUtils.degToRad(4);
    orbit.azimuth = preset === 'front' ? 0
      : preset === 'back' ? Math.PI
        : preset === 'left' ? Math.PI / 2
          : -Math.PI / 2;
  };

  const resetCamera = () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.orbit.azimuth = 0;
    runtime.orbit.elevation = THREE.MathUtils.degToRad(4);
    const box = new THREE.Box3().setFromObject(runtime.model.rig.root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    runtime.orbit.target.set(center.x, Math.max(0.8, center.y), center.z);
    runtime.orbit.distance = Math.max(4.8, size.y * 2.0);
  };

  const focusFace = () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    runtime.model.rig.head.getWorldPosition(runtime.orbit.target);
    runtime.orbit.azimuth = 0;
    runtime.orbit.elevation = 0;
    runtime.orbit.distance = 1.65;
  };

  const chooseHero = (nextId: HeroId) => {
    const url = new URL(window.location.href);
    url.searchParams.set('hero', nextId);
    history.replaceState(null, '', url);
    setHeroId(nextId);
  };

  return <main className="hero-model-viewer" data-dawnreach-platform-ready="true">
    <aside className="hero-model-viewer-panel">
      <div className="hero-model-viewer-brand">
        <span>DAWNREACH DEV</span>
        <strong>HERO MODEL LAB</strong>
        <small>Runtime model inspection</small>
      </div>

      <section>
        <h2>HERO</h2>
        <div className="hero-model-viewer-roster">
          {HEROES.map(hero => <button
            key={hero.id}
            type="button"
            className={heroId === hero.id ? 'is-active' : ''}
            onClick={() => chooseHero(hero.id)}
          >
            <img src={getHeroPortrait(hero.id)} alt="" />
            <span><strong>{hero.displayName}</strong><small>{hero.id} · {hero.className}</small></span>
          </button>)}
        </div>
      </section>

      <section>
        <h2>VIEW</h2>
        <div className="hero-model-viewer-grid">
          <button type="button" onClick={() => setView('front')}>FRONT</button>
          <button type="button" onClick={() => setView('back')}>BACK</button>
          <button type="button" onClick={() => setView('left')}>LEFT</button>
          <button type="button" onClick={() => setView('right')}>RIGHT</button>
        </div>
        <button className="hero-model-viewer-wide" type="button" onClick={focusFace}>FACE DETAIL</button>
        <button className="hero-model-viewer-wide" type="button" onClick={resetCamera}>RESET CAMERA</button>
      </section>

      <section>
        <h2>ANIMATION</h2>
        <div className="hero-model-viewer-grid">
          {(['idle', 'walk', 'attack', 'paused'] as const).map(mode => <button
            type="button"
            key={mode}
            className={animation === mode ? 'is-active' : ''}
            onClick={() => {
              attackPreviewRef.current = null;
              setAttackPreview(null);
              setAnimation(mode);
            }}
            >{mode.toUpperCase()}</button>)}
          </div>
          <label style={{ display: 'block', marginTop: 12 }}>
            ATTACK POSE{attackPreview !== null ? ` · ${Math.round(attackPreview * 100)}%` : ''}
            <input type="range" aria-label="Attack pose" min="0" max="100" step="1"
              value={Math.round((attackPreview ?? .6) * 100)} style={{ width: '100%' }}
              onChange={event => {
                const progress = Number(event.target.value) / 100;
                attackPreviewRef.current = progress;
                setAttackPreview(progress);
                setAnimation('paused');
              }} />
          </label>
      </section>

      <section>
        <h2>DEBUG</h2>
        <label><input type="checkbox" checked={wireframe} onChange={event => setWireframeState(event.target.checked)} /> WIREFRAME</label>
        <label><input type="checkbox" checked={showBounds} onChange={event => setShowBounds(event.target.checked)} /> BOUNDING BOX</label>
        <label><input type="checkbox" checked={showAxes} onChange={event => setShowAxes(event.target.checked)} /> WORLD AXES</label>
      </section>

      <section className="hero-model-viewer-data">
        <h2>MODEL DATA</h2>
        <dl>
          <div><dt>NAME</dt><dd>{definition.displayName}</dd></div>
          <div><dt>CLASS</dt><dd>{definition.className}</dd></div>
          <div><dt>ROLE</dt><dd>{definition.primaryRole}</dd></div>
          <div><dt>ATTRIBUTE</dt><dd>{definition.primaryAttribute}</dd></div>
          <div><dt>RANGE</dt><dd>{definition.baseStats.attackRange}</dd></div>
          <div><dt>LANES</dt><dd>{definition.deploymentPreferences?.primary.join(' / ') || '—'}</dd></div>
        </dl>
      </section>
    </aside>

    <section className="hero-model-viewer-stage">
      <div ref={hostRef} className="hero-model-viewer-canvas-host" />
      <div className="hero-model-viewer-stage-title">
        <span>{definition.id}</span>
        <strong>{definition.displayName}</strong>
        <small>{definition.className} · {definition.primaryRole}</small>
      </div>
      <div className="hero-model-viewer-help">
        <span>DRAG · ROTATE</span>
        <span>WHEEL · ZOOM</span>
        <span>MODEL IS THE SAME RUNTIME BUILDER USED BY DAWNREACH</span>
      </div>
    </section>
  </main>;
}
