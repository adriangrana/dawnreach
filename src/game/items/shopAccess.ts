type ShopProximityListener = (nearShop: boolean) => void;

let localHeroNearShop = false;
const listeners = new Set<ShopProximityListener>();
const storefrontPurchaseDrops = new Set<string>();

export function isLocalHeroNearShop() {
  return localHeroNearShop;
}

export function setLocalShopProximity(nearShop: boolean) {
  if (localHeroNearShop === nearShop) return;
  localHeroNearShop = nearShop;
  for (const listener of listeners) listener(nearShop);
}

/** Marks a purchased item that could not be delivered directly to inventory. */
export function markShopPurchaseForStorefrontDrop(instanceId: string) {
  storefrontPurchaseDrops.add(instanceId);
}

/** Consumes the one-shot storefront delivery marker for a purchased ground item. */
export function consumeShopPurchaseStorefrontDrop(instanceId: string) {
  return storefrontPurchaseDrops.delete(instanceId);
}

export function subscribeLocalShopProximity(listener: ShopProximityListener) {
  listeners.add(listener);
  listener(localHeroNearShop);
  return () => {
    listeners.delete(listener);
  };
}
