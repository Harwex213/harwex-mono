import { computed } from "@preact/signals-react";
import type { TTab, TTabSaveState } from "@hw/harwex-notes-components";
import type { TDocumentEntry, TDocumentsSlice } from "./documents-slice";
import type { TFsSlice } from "./fs-slice";
import type { TTabsSlice } from "./tabs-slice";

const readSaveState = (entry: TDocumentEntry | undefined): TTabSaveState => {
  if (entry === undefined || entry.status === "loading") {
    return "loading";
  }

  if (entry.status === "error") {
    return "failed";
  }

  return entry.save.state;
};

type TAppSaveState = "saved" | "saving" | "failed";

const readAppSaveState = (entryById: Readonly<Record<string, TDocumentEntry>>): TAppSaveState => {
  let appState: TAppSaveState = "saved";

  for (const entry of Object.values(entryById)) {
    if (entry.status !== "ready") {
      continue;
    }

    if (entry.save.state === "failed") {
      return "failed";
    }

    if (entry.save.state === "saving" || entry.save.state === "unsaved") {
      appState = "saving";
    }
  }

  return appState;
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

  const appSaveState = computed(() => readAppSaveState(documents.entryById.value));

  return {
    nodeById,
    openTabs,
    activeNode,
    activeEntry,
    appSaveState,
  };
};

type TDerivedState = ReturnType<typeof createDerivedState>;

export type { TAppSaveState, TDerivedState };
export { createDerivedState };
