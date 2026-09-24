import type {
  AgentKind,
  AssetIndex,
  ChatMessage,
  CloseResult,
  Project,
  ReasoningEffort,
  SceneOutline,
  SendRequest,
  Settings,
  TabState,
  WorkspaceEvent,
} from "./types.js";

/** Everything the renderer is allowed to ask the main process for. */
interface HarnessBridge {
  projects: {
    /** The open project, or null before the first one is opened. */
    current(): Promise<Project | null>;
    /** Projects opened before, most recent first. */
    recent(): Promise<Project[]>;
    /** Opens the folder picker. */
    pick(): Promise<string | null>;
    /** Opens a project folder. Refused while a tab of the current one is unsaved or running. */
    open(projectPath: string): Promise<Project>;
    /** The Assets directory of the open project, read by its convention. */
    assets(): Promise<AssetIndex | null>;
    /** Reads the Assets directory again. */
    rescan(): Promise<AssetIndex | null>;
    /** Shows a file or directory of the Assets directory in Finder. */
    reveal(relPath: string): Promise<void>;
  };
  tabs: {
    list(): Promise<TabState[]>;
    /** Opens the file picker in the project's `Assets/blender/`, for a `.blend` that is there. */
    pickPath(): Promise<string | null>;
    /**
     * Opens a model as a tab. A bare name is `Assets/blender/<Name>.blend` of
     * the open project; a path is taken as it is. A missing file is created.
     */
    create(nameOrPath: string): Promise<TabState>;
    /** Refuses while the file is dirty or a run is in flight. */
    close(tabId: string): Promise<CloseResult>;
    save(tabId: string): Promise<void>;
    reveal(tabId: string): Promise<void>;
    /** Starts the headless Blender again after it stopped or failed. */
    restart(tabId: string): Promise<void>;
    /** Which model and effort this file's runs use. Both are kept with the tab. */
    setAgent(tabId: string, agentModel: string, reasoningEffort: ReasoningEffort): Promise<void>;
    /** Picks the agent that builds this model. Refused once the conversation has started. */
    setAgentKind(tabId: string, agentKind: AgentKind): Promise<void>;
    /** The collection and object tree of the tab's Blender, as its outliner has it. */
    outline(tabId: string): Promise<SceneOutline>;
  };
  chat: {
    list(tabId: string): Promise<ChatMessage[]>;
    /** Starts one agent run. Progress arrives through `subscribe`. */
    send(request: SendRequest): Promise<void>;
    cancel(tabId: string): Promise<void>;
    /** Drops the conversation and its agent session. The chosen agent stays. */
    clear(tabId: string): Promise<void>;
    /** Drops the conversation and the chosen agent, back to the Clear state. */
    close(tabId: string): Promise<void>;
  };
  settings: {
    get(): Promise<Settings>;
    set(settings: Settings): Promise<Settings>;
  };
  /** Progress of every tab in this window. Returns an unsubscribe. */
  subscribe(listener: (event: WorkspaceEvent) => void): () => void;
}

const IPC = {
  projectsCurrent: "projects:current",
  projectsRecent: "projects:recent",
  projectsPick: "projects:pick",
  projectsOpen: "projects:open",
  projectsAssets: "projects:assets",
  projectsRescan: "projects:rescan",
  projectsReveal: "projects:reveal",
  tabsList: "tabs:list",
  tabsPickPath: "tabs:pick-path",
  tabsCreate: "tabs:create",
  tabsClose: "tabs:close",
  tabsSave: "tabs:save",
  tabsReveal: "tabs:reveal",
  tabsRestart: "tabs:restart",
  tabsSetAgent: "tabs:set-agent",
  tabsSetAgentKind: "tabs:set-agent-kind",
  tabsOutline: "tabs:outline",
  chatList: "chat:list",
  chatSend: "chat:send",
  chatCancel: "chat:cancel",
  chatClear: "chat:clear",
  chatClose: "chat:close",
  settingsGet: "settings:get",
  settingsSet: "settings:set",
  event: "workspace:event",
} as const;

/** The custom scheme that serves models and images to the renderer. */
const SCHEME = "assetsharness";

export type { HarnessBridge };
export { IPC, SCHEME };
