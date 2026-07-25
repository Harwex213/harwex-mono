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
import type { Position } from "../components";
import { type Grid, isWalkable, Region, Terrain, tileIndex } from "../grid";
import { randInt, type Rng } from "../rng";
import type { MapGenerator, MapGenResult } from "./types";
import { campRows, nearestWalkable } from "./util";

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
const BIG_HALF_HEIGHT_MAX = 3; // 7 rows
const BIG_RAMP = 3;
const SMALL_PASSES_MIN = 3;
const SMALL_PASSES_MAX = 6;
const SMALL_HALF_HEIGHT = 0; // a single row: one body at a time
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
    // Keep the whole corridor inside its own slice, minus a spacing margin at
    // both ends: two gorges that met on a slice boundary would read as one hole
    // twice the size, and the wall between them is the point.
    const room = Math.max(0, slice - 2 * halfHeight - 1 - PASS_SPACING);
    const y = Math.round(top + i * slice + PASS_SPACING / 2 + halfHeight + rng() * room);
    passes.push({ y, halfHeight, ramp: BIG_RAMP });
  }

  const smallCount = randInt(rng, SMALL_PASSES_MIN, SMALL_PASSES_MAX + 1);
  for (let i = 0; i < smallCount; i += 1) {
    // Cracks go wherever there is a gap; a draw that lands on top of an existing
    // pass is dropped rather than retried, so a crowded map simply gets fewer.
    const y = randInt(rng, top, top + span);
    const clear = passes.every((pass) => Math.abs(pass.y - y) > pass.halfHeight + SMALL_HALF_HEIGHT + PASS_SPACING);
    if (clear) {
      passes.push({ y, halfHeight: SMALL_HALF_HEIGHT, ramp: SMALL_RAMP });
    }
  }
  return passes;
}

// 0 where the wall stands whole, 1 where it is gone, smoothly in between.
function passOpenness(passes: readonly Pass[], y: number): number {
  let widest = 0;
  for (const pass of passes) {
    const t = (pass.halfHeight + pass.ramp - Math.abs(y - pass.y)) / pass.ramp;
    widest = Math.max(widest, Math.min(1, t));
  }
  // Smoothstepped, so the cliff eases into the gap instead of stepping down to it.
  return widest * widest * (3 - 2 * widest);
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

// Peace lands: grass by default, with the odd stony rise. Water is not in this
// field at all — see the lakes below.
const PEACE_SCALE = 15;
const PEACE_ROCK = 0.62;

// Every camp starts in the peace lands — the dead side is the place the map is
// about coming *from*, and a crew that begins on it has already lost the half of
// the game that is building something. The first and last camp keep this far from
// the north and south edges, so a starting crew has room to spread in every
// direction rather than half a box.
const CAMP_MARGIN = 8;

// Lakes are placed, not thresholded out of the biome field. A "water below -0.5"
// band scatters a dozen ponds of the same size all over the green half, and every
// one of them is a hole in the ground the player has to build around; a couple of
// real lakes take the same area out of the map while leaving it in one piece.
const LAKE_COUNT_MIN = 2;
const LAKE_COUNT_MAX = 3;
const LAKE_RADIUS_MIN = 7;
const LAKE_RADIUS_MAX = 11;
// Long axis vs short: a circle reads as a crater, not a lake.
const LAKE_STRETCH = 0.45;
// The rim is pushed around by a noise field, so the outline is a shoreline with
// bays rather than an ellipse. Beyond ±LAKE_WOBBLE of the radius nothing is wet,
// which is what keeps the shape one body of water instead of a spray of islands.
const LAKE_WOBBLE = 0.34;
const LAKE_SHAPE_SCALE = 9;
// Furthest the shoreline can get from the centre, as a multiple of the radius.
// Everything that keeps lakes apart measures with this, not with the radius.
const LAKE_REACH = 1 + LAKE_WOBBLE;
// Clearances, in tiles: between two lakes' rims, from the ridge apron, and around
// every spot the colony is promised — the origin and each player's camp.
const LAKE_GAP = 6;
const LAKE_SHORE = 3;
const LAKE_COLONY_CLEARANCE = 12;
const LAKE_ATTEMPTS = 200;

interface Lake {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

function deadTerrain(n: number): Terrain {
  return n > DEAD_MOUNTAIN ? Terrain.Mountain : Terrain.Rock;
}

function peaceTerrain(n: number): Terrain {
  return n > PEACE_ROCK ? Terrain.Rock : Terrain.Grass;
}

// Where the barren skirt of the ridge ends on a given row.
function ridgeEast(noise: (x: number, y: number) => number, grid: Grid, y: number): number {
  return ridgeCenter(noise, grid, y) + ridgeHalfWidth(noise, y) + APRON;
}

// The middle of the green half on a given row: the ridge wanders, so "halfway to
// the east edge" is a different tile on every row. Both the colony origin and the
// camps sit on this line — the widest part of the buildable side, so the first
// jobs are neither all uphill against the cliff nor pressed into the map's edge.
function peaceMiddle(noise: (x: number, y: number) => number, grid: Grid, y: number): number {
  return (ridgeEast(noise, grid, y) + grid.width - 1) / 2;
}

// Rejection sampling: a lake that lands on the ridge, on another lake or on the
// doorstep of anything the colony was promised (the origin, a camp) is redrawn,
// and a map with no room left simply gets fewer lakes rather than an overlapping
// pair fused into an inland sea.
function placeLakes(
  grid: Grid,
  rng: Rng,
  ridgeNoise: (x: number, y: number) => number,
  keepClear: readonly Position[],
): Lake[] {
  const lakes: Lake[] = [];
  const count = randInt(rng, LAKE_COUNT_MIN, LAKE_COUNT_MAX + 1);
  for (let i = 0; i < count; i += 1) {
    for (let attempt = 0; attempt < LAKE_ATTEMPTS; attempt += 1) {
      const radius = LAKE_RADIUS_MIN + rng() * (LAKE_RADIUS_MAX - LAKE_RADIUS_MIN);
      const stretch = 1 + rng() * LAKE_STRETCH;
      const flip = rng() < 0.5;
      const rx = flip ? radius * stretch : radius / stretch;
      const ry = flip ? radius / stretch : radius * stretch;
      // A shore may run off the map — that reads as a bay — but the centre stays
      // on it, or most of the lake is spent outside the world.
      const y = rng() * (grid.height - 1);
      const x = rng() * (grid.width - 1);
      const lake = { x, y, rx, ry };
      const reach = Math.max(rx, ry) * LAKE_REACH + LAKE_COLONY_CLEARANCE;
      if (keepClear.some((spot) => Math.hypot(x - spot.x, y - spot.y) < reach)) {
        continue;
      }
      if (lakes.some((other) => overlaps(lake, other))) {
        continue;
      }
      if (!clearOfRidge(lake, ridgeNoise, grid)) {
        continue;
      }
      lakes.push(lake);
      break;
    }
  }
  return lakes;
}

function overlaps(lake: Lake, other: Lake): boolean {
  const dx = Math.abs(lake.x - other.x) - (lake.rx + other.rx) * LAKE_REACH;
  const dy = Math.abs(lake.y - other.y) - (lake.ry + other.ry) * LAKE_REACH;
  return dx < LAKE_GAP && dy < LAKE_GAP;
}

// The ridge wanders, so it is asked about every row the lake covers rather than
// only the one its centre sits on.
function clearOfRidge(lake: Lake, ridgeNoise: (x: number, y: number) => number, grid: Grid): boolean {
  const west = lake.x - lake.rx * LAKE_REACH - LAKE_SHORE;
  const top = Math.max(0, Math.floor(lake.y - lake.ry * LAKE_REACH));
  const bottom = Math.min(grid.height - 1, Math.ceil(lake.y + lake.ry * LAKE_REACH));
  for (let y = top; y <= bottom; y += 1) {
    if (west < ridgeEast(ridgeNoise, grid, y)) {
      return false;
    }
  }
  return true;
}

function inLake(
  lakes: readonly Lake[],
  noise: (x: number, y: number) => number,
  x: number,
  y: number,
): boolean {
  for (const lake of lakes) {
    const dx = (x + 0.5 - lake.x) / lake.rx;
    const dy = (y + 0.5 - lake.y) / lake.ry;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance >= LAKE_REACH) {
      continue;
    }
    if (distance + noise(x / LAKE_SHAPE_SCALE, y / LAKE_SHAPE_SCALE) * LAKE_WOBBLE < 1) {
      return true;
    }
  }
  return false;
}

function generate(grid: Grid, rng: Rng, campCount: number): MapGenResult {
  // Four independent fields off the one rng: the ridge must be free to wander
  // without the biome either side of it — or a shoreline — following the same
  // wiggle.
  const ridgeNoise = createNoise2D(rng);
  const deadNoise = createNoise2D(rng);
  const peaceNoise = createNoise2D(rng);
  const lakeNoise = createNoise2D(rng);
  const passes = placePasses(grid, rng);

  // The colony starts in the peace lands, halfway between the ridge and the east
  // edge — far enough from the cliff that the first jobs are not all uphill. The
  // camps take the same line, spread north to south: first player at the top of
  // the green half, last at the bottom, with the whole width of the ridge between
  // each of them and the dead lands. All of it is chosen before the water is
  // placed rather than after: `nearestWalkable` can push a spot off a lake, but
  // only by walking it to the shore, and a camp on a shore has half the room a
  // camp needs.
  const midY = Math.floor(grid.height / 2);
  const colonyWish = { x: peaceMiddle(ridgeNoise, grid, midY), y: midY };
  const campWishes = campRows(grid, campCount, CAMP_MARGIN).map((y) => ({
    x: peaceMiddle(ridgeNoise, grid, y),
    y,
  }));
  const lakes = placeLakes(grid, rng, ridgeNoise, [colonyWish, ...campWishes]);

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
      } else if (inLake(lakes, lakeNoise, x, y)) {
        terrain = Terrain.Water;
      } else {
        terrain = peaceTerrain(peaceNoise(x / PEACE_SCALE, y / PEACE_SCALE));
      }
      const index = tileIndex(grid, x, y);
      grid.terrain[index] = terrain;
      // The ridge is the border, so the side of its centre line a tile fell on is
      // the whole rule — the apron and the floor of a pass belong to the land they
      // face, and nothing has to name the barren stone twice.
      grid.region[index] = x + 0.5 < center ? Region.Dead : Region.Peace;
    }
  }

  for (const pass of passes) {
    const center = ridgeCenter(ridgeNoise, grid, pass.y);
    const edge = ridgeHalfWidth(ridgeNoise, pass.y) + APRON;
    clearPassMouth(grid, pass.y, Math.round(center - edge), -1);
    clearPassMouth(grid, pass.y, Math.round(center + edge), 1);
  }

  return {
    colonyOrigin: nearestWalkable(grid, colonyWish),
    camps: campWishes.map((wish) => nearestWalkable(grid, wish)),
  };
}

const dividedLands: MapGenerator = {
  id: "divided-lands",
  label: "Divided lands",
  generate,
};

export { dividedLands };
