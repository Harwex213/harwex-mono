import { signal } from "@preact/signals-react";
import type { TDocument } from "@hw/harwex-notes-protocol";

type TDocumentSaveState =
  | { state: "saved" }
  | { state: "unsaved" }
  | { state: "saving" }
  | { state: "failed"; message: string };

type TDocumentEntry =
  | { status: "loading" }
  | { status: "ready"; document: TDocument; save: TDocumentSaveState }
  | { status: "error"; message: string };

const createDocumentsState = () => ({
  entryById: signal<Readonly<Record<string, TDocumentEntry>>>({}),
});

type TDocumentsSlice = ReturnType<typeof createDocumentsState>;

export type { TDocumentEntry, TDocumentSaveState, TDocumentsSlice };
export { createDocumentsState };
