import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@hw/harwex-notes-protocol";
import type { TApi, TCreateNodeInput, TCreateNodeResult, TDocument, TFsNode } from "./types";

// The backend validates every input and answers a bad one with a user-readable message.
// `TRPCClientError` carries that message as `Error#message`, so domain can show it as is.
const createTrpcApi = (url: string): TApi => {
  const client = createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url })],
  });

  const fetchTree = async (): Promise<readonly TFsNode[]> => {
    return client.fs.tree.query();
  };

  const fetchDocument = async (nodeId: string): Promise<TDocument> => {
    return client.fs.document.query({ nodeId });
  };

  const createNode = async (input: TCreateNodeInput): Promise<TCreateNodeResult> => {
    return client.fs.createNode.mutate(input);
  };

  const renameNode = async (nodeId: string, name: string): Promise<readonly TFsNode[]> => {
    return client.fs.renameNode.mutate({ nodeId, name });
  };

  const moveNode = async (
    nodeId: string,
    parentId: string | null
  ): Promise<readonly TFsNode[]> => {
    return client.fs.moveNode.mutate({ nodeId, parentId });
  };

  const deleteNode = async (nodeId: string): Promise<readonly TFsNode[]> => {
    return client.fs.deleteNode.mutate({ nodeId });
  };

  return {
    fetchTree,
    fetchDocument,
    createNode,
    renameNode,
    moveNode,
    deleteNode,
  };
};

export { createTrpcApi };
