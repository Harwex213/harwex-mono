// In-memory api for `yarn dev:mocked`. It mirrors the rules of the backend `fsStore`: same
// invariants, same messages, but nothing is persisted and every call waits a little so the
// loading states in the UI are visible.
import { DOCUMENTS, FS_NODES } from "./mock-data";
import type { TApiClient } from "./api";
import type {
  TCreateNodeInput,
  TCreateNodeResult,
  TDocument,
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

const delay = (ms: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms);
});

const createBlankDocument = (
  nodeId: string,
  name: string,
  kind: TFsNodeKind
): TDocument | null => {
  if (kind === "markdown") {
    const title = name.replace(/\.md$/, "");

    return { kind: "markdown", nodeId, text: `# ${title}\n\nNothing here yet.\n` };
  }

  if (kind === "excalidraw") {
    return { kind: "excalidraw", nodeId, scene: { elements: [], files: {} } };
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

    return document as TDocumentOutput;
  };

  const createNode = async (input: TCreateNodeInput): Promise<TCreateNodeResult> => {
    await delay(MUTATION_LATENCY_MS);

    assertParent(nodes, input.parentId);

    const name = assertFreeName(nodes, input.parentId, input.name, null);

    const id = `node-${nextNodeIndex}`;
    nextNodeIndex += 1;

    const node: TFsNode = { id, parentId: input.parentId, name, kind: input.kind };

    const document = createBlankDocument(id, name, input.kind);
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

    nodes = nodes.map((candidate) => {
      if (candidate.id !== nodeId) {
        return candidate;
      }

      return { ...candidate, name: nextName };
    });

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

    nodes = nodes.map((candidate) => {
      if (candidate.id !== nodeId) {
        return candidate;
      }

      return { ...candidate, parentId };
    });

    return nodes;
  };

  const deleteNode = async ({ nodeId }: { nodeId: string }): Promise<readonly TFsNode[]> => {
    await delay(MUTATION_LATENCY_MS);

    readNode(nodes, nodeId);

    const removedIds = collectSubtreeIds(nodes, nodeId);

    for (const removedId of removedIds) {
      delete documents[removedId];
    }

    nodes = nodes.filter((node) => !removedIds.has(node.id));

    return nodes;
  };

  const updateDocument = async (document: TDocument): Promise<null> => {
    await delay(MUTATION_LATENCY_MS);

    const node = readNode(nodes, document.nodeId);
    if (node.kind !== document.kind) {
      throw new Error(`"${node.name}" is not a ${document.kind} document`);
    }

    documents[document.nodeId] = document;

    return null;
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
    },
  };
};

export { createMockApi };
