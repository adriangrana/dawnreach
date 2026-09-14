type ShopProximityListener = (nearShop: boolean) => void;

let localHeroNearShop = false;
const listeners = new Set<ShopProximityListener>();

export function isLocalHeroNearShop() {
  return localHeroNearShop;
}

export function setLocalShopProximity(nearShop: boolean) {
  if (localHeroNearShop === nearShop) return;
  localHeroNearShop = nearShop;
  for (const listener of listeners) listener(nearShop);
}

export function subscribeLocalShopProximity(listener: ShopProximityListener) {
  listeners.add(listener);
  listener(localHeroNearShop);
  return () => {
    listeners.delete(listener);
  };
}
