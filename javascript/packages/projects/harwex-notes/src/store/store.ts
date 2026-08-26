import { computed, signal } from "@preact/signals-react";
import { createContext, useContext } from "react";
import type { TDocument, TFsNode } from "../api/types";

type TDocumentEntry =
  | { status: "loading" }
  | { status: "ready"; document: TDocument }
  | { status: "error"; message: string };

type TFsRow = {
  node: TFsNode;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
};

const createFsState = () => ({
  nodes: signal<readonly TFsNode[]>([]),
  expandedIds: signal<readonly string[]>([]),
  isLoading: signal(false),
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

const flattenTree = (
  nodes: readonly TFsNode[],
  expandedIds: readonly string[]
): readonly TFsRow[] => {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const { childIdsByParentId, rootIds } = groupChildIds(nodes);
  const expanded = new Set(expandedIds);
  const rows: TFsRow[] = [];

  const walk = (ids: readonly string[], depth: number) => {
    for (const id of ids) {
      const node = nodeById.get(id);
      if (node === undefined) {
        continue;
      }

      const childIds = childIdsByParentId.get(id) ?? [];
      const isExpanded = expanded.has(id);

      rows.push({
        node,
        depth,
        hasChildren: childIds.length > 0,
        isExpanded,
      });

      if (node.kind === "folder" && isExpanded) {
        walk(childIds, depth + 1);
      }
    }
  };

  walk(rootIds, 0);

  return rows;
};

const createDerivedState = (
  fs: TFsSlice,
  tabs: TTabsSlice,
  documents: TDocumentsSlice
) => {
  const nodeById = computed(() => new Map(fs.nodes.value.map((node) => [node.id, node])));

  const rows = computed(() => flattenTree(fs.nodes.value, fs.expandedIds.value));

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

export type { TDocumentEntry, TFsRow, TStore };
export { StoreProvider, createStore, useStore };
