import { z } from "zod";
import { documentSchema } from "./document.js";
import { fsNodeIdSchema, fsNodeListSchema, fsNodeSchema } from "./fs.js";

// A file whose content changed on disk outside the app, with the version it has now. A
// document that already holds this version is up to date: the change was its own save.
const changedFileSchema = z.object({
  nodeId: fsNodeIdSchema,
  version: z.string(),
});

// One batch of changes made to the vault outside the app (SYNC-1). `nodes` is the whole
// new tree when entries were added, removed, renamed or moved; it is null when only file
// contents changed. Entries whose path did not change keep their ids (SYNC-2).
const vaultChangeSchema = z.object({
  nodes: fsNodeListSchema.nullable(),
  changedFiles: z.array(changedFileSchema).readonly(),
});

// Writes a document that was deleted on disk back to its old path (SYNC-5). Missing parent
// folders are created again. The file keeps the document's node id.
const restoreDocumentInputSchema = z.object({
  // The vault-relative path with "/" separators, as the tree shows it.
  path: z.string().min(1),
  document: documentSchema,
});

const restoreDocumentResultSchema = z.object({
  nodes: fsNodeListSchema,
  node: fsNodeSchema,
  version: z.string(),
});

// What a save answers: the version the file has after the write.
const updateDocumentResultSchema = z.object({
  version: z.string(),
});

type TChangedFile = z.infer<typeof changedFileSchema>;
type TVaultChange = z.infer<typeof vaultChangeSchema>;
type TRestoreDocumentInput = z.infer<typeof restoreDocumentInputSchema>;
type TRestoreDocumentResult = z.infer<typeof restoreDocumentResultSchema>;
type TUpdateDocumentResult = z.infer<typeof updateDocumentResultSchema>;

export {
  changedFileSchema,
  restoreDocumentInputSchema,
  restoreDocumentResultSchema,
  updateDocumentResultSchema,
  vaultChangeSchema,
};
export type {
  TChangedFile,
  TRestoreDocumentInput,
  TRestoreDocumentResult,
  TUpdateDocumentResult,
  TVaultChange,
};
