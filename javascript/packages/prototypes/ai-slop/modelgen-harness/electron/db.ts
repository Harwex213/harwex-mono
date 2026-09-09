import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { app } from "electron";
import type {
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
  agent_model      TEXT    NOT NULL DEFAULT '',
  reasoning_effort TEXT    NOT NULL DEFAULT ''
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
CREATE TABLE IF NOT EXISTS codex_threads (
  blend_path TEXT PRIMARY KEY,
  thread_id  TEXT    NOT NULL,
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
  agent_model: string;
  reasoning_effort: string;
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
  for (const column of ["agent_model", "reasoning_effort"]) {
    try {
      handle.exec(`ALTER TABLE tabs ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
    } catch {
      // Already there.
    }
  }
  carryAgentSettingsToTabs(handle);
  return handle;
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
  return readTab(blendPath) ?? { id: blendPath, blendPath, name, agentModel: "", reasoningEffort: "" };
}

function readTab(blendPath: string): Tab | null {
  const row = database().prepare("SELECT * FROM tabs WHERE blend_path = ?").get(blendPath) as unknown as
    | TabRow
    | undefined;
  return row ? toTab(row) : null;
}

/** Stores the Codex model and effort of one tab. Empty means the Codex default. */
function setTabAgent(blendPath: string, agentModel: string, reasoningEffort: ReasoningEffort): void {
  database()
    .prepare("UPDATE tabs SET agent_model = ?, reasoning_effort = ? WHERE blend_path = ?")
    .run(agentModel, reasoningEffort, blendPath);
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
// Codex threads. One per tab; Codex keeps the conversation under ~/.codex/sessions.

function readThreadId(blendPath: string): string | null {
  const row = database()
    .prepare("SELECT thread_id FROM codex_threads WHERE blend_path = ?")
    .get(blendPath) as { thread_id: string } | undefined;
  return row?.thread_id ?? null;
}

function writeThreadId(blendPath: string, threadId: string): void {
  database()
    .prepare(
      `INSERT INTO codex_threads (blend_path, thread_id, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (blend_path) DO UPDATE SET
         thread_id = excluded.thread_id,
         updated_at = excluded.updated_at`,
    )
    .run(blendPath, threadId, Date.now());
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

function defaultSettings(): Settings {
  return {
    codexPath: process.env.CODEX_PATH ?? "",
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
  closeTab,
  failStaleRuns,
  insertImage,
  insertMessage,
  messagesOf,
  openTab,
  openTabs,
  readImage,
  readMessage,
  readSettings,
  readTab,
  readThreadId,
  setTabAgent,
  updateMessage,
  writeSettings,
  writeThreadId,
};
