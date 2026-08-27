import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { TRPCError } from "@trpc/server";
import type { TFsNode } from "@hw/harwex-notes-protocol";
import { FsDataAccess } from "../data-access/fs-data-access.js";
import { createMemoryVaultFs, type TMemoryVaultFs } from "../data-access/memory-vault-fs.js";
import { SAMPLE_VAULT, SAMPLE_VAULT_PATH } from "../data-access/sample-vault.js";
import type { TContext } from "../trpc.js";
import {
  createNode,
  deleteNode,
  fetchDocument,
  fetchTree,
  moveNode,
  renameNode,
} from "./fs-service.js";

let disk: TMemoryVaultFs;
let ctx: TContext;

const byPath = (nodes: readonly TFsNode[], relativePath: string): TFsNode => {
  let parentId: string | null = null;
  let found: TFsNode | undefined;

  for (const segment of relativePath.split("/")) {
    const parentOfSegment: string | null = parentId;
    found = nodes.find((node) => node.parentId === parentOfSegment && node.name === segment);
    assert.ok(found, `"${relativePath}" is missing from the tree at "${segment}"`);
    parentId = found.id;
  }

  return found as TFsNode;
};

const rejectsWith = async (task: Promise<unknown>, code: TRPCError["code"], fragment: string) => {
  await assert.rejects(task, (error: unknown) => {
    assert.ok(error instanceof TRPCError, `expected a TRPCError, got ${String(error)}`);
    assert.equal(error.code, code);
    assert.match(error.message, new RegExp(fragment));

    return true;
  });
};

beforeEach(async () => {
  disk = createMemoryVaultFs(SAMPLE_VAULT_PATH, SAMPLE_VAULT);
  const dataAccess = new FsDataAccess(disk, SAMPLE_VAULT_PATH);
  await dataAccess.preload();
  ctx = { dataAccess };
});

describe("fetchTree", () => {
  it("lists every entry nested as on disk, except generated folders", async () => {
    const nodes = await fetchTree(ctx);

    byPath(nodes, "Projects/harwex-notes/notes/deep/readme.markdown");
    byPath(nodes, "Inbox/empty");
    byPath(nodes, "archive.zip");

    assert.equal(nodes.some((node) => node.name === "node_modules"), false);
    assert.equal(nodes.some((node) => node.name === ".git"), false);
  });

  it("derives the kind from the extension without regard to case", async () => {
    const nodes = await fetchTree(ctx);

    assert.equal(byPath(nodes, "Projects/harwex-notes/overview.md").kind, "markdown");
    assert.equal(byPath(nodes, "Projects/harwex-notes/notes/deep/readme.markdown").kind, "markdown");
    assert.equal(byPath(nodes, "Projects/harwex-notes/architecture.excalidraw").kind, "excalidraw");
    assert.equal(byPath(nodes, "Inbox/empty").kind, "folder");
    assert.equal(byPath(nodes, "archive.zip").kind, "file");
    assert.equal(byPath(nodes, "index.html").kind, "file");
  });
});

describe("fetchDocument", () => {
  it("returns markdown text as it is on disk", async () => {
    const node = byPath(ctx.dataAccess.tree, "Journal/2026-08-26.md");
    const document = await fetchDocument(ctx, node.id);

    assert.deepEqual(document, { kind: "markdown", nodeId: node.id, text: "Read the spec twice.\n" });
  });

  it("returns the elements and files of a drawing", async () => {
    const node = byPath(ctx.dataAccess.tree, "Projects/harwex-notes/architecture.excalidraw");
    const document = await fetchDocument(ctx, node.id);

    assert.equal(document.kind, "excalidraw");
    if (document.kind === "excalidraw") {
      assert.equal(document.scene.elements.length, 1);
      assert.equal(document.scene.elements[0]?.["text"], "vault -> tree -> tabs");
      assert.deepEqual(document.scene.files, {});
    }
  });

  it("refuses a drawing that does not parse, naming the reason", async () => {
    const node = byPath(ctx.dataAccess.tree, "broken.excalidraw");

    await rejectsWith(fetchDocument(ctx, node.id), "BAD_REQUEST", "not a valid drawing");
  });

  it("refuses an unsupported file", async () => {
    const node = byPath(ctx.dataAccess.tree, "archive.zip");

    await rejectsWith(fetchDocument(ctx, node.id), "BAD_REQUEST", "not a supported extension");
  });

  it("refuses a file that is not text", async () => {
    const created = await createNode(ctx, { parentId: null, name: "binary.md", kind: "markdown" });
    await disk.writeFile(`${SAMPLE_VAULT_PATH}/binary.md`, new Uint8Array([0x89, 0x50, 0x00, 0x47]));

    await rejectsWith(fetchDocument(ctx, created.node.id), "BAD_REQUEST", "not a text file");
  });

  it("refuses a file larger than 8 MB", async () => {
    const created = await createNode(ctx, { parentId: null, name: "huge.md", kind: "markdown" });
    await disk.writeFile(`${SAMPLE_VAULT_PATH}/huge.md`, new Uint8Array(8 * 1024 * 1024 + 1));

    await rejectsWith(fetchDocument(ctx, created.node.id), "BAD_REQUEST", "8 MB");
  });

  it("reports an unknown node as not found", async () => {
    await rejectsWith(fetchDocument(ctx, "missing"), "NOT_FOUND", "No node");
  });
});

describe("createNode", () => {
  it("creates a markdown file on disk inside the chosen folder", async () => {
    const journal = byPath(ctx.dataAccess.tree, "Journal");
    const { node, nodes } = await createNode(ctx, { parentId: journal.id, name: " note.md ", kind: "markdown" });

    assert.equal(node.name, "note.md");
    assert.equal(node.kind, "markdown");
    assert.equal(node.parentId, journal.id);
    assert.ok(nodes.includes(node));
    assert.equal(disk.readText("Journal/note.md"), "");
  });

  it("creates a drawing that excalidraw.com can open", async () => {
    const { node } = await createNode(ctx, { parentId: null, name: "sketch.excalidraw", kind: "excalidraw" });

    const parsed = JSON.parse(disk.readText("sketch.excalidraw") ?? "") as Record<string, unknown>;
    assert.equal(parsed["type"], "excalidraw");
    assert.deepEqual(parsed["elements"], []);

    const document = await fetchDocument(ctx, node.id);
    assert.equal(document.kind, "excalidraw");
  });

  it("creates a folder at the root when no parent is given", async () => {
    const { node } = await createNode(ctx, { parentId: null, name: "Ideas", kind: "folder" });

    assert.equal(node.parentId, null);
    assert.equal(node.kind, "folder");
    assert.equal(disk.exists("Ideas"), true);
  });

  it("refuses a file with no extension and writes nothing", async () => {
    const before = disk.listPaths();

    await rejectsWith(
      createNode(ctx, { parentId: null, name: "note", kind: "markdown" }),
      "BAD_REQUEST",
      "no extension"
    );

    assert.deepEqual(disk.listPaths(), before);
  });

  it("refuses an unsupported extension", async () => {
    await rejectsWith(
      createNode(ctx, { parentId: null, name: "note.bak", kind: "file" }),
      "BAD_REQUEST",
      "not a supported extension"
    );
  });

  it("refuses a name already taken in the folder, ignoring case", async () => {
    await rejectsWith(
      createNode(ctx, { parentId: null, name: "INDEX.html", kind: "file" }),
      "BAD_REQUEST",
      "already exists"
    );
  });

  it("refuses a name that would escape the folder", async () => {
    await rejectsWith(
      createNode(ctx, { parentId: null, name: "../evil.md", kind: "markdown" }),
      "BAD_REQUEST",
      "not a valid name"
    );
  });

  it("refuses a parent that is a file", async () => {
    const file = byPath(ctx.dataAccess.tree, "index.html");

    await rejectsWith(
      createNode(ctx, { parentId: file.id, name: "a.md", kind: "markdown" }),
      "BAD_REQUEST",
      "not a folder"
    );
  });
});

describe("renameNode", () => {
  it("renames a file on disk and keeps its id", async () => {
    const node = byPath(ctx.dataAccess.tree, "Inbox/reading-list.md");
    const nodes = await renameNode(ctx, node.id, "books.md");

    const renamed = nodes.find((candidate) => candidate.id === node.id);
    assert.equal(renamed?.name, "books.md");
    assert.equal(disk.exists("Inbox/books.md"), true);
    assert.equal(disk.exists("Inbox/reading-list.md"), false);
  });

  it("renames a folder and keeps everything inside it", async () => {
    const folder = byPath(ctx.dataAccess.tree, "Projects/harwex-notes");
    const child = byPath(ctx.dataAccess.tree, "Projects/harwex-notes/notes/deep/readme.markdown");

    const nodes = await renameNode(ctx, folder.id, "notes-app");

    assert.equal(disk.readText("Projects/notes-app/notes/deep/readme.markdown"), "Three levels down.\n");
    assert.equal(disk.exists("Projects/harwex-notes"), false);
    assert.ok(nodes.some((candidate) => candidate.id === child.id));

    const document = await fetchDocument(ctx, child.id);
    assert.equal(document.kind, "markdown");
  });

  it("changes the kind when the extension changes", async () => {
    const node = byPath(ctx.dataAccess.tree, "Inbox/reading-list.md");
    const nodes = await renameNode(ctx, node.id, "reading-list.excalidraw");

    assert.equal(nodes.find((candidate) => candidate.id === node.id)?.kind, "excalidraw");
  });

  it("refuses to leave a supported file unsupported", async () => {
    const node = byPath(ctx.dataAccess.tree, "Inbox/reading-list.md");

    await rejectsWith(renameNode(ctx, node.id, "reading-list.bak"), "BAD_REQUEST", "not a supported extension");
    assert.equal(disk.exists("Inbox/reading-list.md"), true);
  });

  it("renames an unsupported file freely", async () => {
    const node = byPath(ctx.dataAccess.tree, "archive.zip");
    await renameNode(ctx, node.id, "archive.tar");

    assert.equal(disk.exists("archive.tar"), true);
  });

  it("refuses a name already taken by a sibling", async () => {
    const node = byPath(ctx.dataAccess.tree, "Journal/2026-08-24.md");

    await rejectsWith(renameNode(ctx, node.id, "2026-08-26.md"), "BAD_REQUEST", "already exists");
  });
});

describe("moveNode", () => {
  it("moves a file into another folder", async () => {
    const node = byPath(ctx.dataAccess.tree, "Inbox/reading-list.md");
    const journal = byPath(ctx.dataAccess.tree, "Journal");

    const nodes = await moveNode(ctx, node.id, journal.id);

    assert.equal(nodes.find((candidate) => candidate.id === node.id)?.parentId, journal.id);
    assert.equal(disk.exists("Journal/reading-list.md"), true);
    assert.equal(disk.exists("Inbox/reading-list.md"), false);
  });

  it("moves a folder with everything inside it to the root", async () => {
    const folder = byPath(ctx.dataAccess.tree, "Projects/harwex-notes/notes");

    await moveNode(ctx, folder.id, null);

    assert.equal(disk.readText("notes/deep/readme.markdown"), "Three levels down.\n");
    assert.equal(disk.exists("Projects/harwex-notes/notes"), false);
  });

  it("does nothing when moved onto its own folder", async () => {
    const node = byPath(ctx.dataAccess.tree, "Inbox/reading-list.md");
    const inbox = byPath(ctx.dataAccess.tree, "Inbox");
    const before = disk.listPaths();

    await moveNode(ctx, node.id, inbox.id);

    assert.deepEqual(disk.listPaths(), before);
  });

  it("refuses to move a folder into itself or its child", async () => {
    const projects = byPath(ctx.dataAccess.tree, "Projects");
    const child = byPath(ctx.dataAccess.tree, "Projects/harwex-notes/notes");

    await rejectsWith(moveNode(ctx, projects.id, projects.id), "BAD_REQUEST", "inside itself");
    await rejectsWith(moveNode(ctx, projects.id, child.id), "BAD_REQUEST", "inside itself");
  });

  it("refuses a move into a folder that already holds that name", async () => {
    const { node } = await createNode(ctx, { parentId: null, name: "reading-list.md", kind: "markdown" });
    const inbox = byPath(ctx.dataAccess.tree, "Inbox");

    await rejectsWith(moveNode(ctx, node.id, inbox.id), "BAD_REQUEST", "already exists");
    assert.equal(disk.exists("reading-list.md"), true);
  });
});

describe("deleteNode", () => {
  it("deletes a file from disk and from the tree", async () => {
    const node = byPath(ctx.dataAccess.tree, "old-page.htm");
    const nodes = await deleteNode(ctx, node.id);

    assert.equal(nodes.some((candidate) => candidate.id === node.id), false);
    assert.equal(disk.exists("old-page.htm"), false);
  });

  it("deletes a folder with everything inside it", async () => {
    const folder = byPath(ctx.dataAccess.tree, "Projects");
    const nodes = await deleteNode(ctx, folder.id);

    assert.equal(nodes.some((candidate) => candidate.name === "overview.md"), false);
    assert.equal(disk.listPaths().some((entry) => entry.startsWith("Projects")), false);
  });
});

describe("disk failures", () => {
  it("reports the system reason and changes nothing in the tree", async () => {
    const node = byPath(ctx.dataAccess.tree, "old-page.htm");
    const before = await fetchTree(ctx);

    disk.rename = async () => {
      throw new Error("EACCES: permission denied");
    };

    await rejectsWith(renameNode(ctx, node.id, "page.htm"), "INTERNAL_SERVER_ERROR", "EACCES");
    assert.deepEqual(await fetchTree(ctx), before);
    assert.equal(disk.exists("old-page.htm"), true);
  });

  it("serialises concurrent mutations", async () => {
    const results = await Promise.all([
      createNode(ctx, { parentId: null, name: "a.md", kind: "markdown" }),
      createNode(ctx, { parentId: null, name: "b.md", kind: "markdown" }),
      createNode(ctx, { parentId: null, name: "c.md", kind: "markdown" }),
    ]);

    const nodes = await fetchTree(ctx);
    for (const { node } of results) {
      assert.ok(nodes.some((candidate) => candidate.id === node.id));
      assert.equal(disk.exists(node.name), true);
    }
  });
});
