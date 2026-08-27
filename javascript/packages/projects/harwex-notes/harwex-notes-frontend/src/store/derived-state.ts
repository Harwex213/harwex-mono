import { computed } from "@preact/signals-react";
import type { TTab, TTabSaveState } from "@hw/harwex-notes-components";
import type { TDocumentEntry, TDocumentsSlice } from "./documents-slice";
import type { TFsSlice } from "./fs-slice";
import type { TTabsSlice } from "./tabs-slice";

// The app only reads files, so a tab is either still fetching its document, holding it, or
// holding the error the fetch gave. The bar's remaining states (unsaved, saving, conflict,
// deleted) arrive with saving, see DOC-5 in the specification.
const readSaveState = (entry: TDocumentEntry | undefined): TTabSaveState => {
  if (entry === undefined || entry.status === "loading") {
    return "loading";
  }

  if (entry.status === "error") {
    return "failed";
  }

  return "saved";
};

const createDerivedState = (
  fs: TFsSlice,
  tabs: TTabsSlice,
  documents: TDocumentsSlice
) => {
  const nodeById = computed(() => new Map(fs.nodes.value.map((node) => [node.id, node])));

  const openTabs = computed(() => {
    const byId = nodeById.value;
    const entryById = documents.entryById.value;

    return tabs.openIds.value.reduce((openTabs: TTab[], id) => {
      const node = byId.get(id);

      // Only files are ever opened, so a folder among the open ids would be stale state.
      if (node === undefined || node.kind === "folder") {
        return openTabs;
      }

      openTabs.push({
        id: node.id,
        name: node.name,
        kind: node.kind,
        saveState: readSaveState(entryById[id]),
      });

      return openTabs;
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
    openTabs,
    activeNode,
    activeEntry,
  };
};

type TDerivedState = ReturnType<typeof createDerivedState>;

export type { TDerivedState };
export { createDerivedState };
