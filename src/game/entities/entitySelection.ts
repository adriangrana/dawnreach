import * as THREE from 'three';
import type { GameEntity, GameEntityRegistry, TeamId } from './gameEntities';
import { getGameEntity } from './gameEntities';

export type EntitySelectionController = Readonly<{
  getSelected(): GameEntity | null;
  pick(raycaster: THREE.Raycaster): GameEntity | null;
  select(entity: GameEntity | null): void;
  update(): void;
  dispose(): void;
}>;

function teamColor(team: TeamId) {
  switch (team) {
    case 'blue': return 0x63d8ff;
    case 'red': return 0xff725f;
    case 'neutral': return 0xffd86b;
  }
}

export function createEntitySelectionController(
  scene: THREE.Scene,
  registry: GameEntityRegistry,
  canSelect: (entity: GameEntity) => boolean = () => true,
): EntitySelectionController {
  const material = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.92,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
  const geometry = new THREE.RingGeometry(0.82, 1, 64);
  const marker = new THREE.Mesh(geometry, material);
  marker.name = 'selected-entity-marker';
  marker.rotation.x = -Math.PI / 2;
  marker.renderOrder = 80;
  marker.visible = false;
  scene.add(marker);

  const worldPosition = new THREE.Vector3();
  let selected: GameEntity | null = null;

  const select = (entity: GameEntity | null) => {
    selected = entity && entity.selectable && entity.alive && canSelect(entity) ? entity : null;
    marker.visible = selected !== null;
    if (!selected) return;
    material.color.setHex(teamColor(selected.team));
    marker.scale.setScalar(selected.selectionRadius);
    selected.root.userData.selected = true;
  };

  const pick = (raycaster: THREE.Raycaster) => {
    const selectable = registry.selectable().filter(canSelect);
    if (selectable.length === 0) {
      select(null);
      return null;
    }

    const roots = selectable.map(entity => entity.root);
    const hits = raycaster.intersectObjects(roots, true);
    for (const hit of hits) {
      const entity = getGameEntity(hit.object);
      if (!entity || !entity.selectable || !entity.alive || !canSelect(entity)) continue;
      select(entity);
      return entity;
    }

    select(null);
    return null;
  };

  const update = () => {
    if (!selected || !selected.alive || !selected.root.parent || !canSelect(selected)) {
      if (selected) selected.root.userData.selected = false;
      selected = null;
      marker.visible = false;
      return;
    }
    selected.root.getWorldPosition(worldPosition);
    marker.position.set(worldPosition.x, worldPosition.y + 0.055, worldPosition.z);
  };

  return {
    getSelected: () => selected,
    pick,
    select(entity) {
      if (selected && selected !== entity) selected.root.userData.selected = false;
      select(entity);
    },
    update,
    dispose() {
      if (selected) selected.root.userData.selected = false;
      scene.remove(marker);
      geometry.dispose();
      material.dispose();
    },
  };
}
