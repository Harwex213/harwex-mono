import type { TFsNodeKind } from "./types/fs.js";
import type { TExcalidrawScene, TExcalidrawViewport } from "./types/document.js";
import type { TJsonValue } from "./types/state.js";

// Node Actions

type TLoadTreeAction = () => Promise<void>;
type TOpenNodeAction = (nodeId: string) => void;
type TSelectNodeAction = (nodeId: string) => void;
type TMoveNodeAction = (nodeId: string, parentId: string | null) => void;
type TDeleteNodeAction = (nodeId: string) => void;

type TNodeActions = {
  loadTreeAction: TLoadTreeAction;
  openNodeAction: TOpenNodeAction;
  selectNodeAction: TSelectNodeAction;
  moveNodeAction: TMoveNodeAction;
  deleteNodeAction: TDeleteNodeAction;
};

// Folder Actions

type TToggleFolderAction = (nodeId: string) => void;
type TStartCreateAction = (parentId: string | null, kind: TFsNodeKind) => void;
type TStartRenameAction = (nodeId: string) => void;

type TFolderActions = {
  toggleFolderAction: TToggleFolderAction;
  startCreateAction: TStartCreateAction;
  startRenameAction: TStartRenameAction;
};

// Draft Actions

type TSubmitDraftAction = (name: string) => void;
type TCancelDraftAction = () => void;

type TDraftActions = {
  cancelDraftAction: TCancelDraftAction;
  submitDraftAction: TSubmitDraftAction;
};


// Tab Actions

type TActivateTabAction = (nodeId: string) => void;
type TCloseTabAction = (nodeId: string) => void;

// A link inside a document that points at a vault file (EX-9). `fromNodeId` is the
// document the link sits in, for links relative to its folder.
type TOpenVaultLinkAction = (fromNodeId: string, href: string) => void;
type TDismissLinkErrorAction = () => void;

type TTabActions = {
  activateTabAction: TActivateTabAction;
  closeTabAction: TCloseTabAction;
  openVaultLinkAction: TOpenVaultLinkAction;
  dismissLinkErrorAction: TDismissLinkErrorAction;
};

// Document Actions

type TReloadDocumentAction = (nodeId: string) => void;
type TExcalidrawDocumentChangedAction = (nodeId: string, scene: TExcalidrawScene) => void;
type TMarkdownDocumentChangedAction = (nodeId: string, text: string) => void;
type TTextDocumentChangedAction = (nodeId: string, text: string) => void;
// The URL a Markdown image loads from (MD-5). A path relative to the document resolves
// against its folder, a path that starts with "/" against the vault root. Null when the
// path names no image in the vault.
type TResolveVaultImageAction = (fromNodeId: string, src: string) => string | null;
type TFlushDocumentsAction = () => void;
// Pan and zoom of a drawing. Saved as view state, never as an edit (EX-6, EX-8).
type TExcalidrawViewportChangedAction = (nodeId: string, viewport: TExcalidrawViewport) => void;
// The page is being hidden or closed: every pending save goes out now (DOC-3, APP-6).
type TPageHiddenAction = () => void;

type TMiscActions = {
  reloadDocumentAction: TReloadDocumentAction;
  excalidrawDocumentChangedAction: TExcalidrawDocumentChangedAction;
  markdownDocumentChangedAction: TMarkdownDocumentChangedAction;
  textDocumentChangedAction: TTextDocumentChangedAction;
  resolveVaultImageAction: TResolveVaultImageAction;
  flushDocumentsAction: TFlushDocumentsAction;
  excalidrawViewportChangedAction: TExcalidrawViewportChangedAction;
  pageHiddenAction: TPageHiddenAction;
};

// Conflict Actions

type TOverwriteConflictAction = (nodeId: string) => void;
type TDiscardConflictAction = (nodeId: string) => void;
// Writes back a document whose file was deleted on disk while it had unsaved changes,
// recreating the file at its old path (SYNC-5).
type TRestoreDocumentAction = (nodeId: string) => void;

type TConflictActions = {
  overwriteConflictAction: TOverwriteConflictAction;
  discardConflictAction: TDiscardConflictAction;
  restoreDocumentAction: TRestoreDocumentAction;
};

// Layout Actions

type TResizeSidebarAction = (width: number) => void;

type TLayoutActions = {
  resizeSidebarAction: TResizeSidebarAction;
};

// Search Actions

type TChangeSearchAction = (term: string) => void;
type TClearSearchAction = () => void;

type TSearchActions = {
  changeSearchAction: TChangeSearchAction;
  clearSearchAction: TClearSearchAction;
};

// Session Actions

// A `null` value removes the setting.
type TSetSettingAction = (key: string, value: TJsonValue | null) => void;

type TSessionActions = {
  setSettingAction: TSetSettingAction;
};

// App

type TAppRegistry = &
  TNodeActions &
  TDraftActions &
  TFolderActions &
  TTabActions &
  TConflictActions &
  TLayoutActions &
  TSearchActions &
  TSessionActions &
  TMiscActions;

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
  TFlushDocumentsAction,
  TMarkdownDocumentChangedAction,
  TResizeSidebarAction,
  TResolveVaultImageAction,
  TSelectNodeAction,
  TSetSettingAction,
  TStartCreateAction,
  TStartRenameAction,
  TSubmitDraftAction,
  TTextDocumentChangedAction,
  TToggleFolderAction,
};
