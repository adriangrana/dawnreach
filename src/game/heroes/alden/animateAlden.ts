import * as THREE from 'three';
import type { AldenRig } from './buildAlden.js';
import { animateHumanoid, HUMANOID_DEFAULT_MOVE_SPEED } from '../../characters/animateHumanoid.js';

export {
  HUMANOID_WALK_SPEED as ALDEN_WALK_SPEED,
  HUMANOID_FAST_WALK_SPEED as ALDEN_FAST_WALK_SPEED,
  HUMANOID_DEFAULT_MOVE_SPEED as ALDEN_DEFAULT_MOVE_SPEED,
  HUMANOID_GAIT_RATE as ALDEN_GAIT_RATE,
} from '../../characters/animateHumanoid.js';

// The gameplay shell currently presents Alden at 0.68. The battlefield scale needs
// him at half of that visual size, while keeping the same world traversal speed.
// Doubling the gait speed preserves approximately the same foot-to-ground cadence
// after halving the visible model scale.
const ALDEN_BATTLEFIELD_SCALE = 0.34;
const ALDEN_GAIT_SCALE_COMPENSATION = 2;

export function animateAlden(rig: AldenRig, elapsed: number, moving: boolean, delta = 1 / 60, speed = HUMANOID_DEFAULT_MOVE_SPEED) {
  rig.model.scale.setScalar(ALDEN_BATTLEFIELD_SCALE);
  animateHumanoid(rig, elapsed, moving, delta, speed * ALDEN_GAIT_SCALE_COMPENSATION);
  const dt = Math.max(0, Math.min(delta, 0.1));
  const target = moving ? 1 : 0;
  const weight = THREE.MathUtils.smoothstep(rig.gait.weight, 0, 1);
  const phase = rig.gait.phase;

  rig.capeMotion += (target - rig.capeMotion) * (1 - Math.exp(-dt * 6));
  rig.cape.rotation.x = 0.025 + rig.capeMotion * 0.04;
  rig.cape.rotation.z = Math.sin(phase - 0.6) * 0.018 * weight + Math.sin(elapsed * 1.2) * 0.003 * (1 - weight);

  for (const { geometry, rest } of rig.capePanels) {
    const position = geometry.getAttribute('position');
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      const horizontal = rest[vertex * 3];
      const vertical = rest[vertex * 3 + 1];
      const depth = rest[vertex * 3 + 2];
      const weight = Math.min(1, Math.max(0, -vertical / 1.86)) ** 2;
      const flutter = Math.sin(elapsed * 7.5 + vertical * 5 + horizontal * 2.1);
      const ripple = Math.sin(elapsed * 11.5 + vertical * 7.2 - horizontal * 4);
      const amplitude = 0.006 + rig.capeMotion * 0.14;
      const billow = (flutter * 0.72 + ripple * 0.28) * weight * amplitude;
      position.setXYZ(
        vertex,
        horizontal + Math.sin(elapsed * 5 + vertical * 3) * weight * amplitude * 0.35,
        vertical + weight * rig.capeMotion * 0.025 + billow * 0.12,
        depth - weight * rig.capeMotion * 0.025 + billow,
      );
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
  }
}
