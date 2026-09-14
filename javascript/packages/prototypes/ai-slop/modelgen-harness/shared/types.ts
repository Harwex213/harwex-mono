/** Types the renderer and the Electron main process both speak. */

// What the scene looks like from outside Blender is named by the package that
// talks to it, so the app and the tools never drift apart.
import type { BlenderStatus } from "@hw/headless-blender-mcp";

/** What the agent is asked to think with. Empty means the agent's own default. */
type ReasoningEffort = "" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra" | "persistent";

/**
 * Which agent builds the model in a tab. Empty means none has been chosen yet,
 * which is what puts the tab's right panel in its Clear state.
 */
type AgentKind = "" | "claude" | "codex";

/** One tab is one `.blend` file on disk. The path is the identity, so `id` is it. */
interface Tab {
  id: string;
  blendPath: string;
  name: string;
  /** The agent chosen for this file. It is fixed until the conversation is closed. */
  agentKind: AgentKind;
  /** Model for this file's runs. Empty means whatever the agent's own config says. */
  agentModel: string;
  reasoningEffort: ReasoningEffort;
}

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
  /** Tokens the agent read for the first time in this conversation. Cleared with it. */
  tokensUsed: number;
  /** Prompt the agent re-read from cache. Every tool call repeats it, so it dwarfs the rest. */
  tokensCached: number;
  /**
   * The conversation holds at least one message. What separates the Empty
   * state from the In-progress one, and it comes from the main process rather
   * than from the chat the window has loaded: the two pickers must never be
   * open for the moment a reopened tab has not read its messages yet.
   */
  conversationStarted: boolean;
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
  /** The `codex` executable. Empty means the one bundled with the Codex SDK. */
  codexPath: string;
  /** The `claude` executable. Empty means the one bundled with the Claude Agent SDK. */
  claudeCodePath: string;
  blenderPath: string;
}

/** Progress the main process pushes to every window. */
type WorkspaceEvent =
  | { type: "tab"; state: TabState }
  | { type: "tab-closed"; tabId: string }
  | { type: "message"; message: ChatMessage }
  | { type: "chat-cleared"; tabId: string }
  | { type: "notice"; tabId: string; text: string };


export type { BlenderStatus, SceneCollection, SceneObject, SceneOutline } from "@hw/headless-blender-mcp";
export type {
  AgentKind,
  ChatMessage,
  CloseResult,
  ImageAttachment,
  ImageKind,
  MessageImage,
  MessageRole,
  MessageStatus,
  ReasoningEffort,
  SendRequest,
  Settings,
  Tab,
  TabState,
  WorkspaceEvent,
};
