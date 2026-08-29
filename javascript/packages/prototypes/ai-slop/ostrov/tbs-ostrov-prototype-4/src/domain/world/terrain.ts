/**
 * The three land types from the brief plus the sea that isolates them. Every
 * rule that cares about the ground reads its number from this one table.
 */

const TERRAIN_KINDS = ["sea", "meadow", "forest", "mountain"] as const;

type TTerrainKind = (typeof TERRAIN_KINDS)[number];

type TTerrainTraits = {
  label: string;
  /** Movement points one step onto this tile costs. `null` means impassable. */
  moveCost: number | null;
  /** Multiplies the defender's strength when it is attacked on this tile. */
  defence: number;
  /** Gold the tile adds to the city that works it. */
  income: number;
  /** Added to the sight radius of an army standing here. */
  sightBonus: number;
};

const TERRAIN: Record<TTerrainKind, TTerrainTraits> = {
  sea: { label: "Море", moveCost: null, defence: 1, income: 1, sightBonus: 0 },
  meadow: { label: "Луга", moveCost: 1, defence: 1, income: 3, sightBonus: 0 },
  forest: { label: "Лес", moveCost: 2, defence: 1.25, income: 2, sightBonus: 0 },
  mountain: { label: "Горы", moveCost: 3, defence: 1.6, income: 1, sightBonus: 1 },
};

/** The cost of stepping onto `kind`, or `Infinity` where no army may go. */
const moveCostOf = (kind: TTerrainKind): number => TERRAIN[kind].moveCost ?? Number.POSITIVE_INFINITY;

export type { TTerrainKind, TTerrainTraits };
export { TERRAIN, TERRAIN_KINDS, moveCostOf };
