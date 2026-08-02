// The original map: one noise field cut into height bands. No regions, no
// intent — whatever the field happened to produce.

import { createNoise2D } from "simplex-noise";
import { type Grid, Terrain, tileIndex } from "../grid";
import type { Rng } from "../rng";
import type { MapGenerator, MapGenResult } from "./types";
import { campRows, nearestWalkable } from "./util";

// Where the field is cut. The bands are nested by height: mountain is the crown
// of the rocky highs, not a region of its own, so a cliff always comes ringed by
// the barren ground it rises out of.
const WATER_NOISE = -0.55;
const ROCK_NOISE = 0.6;
const MOUNTAIN_NOISE = 0.78;

const NOISE_SCALE = 16;

// This map has no hostile half to keep the camps out of, so they only have to
// clear the edges: the field can leave a camp pressed against a lake either way,
// and `nearestWalkable` is what saves that one.
const CAMP_MARGIN = 10;

function generate(grid: Grid, rng: Rng, campCount: number): MapGenResult {
  const noise = createNoise2D(rng);
  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const n = noise(x / NOISE_SCALE, y / NOISE_SCALE);
      let terrain = Terrain.Grass;
      if (n < WATER_NOISE) {
        terrain = Terrain.Water;
      } else if (n > MOUNTAIN_NOISE) {
        terrain = Terrain.Mountain;
      } else if (n > ROCK_NOISE) {
        terrain = Terrain.Rock;
      }
      grid.terrain[tileIndex(grid, x, y)] = terrain;
    }
  }
  const colonyOrigin = nearestWalkable(grid, { x: grid.width / 2, y: grid.height / 2 });
  // Camps share the centre column with the origin and spread up and down it. The
  // whole map is one region here, so `region` is left zero-filled: peace lands end
  // to end, and a colonist may wander anywhere it can walk.
  const camps = campRows(grid, campCount, CAMP_MARGIN).map((y) =>
    nearestWalkable(grid, { x: grid.width / 2, y }),
  );
  return { colonyOrigin, camps };
}

const noiseBands: MapGenerator = {
  id: "noise-bands",
  label: "Noise bands",
  generate,
};

export { noiseBands };
