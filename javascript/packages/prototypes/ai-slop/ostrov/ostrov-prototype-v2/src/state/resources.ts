import { RESOURCE_OPTIONS, config } from "@hw/ostrov-prototype-v2-config";
import { signal } from "@preact/signals-react";
import type { BuildingId } from "../buildings/catalog";
import { CASTLE_ID, allBuildingCosts, buildingCost } from "../buildings/catalog";
import type { ResourceKind, Stock } from "../economy/stock";
import { affordable, missingOf, startingStock, withoutCost } from "../economy/stock";

/**
 * The player's pile of goods.
 *
 * A price is taken out of it the moment a site is laid, not when the site is
 * finished: the player is paying for the materials that go into the scaffolding.
 * Goods come back in one parcel at a time, credited where the parcel lands.
 */

/**
 * How many buildings past the castle the opening pile has to cover.
 *
 * Four is the shape of the opening move the prototype is built around — a
 * castle and the four cheapest things to put around it — so it is a number this
 * module owns rather than a knob. The slack over it and the floor under it are
 * the designer's, and both live in `economy` in the config.
 */
const FUNDED_BUILDINGS = 4;

const START_STOCK: Stock = startingStock({
  costs: allBuildingCosts(),
  castleId: CASTLE_ID,
  others: FUNDED_BUILDINGS,
  headroom: config.economy.startStockHeadroom,
  floor: config.economy.startStockFloor,
});

const stock = signal<Stock>(START_STOCK);

/** The designer's own word for a resource, so the panel and the editor agree. */
function resourceLabel(kind: ResourceKind): string {
  return RESOURCE_OPTIONS.find((option) => option.value === kind)?.label ?? kind;
}

/** Whether the pile covers this building right now. Free while the economy is off. */
function canAfford(id: BuildingId): boolean {
  if (!config.economy.enabled) {
    return true;
  }
  return affordable(stock.value, buildingCost(id));
}

/** The resource the player is short of for this building, or null when they are not. */
function shortfallOf(id: BuildingId): ResourceKind | null {
  if (!config.economy.enabled) {
    return null;
  }
  return missingOf(stock.value, buildingCost(id));
}

/**
 * Takes the price of `id` out of the pile. Returns false and changes nothing
 * when the pile does not cover it, so the caller can refuse the placement.
 */
function paySpend(id: BuildingId): boolean {
  if (!config.economy.enabled) {
    return true;
  }
  const cost = buildingCost(id);
  const held = stock.peek();
  if (!affordable(held, cost)) {
    return false;
  }
  stock.value = withoutCost(held, cost);
  return true;
}

/** Puts a delivered parcel into the pile. */
function credit(kind: ResourceKind, amount: number): void {
  const held = stock.peek();
  stock.value = { ...held, [kind]: held[kind] + amount };
}

export { FUNDED_BUILDINGS, START_STOCK, canAfford, credit, paySpend, resourceLabel, shortfallOf, stock };
