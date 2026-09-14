export const SHOP_OPEN_EVENT = 'dawnreach:shop-open';
export const ITEM_DROP_EVENT = 'dawnreach:item-drop';
export const ITEM_PICKUP_REQUEST_EVENT = 'dawnreach:item-pickup-request';
export const ITEM_PICKUP_RESULT_EVENT = 'dawnreach:item-pickup-result';
export const ITEM_USE_EVENT = 'dawnreach:item-use';
export const ITEM_TARGET_REQUEST_EVENT = 'dawnreach:item-target-request';
export const ITEM_TARGET_CONFIRM_EVENT = 'dawnreach:item-target-confirm';

export type ShopOpenDetail = Readonly<{
  shopId: string;
  team: 'blue' | 'red';
}>;

export type ItemDropDetail = Readonly<{
  token: string;
  itemId: string;
}>;

export type ItemPickupRequestDetail = Readonly<{
  groundId: string;
  itemId: string;
}>;

export type ItemPickupResultDetail = Readonly<{
  groundId: string;
  accepted: boolean;
}>;

export type ItemUseDetail = Readonly<{
  itemId: string;
  instanceId: string;
  effectId: string;
  values: Readonly<Record<string, number | boolean | string>>;
  activatedAtMs: number;
}>;

export type ItemTargetRequestDetail = Readonly<{
  itemId: string;
  instanceId: string;
  effectId: string;
  values: Readonly<Record<string, number | boolean | string>>;
}>;

export type ItemTargetConfirmDetail = Readonly<{
  instanceId: string;
}>;
