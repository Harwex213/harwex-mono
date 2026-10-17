// The tRPC router type lives behind its own entry, `@hw/harwex-notes-protocol/router`
// (router.ts). It pulls in the backend sources, which only a tRPC client needs.

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
  DEFAULT_EXCALIDRAW_STYLE,
  EXCALIDRAW_DEFAULT_STYLE_SETTING,
  EXCALIDRAW_STYLE_KEYS,
  EXCALIDRAW_VIEWPORT_STATE_KEY,
  VAULT_LINK_PREFIX,
  excalidrawViewportSchema,
  markdownDocumentSchema,
  textDocumentSchema,
  excalidrawStyleSchema,
  excalidrawSceneSchema,
  excalidrawDocumentSchema,
  imageDocumentSchema,
  htmlDocumentSchema,
  documentSchema,
  pickExcalidrawStyle,
} from "./src/types/document.js";
export type {
  TExcalidrawStyle,
  TExcalidrawViewport,
  TMarkdownDocument,
  TTextDocument,
  TExcalidrawScene,
  TExcalidrawDocument,
  TImageDocument,
  THtmlDocument,
  TDocument,
} from "./src/types/document.js";

export {
  statePathSchema,
  stateKeySchema,
  jsonValueSchema,
  treeStateSchema,
  nodeStateInputSchema,
  setNodeStateInputSchema,
  settingInputSchema,
  setSettingInputSchema,
} from "./src/types/state.js";
export type {
  TJsonValue,
  TTreeState,
  TNodeStateInput,
  TSetNodeStateInput,
  TSettingInput,
  TSetSettingInput,
} from "./src/types/state.js";

export {
  MIN_CONTENT_SEARCH_TERM_LENGTH,
  MAX_CONTENT_SEARCH_NODE_IDS,
  searchContentInputSchema,
  contentMatchSchema,
  searchContentResultSchema,
  countTermOccurrences,
  readExcalidrawSearchText,
  readHtmlSearchText,
} from "./src/types/search.js";
export type {
  TSearchContentInput,
  TContentMatch,
  TSearchContentResult,
} from "./src/types/search.js";

export {
  changedFileSchema,
  restoreDocumentInputSchema,
  restoreDocumentResultSchema,
  updateDocumentResultSchema,
  vaultChangeSchema,
} from "./src/types/sync.js";
export type {
  TChangedFile,
  TRestoreDocumentInput,
  TRestoreDocumentResult,
  TUpdateDocumentResult,
  TVaultChange,
} from "./src/types/sync.js";

// Registry

export type {
  TActivateTabAction,
  TAppRegistry,
  TCancelDraftAction,
  TChangeSearchAction,
  TClearSearchAction,
  TCloseTabAction,
  TDeleteNodeAction,
  TDiscardConflictAction,
  TDismissLinkErrorAction,
  TExcalidrawViewportChangedAction,
  TLoadTreeAction,
  TMoveNodeAction,
  TOpenNodeAction,
  TOpenVaultLinkAction,
  TOverwriteConflictAction,
  TPageHiddenAction,
  TReloadDocumentAction,
  TRestoreDocumentAction,
  TExcalidrawDocumentChangedAction,
  TMarkdownDocumentChangedAction,
  TResolveVaultImageAction,
  TTextDocumentChangedAction,
  TResizeSidebarAction,
  TSelectNodeAction,
  TSetSettingAction,
  TStartCreateAction,
  TStartRenameAction,
  TSubmitDraftAction,
  TToggleFolderAction,
} from "./src/registry.js";
