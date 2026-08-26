import { signal } from "@preact/signals-react";
import type { TDocument } from "../api/types";

type TDocumentEntry =
  | { status: "loading" }
  | { status: "ready"; document: TDocument }
  | { status: "error"; message: string };

const createDocumentsState = () => ({
  entryById: signal<Readonly<Record<string, TDocumentEntry>>>({}),
});

type TDocumentsSlice = ReturnType<typeof createDocumentsState>;

export type { TDocumentEntry, TDocumentsSlice };
export { createDocumentsState };
