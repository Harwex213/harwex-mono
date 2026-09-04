import { contextBridge, ipcRenderer } from "electron";
import type { HarnessBridge } from "../shared/bridge.js";
import { IPC } from "../shared/bridge.js";
import type { RunEvent } from "../shared/types.js";

const bridge: HarnessBridge = {
  tabs: {
    list: () => ipcRenderer.invoke(IPC.tabsList),
    create: () => ipcRenderer.invoke(IPC.tabsCreate),
    close: (id) => ipcRenderer.invoke(IPC.tabsClose, id),
    reveal: (dir) => ipcRenderer.invoke(IPC.tabsReveal, dir),
  },
  recents: {
    list: () => ipcRenderer.invoke(IPC.recentsList),
    open: (dir) => ipcRenderer.invoke(IPC.recentsOpen, dir),
    forget: (dir) => ipcRenderer.invoke(IPC.recentsForget, dir),
  },
  graph: {
    load: (dir) => ipcRenderer.invoke(IPC.graphLoad, dir),
    save: (dir, graph) => ipcRenderer.invoke(IPC.graphSave, dir, graph),
  },
  prompts: {
    read: (dir, id) => ipcRenderer.invoke(IPC.promptRead, dir, id),
  },
  files: {
    remove: (dir, kind, id) => ipcRenderer.invoke(IPC.fileRemove, dir, kind, id),
    writeImage: (dir, id, bytes) => ipcRenderer.invoke(IPC.fileWriteImage, dir, id, bytes),
    copyImage: (dir, id) => ipcRenderer.invoke(IPC.fileCopyImage, dir, id),
    readClipboardImage: () => ipcRenderer.invoke(IPC.fileClipboardImage),
  },
  run: {
    prompt: (request) => ipcRenderer.invoke(IPC.runPrompt, request),
    image: (request) => ipcRenderer.invoke(IPC.runImage, request),
    subscribe: (listener) => {
      const handler = (_event: unknown, payload: RunEvent) => {
        listener(payload);
      };
      ipcRenderer.on(IPC.runEvent, handler);
      return () => {
        ipcRenderer.off(IPC.runEvent, handler);
      };
    },
  },
};

contextBridge.exposeInMainWorld("harness", bridge);
