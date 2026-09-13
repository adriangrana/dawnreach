import * as THREE from 'three';
import type { DawnreachTextures } from '../shared/textures';
import { DAWNREACH_LAYOUT, type MapPoint } from './mapLayout';

export function buildDawnreachMap(textures: DawnreachTextures) {
  const world = new THREE.Group();
  world.name = 'dawnreach-map';

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(DAWNREACH_LAYOUT.width, DAWNREACH_LAYOUT.height),
    new THREE.MeshStandardMaterial({ map: textures.grass, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  world.add(ground);

  const riverMaterial = new THREE.MeshStandardMaterial({
    color: 0x23566f,
    roughness: 0.22,
    metalness: 0.04,
    transparent: true,
    opacity: 0.94,
  });
  const river = new THREE.Mesh(
    createRibbonGeometry(DAWNREACH_LAYOUT.river, 6.5, 0.012, 5),
    riverMaterial,
  );
  river.receiveShadow = true;
  world.add(river);

  const laneMaterial = new THREE.MeshStandardMaterial({ map: textures.lane, roughness: 0.97 });
  for (const points of Object.values(DAWNREACH_LAYOUT.lanes)) {
    const lane = new THREE.Mesh(createRibbonGeometry(points, 4.3, 0.032, 4), laneMaterial);
    lane.receiveShadow = true;
    world.add(lane);
  }

  world.add(buildBase('blue', DAWNREACH_LAYOUT.blueBase.x, DAWNREACH_LAYOUT.blueBase.z));
  world.add(buildBase('red', DAWNREACH_LAYOUT.redBase.x, DAWNREACH_LAYOUT.redBase.z));

  for (const [x, z, scale] of DAWNREACH_LAYOUT.jungleClusters) {
    world.add(buildForestCluster(x, z, scale));
  }

  for (const pit of DAWNREACH_LAYOUT.objectivePits) {
    world.add(buildObjectivePit(pit.x, pit.z, pit.kind));
  }

  addMapEdgeCliffs(world);
  return world;
}

function createRibbonGeometry(
  points: readonly MapPoint[],
  width: number,
  y: number,
  uvScale: number,
) {
  const curve = new THREE.CatmullRomCurve3(
    points.map(([x, z]) => new THREE.Vector3(x, y, z)),
    false,
    'catmullrom',
    0.35,
  );

  const samples = Math.max(48, points.length * 14);
  const vertices: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let distance = 0;
  let previous = curve.getPoint(0);

  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const point = curve.getPoint(t);
    const tangent = curve.getTangent(t).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();

    if (i > 0) distance += point.distanceTo(previous);
    previous = point;

    const left = point.clone().addScaledVector(normal, width / 2);
    const right = point.clone().addScaledVector(normal, -width / 2);
    vertices.push(left.x, left.y, left.z, right.x, right.y, right.z);
    uvs.push(0, distance / uvScale, 1, distance / uvScale);

    if (i < samples) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, c, b, c, d, b);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function buildBase(team: 'blue' | 'red', x: number, z: number) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.name = `${team}-base`;

  const stone = new THREE.MeshStandardMaterial({ color: 0x73776f, roughness: 0.88 });
  const faction = team === 'blue' ? 0x42a5ff : 0xff4b45;
  const glow = team === 'blue' ? 0x1e77ff : 0xff241d;

  const platform = new THREE.Mesh(new THREE.CylinderGeometry(7.2, 7.7, 0.45, 48), stone);
  platform.position.y = 0.22;
  platform.receiveShadow = true;
  platform.castShadow = true;
  group.add(platform);

  const inner = new THREE.Mesh(
    new THREE.CylinderGeometry(4.8, 5.2, 0.28, 48),
    new THREE.MeshStandardMaterial({ color: team === 'blue' ? 0x52687a : 0x725454, roughness: 0.8 }),
  );
  inner.position.y = 0.52;
  inner.receiveShadow = true;
  group.add(inner);

  const crystal = new THREE.Mesh(
    new THREE.OctahedronGeometry(1.45, 0),
    new THREE.MeshStandardMaterial({
      color: faction,
      emissive: glow,
      emissiveIntensity: 1.8,
      metalness: 0.18,
      roughness: 0.2,
    }),
  );
  crystal.scale.y = 1.65;
  crystal.position.y = 2.25;
  crystal.castShadow = true;
  group.add(crystal);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.3, 0.15, 10, 44),
    new THREE.MeshStandardMaterial({ color: faction, emissive: glow, emissiveIntensity: 0.8, metalness: 0.5, roughness: 0.32 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.77;
  group.add(ring);

  const light = new THREE.PointLight(faction, 18, 10, 2);
  light.position.y = 3.2;
  group.add(light);
  return group;
}

function buildForestCluster(x: number, z: number, scale: number) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.scale.setScalar(scale);

  const positions: Array<[number, number, number]> = [
    [-1.8, -1.1, 0.95], [-0.7, -1.7, 1.1], [0.8, -1.4, 0.85], [1.7, -0.5, 1.0],
    [-1.7, 0.5, 0.85], [-0.5, 0.4, 1.2], [0.8, 0.3, 1.0], [1.6, 1.2, 0.9],
    [-0.9, 1.5, 0.9], [0.3, 1.7, 1.05],
  ];

  for (const [tx, tz, ts] of positions) group.add(buildTree(tx, tz, ts));

  const rock = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.75, 0),
    new THREE.MeshStandardMaterial({ color: 0x59615b, roughness: 0.95 }),
  );
  rock.scale.set(1.5, 0.85, 1.1);
  rock.position.set(0.2, 0.55, -0.1);
  rock.rotation.set(0.1, 0.6, -0.08);
  rock.castShadow = true;
  rock.receiveShadow = true;
  group.add(rock);

  return group;
}

function buildTree(x: number, z: number, scale: number) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.scale.setScalar(scale);

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.23, 1.2, 7),
    new THREE.MeshStandardMaterial({ color: 0x4b3523, roughness: 1 }),
  );
  trunk.position.y = 0.6;
  trunk.castShadow = true;
  group.add(trunk);

  const dark = new THREE.MeshStandardMaterial({ color: 0x23452f, roughness: 1 });
  const light = new THREE.MeshStandardMaterial({ color: 0x315b3d, roughness: 1 });
  const crown1 = new THREE.Mesh(new THREE.ConeGeometry(0.72, 1.55, 8), dark);
  const crown2 = new THREE.Mesh(new THREE.ConeGeometry(0.58, 1.35, 8), light);
  crown1.position.y = 1.62;
  crown2.position.y = 2.18;
  crown1.castShadow = true;
  crown2.castShadow = true;
  group.add(crown1, crown2);
  return group;
}

function buildObjectivePit(x: number, z: number, kind: 'upper' | 'lower') {
  const group = new THREE.Group();
  group.position.set(x, 0.02, z);
  group.name = `${kind}-objective-pit`;

  const darkWater = kind === 'upper' ? 0x214d5d : 0x302450;
  const pit = new THREE.Mesh(
    new THREE.CircleGeometry(4.2, 48),
    new THREE.MeshStandardMaterial({ color: darkWater, roughness: 0.3, metalness: 0.04 }),
  );
  pit.rotation.x = -Math.PI / 2;
  group.add(pit);

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(4.25, 0.42, 8, 48),
    new THREE.MeshStandardMaterial({ color: 0x59615d, roughness: 0.9 }),
  );
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.16;
  rim.castShadow = true;
  group.add(rim);
  return group;
}

function addMapEdgeCliffs(world: THREE.Group) {
  const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x3d4742, roughness: 1 });
  const { width, height } = DAWNREACH_LAYOUT;
  const step = 3.1;

  const addRock = (x: number, z: number, seed: number) => {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1.25 + (seed % 3) * 0.14, 0), rockMaterial);
    rock.position.set(x, 0.65 + (seed % 4) * 0.08, z);
    rock.scale.set(1.3, 0.8 + (seed % 3) * 0.12, 1.05);
    rock.rotation.y = seed * 0.71;
    rock.castShadow = true;
    rock.receiveShadow = true;
    world.add(rock);
  };

  let seed = 0;
  for (let x = -width / 2; x <= width / 2; x += step) {
    addRock(x, -height / 2 - 0.6, seed++);
    addRock(x, height / 2 + 0.6, seed++);
  }
  for (let z = -height / 2 + step; z <= height / 2 - step; z += step) {
    addRock(-width / 2 - 0.6, z, seed++);
    addRock(width / 2 + 0.6, z, seed++);
  }
}
