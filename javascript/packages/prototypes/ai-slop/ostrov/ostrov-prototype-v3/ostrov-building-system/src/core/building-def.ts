import type { TTerrain } from "@hw/ostrov-island-system";
import type { TResources } from "./resources";

/** Ids of every building the catalog knows. Extend the union to add a kind. */
type TBuildingKind = "townhall" | "lumber_camp" | "farm" | "fishing_hut" | "quarry" | "mine" | "house" | "library";

/** Where a building may stand. Both lists are checked against the tile. */
type TPlacementRule = {
  /** Terrains the building accepts. */
  terrains: readonly TTerrain[];
  /** The tile must touch water. */
  coastal?: boolean;
  /**
   * The tile must have a building on a neighbouring tile. Everything but the
   * town hall grows out from what already stands, so the town keeps together.
   */
  adjacent?: boolean;
};

/** Static description of one kind of building. Instances are `Building`. */
type TBuildingDef = {
  id: TBuildingKind;
  label: string;
  /** One line for the catalog card. */
  description: string;
  /** Cost of level 1. Level `n` costs `cost * n`. */
  cost: TResources;
  /** Gained every turn at level 1. Level `n` yields `produces * n`. */
  produces: TResources;
  /** Science points per turn at level 1, scaled by level like `produces`. */
  science: number;
  /** How many people can live here, scaled by level. */
  housing: number;
  /** Turns from placing to producing. Level 1 only; an upgrade is instant. */
  buildTurns: number;
  maxLevel: number;
  placement: TPlacementRule;
  /** Only one on the island. */
  unique?: boolean;
  /** Another kind must be complete somewhere before this one can be placed. */
  requires?: TBuildingKind;
};

export type { TBuildingDef, TBuildingKind, TPlacementRule };
