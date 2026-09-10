import { accessSync, constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { app } from "electron";
import type {
  AgentKind,
  ChatMessage,
  ImageKind,
  MessageImage,
  MessageRole,
  MessageStatus,
  ReasoningEffort,
  Settings,
  Tab,
} from "../shared/types.js";

/**
 * One SQLite file holds the tabs, every chat message, every image the chat
 * shows (previews the agent rendered, pictures the user attached, references
 * the agent generated), the agent's conversation history per tab, and the
 * settings. `node:sqlite` ships with Electron's Node, so there is no native
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
  reasoning_effort TEXT    NOT NULL DEFAULT '',
  tokens_used      INTEGER NOT NULL DEFAULT 0,
  tokens_cached    INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  blend_path TEXT    NOT NULL,
  role       TEXT    NOT NULL,
  text       TEXT    NOT NULL,
  status     TEXT    NOT NULL DEFAULT 'done',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_by_tab ON messages (blend_path, created_at);
CREATE TABLE IF NOT EXISTS images (
  id         TEXT PRIMARY KEY,
  message_id TEXT    NOT NULL,
  kind       TEXT    NOT NULL,
  mime       TEXT    NOT NULL,
  width      INTEGER NOT NULL,
  height     INTEGER NOT NULL,
  file_path  TEXT,
  bytes      BLOB    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS images_by_message ON images (message_id);
CREATE TABLE IF NOT EXISTS agent_sessions (
  blend_path TEXT PRIMARY KEY,
  agent_kind TEXT    NOT NULL,
  session_id TEXT    NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

interface TabRow {
  blend_path: string;
  name: string;
  opened_at: number;
  is_open: number;
  agent_kind: string;
  agent_model: string;
  reasoning_effort: string;
  tokens_used: number;
  tokens_cached: number;
}

interface MessageRow {
  id: string;
  blend_path: string;
  role: string;
  text: string;
  status: string;
  created_at: number;
}

interface ImageRow {
  id: string;
  message_id: string;
  kind: string;
  mime: string;
  width: number;
  height: number;
  file_path: string | null;
  bytes: Uint8Array;
  created_at: number;
}

interface StoredImage extends MessageImage {
  mime: string;
  bytes: Uint8Array;
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
  for (const column of ["tokens_used", "tokens_cached"]) {
    try {
      handle.exec(`ALTER TABLE tabs ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`);
    } catch {
      // Already there.
    }
  }
  carryAgentSettingsToTabs(handle);
  carryCodexThreadsToSessions(handle);
  return handle;
}

/**
 * Codex was the only agent before, so a tab written then names none. A tab that
 * already holds a conversation gets Codex — the agent that built it — and one
 * that holds nothing stays empty, which is what opens the agent choice.
 */
function carryCodexThreadsToSessions(db: DatabaseSync): void {
  try {
    db.exec(
      `INSERT INTO agent_sessions (blend_path, agent_kind, session_id, updated_at)
       SELECT blend_path, 'codex', thread_id, updated_at FROM codex_threads
       WHERE blend_path NOT IN (SELECT blend_path FROM agent_sessions)`,
    );
  } catch {
    // No codex_threads table: nothing written before this table existed.
  }
  db.exec(
    `UPDATE tabs SET agent_kind = 'codex'
     WHERE agent_kind = '' AND blend_path IN (SELECT DISTINCT blend_path FROM messages)`,
  );
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
// Tabs.

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

/** What the tab's conversation has spent so far, new content and re-read prompt apart. */
function readTokens(blendPath: string): { used: number; cached: number } {
  const row = database()
    .prepare("SELECT tokens_used, tokens_cached FROM tabs WHERE blend_path = ?")
    .get(blendPath) as { tokens_used: number; tokens_cached: number } | undefined;
  return { used: row?.tokens_used ?? 0, cached: row?.tokens_cached ?? 0 };
}

/** Adds one turn's tokens to the tab's running totals and returns them. */
function addTokens(blendPath: string, fresh: number, cached: number): { used: number; cached: number } {
  database()
    .prepare("UPDATE tabs SET tokens_used = tokens_used + ?, tokens_cached = tokens_cached + ? WHERE blend_path = ?")
    .run(fresh, cached, blendPath);
  return readTokens(blendPath);
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
// Messages and images.

function imagesOf(messageId: string): MessageImage[] {
  const rows = database()
    .prepare(
      "SELECT id, kind, width, height, file_path FROM images WHERE message_id = ? ORDER BY created_at",
    )
    .all(messageId) as unknown as Omit<ImageRow, "bytes" | "mime" | "message_id" | "created_at">[];
  return rows.map((row) => {
    return {
      id: row.id,
      kind: row.kind as ImageKind,
      width: row.width,
      height: row.height,
      filePath: row.file_path,
    };
  });
}

function toMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    tabId: row.blend_path,
    role: row.role as MessageRole,
    text: row.text,
    status: row.status as MessageStatus,
    createdAt: row.created_at,
    images: imagesOf(row.id),
  };
}

function insertMessage(message: Omit<ChatMessage, "images">): ChatMessage {
  database()
    .prepare(
      "INSERT INTO messages (id, blend_path, role, text, status, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      message.id,
      message.tabId,
      message.role,
      message.text,
      message.status,
      message.createdAt,
    );
  return { ...message, images: [] };
}

function updateMessage(id: string, text: string, status: MessageStatus): void {
  database().prepare("UPDATE messages SET text = ?, status = ? WHERE id = ?").run(text, status, id);
}

function readMessage(id: string): ChatMessage | null {
  const row = database().prepare("SELECT * FROM messages WHERE id = ?").get(id) as
    | MessageRow
    | undefined;
  return row ? toMessage(row) : null;
}

function messagesOf(blendPath: string): ChatMessage[] {
  const rows = database()
    .prepare("SELECT * FROM messages WHERE blend_path = ? ORDER BY created_at")
    .all(blendPath) as unknown as MessageRow[];
  return rows.map(toMessage);
}

/** A run that died mid-way leaves a running message behind. Mark it so on startup. */
function failStaleRuns(): void {
  database()
    .prepare("UPDATE messages SET status = 'failed' WHERE status = 'running'")
    .run();
}

function insertImage(image: StoredImage & { messageId: string }): MessageImage {
  database()
    .prepare(
      `INSERT INTO images (id, message_id, kind, mime, width, height, file_path, bytes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      image.id,
      image.messageId,
      image.kind,
      image.mime,
      image.width,
      image.height,
      image.filePath,
      image.bytes,
      Date.now(),
    );
  return {
    id: image.id,
    kind: image.kind,
    width: image.width,
    height: image.height,
    filePath: image.filePath,
  };
}

function readImage(id: string): { mime: string; bytes: Uint8Array } | null {
  const row = database().prepare("SELECT mime, bytes FROM images WHERE id = ?").get(id) as
    | Pick<ImageRow, "mime" | "bytes">
    | undefined;
  return row ? { mime: row.mime, bytes: row.bytes } : null;
}

// ---------------------------------------------------------------------------
// Agent sessions. One per tab, resumed on the next message. Codex keeps its
// threads under its own home; Claude Code keeps its sessions under ~/.claude.

/** The session of this tab, but only if the agent that owns it is still the tab's. */
function readSessionId(blendPath: string, agentKind: AgentKind): string | null {
  const row = database()
    .prepare("SELECT agent_kind, session_id FROM agent_sessions WHERE blend_path = ?")
    .get(blendPath) as { agent_kind: string; session_id: string } | undefined;
  if (!row || row.agent_kind !== agentKind) {
    return null;
  }
  return row.session_id;
}

function writeSessionId(blendPath: string, agentKind: AgentKind, sessionId: string): void {
  database()
    .prepare(
      `INSERT INTO agent_sessions (blend_path, agent_kind, session_id, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (blend_path) DO UPDATE SET
         agent_kind = excluded.agent_kind,
         session_id = excluded.session_id,
         updated_at = excluded.updated_at`,
    )
    .run(blendPath, agentKind, sessionId, Date.now());
}

/**
 * Wipes the conversation of one tab: its messages, the images hanging off them,
 * the agent session the next message would have resumed, and the token count.
 * What the agent already built in the `.blend` is untouched — only the talk goes.
 */
function clearConversation(blendPath: string): void {
  const db = database();
  db.prepare(
    "DELETE FROM images WHERE message_id IN (SELECT id FROM messages WHERE blend_path = ?)",
  ).run(blendPath);
  db.prepare("DELETE FROM messages WHERE blend_path = ?").run(blendPath);
  db.prepare("DELETE FROM agent_sessions WHERE blend_path = ?").run(blendPath);
  db.prepare("UPDATE tabs SET tokens_used = 0, tokens_cached = 0 WHERE blend_path = ?").run(blendPath);
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

export type { StoredImage };
export {
  addTokens,
  clearConversation,
  closeTab,
  failStaleRuns,
  insertImage,
  insertMessage,
  messagesOf,
  openTab,
  openTabs,
  readImage,
  readMessage,
  readSessionId,
  readSettings,
  readTab,
  readTokens,
  setTabAgent,
  setTabAgentKind,
  updateMessage,
  writeSessionId,
  writeSettings,
};
