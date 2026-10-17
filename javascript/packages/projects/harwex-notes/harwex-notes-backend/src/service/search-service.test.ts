import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { countTermOccurrences, readExcalidrawSearchText, readHtmlSearchText } from "@hw/harwex-notes-protocol";
import { FsDataAccess } from "../data-access/fs-data-access.js";
import { createMemoryVaultFs } from "../data-access/memory-vault-fs.js";
import { openStateDb } from "../data-access/state-db.js";
import { StateStore } from "../data-access/state-store.js";
import { MAX_SEARCH_FILE_BYTES, searchContent } from "./search-service.js";
import type { TFsNode } from "@hw/harwex-notes-protocol";
import type { TMemoryVaultSeed } from "../data-access/memory-vault-fs.js";
import type { TContext } from "../trpc.js";

const VAULT_PATH = "/virtual/search-vault";

const textElement = (id: string, text: string, extra: Record<string, unknown> = {}) => {
  return { id, type: "text", text, originalText: text, strokeColor: "#1e1e1e", ...extra };
};

const DRAWING = JSON.stringify({
  type: "excalidraw",
  version: 2,
  elements: [
    textElement("label-1", "Kiwi pipeline"),
    // A shape label is wrapped at the shape width; the original text has no break.
    { id: "label-2", type: "text", text: "kiwi\nharvest", originalText: "kiwi harvest" },
    textElement("label-3", "kiwi gone", { isDeleted: true }),
    { id: "kiwi-rect", type: "rectangle", strokeColor: "#kiwi00", customData: { note: "kiwi" } },
    { id: "frame-1", type: "frame", name: "Kiwi frame" },
  ],
  appState: { viewBackgroundColor: "#kiwi" },
  files: {},
});

const PAGE = [
  "<!doctype html>",
  "<html><head><title>Kiwi title</title>",
  "<style>.kiwi { color: red; }</style>",
  "<script>const kiwi = 1;</script>",
  "</head><body>",
  "<!-- kiwi comment -->",
  "<p class=\"kiwi\">A <b>ki</b>wi &amp; a KIWI</p>",
  "<p>Fish &lt;kiwi&gt;</p>",
  "</body></html>",
].join("\n");

const SEED: TMemoryVaultSeed = {
  "notes/fruit.md": "# Kiwi\n\nA kiwi is a fruit. **KIWI**!\n",
  "notes/plain.txt": "kiwi kiwi kiwi\n",
  "notes/none.md": "Nothing here.\n",
  "notes/sketch.excalidraw": DRAWING,
  "notes/broken.excalidraw": "{ kiwi is not json",
  "site/page.html": PAGE,
  "media/kiwi-free.png": "kiwi kiwi",
  "media/logo.svg": "<svg><text>kiwi</text></svg>",
  "data/kiwi.csv": "kiwi,kiwi\n",
  "data/binary.md": new Uint8Array([107, 105, 119, 105, 0, 1, 2]),
  "data/huge.md": `kiwi${" ".repeat(MAX_SEARCH_FILE_BYTES)}`,
  "node_modules/pkg/readme.md": "kiwi",
};

let ctx: TContext;

const idOf = (relativePath: string): string => {
  let parentId: string | null = null;
  let id = "";

  for (const segment of relativePath.split("/")) {
    const parentOfSegment: string | null = parentId;
    const node: TFsNode | undefined = ctx.dataAccess.tree.find((candidate) => {
      return candidate.parentId === parentOfSegment && candidate.name === segment;
    });
    assert.ok(node, `"${relativePath}" is missing at "${segment}"`);
    id = node.id;
    parentId = node.id;
  }

  return id;
};

const countIn = async (relativePath: string, term = "kiwi"): Promise<number> => {
  const { matches } = await searchContent(ctx, { term, nodeIds: [idOf(relativePath)] });

  return matches[0]?.count ?? 0;
};

beforeEach(async () => {
  const dataAccess = new FsDataAccess(createMemoryVaultFs(VAULT_PATH, SEED), VAULT_PATH);
  await dataAccess.preload();
  ctx = { dataAccess, stateStore: new StateStore(openStateDb(":memory:")) };
});

describe("countTermOccurrences", () => {
  it("ignores case and counts occurrences that do not overlap", () => {
    assert.equal(countTermOccurrences("Kiwi KIWI kiwi", "kIwI"), 3);
    assert.equal(countTermOccurrences("aaaa", "aa"), 2);
    assert.equal(countTermOccurrences("abc", ""), 0);
  });

  it("takes the term as plain text, not as a pattern", () => {
    assert.equal(countTermOccurrences("a.b axb", "a.b"), 1);
    assert.equal(countTermOccurrences("(x)* (x)*", "(x)*"), 2);
  });
});

describe("markdown and plain text", () => {
  it("counts the term in a Markdown file as written", async () => {
    assert.equal(await countIn("notes/fruit.md"), 3);
  });

  it("counts the term in a .txt file", async () => {
    assert.equal(await countIn("notes/plain.txt"), 3);
  });

  it("leaves out a file that does not hold the term", async () => {
    assert.equal(await countIn("notes/none.md"), 0);
  });
});

describe("drawings", () => {
  it("searches only the text typed into the drawing (SRCH-6)", async () => {
    // Two text elements and the frame name. Not the deleted element, ids, colours or custom data.
    assert.equal(await countIn("notes/sketch.excalidraw"), 3);
    assert.equal(await countIn("notes/sketch.excalidraw", "#1e1e1e"), 0);
    assert.equal(await countIn("notes/sketch.excalidraw", "label-1"), 0);
  });

  it("searches the original text of a wrapped label", async () => {
    assert.equal(await countIn("notes/sketch.excalidraw", "kiwi harvest"), 1);
  });

  it("matches a drawing that does not parse on its name alone", async () => {
    assert.equal(await countIn("notes/broken.excalidraw"), 0);
  });

  it("reads text elements and frame names from a list of elements", () => {
    const text = readExcalidrawSearchText([
      textElement("a", "one"),
      { id: "b", type: "frame", name: "two" },
      { id: "c", type: "arrow" },
      "not an element",
    ]);
    assert.equal(text, "one\ntwo");
  });
});

describe("HTML pages", () => {
  it("searches the visible text only, without tags, scripts, styles or the title", async () => {
    // "kiwi" split by <b>, "KIWI", and "<kiwi>" from the entities.
    assert.equal(await countIn("site/page.html"), 3);
  });

  it("decodes entities and keeps blocks apart", () => {
    const text = readHtmlSearchText("<p>A &amp; B</p><p>C&#33;&#x21;</p>");
    assert.equal(countTermOccurrences(text, "a & b"), 1);
    assert.equal(countTermOccurrences(text, "bc"), 0);
    assert.equal(countTermOccurrences(text, "c!!"), 1);
  });
});

describe("files that cannot be opened (SRCH-7)", () => {
  it("never searches an image, SVG included", async () => {
    assert.equal(await countIn("media/kiwi-free.png"), 0);
    assert.equal(await countIn("media/logo.svg"), 0);
  });

  it("never searches an unsupported extension", async () => {
    assert.equal(await countIn("data/kiwi.csv"), 0);
  });

  it("never searches a file that is not text", async () => {
    assert.equal(await countIn("data/binary.md"), 0);
  });

  it("never searches a file above the size limit", async () => {
    assert.equal(await countIn("data/huge.md"), 0);
  });
});

describe("searchContent", () => {
  it("answers with a count for every matching file and skips the rest", async () => {
    const nodeIds = ctx.dataAccess.tree.map((node) => node.id);
    const { matches } = await searchContent(ctx, { term: "KIWI", nodeIds });
    const countById = new Map(matches.map((match) => [match.nodeId, match.count]));

    assert.equal(countById.get(idOf("notes/fruit.md")), 3);
    assert.equal(countById.get(idOf("notes/plain.txt")), 3);
    assert.equal(countById.get(idOf("notes/sketch.excalidraw")), 3);
    assert.equal(countById.get(idOf("site/page.html")), 3);
    assert.equal(matches.length, 4);
  });

  it("skips ids that are not in the tree, such as a file deleted mid-search", async () => {
    const { matches } = await searchContent(ctx, { term: "kiwi", nodeIds: ["gone", idOf("notes/plain.txt")] });

    assert.deepEqual(matches, [{ nodeId: idOf("notes/plain.txt"), count: 3 }]);
  });

  it("never searches an excluded folder (SRCH-8)", () => {
    assert.equal(ctx.dataAccess.tree.some((node) => node.name === "node_modules"), false);
  });

  it("does not change any file (SRCH-18)", async () => {
    const before = await ctx.dataAccess.readFile(idOf("notes/fruit.md"));
    await searchContent(ctx, { term: "kiwi", nodeIds: [idOf("notes/fruit.md")] });

    assert.deepEqual(await ctx.dataAccess.readFile(idOf("notes/fruit.md")), before);
  });
});
