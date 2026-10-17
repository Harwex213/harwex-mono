import {
  createNodeInputSchema,
  documentSchema,
  moveNodeInputSchema,
  nodeByIdInputSchema,
  renameNodeInputSchema,
  restoreDocumentInputSchema,
  searchContentInputSchema,
} from "@hw/harwex-notes-protocol";
import { publicProcedure, router } from "../trpc.js";
import {
  fetchTree,
  fetchDocument,
  updateDocument,
  createNode,
  renameNode,
  moveNode,
  deleteNode,
  restoreDocument,
} from "../service/fs-service.js";
import { searchContent } from "../service/search-service.js";
import { createVaultChanges, streamVaultChanges } from "../service/sync-service.js";

const fsRouter = router({
  tree: publicProcedure.query(({ ctx }) => {
    return fetchTree(ctx);
  }),
  document: publicProcedure.input(nodeByIdInputSchema).query(({ ctx, input }) => {
    return fetchDocument(ctx, input.nodeId);
  }),
  // Answers the version the file has after the save.
  updateDocument: publicProcedure.input(documentSchema).mutation(({ ctx, input }) => {
    return updateDocument(ctx, input);
  }),
  restoreDocument: publicProcedure.input(restoreDocumentInputSchema).mutation(({ ctx, input }) => {
    return restoreDocument(ctx, input);
  }),
  createNode: publicProcedure.input(createNodeInputSchema).mutation(({ ctx, input }) => {
    return createNode(ctx, input);
  }),
  renameNode: publicProcedure.input(renameNodeInputSchema).mutation(({ ctx, input }) => {
    return renameNode(ctx, input.nodeId, input.name);
  }),
  moveNode: publicProcedure.input(moveNodeInputSchema).mutation(({ ctx, input }) => {
    return moveNode(ctx, input.nodeId, input.parentId);
  }),
  deleteNode: publicProcedure.input(nodeByIdInputSchema).mutation(({ ctx, input }) => {
    return deleteNode(ctx, input.nodeId);
  }),
  // Content search over a slice of the vault (SRCH-5 to SRCH-7). Names are matched on
  // the client, which already holds the tree.
  search: publicProcedure.input(searchContentInputSchema).query(({ ctx, input }) => {
    return searchContent(ctx, input);
  }),
  // Changes made to the vault outside the app, as they happen (SYNC-1). A client that
  // (re)connects reads the tree and its open files itself (SYNC-8); the stream carries
  // only what changes after that.
  changes: publicProcedure.subscription(async function* ({ ctx, signal }) {
    // Without a watcher the stream stays open and quiet. Ending it would look to the
    // client like a lost connection.
    yield* streamVaultChanges(ctx.vaultChanges ?? createVaultChanges(), signal);
  }),
});

export { fsRouter };
