import basicCatalog from './basic.json';
import intermediateCatalog from './intermediate.json';
import advancedCatalog from './advanced.json';
import economy from './economy.json';

export type ItemTier = 'Básico' | 'Intermedio' | 'Avanzado';
export type ItemPhase = 'Early' | 'Mid' | 'Late';

export type ItemStats = Partial<Record<
  | 'strength'
  | 'agility'
  | 'intelligence'
  | 'damage'
  | 'magic_power'
  | 'armor'
  | 'attack_speed_pct'
  | 'move_speed_flat'
  | 'hp'
  | 'hp_regen'
  | 'mana'
  | 'mana_regen'
  | 'magic_resist_pct',
  number
>>;

export type ItemComponent = Readonly<{
  id: string;
  quantity: number;
}>;

export type EffectValues = Readonly<Record<string, number | boolean | string>>;

export type ItemPassiveEffect = Readonly<{
  id: string;
  name: string;
  description: string;
  values: EffectValues;
}>;

export type ItemActiveEffect = ItemPassiveEffect & Readonly<{
  cooldown: number;
  mana_cost: number;
}>;

export type ItemDefinition = Readonly<{
  id: string;
  name: string;
  tier: ItemTier;
  phase: ItemPhase;
  cost: number;
  components: readonly ItemComponent[];
  recipe_cost: number;
  stats: ItemStats;
  passive_effect: ItemPassiveEffect | null;
  active_effect: ItemActiveEffect | null;
  flavor_text: string;
}>;

type CatalogFile = Readonly<{
  schema_version: number;
  category: string;
  items: readonly ItemDefinition[];
}>;

export const ITEM_ECONOMY = economy;

const catalogs = [
  basicCatalog as unknown as CatalogFile,
  intermediateCatalog as unknown as CatalogFile,
  advancedCatalog as unknown as CatalogFile,
] as const;

export const ITEMS: readonly ItemDefinition[] = catalogs.flatMap(catalog => catalog.items);
export const ITEM_BY_ID = new Map(ITEMS.map(item => [item.id, item] as const));

export function getItemDefinition(id: string) {
  return ITEM_BY_ID.get(id) ?? null;
}

export function computeItemComponentCost(item: ItemDefinition) {
  return item.components.reduce((total, component) => {
    const definition = ITEM_BY_ID.get(component.id);
    if (!definition) return total;
    return total + definition.cost * component.quantity;
  }, 0);
}

export function computeRawStatGoldValue(item: ItemDefinition) {
  const prices = ITEM_ECONOMY.gold_per_stat as Record<string, number>;
  return Object.entries(item.stats).reduce((total, [stat, amount]) => {
    const price = prices[stat];
    return total + (price === undefined ? 0 : price * Number(amount));
  }, 0);
}

export function validateItemCatalog(): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();

  for (const catalog of catalogs) {
    if (catalog.schema_version !== 2) {
      errors.push(`${catalog.category}: schema_version debe ser 2.`);
    }
  }

  for (const item of ITEMS) {
    if (ids.has(item.id)) errors.push(`${item.id}: id duplicado.`);
    ids.add(item.id);

    if (!/^item_\d{3}$/.test(item.id)) errors.push(`${item.id}: formato de id inválido.`);
    if (!Number.isFinite(item.cost) || item.cost < 0) errors.push(`${item.id}: cost inválido.`);
    if (!Number.isFinite(item.recipe_cost) || item.recipe_cost < 0) errors.push(`${item.id}: recipe_cost inválido.`);
    if ('move_speed_pct' in item.stats) {
      errors.push(`${item.id}: move_speed_pct permanente no está permitido; usa move_speed_flat.`);
    }

    for (const component of item.components) {
      if (!Number.isInteger(component.quantity) || component.quantity < 1) {
        errors.push(`${item.id}: quantity inválida para ${component.id}.`);
      }
      if (!ITEM_BY_ID.has(component.id)) {
        errors.push(`${item.id}: componente inexistente ${component.id}.`);
      }
    }

    if (item.tier !== 'Avanzado') {
      if (item.components.length !== 0) errors.push(`${item.id}: un ítem ${item.tier} no debe tener componentes.`);
      if (item.recipe_cost !== 0) errors.push(`${item.id}: un ítem ${item.tier} debe usar recipe_cost 0.`);

      // Consumibles no se valoran por estadísticas permanentes. Los demás básicos e
      // intermedios deben mantener eficiencia cruda 1.0 según la tabla de economía.
      if (Object.keys(item.stats).length > 0) {
        const rawValue = computeRawStatGoldValue(item);
        if (Math.abs(rawValue - item.cost) > 0.001) {
          errors.push(`${item.id}: valor de stats ${rawValue} != coste ${item.cost}.`);
        }
      }
    } else {
      const expectedCost = computeItemComponentCost(item) + item.recipe_cost;
      if (Math.abs(expectedCost - item.cost) > 0.001) {
        errors.push(`${item.id}: coste ${item.cost} != componentes+receta ${expectedCost}.`);
      }
    }

    if (item.passive_effect) validateEffect(item.id, item.passive_effect, false, errors);
    if (item.active_effect) validateEffect(item.id, item.active_effect, true, errors);
  }

  if (ITEMS.length !== 60) errors.push(`Catálogo esperado: 60 ítems; encontrados: ${ITEMS.length}.`);
  return errors;
}

function validateEffect(
  itemId: string,
  effect: ItemPassiveEffect | ItemActiveEffect,
  active: boolean,
  errors: string[],
) {
  if (!effect.id.trim()) errors.push(`${itemId}: efecto sin id técnico.`);
  if (!effect.name.trim()) errors.push(`${itemId}: efecto sin name.`);
  if (!effect.description.trim()) errors.push(`${itemId}: efecto sin description.`);
  if (!effect.values || typeof effect.values !== 'object') errors.push(`${itemId}: efecto sin values.`);

  if (active) {
    const activeEffect = effect as ItemActiveEffect;
    if (!Number.isFinite(activeEffect.cooldown) || activeEffect.cooldown < 0) {
      errors.push(`${itemId}: cooldown activo inválido.`);
    }
    if (!Number.isFinite(activeEffect.mana_cost) || activeEffect.mana_cost < 0) {
      errors.push(`${itemId}: mana_cost activo inválido.`);
    }
  }
}

export const ITEM_CATALOG_VALIDATION_ERRORS = validateItemCatalog();

if (ITEM_CATALOG_VALIDATION_ERRORS.length > 0) {
  throw new Error(`Invalid Dawnreach item catalog:\n${ITEM_CATALOG_VALIDATION_ERRORS.join('\n')}`);
}
