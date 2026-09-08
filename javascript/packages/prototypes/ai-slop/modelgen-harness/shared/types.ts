/** Types the renderer and the Electron main process both speak. */

/** One tab is one `.blend` file on disk. The path is the identity, so `id` is it. */
interface Tab {
  id: string;
  blendPath: string;
  name: string;
}

/** Where the headless Blender behind a tab is in its life. */
type BlenderStatus = "starting" | "ready" | "stopped" | "failed";

/** Everything the renderer shows about a tab besides its chat. */
interface TabState {
  tab: Tab;
  blender: BlenderStatus;
  /** What the Blender process said when it failed, or the last log line. */
  blenderMessage: string;
  /** The `.blend` has changes that are not on disk. */
  dirty: boolean;
  /** An agent run is in flight. */
  running: boolean;
  /** Bumped every time the glTF export is refreshed. The viewer reloads on change. */
  modelStamp: number;
}

type MessageRole = "user" | "agent" | "progress";

type MessageStatus = "running" | "done" | "failed";

type ImageKind = "input" | "preview" | "generated";

/** An image stored in SQLite, attached to one message. */
interface MessageImage {
  id: string;
  kind: ImageKind;
  width: number;
  height: number;
  /** For generated and input images: where the PNG also sits on disk, for the agent. */
  filePath: string | null;
}

interface ChatMessage {
  id: string;
  tabId: string;
  role: MessageRole;
  text: string;
  status: MessageStatus;
  createdAt: number;
  images: MessageImage[];
}

/** Bytes the user attached to the composer: a dropped file, a paste, or a viewer screenshot. */
interface ImageAttachment {
  name: string;
  bytes: ArrayBuffer;
}

interface SendRequest {
  tabId: string;
  text: string;
  images: ImageAttachment[];
}

interface CloseResult {
  ok: boolean;
  /** Why the tab stayed open. */
  reason: string;
}

interface Settings {
  /** Codex model. Empty means whatever `~/.codex/config.toml` says. */
  agentModel: string;
  /** Codex reasoning effort. Empty means the Codex default. */
  reasoningEffort: string;
  /** The `codex` executable. Empty means the one bundled with the Codex SDK. */
  codexPath: string;
  blenderPath: string;
}

/** Progress the main process pushes to every window. */
type WorkspaceEvent =
  | { type: "tab"; state: TabState }
  | { type: "tab-closed"; tabId: string }
  | { type: "message"; message: ChatMessage }
  | { type: "notice"; tabId: string; text: string };


export type {
  BlenderStatus,
  ChatMessage,
  CloseResult,
  ImageAttachment,
  ImageKind,
  MessageImage,
  MessageRole,
  MessageStatus,
  SendRequest,
  Settings,
  Tab,
  TabState,
  WorkspaceEvent,
};
