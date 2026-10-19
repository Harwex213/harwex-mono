import { buildBorderTiles, countryRuns, mapPixelsToIds, scanBorders } from "../domain/index";
import type { BorderCrossings, BorderTiles } from "../domain/index";

// Runs the 10.4 Mpx border scan off the main thread, so the first paint does not freeze.
// A thin shell: it keeps the retained state and calls `domain/borders`.
// The logic stays in `borders.ts` because a worker cannot be unit tested.

type ScanRequest = {
  kind: "scan";
  requestId: number;
  // A transferred copy of `ProvinceIndex.pixels`, never the original buffer.
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

// tsconfig has no `WebWorker` lib, so `self` is typed as a window.
// A local cast is cheaper than a second tsconfig for one file.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<BorderRequest>) => void) | null;
  postMessage: (message: BorderResponse, transfer?: Transferable[]) => void;
};

// Kept for the worker's life (~21 MB ids, ~1 MB crossings).
// A country reassignment walks the crossings instead of a rescan.
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

  // Only the 2-byte ids and the crossings outlive this call, not the packed pixels.
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

  // `ids === null` here means the scan failed. Message order guarantees the scan ran first.
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
  // Slot 0 is NO_PROVINCE. A non-zero value would put a phantom country on every coastline.
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
  // Catch everything. Some browsers report an uncaught worker error without a message,
  // and the store would then stay in "scanning" forever.
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
