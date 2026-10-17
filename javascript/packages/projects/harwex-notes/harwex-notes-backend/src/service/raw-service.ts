import type { TFsNode } from "@hw/harwex-notes-protocol";
import type { FsDataAccess } from "../data-access/fs-data-access.types.js";

// Raw vault files are served over plain HTTP under this prefix, by their path inside the
// vault. An image or an HTML page is shown by the browser itself, and the relative assets
// of a page resolve against the URL of the page (HTML-2).
const RAW_URL_PREFIX = "/api/raw";

type TRawFile = {
  name: string;
  bytes: Uint8Array;
};

const readRawPath = (nodes: readonly TFsNode[], nodeId: string): string[] => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const segments: string[] = [];
  let currentId: string | null = nodeId;

  while (currentId !== null) {
    const node = byId.get(currentId);
    if (node === undefined) {
      throw new Error(`No node was found for "${currentId}"`);
    }

    segments.unshift(node.name);
    currentId = node.parentId;
  }

  return segments;
};

// Every load gets a fresh query, so a reload of the document re-renders the file even when
// the browser holds an older copy (HTML-6).
const buildRawUrl = (nodes: readonly TFsNode[], nodeId: string): string => {
  const encoded = readRawPath(nodes, nodeId).map((segment) => encodeURIComponent(segment));

  return `${RAW_URL_PREFIX}/${encoded.join("/")}?v=${Date.now().toString(36)}`;
};

const isSafeSegment = (segment: string) => {
  return (
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    !/[/\\]/.test(segment) &&
    !segment.includes("\0")
  );
};

// The path is looked up in the listed tree, never joined onto the disk path. A path that
// climbs out of the vault, or that names an excluded folder, finds no node (VAULT-7, VAULT-8).
const findNodeByRawPath = (nodes: readonly TFsNode[], rawPath: string): TFsNode | null => {
  let segments: string[];

  try {
    segments = rawPath.split("/").map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }

  if (!segments.every(isSafeSegment)) {
    return null;
  }

  let parentId: string | null = null;
  let found: TFsNode | null = null;

  for (const segment of segments) {
    const parentOfSegment: string | null = parentId;
    const match: TFsNode | undefined = nodes.find((node) => {
      return node.parentId === parentOfSegment && node.name === segment;
    });
    if (match === undefined) {
      return null;
    }

    found = match;
    parentId = match.id;
  }

  return found;
};

const readRawFile = async (dataAccess: FsDataAccess, rawPath: string): Promise<TRawFile | null> => {
  const node = findNodeByRawPath(dataAccess.tree, rawPath);
  if (node === null || node.kind === "folder") {
    return null;
  }

  const bytes = await dataAccess.readFile(node.id);

  return { name: node.name, bytes };
};

export { RAW_URL_PREFIX, buildRawUrl, findNodeByRawPath, readRawFile };
export type { TRawFile };
