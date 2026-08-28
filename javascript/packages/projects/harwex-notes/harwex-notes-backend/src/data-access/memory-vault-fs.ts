import path from "node:path";
import type { TVaultEntry, TVaultFs } from "./vault-fs.types.js";

// A folder is `null`, a file is its bytes. Keys are normalised absolute paths.
type TMemoryEntries = Map<string, Uint8Array | null>;

// Initial content: a relative path per entry, text for a file, `null` for an empty folder.
// Parent folders are created on the way.
type TMemoryVaultSeed = Readonly<Record<string, string | null>>;

type TMemoryVaultFs = TVaultFs & {
  // Test helpers: look at the disk as the app left it.
  readText: (relativePath: string) => string | undefined;
  exists: (relativePath: string) => boolean;
  listPaths: () => readonly string[];
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const failWithCode = (code: string, message: string): never => {
  throw Object.assign(new Error(`${code}: ${message}`), { code });
};

const createMemoryVaultFs = (vaultPath: string, seed: TMemoryVaultSeed = {}): TMemoryVaultFs => {
  const root = path.normalize(vaultPath);
  const entries: TMemoryEntries = new Map([[root, null]]);

  const normalise = (target: string) => path.normalize(target);

  const isInside = (parent: string, child: string) => {
    return child !== parent && child.startsWith(`${parent}${path.sep}`);
  };

  const ensureParents = (target: string) => {
    let current = path.dirname(target);

    while (current !== root && !entries.has(current)) {
      entries.set(current, null);
      current = path.dirname(current);
    }
  };

  for (const [relativePath, content] of Object.entries(seed)) {
    const target = normalise(path.join(root, relativePath));
    ensureParents(target);
    entries.set(target, content === null ? null : encoder.encode(content));
  }

  const assertParentExists = (target: string) => {
    const parent = path.dirname(target);
    if (entries.get(parent) !== null) {
      failWithCode("ENOENT", `no such directory, "${parent}"`);
    }
  };

  const readDir = async (dirPath: string): Promise<readonly TVaultEntry[]> => {
    const dir = normalise(dirPath);
    if (entries.get(dir) !== null) {
      return failWithCode("ENOENT", `no such directory, "${dir}"`);
    }

    const result: TVaultEntry[] = [];

    for (const [entryPath, content] of entries) {
      if (entryPath === dir || path.dirname(entryPath) !== dir) {
        continue;
      }

      result.push({ name: path.basename(entryPath), kind: content === null ? "folder" : "file" });
    }

    return result;
  };

  const readFile = async (filePath: string): Promise<Uint8Array> => {
    const content = entries.get(normalise(filePath));
    if (content === undefined || content === null) {
      return failWithCode("ENOENT", `no such file, "${filePath}"`);
    }

    return content;
  };

  const fileSize = async (filePath: string): Promise<number> => {
    const content = await readFile(filePath);

    return content.byteLength;
  };

  const writeFile = async (filePath: string, data: Uint8Array): Promise<void> => {
    const target = normalise(filePath);
    assertParentExists(target);

    if (entries.get(target) === null) {
      failWithCode("EISDIR", `is a directory, "${target}"`);
    }

    entries.set(target, data);
  };

  const makeDir = async (dirPath: string): Promise<void> => {
    const target = normalise(dirPath);
    if (entries.has(target)) {
      failWithCode("EEXIST", `file already exists, "${target}"`);
    }

    assertParentExists(target);
    entries.set(target, null);
  };

  const rename = async (from: string, to: string): Promise<void> => {
    const source = normalise(from);
    const destination = normalise(to);

    if (!entries.has(source)) {
      failWithCode("ENOENT", `no such file or directory, "${source}"`);
    }

    assertParentExists(destination);

    const sourcePaths = [...entries.keys()].filter((entryPath) => {
      return entryPath === source || isInside(source, entryPath);
    });

    const moved = sourcePaths.map((entryPath): [string, Uint8Array | null] => {
      return [destination + entryPath.slice(source.length), entries.get(entryPath) ?? null];
    });

    for (const entryPath of sourcePaths) {
      entries.delete(entryPath);
    }

    for (const [entryPath, content] of moved) {
      entries.set(entryPath, content);
    }
  };

  const remove = async (targetPath: string): Promise<void> => {
    const target = normalise(targetPath);
    if (!entries.has(target)) {
      failWithCode("ENOENT", `no such file or directory, "${target}"`);
    }

    for (const entryPath of [...entries.keys()]) {
      if (entryPath === target || isInside(target, entryPath)) {
        entries.delete(entryPath);
      }
    }
  };

  const readText = (relativePath: string): string | undefined => {
    const content = entries.get(normalise(path.join(root, relativePath)));
    if (content === undefined || content === null) {
      return undefined;
    }

    return decoder.decode(content);
  };

  const exists = (relativePath: string): boolean => {
    return entries.has(normalise(path.join(root, relativePath)));
  };

  const listPaths = (): readonly string[] => {
    return [...entries.keys()]
      .filter((entryPath) => entryPath !== root)
      .map((entryPath) => path.relative(root, entryPath))
      .sort();
  };

  return {
    readDir,
    fileSize,
    readFile,
    writeFile,
    makeDir,
    rename,
    remove,
    readText,
    exists,
    listPaths,
  };
};

export { createMemoryVaultFs };
export type { TMemoryVaultFs, TMemoryVaultSeed };
