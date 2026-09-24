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

/**
 * A project is a folder with an `Assets/` directory in it. The app has one
 * project open at a time; its models are the tabs, and its folder is where
 * every agent of it runs, so the project's own instructions reach the run.
 */
interface Project {
  /** The project folder. The path is the identity. */
  path: string;
  name: string;
  /** `<path>/Assets`. */
  assetsPath: string;
  openedAt: number;
}

/** One file of the Assets directory. */
interface AssetFile {
  name: string;
  path: string;
  /** Relative to the Assets directory, with `/` separators. */
  relPath: string;
  bytes: number;
  modifiedAt: number;
}

/** A texture file, with the map it holds when its name says so. */
interface AssetTexture extends AssetFile {
  /** `base color`, `normal`, `roughness` and so on. Empty when the name does not say. */
  channel: string;
}

/** A group of textures in one directory: `textures/<Model>/` or `material/<Set>/`. */
interface AssetTextureSet {
  name: string;
  relPath: string;
  textures: AssetTexture[];
  /** Everything else of the directory: `.blend`, `.mtlx`, `.usdc`, `.tres`. */
  others: AssetFile[];
}

/** One `blender/<Model>.blend`, with everything the convention ties to its name. */
interface AssetModel {
  name: string;
  blendPath: string;
  relPath: string;
  modifiedAt: number;
  /** `export/<format>/<Model>*.*`: the FBX, its `_Parts` sibling, the rig JSON. */
  exports: AssetFile[];
  /** `textures/<Model>/`, or null when the model has none yet. */
  textures: AssetTextureSet | null;
}

/** The images of one `references/<category>/` directory. */
interface AssetReferenceGroup {
  category: string;
  relPath: string;
  files: AssetFile[];
}

/** What the Assets directory holds, read by its convention. */
interface AssetIndex {
  projectPath: string;
  assetsPath: string;
  /** False when the project has no Assets directory at all. */
  exists: boolean;
  scannedAt: number;
  models: AssetModel[];
  /** The shared material sets of `material/`, such as the ambientCG downloads. */
  materials: AssetTextureSet[];
  /** `textures/<Name>/` directories no `.blend` is named after. */
  orphanTextures: AssetTextureSet[];
  /** Exports no `.blend` is named after. */
  orphanExports: AssetFile[];
  references: AssetReferenceGroup[];
  miscCount: number;
  /** What does not follow the convention, one line each. */
  warnings: string[];
}

/** One tab is one `.blend` file on disk. The path is the identity, so `id` is it. */
interface Tab {
  id: string;
  blendPath: string;
  /** The project the file belongs to. */
  projectPath: string;
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

/** A picture of one message. The bytes stay in the main process; this is how it is named. */
interface MessageImage {
  id: string;
  kind: ImageKind;
  width: number;
  height: number;
  /** Where the PNG also sits on disk, when it came from a file the agent wrote. */
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
  | { type: "project"; project: Project | null }
  | { type: "assets"; index: AssetIndex }
  | { type: "tab"; state: TabState }
  | { type: "tab-closed"; tabId: string }
  | { type: "message"; message: ChatMessage }
  | { type: "chat-cleared"; tabId: string }
  | { type: "notice"; tabId: string; text: string };

export type { BlenderStatus, SceneCollection, SceneObject, SceneOutline } from "@hw/headless-blender-mcp";
export type {
  AgentKind,
  AssetFile,
  AssetIndex,
  AssetModel,
  AssetReferenceGroup,
  AssetTexture,
  AssetTextureSet,
  ChatMessage,
  CloseResult,
  ImageAttachment,
  ImageKind,
  MessageImage,
  MessageRole,
  MessageStatus,
  Project,
  ReasoningEffort,
  SendRequest,
  Settings,
  Tab,
  TabState,
  WorkspaceEvent,
};
