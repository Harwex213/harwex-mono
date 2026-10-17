import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { TRPCError } from "@trpc/server";
import type { TFsNode, TVaultChange } from "@hw/harwex-notes-protocol";
import { FsDataAccess } from "../data-access/fs-data-access.js";
import { createMemoryVaultFs } from "../data-access/memory-vault-fs.js";
import { createNodeVaultFs } from "../data-access/node-vault-fs.js";
import { openStateDb } from "../data-access/state-db.js";
import { StateStore } from "../data-access/state-store.js";
import { createNode, fetchDocument, restoreDocument, updateDocument } from "./fs-service.js";
import { createVaultChanges, startVaultSync } from "./sync-service.js";
import type { TVaultWatcher } from "../data-access/vault-watcher.js";
import type { TContext } from "../trpc.js";

const QUIET_MS = 60;
// Real file system events arrive with some delay (FSEvents on macOS batches them).
const EVENT_TIMEOUT_MS = 4000;
// How long a test waits to be sure that nothing is published.
const SILENCE_MS = 700;

const wait = (ms: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms);
});

const readPathById = (nodes: readonly TFsNode[]): Map<string, string> => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const pathById = new Map<string, string>();

  for (const node of nodes) {
    const segments: string[] = [];
    let current: TFsNode | undefined = node;

    while (current !== undefined) {
      segments.unshift(current.name);
      current = current.parentId === null ? undefined : byId.get(current.parentId);
    }

    pathById.set(node.id, segments.join("/"));
  }

  return pathById;
};

const findId = (nodes: readonly TFsNode[], relativePath: string): string | undefined => {
  for (const [id, nodePath] of readPathById(nodes)) {
    if (nodePath === relativePath) {
      return id;
    }
  }

  return undefined;
};

const createContext = (dataAccess: FsDataAccess): TContext => {
  return { dataAccess, stateStore: new StateStore(openStateDb(":memory:")) };
};

describe("syncWithDisk (in-memory disk)", () => {
  const VAULT = "/vault";

  it("keeps the id of every entry whose path did not change", async () => {
    const disk = createMemoryVaultFs(VAULT, { "a.md": "a", "notes/b.md": "b" });
    const dataAccess = new FsDataAccess(disk, VAULT);
    await dataAccess.preload();
    const before = [...dataAccess.tree];

    await disk.writeFile(path.join(VAULT, "notes", "c.md"), new TextEncoder().encode("c"));
    await disk.remove(path.join(VAULT, "a.md"));

    const { nodes } = await dataAccess.syncWithDisk(new Set(["a.md", path.join("notes", "c.md")]));

    assert.ok(nodes !== null);
    assert.equal(findId(nodes, "notes"), findId(before, "notes"));
    assert.equal(findId(nodes, "notes/b.md"), findId(before, "notes/b.md"));
    assert.equal(findId(nodes, "a.md"), undefined);
    assert.ok(findId(nodes, "notes/c.md") !== undefined);
  });

  it("gives an unchanged vault the same ids after a restart", async () => {
    const seed = { "a.md": "a", "notes/b.md": "b" };
    const first = new FsDataAccess(createMemoryVaultFs(VAULT, seed), VAULT);
    const second = new FsDataAccess(createMemoryVaultFs(VAULT, seed), VAULT);
    await first.preload();
    await second.preload();

    assert.deepEqual(readPathById(first.tree), readPathById(second.tree));
  });

  it("reports a content change once, and never the app's own write", async () => {
    const disk = createMemoryVaultFs(VAULT, { "a.md": "a" });
    const dataAccess = new FsDataAccess(disk, VAULT);
    await dataAccess.preload();
    const ctx = createContext(dataAccess);
    const nodeId = findId(dataAccess.tree, "a.md") as string;

    await updateDocument(ctx, { kind: "markdown", nodeId, text: "mine" });
    const own = await dataAccess.syncWithDisk(new Set(["a.md"]));
    assert.deepEqual(own, { nodes: null, changedFiles: [] });

    await disk.writeFile(path.join(VAULT, "a.md"), new TextEncoder().encode("theirs"));
    const outside = await dataAccess.syncWithDisk(new Set(["a.md"]));
    assert.equal(outside.nodes, null);
    assert.deepEqual(outside.changedFiles.map((file) => file.nodeId), [nodeId]);

    const again = await dataAccess.syncWithDisk(new Set(["a.md"]));
    assert.deepEqual(again.changedFiles, []);
  });

  it("refuses a save based on a version the disk no longer has", async () => {
    const disk = createMemoryVaultFs(VAULT, { "a.md": "a" });
    const dataAccess = new FsDataAccess(disk, VAULT);
    await dataAccess.preload();
    const ctx = createContext(dataAccess);
    const nodeId = findId(dataAccess.tree, "a.md") as string;

    const opened = await fetchDocument(ctx, nodeId);
    await disk.writeFile(path.join(VAULT, "a.md"), new TextEncoder().encode("theirs"));

    await assert.rejects(
      updateDocument(ctx, { kind: "markdown", nodeId, version: opened.version, text: "mine" }),
      (error: unknown) => error instanceof TRPCError && error.code === "CONFLICT"
    );
    assert.equal(disk.readText("a.md"), "theirs");

    // Without a version the save overwrites (CONF-2).
    await updateDocument(ctx, { kind: "markdown", nodeId, text: "mine" });
    assert.equal(disk.readText("a.md"), "mine");
  });

  it("writes a deleted document back under its old id, folders included", async () => {
    const disk = createMemoryVaultFs(VAULT, { "notes/deep/a.md": "a" });
    const dataAccess = new FsDataAccess(disk, VAULT);
    await dataAccess.preload();
    const ctx = createContext(dataAccess);
    const nodeId = findId(dataAccess.tree, "notes/deep/a.md") as string;

    await disk.remove(path.join(VAULT, "notes"));
    await dataAccess.syncWithDisk(new Set(["notes"]));
    assert.equal(findId(dataAccess.tree, "notes/deep/a.md"), undefined);

    const result = await restoreDocument(ctx, {
      path: "notes/deep/a.md",
      document: { kind: "markdown", nodeId, text: "kept" },
    });

    assert.equal(findId(result.nodes, "notes/deep/a.md"), nodeId);
    assert.equal(disk.readText("notes/deep/a.md"), "kept");
    assert.deepEqual(await dataAccess.syncWithDisk(new Set(["notes"])), { nodes: null, changedFiles: [] });
  });

  it("refuses a stale save of a text file and writes a deleted one back", async () => {
    const disk = createMemoryVaultFs(VAULT, { "todo.txt": "a" });
    const dataAccess = new FsDataAccess(disk, VAULT);
    await dataAccess.preload();
    const ctx = createContext(dataAccess);
    const nodeId = findId(dataAccess.tree, "todo.txt") as string;

    const opened = await fetchDocument(ctx, nodeId);
    await disk.writeFile(path.join(VAULT, "todo.txt"), new TextEncoder().encode("theirs, longer"));

    await assert.rejects(
      updateDocument(ctx, { kind: "text", nodeId, version: opened.version, text: "mine" }),
      (error: unknown) => error instanceof TRPCError && error.code === "CONFLICT"
    );

    await disk.remove(path.join(VAULT, "todo.txt"));
    await dataAccess.syncWithDisk(new Set(["todo.txt"]));

    const result = await restoreDocument(ctx, { path: "todo.txt", document: { kind: "text", nodeId, text: "kept" } });

    assert.equal(findId(result.nodes, "todo.txt"), nodeId);
    assert.equal(disk.readText("todo.txt"), "kept");
  });
});

describe("startVaultSync (real disk)", () => {
  let vaultPath: string;
  let dataAccess: FsDataAccess;
  let watcher: TVaultWatcher;
  let published: TVaultChange[];

  // Resolves with the first change that `match` accepts among those published so far or
  // later, or fails after a timeout.
  const waitForChange = async (match: (change: TVaultChange) => boolean): Promise<TVaultChange> => {
    const startedAt = Date.now();

    while (Date.now() - startedAt < EVENT_TIMEOUT_MS) {
      const found = published.find(match);
      if (found !== undefined) {
        return found;
      }

      await wait(20);
    }

    assert.fail(`No matching change within ${EVENT_TIMEOUT_MS} ms. Published: ${JSON.stringify(published)}`);
  };

  beforeEach(async () => {
    vaultPath = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "harwex-notes-sync-")));
    await fs.mkdir(path.join(vaultPath, "notes"));
    await fs.mkdir(path.join(vaultPath, ".harwex-notes"));
    await fs.writeFile(path.join(vaultPath, "notes", "a.md"), "a");

    dataAccess = new FsDataAccess(createNodeVaultFs(), vaultPath);
    await dataAccess.preload();

    published = [];
    const changes = createVaultChanges();
    changes.subscribe((change) => {
      published.push(change);
    });

    watcher = startVaultSync({ dataAccess, vaultPath, changes, quietMs: QUIET_MS });
    // FSEvents may still deliver the setup writes above. Let them pass before the test.
    await wait(SILENCE_MS);
    await watcher.settle();
    published = [];
  });

  afterEach(async () => {
    watcher.close();
    await fs.rm(vaultPath, { recursive: true, force: true });
  });

  it("publishes a file created outside the app, and keeps every other id", async () => {
    const before = [...dataAccess.tree];

    await fs.writeFile(path.join(vaultPath, "notes", "new.md"), "new");

    const change = await waitForChange((candidate) => candidate.nodes !== null);
    const nodes = change.nodes as readonly TFsNode[];

    assert.ok(findId(nodes, "notes/new.md") !== undefined);
    assert.equal(findId(nodes, "notes/a.md"), findId(before, "notes/a.md"));
    assert.equal(findId(nodes, "notes"), findId(before, "notes"));
  });

  it("publishes a content edit as a changed file with no tree", async () => {
    const nodeId = findId(dataAccess.tree, "notes/a.md") as string;

    await fs.writeFile(path.join(vaultPath, "notes", "a.md"), "edited outside");

    const change = await waitForChange((candidate) => candidate.changedFiles.some((file) => file.nodeId === nodeId));
    assert.equal(change.nodes, null);
  });

  it("publishes a delete and a rename as the tree without the old path", async () => {
    const nodeId = findId(dataAccess.tree, "notes/a.md") as string;

    await fs.rename(path.join(vaultPath, "notes", "a.md"), path.join(vaultPath, "notes", "b.md"));

    const change = await waitForChange((candidate) => {
      return candidate.nodes !== null && findId(candidate.nodes, "notes/b.md") !== undefined;
    });
    const nodes = change.nodes as readonly TFsNode[];

    assert.equal(findId(nodes, "notes/a.md"), undefined);
    assert.notEqual(findId(nodes, "notes/b.md"), nodeId);
  });

  it("publishes nothing for the app's own saves and creations", async () => {
    const ctx = createContext(dataAccess);
    const nodeId = findId(dataAccess.tree, "notes/a.md") as string;

    await updateDocument(ctx, { kind: "markdown", nodeId, text: "saved by the app" });
    await updateDocument(ctx, { kind: "markdown", nodeId, text: "saved again" });
    await createNode(ctx, { parentId: null, name: "created.md", kind: "markdown" });

    await wait(SILENCE_MS);
    await watcher.settle();

    assert.deepEqual(published, []);
  });

  it("publishes nothing for changes inside the state folder or excluded folders", async () => {
    await fs.writeFile(path.join(vaultPath, ".harwex-notes", "state.sqlite"), "state");
    await fs.mkdir(path.join(vaultPath, "node_modules"));
    await fs.writeFile(path.join(vaultPath, "node_modules", "x.js"), "x");

    await wait(SILENCE_MS);
    await watcher.settle();

    // Creating the excluded folder itself is an event in the vault root. It rescans and
    // finds nothing new to list.
    assert.deepEqual(published, []);
  });
});
