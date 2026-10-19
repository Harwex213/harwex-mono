import type { Size, View } from "../view/view";

// Pure border extraction: no DOM, no worker globals, so tests run it under Node.
// A border is a crossing: an edge between two pixels with different province ids.
// Decisions:
// - Crossings are kept as pixel-index lists, so a country change rescans ~215 k
//   crossings instead of 10.4 M pixels.
// - Segments sit on the shared grid line, so a border does not lean to one side.

type BorderRuns = {
  // [x, y0, y1] per run: the line between columns x and x + 1, rows y0..y1 inclusive.
  vertical: Int32Array;
  // [y, x0, x1] per run: the line between rows y and y + 1, columns x0..x1 inclusive.
  horizontal: Int32Array;
};

type BorderCrossings = {
  // Ascending pixel indices (y * width + x) whose right neighbour differs.
  // The worker keeps them and never posts them.
  vertical: Uint32Array;
  // Ascending pixel indices whose bottom neighbour differs.
  horizontal: Uint32Array;
};

type BorderScan = {
  width: number;
  height: number;
  runs: BorderRuns;
  crossings: BorderCrossings;
  // Pixels with at least one crossing. Only tests read this value.
  borderPixels: number;
};

type BorderTiles = {
  tileSize: number;
  cols: number;
  rows: number;
  // [x0, y0, x1, y1] per segment in map coordinates, grouped by tile.
  data: Float32Array;
  // Tile t owns data[offsets[t] .. offsets[t + 1]). Units are floats, not segments.
  offsets: Uint32Array;
};

type TileRange = { c0: number; c1: number; r0: number; r1: number };

const TILE_SIZE = 256;
// Unpainted pixels take part in the scan, so coastlines are borders and open sea is not.
const NO_PROVINCE = 0;

const INITIAL_CAPACITY = 1 << 16;

// Growable typed arrays for outputs of unknown length.
// `compact()` returns a slice that owns its whole buffer, so the result is transferable.
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

// Packed 0x00RRGGBB -> province id.
// Decisions:
// - A 24-bit lookup table (33.5 MB) replaces a per-pixel `Map` lookup, which cost 150-250 ms.
// - The table is local, so it is freed on return. Do not hoist it to module level.
// - `value > 0xffffff` catches UNPAINTED (0xffffffff). Masking first would map it onto white.
// - A colour missing from the palette reads 0, the same as unpainted.
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

// Decisions:
// - One row-major pass for cache locality. Vertical runs keep one open start per column.
// - The map edge is not a border. The overlay draws the map outline separately.
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

    // Close the run at row end, or it leaks into the next row.
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

// `countryOf` is indexed by province id. An id past its end reads as country 0.
function countryAt(countryOf: Uint16Array, provinceId: number): number {
  return provinceId < countryOf.length ? countryOf[provinceId] : 0;
}

// Country borders are a subset of province crossings, so this filters the
// retained crossings instead of rescanning the bitmap (~50x less work).
// Run order differs from `scanBorders`. Compare run sets, not arrays.
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

// Decisions:
// - Runs are split at tile edges, not duplicated, so there is no overdraw.
// - Integer math only. A line on a tile edge goes to the higher tile;
//   `visibleTiles` covers this with its margin.
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

// Counting sort into tiles. Integer endpoints below 2^24 are exact in float32.
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

// The one-tile margin keeps strokes that spill over a tile edge visible during a pan.
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

// Sized by the maximum province id, because ids are not contiguous.
// Slot 0 (NO_PROVINCE) stays 0, so coastlines never get a phantom country.
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
