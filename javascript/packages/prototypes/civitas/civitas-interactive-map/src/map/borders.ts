import type { Size, View } from "./view";

// Border extraction, pure. No DOM, no worker globals, no signals — every function
// here is a pure function of its arguments, so `borders.test.ts` runs the real
// code under Node. `.plan/T04/DESIGN.md` sections 3 and 4 are the spec.
//
// The brief's rule is "a pixel is a border pixel when its province id differs
// from the id of its right neighbour or its bottom neighbour". That rule defines
// a set of CROSSINGS — edges of the pixel grid, not marked pixels. This module
// emits the crossings twice over:
//
// - as pixel-index lists, retained by the worker so a country reassignment can be
//   recomputed from ~215 k crossings instead of 10.4 M pixels;
// - as collinear-merged RUNS turned into grid-line segments, which is what the
//   renderer strokes.
//
// A segment sits ON the shared grid line between the two provinces, not on the
// up-left pixel the literal rule marks. The crossing set is identical either way;
// only the geometry differs, and a line on the shared edge straddles both
// provinces equally instead of biasing one.

type BorderRuns = {
  // 3 int32 per run: [x, y0, y1]. The boundary between map columns x and x + 1,
  // covering pixel rows y0..y1 inclusive.
  vertical: Int32Array;
  // 3 int32 per run: [y, x0, x1]. The boundary between map rows y and y + 1,
  // covering pixel columns x0..x1 inclusive.
  horizontal: Int32Array;
};

type BorderCrossings = {
  // Pixel indices (y * width + x) of every pixel whose RIGHT neighbour differs,
  // ascending. Retained by the worker; never posted.
  vertical: Uint32Array;
  // Pixel indices of every pixel whose BOTTOM neighbour differs, ascending.
  horizontal: Uint32Array;
};

type BorderScan = {
  width: number;
  height: number;
  runs: BorderRuns;
  crossings: BorderCrossings;
  // Pixels with at least one crossing — the population of the equivalent
  // Uint8Array mask. Nothing draws from this; it is the number the tests pin.
  borderPixels: number;
};

type BorderTiles = {
  tileSize: number;
  cols: number;
  rows: number;
  // 4 float32 per segment: x0, y0, x1, y1, in MAP coordinates. Grouped by tile.
  data: Float32Array;
  // Length cols * rows + 1. Tile t owns data[offsets[t] .. offsets[t + 1]).
  // Offsets are in FLOATS, not segments, so a caller can slice directly.
  offsets: Uint32Array;
};

type TileRange = { c0: number; c1: number; r0: number; r1: number };

const TILE_SIZE = 256;
// Index 0 of every id array. It is a real participant in the scan: a painted
// pixel next to an unpainted one differs, so the coastline is a border. Two
// unpainted neighbours are equal, so the open sea produces nothing.
const NO_PROVINCE = 0;

const INITIAL_CAPACITY = 1 << 16;

// The four scan outputs have unknown length. A plain array of numbers would cost
// an object header per entry at 200 k entries; these grow a typed array by
// doubling and hand back a `.slice()`, which owns its whole buffer and is
// therefore transferable.
class Int32Builder {
  private data: Int32Array;
  private size: number;

  constructor(capacity: number) {
    this.data = new Int32Array(Math.max(4, capacity));
    this.size = 0;
  }

  push3(a: number, b: number, c: number): void {
    if (this.size + 3 > this.data.length) {
      let capacity = this.data.length;
      while (capacity < this.size + 3) {
        capacity *= 2;
      }
      const next = new Int32Array(capacity);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.size] = a;
    this.data[this.size + 1] = b;
    this.data[this.size + 2] = c;
    this.size += 3;
  }

  compact(): Int32Array {
    return this.data.slice(0, this.size);
  }
}

class Uint32Builder {
  private data: Uint32Array;
  private size: number;

  constructor(capacity: number) {
    this.data = new Uint32Array(Math.max(4, capacity));
    this.size = 0;
  }

  push(value: number): void {
    if (this.size + 1 > this.data.length) {
      const next = new Uint32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.size] = value;
    this.size += 1;
  }

  compact(): Uint32Array {
    return this.data.slice(0, this.size);
  }
}

// Packed 0x00RRGGBB -> province id, one indexed read per pixel.
//
// A `Map` lookup per pixel costs 150-250 ms on the real bitmap. Packed colours
// occupy 24 bits, so a `Uint16Array(1 << 24)` direct lookup table (33.5 MB,
// calloc'd, transient) replaces the hash with an array read. It MUST go out of
// scope when this returns; do not hoist it to module level.
//
// `p > 0xffffff` catches `UNPAINTED` (0xffffffff) without importing the constant.
// Masking with 0xffffff first would alias `UNPAINTED` onto the white province.
// An opaque colour absent from the palette reads `lut[p] === 0`, i.e.
// `NO_PROVINCE` — the same treatment as unpainted. The shipped asset has none.
function mapPixelsToIds(
  packed: Uint32Array,
  paletteColors: Uint32Array,
  paletteIds: Uint16Array,
): Uint16Array {
  const lut = new Uint16Array(1 << 24);
  const entries = Math.min(paletteColors.length, paletteIds.length);
  for (let k = 0; k < entries; k += 1) {
    lut[paletteColors[k] & 0xffffff] = paletteIds[k];
  }

  const out = new Uint16Array(packed.length);
  for (let i = 0; i < packed.length; i += 1) {
    const value = packed[i];
    out[i] = value > 0xffffff ? NO_PROVINCE : lut[value];
  }
  return out;
}

// One row-major pass over the whole bitmap. Vertical runs extend DOWN a column,
// which would be cache-hostile scanned column-major, so the pass carries one open
// run start per column and closes it the moment that column's crossing breaks.
// Horizontal runs extend along the row, so a single scalar suffices.
//
// The map edge is not a border: column `width - 1` has no right neighbour and row
// `height - 1` has no bottom neighbour, so neither emits a crossing. The overlay's
// bounds hairline already draws the map outline.
function scanBorders(ids: Uint16Array, width: number, height: number): BorderScan {
  const vRuns = new Int32Builder(INITIAL_CAPACITY);
  const hRuns = new Int32Builder(INITIAL_CAPACITY);
  const vCross = new Uint32Builder(INITIAL_CAPACITY);
  const hCross = new Uint32Builder(INITIAL_CAPACITY);

  const openV = new Int32Array(width).fill(-1);
  let openH = -1;
  let borderPixels = 0;

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    const hasDown = y + 1 < height;

    for (let x = 0; x < width; x += 1) {
      const i = row + x;
      const a = ids[i];
      let hit = false;

      if (x + 1 < width) {
        if (ids[i + 1] !== a) {
          vCross.push(i);
          hit = true;
          if (openV[x] < 0) {
            openV[x] = y;
          }
        } else if (openV[x] >= 0) {
          vRuns.push3(x, openV[x], y - 1);
          openV[x] = -1;
        }
      }

      if (hasDown && ids[i + width] !== a) {
        hCross.push(i);
        hit = true;
        if (openH < 0) {
          openH = x;
        }
      } else if (openH >= 0) {
        hRuns.push3(y, openH, x - 1);
        openH = -1;
      }

      if (hit) {
        borderPixels += 1;
      }
    }

    // Mandatory. Without it an open run leaks into the next row and produces a
    // segment that spans the whole map.
    if (openH >= 0) {
      hRuns.push3(y, openH, width - 1);
      openH = -1;
    }
  }

  for (let x = 0; x < width; x += 1) {
    if (openV[x] >= 0) {
      vRuns.push3(x, openV[x], height - 1);
      openV[x] = -1;
    }
  }

  return {
    width,
    height,
    runs: { vertical: vRuns.compact(), horizontal: hRuns.compact() },
    crossings: { vertical: vCross.compact(), horizontal: hCross.compact() },
    borderPixels,
  };
}

// `countryOf` is indexed by PROVINCE ID, not by array position. Ids run 1..1650
// for 1648 provinces, so a short or hole-ridden array must read as country 0
// rather than throw or wrap.
function countryAt(countryOf: Uint16Array, provinceId: number): number {
  return provinceId < countryOf.length ? countryOf[provinceId] : 0;
}

// The cheap recompute T06 needs. A country boundary can only exist where two
// different provinces meet, so it is always a subset of the province crossing
// set: walking the ~215 k retained crossings is roughly 50x less work than
// rescanning 10.4 M pixels.
//
// Both crossing lists are ascending by pixel index, so within a fixed column the
// vertical crossings arrive in increasing y and within a fixed row the horizontal
// ones arrive in increasing x. Runs are rebuilt by tracking the previous KEPT
// coordinate and starting a new run whenever it is not adjacent.
//
// Run ORDER differs from `scanBorders` — vertical runs flush per column at the
// end. Nothing depends on order; compare run sets, never arrays.
function countryRuns(
  ids: Uint16Array,
  width: number,
  crossings: BorderCrossings,
  countryOf: Uint16Array,
): BorderRuns {
  const vRuns = new Int32Builder(INITIAL_CAPACITY);
  const hRuns = new Int32Builder(INITIAL_CAPACITY);

  const start = new Int32Array(width).fill(-1);
  const last = new Int32Array(width).fill(-2);

  const vertical = crossings.vertical;
  for (let k = 0; k < vertical.length; k += 1) {
    const i = vertical[k];
    if (countryAt(countryOf, ids[i]) === countryAt(countryOf, ids[i + 1])) {
      continue;
    }
    const x = i % width;
    const y = (i / width) | 0;
    if (start[x] < 0 || last[x] !== y - 1) {
      if (start[x] >= 0) {
        vRuns.push3(x, start[x], last[x]);
      }
      start[x] = y;
    }
    last[x] = y;
  }
  for (let x = 0; x < width; x += 1) {
    if (start[x] >= 0) {
      vRuns.push3(x, start[x], last[x]);
    }
  }

  let openX = -1;
  let openY = -1;
  let lastX = -2;

  const horizontal = crossings.horizontal;
  for (let k = 0; k < horizontal.length; k += 1) {
    const i = horizontal[k];
    if (countryAt(countryOf, ids[i]) === countryAt(countryOf, ids[i + width])) {
      continue;
    }
    const x = i % width;
    const y = (i / width) | 0;
    if (openX < 0 || openY !== y || lastX !== x - 1) {
      if (openX >= 0) {
        hRuns.push3(openY, openX, lastX);
      }
      openX = x;
      openY = y;
    }
    lastX = x;
  }
  if (openX >= 0) {
    hRuns.push3(openY, openX, lastX);
  }

  return { vertical: vRuns.compact(), horizontal: hRuns.compact() };
}

function clampIndex(value: number, limit: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > limit) {
    return limit;
  }
  return value;
}

// Turns runs into grid-line segments and hands each one to `emit`, already
// clipped to the tile that owns it. Runs are SPLIT at tile boundaries, never
// duplicated, so culling is exact and there is no overdraw. Average run length on
// the real map is 1.63 pixels, so splits barely grow the segment count.
//
// All integer arithmetic — no epsilons. A line that lands exactly on a tile edge
// goes to the higher-index tile; `visibleTiles` compensates with its margin.
function eachTileSegment(
  runs: BorderRuns,
  cols: number,
  rows: number,
  tileSize: number,
  emit: (tile: number, x0: number, y0: number, x1: number, y1: number) => void,
): void {
  const vertical = runs.vertical;
  for (let i = 0; i < vertical.length; i += 3) {
    const lineX = vertical[i] + 1;
    const y0 = vertical[i + 1];
    const y1 = vertical[i + 2];
    const c = clampIndex(Math.floor(lineX / tileSize), cols - 1);
    const r0 = clampIndex(Math.floor(y0 / tileSize), rows - 1);
    const r1 = clampIndex(Math.floor(y1 / tileSize), rows - 1);
    for (let r = r0; r <= r1; r += 1) {
      const yA = Math.max(y0, r * tileSize);
      const yB = Math.min(y1 + 1, (r + 1) * tileSize);
      if (yB > yA) {
        emit(r * cols + c, lineX, yA, lineX, yB);
      }
    }
  }

  const horizontal = runs.horizontal;
  for (let i = 0; i < horizontal.length; i += 3) {
    const lineY = horizontal[i] + 1;
    const x0 = horizontal[i + 1];
    const x1 = horizontal[i + 2];
    const r = clampIndex(Math.floor(lineY / tileSize), rows - 1);
    const c0 = clampIndex(Math.floor(x0 / tileSize), cols - 1);
    const c1 = clampIndex(Math.floor(x1 / tileSize), cols - 1);
    for (let c = c0; c <= c1; c += 1) {
      const xA = Math.max(x0, c * tileSize);
      const xB = Math.min(x1 + 1, (c + 1) * tileSize);
      if (xB > xA) {
        emit(r * cols + c, xA, lineY, xB, lineY);
      }
    }
  }
}

// A counting sort into a tileSize-square grid. Two passes: count per tile, prefix
// sum, then fill. Endpoints are integers, and integers below 2^24 are exact in a
// Float32Array, so nothing is lost by storing them as floats.
function buildBorderTiles(
  runs: BorderRuns,
  width: number,
  height: number,
  tileSize: number = TILE_SIZE,
): BorderTiles {
  const size = Math.max(1, Math.floor(tileSize));
  const cols = Math.max(1, Math.ceil(width / size));
  const rows = Math.max(1, Math.ceil(height / size));
  const tiles = cols * rows;

  const counts = new Uint32Array(tiles);
  eachTileSegment(runs, cols, rows, size, (tile) => {
    counts[tile] += 1;
  });

  const offsets = new Uint32Array(tiles + 1);
  let acc = 0;
  for (let t = 0; t < tiles; t += 1) {
    offsets[t] = acc;
    acc += counts[t] * 4;
  }
  offsets[tiles] = acc;

  const data = new Float32Array(acc);
  const cursor = offsets.slice(0, tiles);
  eachTileSegment(runs, cols, rows, size, (tile, x0, y0, x1, y1) => {
    const at = cursor[tile];
    data[at] = x0;
    data[at + 1] = y0;
    data[at + 2] = x1;
    data[at + 3] = y1;
    cursor[tile] = at + 4;
  });

  return { tileSize: size, cols, rows, data, offsets };
}

// The `-1` / `+1` widening is not cosmetic. A stroke is centred on its line, so
// half its width spills into the neighbouring tile, and a line exactly on a tile
// edge belongs to the higher tile. Without the margin a border along the very
// edge of the viewport flickers in and out during a pan.
function visibleTiles(
  view: View,
  viewport: Size,
  tiles: { tileSize: number; cols: number; rows: number },
): TileRange | null {
  if (!Number.isFinite(view.scale) || view.scale <= 0) {
    return null;
  }
  if (!Number.isFinite(view.x) || !Number.isFinite(view.y)) {
    return null;
  }

  const size = tiles.tileSize;
  const left = -view.x / view.scale;
  const top = -view.y / view.scale;
  const right = (viewport.width - view.x) / view.scale;
  const bottom = (viewport.height - view.y) / view.scale;
  if (!Number.isFinite(right) || !Number.isFinite(bottom)) {
    return null;
  }

  const c0 = clampIndex(Math.floor(left / size) - 1, tiles.cols - 1);
  const c1 = clampIndex(Math.floor(right / size) + 1, tiles.cols - 1);
  const r0 = clampIndex(Math.floor(top / size) - 1, tiles.rows - 1);
  const r1 = clampIndex(Math.floor(bottom / size) + 1, tiles.rows - 1);
  if (c0 > c1 || r0 > r1) {
    return null;
  }
  return { c0, c1, r0, r1 };
}

// Sized by the MAXIMUM province id, not by the province count. Ids 1318 and 1458
// do not exist; their slots stay 0. Index 0 is `NO_PROVINCE` and is forced to 0,
// otherwise every coastline crossing would be classified by a phantom country.
function buildCountryOf(
  assignments: ReadonlyMap<number, number>,
  maxProvinceId: number,
): Uint16Array {
  const out = new Uint16Array(Math.max(1, maxProvinceId + 1));
  for (const [provinceId, countryId] of assignments) {
    if (provinceId >= 1 && provinceId <= maxProvinceId) {
      out[provinceId] = countryId;
    }
  }
  out[0] = 0;
  return out;
}

export {
  NO_PROVINCE,
  TILE_SIZE,
  buildBorderTiles,
  buildCountryOf,
  countryRuns,
  mapPixelsToIds,
  scanBorders,
  visibleTiles,
  type BorderCrossings,
  type BorderRuns,
  type BorderScan,
  type BorderTiles,
  type TileRange,
};
