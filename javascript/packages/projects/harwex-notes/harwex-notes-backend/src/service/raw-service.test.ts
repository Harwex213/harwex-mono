import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { TRPCError } from "@trpc/server";
import { FsDataAccess } from "../data-access/fs-data-access.js";
import { createMemoryVaultFs } from "../data-access/memory-vault-fs.js";
import { SAMPLE_VAULT, SAMPLE_VAULT_PATH } from "../data-access/sample-vault.js";
import { openStateDb } from "../data-access/state-db.js";
import { StateStore } from "../data-access/state-store.js";
import type { TContext } from "../trpc.js";
import { createNode, fetchDocument, updateDocument } from "./fs-service.js";
import { findNodeByRawPath, RAW_URL_PREFIX, readRawFile } from "./raw-service.js";

let ctx: TContext;
let dataAccess: FsDataAccess;

const nodeIdByRawPath = (rawPath: string): string => {
  const node = findNodeByRawPath(dataAccess.tree, rawPath);
  assert.ok(node, `"${rawPath}" is missing from the tree`);

  return node.id;
};

beforeEach(async () => {
  dataAccess = new FsDataAccess(createMemoryVaultFs(SAMPLE_VAULT_PATH, SAMPLE_VAULT), SAMPLE_VAULT_PATH);
  await dataAccess.preload();
  ctx = { dataAccess, stateStore: new StateStore(openStateDb(":memory:")) };
});

describe("raw files", () => {
  it("serves a file by its path inside the vault", async () => {
    const file = await readRawFile(dataAccess, "Media/site/style.css");

    assert.ok(file);
    assert.equal(file.name, "style.css");
    assert.match(new TextDecoder().decode(file.bytes), /background/);
  });

  it("serves binary content unchanged", async () => {
    const file = await readRawFile(dataAccess, "Media/blocks.png");

    assert.ok(file);
    assert.deepEqual([...file.bytes.subarray(1, 4)], [0x50, 0x4e, 0x47]);
  });

  it("decodes percent-encoded segments", async () => {
    await createNode(ctx, { parentId: null, name: "my page.html", kind: "file" });

    assert.ok(await readRawFile(dataAccess, "my%20page.html"));
  });

  it("finds nothing outside the vault, in excluded folders or for a folder", async () => {
    assert.equal(await readRawFile(dataAccess, "../etc/passwd"), null);
    assert.equal(await readRawFile(dataAccess, "Media/../index.html"), null);
    assert.equal(await readRawFile(dataAccess, "Media/%2e%2e/index.html"), null);
    assert.equal(await readRawFile(dataAccess, "Media%2Fsite%2Fstyle.css"), null);
    assert.equal(await readRawFile(dataAccess, "Media//blocks.png"), null);
    assert.equal(await readRawFile(dataAccess, "node_modules/some-package/index.js"), null);
    assert.equal(await readRawFile(dataAccess, "Media"), null);
    assert.equal(await readRawFile(dataAccess, "%E0%A4%A"), null);
  });
});

describe("image and html documents", () => {
  it("opens an image as a raw URL", async () => {
    const document = await fetchDocument(ctx, nodeIdByRawPath("Media/blocks.png"));

    assert.equal(document.kind, "image");
    if (document.kind === "image") {
      assert.ok(document.src.startsWith(`${RAW_URL_PREFIX}/Media/blocks.png?v=`));
    }
  });

  it("opens an html page as a raw URL with encoded segments", async () => {
    const { node } = await createNode(ctx, { parentId: null, name: "my page.html", kind: "file" });
    const document = await fetchDocument(ctx, node.id);

    assert.equal(document.kind, "html");
    if (document.kind === "html") {
      assert.ok(document.src.startsWith(`${RAW_URL_PREFIX}/my%20page.html?v=`));
    }
  });

  it("never writes an html page", async () => {
    const nodeId = nodeIdByRawPath("Media/site/index.html");

    await assert.rejects(updateDocument(ctx, { kind: "html", nodeId, src: "x" }), TRPCError);
  });

  it("refuses to create an image", async () => {
    await assert.rejects(
      createNode(ctx, { parentId: null, name: "new.png", kind: "file" }),
      /cannot create an image/
    );
  });
});
