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
  "archive.zip": "PK not really a zip",
  "broken.excalidraw": "{ this is not json",
  "node_modules/some-package/index.js": "module.exports = 1;",
  ".git/HEAD": "ref: refs/heads/main\n",
};

export { SAMPLE_VAULT, SAMPLE_VAULT_PATH };
