// Static content definitions — the read-only half of the IndexedDB story.
// Loaded into the `defs` store on first boot; referenced by id from sim data.
// For the prototype they live in code; migrate to seeded IDB rows as they grow.

interface TerrainDef {
  id: string;
  walkable: boolean;
  moveCost: number;
}

interface ResourceDef {
  id: string;
  yields: string;
  amount: number;
  harvestTicks: number;
}

const TERRAIN_DEFS: Record<string, TerrainDef> = {
  grass: { id: "grass", walkable: true, moveCost: 1 },
  water: { id: "water", walkable: false, moveCost: Infinity },
  rock: { id: "rock", walkable: true, moveCost: 2 },
};

const RESOURCE_DEFS: Record<string, ResourceDef> = {
  tree: { id: "tree", yields: "wood", amount: 5, harvestTicks: 30 },
};

export type { TerrainDef, ResourceDef };
export { TERRAIN_DEFS, RESOURCE_DEFS };
