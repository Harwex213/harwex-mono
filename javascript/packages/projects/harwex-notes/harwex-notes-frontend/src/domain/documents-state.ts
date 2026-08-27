import type { TDocumentEntry, TStore } from "../store/store";
import type { TApiClient } from "../api/api";

const setEntry = (store: TStore, nodeId: string, entry: TDocumentEntry) => {
  store.documents.entryById.value = {
    ...store.documents.entryById.peek(),
    [nodeId]: entry,
  };
};

const loadDocument = async (store: TStore, api: TApiClient, nodeId: string) => {
  setEntry(store, nodeId, { status: "loading" });

  try {
    const document = await api.fs.document.query({ nodeId });

    setEntry(store, nodeId, { status: "ready", document });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    setEntry(store, nodeId, { status: "error", message });
  }
};

const ensureDocument = (store: TStore, api: TApiClient, nodeId: string) => {
  const entry = store.documents.entryById.peek()[nodeId];
  if (entry !== undefined && entry.status !== "error") {
    return;
  }

  void loadDocument(store, api, nodeId);
};

const reloadDocumentAction = (store: TStore, api: TApiClient, nodeId: string) => {
  void loadDocument(store, api, nodeId);
};

export { ensureDocument, reloadDocumentAction };
