import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";
import type { TFsNode } from "@hw/harwex-notes-protocol";
import { FsDataAccess } from "./fs-data-access.js";
import { createMemoryVaultFs } from "./memory-vault-fs.js";
import { SAMPLE_VAULT, SAMPLE_VAULT_PATH } from "./sample-vault.js";
import { STATE_DIR_NAME, openStateDb, readStateDbLocation } from "./state-db.js";
import { StateStore } from "./state-store.js";
import { deleteNode, moveNode, renameNode } from "../service/fs-service.js";
import type { TContext } from "../trpc.js";

let store: StateStore;

beforeEach(() => {
  store = new StateStore(openStateDb(":memory:"));
});

describe("readStateDbLocation", () => {
  it("prefers STATE_DB_PATH, then the vault, then memory", () => {
    assert.equal(readStateDbLocation({ stateDbPath: "/tmp/x.sqlite", vaultPath: "/vault" }), "/tmp/x.sqlite");
    assert.equal(
      readStateDbLocation({ stateDbPath: undefined, vaultPath: "/vault" }),
      path.join("/vault", STATE_DIR_NAME, "state.sqlite")
    );
    assert.equal(readStateDbLocation({ stateDbPath: "", vaultPath: "" }), ":memory:");
  });
});

describe("openStateDb", () => {
  it("creates the folder and keeps the data across reopening", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "harwex-notes-state-"));
    const location = path.join(dir, STATE_DIR_NAME, "state.sqlite");

    try {
      const first = openStateDb(location);
      new StateStore(first).writeSetting("theme", "dark");
      first.close();

      const second = openStateDb(location);
      assert.equal(new StateStore(second).readSetting("theme"), "dark");
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("tree state", () => {
  it("is null until saved, then round-trips", () => {
    assert.equal(store.readTreeState(), null);

    store.writeTreeState({ expandedPaths: ["b", "a", "a"], selectedPath: "a/x.md" });
    assert.deepEqual(store.readTreeState(), { expandedPaths: ["a", "b"], selectedPath: "a/x.md" });

    store.writeTreeState({ expandedPaths: [], selectedPath: null });
    assert.deepEqual(store.readTreeState(), { expandedPaths: [], selectedPath: null });
  });
});

describe("node state and settings", () => {
  it("stores JSON values and removes a row on null", () => {
    store.writeNodeState("a/s.excalidraw", "viewport", { x: 1, y: 2, zoom: 1.5 });
    assert.deepEqual(store.readNodeState("a/s.excalidraw", "viewport"), { x: 1, y: 2, zoom: 1.5 });
    assert.equal(store.readNodeState("a/s.excalidraw", "other"), null);

    store.writeNodeState("a/s.excalidraw", "viewport", null);
    assert.equal(store.readNodeState("a/s.excalidraw", "viewport"), null);

    store.writeSetting("excalidraw.style", { strokeColor: "#000" });
    store.writeSetting("flag", false);
    assert.deepEqual(store.readSettings(), { "excalidraw.style": { strokeColor: "#000" }, flag: false });

    store.writeSetting("flag", null);
    assert.equal(store.readSetting("flag"), null);
  });
});

describe("path rewriting", () => {
  beforeEach(() => {
    store.writeTreeState({ expandedPaths: ["a", "a/b", "a_b", "ab"], selectedPath: "a/b/c.md" });
    store.writeNodeState("a/b/c.md", "k", 1);
    store.writeNodeState("a", "k", 2);
    store.writeNodeState("ab", "k", 3);
    store.writeNodeState("a_b/c.md", "k", 4);
  });

  it("moves a folder with everything below it and leaves look-alike paths alone", () => {
    store.movePath("a", "z/a2");

    assert.deepEqual(store.readTreeState(), {
      expandedPaths: ["a_b", "ab", "z/a2", "z/a2/b"],
      selectedPath: "z/a2/b/c.md",
    });
    assert.equal(store.readNodeState("z/a2/b/c.md", "k"), 1);
    assert.equal(store.readNodeState("z/a2", "k"), 2);
    assert.equal(store.readNodeState("ab", "k"), 3);
    assert.equal(store.readNodeState("a_b/c.md", "k"), 4);
    assert.equal(store.readNodeState("a/b/c.md", "k"), null);
  });

  it("drops stale rows at the target before moving", () => {
    store.writeNodeState("q/c.md", "k", 99);
    store.movePath("a/b/c.md", "q/c.md");

    assert.equal(store.readNodeState("q/c.md", "k"), 1);
  });

  it("removes a folder with everything below it", () => {
    store.removePath("a");

    assert.deepEqual(store.readTreeState(), { expandedPaths: ["a_b", "ab"], selectedPath: null });
    assert.equal(store.readNodeState("a/b/c.md", "k"), null);
    assert.equal(store.readNodeState("a", "k"), null);
    assert.equal(store.readNodeState("ab", "k"), 3);
  });
});

describe("fs-service keeps the state in step", () => {
  let ctx: TContext;

  const byPath = (nodes: readonly TFsNode[], relativePath: string): TFsNode => {
    let parentId: string | null = null;
    let found: TFsNode | undefined;

    for (const segment of relativePath.split("/")) {
      const parentOfSegment: string | null = parentId;
      found = nodes.find((node) => node.parentId === parentOfSegment && node.name === segment);
      assert.ok(found, `"${relativePath}" is missing at "${segment}"`);
      parentId = found.id;
    }

    return found as TFsNode;
  };

  beforeEach(async () => {
    const dataAccess = new FsDataAccess(createMemoryVaultFs(SAMPLE_VAULT_PATH, SAMPLE_VAULT), SAMPLE_VAULT_PATH);
    await dataAccess.preload();
    ctx = { dataAccess, stateStore: store };

    store.writeTreeState({
      expandedPaths: ["Projects", "Projects/harwex-notes", "Projects/harwex-notes/notes"],
      selectedPath: "Projects/harwex-notes/notes/todo.txt",
    });
    store.writeNodeState("Projects/harwex-notes/architecture.excalidraw", "viewport", { zoom: 2 });
  });

  it("renames a folder", async () => {
    const folder = byPath(ctx.dataAccess.tree, "Projects/harwex-notes");
    await renameNode(ctx, folder.id, "notes-app");

    assert.deepEqual(store.readTreeState(), {
      expandedPaths: ["Projects", "Projects/notes-app", "Projects/notes-app/notes"],
      selectedPath: "Projects/notes-app/notes/todo.txt",
    });
    assert.deepEqual(store.readNodeState("Projects/notes-app/architecture.excalidraw", "viewport"), { zoom: 2 });
  });

  it("moves a file", async () => {
    const scene = byPath(ctx.dataAccess.tree, "Projects/harwex-notes/architecture.excalidraw");
    await moveNode(ctx, scene.id, byPath(ctx.dataAccess.tree, "Inbox").id);

    assert.deepEqual(store.readNodeState("Inbox/architecture.excalidraw", "viewport"), { zoom: 2 });
    assert.equal(store.readNodeState("Projects/harwex-notes/architecture.excalidraw", "viewport"), null);
  });

  it("deletes a folder", async () => {
    await deleteNode(ctx, byPath(ctx.dataAccess.tree, "Projects/harwex-notes").id);

    assert.deepEqual(store.readTreeState(), { expandedPaths: ["Projects"], selectedPath: null });
    assert.equal(store.readNodeState("Projects/harwex-notes/architecture.excalidraw", "viewport"), null);
  });

  it("leaves the state alone when the file operation is refused", async () => {
    const scene = byPath(ctx.dataAccess.tree, "Projects/harwex-notes/architecture.excalidraw");
    await assert.rejects(renameNode(ctx, scene.id, "overview.md"));

    assert.deepEqual(store.readNodeState("Projects/harwex-notes/architecture.excalidraw", "viewport"), { zoom: 2 });
  });
});
