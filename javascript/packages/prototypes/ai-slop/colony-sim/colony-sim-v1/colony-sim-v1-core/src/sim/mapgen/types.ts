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
  // One starting camp per player, in player order, all walkable. The map owns
  // these for the same reason it owns the origin, only more so: "the top of the
  // green half" is a sentence only the generator can turn into a tile, and a
  // world builder guessing at it drops a player into a cliff or across a wall.
  // Camps are far enough apart that two crews do not open on the same clearing,
  // and always on the same side of whatever the map drew — a player who cannot
  // reach the colony is not in the game.
  camps: Position[];
}

interface MapGenerator {
  id: string;
  label: string;
  // Writes terrain and regions into the grid in place, and picks the spots on it
  // that the world builder needs by name. `campCount` is how many players there
  // are; the map says where they start, never how many there are. The rng is the
  // world's own, so the same seed plus the same generator is the same map, always.
  generate(grid: Grid, rng: Rng, campCount: number): MapGenResult;
}

export type { MapGenerator, MapGenResult };
