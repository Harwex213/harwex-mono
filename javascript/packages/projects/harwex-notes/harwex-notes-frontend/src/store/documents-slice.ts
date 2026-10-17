import { signal } from "@preact/signals-react";
import type { TDocument, TExcalidrawViewport } from "@hw/harwex-notes-protocol";

type TDocumentSaveState =
  | { state: "saved" }
  | { state: "unsaved" }
  | { state: "saving" }
  | { state: "failed"; message: string }
  // The file changed on disk while the document had unsaved changes. Saving is stopped
  // until the user picks a version (CONF-1, CONF-4).
  | { state: "conflict" }
  // The file was deleted on disk while the document had unsaved changes (SYNC-5). The node
  // is gone from the tree, so the tab keeps the old path and name here. `message` is why
  // the last attempt to write the file back failed.
  | { state: "deleted"; path: string; name: string; message: string | null };

type TDocumentEntry =
  | { status: "loading" }
  | { status: "ready"; document: TDocument; save: TDocumentSaveState }
  | { status: "error"; message: string };

const createDocumentsState = () => ({
  entryById: signal<Readonly<Record<string, TDocumentEntry>>>({}),
  // Where the user left each drawing (EX-8). Read once when the drawing loads; a drawing
  // without an entry here opens fitted to its content.
  excalidrawViewportById: signal<Readonly<Record<string, TExcalidrawViewport>>>({}),
  // Documents in conflict, in the order the conflicts arose. One modal shows the first;
  // the others wait (CONF-5).
  conflictIds: signal<readonly string[]>([]),
});

type TDocumentsSlice = ReturnType<typeof createDocumentsState>;

export type { TDocumentEntry, TDocumentSaveState, TDocumentsSlice };
export { createDocumentsState };
