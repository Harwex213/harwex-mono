import { contextBridge, ipcRenderer } from "electron";
import type { HarnessBridge } from "../shared/bridge.js";
import { IPC } from "../shared/bridge.js";
import type { WorkspaceEvent } from "../shared/types.js";

const bridge: HarnessBridge = {
  tabs: {
    list: () => ipcRenderer.invoke(IPC.tabsList),
    pickPath: (mode) => ipcRenderer.invoke(IPC.tabsPickPath, mode),
    create: (blendPath) => ipcRenderer.invoke(IPC.tabsCreate, blendPath),
    close: (tabId) => ipcRenderer.invoke(IPC.tabsClose, tabId),
    save: (tabId) => ipcRenderer.invoke(IPC.tabsSave, tabId),
    reveal: (tabId) => ipcRenderer.invoke(IPC.tabsReveal, tabId),
    restart: (tabId) => ipcRenderer.invoke(IPC.tabsRestart, tabId),
  },
  chat: {
    list: (tabId) => ipcRenderer.invoke(IPC.chatList, tabId),
    send: (request) => ipcRenderer.invoke(IPC.chatSend, request),
    cancel: (tabId) => ipcRenderer.invoke(IPC.chatCancel, tabId),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (settings) => ipcRenderer.invoke(IPC.settingsSet, settings),
  },
  subscribe: (listener) => {
    const handler = (_event: unknown, payload: WorkspaceEvent) => {
      listener(payload);
    };
    ipcRenderer.on(IPC.event, handler);
    return () => {
      ipcRenderer.off(IPC.event, handler);
    };
  },
};

contextBridge.exposeInMainWorld("harness", bridge);
