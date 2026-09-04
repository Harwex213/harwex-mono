import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  ipcMain,
  net,
  protocol,
  shell,
} from "electron";
import { IPC } from "../shared/bridge.js";
import type { Graph, ImageRunRequest, Recent, RunEvent, RunRequest, Tab } from "../shared/types.js";
import { runImageGeneration, runPromptGeneration } from "./agent/runner.js";
import {
  closeWorkspace,
  forgetWorkspace,
  isDirectory,
  openTabs,
  recents,
  remember,
  setNodeCount,
} from "./workspaces.js";
import {
  ensureWorkspace,
  imagePath,
  IMAGES_DIR,
  loadGraph,
  readPrompt,
  removeNodeFile,
  saveGraph,
  writeImage,
} from "./workspace.js";

// Without this the user data lands under a directory named "@hw".
app.setName("imagen-harness");

const here = path.dirname(fileURLToPath(import.meta.url));
const IMAGE_SCHEME = "imagen";
const PNG = "image/png";

/** The directories this window is allowed to read images out of. */
const openDirs = new Set<string>();

protocol.registerSchemesAsPrivileged([
  {
    scheme: IMAGE_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

function trackDirs(tabs: Tab[]): Tab[] {
  openDirs.clear();
  for (const tab of tabs) {
    openDirs.add(tab.dir);
  }
  return tabs;
}

/**
 * Serves `imagen://file?path=…`. A generated image sits in the user's own
 * working directory, so the renderer cannot be given `file://` — and it cannot
 * be given free rein either, hence the check against the open tabs.
 */
function serveImage(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const file = url.searchParams.get("path");
  if (!file) {
    return Promise.resolve(new Response("no path", { status: 400 }));
  }
  const resolved = path.resolve(file);
  const allowed = [...openDirs].some((dir) => {
    return resolved.startsWith(path.join(dir, IMAGES_DIR) + path.sep);
  });
  if (!allowed) {
    return Promise.resolve(new Response("outside the open working directories", { status: 403 }));
  }
  return net.fetch(pathToFileURL(resolved).toString());
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
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

  const devUrl = process.env.IMAGEN_DEV_URL;
  if (devUrl) {
    void window.loadURL(devUrl);
  } else {
    void window.loadFile(path.join(here, "..", "renderer", "index.html"));
  }
  return window;
}

function broadcast(event: RunEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC.runEvent, event);
  }
}

/** Opens a directory as a tab: written down, made ready, and served from now on. */
async function openDirectory(dir: string): Promise<Tab> {
  const tab = remember(dir, true);
  trackDirs(await openTabs());
  await ensureWorkspace(dir);
  return tab;
}

function registerIpc(): void {
  ipcMain.handle(IPC.tabsList, async (): Promise<Tab[]> => {
    const tabs = trackDirs(await openTabs());
    await Promise.all(tabs.map((tab) => ensureWorkspace(tab.dir)));
    return tabs;
  });

  ipcMain.handle(IPC.tabsCreate, async (): Promise<Tab | null> => {
    const picked = await dialog.showOpenDialog({
      title: "Pick a working directory",
      properties: ["openDirectory", "createDirectory"],
      buttonLabel: "Open canvas",
    });
    const dir = picked.filePaths[0];
    if (picked.canceled || !dir) {
      return null;
    }
    return await openDirectory(dir);
  });

  ipcMain.handle(IPC.tabsClose, async (_event, dir: string): Promise<Tab[]> => {
    closeWorkspace(dir);
    return trackDirs(await openTabs());
  });

  ipcMain.handle(IPC.tabsReveal, async (_event, dir: string): Promise<void> => {
    await shell.openPath(dir);
  });

  ipcMain.handle(IPC.recentsList, async (): Promise<Recent[]> => {
    const list = await recents();
    // A directory carried over from an older version, or one open but never
    // looked at, has no count yet. Reading its graph once settles it.
    return await Promise.all(
      list.map(async (entry) => {
        if (entry.missing || entry.nodeCount > 0) {
          return entry;
        }
        const graph = await loadGraph(entry.dir);
        setNodeCount(entry.dir, graph.nodes.length);
        return { ...entry, nodeCount: graph.nodes.length };
      }),
    );
  });

  ipcMain.handle(IPC.recentsOpen, async (_event, dir: string): Promise<Tab | null> => {
    // A directory that has been moved or deleted is not opened: doing so would
    // create it again, empty, and lose the list entry that says where it was.
    if (!(await isDirectory(dir))) {
      return null;
    }
    return await openDirectory(dir);
  });

  ipcMain.handle(IPC.recentsForget, async (_event, dir: string): Promise<Recent[]> => {
    forgetWorkspace(dir);
    trackDirs(await openTabs());
    return await recents();
  });

  ipcMain.handle(IPC.graphLoad, async (_event, dir: string): Promise<Graph> => {
    const graph = await loadGraph(dir);
    // Opening counts too, or a directory only ever read would sit at zero nodes.
    setNodeCount(dir, graph.nodes.length);
    return graph;
  });

  ipcMain.handle(IPC.graphSave, async (_event, dir: string, graph: Graph): Promise<void> => {
    await saveGraph(dir, graph);
    // The recents list says how big a canvas is without opening it.
    setNodeCount(dir, graph.nodes.length);
  });

  ipcMain.handle(IPC.promptRead, (_event, dir: string, id: string): Promise<string> => {
    return readPrompt(dir, id);
  });

  ipcMain.handle(
    IPC.fileRemove,
    (_event, dir: string, kind: "prompt" | "image", id: string): Promise<void> => {
      return removeNodeFile(dir, kind, id);
    },
  );

  ipcMain.handle(
    IPC.fileWriteImage,
    (_event, dir: string, id: string, bytes: ArrayBuffer): Promise<void> => {
      return writeImage(dir, id, new Uint8Array(bytes));
    },
  );

  ipcMain.handle(IPC.fileCopyImage, async (_event, dir: string, id: string): Promise<void> => {
    const bytes = await readFile(imagePath(dir, id));
    const blob = new Blob([new Uint8Array(bytes)], { type: PNG });
    await clipboard.write([new ClipboardItem({ [PNG]: blob })]);
  });

  ipcMain.handle(IPC.fileClipboardImage, async (): Promise<ArrayBuffer | null> => {
    if (!(await clipboard.has(PNG))) {
      return null;
    }
    for (const item of await clipboard.read()) {
      if (!item.types.includes(PNG)) {
        continue;
      }
      const value = await item.getType(PNG);
      if (value instanceof Blob) {
        return await value.arrayBuffer();
      }
    }
    return null;
  });

  ipcMain.handle(IPC.runPrompt, (_event, request: RunRequest) => {
    return runPromptGeneration(request, broadcast);
  });

  ipcMain.handle(IPC.runImage, (_event, request: ImageRunRequest) => {
    return runImageGeneration(request, broadcast);
  });
}

void app.whenReady().then(async () => {
  protocol.handle(IMAGE_SCHEME, serveImage);
  registerIpc();
  trackDirs(await openTabs());
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
