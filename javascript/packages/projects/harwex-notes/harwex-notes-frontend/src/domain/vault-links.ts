import { VAULT_LINK_PREFIX } from "@hw/harwex-notes-protocol";
import type { TFsNode } from "@hw/harwex-notes-protocol";

type TLinkTarget =
  | { status: "found"; node: TFsNode }
  | { status: "refused"; message: string };

const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

// A link names a vault file when it carries the `vault:` prefix or has no scheme at all.
// Links with a scheme (http, mailto) and in-page anchors belong to the browser.
const isVaultHref = (href: string): boolean => {
  const trimmed = href.trim();
  if (trimmed.startsWith(VAULT_LINK_PREFIX)) {
    return true;
  }

  return trimmed.length > 0 && !trimmed.startsWith("#") && !URL_SCHEME_PATTERN.test(trimmed);
};

const decodePath = (text: string): string => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

// Resolves "." and ".." segments. A path that climbs above the vault root has no target.
const normalizePath = (segments: readonly string[]): string | null => {
  const result: string[] = [];

  for (const segment of segments) {
    if (segment === "" || segment === ".") {
      continue;
    }

    if (segment === "..") {
      if (result.length === 0) {
        return null;
      }

      result.pop();
      continue;
    }

    result.push(segment);
  }

  return result.length === 0 ? null : result.join("/");
};

const readPathById = (nodes: readonly TFsNode[]): ReadonlyMap<string, string> => {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const pathById = new Map<string, string>();

  const readPath = (node: TFsNode): string => {
    const known = pathById.get(node.id);
    if (known !== undefined) {
      return known;
    }

    const parent = node.parentId === null ? undefined : nodeById.get(node.parentId);
    const nodePath = parent === undefined ? node.name : `${readPath(parent)}/${node.name}`;

    pathById.set(node.id, nodePath);

    return nodePath;
  };

  for (const node of nodes) {
    readPath(node);
  }

  return pathById;
};

// The paths a link may mean, best first. A `vault:` link and a link starting with "/"
// name a path from the vault root. A bare path is tried next to the linking file first,
// then from the vault root, so both "./other.md" and "Projects/other.md" work.
const readCandidatePaths = (href: string, fromPath: string | null): readonly string[] => {
  const trimmed = href.trim().replace(/[?#].*$/, "");
  const fromSegments = fromPath === null ? [] : fromPath.split("/").slice(0, -1);

  if (trimmed.startsWith(VAULT_LINK_PREFIX)) {
    const rootPath = normalizePath(decodePath(trimmed.slice(VAULT_LINK_PREFIX.length)).split("/"));

    return rootPath === null ? [] : [rootPath];
  }

  const decoded = decodePath(trimmed);

  if (decoded.startsWith("/")) {
    const rootPath = normalizePath(decoded.split("/"));

    return rootPath === null ? [] : [rootPath];
  }

  const candidates = [
    normalizePath([...fromSegments, ...decoded.split("/")]),
    normalizePath(decoded.split("/")),
  ];

  return [...new Set(candidates.filter((candidate): candidate is string => candidate !== null))];
};

const readFileName = (nodePath: string): string => {
  return nodePath.slice(nodePath.lastIndexOf("/") + 1);
};

const readExtension = (name: string): string => {
  const dotIndex = name.lastIndexOf(".");

  return dotIndex <= 0 ? name : name.slice(dotIndex);
};

// Finds the file a link points at. A file moved inside the app since the link was made is
// still found by its name, when exactly one file in the vault carries that name.
const resolveVaultLink = (
  nodes: readonly TFsNode[],
  fromNodeId: string,
  href: string
): TLinkTarget => {
  const pathById = readPathById(nodes);
  const idByPath = new Map([...pathById].map(([id, nodePath]) => [nodePath, id]));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const candidates = readCandidatePaths(href, pathById.get(fromNodeId) ?? null);
  const shownPath = candidates[0] ?? href.trim();

  let node: TFsNode | undefined;

  for (const candidate of candidates) {
    const id = idByPath.get(candidate);
    node = id === undefined ? undefined : nodeById.get(id);
    if (node !== undefined) {
      break;
    }
  }

  if (node === undefined && candidates.length > 0) {
    const wantedName = readFileName(candidates[0] as string);
    const sameName = nodes.filter((candidate) => candidate.kind !== "folder" && candidate.name === wantedName);

    if (sameName.length === 1) {
      node = sameName[0];
    }
  }

  if (node === undefined) {
    return { status: "refused", message: `"${shownPath}" is not in the vault. The link opens nothing` };
  }

  // The same refusal as a double click on the file in the tree (FEED-2).
  if (node.kind === "file") {
    return {
      status: "refused",
      message: `"${node.name}" cannot be opened: "${readExtension(node.name)}" is not a supported extension`,
    };
  }

  return { status: "found", node };
};

type TVaultImage = {
  nodeId: string;
  // The vault path with "/" separators, as the raw route addresses the file.
  path: string;
};

const readNodePath = (nodeById: ReadonlyMap<string, TFsNode>, node: TFsNode): string => {
  const segments = [node.name];
  let parentId = node.parentId;

  while (parentId !== null) {
    const parent = nodeById.get(parentId);
    if (parent === undefined) {
      break;
    }

    segments.unshift(parent.name);
    parentId = parent.parentId;
  }

  return segments.join("/");
};

// The image a Markdown file shows for `src` (MD-5). A path that starts with "/" or
// `vault:` is read from the vault root. Any other path is relative to the folder of the
// file, "../" included. Null when no image of the vault sits at that path.
const resolveVaultImage = (
  nodes: readonly TFsNode[],
  fromNodeId: string,
  src: string
): TVaultImage | null => {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const fromNode = nodeById.get(fromNodeId);
  const trimmed = decodePath(src.trim().replace(/[?#].*$/, ""));

  let segments: string[];

  if (trimmed.startsWith(VAULT_LINK_PREFIX)) {
    segments = trimmed.slice(VAULT_LINK_PREFIX.length).split("/");
  } else if (trimmed.startsWith("/")) {
    segments = trimmed.split("/");
  } else {
    const fromPath = fromNode === undefined ? "" : readNodePath(nodeById, fromNode);
    segments = [...fromPath.split("/").slice(0, -1), ...trimmed.split("/")];
  }

  const wantedPath = normalizePath(segments);
  if (wantedPath === null) {
    return null;
  }

  const wantedName = readFileName(wantedPath);
  const image = nodes.find((node) => {
    return node.kind === "image" && node.name === wantedName && readNodePath(nodeById, node) === wantedPath;
  });

  return image === undefined ? null : { nodeId: image.id, path: wantedPath };
};

export type { TLinkTarget, TVaultImage };
export { isVaultHref, resolveVaultImage, resolveVaultLink };
