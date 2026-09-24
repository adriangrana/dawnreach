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

const ALDEN_IDLE_LOOP_SECONDS = 2.25;

type ImportedBoneRest = Readonly<{
  object: THREE.Object3D;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}>;

function captureImportedBone(root: THREE.Object3D, name: string): ImportedBoneRest | null {
  const object = root.getObjectByName(name);
  if (!object) return null;
  return {
    object,
    position: object.position.clone(),
    quaternion: object.quaternion.clone(),
  };
}

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

  const bones = {
    pelvis: captureImportedBone(root, 'DEF-spine'),
    spine1: captureImportedBone(root, 'DEF-spine.001'),
    spine2: captureImportedBone(root, 'DEF-spine.002'),
    chest: captureImportedBone(root, 'DEF-spine.003'),
    upperChest: captureImportedBone(root, 'DEF-spine.004'),
    neck: captureImportedBone(root, 'DEF-spine.005'),
    head: captureImportedBone(root, 'DEF-spine.006'),
    shoulderL: captureImportedBone(root, 'DEF-shoulder.L'),
    shoulderR: captureImportedBone(root, 'DEF-shoulder.R'),
    upperArmL: captureImportedBone(root, 'DEF-upper_arm.L'),
    upperArmR: captureImportedBone(root, 'DEF-upper_arm.R'),
    forearmL: captureImportedBone(root, 'DEF-forearm.L'),
    forearmR: captureImportedBone(root, 'DEF-forearm.R'),
    handL: captureImportedBone(root, 'DEF-hand.L'),
    handR: captureImportedBone(root, 'DEF-hand.R'),
  };

  const importedBones = Object.values(bones).filter((bone): bone is ImportedBoneRest => Boolean(bone));
  const deltaEuler = new THREE.Euler(0, 0, 0, 'XYZ');
  const deltaQuaternion = new THREE.Quaternion();
  let attackProgress = 0;

  const restoreRestPose = () => {
    for (const bone of importedBones) {
      bone.object.position.copy(bone.position);
      bone.object.quaternion.copy(bone.quaternion);
    }
  };

  const applyLocalRotation = (
    bone: ImportedBoneRest | null,
    xDegrees: number,
    yDegrees: number,
    zDegrees: number,
  ) => {
    if (!bone) return;
    bone.object.position.copy(bone.position);
    deltaEuler.set(
      THREE.MathUtils.degToRad(xDegrees),
      THREE.MathUtils.degToRad(yDegrees),
      THREE.MathUtils.degToRad(zDegrees),
      'XYZ',
    );
    deltaQuaternion.setFromEuler(deltaEuler);
    bone.object.quaternion.copy(bone.quaternion).multiply(deltaQuaternion);
  };

  const applyIdle = (elapsed: number) => {
    const phase = ((elapsed % ALDEN_IDLE_LOOP_SECONDS) / ALDEN_IDLE_LOOP_SECONDS) * Math.PI * 2;
    const breath = (1 - Math.cos(phase)) * 0.5;
    const sway = Math.sin(phase);
    const secondary = Math.sin(phase * 2 + 0.65);

    // Heavy-armour idle: planted boots, restrained weight transfer and a visible
    // chest expansion. All transforms are rebuilt from the imported rest pose on
    // every frame so the skin never accumulates drift.
    applyLocalRotation(bones.pelvis, 0.15 * breath, -0.35 * sway, 0.35 * sway);
    applyLocalRotation(bones.spine1, 0.25 * breath, -0.2 * sway, 0.2 * sway);
    applyLocalRotation(bones.spine2, 0.65 * breath, 0.15 * sway, -0.18 * sway);
    applyLocalRotation(bones.chest, 1.35 * breath, 0.35 * sway, -0.3 * sway);
    applyLocalRotation(bones.upperChest, 1.0 * breath, 0.25 * sway, -0.22 * sway);

    // Keep the helmet visually steady while the thorax breathes.
    applyLocalRotation(
      bones.neck,
      -0.35 * breath + secondary * 0.08,
      -0.18 * sway,
      0.12 * sway,
    );
    applyLocalRotation(
      bones.head,
      -0.55 * breath + secondary * 0.12,
      -0.32 * sway + secondary * 0.06,
      0.16 * sway,
    );

    // The armour should feel heavy rather than rubbery: shoulders and arms only
    // react by fractions of a degree to the breathing cycle.
    applyLocalRotation(bones.shoulderL, 0.18 * breath, 0.08 * sway, 0.18 * sway);
    applyLocalRotation(bones.shoulderR, 0.18 * breath, -0.08 * sway, -0.18 * sway);
    applyLocalRotation(bones.upperArmL, -0.22 * breath, 0.08 * sway, 0.14 * sway);
    applyLocalRotation(bones.upperArmR, -0.22 * breath, -0.08 * sway, -0.14 * sway);
    applyLocalRotation(bones.forearmL, -0.1 * breath, 0, 0.08 * secondary);
    applyLocalRotation(bones.forearmR, -0.1 * breath, 0, -0.08 * secondary);
    applyLocalRotation(bones.handL, 0, 0.08 * secondary, 0.06 * sway);
    applyLocalRotation(bones.handR, 0, -0.08 * secondary, -0.06 * sway);
  };

  restoreRestPose();

  return {
    id: 'H001',
    rig: { root, head },
    animate: (elapsed, moving) => {
      if (moving || attackProgress > 0) {
        restoreRestPose();
        return;
      }
      applyIdle(elapsed);
    },
    setAttackProgress: progress => {
      attackProgress = THREE.MathUtils.clamp(progress, 0, 1);
      if (attackProgress > 0) restoreRestPose();
    },
    resetAttack: () => {
      attackProgress = 0;
      restoreRestPose();
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
