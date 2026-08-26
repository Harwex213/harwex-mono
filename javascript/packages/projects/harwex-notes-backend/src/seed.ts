import type { TDocument, TFsNode } from "@hw/harwex-notes-protocol";

const WELCOME_MARKDOWN = `# Welcome

This vault is served by \`harwex-notes-backend\`. Nothing is persisted between restarts yet.
`;

const SEED_NODES: readonly TFsNode[] = [
  { id: "notes", parentId: null, name: "Notes", kind: "folder" },
  { id: "notes/welcome.md", parentId: "notes", name: "welcome.md", kind: "markdown" },
  { id: "scratch.excalidraw", parentId: null, name: "scratch.excalidraw", kind: "excalidraw" },
];

const SEED_DOCUMENTS: Readonly<Record<string, TDocument>> = {
  "notes/welcome.md": {
    kind: "markdown",
    nodeId: "notes/welcome.md",
    text: WELCOME_MARKDOWN,
  },
  "scratch.excalidraw": {
    kind: "excalidraw",
    nodeId: "scratch.excalidraw",
    scene: { elements: [], files: {} },
  },
};

export { SEED_NODES, SEED_DOCUMENTS };
