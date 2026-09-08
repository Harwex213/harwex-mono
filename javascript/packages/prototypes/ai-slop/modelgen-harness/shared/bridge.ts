import type {
  ChatMessage,
  CloseResult,
  SendRequest,
  Settings,
  TabState,
  WorkspaceEvent,
} from "./types.js";

/** Everything the renderer is allowed to ask the main process for. */
interface HarnessBridge {
  tabs: {
    list(): Promise<TabState[]>;
    /** Opens the file picker. `existing` picks a file that is there, `fresh` names a new one. */
    pickPath(mode: "existing" | "fresh"): Promise<string | null>;
    /** Opens a `.blend` as a tab, creating the file when it is missing. */
    create(blendPath: string): Promise<TabState>;
    /** Refuses while the file is dirty or a run is in flight. */
    close(tabId: string): Promise<CloseResult>;
    save(tabId: string): Promise<void>;
    reveal(tabId: string): Promise<void>;
    /** Starts the headless Blender again after it stopped or failed. */
    restart(tabId: string): Promise<void>;
  };
  chat: {
    list(tabId: string): Promise<ChatMessage[]>;
    /** Starts one agent run. Progress arrives through `subscribe`. */
    send(request: SendRequest): Promise<void>;
    cancel(tabId: string): Promise<void>;
  };
  settings: {
    get(): Promise<Settings>;
    set(settings: Settings): Promise<Settings>;
  };
  /** Progress of every tab in this window. Returns an unsubscribe. */
  subscribe(listener: (event: WorkspaceEvent) => void): () => void;
}

const IPC = {
  tabsList: "tabs:list",
  tabsPickPath: "tabs:pick-path",
  tabsCreate: "tabs:create",
  tabsClose: "tabs:close",
  tabsSave: "tabs:save",
  tabsReveal: "tabs:reveal",
  tabsRestart: "tabs:restart",
  chatList: "chat:list",
  chatSend: "chat:send",
  chatCancel: "chat:cancel",
  settingsGet: "settings:get",
  settingsSet: "settings:set",
  event: "workspace:event",
} as const;

/** The custom scheme that serves models and images to the renderer. */
const SCHEME = "modelgen";

export type { HarnessBridge };
export { IPC, SCHEME };
