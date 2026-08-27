import type { TFsNodeKind } from "./types/fs";

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

// Misc Actions

type TReloadDocumentAction = (nodeId: string) => void;

type TMiscActions = {
  reloadDocumentAction: TReloadDocumentAction;
};

// App

type TAppRegistry = &
  TNodeActions &
  TDraftActions &
  TFolderActions &
  TTabActions &
  TMiscActions;

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
  TSelectNodeAction,
  TStartCreateAction,
  TStartRenameAction,
  TSubmitDraftAction,
  TToggleFolderAction,
};
