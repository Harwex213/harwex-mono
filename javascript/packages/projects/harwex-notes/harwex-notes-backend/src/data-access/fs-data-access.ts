import { randomUUID } from "node:crypto";
import path from "node:path";
import type { TFsNode, TFsNodeKind } from "@hw/harwex-notes-protocol";
import { createPassthroughVaultLock } from "./passthrough-vault-lock.js";
import type { TVaultFs } from "./vault-fs.types.js";
import type { TVaultLock } from "./vault-lock.types.js";

const EXCLUDED_FOLDER_NAMES: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  ".yarn",
  "dist",
  "build",
  "tools"
]);

const MAX_VAULT_ENTRIES = 50_000;

const FILE_KIND_BY_EXTENSION: Readonly<Record<string, TFsNodeKind>> = {
  ".md": "markdown",
  ".markdown": "markdown",
  ".excalidraw": "excalidraw",
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

class FsDataAccess {
  tree: TFsNode[] = [];

  readonly #fs: TVaultFs;
  readonly #vaultPath: string;
  readonly #lock: TVaultLock;

  #flushed: TNodeMap = new Map();

  #queue: Promise<unknown> = Promise.resolve();

  constructor(fs: TVaultFs, vaultPath: string, lock: TVaultLock = createPassthroughVaultLock()) {
    this.#fs = fs;
    this.#vaultPath = path.resolve(vaultPath);
    this.#lock = lock;
  }

  preload = async (): Promise<void> => {
    const nodes: TFsNode[] = [];

    const walk = async (relativeDir: string, parentId: string | null) => {
      const entries = await this.#fs.readDir(path.join(this.#vaultPath, relativeDir));

      for (const entry of entries) {
        if (entry.kind === "folder" && EXCLUDED_FOLDER_NAMES.has(entry.name)) {
          continue;
        }

        if (nodes.length >= MAX_VAULT_ENTRIES) {
          throw new Error(`The vault holds more than ${MAX_VAULT_ENTRIES} entries and cannot be listed`);
        }

        const id = randomUUID();
        const kind: TFsNodeKind = entry.kind === "folder" ? "folder" : readFileKind(entry.name);

        nodes.push({ id, parentId, name: entry.name, kind });

        if (entry.kind === "folder") {
          await walk(path.join(relativeDir, entry.name), id);
        }
      }
    };

    await walk("", null);

    this.tree = nodes;
    this.#flushed = toNodeMap(nodes);
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

  readFile = async (nodeId: string): Promise<Uint8Array> => {
    return this.#fs.readFile(this.#absolutePath(nodeId));
  };

  writeFile = async (nodeId: string, data: Uint8Array): Promise<void> => {
    await this.#fs.writeFile(this.#absolutePath(nodeId), data);
  };

  // Two layers, in this order. The queue orders callers inside this process, so at most
  // one of them reaches the vault lock; the vault lock then keeps other processes out.
  // Doing it the other way round would park several libuv workers on the same lock.
  runExclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const guarded = () => this.#lock.runExclusive(task);
    const run = this.#queue.then(guarded, guarded);
    this.#queue = run.catch(() => undefined);

    return run;
  };

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

export { FsDataAccess, readFileKind };
