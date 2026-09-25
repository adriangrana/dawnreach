import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { animateHumanoid, HUMANOID_DEFAULT_MOVE_SPEED } from '../characters/animateHumanoid';
import type { HumanoidRig } from '../characters/humanoidRig';
import { listHeroDefinitions } from './catalog';
import { animateSeryn, SERYN_ATTACK_RELEASE_PROGRESS } from './seryn/animateSeryn';
import { buildSeryn, type SerynRig } from './seryn/buildSeryn';
import type { HeroId } from './types';
import {
  ALDEN_RIGGED_IDLE_SECONDS,
  ALDEN_RIGGED_WALK_SECONDS,
  aldenWalkAtSpeed,
  createAldenRiggedIdle,
  createAldenRiggedWalk,
} from './alden/animateAldenRigged';
import { findImportedObject } from './animation/coherentBoneMotion';

export type ImportedHeroRig = Readonly<{
  root: THREE.Group;
  head: THREE.Object3D;
}>;

export type DevHeroRig = HumanoidRig | SerynRig | ImportedHeroRig;

export type DevHeroModel = Readonly<{
  id: HeroId;
  rig: DevHeroRig;
  idleLoopSeconds?: number;
  walkLoopSeconds?: number;
  walkPeriodAtSpeed?(movementSpeedMultiplier: number): number;
  animate(elapsed: number, moving: boolean, delta: number, movementSpeedMultiplier?: number): void;
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

  const head = findImportedObject(root, 'DEF-spine.006');
  const weaponSocket = findImportedObject(root, 'weapon_socket.R');
  root.userData.weaponSocket = weaponSocket ?? null;
  root.userData.runtimeAsset = ALDEN_RUNTIME_MODEL_URL;

  const idle = createAldenRiggedIdle(root);
  const walk = createAldenRiggedWalk(root);
  const blendBones: { bone: THREE.Bone; position: THREE.Vector3; quaternion: THREE.Quaternion }[] = [];
  root.traverse(object => {
    if (object instanceof THREE.Bone) blendBones.push({ bone: object, position: new THREE.Vector3(), quaternion: new THREE.Quaternion() });
  });
  let walkWeight = 0;
  let attackProgress = 0;
  idle.reset();

  return {
    id: 'H001',
    rig: { root, head },
    idleLoopSeconds: ALDEN_RIGGED_IDLE_SECONDS,
    walkLoopSeconds: ALDEN_RIGGED_WALK_SECONDS,
    walkPeriodAtSpeed: multiplier => aldenWalkAtSpeed(multiplier).period,
    animate: (elapsed, moving, delta, movementSpeedMultiplier = 1) => {
      if (attackProgress > 0) {
        idle.reset();
        walk.reset();
        walkWeight = 0;
        return;
      }
      moving = moving && movementSpeedMultiplier > 0;
      const targetWeight = moving ? 1 : 0;
      // A zero-delta call is a deterministic Model Lab pose inspection.
      walkWeight = delta <= 0 ? targetWeight : THREE.MathUtils.clamp(
        walkWeight + (moving ? 1 : -1) * delta / 0.2, 0, 1,
      );
      if (walkWeight === 1) {
        if (delta <= 0) walk.apply(elapsed, movementSpeedMultiplier);
        else walk.advance(delta, movementSpeedMultiplier);
      } else if (walkWeight === 0) {
        idle.apply(elapsed);
      } else {
        idle.apply(elapsed);
        for (const pose of blendBones) {
          pose.position.copy(pose.bone.position);
          pose.quaternion.copy(pose.bone.quaternion);
        }
        walk.advance(delta, moving ? movementSpeedMultiplier : 0);
        const blend = walkWeight * walkWeight * (3 - 2 * walkWeight);
        for (const pose of blendBones) {
          pose.bone.position.lerp(pose.position, 1 - blend);
          pose.bone.quaternion.slerp(pose.quaternion, 1 - blend);
        }
      }
    },
    setAttackProgress: progress => {
      attackProgress = THREE.MathUtils.clamp(progress, 0, 1);
      if (attackProgress > 0) {
        idle.reset();
        walk.reset();
      }
    },
    resetAttack: () => {
      attackProgress = 0;
      idle.reset();
      walk.reset();
    },
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
