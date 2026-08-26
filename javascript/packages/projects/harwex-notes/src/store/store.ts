import { computed, signal } from "@preact/signals-react";
import { createContext, useContext } from "react";
import type { TDocument, TFsNode, TFsNodeKind } from "../api/types";

type TDocumentEntry =
  | { status: "loading" }
  | { status: "ready"; document: TDocument }
  | { status: "error"; message: string };

type TFsDraft =
  | { mode: "create"; parentId: string | null; kind: TFsNodeKind }
  | { mode: "rename"; nodeId: string };

type TFsNodeRow = {
  type: "node";
  node: TFsNode;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
};

type TFsDraftRow = {
  type: "draft";
  depth: number;
  kind: TFsNodeKind;
};

type TFsRow = TFsNodeRow | TFsDraftRow;

const createFsState = () => ({
  nodes: signal<readonly TFsNode[]>([]),
  expandedIds: signal<readonly string[]>([]),
  selectedId: signal<string | null>(null),
  draft: signal<TFsDraft | null>(null),
  isLoading: signal(false),
  isBusy: signal(false),
  error: signal<string | null>(null),
});

const createTabsState = () => ({
  openIds: signal<readonly string[]>([]),
  activeId: signal<string | null>(null),
});

const createDocumentsState = () => ({
  entryById: signal<Readonly<Record<string, TDocumentEntry>>>({}),
});

type TFsSlice = ReturnType<typeof createFsState>;
type TTabsSlice = ReturnType<typeof createTabsState>;
type TDocumentsSlice = ReturnType<typeof createDocumentsState>;

const groupChildIds = (nodes: readonly TFsNode[]) => {
  const childIdsByParentId = new Map<string, string[]>();
  const rootIds: string[] = [];

  for (const node of nodes) {
    if (node.parentId === null) {
      rootIds.push(node.id);

      continue;
    }

    const siblings = childIdsByParentId.get(node.parentId);
    if (siblings === undefined) {
      childIdsByParentId.set(node.parentId, [node.id]);

      continue;
    }

    siblings.push(node.id);
  }

  return { childIdsByParentId, rootIds };
};

// Folders come before files, and each group is sorted by name, so a fresh node
// lands where the reader expects it instead of at the end of the list.
const sortIds = (ids: readonly string[], nodeById: ReadonlyMap<string, TFsNode>) => {
  return [...ids].sort((leftId, rightId) => {
    const left = nodeById.get(leftId);
    const right = nodeById.get(rightId);
    if (left === undefined || right === undefined) {
      return 0;
    }

    if (left.kind !== right.kind) {
      if (left.kind === "folder") {
        return -1;
      }

      if (right.kind === "folder") {
        return 1;
      }
    }

    return left.name.localeCompare(right.name);
  });
};

const flattenTree = (
  nodes: readonly TFsNode[],
  expandedIds: readonly string[],
  draft: TFsDraft | null
): readonly TFsRow[] => {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const { childIdsByParentId, rootIds } = groupChildIds(nodes);
  const expanded = new Set(expandedIds);
  const rows: TFsRow[] = [];

  const pushDraftRow = (parentId: string | null, depth: number) => {
    if (draft === null || draft.mode !== "create" || draft.parentId !== parentId) {
      return;
    }

    rows.push({ type: "draft", depth, kind: draft.kind });
  };

  const walk = (ids: readonly string[], depth: number, parentId: string | null) => {
    for (const id of sortIds(ids, nodeById)) {
      const node = nodeById.get(id);
      if (node === undefined) {
        continue;
      }

      const childIds = childIdsByParentId.get(id) ?? [];
      const isExpanded = expanded.has(id);

      rows.push({
        type: "node",
        node,
        depth,
        hasChildren: childIds.length > 0,
        isExpanded,
      });

      if (node.kind === "folder" && isExpanded) {
        walk(childIds, depth + 1, id);
      }
    }

    pushDraftRow(parentId, depth);
  };

  walk(rootIds, 0, null);

  return rows;
};

const createDerivedState = (
  fs: TFsSlice,
  tabs: TTabsSlice,
  documents: TDocumentsSlice
) => {
  const nodeById = computed(() => new Map(fs.nodes.value.map((node) => [node.id, node])));

  const rows = computed(() => {
    return flattenTree(fs.nodes.value, fs.expandedIds.value, fs.draft.value);
  });

  const openNodes = computed(() => {
    const byId = nodeById.value;

    return tabs.openIds.value.reduce((nodes: TFsNode[], id) => {
      const node = byId.get(id);
      if (node !== undefined) {
        nodes.push(node);
      }

      return nodes;
    }, []);
  });

  const activeNode = computed(() => {
    const activeId = tabs.activeId.value;
    if (activeId === null) {
      return null;
    }

    return nodeById.value.get(activeId) ?? null;
  });

  const activeEntry = computed(() => {
    const activeId = tabs.activeId.value;
    if (activeId === null) {
      return null;
    }

    return documents.entryById.value[activeId] ?? null;
  });

  return {
    nodeById,
    rows,
    openNodes,
    activeNode,
    activeEntry,
  };
};

const createStore = () => {
  const fs = createFsState();
  const tabs = createTabsState();
  const documents = createDocumentsState();

  return {
    fs,
    tabs,
    documents,
    derived: createDerivedState(fs, tabs, documents),
  };
};

type TStore = ReturnType<typeof createStore>;

const StoreContext = createContext<TStore>(null!);

const StoreProvider = StoreContext.Provider;

const useStore = () => useContext(StoreContext);

export type { TDocumentEntry, TFsDraft, TFsDraftRow, TFsNodeRow, TFsRow, TStore };
export { StoreProvider, createStore, useStore };
