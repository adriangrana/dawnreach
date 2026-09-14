export const TELEPORT_SCROLL_ITEM_ID = 'item_060';
export const TELEPORT_SCROLL_SLOT = 6 as const;
export const TELEPORT_SCROLL_EFFECT_ID = 'global_structure_teleport';

export const TELEPORT_TARGET_REQUEST_EVENT = 'dawnreach:teleport-target-request';
export const TELEPORT_CAST_REQUEST_EVENT = 'dawnreach:teleport-cast-request';
export const TELEPORT_TARGETING_STATE_EVENT = 'dawnreach:teleport-targeting-state';
export const TELEPORT_COMPLETE_EVENT = 'dawnreach:teleport-complete';
export const TELEPORT_CANCEL_EVENT = 'dawnreach:teleport-cancel';

export type TeleportTargetRequestDetail = Readonly<{
  itemId: typeof TELEPORT_SCROLL_ITEM_ID;
  instanceId: string;
  source: 'hotkey' | 'slot';
  requestedAtMs: number;
}>;

export type TeleportCastRequestDetail = Readonly<{
  instanceId: string;
  targetEntityId: string;
  requestedAtMs: number;
}>;

export type TeleportTargetingStateDetail = Readonly<{
  instanceId: string;
  active: boolean;
  targetEntityId?: string;
}>;

export type TeleportCompleteDetail = Readonly<{
  instanceId: string;
  targetEntityId: string;
  completedAtMs: number;
}>;

export type TeleportCancelReason =
  | 'player-command'
  | 'hard-cc'
  | 'death'
  | 'invalid-target'
  | 'replaced';

export type TeleportCancelDetail = Readonly<{
  instanceId: string;
  targetEntityId: string;
  reason: TeleportCancelReason;
  cancelledAtMs: number;
}>;
