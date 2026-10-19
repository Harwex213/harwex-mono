import assert from "node:assert/strict";
import test from "node:test";
import { ProvinceIndex } from "../domain/data/province-index";
import { createBordersSource } from "./borders-source";
import type { BorderRequest, BorderResponse, BorderStats } from "./borders-worker";

// A fake worker records every request. The test answers by calling `onmessage` itself.

type FakeWorker = {
  requests: BorderRequest[];
  terminated: boolean;
  onmessage: ((event: MessageEvent<BorderResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: (() => void) | null;
  postMessage(request: BorderRequest): void;
  terminate(): void;
  answer(response: BorderResponse): void;
};

function fakeWorker(): FakeWorker {
  const worker: FakeWorker = {
    requests: [],
    terminated: false,
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(request: BorderRequest): void {
      worker.requests.push(request);
    },
    terminate(): void {
      worker.terminated = true;
    },
    answer(response: BorderResponse): void {
      if (worker.onmessage) {
        worker.onmessage({ data: response } as MessageEvent<BorderResponse>);
      }
    },
  };
  return worker;
}

const STATS: BorderStats = {
  borderPixels: 0,
  verticalRuns: 0,
  horizontalRuns: 0,
  segments: 0,
  elapsedMs: 1,
};

function smallIndex(): ProvinceIndex {
  return new ProvinceIndex(2, 1, new Uint32Array(2), new Map([[1, 1]]));
}

function started() {
  const worker = fakeWorker();
  const source = createBordersSource(() => {
    return worker as unknown as Worker;
  });
  const scan = source.scan(smallIndex());
  return { worker, source, scan };
}

function countriesId(worker: FakeWorker, at: number): number {
  const request = worker.requests[at];
  assert.ok(request && request.kind === "countries", "request " + at + " is a countries request");
  return request.requestId;
}

test("assignCountries before the scan resolves null and posts nothing", async () => {
  const worker = fakeWorker();
  const source = createBordersSource(() => {
    return worker as unknown as Worker;
  });
  assert.equal(source.started(), false);
  assert.equal(await source.assignCountries(new Uint16Array(3)), null);
  assert.equal(worker.requests.length, 0);
});

test("the scan resolves with the worker's answer", async () => {
  const { worker, source, scan } = started();
  assert.equal(source.started(), true);
  const request = worker.requests[0];
  assert.ok(request && request.kind === "scan");
  const tiles = { tileSize: 256 } as never;
  worker.answer({ kind: "scan", ok: true, requestId: request.requestId, tiles, stats: STATS });
  const result = await scan;
  assert.equal(result?.tiles, tiles);
});

test("one request is in flight and only the newest replacement waits", async () => {
  const { worker, source } = started();

  const first = source.assignCountries(new Uint16Array([0, 1]));
  const second = source.assignCountries(new Uint16Array([0, 2]));
  const third = source.assignCountries(new Uint16Array([0, 3]));
  assert.equal(worker.requests.length, 2, "the scan plus one countries request");

  // The superseded request never reaches the worker.
  assert.equal(await second, null);

  worker.answer({ kind: "countries", ok: true, requestId: countriesId(worker, 1), tiles: null, stats: STATS });
  assert.deepEqual(await first, { tiles: null, stats: STATS });

  // The queued newest one is posted as soon as the first answer lands.
  assert.equal(worker.requests.length, 3);
  const posted = worker.requests[2];
  assert.ok(posted && posted.kind === "countries" && posted.countryOf !== null);
  assert.deepEqual([...new Uint16Array(posted.countryOf)], [0, 3]);

  worker.answer({ kind: "countries", ok: true, requestId: countriesId(worker, 2), tiles: null, stats: STATS });
  assert.deepEqual(await third, { tiles: null, stats: STATS });
});

test("a failed countries request resolves null and sends the queued one", async () => {
  const { worker, source } = started();
  const first = source.assignCountries(new Uint16Array(2));
  const second = source.assignCountries(null);

  worker.answer({ kind: "error", requestId: countriesId(worker, 1), message: "boom" });
  assert.equal(await first, null);
  assert.equal(worker.requests.length, 3);

  worker.answer({ kind: "countries", ok: true, requestId: countriesId(worker, 2), tiles: null, stats: STATS });
  assert.deepEqual(await second, { tiles: null, stats: STATS });
});

test("dispose resolves every pending request with null and stops the worker", async () => {
  const { worker, source, scan } = started();
  const inFlight = source.assignCountries(new Uint16Array(2));
  const queued = source.assignCountries(new Uint16Array(2));

  source.dispose();
  assert.equal(worker.terminated, true);
  assert.equal(source.started(), false);
  assert.equal(await scan, null);
  assert.equal(await inFlight, null);
  assert.equal(await queued, null);
});

test("a scan error rejects the scan", async () => {
  const { worker, scan } = started();
  const request = worker.requests[0];
  assert.ok(request);
  worker.answer({ kind: "error", requestId: request.requestId, message: "bad bitmap" });
  await assert.rejects(scan, /bad bitmap/);
});
