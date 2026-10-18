import { buildBorderTiles, countryRuns, mapPixelsToIds, scanBorders } from "./borders";
import type { BorderCrossings, BorderTiles } from "./borders";

// The scan touches 10.4 million pixels. On the main thread that is a visible
// freeze right where the first paint happens, so it runs here and posts back two
// transferable buffers.
//
// This file is a shell: it owns the retained state, decodes the two request
// kinds, and calls `borders.ts`. It has no logic of its own, because it cannot be
// unit tested — `borders.ts` can.

type ScanRequest = {
  kind: "scan";
  requestId: number;
  // A COPY of `ProvinceIndex.pixels`, transferred. Never the original: a transfer
  // detaches it and every later `provinceAt` on the main thread reads zeroes.
  pixels: ArrayBuffer;
  width: number;
  height: number;
  paletteColors: ArrayBuffer;
  paletteIds: ArrayBuffer;
  tileSize: number;
};

type CountriesRequest = {
  kind: "countries";
  requestId: number;
  // Uint16Array indexed by province id, or null to clear the country layer.
  countryOf: ArrayBuffer | null;
};

type BorderRequest = ScanRequest | CountriesRequest;

type BorderStats = {
  borderPixels: number;
  verticalRuns: number;
  horizontalRuns: number;
  segments: number;
  elapsedMs: number;
};

type BorderResponse =
  | { kind: "scan"; ok: true; requestId: number; tiles: BorderTiles; stats: BorderStats }
  | {
      kind: "countries";
      ok: true;
      requestId: number;
      tiles: BorderTiles | null;
      stats: BorderStats;
    }
  | { kind: "error"; requestId: number; message: string };

// `tsconfig` sets `lib: ["ES2024", "DOM", "DOM.Iterable"]` with no `WebWorker`, so
// `self` is typed as a window here. Narrowing it locally is less invasive than a
// second tsconfig for one file — the same trick
// `../civitas-map/src/map/detect-worker.ts` uses.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<BorderRequest>) => void) | null;
  postMessage: (message: BorderResponse, transfer?: Transferable[]) => void;
};

// Retained for the worker's life: 20.9 MB of ids and ~0.9 MB of crossings. That
// is the whole point of keeping the worker alive — a country reassignment walks
// the crossings instead of rescanning the bitmap.
let ids: Uint16Array | null = null;
let crossings: BorderCrossings | null = null;
let mapWidth = 0;
let mapHeight = 0;
let tileSize = 256;

function statsFor(
  borderPixels: number,
  verticalRunFloats: number,
  horizontalRunFloats: number,
  segments: number,
  elapsedMs: number,
): BorderStats {
  return {
    borderPixels,
    verticalRuns: verticalRunFloats / 3,
    horizontalRuns: horizontalRunFloats / 3,
    segments,
    elapsedMs,
  };
}

function handleScan(request: ScanRequest): void {
  const started = performance.now();

  const packed = new Uint32Array(request.pixels);
  const paletteColors = new Uint32Array(request.paletteColors);
  const paletteIds = new Uint16Array(request.paletteIds);

  mapWidth = request.width;
  mapHeight = request.height;
  tileSize = request.tileSize;

  // The packed copy dies with this function; only the 2-byte-per-pixel id array
  // and the crossing lists are retained.
  const idArray = mapPixelsToIds(packed, paletteColors, paletteIds);
  const scan = scanBorders(idArray, mapWidth, mapHeight);
  ids = idArray;
  crossings = scan.crossings;

  const tiles = buildBorderTiles(scan.runs, mapWidth, mapHeight, tileSize);
  scope.postMessage(
    {
      kind: "scan",
      ok: true,
      requestId: request.requestId,
      tiles,
      stats: statsFor(
        scan.borderPixels,
        scan.runs.vertical.length,
        scan.runs.horizontal.length,
        tiles.data.length / 4,
        performance.now() - started,
      ),
    },
    [tiles.data.buffer, tiles.offsets.buffer],
  );
}

function handleCountries(request: CountriesRequest): void {
  const started = performance.now();

  // `ids === null` means the scan failed; message ordering rules out a countries
  // request arriving before a successful scan's response was posted.
  if (!request.countryOf || !ids || !crossings) {
    scope.postMessage({
      kind: "countries",
      ok: true,
      requestId: request.requestId,
      tiles: null,
      stats: statsFor(0, 0, 0, 0, performance.now() - started),
    });
    return;
  }

  const countryOf = new Uint16Array(request.countryOf);
  // Index 0 is NO_PROVINCE, not a province. A non-zero slot there would give
  // every coastline crossing a phantom country on one side.
  countryOf[0] = 0;

  const runs = countryRuns(ids, mapWidth, crossings, countryOf);
  const tiles = buildBorderTiles(runs, mapWidth, mapHeight, tileSize);
  scope.postMessage(
    {
      kind: "countries",
      ok: true,
      requestId: request.requestId,
      tiles,
      stats: statsFor(
        0,
        runs.vertical.length,
        runs.horizontal.length,
        tiles.data.length / 4,
        performance.now() - started,
      ),
    },
    [tiles.data.buffer, tiles.offsets.buffer],
  );
}

scope.onmessage = (event: MessageEvent<BorderRequest>) => {
  const request = event.data;
  // Nothing may escape. An unhandled worker exception surfaces as an opaque
  // ErrorEvent with no message in some browsers, and the store would sit in
  // "scanning" forever.
  try {
    if (request.kind === "scan") {
      handleScan(request);
      return;
    }
    handleCountries(request);
  } catch (error) {
    scope.postMessage({
      kind: "error",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

export {
  type BorderRequest,
  type BorderResponse,
  type BorderStats,
  type CountriesRequest,
  type ScanRequest,
};
