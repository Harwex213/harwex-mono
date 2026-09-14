import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from "electron";
import { createSession, modelPath, onStatus, setExportsDir, stopAll } from "@hw/headless-blender-mcp";
import type { BlenderSession, Png } from "@hw/headless-blender-mcp";
import { IPC, SCHEME } from "../shared/bridge.js";
import type {
  AgentKind,
  ChatMessage,
  CloseResult,
  ReasoningEffort,
  SceneOutline,
  SendRequest,
  Settings,
  TabState,
  WorkspaceEvent,
} from "../shared/types.js";
import { startMcpServer } from "./agent/mcp-server.js";
import { cancelRun, isRunning, runTurn } from "./agent/runner.js";
import {
  clearConversation,
  closeTab,
  failStaleRuns,
  messagesOf,
  openTab,
  openTabs,
  readImage,
  readSettings,
  readTokens,
  setTabAgent,
  setTabAgentKind,
  writeSettings,
} from "./db.js";

// Without this the user data lands under a directory named "@hw".
app.setName("modelgen-harness");

const here = path.dirname(fileURLToPath(import.meta.url));
const EXPORT_DEBOUNCE_MS = 300;

protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  },
]);

/** What every window shows about each open tab. Keyed by the `.blend` path. */
const states = new Map<string, TabState>();
/**
 * The headless Blender behind each tab: one session of
 * `@hw/headless-blender-mcp`, holding that tab's file open and handing out the
 * Blender MCP tools bound to it.
 */
const sessions = new Map<string, BlenderSession>();
/** Where a tab's renders go while a run is in flight. The run installs its own. */
const renderSinks = new Map<string, (png: Png, filePath: string) => void>();
const exportTimers = new Map<string, NodeJS.Timeout>();

function broadcast(event: WorkspaceEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC.event, event);
  }
}

function pushState(tabId: string): void {
  const state = states.get(tabId);
  if (state) {
    broadcast({ type: "tab", state });
  }
}

/**
 * Exports the glTF the viewer shows. Debounced, because a run calls this after
 * every code block.
 */
function refreshModel(tabId: string): void {
  const pending = exportTimers.get(tabId);
  if (pending) {
    clearTimeout(pending);
  }
  exportTimers.set(
    tabId,
    setTimeout(() => {
      exportTimers.delete(tabId);
      void (async () => {
        const current = states.get(tabId);
        if (!current || current.blender !== "ready") {
          return;
        }
        try {
          const file = await sessions.get(tabId)?.exportModel();
          if (file) {
            current.modelStamp = Date.now();
          }
        } catch (error) {
          broadcast({ type: "notice", tabId, text: error instanceof Error ? error.message : String(error) });
        }
        pushState(tabId);
      })();
    }, EXPORT_DEBOUNCE_MS),
  );
}

/**
 * The session says the scene may have changed, and whether it now holds edits
 * that are not on disk. That flag is the session's own: it turns true with
 * anything that runs code in Blender and false on a save, and Blender is never
 * asked about it, because a `--background` Blender does not maintain
 * `bpy.data.is_dirty`.
 */
function sceneChanged(tabId: string, dirty: boolean): void {
  const state = states.get(tabId);
  if (state && state.dirty !== dirty) {
    state.dirty = dirty;
    pushState(tabId);
  }
  refreshModel(tabId);
}

onStatus((blendPath, status, message) => {
  const state = states.get(blendPath);
  if (!state) {
    return;
  }
  state.blender = status;
  state.blenderMessage = message;
  if (status === "ready") {
    // A fresh Blender holds exactly what is on disk.
    state.dirty = false;
  }
  pushState(blendPath);
  if (status === "ready") {
    refreshModel(blendPath);
  }
});

/**
 * Starts the session behind a tab, without waiting for Blender: the tab shows
 * up at once and the status above moves it from starting to ready. The session
 * is built fresh every time, so a Blender path changed in the settings is
 * picked up by the next restart. A failure before any process exists — a file
 * that cannot be created — is reported here, because no status will arrive
 * for it.
 */
function startSession(tabId: string): void {
  const settings = readSettings();
  const session = createSession({
    blendPath: tabId,
    blenderPath: settings.blenderPath,
    onChange(dirty: boolean) {
      sceneChanged(tabId, dirty);
    },
    onRender(png: Png, filePath: string) {
      renderSinks.get(tabId)?.(png, filePath);
    },
  });
  sessions.set(tabId, session);
  void session.start().catch((error: unknown) => {
    const state = states.get(tabId);
    if (state) {
      state.blender = "failed";
      state.blenderMessage = error instanceof Error ? error.message : String(error);
      pushState(tabId);
    }
  });
}

/** Opens a `.blend` as a tab: written down, its Blender started, its state tracked. */
function openBlend(blendPath: string): TabState {
  const tab = openTab(blendPath);
  let state = states.get(blendPath);
  if (!state) {
    state = {
      tab,
      blender: "starting",
      blenderMessage: "",
      dirty: false,
      running: isRunning(blendPath),
      modelStamp: 0,
      tokensUsed: readTokens(blendPath).used,
      tokensCached: readTokens(blendPath).cached,
      conversationStarted: messagesOf(blendPath).length > 0,
    };
    states.set(blendPath, state);
  }
  startSession(blendPath);
  pushState(blendPath);
  return state;
}

/** `~`, relative paths and a missing extension are all taken care of. */
function normaliseBlendPath(raw: string): string {
  let text = raw.trim();
  if (text.length === 0) {
    throw new Error("Give the model a file path.");
  }
  if (text.startsWith("~")) {
    text = path.join(os.homedir(), text.slice(1));
  }
  text = path.resolve(text);
  if (path.extname(text).toLowerCase() !== ".blend") {
    text = `${text}.blend`;
  }
  return text;
}

/**
 * Serves `modelgen://model?tab=…` (the viewer's glTF) and `modelgen://image?id=…`
 * (a picture out of SQLite). Only files of open tabs are served.
 */
async function serve(request: Request): Promise<Response> {
  const url = new URL(request.url);
  // The page is file://, another origin, so every answer has to allow it.
  const cors = { "access-control-allow-origin": "*" };
  if (url.hostname === "model") {
    const tabId = url.searchParams.get("tab") ?? "";
    if (!states.has(tabId)) {
      return new Response("not an open tab", { status: 403, headers: cors });
    }
    const file = await net.fetch(pathToFileURL(modelPath(tabId)).toString());
    return new Response(file.body, {
      status: file.status,
      headers: { ...cors, "content-type": "model/gltf-binary", "cache-control": "no-store" },
    });
  }
  if (url.hostname === "image") {
    const image = readImage(url.searchParams.get("id") ?? "");
    if (!image) {
      return new Response("no such image", { status: 404, headers: cors });
    }
    return new Response(new Uint8Array(image.bytes), {
      headers: { ...cors, "content-type": image.mime, "cache-control": "max-age=31536000" },
    });
  }
  return new Response("unknown resource", { status: 404, headers: cors });
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 980,
    minHeight: 600,
    backgroundColor: "#12131a",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(here, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // An ESM preload only loads with the sandbox off.
      sandbox: false,
    },
  });
  const devUrl = process.env.MODELGEN_DEV_URL;
  if (devUrl) {
    void window.loadURL(devUrl);
  } else {
    void window.loadFile(path.join(here, "..", "renderer", "index.html"));
  }
  return window;
}

/**
 * Drops the conversation of a tab. `forgetAgent` also drops the agent that
 * held it, which is what puts the panel back to its Clear state. The `.blend`
 * is not touched: the model stays, only the talk about it goes.
 */
function resetChat(tabId: string, forgetAgent: boolean): void {
  const state = states.get(tabId);
  if (!state) {
    return;
  }
  if (isRunning(tabId)) {
    throw new Error("The agent is still working on this model. Cancel the run first.");
  }
  clearConversation(tabId);
  state.conversationStarted = false;
  if (forgetAgent) {
    setTabAgentKind(tabId, "");
    state.tab = { ...state.tab, agentKind: "", agentModel: "", reasoningEffort: "" };
  }
  state.tokensUsed = 0;
  state.tokensCached = 0;
  broadcast({ type: "chat-cleared", tabId });
  pushState(tabId);
}

/** Writes the tab's file. The session clears its own dirty flag, which is what pushes the state. */
async function saveTab(tabId: string): Promise<void> {
  await sessions.get(tabId)?.save();
}

function registerIpc(): void {
  ipcMain.handle(IPC.tabsList, (): TabState[] => {
    return [...states.values()];
  });

  ipcMain.handle(IPC.tabsPickPath, async (_event, mode: "existing" | "fresh"): Promise<string | null> => {
    const filters = [{ name: "Blender file", extensions: ["blend"] }];
    if (mode === "existing") {
      const picked = await dialog.showOpenDialog({
        title: "Open a model",
        properties: ["openFile"],
        filters,
        buttonLabel: "Open model",
      });
      return picked.canceled ? null : (picked.filePaths[0] ?? null);
    }
    const picked = await dialog.showSaveDialog({
      title: "New model",
      defaultPath: path.join(app.getPath("documents"), "model.blend"),
      filters,
      buttonLabel: "Create model",
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });
    return picked.canceled ? null : (picked.filePath ?? null);
  });

  ipcMain.handle(IPC.tabsCreate, (_event, raw: string): TabState => {
    return openBlend(normaliseBlendPath(raw));
  });

  ipcMain.handle(IPC.tabsClose, async (_event, tabId: string): Promise<CloseResult> => {
    const state = states.get(tabId);
    if (!state) {
      return { ok: true, reason: "" };
    }
    if (isRunning(tabId)) {
      return { ok: false, reason: "The agent is still working on this model. Cancel the run first." };
    }
    // Only a running Blender can still be saved. When it is gone the changes
    // are gone with it, so the tab closes instead of refusing forever.
    if (state.dirty && state.blender === "ready") {
      return { ok: false, reason: "The model has unsaved changes. Save it, then close the tab." };
    }
    await sessions.get(tabId)?.stop();
    sessions.delete(tabId);
    renderSinks.delete(tabId);
    closeTab(tabId);
    states.delete(tabId);
    broadcast({ type: "tab-closed", tabId });
    return { ok: true, reason: "" };
  });

  ipcMain.handle(IPC.tabsSave, async (_event, tabId: string): Promise<void> => {
    await saveTab(tabId);
  });

  ipcMain.handle(IPC.tabsReveal, async (_event, tabId: string): Promise<void> => {
    try {
      await stat(tabId);
      shell.showItemInFolder(tabId);
    } catch {
      await shell.openPath(path.dirname(tabId));
    }
  });

  ipcMain.handle(IPC.tabsRestart, async (_event, tabId: string): Promise<void> => {
    if (!states.has(tabId)) {
      return;
    }
    await sessions.get(tabId)?.stop();
    startSession(tabId);
    pushState(tabId);
  });

  ipcMain.handle(
    IPC.tabsSetAgent,
    (_event, tabId: string, agentModel: string, reasoningEffort: ReasoningEffort): void => {
      const state = states.get(tabId);
      if (!state) {
        return;
      }
      setTabAgent(tabId, agentModel, reasoningEffort);
      state.tab = { ...state.tab, agentModel, reasoningEffort };
      pushState(tabId);
    },
  );

  ipcMain.handle(IPC.tabsSetAgentKind, (_event, tabId: string, agentKind: AgentKind): void => {
    const state = states.get(tabId);
    if (!state) {
      return;
    }
    // The agent is fixed for the length of a conversation: it holds the thread
    // that remembers what was built, and the other agent cannot pick that up.
    if (messagesOf(tabId).length > 0) {
      throw new Error("Close the conversation before choosing another agent.");
    }
    setTabAgentKind(tabId, agentKind);
    state.tab = { ...state.tab, agentKind, agentModel: "", reasoningEffort: "" };
    pushState(tabId);
  });

  ipcMain.handle(IPC.tabsOutline, async (_event, tabId: string): Promise<SceneOutline> => {
    const state = states.get(tabId);
    const session = sessions.get(tabId);
    if (!state || !session || state.blender !== "ready") {
      throw new Error(`Blender is ${state?.blender ?? "not running"} for this file.`);
    }
    return await session.outline();
  });

  ipcMain.handle(IPC.chatList, (_event, tabId: string): ChatMessage[] => {
    return messagesOf(tabId);
  });

  ipcMain.handle(IPC.chatSend, async (_event, request: SendRequest): Promise<void> => {
    const state = states.get(request.tabId);
    const session = sessions.get(request.tabId);
    if (!state || !session) {
      throw new Error("That tab is not open.");
    }
    if (state.blender !== "ready") {
      throw new Error(`Blender is ${state.blender}. ${state.blenderMessage}`);
    }
    state.running = true;
    // The turn writes the user's message before anything else can fail, so the
    // conversation has started from here on whatever the agent does with it.
    state.conversationStarted = true;
    pushState(request.tabId);
    try {
      await runTurn(request, readSettings(), session, {
        emit: broadcast,
        captureRenders: (tabId: string, sink: (png: Png, filePath: string) => void): (() => void) => {
          renderSinks.set(tabId, sink);
          return () => {
            if (renderSinks.get(tabId) === sink) {
              renderSinks.delete(tabId);
            }
          };
        },
        refreshModel,
        tokensChanged: (tabId: string, used: number, cached: number) => {
          const tab = states.get(tabId);
          if (tab) {
            tab.tokensUsed = used;
            tab.tokensCached = cached;
            pushState(tabId);
          }
        },
      });
    } finally {
      state.running = false;
      pushState(request.tabId);
    }
  });

  ipcMain.handle(IPC.chatCancel, (_event, tabId: string): void => {
    cancelRun(tabId);
  });

  ipcMain.handle(IPC.chatClear, (_event, tabId: string): void => {
    resetChat(tabId, false);
  });

  ipcMain.handle(IPC.chatClose, (_event, tabId: string): void => {
    resetChat(tabId, true);
  });

  ipcMain.handle(IPC.settingsGet, (): Settings => {
    return readSettings();
  });

  ipcMain.handle(IPC.settingsSet, (_event, settings: Settings): Settings => {
    return writeSettings(settings);
  });
}

void app.whenReady().then(async () => {
  // The viewer's glTF exports belong with the rest of the app's data.
  setExportsDir(path.join(app.getPath("userData"), "exports"));
  protocol.handle(SCHEME, serve);
  failStaleRuns();
  await startMcpServer();
  registerIpc();
  createWindow();
  // Every tab that was open last time comes back, each with its own Blender.
  for (const tab of openTabs()) {
    openBlend(tab.blendPath);
  }
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

let quitting = false;
app.on("before-quit", (event) => {
  if (quitting) {
    return;
  }
  quitting = true;
  event.preventDefault();
  void stopAll().finally(() => {
    app.quit();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
