// Two halves and a wall between them: barren "dead lands" to the west, green
// "peace lands" to the east, split top to bottom by an unbroken mountain line.
//
//   ┌──────────────┬───┬──────────────┐
//   │  dead lands  │ ▲ │  peace lands │
//   └──────────────┴───┴──────────────┘
//
// The ridge is the point of the map, so it is drawn first and everything else is
// asked which side of it it fell on. It spans every row without a gap — the two
// halves are meant to be unreachable from each other until something is built or
// mined through, and a single missing tile would quietly undo that.

import { createNoise2D } from "simplex-noise";
import { type Grid, Terrain, tileIndex } from "../grid";
import type { Rng } from "../rng";
import type { MapGenerator, MapGenResult } from "./types";
import { nearestWalkable } from "./util";

// Ridge shape, in tiles. The line wanders and breathes so it does not read as a
// wall someone dropped on the map, but it never thins past MIN_HALF_WIDTH: at
// half-width 1.5 the cliff is still three tiles thick, which no diagonal step
// can slip through.
const RIDGE_MEANDER = 5;
const RIDGE_MEANDER_SCALE = 28;
const RIDGE_HALF_WIDTH = 3.5;
const RIDGE_WIDTH_JITTER = 1.5;
const RIDGE_WIDTH_SCALE = 11;
const MIN_HALF_WIDTH = 1.5;

// Barren skirt the cliff rises out of, on both sides.
const APRON = 2.5;

// Dead lands: stone, with outcrops of bare mountain where the field runs high.
// No grass and no water — with four terrains that is the whole vocabulary the
// side has, and spending any of it on green would read as peace land that
// happens to lie west.
const DEAD_SCALE = 13;
const DEAD_MOUNTAIN = 0.55;

// Peace lands: grass by default, with lakes in the hollows and the odd stony rise.
const PEACE_SCALE = 15;
const PEACE_WATER = -0.5;
const PEACE_ROCK = 0.62;

function ridgeCenter(noise: (x: number, y: number) => number, grid: Grid, y: number): number {
  return grid.width / 2 + noise(0.5, y / RIDGE_MEANDER_SCALE) * RIDGE_MEANDER;
}

function ridgeHalfWidth(noise: (x: number, y: number) => number, y: number): number {
  const jitter = noise(11.3, y / RIDGE_WIDTH_SCALE) * RIDGE_WIDTH_JITTER;
  return Math.max(MIN_HALF_WIDTH, RIDGE_HALF_WIDTH + jitter);
}

function deadTerrain(n: number): Terrain {
  return n > DEAD_MOUNTAIN ? Terrain.Mountain : Terrain.Rock;
}

function peaceTerrain(n: number): Terrain {
  if (n < PEACE_WATER) {
    return Terrain.Water;
  }
  if (n > PEACE_ROCK) {
    return Terrain.Rock;
  }
  return Terrain.Grass;
}

function generate(grid: Grid, rng: Rng): MapGenResult {
  // Three independent fields off the one rng: the ridge must be free to wander
  // without the biome either side of it following the same wiggle.
  const ridgeNoise = createNoise2D(rng);
  const deadNoise = createNoise2D(rng);
  const peaceNoise = createNoise2D(rng);

  for (let y = 0; y < grid.height; y += 1) {
    const center = ridgeCenter(ridgeNoise, grid, y);
    const halfWidth = ridgeHalfWidth(ridgeNoise, y);
    for (let x = 0; x < grid.width; x += 1) {
      const distance = Math.abs(x + 0.5 - center);
      let terrain: Terrain;
      if (distance <= halfWidth) {
        terrain = Terrain.Mountain;
      } else if (distance <= halfWidth + APRON) {
        terrain = Terrain.Rock;
      } else if (x + 0.5 < center) {
        terrain = deadTerrain(deadNoise(x / DEAD_SCALE, y / DEAD_SCALE));
      } else {
        terrain = peaceTerrain(peaceNoise(x / PEACE_SCALE, y / PEACE_SCALE));
      }
      grid.terrain[tileIndex(grid, x, y)] = terrain;
    }
  }

  // The colony starts in the peace lands, halfway between the ridge and the east
  // edge — far enough from the cliff that the first jobs are not all uphill.
  const midY = Math.floor(grid.height / 2);
  const ridgeEdge = ridgeCenter(ridgeNoise, grid, midY) + ridgeHalfWidth(ridgeNoise, midY) + APRON;
  const colonyOrigin = nearestWalkable(grid, { x: (ridgeEdge + grid.width - 1) / 2, y: midY });
  return { colonyOrigin };
}

const dividedLands: MapGenerator = {
  id: "divided-lands",
  label: "Divided lands",
  generate,
};

export { dividedLands };
