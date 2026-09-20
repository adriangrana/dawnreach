import { animateHumanoid, HUMANOID_DEFAULT_MOVE_SPEED } from '../characters/animateHumanoid';
import type { HumanoidRig } from '../characters/humanoidRig';
import { animateAlden } from './alden/animateAlden';
import { buildAlden, type AldenRig } from './alden/buildAlden';
import { createAldenMaterials } from './alden/materials';
import { listHeroDefinitions } from './catalog';
import { animateSeryn } from './seryn/animateSeryn';
import { buildSeryn, type SerynRig } from './seryn/buildSeryn';
import type { HeroId } from './types';

export type DevHeroRig = HumanoidRig | AldenRig | SerynRig;

export type DevHeroModel = Readonly<{
  id: HeroId;
  rig: DevHeroRig;
  animate(elapsed: number, moving: boolean, delta: number): void;
  setAttackProgress(progress: number): void;
  resetAttack(): void;
}>;

type Builder = () => DevHeroModel;

const BUILDERS: Partial<Record<HeroId, Builder>> = {
  H001: () => {
    const rig = buildAlden(createAldenMaterials());
    const swordRest = rig.sword.rotation.clone();
    let attackWasActive = false;
    return {
      id: 'H001',
      rig,
      animate: (elapsed, moving, delta) => {
        animateAlden(rig, elapsed, moving, delta, HUMANOID_DEFAULT_MOVE_SPEED);
      },
      setAttackProgress: progress => {
        const active = progress > 0 && progress < 1;
        if (active) {
          const slash = Math.sin(progress * Math.PI);
          rig.sword.rotation.set(
            swordRest.x - slash * 0.95,
            swordRest.y + slash * 0.12,
            swordRest.z + slash * 0.34,
          );
        } else if (attackWasActive) {
          rig.sword.rotation.copy(swordRest);
        }
        attackWasActive = active;
      },
      resetAttack: () => {
        attackWasActive = false;
        rig.sword.rotation.copy(swordRest);
      },
    };
  },
  H002: () => {
    const rig = buildSeryn();
    return {
      id: 'H002',
      rig,
      animate: (elapsed, moving, delta) => {
        animateSeryn(rig, elapsed, moving, delta, HUMANOID_DEFAULT_MOVE_SPEED);
      },
      setAttackProgress: progress => {
        rig.root.userData.serynAttackProgress = progress;
      },
      resetAttack: () => {
        rig.root.userData.serynAttackProgress = 0;
      },
    };
  },
};

export function listDevViewableHeroes() {
  return listHeroDefinitions().filter(hero => Boolean(BUILDERS[hero.id]));
}

export function buildDevHeroModel(heroId: HeroId): DevHeroModel {
  const build = BUILDERS[heroId];
  if (!build) throw new Error(`No development model builder is registered for ${heroId}.`);
  return build();
}
