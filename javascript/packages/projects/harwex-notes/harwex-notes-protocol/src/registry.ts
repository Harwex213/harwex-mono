import type { TFsNodeKind } from "./types/fs";
import type { TExcalidrawScene } from "./types/document";

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

type TTabActions = {
  activateTabAction: TActivateTabAction;
  closeTabAction: TCloseTabAction;
};

// Document Actions

type TReloadDocumentAction = (nodeId: string) => void;
type TExcalidrawDocumentChangedAction = (nodeId: string, scene: TExcalidrawScene) => void;
type TMarkdownDocumentChangedAction = (nodeId: string, text: string) => void;

type TMiscActions = {
  reloadDocumentAction: TReloadDocumentAction;
  excalidrawDocumentChangedAction: TExcalidrawDocumentChangedAction;
  markdownDocumentChangedAction: TMarkdownDocumentChangedAction;
};

// Conflict Actions

type TOverwriteConflictAction = (nodeId: string) => void;
type TDiscardConflictAction = (nodeId: string) => void;

type TConflictActions = {
  overwriteConflictAction: TOverwriteConflictAction;
  discardConflictAction: TDiscardConflictAction;
};

// Layout Actions

type TResizeSidebarAction = (width: number) => void;

type TLayoutActions = {
  resizeSidebarAction: TResizeSidebarAction;
};

// App

type TAppRegistry = &
  TNodeActions &
  TDraftActions &
  TFolderActions &
  TTabActions &
  TConflictActions &
  TLayoutActions &
  TMiscActions;

export type {
  TActivateTabAction,
  TAppRegistry,
  TCancelDraftAction,
  TCloseTabAction,
  TDeleteNodeAction,
  TDiscardConflictAction,
  TLoadTreeAction,
  TMoveNodeAction,
  TOpenNodeAction,
  TOverwriteConflictAction,
  TReloadDocumentAction,
  TExcalidrawDocumentChangedAction,
  TMarkdownDocumentChangedAction,
  TResizeSidebarAction,
  TSelectNodeAction,
  TStartCreateAction,
  TStartRenameAction,
  TSubmitDraftAction,
  TToggleFolderAction,
};
