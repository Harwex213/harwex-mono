// The seam between "what the map looks like" and "what is put on it". A
// generator owns the terrain and nothing else: entities, stock and spawns stay
// in world.ts, so a new map style is one file here plus one line in the
// registry — never a change to the world builder.

import type { Position } from "../components";
import type { Grid } from "../grid";
import type { Rng } from "../rng";

interface MapGenResult {
  // Where the colony belongs on this map. The world builder cannot guess it:
  // the centre of the grid is a fine default for a noise field and the inside
  // of a cliff for a map built around a ridge. Must be walkable — the stockpile
  // sits here and colonists path to it.
  colonyOrigin: Position;
}

interface MapGenerator {
  id: string;
  label: string;
  // Writes terrain into the grid in place. The rng is the world's own, so the
  // same seed plus the same generator is the same map, always.
  generate(grid: Grid, rng: Rng): MapGenResult;
}

export type { MapGenerator, MapGenResult };
