/** Types the renderer and the Electron main process both speak. */

/** What Codex is asked to think with. Empty means the Codex default. */
type ReasoningEffort = "" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra" | "persistent";

/** One tab is one `.blend` file on disk. The path is the identity, so `id` is it. */
interface Tab {
  id: string;
  blendPath: string;
  name: string;
  /** Codex model for this file's runs. Empty means whatever `~/.codex/config.toml` says. */
  agentModel: string;
  reasoningEffort: ReasoningEffort;
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
  /** The `codex` executable. Empty means the one bundled with the Codex SDK. */
  codexPath: string;
  blenderPath: string;
}

/** One object of the Blender scene, as the outliner shows it. */
interface SceneObject {
  name: string;
  /** Blender's object type: `MESH`, `LIGHT`, `CAMERA`, `EMPTY`… */
  type: string;
  parent: string | null;
  dataName: string | null;
  /** Visible in the view layer, after collections and its own flag. */
  visible: boolean;
  /** Its own eye is closed. */
  hidden: boolean;
  /** For a collection instance, the collection it stands for. */
  instanceCollection: string | null;
}

/** One collection of the Blender scene, with what sits in it. */
interface SceneCollection {
  name: string;
  /** Unticked in the outliner: out of the view layer entirely. */
  excluded: boolean;
  hidden: boolean;
  objects: SceneObject[];
  children: SceneCollection[];
}

/** The tree the object panel draws, read from the tab's Blender. */
interface SceneOutline {
  sceneName: string;
  activeObject: string | null;
  collections: SceneCollection[];
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
  ReasoningEffort,
  SceneCollection,
  SceneObject,
  SceneOutline,
  SendRequest,
  Settings,
  Tab,
  TabState,
  WorkspaceEvent,
};
