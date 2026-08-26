// Data shapes are shared with the backend through the protocol package. This file adds the
// frontend boundary on top of them: the `TApi` contract every api implementation fulfils.
import type {
  TCreateNodeInput,
  TCreateNodeResult,
  TDocument,
  TExcalidrawDocument,
  TExcalidrawScene,
  TFsFileKind,
  TFsNode,
  TFsNodeKind,
  TMarkdownDocument,
} from "@hw/harwex-notes-protocol";

type TApi = {
  fetchTree: () => Promise<readonly TFsNode[]>;
  fetchDocument: (nodeId: string) => Promise<TDocument>;
  createNode: (input: TCreateNodeInput) => Promise<TCreateNodeResult>;
  renameNode: (nodeId: string, name: string) => Promise<readonly TFsNode[]>;
  moveNode: (nodeId: string, parentId: string | null) => Promise<readonly TFsNode[]>;
  deleteNode: (nodeId: string) => Promise<readonly TFsNode[]>;
};

export type {
  TApi,
  TCreateNodeInput,
  TCreateNodeResult,
  TDocument,
  TExcalidrawDocument,
  TExcalidrawScene,
  TFsFileKind,
  TFsNode,
  TFsNodeKind,
  TMarkdownDocument,
};
