import { randomUUID } from "node:crypto";
import path from "node:path";
import { TRPCError } from "@trpc/server";
import type { TDocument, TExcalidrawScene, TFsNode, TFsNodeKind } from "@hw/harwex-notes-protocol";
import { readFileKind } from "../data-access/fs-data-access.js";
import type { FsDataAccess } from "../data-access/fs-data-access.types.js";
import type { TContext } from "../trpc.js";
import type {
  TCreateNode,
  TDeleteNode,
  TFetchDocument,
  TFetchTree,
  TMoveNode,
  TRenameNode,
  TUpdateDocument,
} from "./fs-service.types.js";

const SUPPORTED_EXTENSIONS: ReadonlySet<string> = new Set([
  ".excalidraw",
  ".md",
  ".markdown",
  ".txt",
  ".html",
  ".htm",
]);

const MAX_DOCUMENT_MEGABYTES = 128;
const MAX_DOCUMENT_BYTES = MAX_DOCUMENT_MEGABYTES * 1024 * 1024;

const badRequest = (message: string) => new TRPCError({ code: "BAD_REQUEST", message });
const notFound = (message: string) => new TRPCError({ code: "NOT_FOUND", message });

const describeSystemError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

const diskFailure = (error: unknown) => {
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: describeSystemError(error),
    cause: error,
  });
};

const isSupportedName = (name: string) => {
  return SUPPORTED_EXTENSIONS.has(path.extname(name).toLowerCase());
};

const readNode = (nodes: readonly TFsNode[], nodeId: string): TFsNode => {
  const node = nodes.find((candidate) => candidate.id === nodeId);
  if (node === undefined) {
    throw notFound(`No node was found for "${nodeId}"`);
  }

  return node;
};

const isFolder = (node: TFsNode) => node.kind === "folder";

const assertParent = (nodes: readonly TFsNode[], parentId: string | null) => {
  if (parentId === null) {
    return;
  }

  const parent = readNode(nodes, parentId);
  if (!isFolder(parent)) {
    throw badRequest(`"${parent.name}" is not a folder`);
  }
};

const assertValidName = (name: string): string => {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw badRequest("A name cannot be empty");
  }

  if (trimmed === "." || trimmed === ".." || /[/\\]/.test(trimmed) || trimmed.includes("\0")) {
    throw badRequest(`"${trimmed}" is not a valid name`);
  }

  return trimmed;
};

const assertFreeName = (
  nodes: readonly TFsNode[],
  parentId: string | null,
  name: string,
  selfId: string | null
) => {
  const isTaken = nodes.some((node) => {
    return (
      node.parentId === parentId &&
      node.id !== selfId &&
      node.name.toLowerCase() === name.toLowerCase()
    );
  });

  if (isTaken) {
    throw badRequest(`"${name}" already exists in this folder`);
  }
};

const assertSupportedFileName = (name: string) => {
  if (isSupportedName(name)) {
    return;
  }

  const extension = path.extname(name);
  if (extension.length === 0) {
    throw badRequest(`"${name}" has no extension. A file name needs one of: ${[...SUPPORTED_EXTENSIONS].join(", ")}`);
  }

  throw badRequest(`"${extension}" is not a supported extension. Use one of: ${[...SUPPORTED_EXTENSIONS].join(", ")}`);
};

const collectSubtreeIds = (nodes: readonly TFsNode[], nodeId: string): ReadonlySet<string> => {
  const childrenByParent = new Map<string, TFsNode[]>();

  for (const node of nodes) {
    if (node.parentId === null) {
      continue;
    }

    const siblings = childrenByParent.get(node.parentId) ?? [];
    siblings.push(node);
    childrenByParent.set(node.parentId, siblings);
  }

  const ids = new Set<string>();
  const pending = [nodeId];

  while (pending.length > 0) {
    const currentId = pending.pop() as string;
    ids.add(currentId);

    for (const child of childrenByParent.get(currentId) ?? []) {
      pending.push(child.id);
    }
  }

  return ids;
};

const BLANK_EXCALIDRAW_FILE: Readonly<Record<string, unknown>> = {
  type: "excalidraw",
  version: 2,
  source: "harwex-notes",
  elements: [],
  appState: { viewBackgroundColor: "#ffffff" },
  files: {},
};

const encodeExcalidrawFile = (file: Record<string, unknown>): Uint8Array => {
  return new TextEncoder().encode(JSON.stringify(file, null, 2));
};

const createBlankContent = (kind: TFsNodeKind): Uint8Array => {
  if (kind === "excalidraw") {
    return encodeExcalidrawFile({ ...BLANK_EXCALIDRAW_FILE });
  }

  return new Uint8Array();
};

const decodeText = (bytes: Uint8Array, name: string): string => {
  if (bytes.includes(0)) {
    throw badRequest(`"${name}" is not a text file`);
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw badRequest(`"${name}" is not a text file`);
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const parseExcalidrawScene = (text: string, name: string): TExcalidrawScene => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw badRequest(`"${name}" is not a valid drawing: the file is not JSON`);
  }

  if (!isRecord(parsed) || !Array.isArray(parsed["elements"])) {
    throw badRequest(`"${name}" is not a valid drawing: it has no list of elements`);
  }

  const elements = parsed["elements"].filter(isRecord);
  if (elements.length !== parsed["elements"].length) {
    throw badRequest(`"${name}" is not a valid drawing: an element is not an object`);
  }

  const files = parsed["files"];
  if (files !== undefined && !isRecord(files)) {
    throw badRequest(`"${name}" is not a valid drawing: "files" is not an object`);
  }

  return { elements, files: files ?? {} };
};

const readTree = (dataAccess: FsDataAccess): readonly TFsNode[] => [...dataAccess.tree];

const mutateTree = async <T>(
  dataAccess: FsDataAccess,
  edit: (nodes: readonly TFsNode[]) => { nodes: TFsNode[]; result: T; after?: () => Promise<void> }
): Promise<T> => {
  return dataAccess.runExclusive(async () => {
    const { nodes, result, after } = edit(dataAccess.tree);

    dataAccess.tree = nodes;

    try {
      await dataAccess.flush();
      await after?.();
    } catch (error) {
      if (error instanceof TRPCError) {
        throw error;
      }

      throw diskFailure(error);
    }

    return result;
  });
};

const fetchTree: TFetchTree = async (ctx) => {
  return readTree(ctx.dataAccess);
};

const fetchDocument: TFetchDocument = async (ctx, nodeId) => {
  const node = readNode(ctx.dataAccess.tree, nodeId);

  if (node.kind !== "markdown" && node.kind !== "excalidraw") {
    throw badRequest(`"${node.name}" cannot be opened: "${path.extname(node.name)}" is not a supported extension`);
  }

  let bytes: Uint8Array;

  try {
    const size = await ctx.dataAccess.readFileSize(nodeId);
    if (size > MAX_DOCUMENT_BYTES) {
      throw badRequest(`"${node.name}" is larger than ${MAX_DOCUMENT_MEGABYTES} MB and cannot be opened`);
    }

    bytes = await ctx.dataAccess.readFile(nodeId);
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }

    throw diskFailure(error);
  }

  const text = decodeText(bytes, node.name);

  if (node.kind === "markdown") {
    return { kind: "markdown", nodeId, text };
  }

  return { kind: "excalidraw", nodeId, scene: parseExcalidrawScene(text, node.name) };
};

// Keeps whatever else the file on disk holds (appState, version, source) and replaces
// only the elements and files. A file that does not parse starts from the blank envelope.
const readExcalidrawEnvelope = (bytes: Uint8Array): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));

    return isRecord(parsed) ? parsed : { ...BLANK_EXCALIDRAW_FILE };
  } catch {
    return { ...BLANK_EXCALIDRAW_FILE };
  }
};

const encodeDocument = async (ctx: TContext, document: TDocument): Promise<Uint8Array> => {
  if (document.kind === "markdown") {
    return new TextEncoder().encode(document.text);
  }

  const envelope = readExcalidrawEnvelope(await ctx.dataAccess.readFile(document.nodeId));

  return encodeExcalidrawFile({
    ...envelope,
    elements: document.scene.elements,
    files: document.scene.files,
  });
};

const updateDocument: TUpdateDocument = async (ctx, document) => {
  // Runs under the same lock as tree mutations, so a rename cannot slip between reading
  // the node and writing its file.
  await ctx.dataAccess.runExclusive(async () => {
    const node = readNode(ctx.dataAccess.tree, document.nodeId);

    if (node.kind !== document.kind) {
      throw badRequest(`"${node.name}" is not a ${document.kind} document`);
    }

    try {
      const bytes = await encodeDocument(ctx, document);

      if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
        throw badRequest(`"${node.name}" would be larger than ${MAX_DOCUMENT_MEGABYTES} MB and cannot be saved`);
      }

      await ctx.dataAccess.writeFile(node.id, bytes);
    } catch (error) {
      if (error instanceof TRPCError) {
        throw error;
      }

      throw diskFailure(error);
    }
  });
};

const createNode: TCreateNode = async (ctx, input) => {
  return mutateTree(ctx.dataAccess, (nodes) => {
    assertParent(nodes, input.parentId);

    const name = assertValidName(input.name);
    const kind: TFsNodeKind = input.kind === "folder" ? "folder" : readFileKind(name);

    if (kind !== "folder") {
      assertSupportedFileName(name);
    }

    assertFreeName(nodes, input.parentId, name, null);

    const node: TFsNode = { id: randomUUID(), parentId: input.parentId, name, kind };
    const nextNodes = [...nodes, node];

    const after = async () => {
      if (kind === "folder") {
        return;
      }

      await ctx.dataAccess.writeFile(node.id, createBlankContent(kind));
    };

    return { nodes: nextNodes, result: { nodes: nextNodes, node }, after };
  });
};

const renameNode: TRenameNode = async (ctx, nodeId, name) => {
  return mutateTree(ctx.dataAccess, (nodes) => {
    const node = readNode(nodes, nodeId);
    const nextName = assertValidName(name);

    if (nextName === node.name) {
      return { nodes: [...nodes], result: nodes };
    }

    // Renaming may not leave a supported file unsupported. A file that was never
    // openable renames freely (MUT-7).
    if (!isFolder(node) && isSupportedName(node.name)) {
      assertSupportedFileName(nextName);
    }

    assertFreeName(nodes, node.parentId, nextName, nodeId);

    const kind: TFsNodeKind = isFolder(node) ? "folder" : readFileKind(nextName);

    const nextNodes = nodes.map((candidate) => {
      if (candidate.id !== nodeId) {
        return candidate;
      }

      return { ...candidate, name: nextName, kind };
    });

    return { nodes: nextNodes, result: nextNodes };
  });
};

const moveNode: TMoveNode = async (ctx, nodeId, parentId) => {
  return mutateTree(ctx.dataAccess, (nodes) => {
    const node = readNode(nodes, nodeId);

    if (node.parentId === parentId) {
      return { nodes: [...nodes], result: nodes };
    }

    assertParent(nodes, parentId);

    if (parentId !== null && collectSubtreeIds(nodes, nodeId).has(parentId)) {
      throw badRequest(`"${node.name}" cannot move inside itself`);
    }

    assertFreeName(nodes, parentId, node.name, nodeId);

    const nextNodes = nodes.map((candidate) => {
      if (candidate.id !== nodeId) {
        return candidate;
      }

      return { ...candidate, parentId };
    });

    return { nodes: nextNodes, result: nextNodes };
  });
};

const deleteNode: TDeleteNode = async (ctx, nodeId) => {
  return mutateTree(ctx.dataAccess, (nodes) => {
    readNode(nodes, nodeId);

    const removedIds = collectSubtreeIds(nodes, nodeId);
    const nextNodes = nodes.filter((node) => !removedIds.has(node.id));

    return { nodes: nextNodes, result: nextNodes };
  });
};

export {
  MAX_DOCUMENT_BYTES,
  fetchTree,
  fetchDocument,
  updateDocument,
  createNode,
  renameNode,
  moveNode,
  deleteNode,
};
