import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { TVaultEntry, TVaultEntryKind, TVaultFs } from "./vault-fs.types.js";

type TDirentLike = {
  isFile: () => boolean;
  isDirectory: () => boolean;
};

const readEntryKind = (entry: TDirentLike): TVaultEntryKind => {
  if (entry.isDirectory()) {
    return "folder";
  }

  if (entry.isFile()) {
    return "file";
  }

  return "other";
};

const createNodeVaultFs = (): TVaultFs => {
  const readDir = async (dirPath: string): Promise<readonly TVaultEntry[]> => {
    // `withFileTypes` reports a symlink as a symlink, not as its target, so a link
    // pointing outside the vault is never followed.
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    return entries.map((entry) => ({ name: entry.name, kind: readEntryKind(entry) }));
  };

  const fileSize = async (filePath: string): Promise<number> => {
    const stats = await fs.stat(filePath);

    return stats.size;
  };

  const readFile = async (filePath: string): Promise<Uint8Array> => {
    return fs.readFile(filePath);
  };

  // Write beside the target and rename over it. A crash mid-write leaves the old file
  // untouched and a stray temp file, never a half-written document.
  const writeFile = async (filePath: string, data: Uint8Array): Promise<void> => {
    const tempName = `.${path.basename(filePath)}.${randomUUID()}.tmp`;
    const tempPath = path.join(path.dirname(filePath), tempName);

    try {
      await fs.writeFile(tempPath, data);
      await fs.rename(tempPath, filePath);
    } catch (error) {
      await fs.rm(tempPath, { force: true });
      throw error;
    }
  };

  const makeDir = async (dirPath: string): Promise<void> => {
    await fs.mkdir(dirPath);
  };

  const rename = async (from: string, to: string): Promise<void> => {
    await fs.rename(from, to);
  };

  const remove = async (targetPath: string): Promise<void> => {
    await fs.rm(targetPath, { recursive: true });
  };

  return { readDir, fileSize, readFile, writeFile, makeDir, rename, remove };
};

export { createNodeVaultFs };
