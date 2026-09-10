import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from "electron";
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
import * as blender from "./blender/process.js";
import { exportModel, modelPath, readOutline, save } from "./blender/scene.js";
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
 *
 * `changed` says whether something ran in that Blender that may have edited
 * the scene. Those are the only moments a tab becomes dirty: the flag is set
 * here and cleared by a save, and Blender is never asked about it. See the
 * note on `save` in `blender/scene.ts` for why its own flag cannot be used.
 */
function refreshScene(tabId: string, changed: boolean): void {
  const state = states.get(tabId);
  if (changed && state && !state.dirty) {
    state.dirty = true;
    pushState(tabId);
  }
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
          const file = await exportModel(tabId);
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

/** Whether the tab's Blender holds edits that are not on disk. */
function hasUnsavedChanges(tabId: string): boolean {
  return states.get(tabId)?.dirty === true;
}

blender.onStatus((blendPath, status, message) => {
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
    refreshScene(blendPath, false);
  }
});

/** Starts (or restarts) the Blender behind a tab. */
async function startBlender(tabId: string): Promise<void> {
  const settings = readSettings();
  await blender.start(settings.blenderPath, tabId);
}

/** Opens a `.blend` as a tab: written down, its Blender started, its state tracked. */
async function openBlend(blendPath: string): Promise<TabState> {
  const settings = readSettings();
  await blender.ensureBlendFile(settings.blenderPath, blendPath);
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
  await startBlender(blendPath);
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

async function saveTab(tabId: string): Promise<void> {
  await save(tabId);
  const state = states.get(tabId);
  if (state) {
    state.dirty = false;
    pushState(tabId);
  }
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

  ipcMain.handle(IPC.tabsCreate, async (_event, raw: string): Promise<TabState> => {
    return await openBlend(normaliseBlendPath(raw));
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
    await blender.stop(tabId);
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
    await blender.stop(tabId);
    await startBlender(tabId);
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
    if (!state || state.blender !== "ready") {
      throw new Error(`Blender is ${state?.blender ?? "not running"} for this file.`);
    }
    return await readOutline(tabId);
  });

  ipcMain.handle(IPC.chatList, (_event, tabId: string): ChatMessage[] => {
    return messagesOf(tabId);
  });

  ipcMain.handle(IPC.chatSend, async (_event, request: SendRequest): Promise<void> => {
    const state = states.get(request.tabId);
    if (!state) {
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
      await runTurn(request, readSettings(), {
        emit: broadcast,
        hasUnsavedChanges,
        sceneChanged: (tabId: string) => {
          refreshScene(tabId, true);
        },
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
  protocol.handle(SCHEME, serve);
  failStaleRuns();
  await startMcpServer();
  registerIpc();
  createWindow();
  // Every tab that was open last time comes back, each with its own Blender.
  for (const tab of openTabs()) {
    void openBlend(tab.blendPath).catch((error: unknown) => {
      broadcast({ type: "notice", tabId: tab.blendPath, text: error instanceof Error ? error.message : String(error) });
    });
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
  void blender.stopAll().finally(() => {
    app.quit();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
