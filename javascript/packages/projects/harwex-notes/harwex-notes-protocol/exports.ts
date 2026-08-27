// API

export type { AppRouter } from "@hw/harwex-notes-backend/router";

// Types

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
} from "./src/types/fs.js";
export type {
  TFsNodeKind,
  TFsFileKind,
  TFsNode,
  TNodeByIdInput,
  TCreateNodeInput,
  TCreateNodeResult,
  TRenameNodeInput,
  TMoveNodeInput,
} from "./src/types/fs.js";
export {
  markdownDocumentSchema,
  excalidrawSceneSchema,
  excalidrawDocumentSchema,
  documentSchema,
} from "./src/types/document.js";
export type {
  TMarkdownDocument,
  TExcalidrawScene,
  TExcalidrawDocument,
  TDocument,
} from "./src/types/document.js";

// Registry

export type {
  TActivateTabAction,
  TAppRegistry,
  TCancelDraftAction,
  TCloseTabAction,
  TDeleteNodeAction,
  TLoadTreeAction,
  TMoveNodeAction,
  TOpenNodeAction,
  TReloadDocumentAction,
  TExcalidrawDocumentChangedAction,
  TResizeSidebarAction,
  TSelectNodeAction,
  TStartCreateAction,
  TStartRenameAction,
  TSubmitDraftAction,
  TToggleFolderAction,
} from "./src/registry.js";
