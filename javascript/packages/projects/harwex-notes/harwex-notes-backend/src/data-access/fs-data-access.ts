import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import type { TFsNode, TFsNodeKind } from "@hw/harwex-notes-protocol";
import { STATE_DIR_NAME } from "./state-db.js";
import type { TVaultFs } from "./vault-fs.types.js";

const EXCLUDED_FOLDER_NAMES: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  ".yarn",
  "dist",
  "build",
  "tools",
  // The app's own state database lives here (see state-db.ts).
  STATE_DIR_NAME,
]);

const MAX_VAULT_ENTRIES = 50_000;

// The temp file a save writes beside its target before renaming it over (node-vault-fs.ts).
// It lives for one save only and is never part of the vault.
const SAVE_TEMP_NAME_PATTERN = /^\..+\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;

// True for a path the tree never lists: anything inside an excluded folder (VAULT-8), the
// app's state folder (SESS-6) and the temp file of a save in flight. `relativePath` is
// relative to the vault root and uses the platform separator.
const isIgnoredRelativePath = (relativePath: string): boolean => {
  const segments = relativePath.split(path.sep).filter((segment) => segment.length > 0);
  const name = segments[segments.length - 1];

  if (name !== undefined && SAVE_TEMP_NAME_PATTERN.test(name)) {
    return true;
  }

  return segments.some((segment) => EXCLUDED_FOLDER_NAMES.has(segment));
};

const FILE_KIND_BY_EXTENSION: Readonly<Record<string, TFsNodeKind>> = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".txt": "text",
  ".excalidraw": "excalidraw",
  ".png": "image",
  ".jpg": "image",
  ".jpeg": "image",
  ".gif": "image",
  ".webp": "image",
  ".svg": "image",
  ".bmp": "image",
  ".ico": "image",
  ".avif": "image",
  ".html": "html",
  ".htm": "html",
};

const readFileKind = (name: string): TFsNodeKind => {
  const extension = path.extname(name).toLowerCase();

  return FILE_KIND_BY_EXTENSION[extension] ?? "file";
};

type TNodeMap = Map<string, TFsNode>;

const toNodeMap = (nodes: readonly TFsNode[]): TNodeMap => {
  return new Map(nodes.map((node) => [node.id, node]));
};

const readRelativePath = (nodes: TNodeMap, nodeId: string | null): string => {
  const segments: string[] = [];
  let currentId = nodeId;

  while (currentId !== null) {
    const node = nodes.get(currentId);
    if (node === undefined) {
      throw new Error(`No node was found for "${currentId}"`);
    }

    segments.unshift(node.name);
    currentId = node.parentId;
  }

  return segments.join(path.sep);
};

const readDepth = (nodes: TNodeMap, node: TFsNode): number => {
  let depth = 0;
  let currentId = node.parentId;

  while (currentId !== null) {
    depth += 1;
    currentId = nodes.get(currentId)?.parentId ?? null;
  }

  return depth;
};

const hasSameLocation = (left: TFsNode, right: TFsNode) => {
  return left.name === right.name && left.parentId === right.parentId;
};

// The vault-relative path of every node, with the platform separator.
const readPathById = (nodes: TNodeMap): Map<string, string> => {
  const pathById = new Map<string, string>();

  const readPath = (node: TFsNode): string => {
    const known = pathById.get(node.id);
    if (known !== undefined) {
      return known;
    }

    const parent = node.parentId === null ? undefined : nodes.get(node.parentId);
    const nodePath = parent === undefined ? node.name : path.join(readPath(parent), node.name);

    pathById.set(node.id, nodePath);

    return nodePath;
  };

  for (const node of nodes.values()) {
    readPath(node);
  }

  return pathById;
};

const isSameTree = (left: readonly TFsNode[], right: readonly TFsNode[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  const rightById = toNodeMap(right);

  return left.every((node) => {
    const other = rightById.get(node.id);

    return other !== undefined && other.kind === node.kind && hasSameLocation(other, node);
  });
};

// A file whose content changed on disk, with the version it has now.
type TChangedFile = {
  nodeId: string;
  version: string;
};

// What a sync with the disk found. `nodes` is the whole new tree when entries were added,
// removed or renamed, and null when the structure stayed the same.
type TDiskSync = {
  nodes: readonly TFsNode[] | null;
  changedFiles: readonly TChangedFile[];
};

class FsDataAccess {
  tree: TFsNode[] = [];

  readonly #fs: TVaultFs;
  readonly #vaultPath: string;

  #flushed: TNodeMap = new Map();

  // The last version of each file that the app read or wrote. A change on disk that ends
  // at this version is the app's own write coming back from the watcher (SYNC-9).
  readonly #knownVersionById = new Map<string, string>();

  #queue: Promise<unknown> = Promise.resolve();

  constructor(fs: TVaultFs, vaultPath: string) {
    this.#fs = fs;
    this.#vaultPath = path.resolve(vaultPath);
  }

  preload = async (): Promise<void> => {
    const nodes = await this.#scan([]);

    this.tree = nodes;
    this.#flushed = toNodeMap(nodes);
  };

  // Brings the tree in line with the disk after changes made outside the app (SYNC-1).
  // `relativePaths` are the paths the watcher reported; null means "anything may have
  // changed" and rescans everything. An entry whose path did not change keeps its id, so
  // open tabs and the selection survive (SYNC-2).
  syncWithDisk = async (relativePaths: ReadonlySet<string> | null): Promise<TDiskSync> => {
    return this.runExclusive(async () => {
      let pathById = readPathById(this.#flushed);
      let idByPath = new Map([...pathById].map(([id, nodePath]) => [nodePath, id]));
      let isRescanNeeded = relativePaths === null;

      for (const relativePath of relativePaths ?? []) {
        const nodeId = idByPath.get(relativePath);
        const node = nodeId === undefined ? undefined : this.#flushed.get(nodeId);

        // Only a known file that is still a file is a plain content change. Anything else
        // (a new path, a folder, a file that is gone) may change the structure.
        if (node === undefined || node.kind === "folder") {
          isRescanNeeded = true;
        } else if ((await this.#fs.fileVersion(path.join(this.#vaultPath, relativePath))) === null) {
          isRescanNeeded = true;
        }
      }

      let nodes: readonly TFsNode[] | null = null;

      if (isRescanNeeded) {
        const scanned = await this.#scan(this.tree);

        if (!isSameTree(this.tree, scanned)) {
          const scannedIds = new Set(scanned.map((node) => node.id));

          for (const nodeId of [...this.#knownVersionById.keys()]) {
            if (!scannedIds.has(nodeId)) {
              this.#knownVersionById.delete(nodeId);
            }
          }

          this.tree = scanned;
          this.#flushed = toNodeMap(scanned);
          nodes = scanned;

          pathById = readPathById(this.#flushed);
          idByPath = new Map([...pathById].map(([id, nodePath]) => [nodePath, id]));
        }
      }

      const candidateIds = relativePaths === null
        ? [...this.#knownVersionById.keys()]
        : [...relativePaths].map((relativePath) => idByPath.get(relativePath));

      const changedFiles: TChangedFile[] = [];

      for (const nodeId of new Set(candidateIds)) {
        const node = nodeId === undefined ? undefined : this.#flushed.get(nodeId);
        if (node === undefined || node.kind === "folder") {
          continue;
        }

        const version = await this.#fs.fileVersion(path.join(this.#vaultPath, pathById.get(node.id) ?? ""));
        if (version === null || version === this.#knownVersionById.get(node.id)) {
          continue;
        }

        this.#knownVersionById.set(node.id, version);
        changedFiles.push({ nodeId: node.id, version });
      }

      return { nodes, changedFiles };
    });
  };

  flush = async (): Promise<void> => {
    const current = toNodeMap(this.tree);
    const disk = new Map(this.#flushed);

    try {
      await this.#applyRemovals(current, disk);
      await this.#applyAdditionsAndMoves(current, disk);
    } catch (error) {
      this.tree = [...this.#flushed.values()];
      throw error;
    }

    this.#flushed = current;
  };

  readFileSize = async (nodeId: string): Promise<number> => {
    return this.#fs.fileSize(this.#absolutePath(nodeId));
  };

  // Reading does not count as knowing a version: a change that a client read before the
  // watcher reported it still has to reach every other client.
  readFileVersion = async (nodeId: string): Promise<string | null> => {
    return this.#fs.fileVersion(this.#absolutePath(nodeId));
  };

  readFile = async (nodeId: string): Promise<Uint8Array> => {
    return this.#fs.readFile(this.#absolutePath(nodeId));
  };

  // Answers the version the file has after the write, so the watcher can recognise the
  // write as the app's own (SYNC-9).
  writeFile = async (nodeId: string, data: Uint8Array): Promise<string> => {
    await this.#fs.writeFile(this.#absolutePath(nodeId), data);

    const version = (await this.readFileVersion(nodeId)) ?? "";
    this.#knownVersionById.set(nodeId, version);

    return version;
  };

  runExclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const run = this.#queue.then(task, task);
    this.#queue = run.catch(() => undefined);

    return run;
  };

  // Lists the vault. An entry found at the same path as in `previous`, and still a folder
  // or still a file, keeps its id. A new entry gets an id derived from its path, so the
  // ids of a vault that did not change survive a restart of the backend.
  async #scan(previous: readonly TFsNode[]): Promise<TFsNode[]> {
    const previousMap = toNodeMap(previous);
    const previousByPath = new Map(
      [...readPathById(previousMap)].map(([nodeId, nodePath]) => [nodePath, previousMap.get(nodeId) as TFsNode])
    );
    const takenIds = new Set(previousMap.keys());
    const nodes: TFsNode[] = [];

    const allocateId = (relativePath: string) => {
      const derivedId = `n${createHash("sha1").update(relativePath).digest("base64url").slice(0, 22)}`;
      const id = takenIds.has(derivedId) ? randomUUID() : derivedId;

      takenIds.add(id);

      return id;
    };

    const walk = async (relativeDir: string, parentId: string | null) => {
      const entries = await this.#fs.readDir(path.join(this.#vaultPath, relativeDir));

      for (const entry of entries) {
        const relativePath = path.join(relativeDir, entry.name);
        const isFolder = entry.kind === "folder";

        if (isFolder && EXCLUDED_FOLDER_NAMES.has(entry.name)) {
          continue;
        }

        if (SAVE_TEMP_NAME_PATTERN.test(entry.name)) {
          continue;
        }

        if (nodes.length >= MAX_VAULT_ENTRIES) {
          throw new Error(`The vault holds more than ${MAX_VAULT_ENTRIES} entries and cannot be listed`);
        }

        const known = previousByPath.get(relativePath);
        const isKnown = known !== undefined && known.parentId === parentId && (known.kind === "folder") === isFolder;
        const id = isKnown ? known.id : allocateId(relativePath);
        const kind: TFsNodeKind = isFolder ? "folder" : readFileKind(entry.name);

        nodes.push({ id, parentId, name: entry.name, kind });

        if (isFolder) {
          await walk(relativePath, id);
        }
      }
    };

    await walk("", null);

    return nodes;
  }

  #absolutePath(nodeId: string): string {
    return path.join(this.#vaultPath, readRelativePath(this.#flushed, nodeId));
  }

  async #applyRemovals(current: TNodeMap, disk: TNodeMap): Promise<void> {
    const removed = [...disk.values()].filter((node) => !current.has(node.id));

    const isInsideRemoved = (node: TFsNode) => {
      let parentId = node.parentId;

      while (parentId !== null) {
        if (!current.has(parentId)) {
          return true;
        }

        parentId = disk.get(parentId)?.parentId ?? null;
      }

      return false;
    };

    for (const node of removed) {
      if (!isInsideRemoved(node)) {
        await this.#fs.remove(path.join(this.#vaultPath, readRelativePath(disk, node.id)));
      }
    }

    for (const node of removed) {
      disk.delete(node.id);
    }
  }

  async #applyAdditionsAndMoves(current: TNodeMap, disk: TNodeMap): Promise<void> {
    const changed = [...current.values()]
      .filter((node) => {
        const previous = disk.get(node.id);

        return previous === undefined || !hasSameLocation(previous, node);
      })
      .sort((left, right) => readDepth(current, left) - readDepth(current, right));

    for (const node of changed) {
      const previous = disk.get(node.id);
      const parentPath = readRelativePath(disk, node.parentId);
      const nextPath = path.join(this.#vaultPath, parentPath, node.name);

      if (previous === undefined) {
        if (node.kind === "folder") {
          await this.#fs.makeDir(nextPath);
        } else {
          await this.#fs.writeFile(nextPath, new Uint8Array());
        }
      } else {
        const previousPath = path.join(this.#vaultPath, readRelativePath(disk, node.id));
        await this.#fs.rename(previousPath, nextPath);
      }

      disk.set(node.id, node);
    }
  }
}

export { FsDataAccess, isIgnoredRelativePath, readFileKind };
export type { TChangedFile, TDiskSync };
