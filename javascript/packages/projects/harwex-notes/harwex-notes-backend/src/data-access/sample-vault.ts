import type { TMemoryVaultSeed } from "./memory-vault-fs.js";

// A vault that satisfies the conformance walk of the spec: one file of every supported
// kind, one unsupported file, folders nested three deep, and generated folders that must
// stay hidden (VAULT-8).
const SAMPLE_VAULT_PATH = "/virtual/vault";

const SAMPLE_SKETCH = {
  type: "excalidraw",
  version: 2,
  source: "https://excalidraw.com",
  elements: [
    {
      id: "title",
      type: "text",
      x: 0,
      y: 0,
      width: 220,
      height: 25,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 1,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: 1,
      version: 1,
      versionNonce: 1,
      isDeleted: false,
      boundElements: null,
      updated: 1,
      link: null,
      locked: false,
      text: "vault -> tree -> tabs",
      originalText: "vault -> tree -> tabs",
      fontSize: 20,
      fontFamily: 1,
      textAlign: "left",
      verticalAlign: "top",
      containerId: null,
      lineHeight: 1.25,
    },
  ],
  appState: { viewBackgroundColor: "#ffffff" },
  files: {},
};

// A 48 x 32 PNG of four coloured blocks. The image viewer reports its size (IMG-4).
const SAMPLE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAAARklEQVR42u3OsQnAIAAEQIeyTx2wMIu4W0rXEgIpXeKxOrgBrrTxRay3RhQhISEhISEhocOha/aI/7kjhISEhISEhIQOhzZ5+JCIZkHAJgAAAABJRU5ErkJggg==";

const SAMPLE_SVG = [
  "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"240\" height=\"120\" viewBox=\"0 0 240 120\">",
  "<rect width=\"240\" height=\"120\" rx=\"16\" fill=\"#1d1c1a\"/>",
  "<circle cx=\"60\" cy=\"60\" r=\"32\" fill=\"#f2b134\"/>",
  "<text x=\"110\" y=\"68\" fill=\"#ffffff\" font-family=\"sans-serif\" font-size=\"22\">harwex</text>",
  "</svg>",
].join("");

// A page with a relative stylesheet, image and script, the way HTML-2 and HTML-3 test it.
const SAMPLE_SITE_HTML = [
  "<!doctype html>",
  "<html lang=\"en\">",
  "<head>",
  "<meta charset=\"utf-8\">",
  "<title>Sample site</title>",
  "<link rel=\"stylesheet\" href=\"style.css\">",
  "</head>",
  "<body>",
  "<h1>Sample site</h1>",
  "<p>The stylesheet, the logo and the script load from the vault by relative paths.</p>",
  "<img src=\"assets/logo.svg\" alt=\"logo\">",
  "<p id=\"script-status\">The script has not run.</p>",
  "<script src=\"script.js\"></script>",
  "</body>",
  "</html>",
].join("\n");

const SAMPLE_SITE_CSS = "body {\n  font-family: sans-serif;\n  background: #fff8e6;\n  color: #4a3b12;\n}\n";

const SAMPLE_SITE_JS =
  "document.getElementById(\"script-status\").textContent = \"The script ran.\";\n";

const SAMPLE_VAULT: TMemoryVaultSeed = {
  "Projects/harwex-notes/overview.md": "# harwex-notes\n\nA local-first notebook.\n",
  "Projects/harwex-notes/architecture.excalidraw": JSON.stringify(SAMPLE_SKETCH, null, 2),
  "Projects/harwex-notes/notes/todo.txt": "- wire the real vault\r\n- search\r\n",
  "Projects/harwex-notes/notes/deep/readme.markdown": "Three levels down.\n",
  "Projects/ostrov/core-loop.md": "# Ostrov\n\nOne minute, one decision.\n",
  "Journal/2026-08-24.md": "Started the backend.\n",
  "Journal/2026-08-26.md": "Read the spec twice.\n",
  "Inbox/reading-list.md": "- Designing Data-Intensive Applications\n",
  "Inbox/empty": null,
  "index.html": "<!doctype html><title>Vault</title><p>Rendered, never edited.</p>",
  "old-page.htm": "<p>Legacy page.</p>",
  "Media/blocks.png": Buffer.from(SAMPLE_PNG_BASE64, "base64"),
  "Media/logo.svg": SAMPLE_SVG,
  "Media/site/index.html": SAMPLE_SITE_HTML,
  "Media/site/style.css": SAMPLE_SITE_CSS,
  "Media/site/script.js": SAMPLE_SITE_JS,
  "Media/site/assets/logo.svg": SAMPLE_SVG,
  "archive.zip": "PK not really a zip",
  "broken.excalidraw": "{ this is not json",
  "node_modules/some-package/index.js": "module.exports = 1;",
  ".git/HEAD": "ref: refs/heads/main\n",
};

export { SAMPLE_VAULT, SAMPLE_VAULT_PATH };
