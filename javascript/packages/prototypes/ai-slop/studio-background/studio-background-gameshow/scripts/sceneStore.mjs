// The versions of the scene on disk: src/scene/versions/NNN.json and src/scene/versions/index.json.
// The dev server (scripts/sceneDevServer.mjs) and the agent tool (scripts/scene.mjs) both write through this module:
// - every write holds the lock file `.lock` in the versions folder, so two writers never interleave;
// - a save is an edit (a list of changed units with their old values); it merges into the file as it is on disk now;
// - a file is written to a temp file next to it and renamed over it, so a reader never sees half a file.
import { readFile, readdir, rename, stat, unlink, writeFile, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { formatScene, hashText, mergeChanges } from "../src/engine/sceneMerge.ts";

const MAX_VERSIONS = 10;
const DEFAULT_DIR = fileURLToPath(new URL("../src/scene/versions/", import.meta.url));
const LOCK_STALE_MS = 10000;
const LOCK_WAIT_MS = 10000;

// `SCENE_DIR=/path/copy` points every tool at a copy of the versions folder (tests).
function sceneDir() {
  return process.env.SCENE_DIR ? resolve(process.env.SCENE_DIR) : DEFAULT_DIR;
}

function fileName(id) {
  return `${String(id).padStart(3, "0")}.json`;
}

function versionPath(id, dir = sceneDir()) {
  return join(dir, fileName(id));
}

function delay(ms) {
  return new Promise((done) => {
    setTimeout(done, ms);
  });
}

async function writeAtomic(path, text) {
  const temp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(temp, text);
  await rename(temp, path);
}

// Runs `task` while this process holds the lock file of the versions folder.
async function withLock(task, dir = sceneDir()) {
  const lock = join(dir, ".lock");
  const start = Date.now();
  let handle = null;
  while (!handle) {
    try {
      handle = await open(lock, "wx");
    } catch (error) {
      if (error.code !== "EEXIST") {
        throw error;
      }
      try {
        const info = await stat(lock);
        if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
          await unlink(lock);
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - start > LOCK_WAIT_MS) {
        throw new Error(`the scene folder is locked: ${lock}`);
      }
      await delay(20);
    }
  }
  try {
    await handle.writeFile(String(process.pid));
    await handle.close();
    return await task();
  } finally {
    await unlink(lock).catch(() => {});
  }
}

async function readIndex(dir = sceneDir()) {
  return JSON.parse(await readFile(join(dir, "index.json"), "utf8"));
}

async function writeIndex(index, dir = sceneDir()) {
  await writeAtomic(join(dir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
}

// The version id of `requested` (a number, or undefined for the latest). Throws for a version that does not exist.
async function resolveVersion(requested, dir = sceneDir()) {
  const index = await readIndex(dir);
  const id = requested === undefined || requested === null || requested === "" ? index.latest : Number(requested);
  if (!index.versions.some((version) => version.id === id)) {
    throw new Error(`version ${requested} does not exist; versions: ${index.versions.map((version) => version.id).join(", ")}`);
  }
  return id;
}

async function readVersion(id, dir = sceneDir()) {
  const text = await readFile(versionPath(id, dir), "utf8");
  return { id, text, hash: hashText(text) };
}

// Merges the edit `changes` into version `id` as it is on disk now. Writes nothing when a field is in conflict.
async function saveChanges(id, changes, dir = sceneDir()) {
  return withLock(async () => {
    const index = await readIndex(dir);
    if (!index.versions.some((version) => version.id === id)) {
      return { ok: false, missing: true, conflicts: [] };
    }
    const current = await readVersion(id, dir);
    const result = mergeChanges(JSON.parse(current.text), changes);
    if (result.conflicts.length > 0) {
      return { ok: false, conflicts: result.conflicts, hash: current.hash };
    }
    const text = formatScene(result.merged);
    if (text !== current.text) {
      await writeAtomic(versionPath(id, dir), text);
    }
    return { ok: true, text, hash: hashText(text), changed: text !== current.text };
  }, dir);
}

// A new version: a copy of the latest, byte for byte. It becomes the latest. Past MAX_VERSIONS the oldest goes.
async function createVersion(label, dir = sceneDir()) {
  return withLock(async () => {
    const index = await readIndex(dir);
    const latest = await readFile(versionPath(index.latest, dir), "utf8");
    const id = Math.max(...index.versions.map((version) => version.id)) + 1;
    await writeAtomic(versionPath(id, dir), latest);
    index.versions.push({ id, label: label || `Copy of v${index.latest}`, created: new Date().toISOString(), from: index.latest });
    index.latest = id;
    const removed = [];
    while (index.versions.length > MAX_VERSIONS) {
      const oldest = index.versions.reduce((a, b) => (a.id < b.id ? a : b));
      index.versions = index.versions.filter((version) => version !== oldest);
      removed.push(oldest.id);
    }
    await writeIndex(index, dir);
    for (const old of removed) {
      await unlink(versionPath(old, dir)).catch(() => {});
    }
    return { index, id, removed };
  }, dir);
}

// The version files in the folder, by id.
async function listVersionFiles(dir = sceneDir()) {
  const names = await readdir(dir);
  return names.filter((name) => /^\d{3,}\.json$/.test(name)).map((name) => Number(name.slice(0, -5)));
}

export { MAX_VERSIONS, createVersion, fileName, listVersionFiles, readIndex, readVersion, resolveVersion, saveChanges, sceneDir, versionPath, withLock, writeAtomic, writeIndex };
