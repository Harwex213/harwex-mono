import { randomUUID } from "node:crypto";
import path from "node:path";
import { TRPCError } from "@trpc/server";
import {
  DEFAULT_EXCALIDRAW_STYLE,
  EXCALIDRAW_DEFAULT_STYLE_SETTING,
  pickExcalidrawStyle,
} from "@hw/harwex-notes-protocol";
import type {
  TDocument,
  TExcalidrawScene,
  TExcalidrawStyle,
  TFsNode,
  TFsNodeKind,
  TUpdateDocumentResult,
} from "@hw/harwex-notes-protocol";
import { readFileKind } from "../data-access/fs-data-access.js";
import type { FsDataAccess } from "../data-access/fs-data-access.types.js";
import { buildRawUrl } from "./raw-service.js";
import { fetchSetting, followPathChange, followPathRemoval, readNodePath } from "./state-service.js";
import type { TContext } from "../trpc.js";
import type {
  TCreateNode,
  TDeleteNode,
  TFetchDocument,
  TFetchTree,
  TMoveNode,
  TRenameNode,
  TRestoreDocument,
  TUpdateDocument,
} from "./fs-service.types.js";

const SUPPORTED_EXTENSIONS: ReadonlySet<string> = new Set([
  ".excalidraw",
  ".md",
  ".markdown",
  ".txt",
  ".html",
  ".htm",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
  ".ico",
  ".avif",
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

// The style a new drawing starts with: the user's default (SET-2) over the app's own. A
// state database that cannot be read leaves the app's own style (SESS-8).
const readNewDrawingStyle = (ctx: TContext): TExcalidrawStyle => {
  let chosen: TExcalidrawStyle = {};

  try {
    chosen = pickExcalidrawStyle(fetchSetting(ctx, EXCALIDRAW_DEFAULT_STYLE_SETTING));
  } catch (error) {
    console.error(`Cannot read the default drawing style: ${describeSystemError(error)}`);
  }

  return { ...DEFAULT_EXCALIDRAW_STYLE, ...chosen };
};

const createBlankContent = (ctx: TContext, kind: TFsNodeKind): Uint8Array => {
  if (kind === "excalidraw") {
    const blankAppState = BLANK_EXCALIDRAW_FILE["appState"] as Record<string, unknown>;
    const appState = { ...blankAppState, ...readNewDrawingStyle(ctx) };

    return encodeExcalidrawFile({ ...BLANK_EXCALIDRAW_FILE, appState });
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

  return { elements, files: files ?? {}, appState: pickExcalidrawStyle(parsed["appState"]) };
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

  if (node.kind === "folder" || node.kind === "file") {
    throw badRequest(`"${node.name}" cannot be opened: "${path.extname(node.name)}" is not a supported extension`);
  }

  let bytes: Uint8Array;
  let version: string | undefined;

  try {
    const size = await ctx.dataAccess.readFileSize(nodeId);
    if (size > MAX_DOCUMENT_BYTES) {
      throw badRequest(`"${node.name}" is larger than ${MAX_DOCUMENT_MEGABYTES} MB and cannot be opened`);
    }

    // Read before the content, so a change that lands in between shows up as a newer
    // version later instead of going unnoticed.
    version = (await ctx.dataAccess.readFileVersion(nodeId)) ?? undefined;

    // The browser loads an image or a page itself, from the raw route.
    if (node.kind === "image" || node.kind === "html") {
      return { kind: node.kind, nodeId, version, src: buildRawUrl(ctx.dataAccess.tree, nodeId) };
    }

    bytes = await ctx.dataAccess.readFile(nodeId);
  } catch (error) {
    if (error instanceof TRPCError) {
      throw error;
    }

    throw diskFailure(error);
  }

  const text = decodeText(bytes, node.name);

  if (node.kind === "markdown" || node.kind === "text") {
    return { kind: node.kind, nodeId, version, text };
  }

  return { kind: "excalidraw", nodeId, version, scene: parseExcalidrawScene(text, node.name) };
};

// Keeps whatever else the file on disk holds (version, source, the rest of appState) and
// replaces the elements and files. The scene's style keys are merged into the file's
// appState (EX-7). A file that does not parse starts from the blank envelope.
const readExcalidrawEnvelope = (bytes: Uint8Array): Record<string, unknown> => {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));

    return isRecord(parsed) ? parsed : { ...BLANK_EXCALIDRAW_FILE };
  } catch {
    return { ...BLANK_EXCALIDRAW_FILE };
  }
};

const encodeDocument = async (ctx: TContext, document: TDocument): Promise<Uint8Array> => {
  // Images and HTML pages are never written (HTML-5, IMG-5).
  if (document.kind === "image" || document.kind === "html") {
    throw badRequest(`A ${document.kind} file is read-only and cannot be saved`);
  }

  if (document.kind === "markdown" || document.kind === "text") {
    return new TextEncoder().encode(document.text);
  }

  const envelope = readExcalidrawEnvelope(await ctx.dataAccess.readFile(document.nodeId));

  const fileAppState = isRecord(envelope["appState"]) ? envelope["appState"] : {};
  const appState = { ...fileAppState, ...pickExcalidrawStyle(document.scene.appState) };

  return encodeExcalidrawFile({
    ...envelope,
    elements: document.scene.elements,
    appState,
    files: document.scene.files,
  });
};

// A save that names the version it was based on is refused when the file on disk has
// another one: someone else changed it since this client read it (CONF-1, APP-4).
const assertUnchangedOnDisk = async (ctx: TContext, node: TFsNode, version: string | undefined) => {
  if (version === undefined) {
    return;
  }

  const current = await ctx.dataAccess.readFileVersion(node.id);
  if (current !== version) {
    throw new TRPCError({ code: "CONFLICT", message: `"${node.name}" changed on disk after it was opened` });
  }
};

const writeDocument = async (ctx: TContext, node: TFsNode, document: TDocument): Promise<string> => {
  const bytes = await encodeDocument(ctx, document);

  if (bytes.byteLength > MAX_DOCUMENT_BYTES) {
    throw badRequest(`"${node.name}" would be larger than ${MAX_DOCUMENT_MEGABYTES} MB and cannot be saved`);
  }

  return ctx.dataAccess.writeFile(node.id, bytes);
};

const updateDocument: TUpdateDocument = async (ctx, document) => {
  // Runs under the same lock as tree mutations, so a rename cannot slip between reading
  // the node and writing its file.
  return ctx.dataAccess.runExclusive(async (): Promise<TUpdateDocumentResult> => {
    const node = readNode(ctx.dataAccess.tree, document.nodeId);

    if (node.kind !== document.kind) {
      throw badRequest(`"${node.name}" is not a ${document.kind} document`);
    }

    try {
      await assertUnchangedOnDisk(ctx, node, document.version);

      return { version: await writeDocument(ctx, node, document) };
    } catch (error) {
      if (error instanceof TRPCError) {
        throw error;
      }

      throw diskFailure(error);
    }
  });
};

// A path segment as it was on disk. Unlike a typed name it is not trimmed.
const assertPathSegment = (segment: string): string => {
  if (segment.length === 0 || segment === "." || segment === ".." || /[\\]/.test(segment) || segment.includes("\0")) {
    throw badRequest(`"${segment}" is not a valid name`);
  }

  return segment;
};

// Writes back a document whose file was deleted on disk while it had unsaved changes
// (SYNC-5). Folders on the path that are gone too are created again. The file gets the
// document's node id back, so its tab stays where it is.
const restoreDocument: TRestoreDocument = async (ctx, input) => {
  const { document } = input;

  if (document.kind === "image" || document.kind === "html") {
    throw badRequest(`A ${document.kind} file is read-only and cannot be saved`);
  }

  const folderNames = input.path.split("/").map(assertPathSegment);
  const name = folderNames.pop() as string;

  if (readFileKind(name) !== document.kind) {
    throw badRequest(`"${name}" is not a ${document.kind} document`);
  }

  return mutateTree(ctx.dataAccess, (nodes) => {
    if (nodes.some((node) => node.id === document.nodeId)) {
      throw badRequest(`"${name}" is already in the vault`);
    }

    const nextNodes = [...nodes];
    let parentId: string | null = null;

    for (const folderName of folderNames) {
      const folderParentId: string | null = parentId;
      const existing: TFsNode | undefined = nextNodes.find((node) => node.parentId === folderParentId && node.name === folderName);

      if (existing !== undefined && existing.kind !== "folder") {
        throw badRequest(`"${folderName}" is not a folder`);
      }

      if (existing !== undefined) {
        parentId = existing.id;
        continue;
      }

      const folder: TFsNode = { id: randomUUID(), parentId, name: folderName, kind: "folder" };
      nextNodes.push(folder);
      parentId = folder.id;
    }

    assertFreeName(nextNodes, parentId, name, null);

    const node: TFsNode = { id: document.nodeId, parentId, name, kind: document.kind };
    nextNodes.push(node);

    const result = { nodes: nextNodes, node, version: "" };

    const after = async () => {
      result.version = await writeDocument(ctx, node, { ...document, version: undefined });
    };

    return { nodes: nextNodes, result, after };
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

    // An empty file is not an image, so images are opened and renamed but never created (IMG-6).
    if (kind === "image") {
      throw badRequest(`"${name}" is an image. The app cannot create an image file`);
    }

    assertFreeName(nodes, input.parentId, name, null);

    const node: TFsNode = { id: randomUUID(), parentId: input.parentId, name, kind };
    const nextNodes = [...nodes, node];

    const after = async () => {
      if (kind === "folder") {
        return;
      }

      await ctx.dataAccess.writeFile(node.id, createBlankContent(ctx, kind));
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

    const after = async () => {
      followPathChange(ctx, readNodePath(nodes, nodeId), readNodePath(nextNodes, nodeId));
    };

    return { nodes: nextNodes, result: nextNodes, after };
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

    const after = async () => {
      followPathChange(ctx, readNodePath(nodes, nodeId), readNodePath(nextNodes, nodeId));
    };

    return { nodes: nextNodes, result: nextNodes, after };
  });
};

const deleteNode: TDeleteNode = async (ctx, nodeId) => {
  return mutateTree(ctx.dataAccess, (nodes) => {
    readNode(nodes, nodeId);

    const removedIds = collectSubtreeIds(nodes, nodeId);
    const nextNodes = nodes.filter((node) => !removedIds.has(node.id));

    const removedPath = readNodePath(nodes, nodeId);
    const after = async () => {
      followPathRemoval(ctx, removedPath);
    };

    return { nodes: nextNodes, result: nextNodes, after };
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
  restoreDocument,
};
