import {
  createNodeInputSchema,
  moveNodeInputSchema,
  nodeByIdInputSchema,
  renameNodeInputSchema,
} from "@hw/harwex-notes-protocol";
import { publicProcedure, router } from "../trpc.js";
import {
  fetchTree,
  fetchDocument,
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
