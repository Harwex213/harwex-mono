// In-memory api for `yarn dev:mocked`. It mirrors the rules of the backend `fsStore`: same
// invariants, same messages, but nothing is persisted and every call waits a little so the
// loading states in the UI are visible.
import {
  DEFAULT_EXCALIDRAW_STYLE,
  EXCALIDRAW_DEFAULT_STYLE_SETTING,
  countTermOccurrences,
  pickExcalidrawStyle,
  readExcalidrawSearchText,
  readHtmlSearchText,
} from "@hw/harwex-notes-protocol";
import { DOCUMENTS, FS_NODES } from "./mock-data";
import { createMockStateApi, readMockNodePath } from "./mock-state-api";
import type { TApiClient } from "./api";
import type {
  TCreateNodeInput,
  TCreateNodeResult,
  TDocument,
  TExcalidrawStyle,
  TFsNode,
  TFsNodeKind,
} from "./types";

// tRPC serialises `readonly` away on the wire, so the client promises a mutable
// `scene.elements` while the protocol type keeps it readonly. The mock hands its data over
// under the client's type at the one place where the two meet.
type TDocumentOutput = Awaited<ReturnType<TApiClient["fs"]["document"]["query"]>>;

const TREE_LATENCY_MS = 240;
const DOCUMENT_LATENCY_MS = 320;
const MUTATION_LATENCY_MS = 140;
const SEARCH_LATENCY_MS = 180;

const HTML_DATA_URL_PREFIX = "data:text/html;charset=utf-8,";

// The text that content search looks at, by the same rules as the backend strategies:
// Markdown as written, only the typed text of a drawing, the visible text of a page. An
// image matches on its name alone (SRCH-5 to SRCH-7).
const readMockSearchText = (document: TDocument): string | null => {
  if (document.kind === "markdown" || document.kind === "text") {
    return document.text;
  }

  if (document.kind === "excalidraw") {
    return readExcalidrawSearchText(document.scene.elements);
  }

  if (document.kind === "html" && document.src.startsWith(HTML_DATA_URL_PREFIX)) {
    return readHtmlSearchText(decodeURIComponent(document.src.slice(HTML_DATA_URL_PREFIX.length)));
  }

  return null;
};

// The node kind of a file, by extension, as the backend's fs data access decides it. A
// rename that changes the extension changes the kind (VIEW-3).
const FILE_KIND_BY_EXTENSION: Readonly<Record<string, TFsNodeKind>> = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".txt": "text",
  ".excalidraw": "excalidraw",
  ".html": "html",
  ".htm": "html",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".webp": "image",
  ".svg": "image",
  ".bmp": "image",
  ".ico": "image",
  ".avif": "image",
};

const readMockFileKind = (name: string): TFsNodeKind => {
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0) {
    return "file";
  }

  return FILE_KIND_BY_EXTENSION[name.slice(dotIndex).toLowerCase()] ?? "file";
};

const delay = (ms: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms);
});

const createBlankDocument = (
  nodeId: string,
  name: string,
  kind: TFsNodeKind,
  style: TExcalidrawStyle
): TDocument | null => {
  if (kind === "markdown") {
    const title = name.replace(/\.md$/, "");

    return { kind: "markdown", nodeId, text: `# ${title}\n\nNothing here yet.\n` };
  }

  // A new text file is empty on disk too.
  if (kind === "text") {
    return { kind: "text", nodeId, text: "" };
  }

  if (kind === "excalidraw") {
    return { kind: "excalidraw", nodeId, scene: { elements: [], files: {}, appState: style } };
  }

  if (kind === "html") {
    return { kind: "html", nodeId, src: "data:text/html;charset=utf-8," };
  }

  return null;
};

// A folder and everything below it. The list is not sorted parent-first after a
// move, so the search repeats until no new child is picked up.
const collectSubtreeIds = (nodes: readonly TFsNode[], nodeId: string): ReadonlySet<string> => {
  const ids = new Set([nodeId]);
  let hasGrown = true;

  while (hasGrown) {
    hasGrown = false;

    for (const node of nodes) {
      if (node.parentId === null || ids.has(node.id)) {
        continue;
      }

      if (ids.has(node.parentId)) {
        ids.add(node.id);
        hasGrown = true;
      }
    }
  }

  return ids;
};

const readNode = (nodes: readonly TFsNode[], nodeId: string): TFsNode => {
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (node === undefined) {
    throw new Error(`No node was found for "${nodeId}"`);
  }

  return node;
};

const assertParent = (nodes: readonly TFsNode[], parentId: string | null) => {
  if (parentId === null) {
    return;
  }

  const parent = readNode(nodes, parentId);
  if (parent.kind !== "folder") {
    throw new Error(`"${parent.name}" is not a folder`);
  }
};

const assertFreeName = (
  nodes: readonly TFsNode[],
  parentId: string | null,
  name: string,
  selfId: string | null
): string => {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new Error("A name cannot be empty");
  }

  const isTaken = nodes.some((node) => {
    return node.parentId === parentId && node.name === trimmed && node.id !== selfId;
  });

  if (isTaken) {
    throw new Error(`"${trimmed}" already exists in this folder`);
  }

  return trimmed;
};

const createMockApi = (): TApiClient => {
  let nodes: readonly TFsNode[] = FS_NODES;
  let nextNodeIndex = 1;

  const documents: Record<string, TDocument> = { ...DOCUMENTS };

  const mockState = createMockStateApi();

  const fetchTree = async (): Promise<readonly TFsNode[]> => {
    await delay(TREE_LATENCY_MS);

    return nodes;
  };

  const fetchDocument = async ({ nodeId }: { nodeId: string }): Promise<TDocumentOutput> => {
    await delay(DOCUMENT_LATENCY_MS);

    const document = documents[nodeId];
    if (document === undefined) {
      throw new Error(`No document was found for "${nodeId}"`);
    }

    // The mock keeps parsed documents, so content renamed to another kind cannot be read
    // as that kind. The backend refuses such a file too (EX-5, VAULT-5). Markdown and plain
    // text are both text as written, so either one reads as the other (VIEW-3).
    const node = readNode(nodes, nodeId);
    const isTextRename =
      (node.kind === "markdown" || node.kind === "text") &&
      (document.kind === "markdown" || document.kind === "text");
    if (isTextRename && node.kind !== document.kind) {
      return { kind: node.kind, nodeId, text: document.text } as TDocumentOutput;
    }

    if (node.kind !== document.kind) {
      throw new Error(`"${node.name}" cannot be opened as ${node.kind}: its content is ${document.kind}`);
    }

    return document as TDocumentOutput;
  };

  const createNode = async (input: TCreateNodeInput): Promise<TCreateNodeResult> => {
    await delay(MUTATION_LATENCY_MS);

    assertParent(nodes, input.parentId);

    const name = assertFreeName(nodes, input.parentId, input.name, null);

    if (input.kind === "image") {
      throw new Error(`"${name}" is an image. The app cannot create an image file`);
    }

    const id = `node-${nextNodeIndex}`;
    nextNodeIndex += 1;

    const node: TFsNode = { id, parentId: input.parentId, name, kind: input.kind };

    const chosenStyle = pickExcalidrawStyle(mockState.readSetting(EXCALIDRAW_DEFAULT_STYLE_SETTING));
    const style = { ...DEFAULT_EXCALIDRAW_STYLE, ...chosenStyle };
    const document = createBlankDocument(id, name, input.kind, style);
    if (document !== null) {
      documents[id] = document;
    }

    nodes = [...nodes, node];

    return { nodes, node };
  };

  const renameNode = async ({
    nodeId,
    name,
  }: {
    nodeId: string;
    name: string;
  }): Promise<readonly TFsNode[]> => {
    await delay(MUTATION_LATENCY_MS);

    const node = readNode(nodes, nodeId);
    const nextName = assertFreeName(nodes, node.parentId, name, nodeId);
    const fromPath = readMockNodePath(nodes, nodeId);

    nodes = nodes.map((candidate) => {
      if (candidate.id !== nodeId) {
        return candidate;
      }

      const kind = candidate.kind === "folder" ? "folder" : readMockFileKind(nextName);

      return { ...candidate, name: nextName, kind };
    });

    mockState.followPathChange(fromPath, readMockNodePath(nodes, nodeId));

    return nodes;
  };

  const moveNode = async ({
    nodeId,
    parentId,
  }: {
    nodeId: string;
    parentId: string | null;
  }): Promise<readonly TFsNode[]> => {
    await delay(MUTATION_LATENCY_MS);

    const node = readNode(nodes, nodeId);
    if (node.parentId === parentId) {
      return nodes;
    }

    assertParent(nodes, parentId);

    if (parentId !== null && collectSubtreeIds(nodes, nodeId).has(parentId)) {
      throw new Error(`"${node.name}" cannot move inside itself`);
    }

    assertFreeName(nodes, parentId, node.name, nodeId);

    const fromPath = readMockNodePath(nodes, nodeId);

    nodes = nodes.map((candidate) => {
      if (candidate.id !== nodeId) {
        return candidate;
      }

      return { ...candidate, parentId };
    });

    mockState.followPathChange(fromPath, readMockNodePath(nodes, nodeId));

    return nodes;
  };

  const deleteNode = async ({ nodeId }: { nodeId: string }): Promise<readonly TFsNode[]> => {
    await delay(MUTATION_LATENCY_MS);

    readNode(nodes, nodeId);

    const removedIds = collectSubtreeIds(nodes, nodeId);

    mockState.followPathRemoval(readMockNodePath(nodes, nodeId));

    for (const removedId of removedIds) {
      delete documents[removedId];
    }

    nodes = nodes.filter((node) => !removedIds.has(node.id));

    return nodes;
  };

  // The mock never checks a version; it hands out new ones so saves look like the backend's.
  let nextVersion = 1;

  const updateDocument = async (document: TDocument): Promise<{ version: string }> => {
    await delay(MUTATION_LATENCY_MS);

    const node = readNode(nodes, document.nodeId);
    if (node.kind !== document.kind) {
      throw new Error(`"${node.name}" is not a ${document.kind} document`);
    }

    if (document.kind === "image" || document.kind === "html") {
      throw new Error(`A ${document.kind} file is read-only and cannot be saved`);
    }

    documents[document.nodeId] = document;

    const version = `mock-${nextVersion}`;
    nextVersion += 1;

    return { version };
  };

  // Writes a document back after its file was deleted on disk (SYNC-5). The mock vault is
  // never changed from outside, so this only mirrors the backend's contract.
  const restoreDocument = async ({ path, document }: { path: string; document: TDocument }) => {
    await delay(MUTATION_LATENCY_MS);

    if (document.kind === "image" || document.kind === "html") {
      throw new Error(`A ${document.kind} file is read-only and cannot be saved`);
    }

    const segments = path.split("/");
    const name = segments.pop() as string;

    if (readMockFileKind(name) !== document.kind) {
      throw new Error(`"${name}" is not a ${document.kind} document`);
    }

    let parentId: string | null = null;
    const nextNodes = [...nodes];

    for (const segment of segments) {
      const folderParentId: string | null = parentId;
      const existing: TFsNode | undefined = nextNodes.find((node) => {
        return node.parentId === folderParentId && node.name === segment && node.kind === "folder";
      });

      if (existing !== undefined) {
        parentId = existing.id;
        continue;
      }

      const folder: TFsNode = { id: `mock-restored-${nextNodeIndex}`, parentId, name: segment, kind: "folder" };
      nextNodeIndex += 1;
      nextNodes.push(folder);
      parentId = folder.id;
    }

    const node: TFsNode = { id: document.nodeId, parentId, name, kind: document.kind };
    nodes = [...nextNodes, node];
    documents[node.id] = document;

    const version = `mock-${nextVersion}`;
    nextVersion += 1;

    return { nodes, node, version };
  };

  // The mock vault never changes behind the app's back. The stream connects and stays quiet.
  const subscribeToChanges: TApiClient["fs"]["changes"]["subscribe"] = (_input, options) => {
    const timer = setTimeout(() => {
      options.onStarted?.({ context: undefined });
    }, TREE_LATENCY_MS);

    return {
      unsubscribe: () => {
        clearTimeout(timer);
      },
    };
  };

  const searchContent = async ({ term, nodeIds }: { term: string; nodeIds: string[] }) => {
    await delay(SEARCH_LATENCY_MS);

    const matches: { nodeId: string; count: number }[] = [];

    for (const nodeId of new Set(nodeIds)) {
      const document = documents[nodeId];
      const text = document === undefined ? null : readMockSearchText(document);
      const count = text === null ? 0 : countTermOccurrences(text, term);

      if (count > 0) {
        matches.push({ nodeId, count });
      }
    }

    return { matches };
  };

  // The same nested shape a tRPC client proxy exposes, so domain code cannot tell the
  // two implementations apart.
  return {
    fs: {
      tree: { query: fetchTree },
      document: { query: fetchDocument },
      updateDocument: { mutate: updateDocument },
      createNode: { mutate: createNode },
      renameNode: { mutate: renameNode },
      moveNode: { mutate: moveNode },
      deleteNode: { mutate: deleteNode },
      search: { query: searchContent },
      restoreDocument: { mutate: restoreDocument },
      changes: { subscribe: subscribeToChanges },
    },
    state: mockState.api,
    // The mock has no server, so an image loads from the data URL its document holds. An
    // empty URL makes the viewer show its missing-image placeholder (MD-5).
    raw: {
      url: ({ nodeId }) => {
        const document = documents[nodeId];

        return document !== undefined && document.kind === "image" ? document.src : "";
      },
    },
  };
};

export { createMockApi };
