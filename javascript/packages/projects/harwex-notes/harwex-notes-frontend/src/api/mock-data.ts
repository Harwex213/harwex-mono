import architectureFile from "./sketches/architecture.excalidraw.json";
import economyFile from "./sketches/economy.excalidraw.json";
import scratchFile from "./sketches/scratch.excalidraw.json";
import type { TDocument, TExcalidrawScene, TFsNode } from "./types";

// The mock vault holds real `.excalidraw` files. Their format is richer than the type a
// JSON import infers, so a parsed file is asserted here the same way a reader of the real
// vault would have to assert it after `JSON.parse`.
const readSketch = (file: unknown): TExcalidrawScene => {
  const scene = file as Pick<TExcalidrawScene, "elements"> & Partial<TExcalidrawScene>;

  return { elements: scene.elements, files: scene.files ?? {} };
};

const FS_NODES: readonly TFsNode[] = [
  { id: "projects", parentId: null, name: "Projects", kind: "folder" },
  { id: "projects/harwex-notes", parentId: "projects", name: "harwex-notes", kind: "folder" },
  { id: "projects/harwex-notes/overview.md", parentId: "projects/harwex-notes", name: "overview.md", kind: "markdown" },
  { id: "projects/harwex-notes/architecture.excalidraw", parentId: "projects/harwex-notes", name: "architecture.excalidraw", kind: "excalidraw" },
  { id: "projects/ostrov", parentId: "projects", name: "ostrov", kind: "folder" },
  { id: "projects/ostrov/core-loop.md", parentId: "projects/ostrov", name: "core-loop.md", kind: "markdown" },
  { id: "projects/ostrov/economy.excalidraw", parentId: "projects/ostrov", name: "economy.excalidraw", kind: "excalidraw" },
  { id: "journal", parentId: null, name: "Journal", kind: "folder" },
  { id: "journal/2026-08-24.md", parentId: "journal", name: "2026-08-24.md", kind: "markdown" },
  { id: "journal/2026-08-26.md", parentId: "journal", name: "2026-08-26.md", kind: "markdown" },
  { id: "inbox", parentId: null, name: "Inbox", kind: "folder" },
  { id: "inbox/reading-list.md", parentId: "inbox", name: "reading-list.md", kind: "markdown" },
  { id: "inbox/todo.txt", parentId: "inbox", name: "todo.txt", kind: "text" },
  { id: "scratch.excalidraw", parentId: null, name: "scratch.excalidraw", kind: "excalidraw" },
  { id: "media", parentId: null, name: "Media", kind: "folder" },
  { id: "media/blocks.png", parentId: "media", name: "blocks.png", kind: "image" },
  { id: "media/logo.svg", parentId: "media", name: "logo.svg", kind: "image" },
  { id: "media/page.html", parentId: "media", name: "page.html", kind: "html" },
];

// The mock has no server to load files from, so images and pages are data URLs. A page
// therefore carries its style, script and image inline instead of by relative path.
const BLOCKS_PNG_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAAARklEQVR42u3OsQnAIAAEQIeyTx2wMIu4W0rXEgIpXeKxOrgBrrTxRay3RhQhISEhISEhocOha/aI/7kjhISEhISEhIQOhzZ5+JCIZkHAJgAAAABJRU5ErkJggg==";

const LOGO_SVG = [
  "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"240\" height=\"120\" viewBox=\"0 0 240 120\">",
  "<rect width=\"240\" height=\"120\" rx=\"16\" fill=\"#1d1c1a\"/>",
  "<circle cx=\"60\" cy=\"60\" r=\"32\" fill=\"#f2b134\"/>",
  "<text x=\"110\" y=\"68\" fill=\"#ffffff\" font-family=\"sans-serif\" font-size=\"22\">harwex</text>",
  "</svg>",
].join("");

const LOGO_SVG_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(LOGO_SVG)}`;

const PAGE_HTML = [
  "<!doctype html>",
  "<html lang=\"en\"><head><meta charset=\"utf-8\"><title>Sample page</title>",
  "<style>body { font-family: sans-serif; background: #fff8e6; color: #4a3b12; padding: 16px; }</style>",
  "</head><body>",
  "<h1>Sample page</h1>",
  `<img src="${LOGO_SVG_URL}" alt="logo">`,
  "<p id=\"script-status\">The script has not run.</p>",
  "<script>document.getElementById(\"script-status\").textContent = \"The script ran.\";</script>",
  "</body></html>",
].join("\n");

const PAGE_HTML_URL = `data:text/html;charset=utf-8,${encodeURIComponent(PAGE_HTML)}`;

const OVERVIEW_MARKDOWN = `# harwex-notes

A local-first notebook. Every note is a file on disk, so the vault stays
readable **without** the app.

## Why another notes app

- Markdown and Excalidraw live side by side in one tree.
- Tabs keep several notes open at once.
- No sync service, no lock-in — just a folder.

## Layers

1. \`api\` — talks to the vault. Mocked for now.
2. \`store\` — signals. The single source of truth.
3. \`domain\` — actions bound to the store through the registry.
4. \`ui\` — dumb components that read signals and call registry actions.

> The registry is the only way the UI reaches the domain. A component receives
> the slice of actions it needs and nothing else.

\`\`\`ts
const registry = createRegistry(store, api);
\`\`\`

## Next up

- [x] File tree with collapsible folders
- [x] Tab strip with close buttons
- [ ] Real filesystem adapter
- [ ] Full-text search across the vault

See the [architecture sketch](architecture.excalidraw) for the data flow.

---

Status: *prototype*. Nothing is persisted yet.
`;

const CORE_LOOP_MARKDOWN = `# Ostrov — core loop

## The minute

The player spends a minute on one island and leaves with a decision, not with
loot.

1. **Scout** — reveal two of the six tiles.
2. **Commit** — pick a single tile to work.
3. **Resolve** — the tile pays out, the tide rises.

## Tension

Every scout costs a tide step. The island floods after eight steps, so
information is never free.

| Action | Tide cost | Payout |
| --- | --- | --- |
| Scout | 1 | none |
| Work | 2 | resource |
| Camp | 0 | heal |

> A run should end because the player pushed one tile too far, never because
> the timer ran out.

## Open questions

- [ ] Does camping need a cap per island?
- [ ] Should the tide be visible before the first scout?
`;

const JOURNAL_24_MARKDOWN = `# 2026-08-24

## Done

- Read through the plain-architecture lab twice.
- Sketched the three-pane shell: tree, tabs, viewer.

## Notes

The registry pattern clicks once you stop thinking of it as dependency
injection. It is closer to *partial application*: \`bind(null, store, api)\`
freezes the plumbing and hands the UI a plain callback.

## Tomorrow

- [ ] Mock the vault
- [ ] Write the markdown renderer by hand
`;

const JOURNAL_26_MARKDOWN = `# 2026-08-26

Shipped the UI shell against a mock API.

## What went well

- The store stayed small: three slices and five computed values.
- \`computed\` removed every \`useMemo\` from the components.

## What hurt

- \`noUncheckedIndexedAccess\` catches a lot of lazy record access. Worth it.

\`\`\`ts
const entry = documents.entryById.value[nodeId];
if (entry === undefined) {
  return null;
}
\`\`\`

---

*Mood:* good.
`;

const READING_LIST_MARKDOWN = `# Reading list

## Queued

1. *A Philosophy of Software Design* — chapter on deep modules
2. *Data-Oriented Design* — the chapter on hot and cold fields
3. The CRDT paper everyone quotes but nobody reads

## Started

- [x] Local-first software (Kleppmann et al.)
- [ ] The Excalidraw source, \`roughjs\` in particular

## Links

- [Signals, explained](https://example.com/signals)
- [Rspack docs](https://example.com/rspack)

> Keep this list under ten items. A backlog longer than that is a wish, not a
> plan.

## Images

A path relative to this file, one from the vault root, and one that is not there:

![Logo](../Media/logo.svg)

![Blocks](/Media/blocks.png)

![Cover](covers/missing.png)
`;

// Plain text: the markup is not rendered, and the long line does not wrap (TXT-1, TXT-2).
const TODO_TEXT = [
  "# not a heading in a .txt file",
  "- renew the domain",
  "- **call** the bank",
  "",
  "A long line that keeps going far past the right edge of the pane, so the text editor scrolls sideways instead of wrapping it.",
  "",
].join("\n");

const DOCUMENTS: Readonly<Record<string, TDocument>> = {
  "projects/harwex-notes/overview.md": {
    kind: "markdown",
    nodeId: "projects/harwex-notes/overview.md",
    text: OVERVIEW_MARKDOWN,
  },
  "projects/harwex-notes/architecture.excalidraw": {
    kind: "excalidraw",
    nodeId: "projects/harwex-notes/architecture.excalidraw",
    scene: readSketch(architectureFile),
  },
  "projects/ostrov/core-loop.md": {
    kind: "markdown",
    nodeId: "projects/ostrov/core-loop.md",
    text: CORE_LOOP_MARKDOWN,
  },
  "projects/ostrov/economy.excalidraw": {
    kind: "excalidraw",
    nodeId: "projects/ostrov/economy.excalidraw",
    scene: readSketch(economyFile),
  },
  "journal/2026-08-24.md": {
    kind: "markdown",
    nodeId: "journal/2026-08-24.md",
    text: JOURNAL_24_MARKDOWN,
  },
  "journal/2026-08-26.md": {
    kind: "markdown",
    nodeId: "journal/2026-08-26.md",
    text: JOURNAL_26_MARKDOWN,
  },
  "inbox/reading-list.md": {
    kind: "markdown",
    nodeId: "inbox/reading-list.md",
    text: READING_LIST_MARKDOWN,
  },
  "inbox/todo.txt": {
    kind: "text",
    nodeId: "inbox/todo.txt",
    text: TODO_TEXT,
  },
  "scratch.excalidraw": {
    kind: "excalidraw",
    nodeId: "scratch.excalidraw",
    scene: readSketch(scratchFile),
  },
  "media/blocks.png": {
    kind: "image",
    nodeId: "media/blocks.png",
    src: BLOCKS_PNG_URL,
  },
  "media/logo.svg": {
    kind: "image",
    nodeId: "media/logo.svg",
    src: LOGO_SVG_URL,
  },
  "media/page.html": {
    kind: "html",
    nodeId: "media/page.html",
    src: PAGE_HTML_URL,
  },
};

export { DOCUMENTS, FS_NODES };
