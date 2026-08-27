import { signal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { FsViewer } from "./fs-viewer";
import { readFileKind } from "./fs-file-kinds";
import type { CSSProperties } from "react";
import type { TFsNode, TFsNodeKind } from "@hw/harwex-notes-protocol";
import type { TFsDraft, TFsViewerRegistrySlice } from "./fs-viewer.types";
import type { TDemo } from "../../../dev/demo";

// The vault from the design: three root folders, two of them holding notes, and one
// sketch loose in the root. Folders under "Projects" start collapsed.
const VAULT: readonly TFsNode[] = [
  { id: "inbox", parentId: null, name: "Inbox", kind: "folder" },
  { id: "inbox/reading-list", parentId: "inbox", name: "reading-list.md", kind: "markdown" },
  { id: "journal", parentId: null, name: "Journal", kind: "folder" },
  { id: "journal/08-24", parentId: "journal", name: "2026-08-24.md", kind: "markdown" },
  { id: "journal/08-26", parentId: "journal", name: "2026-08-26.md", kind: "markdown" },
  { id: "projects", parentId: null, name: "Projects", kind: "folder" },
  { id: "projects/harwex-notes", parentId: "projects", name: "harwex-notes", kind: "folder" },
  {
    id: "projects/harwex-notes/plan",
    parentId: "projects/harwex-notes",
    name: "plan.md",
    kind: "markdown",
  },
  {
    id: "projects/harwex-notes/arch",
    parentId: "projects/harwex-notes",
    name: "architecture.excalidraw",
    kind: "excalidraw",
  },
  { id: "projects/ostrov", parentId: "projects", name: "ostrov", kind: "folder" },
  { id: "projects/ostrov/todo", parentId: "projects/ostrov", name: "todo.md", kind: "markdown" },
  { id: "scratch", parentId: null, name: "scratch.excalidraw", kind: "excalidraw" },
];

// A vault built to outgrow the panel: names far longer than any sidebar, and a chain deep
// enough that the indent alone pushes a short name past the right edge. The tree scrolls
// sideways, every row keeps the width of the widest one, and no name is cut off.
const WIDE_VAULT: readonly TFsNode[] = [
  {
    id: "long-names",
    parentId: null,
    name: "a-folder-name-nobody-would-shorten-for-the-sake-of-the-sidebar",
    kind: "folder",
  },
  {
    id: "long-names/note",
    parentId: "long-names",
    name: "a-note-name-that-runs-well-past-the-right-edge-of-the-panel.md",
    kind: "markdown",
  },
  { id: "long-names/short", parentId: "long-names", name: "ok.md", kind: "markdown" },
  { id: "deep", parentId: null, name: "research", kind: "folder" },
  { id: "deep/2026", parentId: "deep", name: "2026", kind: "folder" },
  { id: "deep/2026/q3", parentId: "deep/2026", name: "q3", kind: "folder" },
  { id: "deep/2026/q3/notes", parentId: "deep/2026/q3", name: "notes", kind: "folder" },
  {
    id: "deep/2026/q3/notes/drafts",
    parentId: "deep/2026/q3/notes",
    name: "drafts",
    kind: "folder",
  },
  {
    id: "deep/2026/q3/notes/drafts/sketch",
    parentId: "deep/2026/q3/notes/drafts",
    name: "storage-layout-and-write-queue.excalidraw",
    kind: "excalidraw",
  },
  { id: "top.md", parentId: null, name: "top.md", kind: "markdown" },
];

type TVaultKey = "design" | "wide";

type TVaultFixture = {
  label: string;
  nodes: readonly TFsNode[];
  expandedIds: readonly string[];
};

const VAULTS: Readonly<Record<TVaultKey, TVaultFixture>> = {
  design: {
    label: "design vault",
    nodes: VAULT,
    expandedIds: ["inbox", "journal", "projects"],
  },
  wide: {
    label: "wide vault (horizontal scroll)",
    nodes: WIDE_VAULT,
    // Open on load, so the overflow shows without a click.
    expandedIds: [
      "long-names",
      "deep",
      "deep/2026",
      "deep/2026/q3",
      "deep/2026/q3/notes",
      "deep/2026/q3/notes/drafts",
    ],
  },
};

const VAULT_KEYS: readonly TVaultKey[] = ["design", "wide"];

// 160px overflows even the design vault, 200px and 260px hold it, and at 420px only the
// wide vault still scrolls.
const PANEL_WIDTHS_PX: readonly number[] = [160, 200, 260, 420];

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

const SIDEBAR_WIDTH_PX = 260;
const MUTATION_LATENCY_MS = 300;

// A stand-in for the host store: the same signals the app keeps, changed by the same
// rules, with a fake latency so the busy state is visible.
const vaultKey = signal<TVaultKey>("design");
const panelWidth = signal(SIDEBAR_WIDTH_PX);
const nodes = signal<readonly TFsNode[]>(VAULTS.design.nodes);
const expandedIds = signal<readonly string[]>(VAULTS.design.expandedIds);
const selectedId = signal<string | null>(null);
const activeId = signal<string | null>(null);
const draft = signal<TFsDraft | null>(null);
const isBusy = signal(false);
const isLoading = signal(false);
const error = signal<string | null>(null);
const theme = signal<"light" | "dark">("light");
const log = signal<readonly string[]>([]);

const report = (line: string) => {
  log.value = [line, ...log.peek()].slice(0, 8);
};

const wait = () => {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, MUTATION_LATENCY_MS);
  });
};

const collectSubtreeIds = (nodeId: string): ReadonlySet<string> => {
  const ids = new Set([nodeId]);
  let hasGrown = true;

  while (hasGrown) {
    hasGrown = false;

    for (const node of nodes.peek()) {
      if (node.parentId !== null && !ids.has(node.id) && ids.has(node.parentId)) {
        ids.add(node.id);
        hasGrown = true;
      }
    }
  }

  return ids;
};

const expandFolder = (nodeId: string | null) => {
  if (nodeId === null || expandedIds.peek().includes(nodeId)) {
    return;
  }

  expandedIds.value = [...expandedIds.peek(), nodeId];
};

const hasSibling = (parentId: string | null, name: string, exceptId: string | null) => {
  return nodes.peek().some((node) => {
    return node.parentId === parentId && node.name === name && node.id !== exceptId;
  });
};

const runMutation = async (label: string, mutate: () => void) => {
  if (isBusy.peek()) {
    return;
  }

  isBusy.value = true;
  error.value = null;

  try {
    await wait();
    mutate();
    report(label);
  } catch (mutationError) {
    error.value = mutationError instanceof Error ? mutationError.message : "Unknown error";
  } finally {
    isBusy.value = false;
  }
};

const readCreateKind = (draftKind: TFsNodeKind, name: string): TFsNodeKind => {
  if (draftKind !== "file") {
    return draftKind;
  }

  const kind = readFileKind(name);
  if (kind === null) {
    throw new Error("A file name has to end with .md or .excalidraw");
  }

  return kind;
};

const registry: TFsViewerRegistrySlice = {
  toggleFolderAction: (nodeId) => {
    if (!expandedIds.peek().includes(nodeId)) {
      expandedIds.value = [...expandedIds.peek(), nodeId];

      return;
    }

    // Collapsing a folder collapses everything below it.
    const collapsed = collectSubtreeIds(nodeId);

    expandedIds.value = expandedIds.peek().filter((id) => !collapsed.has(id));
  },
  openNodeAction: (nodeId) => {
    const node = nodes.peek().find((candidate) => candidate.id === nodeId);
    if (node === undefined) {
      return;
    }

    if (node.kind === "folder") {
      registry.toggleFolderAction(nodeId);

      return;
    }

    activeId.value = nodeId;
    report(`open ${node.name}`);
  },
  selectNodeAction: (nodeId) => {
    selectedId.value = nodeId;
    draft.value = null;
  },
  startCreateAction: (parentId, kind) => {
    error.value = null;
    expandFolder(parentId);
    draft.value = { mode: "create", parentId, kind };
  },
  startRenameAction: (nodeId) => {
    error.value = null;
    selectedId.value = nodeId;
    draft.value = { mode: "rename", nodeId };
  },
  cancelDraftAction: () => {
    draft.value = null;
    error.value = null;
  },
  submitDraftAction: (name) => {
    const current = draft.peek();
    if (current === null) {
      return;
    }

    const trimmed = name.trim();
    if (trimmed.length === 0) {
      draft.value = null;

      return;
    }

    if (current.mode === "create") {
      void runMutation(`create ${trimmed}`, () => {
        const kind = readCreateKind(current.kind, trimmed);

        if (hasSibling(current.parentId, trimmed, null)) {
          throw new Error(`"${trimmed}" already exists here`);
        }

        const id = `${current.parentId ?? "root"}/${trimmed}`;

        nodes.value = [...nodes.peek(), { id, parentId: current.parentId, name: trimmed, kind }];
        draft.value = null;
        selectedId.value = id;

        if (kind === "folder") {
          expandFolder(id);
        }
      });

      return;
    }

    void runMutation(`rename to ${trimmed}`, () => {
      const node = nodes.peek().find((candidate) => candidate.id === current.nodeId);
      if (node === undefined) {
        return;
      }

      if (hasSibling(node.parentId, trimmed, node.id)) {
        throw new Error(`"${trimmed}" already exists here`);
      }

      nodes.value = nodes.peek().map((candidate) => {
        return candidate.id === node.id ? { ...candidate, name: trimmed } : candidate;
      });
      draft.value = null;
    });
  },
  moveNodeAction: (nodeId, parentId) => {
    void runMutation(`move ${nodeId} → ${parentId ?? "root"}`, () => {
      const node = nodes.peek().find((candidate) => candidate.id === nodeId);
      if (node === undefined) {
        return;
      }

      if (hasSibling(parentId, node.name, node.id)) {
        throw new Error(`"${node.name}" already exists in the target folder`);
      }

      nodes.value = nodes.peek().map((candidate) => {
        return candidate.id === nodeId ? { ...candidate, parentId } : candidate;
      });
      expandFolder(parentId);
    });
  },
  deleteNodeAction: (nodeId) => {
    void runMutation(`delete ${nodeId}`, () => {
      const removed = collectSubtreeIds(nodeId);

      nodes.value = nodes.peek().filter((node) => !removed.has(node.id));
      expandedIds.value = expandedIds.peek().filter((id) => !removed.has(id));

      if (selectedId.peek() !== null && removed.has(selectedId.peek() as string)) {
        selectedId.value = null;
      }

      if (activeId.peek() !== null && removed.has(activeId.peek() as string)) {
        activeId.value = null;
      }
    });
  },
};

const reset = () => {
  const vault = VAULTS[vaultKey.peek()];

  nodes.value = vault.nodes;
  expandedIds.value = vault.expandedIds;
  selectedId.value = null;
  activeId.value = null;
  draft.value = null;
  error.value = null;
  log.value = [];
};

const Demo = () => {
  useSignals();

  const frameStyle: CSSProperties = {
    ...(theme.value === "dark" ? DARK_TOKENS : {}),
    display: "flex",
    gap: 16,
    alignItems: "flex-start",
    padding: 16,
    background: "var(--color-canvas, #f6f6f4)",
    color: "var(--color-text, #1d1c1a)",
    borderRadius: 8,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
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

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {"Vault"}
          <select
            onChange={(event) => {
              vaultKey.value = event.target.value as TVaultKey;
              reset();
            }}
            value={vaultKey.value}
          >
            {VAULT_KEYS.map((key) => (
              <option key={key} value={key}>
                {VAULTS[key].label}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {"Panel width"}
          <select
            onChange={(event) => {
              panelWidth.value = Number(event.target.value);
            }}
            value={panelWidth.value}
          >
            {PANEL_WIDTHS_PX.map((width) => (
              <option key={width} value={width}>
                {`${width}px`}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            checked={isLoading.value}
            onChange={(event) => {
              isLoading.value = event.target.checked;
            }}
            type="checkbox"
          />
          {"Loading"}
        </label>

        <button onClick={reset} type="button">
          {"Reset vault"}
        </button>

        <span>
          {"Click selects · double click opens · right click for the menu · drag to move"}
        </span>
      </div>

      <div style={frameStyle}>
        <div style={{ width: panelWidth.value, height: "70vh", flex: "0 0 auto" }}>
          <FsViewer
            activeId={activeId.value}
            draft={draft.value}
            error={error.value}
            expandedIds={expandedIds.value}
            isBusy={isBusy.value}
            isLoading={isLoading.value}
            nodes={nodes.value}
            registry={registry}
            selectedId={selectedId.value}
          />
        </div>

        <pre style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>
          {[
            `selected: ${selectedId.value ?? "—"}`,
            `active: ${activeId.value ?? "—"}`,
            `draft: ${draft.value === null ? "—" : JSON.stringify(draft.value)}`,
            `busy: ${isBusy.value}`,
            "",
            ...log.value,
          ].join("\n")}
        </pre>
      </div>
    </div>
  );
};

const demo: TDemo = {
  title: "FS viewer",
  component: Demo,
};

export default demo;
