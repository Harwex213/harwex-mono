import { computed } from "@preact/signals-react";
import type { TConflict } from "@hw/harwex-notes-components";
import type { TDocumentsSlice } from "./documents-slice";
import type { TFsSlice } from "./fs-slice";

const createSyncDerivedState = (fs: TFsSlice, documents: TDocumentsSlice) => {
  // The conflict the modal shows: the oldest one still unresolved (CONF-5).
  const activeConflict = computed((): TConflict | null => {
    const entryById = documents.entryById.value;
    const conflictId = documents.conflictIds.value.find((id) => {
      const entry = entryById[id];

      return entry !== undefined && entry.status === "ready" && entry.save.state === "conflict";
    });

    if (conflictId === undefined) {
      return null;
    }

    const entry = entryById[conflictId];
    const node = fs.nodes.value.find((candidate) => candidate.id === conflictId);
    if (entry === undefined || entry.status !== "ready" || node === undefined) {
      return null;
    }

    return { id: conflictId, name: node.name, kind: entry.document.kind };
  });

  // How many other files wait behind the one the modal shows.
  const waitingConflictCount = computed(() => {
    const entryById = documents.entryById.value;
    const count = documents.conflictIds.value.filter((id) => {
      const entry = entryById[id];

      return entry !== undefined && entry.status === "ready" && entry.save.state === "conflict";
    }).length;

    return Math.max(0, count - 1);
  });

  return { activeConflict, waitingConflictCount };
};

export { createSyncDerivedState };
