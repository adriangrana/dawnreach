import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { animateHumanoid, HUMANOID_DEFAULT_MOVE_SPEED } from '../characters/animateHumanoid';
import type { HumanoidRig } from '../characters/humanoidRig';
import { listHeroDefinitions } from './catalog';
import { animateSeryn, SERYN_ATTACK_RELEASE_PROGRESS } from './seryn/animateSeryn';
import { buildSeryn, type SerynRig } from './seryn/buildSeryn';
import type { HeroId } from './types';

export type ImportedHeroRig = Readonly<{
  root: THREE.Group;
  head: THREE.Object3D;
}>;

export type DevHeroRig = HumanoidRig | SerynRig | ImportedHeroRig;

export type DevHeroModel = Readonly<{
  id: HeroId;
  rig: DevHeroRig;
  animate(elapsed: number, moving: boolean, delta: number): void;
  setAttackProgress(progress: number): void;
  resetAttack(): void;
}>;

type Builder = () => DevHeroModel | Promise<DevHeroModel>;

const ALDEN_RUNTIME_MODEL_URL = new URL('./alden/model/alden_rigged_socket.glb', import.meta.url).href;
const runtimeModelLoader = new GLTFLoader();

async function loadAldenRuntimeModel(): Promise<DevHeroModel> {
  const gltf = await runtimeModelLoader.loadAsync(ALDEN_RUNTIME_MODEL_URL);
  const root = gltf.scene;
  root.name = 'alden-runtime-model';

  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });

  const head = root.getObjectByName('DEF-spine.006') ?? root;
  const weaponSocket = root.getObjectByName('weapon_socket.R');
  root.userData.weaponSocket = weaponSocket ?? null;
  root.userData.runtimeAsset = ALDEN_RUNTIME_MODEL_URL;

  return {
    id: 'H001',
    rig: { root, head },
    animate: () => {},
    setAttackProgress: () => {},
    resetAttack: () => {},
  };
}

const BUILDERS: Partial<Record<HeroId, Builder>> = {
  H001: loadAldenRuntimeModel,
  H002: () => {
    const rig = buildSeryn();
    const previewArrow = rig.projectileArrowPrototype.clone(true);
    previewArrow.name = 'seryn-dev-attack-projectile';
    previewArrow.visible = false;
    rig.root.add(previewArrow);

    const arrowAxis = new THREE.Vector3(0, 1, 0);
    const forward = new THREE.Vector3(0, 0, 1);
    const launchWorld = new THREE.Vector3();
    const launchLocal = new THREE.Vector3();
    const flightOrigin = new THREE.Vector3();
    const flightDirection = new THREE.Vector3();
    let flightActive = false;
    let previousProgress = 0;

    return {
      id: 'H002',
      rig,
      animate: (elapsed, moving, delta) => {
        animateSeryn(rig, elapsed, moving, delta, HUMANOID_DEFAULT_MOVE_SPEED);

        const progress = Number(rig.root.userData.serynAttackProgress ?? 0);
        if (progress >= SERYN_ATTACK_RELEASE_PROGRESS && progress < 1) {
          if (!flightActive || progress < previousProgress) {
          rig.root.updateMatrixWorld(true);
          rig.arrowLaunchSocket.getWorldPosition(launchWorld);
          launchLocal.copy(launchWorld);
          rig.root.worldToLocal(launchLocal);
          // Fly from the release socket along the hero's actual facing rather than
          // assuming root-local +Z after every possible model rotation.
          rig.model.getWorldQuaternion(previewArrow.quaternion);
          const localForward = forward.clone().applyQuaternion(previewArrow.quaternion);
          rig.root.worldToLocal(localForward.add(rig.root.getWorldPosition(new THREE.Vector3())));
          const localOrigin = rig.root.worldToLocal(rig.root.getWorldPosition(new THREE.Vector3()));
          localForward.sub(localOrigin).normalize();
          flightOrigin.copy(launchLocal);
          flightDirection.copy(localForward);
          previewArrow.quaternion.setFromUnitVectors(arrowAxis, localForward);
          flightActive = true;
          }
          const flight = (progress - SERYN_ATTACK_RELEASE_PROGRESS) / (1 - SERYN_ATTACK_RELEASE_PROGRESS);
          previewArrow.visible = true;
          previewArrow.position.copy(flightOrigin).addScaledVector(flightDirection, flight * 4.2);
        } else {
          previewArrow.visible = false;
          flightActive = false;
        }
        previousProgress = progress;
      },
      setAttackProgress: progress => {
        rig.root.userData.serynAttackProgress = progress;
      },
      resetAttack: () => {
        rig.root.userData.serynAttackProgress = 0;
        previewArrow.visible = false;
        flightActive = false;
      },
    };
  },
};

export function listDevViewableHeroes() {
  return listHeroDefinitions().filter(hero => Boolean(BUILDERS[hero.id]));
}

export async function buildDevHeroModel(heroId: HeroId): Promise<DevHeroModel> {
  const build = BUILDERS[heroId];
  if (!build) throw new Error(`No development model builder is registered for ${heroId}.`);
  return await build();
}
