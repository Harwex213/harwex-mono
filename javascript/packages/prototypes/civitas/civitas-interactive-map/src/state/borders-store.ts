import { signal } from "@preact/signals-react";
import { TILE_SIZE } from "../map/borders";
import { buildBorderPaths } from "../ui/border-layer";
import { getMapAssets, loadPhase } from "./map-store";
import type { BorderRequest, BorderResponse, BorderStats } from "../map/borders.worker";
import type { BorderPaths } from "../ui/border-layer";

// Same rule T02 set: signals carry status, big objects are plain module
// variables. A Path2D array in a signal would gain nothing — it is identity-only
// — so the draw effect subscribes to `bordersVersion` instead.
//
// The worker is kept ALIVE after the scan. It retains the id bitmap and the
// crossing lists, which is what makes a country reassignment a few milliseconds
// instead of a full rescan.

type BorderPhase = "idle" | "scanning" | "ready" | "failed";

const borderPhase = signal<BorderPhase>("idle");
const borderError = signal<string | null>(null);
const borderStats = signal<BorderStats | null>(null);
const countryBorderStats = signal<BorderStats | null>(null);
// Bumped whenever either Path2D set is replaced.
const bordersVersion = signal(0);

let worker: Worker | null = null;
let nextRequestId = 1;
let scanRequestId = 0;
let countryRequestId = 0;
let countryInFlight = false;
// `null` means nothing is queued; a box means the newest assignment is waiting,
// and its `value` may legitimately be `null` (a clear).
let pendingCountry: { value: Uint16Array | null } | null = null;
let provincePaths: BorderPaths | null = null;
let countryPaths: BorderPaths | null = null;

function getProvinceBorderPaths(): BorderPaths | null {
  return provincePaths;
}

function getCountryBorderPaths(): BorderPaths | null {
  return countryPaths;
}

function fail(message: string): void {
  borderPhase.value = "failed";
  borderError.value = message;
}

function postCountries(countryOf: Uint16Array | null): void {
  const current = worker;
  if (!current) {
    return;
  }
  countryRequestId = nextRequestId;
  nextRequestId += 1;
  countryInFlight = true;

  // A copy, so the caller's array is not detached by the transfer. T06 will hold
  // on to its assignment array between edits.
  const copy = countryOf ? countryOf.slice() : null;
  const request: BorderRequest = {
    kind: "countries",
    requestId: countryRequestId,
    countryOf: copy ? copy.buffer : null,
  };
  current.postMessage(request, copy ? [copy.buffer] : []);
}

function flushPendingCountry(): void {
  const queued = pendingCountry;
  if (!queued) {
    return;
  }
  pendingCountry = null;
  postCountries(queued.value);
}

function handleMessage(event: MessageEvent<BorderResponse>): void {
  const message = event.data;

  if (message.kind === "error") {
    if (message.requestId === scanRequestId) {
      fail(message.message);
      return;
    }
    if (message.requestId === countryRequestId) {
      countryInFlight = false;
      flushPendingCountry();
    }
    return;
  }

  if (message.kind === "scan") {
    // A response from a worker that has since been replaced or disposed.
    if (message.requestId !== scanRequestId) {
      return;
    }
    provincePaths = buildBorderPaths(message.tiles);
    borderStats.value = message.stats;
    borderPhase.value = "ready";
    bordersVersion.value += 1;
    return;
  }

  countryInFlight = false;
  // Latest wins. T06 paints provinces during a drag, so several requests overlap.
  if (message.requestId === countryRequestId) {
    countryPaths = message.tiles ? buildBorderPaths(message.tiles) : null;
    countryBorderStats.value = message.stats;
    bordersVersion.value += 1;
  }
  flushPendingCountry();
}

// Idempotent, and safe to call before the map has loaded — callers do not have to
// guard. It NEVER throws: without borders the app must still pan, zoom and pick.
function ensureBordersScanned(): void {
  if (worker) {
    return;
  }
  if (loadPhase.value !== "ready") {
    return;
  }
  const assets = getMapAssets();
  if (!assets) {
    return;
  }

  const index = assets.index;
  const paletteColors = new Uint32Array(index.colorIndex.size);
  const paletteIds = new Uint16Array(index.colorIndex.size);
  let at = 0;
  for (const [packed, id] of index.colorIndex) {
    paletteColors[at] = packed;
    paletteIds[at] = id;
    at += 1;
  }

  let created: Worker;
  try {
    // The `new URL(..., import.meta.url)` argument must stay inline. Hoisting it
    // into a variable loses rspack's static reference and the worker chunk is
    // never emitted.
    created = new Worker(new URL("../map/borders.worker.ts", import.meta.url), {
      type: "module",
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }

  worker = created;
  created.onmessage = handleMessage;
  created.onerror = (event: ErrorEvent) => {
    fail(event.message || "border worker failed to start");
  };
  created.onmessageerror = () => {
    fail("border worker sent an undeserialisable message");
  };

  // A COPY. Transferring `index.pixels` itself detaches it and every later
  // `provinceAt` reads zeroes — see the comment on that field in
  // `province-index.ts`. The 41.7 MB memcpy costs a few milliseconds and happens
  // after the first paint.
  const pixels = index.pixels.slice();

  scanRequestId = nextRequestId;
  nextRequestId += 1;
  borderPhase.value = "scanning";
  borderError.value = null;

  const request: BorderRequest = {
    kind: "scan",
    requestId: scanRequestId,
    pixels: pixels.buffer,
    width: index.width,
    height: index.height,
    paletteColors: paletteColors.buffer,
    paletteIds: paletteIds.buffer,
    tileSize: TILE_SIZE,
  };
  created.postMessage(request, [pixels.buffer, paletteColors.buffer, paletteIds.buffer]);
}

// The API T06 recomputes country borders through. `null` clears the country
// layer. Requests coalesce: while one is in flight only the newest replacement is
// kept, so a paint drag cannot build a backlog in the worker.
function setCountryAssignment(countryOf: Uint16Array | null): void {
  if (!worker) {
    return;
  }
  if (countryInFlight) {
    pendingCountry = { value: countryOf };
    return;
  }
  postCountries(countryOf);
}

function disposeBorders(): void {
  if (worker) {
    worker.onmessage = null;
    worker.onerror = null;
    worker.onmessageerror = null;
    worker.terminate();
    worker = null;
  }
  // Stale responses are already impossible, but bumping the ids makes it explicit.
  scanRequestId = 0;
  countryRequestId = 0;
  countryInFlight = false;
  pendingCountry = null;
  provincePaths = null;
  countryPaths = null;
  borderPhase.value = "idle";
  borderStats.value = null;
  countryBorderStats.value = null;
  bordersVersion.value += 1;
}

export {
  borderError,
  borderPhase,
  borderStats,
  bordersVersion,
  countryBorderStats,
  disposeBorders,
  ensureBordersScanned,
  getCountryBorderPaths,
  getProvinceBorderPaths,
  setCountryAssignment,
  type BorderPhase,
};
