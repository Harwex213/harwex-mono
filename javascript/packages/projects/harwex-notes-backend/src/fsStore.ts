import { TRPCError } from "@trpc/server";
import { SEED_DOCUMENTS, SEED_NODES } from "./seed.js";
import type {
  TCreateNodeInput,
  TCreateNodeResult,
  TDocument,
  TFsNode,
  TFsNodeKind,
} from "@hw/harwex-notes-protocol";

// Errors carry a message the frontend shows as is.
const badRequest = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });
const notFound = (message: string) => new TRPCError({ code: "NOT_FOUND", message });

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
    throw notFound(`No node was found for "${nodeId}"`);
  }

  return node;
};

const assertParent = (nodes: readonly TFsNode[], parentId: string | null) => {
  if (parentId === null) {
    return;
  }

  const parent = readNode(nodes, parentId);
  if (parent.kind !== "folder") {
    throw badRequest(`"${parent.name}" is not a folder`);
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
    throw badRequest("A name cannot be empty");
  }

  const isTaken = nodes.some((node) => {
    return node.parentId === parentId && node.name === trimmed && node.id !== selfId;
  });

  if (isTaken) {
    throw badRequest(`"${trimmed}" already exists in this folder`);
  }

  return trimmed;
};

const createBlankDocument = (nodeId: string, name: string, kind: TFsNodeKind): TDocument | null => {
  if (kind === "markdown") {
    const title = name.replace(/\.md$/, "");

    return { kind: "markdown", nodeId, text: `# ${title}\n\nNothing here yet.\n` };
  }

  if (kind === "excalidraw") {
    return { kind: "excalidraw", nodeId, scene: { elements: [], files: {} } };
  }

  return null;
};

const createFsStore = () => {
  let nodes: readonly TFsNode[] = SEED_NODES;
  const documents: Record<string, TDocument> = { ...SEED_DOCUMENTS };

  const fetchTree = (): readonly TFsNode[] => {
    return nodes;
  };

  const fetchDocument = (nodeId: string): TDocument => {
    const document = documents[nodeId];
    if (document === undefined) {
      throw notFound(`No document was found for "${nodeId}"`);
    }

    return document;
  };

  const createNode = (input: TCreateNodeInput): TCreateNodeResult => {
    assertParent(nodes, input.parentId);

    const name = assertFreeName(nodes, input.parentId, input.name, null);
    const id = crypto.randomUUID();
    const node: TFsNode = { id, parentId: input.parentId, name, kind: input.kind };

    const document = createBlankDocument(id, name, input.kind);
    if (document !== null) {
      documents[id] = document;
    }

    nodes = [...nodes, node];

    return { nodes, node };
  };

  const renameNode = (nodeId: string, name: string): readonly TFsNode[] => {
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

  const moveNode = (nodeId: string, parentId: string | null): readonly TFsNode[] => {
    const node = readNode(nodes, nodeId);
    if (node.parentId === parentId) {
      return nodes;
    }

    assertParent(nodes, parentId);

    if (parentId !== null && collectSubtreeIds(nodes, nodeId).has(parentId)) {
      throw badRequest(`"${node.name}" cannot move inside itself`);
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

  const deleteNode = (nodeId: string): readonly TFsNode[] => {
    readNode(nodes, nodeId);

    const removedIds = collectSubtreeIds(nodes, nodeId);
    for (const removedId of removedIds) {
      delete documents[removedId];
    }

    nodes = nodes.filter((node) => !removedIds.has(node.id));

    return nodes;
  };

  return { fetchTree, fetchDocument, createNode, renameNode, moveNode, deleteNode };
};

type TFsStore = ReturnType<typeof createFsStore>;

export { createFsStore };
export type { TFsStore };
