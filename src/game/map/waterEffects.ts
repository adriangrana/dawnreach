import * as THREE from 'three';
import { installFountainSanctuaryPresentation } from './fountainSanctuaryPresentation';

export function createWaterEffects(world: THREE.Group) {
  // Presentation-only rebuild. It deliberately runs here before water-surface discovery, while
  // the pre-existing command-surface mesh references can still be repurposed for the new stair.
  installFountainSanctuaryPresentation(world);

  // The sanctuary presentation has a large dark circular court around the fountain. Its outer
  // edge protrudes beneath the staircase and reads like an unwanted ring from the gameplay view.
  // Hide only that decorative court; fountain basins, water circles and gameplay surfaces stay intact.
  world.traverse(object => {
    if (!(object instanceof THREE.Mesh) || !(object.geometry instanceof THREE.CircleGeometry)) return;
    if (!object.parent?.name.endsWith('-fountain-sanctuary-presentation')) return;
    if (Math.abs(object.geometry.parameters.radius - 4.05) > 0.001) return;
    object.visible = false;
  });

  const group = new THREE.Group();
  group.name = 'water-footsteps';
  const surfaces: THREE.Mesh[] = [];
  world.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    if (object.userData.waterSurface || object.userData.waterEffectsSurface) surfaces.push(object);
  });
  const bridges = world.children.filter(object => object.name.endsWith('-river-bridge'));
  const ray = new THREE.Raycaster();
  ray.ray.direction.set(0, -1, 0);
  const local = new THREE.Vector3();
  const bridgePosition = new THREE.Vector3();
  const ringGeometry = new THREE.RingGeometry(0.94, 1, 40);
  const dropGeometry = new THREE.OctahedronGeometry(1, 0);
  const bursts = Array.from({ length: 10 }, () => {
    const root = new THREE.Group();
    root.visible = false;
    const material = new THREE.MeshBasicMaterial({ color: 0xd2f0e5, transparent: true, opacity: 0, depthWrite: false });
    const ring = new THREE.Mesh(ringGeometry, material);
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 4;
    root.add(ring);
    const drops = Array.from({ length: 7 }, (_, index) => {
      const mesh = new THREE.Mesh(dropGeometry, material);
      mesh.renderOrder = 4;
      root.add(mesh);
      return { mesh, angle: index / 7 * Math.PI * 2, lift: 0.8 + index % 3 * 0.17 };
    });
    group.add(root);
    return { root, material, ring, drops, started: -Infinity };
  });
  const tracks = new WeakMap<THREE.Object3D, { previous: THREE.Vector3; distance: number; side: number; wet: boolean }>();
  let nextBurst = 0;

  const waterHeight = (position: THREE.Vector3) => {
    for (const bridge of bridges) {
      bridgePosition.copy(position);
      bridge.worldToLocal(bridgePosition);
      if (Math.abs(bridgePosition.x) < 5.2 && Math.abs(bridgePosition.z) < 2.2) return null;
    }
    // Elevated healing pools sit above y=2. The ray starts above the actor so both the river
    // and raised pools can be hit without making the pool participate in river deformation.
    ray.ray.origin.set(position.x, position.y + 2.5, position.z);
    const hit = ray.intersectObjects(surfaces, false)[0];
    if (!hit || (hit.object.name === 'river-surface' && hit.uv && (hit.uv.x < 0.06 || hit.uv.x > 0.94))) return null;
    return hit.point.y;
  };

  return {
    group,
    update(elapsed: number, actors: readonly THREE.Object3D[]) {
      for (const actor of actors) {
        const position = actor.position;
        let track = tracks.get(actor);
        if (!track) {
          track = { previous: position.clone(), distance: 0, side: 1, wet: false };
          tracks.set(actor, track);
        }
        const deltaX = position.x - track.previous.x;
        const deltaZ = position.z - track.previous.z;
        const distance = Math.hypot(deltaX, deltaZ);
        track.previous.copy(position);
        if (distance > 1) {
          track.distance = 0;
          track.wet = false;
          continue;
        }
        if (distance < 0.0001) continue;
        const height = waterHeight(position);
        if (height === null) {
          track.distance = 0;
          track.wet = false;
          continue;
        }
        track.distance += distance;
        if (!track.wet || track.distance >= 0.48) {
          const burst = bursts[nextBurst];
          nextBurst = (nextBurst + 1) % bursts.length;
          local.set(position.x - deltaZ / distance * 0.14 * track.side, height, position.z + deltaX / distance * 0.14 * track.side);
          const footHeight = waterHeight(local);
          if (footHeight !== null) {
            burst.root.position.set(local.x, footHeight + 0.024, local.z);
            burst.started = elapsed;
            burst.root.visible = true;
          }
          track.distance = 0;
          track.side *= -1;
        }
        track.wet = true;
      }
      for (const burst of bursts) {
        const age = elapsed - burst.started;
        burst.root.visible = age >= 0 && age < 0.85;
        if (!burst.root.visible) continue;
        const life = age / 0.85;
        burst.material.opacity = 0.65 * (1 - life) ** 2;
        burst.ring.scale.setScalar(0.12 + life * 0.7);
        for (const drop of burst.drops) {
          const height = drop.lift * age - 2.3 * age * age;
          drop.mesh.visible = height > 0;
          drop.mesh.position.set(Math.cos(drop.angle) * age * 0.58, Math.max(0, height), Math.sin(drop.angle) * age * 0.58);
          drop.mesh.scale.set(0.025 * (1 - life), 0.04 * (1 - life), 0.025 * (1 - life));
        }
      }
    },
  };
}
