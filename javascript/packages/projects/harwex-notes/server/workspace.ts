import { TRPCError } from "@trpc/server";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { Entry, ListOutput, ReadOutput, WriteOutput } from "../shared/contract.ts";
import { fileKindForName } from "../shared/file-kind.ts";

const MAX_READ_BYTES = 8 * 1024 * 1024;
const BINARY_SNIFF_BYTES = 8 * 1024;

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function notesRoot(): string {
  const configured = process.env.NOTES_ROOT;
  if (configured !== undefined && configured.length > 0) {
    return path.resolve(configured);
  }
  return path.join(packageRoot, "notes-root");
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: string }).code === "ENOENT"
  );
}

/**
 * `fs.realpath` fails on a path that does not exist yet, so walk up to the
 * closest ancestor that does. A write to a new file is then still checked
 * against the real location of the directory that would hold it.
 */
async function realpathOfNearestExisting(target: string): Promise<string> {
  let current = target;
  for (;;) {
    try {
      return await fs.realpath(current);
    } catch (error) {
      const parent = path.dirname(current);
      if (!isMissing(error) || parent === current) {
        throw error;
      }
      current = parent;
    }
  }
}

/**
 * The only thing between this server and the rest of the disk. Zod has already
 * rejected `..` segments, absolute paths, and NUL by the time a request gets
 * here; this catches symlinks pointing out of the root, which no amount of
 * string checking can.
 */
async function resolveInRoot(root: string, relPath: string): Promise<string> {
  const absolute = path.resolve(root, relPath);
  const realRoot = await fs.realpath(root);
  const realTarget = await realpathOfNearestExisting(absolute);
  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Path escapes the workspace root." });
  }
  return absolute;
}

function joinRelative(parent: string, name: string): string {
  if (parent.length === 0) {
    return name;
  }
  return `${parent}/${name}`;
}

function compareEntries(left: Entry, right: Entry): number {
  if (left.type !== right.type) {
    return left.type === "dir" ? -1 : 1;
  }
  return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}

async function listDirectory(root: string, relPath: string): Promise<ListOutput> {
  const absolute = await resolveInRoot(root, relPath);
  let names: string[];
  try {
    names = await fs.readdir(absolute);
  } catch (error) {
    if (isMissing(error)) {
      throw new TRPCError({ code: "NOT_FOUND", message: `No such directory: ${relPath}` });
    }
    throw error;
  }
  const entries: Entry[] = [];
  for (const name of names) {
    if (name.startsWith(".")) {
      continue;
    }
    let stats;
    try {
      stats = await fs.stat(path.join(absolute, name));
    } catch {
      // A broken symlink or a file removed mid-listing is simply not shown.
      continue;
    }
    if (!stats.isDirectory() && !stats.isFile()) {
      continue;
    }
    const isDirectory = stats.isDirectory();
    entries.push({
      name,
      path: joinRelative(relPath, name),
      type: isDirectory ? "dir" : "file",
      fileKind: isDirectory ? null : fileKindForName(name),
      size: isDirectory ? 0 : stats.size,
      mtimeMs: Math.round(stats.mtimeMs),
    });
  }
  entries.sort(compareEntries);
  return { entries };
}

async function readTextFile(root: string, relPath: string): Promise<ReadOutput> {
  const absolute = await resolveInRoot(root, relPath);
  let stats;
  try {
    stats = await fs.stat(absolute);
  } catch (error) {
    if (isMissing(error)) {
      throw new TRPCError({ code: "NOT_FOUND", message: `No such file: ${relPath}` });
    }
    throw error;
  }
  if (!stats.isFile()) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `Not a file: ${relPath}` });
  }
  if (stats.size > MAX_READ_BYTES) {
    throw new TRPCError({
      code: "PAYLOAD_TOO_LARGE",
      message: `${relPath} is ${stats.size} bytes; the limit is ${MAX_READ_BYTES}.`,
    });
  }
  const bytes = await fs.readFile(absolute);
  if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${relPath} looks binary.` });
  }
  return {
    path: relPath,
    fileKind: fileKindForName(path.basename(relPath)),
    text: bytes.toString("utf8"),
    mtimeMs: Math.round(stats.mtimeMs),
  };
}

async function writeTextFile(
  root: string,
  relPath: string,
  text: string,
  baseMtimeMs: number,
): Promise<WriteOutput> {
  const absolute = await resolveInRoot(root, relPath);
  let currentMtimeMs: number | null = null;
  try {
    const stats = await fs.stat(absolute);
    if (!stats.isFile()) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Not a file: ${relPath}` });
    }
    currentMtimeMs = Math.round(stats.mtimeMs);
  } catch (error) {
    if (!isMissing(error)) {
      throw error;
    }
  }
  if (currentMtimeMs !== null && currentMtimeMs !== Math.round(baseMtimeMs)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `${relPath} changed on disk since it was opened.`,
    });
  }
  // Same-directory temp file plus rename, so a crash mid-write cannot leave a
  // half-written note behind and the rename stays on one filesystem.
  const temporary = `${absolute}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, text, "utf8");
  try {
    await fs.rename(temporary, absolute);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
  const written = await fs.stat(absolute);
  return { mtimeMs: Math.round(written.mtimeMs) };
}

export {
  listDirectory,
  notesRoot,
  readTextFile,
  realpathOfNearestExisting,
  resolveInRoot,
  writeTextFile,
};
