import { DOCUMENTS, FS_NODES } from "./mock-data";
import type { TApi, TDocument, TFsNode } from "./types";

const TREE_LATENCY_MS = 240;
const DOCUMENT_LATENCY_MS = 320;

const delay = (ms: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms);
});

const createMockApi = (): TApi => {
  const fetchTree = async (): Promise<readonly TFsNode[]> => {
    await delay(TREE_LATENCY_MS);

    return FS_NODES;
  };

  const fetchDocument = async (nodeId: string): Promise<TDocument> => {
    await delay(DOCUMENT_LATENCY_MS);

    const document = DOCUMENTS[nodeId];
    if (document === undefined) {
      throw new Error(`No document was found for "${nodeId}"`);
    }

    return document;
  };

  return {
    fetchTree,
    fetchDocument,
  };
};

export { createMockApi };
