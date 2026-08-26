import {
  createNodeInputSchema,
  moveNodeInputSchema,
  nodeByIdInputSchema,
  renameNodeInputSchema,
} from "@hw/harwex-notes-protocol";
import { publicProcedure, router } from "../trpc.js";

const fsRouter = router({
  tree: publicProcedure.query(({ ctx }) => {
    return ctx.fs.fetchTree();
  }),
  document: publicProcedure.input(nodeByIdInputSchema).query(({ ctx, input }) => {
    return ctx.fs.fetchDocument(input.nodeId);
  }),
  createNode: publicProcedure.input(createNodeInputSchema).mutation(({ ctx, input }) => {
    return ctx.fs.createNode(input);
  }),
  renameNode: publicProcedure.input(renameNodeInputSchema).mutation(({ ctx, input }) => {
    return ctx.fs.renameNode(input.nodeId, input.name);
  }),
  moveNode: publicProcedure.input(moveNodeInputSchema).mutation(({ ctx, input }) => {
    return ctx.fs.moveNode(input.nodeId, input.parentId);
  }),
  deleteNode: publicProcedure.input(nodeByIdInputSchema).mutation(({ ctx, input }) => {
    return ctx.fs.deleteNode(input.nodeId);
  }),
});

export { fsRouter };
