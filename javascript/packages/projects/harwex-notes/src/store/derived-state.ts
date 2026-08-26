import { computed } from "@preact/signals-react";
import { flattenTree } from "./fs-rows";
import type { TFsNode } from "../api/types";
import type { TDocumentsSlice } from "./documents-slice";
import type { TFsSlice } from "./fs-slice";
import type { TTabsSlice } from "./tabs-slice";

const createDerivedState = (
  fs: TFsSlice,
  tabs: TTabsSlice,
  documents: TDocumentsSlice
) => {
  const nodeById = computed(() => new Map(fs.nodes.value.map((node) => [node.id, node])));

  const rows = computed(() => {
    return flattenTree(nodeById.value, fs.expandedIds.value, fs.draft.value);
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

type TDerivedState = ReturnType<typeof createDerivedState>;

export type { TDerivedState };
export { createDerivedState };
