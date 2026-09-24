import { accessSync, constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { app } from "electron";
import type { AgentKind, Project, ReasoningEffort, Settings, Tab } from "../shared/types.js";

/**
 * One SQLite file, holding the projects this app has opened, the models it has
 * worked on in them, and the paths it was set up with. Nothing else: a
 * conversation, the pictures it showed and the agent session behind it belong
 * to the app while it runs, and are kept in memory by `chat.ts`.
 *
 * So a row here says a model exists, where its `.blend` is, which agent builds
 * it and with what — the record of a model, which outlives every conversation
 * about it. `node:sqlite` ships with Electron's Node, so there is no native
 * module to rebuild.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  project_path TEXT PRIMARY KEY,
  name         TEXT    NOT NULL,
  opened_at    INTEGER NOT NULL,
  is_current   INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tabs (
  blend_path       TEXT PRIMARY KEY,
  project_path     TEXT    NOT NULL,
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

interface TabRow {
  blend_path: string;
  project_path: string;
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
  const file = path.join(app.getPath("userData"), "assets-harness.db");
  handle = new DatabaseSync(file);
  handle.exec("PRAGMA journal_mode = WAL");
  handle.exec(SCHEMA);
  return handle;
}

function toTab(row: TabRow): Tab {
  return {
    id: row.blend_path,
    blendPath: row.blend_path,
    projectPath: row.project_path,
    name: row.name,
    agentKind: (row.agent_kind ?? "") as AgentKind,
    agentModel: row.agent_model ?? "",
    reasoningEffort: (row.reasoning_effort ?? "") as ReasoningEffort,
  };
}

// ---------------------------------------------------------------------------
// Projects.

interface ProjectRow {
  project_path: string;
  name: string;
  opened_at: number;
}

function toProject(row: ProjectRow): Project {
  return {
    path: row.project_path,
    name: row.name,
    assetsPath: path.join(row.project_path, "Assets"),
    openedAt: row.opened_at,
  };
}

/** Writes the project down as the current one. Every other project stops being current. */
function openProject(projectPath: string): Project {
  const db = database();
  db.prepare("UPDATE projects SET is_current = 0").run();
  db.prepare(
    `INSERT INTO projects (project_path, name, opened_at, is_current)
     VALUES (?, ?, ?, 1)
     ON CONFLICT (project_path) DO UPDATE SET
       name = excluded.name,
       opened_at = excluded.opened_at,
       is_current = 1`,
  ).run(projectPath, path.basename(projectPath) || projectPath, Date.now());
  return currentProject() as Project;
}

function currentProject(): Project | null {
  const row = database().prepare("SELECT * FROM projects WHERE is_current = 1").get() as unknown as
    | ProjectRow
    | undefined;
  return row ? toProject(row) : null;
}

function recentProjects(limit = 12): Project[] {
  const rows = database()
    .prepare("SELECT * FROM projects ORDER BY opened_at DESC LIMIT ?")
    .all(limit) as unknown as ProjectRow[];
  return rows.map(toProject);
}

// ---------------------------------------------------------------------------
// Models.

/**
 * Writes the file down as an open tab of its project. A tab that was already
 * open keeps its place, and one opened before keeps the model and the effort
 * it was given.
 */
function openTab(blendPath: string, projectPath: string): Tab {
  const name = path.basename(blendPath, ".blend") || blendPath;
  database()
    .prepare(
      `INSERT INTO tabs (blend_path, project_path, name, opened_at, is_open)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT (blend_path) DO UPDATE SET
         project_path = excluded.project_path,
         name = excluded.name,
         opened_at = CASE WHEN tabs.is_open = 1 THEN tabs.opened_at ELSE excluded.opened_at END,
         is_open = 1`,
    )
    .run(blendPath, projectPath, name, Date.now());
  return (
    readTab(blendPath) ?? {
      id: blendPath,
      blendPath,
      projectPath,
      name,
      agentKind: "",
      agentModel: "",
      reasoningEffort: "",
    }
  );
}

function readTab(blendPath: string): Tab | null {
  const row = database().prepare("SELECT * FROM tabs WHERE blend_path = ?").get(blendPath) as unknown as
    | TabRow
    | undefined;
  return row ? toTab(row) : null;
}

/**
 * Stores the model and effort of one tab. Empty means the default that
 * `modelOf` and `effortOf` in `shared/agents.ts` resolve.
 */
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

/** The tabs that were open in this project when it was last left. */
function openTabs(projectPath: string): Tab[] {
  const rows = database()
    .prepare("SELECT * FROM tabs WHERE is_open = 1 AND project_path = ? ORDER BY opened_at")
    .all(projectPath) as unknown as TabRow[];
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

/**
 * Where `codex` usually sits: the standalone installer's `~/.local/bin`, then
 * the PATH, then Homebrew. Empty when none of them has it, which leaves the
 * executable bundled with the Codex SDK. The machine's own CLI comes first
 * because the bundled one lags behind it, and a CLI older than the account's
 * models refuses them as "not supported with a ChatGPT account".
 */
function defaultCodexPath(): string {
  if (process.env.CODEX_PATH) {
    return process.env.CODEX_PATH;
  }
  const candidates = [
    path.join(os.homedir(), ".local", "bin", "codex"),
    ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, "codex")),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
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
    codexPath: defaultCodexPath(),
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

// ---------------------------------------------------------------------------
// The window. Kept in the settings table under its own key, apart from the
// settings the dialog edits.

const WINDOW_FULLSCREEN_KEY = "window.fullscreen";

/** Whether the window was in native fullscreen when it was last left. */
function readWindowFullscreen(): boolean {
  const row = database().prepare("SELECT value FROM settings WHERE key = ?").get(WINDOW_FULLSCREEN_KEY) as unknown as
    | { value: string }
    | undefined;
  return row?.value === "1";
}

function writeWindowFullscreen(fullscreen: boolean): void {
  database()
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    .run(WINDOW_FULLSCREEN_KEY, fullscreen ? "1" : "0");
}

export {
  closeTab,
  currentProject,
  openProject,
  openTab,
  openTabs,
  recentProjects,
  readSettings,
  readTab,
  readWindowFullscreen,
  setTabAgent,
  setTabAgentKind,
  writeSettings,
  writeWindowFullscreen,
};
