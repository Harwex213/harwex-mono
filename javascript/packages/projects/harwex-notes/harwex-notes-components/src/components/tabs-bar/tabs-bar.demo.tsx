import { signal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { TabsBar } from "./tabs-bar";
import type { CSSProperties } from "react";
import type { TFsFileKind } from "@hw/harwex-notes-protocol";
import type { TTab, TTabSaveState, TTabsBarRegistrySlice } from "./tabs-bar.types";
import type { TDemo } from "../../../dev/demo";

type TFile = { id: string; name: string; kind: TFsFileKind };

// The files the reader can open, in the order the tree would list them.
const READING_LIST: TFile = { id: "inbox/reading-list", name: "reading-list.md", kind: "markdown" };
const JOURNAL_24: TFile = { id: "journal/08-24", name: "2026-08-24.md", kind: "markdown" };
const JOURNAL_26: TFile = { id: "journal/08-26", name: "2026-08-26.md", kind: "markdown" };
const PLAN: TFile = { id: "projects/harwex-notes/plan", name: "plan.md", kind: "markdown" };
const ARCH: TFile = {
  id: "projects/harwex-notes/arch",
  name: "architecture.excalidraw",
  kind: "excalidraw",
};
const LONG_NAME: TFile = {
  id: "projects/ostrov/todo",
  name: "a-rather-long-file-name-that-gets-cut.md",
  kind: "markdown",
};
const SCRATCH: TFile = { id: "scratch", name: "scratch.excalidraw", kind: "excalidraw" };

const VAULT: readonly TFile[] = [READING_LIST, JOURNAL_24, JOURNAL_26, PLAN, ARCH, LONG_NAME, SCRATCH];

const INITIAL_TABS: readonly TTab[] = [
  { ...READING_LIST, saveState: "saved" },
  { ...PLAN, saveState: "unsaved" },
  { ...ARCH, saveState: "saved" },
];

const SAVE_STATES: readonly TTabSaveState[] = [
  "loading",
  "saved",
  "unsaved",
  "saving",
  "failed",
  "conflict",
  "deleted",
];

// The host's dark palette, scoped to the demo frame so the playground itself stays light.
const DARK_TOKENS: CSSProperties = {
  "--color-canvas": "#17181a",
  "--color-surface": "#1e2023",
  "--color-surface-sunken": "#24272b",
  "--color-border": "#32353a",
  "--color-border-strong": "#4a4e55",
  "--color-text": "#e6e5e1",
  "--color-text-muted": "#9fa0a2",
  "--color-text-faint": "#74767a",
  "--color-accent": "#7fb0e8",
  "--color-accent-subtle": "#24303d",
  "--color-danger": "#e08b80",
  "--color-kind-folder": "#e0b45f",
  "--color-kind-markdown": "#7fb0e8",
  "--color-kind-sketch": "#b193ea",
} as CSSProperties;

const TAB_LIMIT = 5;
const MESSAGE_LIFETIME_MS = 4000;

// A stand-in for the host store: the same values the app keeps, changed by the same rules
// (TAB-1, TAB-2, TAB-3, TAB-6).
const tabs = signal<readonly TTab[]>(INITIAL_TABS);
const activeId = signal<string | null>(PLAN.id);
const message = signal<string | null>(null);
const theme = signal<"light" | "dark">("light");
const log = signal<readonly string[]>([]);

let messageTimer: ReturnType<typeof setTimeout> | null = null;

const report = (line: string) => {
  log.value = [line, ...log.peek()].slice(0, 8);
};

const showMessage = (text: string) => {
  message.value = text;

  if (messageTimer !== null) {
    clearTimeout(messageTimer);
  }

  messageTimer = setTimeout(() => {
    message.value = null;
    messageTimer = null;
  }, MESSAGE_LIFETIME_MS);
};

const openFile = (fileId: string) => {
  const open = tabs.peek();
  const existing = open.find((tab) => tab.id === fileId);

  if (existing !== undefined) {
    activeId.value = fileId;
    report(`activate ${existing.name}`);

    return;
  }

  if (open.length >= TAB_LIMIT) {
    showMessage(`At most ${TAB_LIMIT} files can be open at once. Close a tab first.`);
    report("open refused: tab limit");

    return;
  }

  const file = VAULT.find((candidate) => candidate.id === fileId);
  if (file === undefined) {
    return;
  }

  tabs.value = [...open, { ...file, saveState: "saved" }];
  activeId.value = fileId;
  report(`open ${file.name}`);
};

const setSaveState = (tabId: string, saveState: TTabSaveState) => {
  tabs.value = tabs.peek().map((tab) => {
    return tab.id === tabId ? { ...tab, saveState } : tab;
  });
};

const registry: TTabsBarRegistrySlice = {
  activateTabAction: (tabId) => {
    if (activeId.peek() === tabId) {
      return;
    }

    activeId.value = tabId;
    report(`activate ${tabId}`);
  },
  closeTabAction: (tabId) => {
    const open = tabs.peek();
    const index = open.findIndex((tab) => tab.id === tabId);
    if (index === -1) {
      return;
    }

    const remaining = open.filter((tab) => tab.id !== tabId);

    tabs.value = remaining;
    report(`close ${tabId}`);

    if (activeId.peek() !== tabId) {
      return;
    }

    if (remaining.length === 0) {
      activeId.value = null;

      return;
    }

    // The tab to the right takes over, or the one to the left when the closed tab was last.
    const nextTab = remaining[Math.min(index, remaining.length - 1)];

    activeId.value = nextTab?.id ?? null;
  },
};

const reset = () => {
  tabs.value = INITIAL_TABS;
  activeId.value = PLAN.id;
  message.value = null;
  log.value = [];
};

const Demo = () => {
  useSignals();

  const activeTab = tabs.value.find((tab) => tab.id === activeId.value) ?? null;

  const frameStyle: CSSProperties = {
    ...(theme.value === "dark" ? DARK_TOKENS : {}),
    display: "flex",
    flexDirection: "column",
    background: "var(--color-canvas, #f6f6f4)",
    color: "var(--color-text, #1d1c1a)",
    border: "1px solid var(--color-border, #d9d7d1)",
    borderRadius: 8,
    overflow: "hidden",
  };

  const controlStyle: CSSProperties = { display: "flex", gap: 6, alignItems: "center" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <label style={controlStyle}>
          {"Theme"}
          <select
            onChange={(event) => {
              theme.value = event.target.value as typeof theme.value;
            }}
            value={theme.value}
          >
            <option value="light">{"light"}</option>
            <option value="dark">{"dark"}</option>
          </select>
        </label>

        <label style={controlStyle}>
          {"Active tab state"}
          <select
            disabled={activeTab === null}
            onChange={(event) => {
              if (activeTab !== null) {
                setSaveState(activeTab.id, event.target.value as TTabSaveState);
              }
            }}
            value={activeTab?.saveState ?? "saved"}
          >
            {SAVE_STATES.map((candidate) => (
              <option key={candidate} value={candidate}>
                {candidate}
              </option>
            ))}
          </select>
        </label>

        <button onClick={reset} type="button">
          {"Reset"}
        </button>

        <span>{"Click activates · middle click or × closes · arrows move · Delete closes"}</span>
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ opacity: 0.7 }}>{"Open from the vault:"}</span>
        {VAULT.map((file) => (
          <button key={file.id} onClick={() => openFile(file.id)} type="button">
            {file.name}
          </button>
        ))}
      </div>

      <div style={frameStyle}>
        <TabsBar
          activeId={activeId.value}
          message={message.value}
          registry={registry}
          tabs={tabs.value}
        />

        <div style={{ padding: 16, minHeight: 120, background: "var(--color-surface, #ffffff)" }}>
          {activeTab === null ? (
            <span style={{ opacity: 0.6 }}>{"No tab open — the viewer pane shows its hint here."}</span>
          ) : (
            <span>{`Viewer for ${activeTab.name}`}</span>
          )}
        </div>
      </div>

      <div style={{ ...frameStyle, width: 360 }}>
        <TabsBar
          activeId={LONG_NAME.id}
          registry={registry}
          tabs={[
            { ...JOURNAL_24, saveState: "saved" },
            { ...LONG_NAME, saveState: "saving" },
            { ...SCRATCH, saveState: "failed" },
            { ...JOURNAL_26, saveState: "conflict" },
            { ...READING_LIST, saveState: "deleted" },
          ]}
        />
      </div>

      <pre style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>
        {[
          `open: ${tabs.value.map((tab) => tab.id).join(", ") || "—"}`,
          `active: ${activeId.value ?? "—"}`,
          "",
          ...log.value,
        ].join("\n")}
      </pre>
    </div>
  );
};

const demo: TDemo = {
  title: "Tabs bar",
  component: Demo,
};

export default demo;
