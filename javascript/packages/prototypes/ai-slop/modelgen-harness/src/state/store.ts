import { computed, signal } from "@preact/signals-react";
import type { ChatMessage, ReasoningEffort, SceneOutline, Settings, TabState, WorkspaceEvent } from "../../shared/types.js";
import { harness } from "./bridge.js";

/**
 * Everything the window knows, as signals. The main process owns the truth
 * and pushes it here through workspace events; the renderer only asks.
 */

/** A picture waiting in the composer: a dropped file, a paste, a viewer screenshot. */
interface Attachment {
  id: string;
  name: string;
  bytes: ArrayBuffer;
  /** An object URL for the thumbnail. Revoked when the attachment goes. */
  url: string;
}

const tabs = signal<TabState[]>([]);
const activeTabId = signal<string | null>(null);
const activeTab = computed(() => {
  return tabs.value.find((state) => state.tab.id === activeTabId.value) ?? null;
});
const messagesByTab = signal<Record<string, ChatMessage[]>>({});
const attachmentsByTab = signal<Record<string, Attachment[]>>({});
const settings = signal<Settings | null>(null);
const notice = signal("");
const showNewTab = signal(false);
const showSettings = signal(false);

let initialised = false;

function setNotice(text: string): void {
  notice.value = text;
}

function fail(error: unknown): void {
  setNotice(error instanceof Error ? error.message : String(error));
}

function upsertTab(state: TabState): void {
  const list = tabs.value;
  const index = list.findIndex((entry) => entry.tab.id === state.tab.id);
  if (index < 0) {
    tabs.value = [...list, state];
  } else {
    tabs.value = list.map((entry, at) => (at === index ? state : entry));
  }
}

function removeTab(tabId: string): void {
  tabs.value = tabs.value.filter((entry) => entry.tab.id !== tabId);
  if (activeTabId.value === tabId) {
    activeTabId.value = tabs.value[0]?.tab.id ?? null;
  }
}

function upsertMessage(message: ChatMessage): void {
  const list = messagesByTab.value[message.tabId] ?? [];
  const index = list.findIndex((entry) => entry.id === message.id);
  const next = index < 0 ? [...list, message] : list.map((entry, at) => (at === index ? message : entry));
  next.sort((a, b) => a.createdAt - b.createdAt);
  messagesByTab.value = { ...messagesByTab.value, [message.tabId]: next };
}

function onEvent(event: WorkspaceEvent): void {
  if (event.type === "tab") {
    upsertTab(event.state);
    if (activeTabId.value === null) {
      activeTabId.value = event.state.tab.id;
    }
    return;
  }
  if (event.type === "tab-closed") {
    removeTab(event.tabId);
    return;
  }
  if (event.type === "message") {
    upsertMessage(event.message);
    return;
  }
  setNotice(event.text);
}

async function loadMessages(tabId: string): Promise<void> {
  if (messagesByTab.value[tabId]) {
    return;
  }
  const list = await harness.chat.list(tabId);
  messagesByTab.value = { ...messagesByTab.value, [tabId]: list };
}

async function init(): Promise<void> {
  if (initialised) {
    return;
  }
  initialised = true;
  harness.subscribe(onEvent);
  try {
    settings.value = await harness.settings.get();
    const list = await harness.tabs.list();
    tabs.value = list;
    activeTabId.value = list[0]?.tab.id ?? null;
    if (activeTabId.value) {
      await loadMessages(activeTabId.value);
    }
  } catch (error) {
    fail(error);
  }
}

async function selectTab(tabId: string): Promise<void> {
  activeTabId.value = tabId;
  try {
    await loadMessages(tabId);
  } catch (error) {
    fail(error);
  }
}

async function createTab(blendPath: string): Promise<boolean> {
  try {
    const state = await harness.tabs.create(blendPath);
    upsertTab(state);
    await selectTab(state.tab.id);
    showNewTab.value = false;
    return true;
  } catch (error) {
    fail(error);
    return false;
  }
}

async function closeTab(tabId: string): Promise<void> {
  try {
    const result = await harness.tabs.close(tabId);
    if (!result.ok) {
      setNotice(result.reason);
      return;
    }
    removeTab(tabId);
    if (activeTabId.value) {
      await loadMessages(activeTabId.value);
    }
  } catch (error) {
    fail(error);
  }
}

async function saveTab(tabId: string): Promise<void> {
  try {
    await harness.tabs.save(tabId);
    setNotice("Saved.");
  } catch (error) {
    fail(error);
  }
}

async function restartBlender(tabId: string): Promise<void> {
  try {
    await harness.tabs.restart(tabId);
  } catch (error) {
    fail(error);
  }
}

async function saveSettings(next: Settings): Promise<void> {
  try {
    settings.value = await harness.settings.set(next);
    showSettings.value = false;
  } catch (error) {
    fail(error);
  }
}

// ---------------------------------------------------------------------------
// Composer attachments.

let attachmentCounter = 0;

async function addAttachment(tabId: string, blob: Blob, name: string): Promise<void> {
  const bytes = await blob.arrayBuffer();
  attachmentCounter += 1;
  const attachment: Attachment = {
    id: `att-${Date.now().toString(36)}-${attachmentCounter}`,
    name,
    bytes,
    url: URL.createObjectURL(blob),
  };
  const list = attachmentsByTab.value[tabId] ?? [];
  attachmentsByTab.value = { ...attachmentsByTab.value, [tabId]: [...list, attachment] };
}

function removeAttachment(tabId: string, id: string): void {
  const list = attachmentsByTab.value[tabId] ?? [];
  for (const entry of list) {
    if (entry.id === id) {
      URL.revokeObjectURL(entry.url);
    }
  }
  attachmentsByTab.value = { ...attachmentsByTab.value, [tabId]: list.filter((entry) => entry.id !== id) };
}

function clearAttachments(tabId: string): void {
  for (const entry of attachmentsByTab.value[tabId] ?? []) {
    URL.revokeObjectURL(entry.url);
  }
  attachmentsByTab.value = { ...attachmentsByTab.value, [tabId]: [] };
}

/** Sends the message. Resolves once the run has ended, one way or the other. */
async function send(tabId: string, text: string): Promise<void> {
  const images = (attachmentsByTab.value[tabId] ?? []).map((entry) => {
    return { name: entry.name, bytes: entry.bytes };
  });
  clearAttachments(tabId);
  try {
    await harness.chat.send({ tabId, text, images });
  } catch (error) {
    fail(error);
  }
}

function cancel(tabId: string): void {
  void harness.chat.cancel(tabId);
}

/** The collection and object tree of a tab's Blender. Read fresh every time. */
function readOutline(tabId: string): Promise<SceneOutline> {
  return harness.tabs.outline(tabId);
}

/** Model and effort of one tab. The main process stores them and pushes the tab back. */
async function setTabAgent(tabId: string, agentModel: string, reasoningEffort: ReasoningEffort): Promise<void> {
  try {
    await harness.tabs.setAgent(tabId, agentModel, reasoningEffort);
  } catch (error) {
    fail(error);
  }
}

export type { Attachment };
export {
  activeTab,
  activeTabId,
  addAttachment,
  attachmentsByTab,
  cancel,
  clearAttachments,
  closeTab,
  createTab,
  init,
  messagesByTab,
  notice,
  removeAttachment,
  restartBlender,
  readOutline,
  saveSettings,
  saveTab,
  setTabAgent,
  selectTab,
  send,
  setNotice,
  settings,
  showNewTab,
  showSettings,
  tabs,
};
