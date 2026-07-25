// Two halves and a wall between them: barren "dead lands" to the west, green
// "peace lands" to the east, split top to bottom by a mountain line with a
// handful of ways through it.
//
//   ┌────────────┬─┬─────────────────────────────┐
//   │            │▲│                             │
//   │ dead lands │ │        peace lands          │
//   │            │▲│                             │
//   └────────────┴─┴─────────────────────────────┘
//
// The ridge is the point of the map, so it is drawn first and everything else is
// asked which side of it it fell on. It sits a third of the way across rather
// than at the middle: the west side only has to read as a hostile place to come
// from, while the east side is where a colony actually gets built and wants the
// room.
//
// The line is not a seal. A wall with no doors is two games on one map — nothing
// can ever cross, so the far side may as well not exist. Instead it is cut by a
// few gorges wide enough to march through and a scatter of cracks a body wide;
// everywhere else it stays at least three tiles thick, which no diagonal step
// can slip through.

import { createNoise2D } from "simplex-noise";
import { type Grid, isWalkable, Terrain, tileIndex } from "../grid";
import { randInt, type Rng } from "../rng";
import type { MapGenerator, MapGenResult } from "./types";
import { nearestWalkable } from "./util";

// Where the wall stands, as a fraction of the map's width.
const RIDGE_X = 0.32;

// Ridge shape, in tiles. The line wanders and breathes so it does not read as a
// wall someone dropped on the map.
const RIDGE_MEANDER = 5;
const RIDGE_MEANDER_SCALE = 28;
const RIDGE_HALF_WIDTH = 3.5;
const RIDGE_WIDTH_JITTER = 1.5;
const RIDGE_WIDTH_SCALE = 11;
const MIN_HALF_WIDTH = 1.5;

// Barren skirt the cliff rises out of, on both sides.
const APRON = 2.5;

// Passes, counted in rows of the ridge. A pass is a fully open corridor
// `2 * halfHeight + 1` rows tall, with RAMP rows either side where the cliff
// thins into it instead of ending on a square corner.
const BIG_PASSES_MIN = 2;
const BIG_PASSES_MAX = 4;
const BIG_HALF_HEIGHT_MIN = 2; // 5 rows
const BIG_HALF_HEIGHT_MAX = 5; // 11 rows
const BIG_RAMP = 4;
const SMALL_PASSES_MIN = 3;
const SMALL_PASSES_MAX = 6;
const SMALL_HALF_HEIGHT_MAX = 1; // 1 or 3 rows
const SMALL_RAMP = 2;
// No pass may open onto the map's edge (there is nothing to walk out into), and
// two of them closer than this would merge into a hole rather than read as two
// doors.
const PASS_MARGIN = 4;
const PASS_SPACING = 7;
// How much open ground a pass has to run into before it counts as connected.
const OPEN_RUN = 4;

interface Pass {
  y: number;
  halfHeight: number;
  ramp: number;
}

function ridgeCenter(noise: (x: number, y: number) => number, grid: Grid, y: number): number {
  return grid.width * RIDGE_X + noise(0.5, y / RIDGE_MEANDER_SCALE) * RIDGE_MEANDER;
}

function ridgeHalfWidth(noise: (x: number, y: number) => number, y: number): number {
  const jitter = noise(11.3, y / RIDGE_WIDTH_SCALE) * RIDGE_WIDTH_JITTER;
  return Math.max(MIN_HALF_WIDTH, RIDGE_HALF_WIDTH + jitter);
}

// The big passes are placed one per equal slice of the map's height rather than
// by rejection sampling: on a short map an unlucky seed would otherwise stack
// them all in one place and leave half the wall untouched.
function placePasses(grid: Grid, rng: Rng): Pass[] {
  const passes: Pass[] = [];
  const top = PASS_MARGIN;
  const span = grid.height - 2 * PASS_MARGIN;
  if (span <= 0) {
    return passes;
  }

  const bigCount = randInt(rng, BIG_PASSES_MIN, BIG_PASSES_MAX + 1);
  const slice = span / bigCount;
  for (let i = 0; i < bigCount; i += 1) {
    const halfHeight = randInt(rng, BIG_HALF_HEIGHT_MIN, BIG_HALF_HEIGHT_MAX + 1);
    // Keep the whole corridor inside its own slice, so neighbouring gorges
    // cannot grow into each other.
    const room = Math.max(0, slice - 2 * halfHeight - 1);
    const y = Math.round(top + i * slice + halfHeight + rng() * room);
    passes.push({ y, halfHeight, ramp: BIG_RAMP });
  }

  const smallCount = randInt(rng, SMALL_PASSES_MIN, SMALL_PASSES_MAX + 1);
  for (let i = 0; i < smallCount; i += 1) {
    const halfHeight = randInt(rng, 0, SMALL_HALF_HEIGHT_MAX + 1);
    // Cracks go wherever there is a gap; a draw that lands on top of an existing
    // pass is dropped rather than retried, so a crowded map simply gets fewer.
    const y = randInt(rng, top, top + span);
    const clear = passes.every((pass) => Math.abs(pass.y - y) > pass.halfHeight + halfHeight + PASS_SPACING);
    if (clear) {
      passes.push({ y, halfHeight, ramp: SMALL_RAMP });
    }
  }
  return passes;
}

// 0 where the wall stands whole, 1 where it is gone, smoothly in between.
function passOpenness(passes: readonly Pass[], y: number): number {
  let best = 0;
  for (const pass of passes) {
    const t = (pass.halfHeight + pass.ramp - Math.abs(y - pass.y)) / pass.ramp;
    if (t <= best) {
      continue;
    }
    const clamped = Math.min(1, t);
    best = Math.max(best, clamped * clamped * (3 - 2 * clamped));
  }
  return best;
}

// A gorge that opens onto a lake or into a mountain outcrop is not a gorge. Walk
// out of the pass along its middle row and turn whatever blocks it into rock,
// until the row has reached open ground and stayed on it. Cheaper than a flood
// fill and it repairs the only failure the passes can produce: the biome either
// side is drawn without knowing where the doors ended up.
function clearPassMouth(grid: Grid, y: number, fromX: number, step: number): void {
  let open = 0;
  for (let x = fromX; x >= 0 && x < grid.width; x += step) {
    if (isWalkable(grid, x, y)) {
      open += 1;
      if (open >= OPEN_RUN) {
        return;
      }
      continue;
    }
    open = 0;
    grid.terrain[tileIndex(grid, x, y)] = Terrain.Rock;
  }
}

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
  const passes = placePasses(grid, rng);

  for (let y = 0; y < grid.height; y += 1) {
    const center = ridgeCenter(ridgeNoise, grid, y);
    const halfWidth = ridgeHalfWidth(ridgeNoise, y);
    const openness = passOpenness(passes, y);
    // The rock the cliff stood on stays put where the cliff is gone: a pass has
    // a floor, and it is the same barren stone as the skirt around it.
    const cliffHalfWidth = openness >= 1 ? -1 : halfWidth * (1 - openness);
    for (let x = 0; x < grid.width; x += 1) {
      const distance = Math.abs(x + 0.5 - center);
      let terrain: Terrain;
      if (distance <= cliffHalfWidth) {
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

  for (const pass of passes) {
    const center = ridgeCenter(ridgeNoise, grid, pass.y);
    const edge = ridgeHalfWidth(ridgeNoise, pass.y) + APRON;
    clearPassMouth(grid, pass.y, Math.round(center - edge), -1);
    clearPassMouth(grid, pass.y, Math.round(center + edge), 1);
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
