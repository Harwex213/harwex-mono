import { accessSync, constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { app } from "electron";
import type { AgentKind, ReasoningEffort, Settings, Tab } from "../shared/types.js";

/**
 * One SQLite file, holding the models this app has worked on and the paths it
 * was set up with. Nothing else: a conversation, the pictures it showed and
 * the agent session behind it belong to the app while it runs, and are kept in
 * memory by `chat.ts`.
 *
 * So a row here says a model exists, where its `.blend` is, which agent builds
 * it and with what — the record of a model, which outlives every conversation
 * about it. `node:sqlite` ships with Electron's Node, so there is no native
 * module to rebuild.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tabs (
  blend_path       TEXT PRIMARY KEY,
  name             TEXT    NOT NULL,
  opened_at        INTEGER NOT NULL,
  is_open          INTEGER NOT NULL DEFAULT 1,
  agent_kind       TEXT    NOT NULL DEFAULT '',
  agent_model      TEXT    NOT NULL DEFAULT '',
  reasoning_effort TEXT    NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/** What earlier versions wrote here and this one keeps in memory instead. */
const DROPPED_TABLES = ["messages", "images", "agent_sessions", "codex_threads"];
const DROPPED_COLUMNS = ["tokens_used", "tokens_cached"];

interface TabRow {
  blend_path: string;
  name: string;
  opened_at: number;
  is_open: number;
  agent_kind: string;
  agent_model: string;
  reasoning_effort: string;
}

let handle: DatabaseSync | null = null;

function database(): DatabaseSync {
  if (handle) {
    return handle;
  }
  const file = path.join(app.getPath("userData"), "modelgen.db");
  handle = new DatabaseSync(file);
  handle.exec("PRAGMA journal_mode = WAL");
  handle.exec(SCHEMA);
  // Columns added after the first databases were written. `CREATE TABLE IF NOT
  // EXISTS` above leaves those tables as they are, so add them here; the ALTER
  // throws on a table that already has the column, which is the "nothing to
  // do" case.
  for (const column of ["agent_kind", "agent_model", "reasoning_effort"]) {
    try {
      handle.exec(`ALTER TABLE tabs ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
    } catch {
      // Already there.
    }
  }
  carryAgentSettingsToTabs(handle);
  dropConversationTables(handle);
  return handle;
}

/**
 * Chats, pictures and agent sessions used to be written down. They are the
 * app's own state now, so a database written before that keeps the models and
 * loses the talk — which is also what makes the file small again, because the
 * pictures were the bulk of it.
 */
function dropConversationTables(db: DatabaseSync): void {
  let dropped = false;
  for (const table of DROPPED_TABLES) {
    const row = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    if (!row) {
      continue;
    }
    db.exec(`DROP TABLE ${table}`);
    dropped = true;
  }
  for (const column of DROPPED_COLUMNS) {
    try {
      db.exec(`ALTER TABLE tabs DROP COLUMN ${column}`);
      dropped = true;
    } catch {
      // Not there: nothing to drop.
    }
  }
  if (dropped) {
    db.exec("VACUUM");
  }
}

/**
 * The model and the effort were one setting for the whole app before they
 * became a property of each tab. Hands them to every tab that has none and
 * drops the two rows, so a setup made before the move keeps working and this
 * runs once.
 */
function carryAgentSettingsToTabs(db: DatabaseSync): void {
  const rows = db
    .prepare("SELECT key, value FROM settings WHERE key IN ('agentModel', 'reasoningEffort')")
    .all() as unknown as { key: string; value: string }[];
  if (rows.length === 0) {
    return;
  }
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  const model = stored.get("agentModel") ?? "";
  const effort = stored.get("reasoningEffort") ?? "";
  if (model.length > 0) {
    db.prepare("UPDATE tabs SET agent_model = ? WHERE agent_model = ''").run(model);
  }
  if (effort.length > 0) {
    db.prepare("UPDATE tabs SET reasoning_effort = ? WHERE reasoning_effort = ''").run(effort);
  }
  db.prepare("DELETE FROM settings WHERE key IN ('agentModel', 'reasoningEffort')").run();
}

function toTab(row: TabRow): Tab {
  return {
    id: row.blend_path,
    blendPath: row.blend_path,
    name: row.name,
    agentKind: (row.agent_kind ?? "") as AgentKind,
    agentModel: row.agent_model ?? "",
    reasoningEffort: (row.reasoning_effort ?? "") as ReasoningEffort,
  };
}

// ---------------------------------------------------------------------------
// Models.

/**
 * Writes the file down as an open tab. A tab that was already open keeps its
 * place, and one opened before keeps the model and the effort it was given.
 */
function openTab(blendPath: string): Tab {
  const name = path.basename(blendPath, ".blend") || blendPath;
  database()
    .prepare(
      `INSERT INTO tabs (blend_path, name, opened_at, is_open)
       VALUES (?, ?, ?, 1)
       ON CONFLICT (blend_path) DO UPDATE SET
         name = excluded.name,
         opened_at = CASE WHEN tabs.is_open = 1 THEN tabs.opened_at ELSE excluded.opened_at END,
         is_open = 1`,
    )
    .run(blendPath, name, Date.now());
  return (
    readTab(blendPath) ?? { id: blendPath, blendPath, name, agentKind: "", agentModel: "", reasoningEffort: "" }
  );
}

function readTab(blendPath: string): Tab | null {
  const row = database().prepare("SELECT * FROM tabs WHERE blend_path = ?").get(blendPath) as unknown as
    | TabRow
    | undefined;
  return row ? toTab(row) : null;
}

/** Stores the model and effort of one tab. Empty means the agent's own default. */
function setTabAgent(blendPath: string, agentModel: string, reasoningEffort: ReasoningEffort): void {
  database()
    .prepare("UPDATE tabs SET agent_model = ?, reasoning_effort = ? WHERE blend_path = ?")
    .run(agentModel, reasoningEffort, blendPath);
}

/**
 * Stores which agent builds this model. The model and the effort go with it:
 * the two agents name theirs differently, so a slug carried over from the other
 * one would be a slug that agent has never heard of.
 */
function setTabAgentKind(blendPath: string, agentKind: AgentKind): void {
  database()
    .prepare("UPDATE tabs SET agent_kind = ?, agent_model = '', reasoning_effort = '' WHERE blend_path = ?")
    .run(agentKind, blendPath);
}

function closeTab(blendPath: string): void {
  database().prepare("UPDATE tabs SET is_open = 0 WHERE blend_path = ?").run(blendPath);
}

function openTabs(): Tab[] {
  const rows = database()
    .prepare("SELECT * FROM tabs WHERE is_open = 1 ORDER BY opened_at")
    .all() as unknown as TabRow[];
  return rows.map(toTab);
}

// ---------------------------------------------------------------------------
// Settings.

function defaultBlenderPath(): string {
  if (process.env.BLENDER_PATH) {
    return process.env.BLENDER_PATH;
  }
  if (process.platform === "darwin") {
    return "/Applications/Blender.app/Contents/MacOS/Blender";
  }
  return "blender";
}

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where `claude` usually sits: the native installer's own directory, then the
 * PATH, then the places a global npm install puts it. Empty when none of them
 * has it, which leaves the executable bundled with the Claude Agent SDK.
 */
function defaultClaudeCodePath(): string {
  if (process.env.CLAUDE_CODE_PATH) {
    return process.env.CLAUDE_CODE_PATH;
  }
  const home = os.homedir();
  const candidates = [
    path.join(home, ".claude", "local", "claude"),
    ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, "claude")),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
  ];
  for (const candidate of candidates) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }
  return "";
}

function defaultSettings(): Settings {
  return {
    codexPath: process.env.CODEX_PATH ?? "",
    claudeCodePath: defaultClaudeCodePath(),
    blenderPath: defaultBlenderPath(),
  };
}

function readSettings(): Settings {
  const rows = database().prepare("SELECT key, value FROM settings").all() as unknown as {
    key: string;
    value: string;
  }[];
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  const defaults = defaultSettings();
  // A stored value wins, even an empty one: empty means "the Codex default".
  const pick = (key: keyof Settings): string => stored.get(key) ?? defaults[key];
  const required = (key: keyof Settings): string => {
    const value = stored.get(key);
    return value !== undefined && value.length > 0 ? value : defaults[key];
  };
  return {
    codexPath: pick("codexPath"),
    claudeCodePath: pick("claudeCodePath"),
    blenderPath: required("blenderPath"),
  };
}

function writeSettings(settings: Settings): Settings {
  const statement = database().prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
  );
  for (const [key, value] of Object.entries(settings)) {
    statement.run(key, String(value ?? ""));
  }
  return readSettings();
}

export {
  closeTab,
  openTab,
  openTabs,
  readSettings,
  readTab,
  setTabAgent,
  setTabAgentKind,
  writeSettings,
};
