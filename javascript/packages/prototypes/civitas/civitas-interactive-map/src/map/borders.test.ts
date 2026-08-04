import { inflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";
import {
  NO_PROVINCE,
  TILE_SIZE,
  buildBorderTiles,
  buildCountryOf,
  countryRuns,
  mapPixelsToIds,
  scanBorders,
  visibleTiles,
} from "./borders";
import { packPixels, packRgb } from "./province-index";
import { parseManifestText } from "./manifest";
import type { BorderRuns, BorderScan } from "./borders";

// Pure logic only, per PLAN section 4 — no DOM, no canvas, no signals.
//
// Every expected value on a synthetic fixture below is written out BY HAND. None
// of them is computed by a second implementation of the algorithm, because a
// second implementation would only prove the two agree with each other.
//
// The real-asset section at the bottom pins five counts measured against the
// shipped `provinces_map.png`. Those are the regression anchors: a subtly wrong
// merge or an off-by-one in the neighbour test still passes every hand fixture
// but moves those numbers.

const manifestPath = fileURLToPath(new URL("../../assets/provinces_manifest.json", import.meta.url));
const bitmapPath = fileURLToPath(new URL("../../assets/provinces_map.png", import.meta.url));

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

// ---------------------------------------------------------------------------
// Test-only PNG decoder. Deliberately a private copy of the one in
// `province-pixels.test.ts` rather than an import: that file is a test module,
// and importing it here would run its whole suite a second time. It uses
// `node:zlib` and nothing else, so no dependency is added.
// ---------------------------------------------------------------------------

type DecodedPng = { width: number; height: number; data: Uint8Array };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) {
    return a;
  }
  if (pb <= pc) {
    return b;
  }
  return c;
}

function decodePng(bytes: Uint8Array): DecodedPng {
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      throw new Error("not a PNG");
    }
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];

  let offset = 8;
  while (offset < bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7],
    );
    const body = offset + 8;

    if (type === "IHDR") {
      width = view.getUint32(body);
      height = view.getUint32(body + 4);
      if (bytes[body + 8] !== 8 || bytes[body + 9] !== 6 || bytes[body + 12] !== 0) {
        throw new Error("unsupported PNG");
      }
    }
    if (type === "IDAT") {
      idat.push(bytes.subarray(body, body + length));
    }
    if (type === "IEND") {
      break;
    }
    offset = body + length + 4;
  }

  const raw = new Uint8Array(inflateSync(Buffer.concat(idat)));
  const stride = width * 4;
  const out = new Uint8Array(width * height * 4);

  let read = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[read];
    read += 1;
    const rowStart = y * stride;
    const priorStart = rowStart - stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[read + x];
      const left = x >= 4 ? out[rowStart + x - 4] : 0;
      const up = y > 0 ? out[priorStart + x] : 0;
      const upLeft = x >= 4 && y > 0 ? out[priorStart + x - 4] : 0;
      let restored = value;
      if (filter === 1) {
        restored = value + left;
      } else if (filter === 2) {
        restored = value + up;
      } else if (filter === 3) {
        restored = value + ((left + up) >> 1);
      } else if (filter === 4) {
        restored = value + paeth(left, up, upLeft);
      } else if (filter !== 0) {
        throw new Error("unknown PNG row filter " + filter);
      }
      out[rowStart + x] = restored & 0xff;
    }
    read += stride;
  }

  return { width, height, data: out };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ids(rows: number[][]): { ids: Uint16Array; width: number; height: number } {
  const height = rows.length;
  const width = rows[0].length;
  const out = new Uint16Array(width * height);
  for (let y = 0; y < height; y += 1) {
    assert.equal(rows[y].length, width, "fixture row " + y + " has the wrong length");
    for (let x = 0; x < width; x += 1) {
      out[y * width + x] = rows[y][x];
    }
  }
  return { ids: out, width, height };
}

function triples(runs: Int32Array): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < runs.length; i += 3) {
    out.push([runs[i], runs[i + 1], runs[i + 2]]);
  }
  return out;
}

// Run order is not part of the contract — `countryRuns` flushes vertical runs per
// column at the end, `scanBorders` flushes them inline — so every comparison
// here is on the SET.
function sortedTriples(runs: Int32Array): number[][] {
  return triples(runs).sort((a, b) => {
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  });
}

function identityCountryOf(maxId: number): Uint16Array {
  const out = new Uint16Array(maxId + 1);
  for (let id = 1; id <= maxId; id += 1) {
    out[id] = id;
  }
  out[0] = 0;
  return out;
}

// A merge bug shows up here even when the run set still looks plausible: the
// total pixel length of the runs must equal the crossing count exactly.
function assertRunsCoverCrossings(scan: BorderScan): void {
  let vertical = 0;
  for (const run of triples(scan.runs.vertical)) {
    assert.ok(run[2] >= run[1], "a vertical run must not be empty");
    vertical += run[2] - run[1] + 1;
  }
  assert.equal(vertical, scan.crossings.vertical.length, "vertical runs cover every crossing once");

  let horizontal = 0;
  for (const run of triples(scan.runs.horizontal)) {
    assert.ok(run[2] >= run[1], "a horizontal run must not be empty");
    horizontal += run[2] - run[1] + 1;
  }
  assert.equal(
    horizontal,
    scan.crossings.horizontal.length,
    "horizontal runs cover every crossing once",
  );
}

function assertAscending(list: Uint32Array, label: string): void {
  for (let i = 1; i < list.length; i += 1) {
    assert.ok(list[i] > list[i - 1], label + " must be strictly ascending at " + i);
  }
}

function scanOf(rows: number[][]): BorderScan {
  const fixture = ids(rows);
  const scan = scanBorders(fixture.ids, fixture.width, fixture.height);
  assertRunsCoverCrossings(scan);
  assertAscending(scan.crossings.vertical, "vertical crossings");
  assertAscending(scan.crossings.horizontal, "horizontal crossings");
  return scan;
}

// ---------------------------------------------------------------------------
// mapPixelsToIds
// ---------------------------------------------------------------------------

test("mapPixelsToIds resolves palette colours and maps everything else to 0", () => {
  // 0x000000 is a LEGAL province colour. It is in this fixture because the whole
  // reason `province-index.ts` uses 0xffffffff as its unpainted sentinel rather
  // than 0 is that a black province must stay addressable.
  const palette = [
    [0x98d7ab, 1],
    [0x000000, 7],
    [0xffffff, 1650],
  ];
  const colors = new Uint32Array(palette.map((entry) => entry[0]));
  const paletteIds = new Uint16Array(palette.map((entry) => entry[1]));

  const packed = new Uint32Array([0x98d7ab, 0x000000, 0xffffff, 0xffffffff, 0x123456]);
  const result = mapPixelsToIds(packed, colors, paletteIds);

  assert.deepEqual(Array.from(result), [1, 7, 1650, 0, 0]);
});

test("mapPixelsToIds does not alias UNPAINTED onto the white province", () => {
  // Masking with 0xffffff BEFORE the sentinel test would turn 0xffffffff into
  // 0xffffff and report the white province for every unpainted pixel.
  const colors = new Uint32Array([0xffffff]);
  const paletteIds = new Uint16Array([1650]);
  const result = mapPixelsToIds(new Uint32Array([0xffffffff]), colors, paletteIds);

  assert.equal(result[0], 0);
});

test("mapPixelsToIds stops at the shorter of the two palette arrays", () => {
  // The worker flattens `colorIndex` into two parallel buffers and TRANSFERS them
  // as separate messages fields. A truncated pair must under-resolve rather than
  // walk off the end of either one.
  const colors = new Uint32Array([0x112233, 0x445566]);
  const paletteIds = new Uint16Array([5]);
  assert.deepEqual(
    Array.from(mapPixelsToIds(new Uint32Array([0x112233, 0x445566]), colors, paletteIds)),
    [5, 0],
  );

  // The dangerous direction. Reading past the end of `paletteColors` yields
  // `undefined`, and `undefined & 0xffffff` is 0 — so an over-long id list would
  // write a phantom entry at LUT slot 0 and hand every black pixel that id.
  // 0x000000 is a legal province colour, so this is not hypothetical.
  const shortColors = new Uint32Array([0x112233]);
  const longIds = new Uint16Array([5, 77]);
  assert.deepEqual(
    Array.from(mapPixelsToIds(new Uint32Array([0x112233, 0x000000]), shortColors, longIds)),
    [5, 0],
  );
});

test("the exported constants are the values the worker and the tiler assume", () => {
  // `NO_PROVINCE` being 0 is what lets an unresolved colour fall out of the LUT
  // as "no province" with no extra branch, and `buildCountryOf` zeroes slot 0 on
  // the strength of it. `TILE_SIZE` is the tiling default the store never passes.
  assert.equal(NO_PROVINCE, 0);
  assert.equal(TILE_SIZE, 256);

  const omitted = buildBorderTiles(
    { vertical: new Int32Array(0), horizontal: new Int32Array(0) },
    3653,
    2855,
  );
  assert.equal(omitted.tileSize, TILE_SIZE);
  assert.equal(omitted.cols, Math.ceil(3653 / TILE_SIZE));
  assert.equal(omitted.rows, Math.ceil(2855 / TILE_SIZE));
});

// ---------------------------------------------------------------------------
// scanBorders
// ---------------------------------------------------------------------------

test("a bitmap with no neighbour to compare against produces nothing", () => {
  for (const rows of [[[5]], [[5, 5]], [[5], [5]]]) {
    const scan = scanOf(rows);
    assert.equal(scan.borderPixels, 0);
    assert.equal(scan.crossings.vertical.length, 0);
    assert.equal(scan.crossings.horizontal.length, 0);
    assert.equal(scan.runs.vertical.length, 0);
    assert.equal(scan.runs.horizontal.length, 0);
  }
});

test("a 3x3 split down the middle gives exactly one vertical run", () => {
  const scan = scanOf([
    [1, 1, 2],
    [1, 1, 2],
    [1, 1, 2],
  ]);

  assert.deepEqual(sortedTriples(scan.runs.vertical), [[1, 0, 2]]);
  assert.deepEqual(sortedTriples(scan.runs.horizontal), []);
  assert.deepEqual(Array.from(scan.crossings.vertical), [1, 4, 7]);
  assert.equal(scan.borderPixels, 3);
});

test("the transpose of that fixture gives exactly one horizontal run", () => {
  const scan = scanOf([
    [1, 1, 1],
    [1, 1, 1],
    [2, 2, 2],
  ]);

  assert.deepEqual(sortedTriples(scan.runs.horizontal), [[1, 0, 2]]);
  assert.deepEqual(sortedTriples(scan.runs.vertical), []);
  assert.deepEqual(Array.from(scan.crossings.horizontal), [3, 4, 5]);
  assert.equal(scan.borderPixels, 3);
});

test("a single odd pixel at the centre of a 5x5 is bordered on all four sides", () => {
  const scan = scanOf([
    [7, 7, 7, 7, 7],
    [7, 7, 7, 7, 7],
    [7, 7, 9, 7, 7],
    [7, 7, 7, 7, 7],
    [7, 7, 7, 7, 7],
  ]);

  // (1,2,2) is the boundary left of the odd pixel, (2,2,2) the one right of it.
  assert.deepEqual(sortedTriples(scan.runs.vertical), [
    [1, 2, 2],
    [2, 2, 2],
  ]);
  assert.deepEqual(sortedTriples(scan.runs.horizontal), [
    [1, 2, 2],
    [2, 2, 2],
  ]);
  // There are four crossings but only THREE border pixels: (1,2) sees a
  // difference to its right, (2,1) sees one below, and (2,2) sees both — it is
  // counted once. `borderPixels` is the population of the equivalent mask, not
  // the crossing count, which is why the real-asset pin (180 869) is smaller than
  // the sum of the two crossing lists (215 177).
  assert.equal(scan.borderPixels, 3);
});

test("a 4x4 checkerboard borders on every interior edge and merges each into one run", () => {
  const scan = scanOf([
    [1, 2, 1, 2],
    [2, 1, 2, 1],
    [1, 2, 1, 2],
    [2, 1, 2, 1],
  ]);

  // 3 interior columns x 4 rows and 3 interior rows x 4 columns.
  assert.equal(scan.crossings.vertical.length, 12);
  assert.equal(scan.crossings.horizontal.length, 12);
  // Every interior boundary of a checkerboard is UNBROKEN along its own axis, so
  // 12 crossings merge into 3 full-length runs each way. Twelve one-pixel runs
  // would mean the collinear merge never fired.
  assert.deepEqual(sortedTriples(scan.runs.vertical), [
    [0, 0, 3],
    [1, 0, 3],
    [2, 0, 3],
  ]);
  assert.deepEqual(sortedTriples(scan.runs.horizontal), [
    [0, 0, 3],
    [1, 0, 3],
    [2, 0, 3],
  ]);
  // 15, not 16: the bottom-right pixel has neither a right nor a bottom
  // neighbour, so it carries no crossing however different it is.
  assert.equal(scan.borderPixels, 15);
});

test("a boundary broken in the middle of a column produces two runs, not one", () => {
  // The case that fails when `openV` is never closed on a matching pixel.
  const scan = scanOf([
    [1, 2],
    [1, 2],
    [1, 1],
    [1, 1],
    [1, 2],
    [1, 2],
  ]);

  assert.deepEqual(sortedTriples(scan.runs.vertical), [
    [0, 0, 1],
    [0, 4, 5],
  ]);
});

test("the map edge is never a border", () => {
  // Column width-1 has no right neighbour and row height-1 has no bottom
  // neighbour, so neither can emit a crossing however different they are.
  const scan = scanOf([
    [1, 1, 1],
    [1, 1, 1],
  ]);
  assert.equal(scan.borderPixels, 0);

  const other = scanOf([
    [1, 1, 2],
    [3, 3, 4],
  ]);
  for (const run of triples(other.runs.vertical)) {
    assert.ok(run[0] < 2, "no vertical run may sit on the last column, got x=" + run[0]);
  }
  for (const run of triples(other.runs.horizontal)) {
    assert.ok(run[0] < 1, "no horizontal run may sit on the last row, got y=" + run[0]);
  }
});

test("NO_PROVINCE participates: land against sea is a border, sea against sea is not", () => {
  const scan = scanOf([
    [0, 0, 5],
    [0, 0, 5],
  ]);

  assert.deepEqual(sortedTriples(scan.runs.vertical), [[1, 0, 1]]);
  assert.deepEqual(sortedTriples(scan.runs.horizontal), []);
  assert.equal(scan.borderPixels, 2);
});

test("a one-pixel-wide bitmap produces horizontal runs and never touches openV", () => {
  // width 1 means `x + 1 < width` is false on every pixel, so the vertical branch
  // never runs at all — including its `else if (openV[x] >= 0)` close. The
  // end-of-scan flush must therefore find nothing to emit.
  const scan = scanOf([[1], [2], [3]]);

  assert.deepEqual(sortedTriples(scan.runs.horizontal), [
    [0, 0, 0],
    [1, 0, 0],
  ]);
  assert.deepEqual(sortedTriples(scan.runs.vertical), []);
  assert.deepEqual(Array.from(scan.crossings.horizontal), [0, 1]);
  assert.equal(scan.borderPixels, 2);
});

test("a one-pixel-tall bitmap produces vertical runs closed by the end-of-scan flush", () => {
  // The transpose: `hasDown` is false everywhere, and every vertical run is still
  // open when the row loop ends. Only the final per-column flush emits them.
  const scan = scanOf([[1, 2, 3]]);

  assert.deepEqual(sortedTriples(scan.runs.vertical), [
    [0, 0, 0],
    [1, 0, 0],
  ]);
  assert.deepEqual(sortedTriples(scan.runs.horizontal), []);
  assert.deepEqual(Array.from(scan.crossings.vertical), [0, 1]);
  assert.equal(scan.borderPixels, 2);
});

test("an open horizontal run does not leak across a row boundary", () => {
  // Two separate one-pixel horizontal boundaries, one per row, at different
  // columns. Without the end-of-row flush the first would swallow the second and
  // produce a run spanning the whole map width.
  const scan = scanOf([
    [1, 1, 1, 1],
    [2, 1, 1, 1],
    [1, 1, 1, 3],
    [1, 1, 1, 1],
  ]);

  assert.deepEqual(sortedTriples(scan.runs.horizontal), [
    [0, 0, 0],
    [1, 0, 0],
    [1, 3, 3],
    [2, 3, 3],
  ]);
  for (const run of triples(scan.runs.horizontal)) {
    assert.equal(run[1], run[2], "each horizontal run covers exactly one column");
  }
});

// ---------------------------------------------------------------------------
// countryRuns
// ---------------------------------------------------------------------------

const IDENTITY_FIXTURES: number[][][] = [
  [
    [1, 1, 2],
    [1, 3, 2],
    [4, 3, 2],
  ],
  [
    [1, 2, 1, 2],
    [2, 1, 2, 1],
    [1, 2, 1, 2],
    [2, 1, 2, 1],
  ],
  [
    [0, 0, 5, 5],
    [0, 5, 5, 0],
    [6, 6, 0, 0],
    [6, 6, 6, 0],
  ],
];

test("the identity assignment reproduces the province run set exactly", () => {
  // The strongest single property in this file: it drives the whole recompute
  // path against the whole scan path.
  for (const rows of IDENTITY_FIXTURES) {
    const fixture = ids(rows);
    const scan = scanBorders(fixture.ids, fixture.width, fixture.height);
    const rebuilt = countryRuns(fixture.ids, fixture.width, scan.crossings, identityCountryOf(10));

    assert.deepEqual(sortedTriples(rebuilt.vertical), sortedTriples(scan.runs.vertical));
    assert.deepEqual(sortedTriples(rebuilt.horizontal), sortedTriples(scan.runs.horizontal));
  }
});

test("merging two neighbours into one country drops exactly their shared boundary", () => {
  const fixture = ids([
    [1, 2, 3],
    [1, 2, 3],
    [1, 2, 3],
  ]);
  const scan = scanBorders(fixture.ids, fixture.width, fixture.height);
  assert.deepEqual(sortedTriples(scan.runs.vertical), [
    [0, 0, 2],
    [1, 0, 2],
  ]);

  // Provinces 1 and 2 become country 1; province 3 stays on its own.
  const countryOf = new Uint16Array([0, 1, 1, 2]);
  const rebuilt = countryRuns(fixture.ids, fixture.width, scan.crossings, countryOf);

  assert.deepEqual(sortedTriples(rebuilt.vertical), [[1, 0, 2]]);
  assert.deepEqual(sortedTriples(rebuilt.horizontal), []);
});

test("one country over everything leaves only the coastline", () => {
  const fixture = ids([
    [0, 1, 2, 0],
    [0, 1, 2, 0],
  ]);
  const scan = scanBorders(fixture.ids, fixture.width, fixture.height);
  const countryOf = new Uint16Array([0, 4, 4]);
  const rebuilt = countryRuns(fixture.ids, fixture.width, scan.crossings, countryOf);

  // The 1|2 seam disappears; the two seams against the unpainted columns stay.
  assert.deepEqual(sortedTriples(rebuilt.vertical), [
    [0, 0, 1],
    [2, 0, 1],
  ]);
  assert.deepEqual(sortedTriples(rebuilt.horizontal), []);
});

test("one country over a fully painted bitmap leaves no runs at all", () => {
  const fixture = ids([
    [1, 2, 3],
    [4, 5, 6],
  ]);
  const scan = scanBorders(fixture.ids, fixture.width, fixture.height);
  assert.ok(scan.runs.vertical.length > 0, "the province scan must find something first");

  const countryOf = new Uint16Array([0, 9, 9, 9, 9, 9, 9]);
  const rebuilt = countryRuns(fixture.ids, fixture.width, scan.crossings, countryOf);

  assert.equal(rebuilt.vertical.length, 0);
  assert.equal(rebuilt.horizontal.length, 0);
});

test("a country change splitting a long boundary in the middle gives two runs", () => {
  const fixture = ids([
    [1, 2],
    [1, 2],
    [3, 4],
    [3, 4],
    [1, 2],
    [1, 2],
  ]);
  const scan = scanBorders(fixture.ids, fixture.width, fixture.height);
  assert.deepEqual(sortedTriples(scan.runs.vertical), [[0, 0, 5]], "one unbroken province seam");

  // 3 and 4 land in the same country, so their shared edge vanishes and the
  // single run breaks in two.
  const countryOf = new Uint16Array([0, 1, 2, 3, 3]);
  const rebuilt = countryRuns(fixture.ids, fixture.width, scan.crossings, countryOf);

  assert.deepEqual(sortedTriples(rebuilt.vertical), [
    [0, 0, 1],
    [0, 4, 5],
  ]);
});

test("a country boundary does not merge across a row boundary", () => {
  // The horizontal analogue of `scanBorders`'s end-of-row flush, and the one case
  // the identity property does NOT catch. Crossings arrive in row-major order, so
  // the last kept column of row 0 is column 2 and the first kept column of row 1
  // is column 3 — adjacent by the `lastX !== x - 1` test alone. Only the
  // `openY !== y` guard keeps them apart. Drop it and both collapse into a single
  // run (0, 2, 3) that draws a segment across a row it does not belong to.
  const fixture = ids([
    [1, 1, 2, 1, 1],
    [1, 1, 3, 1, 1],
    [1, 1, 3, 4, 1],
  ]);
  const scan = scanBorders(fixture.ids, fixture.width, fixture.height);
  assert.deepEqual(
    sortedTriples(scan.runs.horizontal),
    [
      [0, 2, 2],
      [1, 3, 3],
    ],
    "the province scan itself must keep them apart",
  );

  const rebuilt = countryRuns(fixture.ids, fixture.width, scan.crossings, identityCountryOf(10));
  assert.deepEqual(sortedTriples(rebuilt.horizontal), [
    [0, 2, 2],
    [1, 3, 3],
  ]);
});

test("a country change splitting a horizontal boundary gives two runs", () => {
  // The vertical split case is covered above; this is its horizontal twin, and it
  // is the only test that exercises the `lastX !== x - 1` adjacency test on the
  // horizontal path with a real gap in the middle of one row.
  const fixture = ids([
    [1, 2, 3, 4],
    [5, 6, 7, 8],
  ]);
  const scan = scanBorders(fixture.ids, fixture.width, fixture.height);
  assert.deepEqual(sortedTriples(scan.runs.horizontal), [[0, 0, 3]], "one unbroken province seam");

  // Provinces 2 and 6 share country 9; every other province keeps its own.
  const countryOf = new Uint16Array([0, 1, 9, 3, 4, 5, 9, 7, 8]);
  const rebuilt = countryRuns(fixture.ids, fixture.width, scan.crossings, countryOf);

  assert.deepEqual(sortedTriples(rebuilt.horizontal), [
    [0, 0, 0],
    [0, 2, 3],
  ]);
});

test("an empty countryOf puts every province in country 0 and emits nothing", () => {
  // `setCountryAssignment(null)` clears the paths on the main thread, but a
  // zero-length buffer must not read past its end or throw either.
  const fixture = ids([
    [1, 2],
    [3, 4],
  ]);
  const scan = scanBorders(fixture.ids, fixture.width, fixture.height);
  assert.ok(scan.crossings.vertical.length > 0, "the province scan must find something first");

  const rebuilt = countryRuns(fixture.ids, fixture.width, scan.crossings, new Uint16Array(0));
  assert.equal(rebuilt.vertical.length, 0);
  assert.equal(rebuilt.horizontal.length, 0);
});

test("a countryOf shorter than the ids present reads the missing ones as country 0", () => {
  const fixture = ids([
    [1, 900],
    [1, 900],
  ]);
  const scan = scanBorders(fixture.ids, fixture.width, fixture.height);

  // Province 900 is past the end of the array. Province 1 is country 0 too, so
  // both sides agree and the boundary disappears rather than throwing.
  const countryOf = new Uint16Array([0, 0]);
  const rebuilt = countryRuns(fixture.ids, fixture.width, scan.crossings, countryOf);
  assert.equal(rebuilt.vertical.length, 0);

  const assigned = new Uint16Array([0, 5]);
  const other = countryRuns(fixture.ids, fixture.width, scan.crossings, assigned);
  assert.deepEqual(sortedTriples(other.vertical), [[0, 0, 1]]);
});

test("a non-zero countryOf[0] classifies unpainted pixels, which is why the worker zeroes it", () => {
  // Documented behaviour, asserted rather than assumed: `countryRuns` reads slot
  // 0 like any other, so an unpainted pixel would join a real country and the
  // coastline would vanish. `borders.worker.ts` forces `countryOf[0] = 0` on
  // receipt for exactly this reason.
  const fixture = ids([
    [0, 1],
    [0, 1],
  ]);
  const scan = scanBorders(fixture.ids, fixture.width, fixture.height);

  const poisoned = new Uint16Array([3, 3]);
  assert.equal(countryRuns(fixture.ids, fixture.width, scan.crossings, poisoned).vertical.length, 0);

  const corrected = new Uint16Array([0, 3]);
  assert.deepEqual(
    sortedTriples(countryRuns(fixture.ids, fixture.width, scan.crossings, corrected).vertical),
    [[0, 0, 1]],
  );
});

// ---------------------------------------------------------------------------
// buildBorderTiles / visibleTiles
// ---------------------------------------------------------------------------

function segments(tiles: { data: Float32Array }): number[][] {
  const out: number[][] = [];
  for (let at = 0; at < tiles.data.length; at += 4) {
    out.push([tiles.data[at], tiles.data[at + 1], tiles.data[at + 2], tiles.data[at + 3]]);
  }
  return out;
}

function runLength(runs: BorderRuns): number {
  let total = 0;
  for (const run of triples(runs.vertical)) {
    total += run[2] - run[1] + 1;
  }
  for (const run of triples(runs.horizontal)) {
    total += run[2] - run[1] + 1;
  }
  return total;
}

test("the offset table is a valid prefix sum over the tile grid", () => {
  const fixture = ids([
    [1, 2, 1, 2, 1, 2],
    [2, 1, 2, 1, 2, 1],
    [1, 2, 1, 2, 1, 2],
    [2, 1, 2, 1, 2, 1],
  ]);
  const scan = scanBorders(fixture.ids, fixture.width, fixture.height);
  const tiles = buildBorderTiles(scan.runs, fixture.width, fixture.height, 2);

  assert.equal(tiles.cols, 3);
  assert.equal(tiles.rows, 2);
  assert.equal(tiles.offsets.length, tiles.cols * tiles.rows + 1);
  for (let t = 1; t < tiles.offsets.length; t += 1) {
    assert.ok(tiles.offsets[t] >= tiles.offsets[t - 1], "offsets must be non-decreasing");
  }
  assert.equal(tiles.offsets[tiles.offsets.length - 1], tiles.data.length);
});

test("every segment lies inside the map rectangle of the tile that owns it", () => {
  const fixture = ids([
    [1, 2, 3, 4, 5],
    [6, 7, 8, 9, 1],
    [2, 3, 4, 5, 6],
    [7, 8, 9, 1, 2],
    [3, 4, 5, 6, 7],
  ]);
  const scan = scanBorders(fixture.ids, fixture.width, fixture.height);
  const size = 2;
  const tiles = buildBorderTiles(scan.runs, fixture.width, fixture.height, size);

  for (let r = 0; r < tiles.rows; r += 1) {
    for (let c = 0; c < tiles.cols; c += 1) {
      const t = r * tiles.cols + c;
      for (let at = tiles.offsets[t]; at < tiles.offsets[t + 1]; at += 4) {
        const x0 = tiles.data[at];
        const y0 = tiles.data[at + 1];
        const x1 = tiles.data[at + 2];
        const y1 = tiles.data[at + 3];
        // A boundary line sits on a tile EDGE, so the inclusive bound is
        // (c + 1) * size on the axis the line runs across.
        assert.ok(x0 >= c * size && x1 <= (c + 1) * size, "tile " + t + " x range");
        assert.ok(y0 >= r * size && y1 <= (r + 1) * size, "tile " + t + " y range");
      }
    }
  }
});

test("splitting at a tile boundary preserves total segment length", () => {
  const fixture = ids([
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
    [1, 2],
  ]);
  const scan = scanBorders(fixture.ids, fixture.width, fixture.height);
  assert.deepEqual(sortedTriples(scan.runs.vertical), [[0, 0, 5]]);

  const tiles = buildBorderTiles(scan.runs, fixture.width, fixture.height, 2);
  const drawn = segments(tiles);
  let total = 0;
  for (const segment of drawn) {
    total += Math.abs(segment[2] - segment[0]) + Math.abs(segment[3] - segment[1]);
  }

  assert.equal(drawn.length, 3, "one run split across three tile rows");
  assert.equal(total, runLength(scan.runs), "no length is lost or duplicated");
  // Reassembled, the three pieces are the original 0..6 line at x = 1.
  assert.deepEqual(drawn.sort((a, b) => a[1] - b[1]), [
    [1, 0, 1, 2],
    [1, 2, 1, 4],
    [1, 4, 1, 6],
  ]);
});

test("a run spanning exactly one tile boundary produces exactly two segments", () => {
  const runs: BorderRuns = { vertical: new Int32Array([0, 1, 2]), horizontal: new Int32Array(0) };
  const tiles = buildBorderTiles(runs, 4, 4, 2);
  const drawn = segments(tiles).sort((a, b) => a[1] - b[1]);

  assert.deepEqual(drawn, [
    [1, 1, 1, 2],
    [1, 2, 1, 3],
  ]);
});

test("a boundary line exactly on a tile edge belongs to the higher tile", () => {
  // DESIGN 4.4. The run covers pixel rows 0..1, but its LINE is at y = 2, which is
  // the boundary between tile row 0 and tile row 1. It goes to row 1. This is the
  // rule `visibleTiles`'s -1 margin exists to compensate for, so if the assignment
  // ever flips to the lower tile the margin compensates in the wrong direction.
  const runs: BorderRuns = { vertical: new Int32Array(0), horizontal: new Int32Array([1, 0, 1]) };
  const tiles = buildBorderTiles(runs, 4, 4, 2);

  assert.equal(tiles.cols, 2);
  assert.equal(tiles.rows, 2);
  assert.deepEqual(segments(tiles), [[0, 2, 2, 2]]);
  // Tiles 0 and 1 are the top row and hold nothing; tile 2 is row 1, column 0.
  assert.deepEqual(Array.from(tiles.offsets), [0, 0, 0, 4, 4]);
});

test("a line on the far map edge is clamped into the last tile instead of past it", () => {
  // A vertical run on the last column has its line at x = width, one past the last
  // tile column. Without the clamp the tile index becomes r * cols + cols, which
  // is a VALID index for another row's tile — the segment would silently land in
  // the wrong tile and be culled at the wrong time rather than crash.
  const runs: BorderRuns = { vertical: new Int32Array([3, 0, 0]), horizontal: new Int32Array(0) };
  const tiles = buildBorderTiles(runs, 4, 4, 2);

  assert.deepEqual(segments(tiles), [[4, 0, 4, 1]]);
  assert.deepEqual(Array.from(tiles.offsets), [0, 0, 4, 4, 4]);
});

test("buildBorderTiles clamps a degenerate tile size to one pixel", () => {
  // `tileSize` crosses the worker boundary as a plain number. A 0 would make
  // `ceil(width / size)` Infinity and `new Uint32Array(Infinity)` throw, taking
  // the whole scan down with it.
  const runs: BorderRuns = { vertical: new Int32Array([0, 0, 0]), horizontal: new Int32Array(0) };

  for (const size of [0, -8, 0.5]) {
    const tiles = buildBorderTiles(runs, 4, 3, size);
    assert.equal(tiles.tileSize, 1, "tile size " + size + " must clamp to 1");
    assert.equal(tiles.cols, 4);
    assert.equal(tiles.rows, 3);
    assert.equal(tiles.offsets.length, 13);
    assert.deepEqual(segments(tiles), [[1, 0, 1, 1]]);
  }

  // A fractional size above 1 floors rather than clamping.
  assert.equal(buildBorderTiles(runs, 4, 3, 2.7).tileSize, 2);
});

test("an empty run set still yields a valid tile structure", () => {
  const tiles = buildBorderTiles(
    { vertical: new Int32Array(0), horizontal: new Int32Array(0) },
    10,
    6,
    4,
  );

  assert.equal(tiles.data.length, 0);
  assert.equal(tiles.offsets.length, tiles.cols * tiles.rows + 1);
  for (const value of tiles.offsets) {
    assert.equal(value, 0);
  }
});

test("visibleTiles covers the whole grid when the whole map is on screen", () => {
  const tiles = { tileSize: 256, cols: 15, rows: 12 };
  const range = visibleTiles({ scale: 0.317, x: 0, y: 0 }, { width: 1200, height: 900 }, tiles);

  assert.ok(range);
  assert.deepEqual(range, { c0: 0, c1: 14, r0: 0, r1: 11 });
});

test("visibleTiles keeps a one-tile margin on every side", () => {
  // The margin is load-bearing: a stroke is centred on its line so half its width
  // spills into the neighbouring tile, and a line exactly on a tile edge is owned
  // by the HIGHER tile. Without the margin a border along the viewport edge
  // flickers in and out during a pan.
  const tiles = { tileSize: 100, cols: 20, rows: 20 };
  // The viewport's left edge sits exactly on the boundary between tiles 4 and 5.
  const range = visibleTiles({ scale: 1, x: -500, y: -500 }, { width: 100, height: 100 }, tiles);

  assert.ok(range);
  assert.equal(range.c0, 4, "the tile to the left is still included");
  assert.equal(range.r0, 4);
  assert.equal(range.c1, 7, "and one past the right edge");
  assert.equal(range.r1, 7);
});

test("visibleTiles clamps a viewport that is entirely off the map", () => {
  // The pan clamp keeps this from happening in the app, but `drawBorders` indexes
  // `paths[r * cols + c]` straight off the returned range. An unclamped index
  // would hand `ctx.stroke` an undefined Path2D and throw inside the draw loop.
  const tiles = { tileSize: 100, cols: 5, rows: 5 };
  const viewportSize = { width: 800, height: 600 };

  const past = visibleTiles({ scale: 1, x: -10000, y: -10000 }, viewportSize, tiles);
  assert.deepEqual(past, { c0: 4, c1: 4, r0: 4, r1: 4 });

  const before = visibleTiles({ scale: 1, x: 10000, y: 10000 }, viewportSize, tiles);
  assert.deepEqual(before, { c0: 0, c1: 0, r0: 0, r1: 0 });
});

test("visibleTiles refuses a degenerate view", () => {
  const tiles = { tileSize: 256, cols: 4, rows: 4 };
  const viewportSize = { width: 800, height: 600 };

  assert.equal(visibleTiles({ scale: 0, x: 0, y: 0 }, viewportSize, tiles), null);
  assert.equal(visibleTiles({ scale: -1, x: 0, y: 0 }, viewportSize, tiles), null);
  assert.equal(visibleTiles({ scale: Number.NaN, x: 0, y: 0 }, viewportSize, tiles), null);
  assert.equal(visibleTiles({ scale: 1, x: Number.NaN, y: 0 }, viewportSize, tiles), null);
});

// ---------------------------------------------------------------------------
// buildCountryOf
// ---------------------------------------------------------------------------

test("buildCountryOf is sized by the maximum id and leaves the holes at zero", () => {
  const assignment = new Map<number, number>([
    [1, 3],
    [1650, 8],
    [9999, 2],
  ]);
  const countryOf = buildCountryOf(assignment, 1650);

  assert.equal(countryOf.length, 1651);
  assert.equal(countryOf[0], 0, "index 0 is NO_PROVINCE, never a country");
  assert.equal(countryOf[1], 3);
  assert.equal(countryOf[1650], 8);
  // Ids 1318 and 1458 do not exist in the real manifest and must stay 0.
  assert.equal(countryOf[1318], 0);
  assert.equal(countryOf[1458], 0);
});

test("buildCountryOf ignores an out-of-range id instead of throwing", () => {
  const countryOf = buildCountryOf(new Map([[50, 1]]), 10);
  assert.equal(countryOf.length, 11);
  for (const value of countryOf) {
    assert.equal(value, 0);
  }
});

test("buildCountryOf never returns a zero-length array", () => {
  // `countryRuns` reads slot 0 unconditionally through `countryAt`, and a caller
  // that computes `maxProvinceId` from an empty manifest would otherwise hand it
  // an array with no slot 0 to read.
  for (const maxId of [0, -1, -100]) {
    const countryOf = buildCountryOf(new Map([[1, 4]]), maxId);
    assert.equal(countryOf.length, 1, "maxProvinceId " + maxId);
    assert.equal(countryOf[0], 0);
  }
});

// ---------------------------------------------------------------------------
// The real asset. These five numbers were measured against the shipped
// provinces_map.png; they are the pins the whole task rests on.
// ---------------------------------------------------------------------------

type RealScan = { scan: BorderScan; ids: Uint16Array; width: number };

let cached: RealScan | null = null;

function realScan(): RealScan {
  if (cached) {
    return cached;
  }
  const manifest = parseManifestText(readFileSync(manifestPath, "utf8"));
  const png = decodePng(new Uint8Array(readFileSync(bitmapPath)));
  const packed = packPixels(png.data, png.width * png.height);

  const colors = new Uint32Array(manifest.provinces.length);
  const paletteIds = new Uint16Array(manifest.provinces.length);
  for (let i = 0; i < manifest.provinces.length; i += 1) {
    const province = manifest.provinces[i];
    colors[i] = packRgb(province.rgb[0], province.rgb[1], province.rgb[2]);
    paletteIds[i] = province.id;
  }

  const idArray = mapPixelsToIds(packed, colors, paletteIds);
  cached = {
    scan: scanBorders(idArray, png.width, png.height),
    ids: idArray,
    width: png.width,
  };
  return cached;
}

test("the real province bitmap yields exactly the measured border geometry", () => {
  const { scan } = realScan();

  assert.equal(scan.width, 3653);
  assert.equal(scan.height, 2855);
  assert.equal(scan.borderPixels, 180869);
  assert.equal(scan.crossings.vertical.length, 103835);
  assert.equal(scan.crossings.horizontal.length, 111342);
  assert.equal(scan.runs.vertical.length / 3, 66074);
  assert.equal(scan.runs.horizontal.length / 3, 66116);

  assertRunsCoverCrossings(scan);
});

test("the identity assignment reproduces the real run counts through the recompute path", () => {
  const { scan, ids: idArray, width } = realScan();
  const rebuilt = countryRuns(idArray, width, scan.crossings, identityCountryOf(1650));

  assert.equal(rebuilt.vertical.length / 3, 66074);
  assert.equal(rebuilt.horizontal.length / 3, 66116);
});

test("a country run set is always a subset of the province crossings", () => {
  // DESIGN 4.3's justification for walking the retained crossings instead of
  // rescanning the bitmap: a country boundary can only exist where two DIFFERENT
  // provinces meet. Asserted on the real map, so it covers every geometry the
  // synthetic fixtures do not. If `countryRuns` ever emitted a run the province
  // scan never saw, the country layer would draw a line through the middle of a
  // province and the cheap recompute would be unsound.
  const { scan, ids: idArray, width } = realScan();

  // Buckets provinces into 8 countries, which merges thousands of real
  // neighbours and leaves thousands of real boundaries.
  const countryOf = new Uint16Array(1651);
  for (let id = 1; id <= 1650; id += 1) {
    countryOf[id] = (id % 8) + 1;
  }
  const rebuilt = countryRuns(idArray, width, scan.crossings, countryOf);

  const provinceVertical = new Set(scan.crossings.vertical);
  const provinceHorizontal = new Set(scan.crossings.horizontal);

  let verticalLength = 0;
  for (const run of triples(rebuilt.vertical)) {
    for (let y = run[1]; y <= run[2]; y += 1) {
      assert.ok(
        provinceVertical.has(y * width + run[0]),
        "country crossing (" + run[0] + ", " + y + ") is not a province crossing",
      );
      verticalLength += 1;
    }
  }

  let horizontalLength = 0;
  for (const run of triples(rebuilt.horizontal)) {
    for (let x = run[1]; x <= run[2]; x += 1) {
      assert.ok(
        provinceHorizontal.has(run[0] * width + x),
        "country crossing (" + x + ", " + run[0] + ") is not a province crossing",
      );
      horizontalLength += 1;
    }
  }

  assert.ok(verticalLength > 0, "an 8-country split must leave some vertical boundary");
  assert.ok(horizontalLength > 0, "an 8-country split must leave some horizontal boundary");
  assert.ok(
    verticalLength < scan.crossings.vertical.length,
    "merging provinces must drop crossings, not keep them all",
  );
  assert.ok(horizontalLength < scan.crossings.horizontal.length);
});

test("tiling the real runs preserves their total length", () => {
  const { scan } = realScan();
  const tiles = buildBorderTiles(scan.runs, scan.width, scan.height);

  assert.equal(tiles.cols, Math.ceil(3653 / 256));
  assert.equal(tiles.rows, Math.ceil(2855 / 256));
  assert.equal(tiles.offsets[tiles.offsets.length - 1], tiles.data.length);

  let total = 0;
  for (let at = 0; at < tiles.data.length; at += 4) {
    total +=
      Math.abs(tiles.data[at + 2] - tiles.data[at]) +
      Math.abs(tiles.data[at + 3] - tiles.data[at + 1]);
  }
  assert.equal(total, runLength(scan.runs));
});
