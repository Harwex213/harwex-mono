import { mkdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from "electron";
import { createSession, modelPath, onStatus, setExportsDir, stopAll } from "@hw/headless-blender-mcp";
import type { BlenderSession, Png } from "@hw/headless-blender-mcp";
import { IPC, SCHEME } from "../shared/bridge.js";
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
} from "../shared/types.js";
import { startMcpServer } from "./agent/mcp-server.js";
import { cancelRun, isRunning, runTurn } from "./agent/runner.js";
import { scanAssets, unwatchAssets, watchAssets } from "./assets.js";
import { clearConversation, messagesOf, readImage, readTokens } from "./chat.js";
import {
  closeTab,
  currentProject,
  openProject,
  openTab,
  openTabs,
  readSettings,
  readWindowFullscreen,
  recentProjects,
  setTabAgent,
  setTabAgentKind,
  writeSettings,
  writeWindowFullscreen,
} from "./db.js";

// Without this the user data lands under a directory named "@hw".
app.setName("assets-harness");
// A second copy of the app, for a test run, keeps its data apart from the one
// in use: the database, the exports and the Codex home all live under here.
if (process.env.ASSETS_HARNESS_USER_DATA) {
  app.setPath("userData", process.env.ASSETS_HARNESS_USER_DATA);
}

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
/** The project the window works in. Every open tab is one of its models. */
let project: Project | null = null;
/** Its Assets directory, as last read. */
let assetIndex: AssetIndex | null = null;

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
function openBlend(blendPath: string, projectPath: string): TabState {
  const tab = openTab(blendPath, projectPath);
  let state = states.get(blendPath);
  if (!state) {
    const tokens = readTokens(blendPath);
    state = {
      tab,
      blender: "starting",
      blenderMessage: "",
      dirty: false,
      running: isRunning(blendPath),
      modelStamp: 0,
      tokensUsed: tokens.used,
      tokensCached: tokens.cached,
      conversationStarted: messagesOf(blendPath).length > 0,
    };
    states.set(blendPath, state);
  }
  startSession(blendPath);
  pushState(blendPath);
  return state;
}

/**
 * A bare name is a model of the project: `Assets/blender/<Name>.blend`, the
 * one place the convention keeps models. A path is taken as it is, with `~`,
 * a relative path and a missing extension taken care of.
 */
function normaliseBlendPath(raw: string, current: Project): string {
  let text = raw.trim();
  if (text.length === 0) {
    throw new Error("Give the model a name or a file path.");
  }
  if (!text.includes("/") && !text.startsWith("~")) {
    const name = text.replace(/\.blend$/i, "");
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name)) {
      throw new Error("A model name is one word of letters, digits, `_`, `-` or `.`, in CamelCase.");
    }
    return path.join(current.assetsPath, "blender", `${name}.blend`);
  }
  if (text.startsWith("~")) {
    text = path.join(os.homedir(), text.slice(1));
  }
  text = path.resolve(current.path, text);
  if (path.extname(text).toLowerCase() !== ".blend") {
    text = `${text}.blend`;
  }
  return text;
}

/**
 * Serves `assetsharness://model?tab=…` (the viewer's glTF), `assetsharness://image?id=…`
 * (a picture of an open chat) and `assetsharness://asset?path=…` (a file of the
 * project's Assets directory, for the thumbnails of the Assets panel). Only
 * files of open tabs and of the open project are served.
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
  if (url.hostname === "asset") {
    const current = project;
    if (!current) {
      return new Response("no project", { status: 404, headers: cors });
    }
    const file = path.resolve(current.assetsPath, url.searchParams.get("path") ?? "");
    if (!file.startsWith(`${current.assetsPath}${path.sep}`)) {
      return new Response("outside the Assets directory", { status: 403, headers: cors });
    }
    const found = await net.fetch(pathToFileURL(file).toString());
    return new Response(found.body, {
      status: found.status,
      headers: { ...cors, "content-type": found.headers.get("content-type") ?? "application/octet-stream" },
    });
  }
  return new Response("unknown resource", { status: 404, headers: cors });
}

/** Reads the Assets directory again and tells every window. */
async function rescanAssets(): Promise<AssetIndex | null> {
  const current = project;
  if (!current) {
    return null;
  }
  const index = await scanAssets(current.path);
  if (project !== current) {
    return assetIndex;
  }
  assetIndex = index;
  broadcast({ type: "assets", index });
  return index;
}

/** Starts following the Assets directory of the current project. */
function followAssets(current: Project): void {
  watchAssets(current.assetsPath, () => {
    void rescanAssets();
  });
}

/**
 * Stops every tab of the current project, without writing them down as
 * closed: the next time the project is opened, they come back.
 */
async function leaveProject(): Promise<void> {
  for (const [tabId, state] of states) {
    if (isRunning(tabId)) {
      throw new Error(`The agent is still working on ${state.tab.name}. Cancel the run first.`);
    }
    if (state.dirty && state.blender === "ready") {
      throw new Error(`${state.tab.name} has unsaved changes. Save it before switching projects.`);
    }
  }
  for (const tabId of [...states.keys()]) {
    await sessions.get(tabId)?.stop();
    sessions.delete(tabId);
    renderSinks.delete(tabId);
    states.delete(tabId);
    broadcast({ type: "tab-closed", tabId });
  }
  unwatchAssets();
  project = null;
  assetIndex = null;
}

/** Makes a folder the current project: its assets read, its tabs reopened. */
async function enterProject(raw: string): Promise<Project> {
  let folder = raw.trim();
  if (folder.startsWith("~")) {
    folder = path.join(os.homedir(), folder.slice(1));
  }
  folder = path.resolve(folder);
  // The Assets directory itself means its project.
  if (path.basename(folder) === "Assets") {
    folder = path.dirname(folder);
  }
  let info;
  try {
    info = await stat(folder);
  } catch {
    throw new Error(`${folder} does not exist.`);
  }
  if (!info.isDirectory()) {
    throw new Error(`${folder} is not a folder.`);
  }
  if (project?.path === folder) {
    return project;
  }
  await leaveProject();
  const opened = openProject(folder);
  project = opened;
  broadcast({ type: "project", project: opened });
  followAssets(opened);
  await rescanAssets();
  for (const tab of openTabs(opened.path)) {
    // A file deleted since the tab was open is not made again: opening a
    // missing `.blend` creates it, and nobody asked for that here.
    try {
      await stat(tab.blendPath);
    } catch {
      closeTab(tab.blendPath);
      continue;
    }
    openBlend(tab.blendPath, opened.path);
  }
  return opened;
}

/**
 * The window comes back the way it was left, fullscreen or not.
 *
 * On macOS this decides which Space the app opens on. A regular window can
 * only live on a regular desktop Space, never in another app's fullscreen
 * Space. Launched from a fullscreen editor, a regular window lands on the
 * desktop and macOS switches there. A window that opens straight into native
 * fullscreen gets a fullscreen Space of its own instead, next to the editor's.
 */
function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 980,
    minHeight: 600,
    fullscreen: process.platform === "darwin" && readWindowFullscreen(),
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
  window.on("enter-full-screen", () => {
    writeWindowFullscreen(true);
  });
  window.on("leave-full-screen", () => {
    writeWindowFullscreen(false);
  });
  const devUrl = process.env.ASSETS_HARNESS_DEV_URL;
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

function requireProject(): Project {
  if (!project) {
    throw new Error("Open a project first.");
  }
  return project;
}

function registerIpc(): void {
  ipcMain.handle(IPC.projectsCurrent, (): Project | null => {
    return project;
  });

  ipcMain.handle(IPC.projectsRecent, (): Project[] => {
    return recentProjects();
  });

  ipcMain.handle(IPC.projectsPick, async (): Promise<string | null> => {
    const picked = await dialog.showOpenDialog({
      title: "Open a project",
      message: "Choose the project folder — the one that holds Assets/.",
      properties: ["openDirectory", "createDirectory"],
      buttonLabel: "Open project",
    });
    return picked.canceled ? null : (picked.filePaths[0] ?? null);
  });

  ipcMain.handle(IPC.projectsOpen, async (_event, projectPath: string): Promise<Project> => {
    return await enterProject(projectPath);
  });

  ipcMain.handle(IPC.projectsAssets, (): AssetIndex | null => {
    return assetIndex;
  });

  ipcMain.handle(IPC.projectsRescan, async (): Promise<AssetIndex | null> => {
    return await rescanAssets();
  });

  ipcMain.handle(IPC.projectsReveal, async (_event, relPath: string): Promise<void> => {
    const current = requireProject();
    const target = path.resolve(current.assetsPath, relPath);
    if (target !== current.assetsPath && !target.startsWith(`${current.assetsPath}${path.sep}`)) {
      throw new Error("That path is outside the Assets directory.");
    }
    try {
      const info = await stat(target);
      if (info.isDirectory()) {
        await shell.openPath(target);
      } else {
        shell.showItemInFolder(target);
      }
    } catch {
      await shell.openPath(current.assetsPath);
    }
  });

  ipcMain.handle(IPC.tabsList, (): TabState[] => {
    return [...states.values()];
  });

  ipcMain.handle(IPC.tabsPickPath, async (): Promise<string | null> => {
    const current = requireProject();
    const picked = await dialog.showOpenDialog({
      title: "Open a model",
      defaultPath: path.join(current.assetsPath, "blender"),
      properties: ["openFile"],
      filters: [{ name: "Blender file", extensions: ["blend"] }],
      buttonLabel: "Open model",
    });
    return picked.canceled ? null : (picked.filePaths[0] ?? null);
  });

  ipcMain.handle(IPC.tabsCreate, async (_event, raw: string): Promise<TabState> => {
    const current = requireProject();
    const blendPath = normaliseBlendPath(raw, current);
    // A project without Assets/ gets one here, and the watch starts with it.
    const hadAssets = assetIndex?.exists === true;
    await mkdir(path.dirname(blendPath), { recursive: true });
    const state = openBlend(blendPath, current.path);
    if (!hadAssets) {
      followAssets(current);
    }
    void rescanAssets();
    return state;
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
  await startMcpServer();
  registerIpc();
  createWindow();
  // The project that was open last time comes back, and with it every tab
  // that was open in it, each with its own Blender.
  const last = currentProject();
  if (last) {
    try {
      await enterProject(last.path);
    } catch (error) {
      broadcast({ type: "notice", tabId: "", text: error instanceof Error ? error.message : String(error) });
    }
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
  unwatchAssets();
  void stopAll().finally(() => {
    app.quit();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
