import type {
  TCreateNodeInput,
  TCreateNodeResult,
  TDocument,
  TFsNode,
} from "@hw/harwex-notes-protocol";
import type { TContext } from "../trpc.js";

export type TFetchTree = (ctx: TContext) => Promise<readonly TFsNode[]>;

export type TCreateNode = (ctx: TContext, input: TCreateNodeInput) => Promise<TCreateNodeResult>;
export type TRenameNode = (ctx: TContext, nodeId: string, name: string) => Promise<readonly TFsNode[]>;
export type TMoveNode = (ctx: TContext, nodeId: string, parentId: string | null) => Promise<readonly TFsNode[]>;
export type TDeleteNode = (ctx: TContext, nodeId: string) => Promise<readonly TFsNode[]>;

export type TFetchDocument = (ctx: TContext, nodeId: string) => Promise<TDocument>;
export type TUpdateDocument = (ctx: TContext, document: TDocument) => Promise<void>;
