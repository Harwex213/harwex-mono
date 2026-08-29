import type { Island, TTile } from "@hw/ostrov-island-system";
import { Building } from "./building";
import { buildingDef } from "./catalog";
import { checkPlacement } from "./placement";
import { RESOURCE_LIST, addResources, canAfford, clampResources, resources, subtractResources } from "./resources";
import type { TBuildingData } from "./building";
import type { TBuildingDef, TBuildingKind } from "./building-def";
import type { TPlacementCheck } from "./placement";
import type { TResourceKind, TResources } from "./resources";

const STARTING_RESOURCES: TResources = resources({ food: 10, materials: 14, metal: 0 });
const STARTING_POPULATION = 3;

/** Food one person eats per turn. */
const FOOD_PER_PERSON = 1;

type TSettlementData = {
  turn: number;
  resources: TResources;
  science: number;
  population: number;
  buildings: TBuildingData[];
};

type TTurnEvent =
  | { type: "completed"; building: Building }
  | { type: "starved"; shortfall: TResourceKind[] }
  | { type: "grew"; population: number };

/** What one `endTurn` did, for a log. */
type TTurnReport = {
  turn: number;
  produced: TResources;
  spent: TResources;
  science: number;
  events: TTurnEvent[];
};

/**
 * Everything the player owns on one island: the stock, the people, the
 * buildings and the turn counter. Immutable: every action returns a new
 * settlement, and a failed action throws, so check with `canPlace` /
 * `canUpgrade` first.
 */
class Settlement {
  static readonly STARTING_RESOURCES = STARTING_RESOURCES;

  readonly island: Island;
  readonly turn: number;
  readonly resources: TResources;
  readonly science: number;
  readonly population: number;
  readonly buildings: readonly Building[];

  private readonly byTile: Map<string, Building>;

  constructor(island: Island, data: TSettlementData) {
    this.island = island;
    this.turn = data.turn;
    this.resources = data.resources;
    this.science = data.science;
    this.population = data.population;
    this.buildings = data.buildings.map((entry) => new Building(buildingDef(entry.kind), entry));
    this.byTile = new Map(this.buildings.map((building) => [building.tileKey, building]));
  }

  /** A new settlement on turn 1. Nothing stands yet: the player places the town hall. */
  static found(island: Island) {
    return new Settlement(island, {
      turn: 1,
      resources: STARTING_RESOURCES,
      science: 0,
      population: STARTING_POPULATION,
      buildings: [],
    });
  }

  buildingAt(tileKey: string | null) {
    if (tileKey === null) {
      return null;
    }

    return this.byTile.get(tileKey) ?? null;
  }

  has(kind: TBuildingKind) {
    return this.buildings.some((building) => building.kind === kind);
  }

  /** Beds for the people. Growth stops here. */
  get housing() {
    return this.buildings.reduce((sum, building) => sum + building.housing, 0);
  }

  /** Science points gained per turn. */
  get scienceRate() {
    return this.buildings.reduce((sum, building) => sum + building.science, 0);
  }

  /** The turn cannot end before the settlement has a heart. */
  get canEndTurn() {
    return this.has("townhall");
  }

  canPlace(def: TBuildingDef, tile: TTile): TPlacementCheck {
    return checkPlacement({ island: this.island, buildings: this.buildings, resources: this.resources }, def, tile);
  }

  place(def: TBuildingDef, tile: TTile) {
    const check = this.canPlace(def, tile);
    if (!check.ok) {
      throw new Error(`Cannot place ${def.id} at ${tile.key}: ${check.reasons.join("; ")}`);
    }

    return this.with({
      resources: subtractResources(this.resources, def.cost),
      buildings: [...this.buildings, Building.place(def, tile.key, this.turn)],
    });
  }

  canUpgrade(building: Building) {
    const cost = building.upgradeCost;

    return building.canUpgrade && cost !== null && canAfford(this.resources, cost);
  }

  upgrade(building: Building) {
    if (!this.canUpgrade(building)) {
      throw new Error(`Cannot upgrade ${building.id}`);
    }

    return this.with({
      resources: subtractResources(this.resources, building.upgradeCost!),
      buildings: this.buildings.map((entry) => (entry.id === building.id ? entry.upgraded() : entry)),
    });
  }

  /** Half the level-1 cost comes back, rounded down. The town hall stays. */
  demolish(building: Building) {
    if (building.def.unique) {
      throw new Error(`${building.id} cannot be demolished`);
    }

    const refund = resources({
      food: Math.floor(building.def.cost.food / 2),
      materials: Math.floor(building.def.cost.materials / 2),
      metal: Math.floor(building.def.cost.metal / 2),
    });

    return this.with({
      resources: addResources(this.resources, refund),
      buildings: this.buildings.filter((entry) => entry.id !== building.id),
    });
  }

  /** What the buildings yield per turn right now. */
  private production() {
    return this.buildings.reduce((sum, building) => addResources(sum, building.production), resources());
  }

  /** What the people eat per turn. */
  private upkeep() {
    return resources({ food: this.population * FOOD_PER_PERSON });
  }

  /** Net change of the stock the next `endTurn` will bring, given nothing else changes. */
  forecast(): TResources {
    return subtractResources(this.production(), this.upkeep());
  }

  /**
   * Construction advances first, so a building finished this turn produces
   * from the next one. Production is then added and the people fed; a stock
   * that would go negative is clamped and reported as a shortfall. With food
   * to spare and a free bed, one more person arrives.
   */
  endTurn(): { settlement: Settlement; report: TTurnReport } {
    const events: TTurnEvent[] = [];
    const advanced = this.buildings.map((building) => {
      const next = building.advance();
      if (next !== building && next.isActive) {
        events.push({ type: "completed", building: next });
      }

      return next;
    });

    const produced = this.production();
    const spent = this.upkeep();
    const raw = subtractResources(addResources(this.resources, produced), spent);
    const shortfall = RESOURCE_LIST.filter((kind) => raw[kind] < 0);

    if (shortfall.length > 0) {
      events.push({ type: "starved", shortfall });
    }

    let population = this.population;
    if (shortfall.length === 0 && raw.food > 0 && population < this.housing) {
      population += 1;
      events.push({ type: "grew", population });
    }

    const science = this.scienceRate;
    const settlement = this.with({
      turn: this.turn + 1,
      resources: clampResources(raw),
      science: this.science + science,
      population,
      buildings: advanced,
    });

    return { settlement, report: { turn: this.turn, produced, spent, science, events } };
  }

  toData(): TSettlementData {
    return {
      turn: this.turn,
      resources: this.resources,
      science: this.science,
      population: this.population,
      buildings: this.buildings.map((building) => building.toData()),
    };
  }

  private with(patch: Partial<Omit<TSettlementData, "buildings">> & { buildings?: readonly Building[] }) {
    return new Settlement(this.island, {
      turn: patch.turn ?? this.turn,
      resources: patch.resources ?? this.resources,
      science: patch.science ?? this.science,
      population: patch.population ?? this.population,
      buildings: (patch.buildings ?? this.buildings).map((building) => building.toData()),
    });
  }
}

export type { TSettlementData, TTurnEvent, TTurnReport };
export { Settlement };
