import type {
  Graph,
  ImageRunRequest,
  Recent,
  RunEvent,
  RunRequest,
  RunResult,
  Tab,
} from "./types.js";

/** Everything the renderer is allowed to ask the main process for. */
interface HarnessBridge {
  tabs: {
    list(): Promise<Tab[]>;
    /** Opens the directory picker. Resolves to null when the user cancels. */
    create(): Promise<Tab | null>;
    close(id: string): Promise<Tab[]>;
    reveal(dir: string): Promise<void>;
  };
  recents: {
    /** Every working directory the app has opened, newest first. */
    list(): Promise<Recent[]>;
    /** Opens one as a tab. Resolves to null when the directory is gone. */
    open(dir: string): Promise<Tab | null>;
    /** Drops it from the list, closing its tab if it has one. Returns what is left. */
    forget(dir: string): Promise<Recent[]>;
  };
  graph: {
    load(dir: string): Promise<Graph>;
    save(dir: string, graph: Graph): Promise<void>;
  };
  prompts: {
    read(dir: string, id: string): Promise<string>;
  };
  files: {
    /** Deletes `prompts/<id>.md` or `images/<id>.png`. Missing files are not an error. */
    remove(dir: string, kind: "prompt" | "image", id: string): Promise<void>;
    /** Writes clipboard or dropped bytes as `images/<id>.png`. */
    writeImage(dir: string, id: string, bytes: ArrayBuffer): Promise<void>;
    /** Puts the image on the system clipboard. */
    copyImage(dir: string, id: string): Promise<void>;
    /** The image on the system clipboard, as PNG bytes, or null when there is none. */
    readClipboardImage(): Promise<ArrayBuffer | null>;
  };
  run: {
    prompt(request: RunRequest): Promise<RunResult>;
    image(request: ImageRunRequest): Promise<RunResult>;
    /** Progress of every run in this window. Returns an unsubscribe. */
    subscribe(listener: (event: RunEvent) => void): () => void;
  };
}

const IPC = {
  tabsList: "tabs:list",
  tabsCreate: "tabs:create",
  tabsClose: "tabs:close",
  tabsReveal: "tabs:reveal",
  recentsList: "recents:list",
  recentsOpen: "recents:open",
  recentsForget: "recents:forget",
  graphLoad: "graph:load",
  graphSave: "graph:save",
  promptRead: "prompt:read",
  fileRemove: "file:remove",
  fileWriteImage: "file:write-image",
  fileCopyImage: "file:copy-image",
  fileClipboardImage: "file:clipboard-image",
  runPrompt: "run:prompt",
  runImage: "run:image",
  runEvent: "run:event",
} as const;

export type { HarnessBridge };
export { IPC };
