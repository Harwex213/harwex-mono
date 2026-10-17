import type { TStore } from "../store/store";

// Store helpers shared by the save pipeline (documents-state.ts) and the sync with the
// disk (sync-state.ts). They hold no api calls, so both files can use them without
// importing each other.

// A change on disk reported while the document's own save was in flight, by node id. The
// save decides afterwards whether that change was its own write (SYNC-9) or someone
// else's (CONF-1). Not rendered, so it lives beside the store.
const outsideVersionsByStore = new WeakMap<TStore, Map<string, string>>();

const readOutsideVersions = (store: TStore): Map<string, string> => {
  let versions = outsideVersionsByStore.get(store);
  if (versions === undefined) {
    versions = new Map();
    outsideVersionsByStore.set(store, versions);
  }

  return versions;
};

const noteOutsideChangeDuringSave = (store: TStore, nodeId: string, version: string) => {
  readOutsideVersions(store).set(nodeId, version);
};

const takeOutsideChangeDuringSave = (store: TStore, nodeId: string): string | undefined => {
  const versions = readOutsideVersions(store);
  const version = versions.get(nodeId);
  versions.delete(nodeId);

  return version;
};

// The document keeps its content and stops saving until the user chooses; its conflict
// joins the end of the queue (CONF-4, CONF-5). The caller cancels pending save timers.
const raiseConflict = (store: TStore, nodeId: string) => {
  const entry = store.documents.entryById.peek()[nodeId];
  if (entry === undefined || entry.status !== "ready") {
    return;
  }

  store.documents.entryById.value = {
    ...store.documents.entryById.peek(),
    [nodeId]: { ...entry, save: { state: "conflict" } },
  };

  const conflictIds = store.documents.conflictIds.peek();
  if (!conflictIds.includes(nodeId)) {
    store.documents.conflictIds.value = [...conflictIds, nodeId];
  }
};

const dropConflicts = (store: TStore, nodeIds: ReadonlySet<string>) => {
  const conflictIds = store.documents.conflictIds.peek();
  const nextConflictIds = conflictIds.filter((id) => !nodeIds.has(id));

  if (nextConflictIds.length !== conflictIds.length) {
    store.documents.conflictIds.value = nextConflictIds;
  }
};

export { dropConflicts, noteOutsideChangeDuringSave, raiseConflict, takeOutsideChangeDuringSave };
