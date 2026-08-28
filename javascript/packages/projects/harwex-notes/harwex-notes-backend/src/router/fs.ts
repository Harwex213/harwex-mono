import {
  createNodeInputSchema,
  documentSchema,
  moveNodeInputSchema,
  nodeByIdInputSchema,
  renameNodeInputSchema,
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
} from "../service/fs-service.js";

const fsRouter = router({
  tree: publicProcedure.query(({ ctx }) => {
    return fetchTree(ctx);
  }),
  document: publicProcedure.input(nodeByIdInputSchema).query(({ ctx, input }) => {
    return fetchDocument(ctx, input.nodeId);
  }),
  // tRPC serialises a `void` output to `never` on the client, so the mutation answers
  // with an explicit `null`.
  updateDocument: publicProcedure.input(documentSchema).mutation(async ({ ctx, input }) => {
    await updateDocument(ctx, input);

    return null;
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
});

export { fsRouter };
