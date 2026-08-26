import { z } from "zod";

const fsNodeKindSchema = z.enum(["folder", "markdown", "excalidraw"]);

const fsNodeIdSchema = z.string().min(1);

// The root has no parent.
const fsParentIdSchema = fsNodeIdSchema.nullable();

const fsNodeSchema = z.object({
  id: fsNodeIdSchema,
  parentId: fsParentIdSchema,
  name: z.string().min(1),
  kind: fsNodeKindSchema,
});

const fsNodeListSchema = z.array(fsNodeSchema).readonly();

const nodeByIdInputSchema = z.object({
  nodeId: fsNodeIdSchema,
});

const createNodeInputSchema = z.object({
  parentId: fsParentIdSchema,
  name: z.string(),
  kind: fsNodeKindSchema,
});

const createNodeResultSchema = z.object({
  nodes: fsNodeListSchema,
  node: fsNodeSchema,
});

const renameNodeInputSchema = z.object({
  nodeId: fsNodeIdSchema,
  name: z.string(),
});

const moveNodeInputSchema = z.object({
  nodeId: fsNodeIdSchema,
  parentId: fsParentIdSchema,
});

type TFsNodeKind = z.infer<typeof fsNodeKindSchema>;

// Everything that is not a folder is a file, and the extension of a file decides
// which kind of file it is.
type TFsFileKind = Exclude<TFsNodeKind, "folder">;

type TFsNode = z.infer<typeof fsNodeSchema>;
type TNodeByIdInput = z.infer<typeof nodeByIdInputSchema>;
type TCreateNodeInput = z.infer<typeof createNodeInputSchema>;
type TCreateNodeResult = z.infer<typeof createNodeResultSchema>;
type TRenameNodeInput = z.infer<typeof renameNodeInputSchema>;
type TMoveNodeInput = z.infer<typeof moveNodeInputSchema>;

export {
  fsNodeKindSchema,
  fsNodeIdSchema,
  fsParentIdSchema,
  fsNodeSchema,
  fsNodeListSchema,
  nodeByIdInputSchema,
  createNodeInputSchema,
  createNodeResultSchema,
  renameNodeInputSchema,
  moveNodeInputSchema,
};
export type {
  TFsNodeKind,
  TFsFileKind,
  TFsNode,
  TNodeByIdInput,
  TCreateNodeInput,
  TCreateNodeResult,
  TRenameNodeInput,
  TMoveNodeInput,
};
