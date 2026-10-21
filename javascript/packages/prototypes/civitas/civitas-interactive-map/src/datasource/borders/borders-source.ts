import {
  TILE_SIZE,
  type BorderTiles,
  type ProvinceIndex,
} from "../../domain/index";
import type { BorderRequest, BorderResponse, BorderStats } from "./borders-worker";

// A promise API over the border web worker. It never touches a signal.
// The worker stays alive after the scan and keeps the id bitmap and crossings,
// so a country reassignment takes milliseconds instead of a full rescan.

type ScanResult = { tiles: BorderTiles; stats: BorderStats };
type CountryResult = { tiles: BorderTiles | null; stats: BorderStats };

type BordersSource = {
  // True from the first `scan` call until `dispose`.
  started(): boolean;
  // Resolves `null` when the source is disposed before the answer arrives.
  // Rejects when the worker fails.
  scan(index: ProvinceIndex): Promise<ScanResult | null>;
  // `null` clears the country layer. Resolves `null` when the request was
  // replaced by a newer one, failed, or was sent before `scan`.
  assignCountries(countryOf: Uint16Array | null): Promise<CountryResult | null>;
  dispose(): void;
};

type PendingScan = {
  requestId: number;
  resolve: (result: ScanResult | null) => void;
  reject: (error: Error) => void;
};
type PendingCountry = {
  requestId: number;
  resolve: (result: CountryResult | null) => void;
};
type QueuedCountry = {
  countryOf: Uint16Array | null;
  resolve: (result: CountryResult | null) => void;
};

function createBorderWorker(): Worker {
  // Keep `new URL(...)` inline. rspack emits the worker chunk only for an inline reference.
  return new Worker(new URL("./borders-worker.ts", import.meta.url), { type: "module" });
}

function createBordersSource(createWorker: () => Worker = createBorderWorker): BordersSource {
  let worker: Worker | null = null;
  let nextRequestId = 1;
  let scanning: PendingScan | null = null;
  // One request in flight plus the newest replacement, so a paint drag cannot build a backlog.
  let inFlight: PendingCountry | null = null;
  let queued: QueuedCountry | null = null;

  function takeRequestId(): number {
    const id = nextRequestId;
    nextRequestId += 1;
    return id;
  }

  function failScan(message: string): void {
    const pending = scanning;
    scanning = null;
    if (pending !== null) {
      pending.reject(new Error(message));
    }
  }

  function post(current: Worker, countryOf: Uint16Array | null, resolve: QueuedCountry["resolve"]): void {
    const requestId = takeRequestId();
    inFlight = { requestId, resolve };
    // A copy, so the caller's array is not detached by the transfer.
    const copy = countryOf ? countryOf.slice() : null;
    const request: BorderRequest = {
      kind: "countries",
      requestId,
      countryOf: copy ? copy.buffer : null,
    };
    current.postMessage(request, copy ? [copy.buffer] : []);
  }

  function sendQueued(): void {
    const next = queued;
    queued = null;
    if (next === null) {
      return;
    }
    if (worker === null) {
      next.resolve(null);
      return;
    }
    post(worker, next.countryOf, next.resolve);
  }

  function settleCountry(result: CountryResult | null): void {
    const pending = inFlight;
    inFlight = null;
    if (pending !== null) {
      pending.resolve(result);
    }
    sendQueued();
  }

  function handleMessage(event: MessageEvent<BorderResponse>): void {
    const message = event.data;

    if (message.kind === "error") {
      if (scanning !== null && message.requestId === scanning.requestId) {
        failScan(message.message);
        return;
      }
      if (inFlight !== null && message.requestId === inFlight.requestId) {
        settleCountry(null);
      }
      return;
    }

    if (message.kind === "scan") {
      const pending = scanning;
      if (pending === null || message.requestId !== pending.requestId) {
        return;
      }
      scanning = null;
      pending.resolve({ tiles: message.tiles, stats: message.stats });
      return;
    }

    if (inFlight !== null && message.requestId === inFlight.requestId) {
      settleCountry({ tiles: message.tiles, stats: message.stats });
    }
  }

  function scan(index: ProvinceIndex): Promise<ScanResult | null> {
    return new Promise((resolve, reject) => {
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
        created = createWorker();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      worker = created;
      created.onmessage = handleMessage;
      created.onerror = (event: ErrorEvent) => {
        failScan(event.message || "border worker failed to start");
      };
      created.onmessageerror = () => {
        failScan("border worker sent an undeserialisable message");
      };

      // Transfer a copy. A transfer of `index.pixels` detaches it, and `provinceAt` then reads zeroes.
      const pixels = index.pixels.slice();
      const requestId = takeRequestId();
      scanning = { requestId, resolve, reject };

      const request: BorderRequest = {
        kind: "scan",
        requestId,
        pixels: pixels.buffer,
        width: index.width,
        height: index.height,
        paletteColors: paletteColors.buffer,
        paletteIds: paletteIds.buffer,
        tileSize: TILE_SIZE,
      };
      created.postMessage(request, [pixels.buffer, paletteColors.buffer, paletteIds.buffer]);
    });
  }

  function assignCountries(countryOf: Uint16Array | null): Promise<CountryResult | null> {
    return new Promise((resolve) => {
      if (worker === null) {
        resolve(null);
        return;
      }
      if (inFlight !== null) {
        if (queued !== null) {
          queued.resolve(null);
        }
        queued = { countryOf, resolve };
        return;
      }
      post(worker, countryOf, resolve);
    });
  }

  function dispose(): void {
    if (worker !== null) {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      worker = null;
    }
    const pendingScan = scanning;
    scanning = null;
    if (pendingScan !== null) {
      pendingScan.resolve(null);
    }
    const pendingCountry = inFlight;
    inFlight = null;
    if (pendingCountry !== null) {
      pendingCountry.resolve(null);
    }
    const next = queued;
    queued = null;
    if (next !== null) {
      next.resolve(null);
    }
  }

  return {
    started(): boolean {
      return worker !== null;
    },
    scan,
    assignCountries,
    dispose,
  };
}

export { createBordersSource, type BordersSource, type CountryResult };
