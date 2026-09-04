import { readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { app } from "electron";
import type { Recent, Tab } from "../shared/types.js";

/**
 * Which directories this app has worked in, and which of them are open. It is a
 * list the user builds over months, so it lives in SQLite rather than in a JSON
 * file the app rewrites whole on every change.
 *
 * The directory is the identity. There is no separate id to keep in step, and a
 * row is a directory whether it is open, closed, or gone from disk.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  dir            TEXT PRIMARY KEY,
  name           TEXT    NOT NULL,
  opened_at      INTEGER NOT NULL,
  last_opened_at INTEGER NOT NULL,
  is_open        INTEGER NOT NULL DEFAULT 0,
  node_count     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS workspaces_recent ON workspaces (last_opened_at DESC);
`;

interface Row {
  dir: string;
  name: string;
  opened_at: number;
  last_opened_at: number;
  is_open: number;
  node_count: number;
}

let handle: DatabaseSync | null = null;

function database(): DatabaseSync {
  if (handle) {
    return handle;
  }
  const file = path.join(app.getPath("userData"), "harness.db");
  handle = new DatabaseSync(file);
  handle.exec("PRAGMA journal_mode = WAL");
  handle.exec(SCHEMA);
  return handle;
}

/** The first run after the tabs moved into SQLite carries the old file over. */
async function importOldTabsFile(): Promise<void> {
  const file = path.join(app.getPath("userData"), "tabs.json");
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return;
  }
  try {
    const parsed = JSON.parse(raw) as { dir?: string; name?: string }[];
    for (const entry of Array.isArray(parsed) ? parsed : []) {
      if (typeof entry?.dir === "string") {
        remember(entry.dir, true);
      }
    }
  } catch {
    // A file we cannot read is a file we cannot carry over.
  }
  await rm(file, { force: true });
}

function toTab(row: Row): Tab {
  return { id: row.dir, dir: row.dir, name: row.name };
}

/**
 * Writes the directory down, and marks it open when it is being opened. A
 * directory that was already open keeps its place in the tab strip.
 */
function remember(dir: string, open: boolean): Tab {
  const now = Date.now();
  const name = path.basename(dir) || dir;
  database()
    .prepare(
      `INSERT INTO workspaces (dir, name, opened_at, last_opened_at, is_open)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (dir) DO UPDATE SET
         name = excluded.name,
         last_opened_at = excluded.last_opened_at,
         opened_at = CASE WHEN workspaces.is_open = 1 THEN workspaces.opened_at ELSE excluded.opened_at END,
         is_open = CASE WHEN excluded.is_open = 1 THEN 1 ELSE workspaces.is_open END`,
    )
    .run(dir, name, now, now, open ? 1 : 0);
  return { id: dir, dir, name };
}

function closeWorkspace(dir: string): void {
  database().prepare("UPDATE workspaces SET is_open = 0 WHERE dir = ?").run(dir);
}

function forgetWorkspace(dir: string): void {
  database().prepare("DELETE FROM workspaces WHERE dir = ?").run(dir);
}

function setNodeCount(dir: string, count: number): void {
  database().prepare("UPDATE workspaces SET node_count = ? WHERE dir = ?").run(count, dir);
}

function openRows(): Row[] {
  return database()
    .prepare("SELECT * FROM workspaces WHERE is_open = 1 ORDER BY opened_at")
    .all() as unknown as Row[];
}

function recentRows(limit: number): Row[] {
  return database()
    .prepare("SELECT * FROM workspaces ORDER BY last_opened_at DESC LIMIT ?")
    .all(limit) as unknown as Row[];
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The open tabs. A directory that has been deleted since it was last open is
 * quietly closed rather than reopened — reopening it would recreate it empty.
 */
async function openTabs(): Promise<Tab[]> {
  await importOldTabsFile();
  const tabs: Tab[] = [];
  for (const row of openRows()) {
    if (await isDirectory(row.dir)) {
      tabs.push(toTab(row));
      continue;
    }
    closeWorkspace(row.dir);
  }
  return tabs;
}

async function recents(limit = 40): Promise<Recent[]> {
  const rows = recentRows(limit);
  return await Promise.all(
    rows.map(async (row) => {
      return {
        dir: row.dir,
        name: row.name,
        lastOpenedAt: row.last_opened_at,
        nodeCount: row.node_count,
        isOpen: row.is_open === 1,
        missing: !(await isDirectory(row.dir)),
      };
    }),
  );
}

export {
  closeWorkspace,
  forgetWorkspace,
  isDirectory,
  openTabs,
  recents,
  remember,
  setNodeCount,
};
