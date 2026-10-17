import assert from "node:assert/strict";
import { describe, it } from "node:test";
import path from "node:path";
import { isIgnoredRelativePath } from "./fs-data-access.js";
import { createVaultWatcher } from "./vault-watcher.js";
import type { TWatch, TWatchBatch } from "./vault-watcher.js";

const QUIET_MS = 40;
const MAX_WAIT_MS = 120;

const wait = (ms: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms);
});

// A watch function the test drives by hand.
const createFakeWatch = () => {
  let emit: ((relativePath: string | null) => void) | null = null;
  let fail: ((error: Error) => void) | null = null;
  let closeCount = 0;

  const watch: TWatch = (_vaultPath, onEvent, onError) => {
    emit = onEvent;
    fail = onError;

    return {
      close: () => {
        closeCount += 1;
      },
    };
  };

  return {
    watch,
    emit: (relativePath: string | null) => emit?.(relativePath),
    fail: (error: Error) => fail?.(error),
    readCloseCount: () => closeCount,
  };
};

const startWatcher = (fake: ReturnType<typeof createFakeWatch>, onBatch?: (batch: TWatchBatch) => Promise<void>) => {
  const batches: TWatchBatch[] = [];

  const watcher = createVaultWatcher({
    vaultPath: "/vault",
    isIgnored: isIgnoredRelativePath,
    quietMs: QUIET_MS,
    maxWaitMs: MAX_WAIT_MS,
    watch: fake.watch,
    onBatch: async (batch) => {
      batches.push(batch === null ? null : new Set(batch));
      await onBatch?.(batch);
    },
  });

  return { watcher, batches };
};

const toSorted = (batch: TWatchBatch) => {
  assert.ok(batch !== null, "expected a batch of paths");

  return [...batch].sort();
};

describe("createVaultWatcher", () => {
  it("coalesces a burst of events into one batch of distinct paths", async () => {
    const fake = createFakeWatch();
    const { watcher, batches } = startWatcher(fake);

    fake.emit("notes/a.md");
    fake.emit("notes/b.md");
    fake.emit("notes/a.md");
    await wait(QUIET_MS / 2);
    fake.emit("notes/c.md");
    await watcher.settle();

    assert.equal(batches.length, 1);
    assert.deepEqual(toSorted(batches[0] ?? null), ["notes/a.md", "notes/b.md", "notes/c.md"]);

    watcher.close();
  });

  it("sends a batch at the latest after the max wait, even when events never pause", async () => {
    const fake = createFakeWatch();
    const { watcher, batches } = startWatcher(fake);
    const startedAt = Date.now();

    while (Date.now() - startedAt < MAX_WAIT_MS * 2) {
      fake.emit("notes/live.md");
      await wait(QUIET_MS / 4);
    }

    assert.ok(batches.length >= 1, "a batch went out while events were still arriving");

    await watcher.settle();
    watcher.close();
  });

  it("drops events from excluded folders, the state folder and save temp files", async () => {
    const fake = createFakeWatch();
    const { watcher, batches } = startWatcher(fake);

    fake.emit(path.join(".harwex-notes", "state.sqlite"));
    fake.emit(path.join(".harwex-notes", "state.sqlite-wal"));
    fake.emit(path.join("node_modules", "react", "index.js"));
    fake.emit(path.join("project", ".git", "index"));
    fake.emit(path.join("notes", ".a.md.0b0c2a51-7d2e-4f7a-9f55-0d7f0e3c6a11.tmp"));
    fake.emit("");
    await wait(QUIET_MS * 3);
    await watcher.settle();

    assert.equal(batches.length, 0);

    fake.emit(path.join("notes", ".hidden.md"));
    await watcher.settle();

    assert.deepEqual(toSorted(batches[0] ?? null), [path.join("notes", ".hidden.md")]);

    watcher.close();
  });

  it("asks for a full rescan when the platform does not name the path", async () => {
    const fake = createFakeWatch();
    const { watcher, batches } = startWatcher(fake);

    fake.emit("notes/a.md");
    fake.emit(null);
    await watcher.settle();

    assert.deepEqual(batches, [null]);

    watcher.close();
  });

  it("never runs two batches at once; events during a batch form the next one", async () => {
    const fake = createFakeWatch();
    let running = 0;
    let maxRunning = 0;

    const { watcher, batches } = startWatcher(fake, async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      await wait(QUIET_MS * 3);
      running -= 1;
    });

    fake.emit("a.md");
    await wait(QUIET_MS * 2);
    fake.emit("b.md");
    await wait(QUIET_MS * 2);
    await watcher.settle();

    assert.equal(maxRunning, 1);
    assert.deepEqual(batches.map(toSorted), [["a.md"], ["b.md"]]);

    watcher.close();
  });

  it("stops delivering after close", async () => {
    const fake = createFakeWatch();
    const { watcher, batches } = startWatcher(fake);

    watcher.close();
    fake.emit("a.md");
    await wait(QUIET_MS * 3);

    assert.equal(batches.length, 0);
    assert.equal(fake.readCloseCount(), 1);
  });
});
