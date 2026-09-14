export const SHOP_OPEN_EVENT = 'dawnreach:shop-open';
export const ITEM_DROP_EVENT = 'dawnreach:item-drop';
export const ITEM_PICKUP_REQUEST_EVENT = 'dawnreach:item-pickup-request';
export const ITEM_PICKUP_RESULT_EVENT = 'dawnreach:item-pickup-result';
export const ITEM_USE_EVENT = 'dawnreach:item-use';

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
