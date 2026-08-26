import type { TFsDraftKind } from "../store/fs-slice";

type TLoadTreeAction = () => Promise<void>;

type TToggleFolderAction = (nodeId: string) => void;

type TOpenNodeAction = (nodeId: string) => void;

type TSelectNodeAction = (nodeId: string) => void;

type TStartCreateAction = (parentId: string | null, kind: TFsDraftKind) => void;

type TStartRenameAction = (nodeId: string) => void;

type TCancelDraftAction = () => void;

type TSubmitDraftAction = (name: string) => void;

type TMoveNodeAction = (nodeId: string, parentId: string | null) => void;

type TDeleteNodeAction = (nodeId: string) => void;

type TActivateTabAction = (nodeId: string) => void;

type TCloseTabAction = (nodeId: string) => void;

type TReloadDocumentAction = (nodeId: string) => void;

type TAppRegistry = {
  loadTreeAction: TLoadTreeAction;
  toggleFolderAction: TToggleFolderAction;
  openNodeAction: TOpenNodeAction;
  selectNodeAction: TSelectNodeAction;
  startCreateAction: TStartCreateAction;
  startRenameAction: TStartRenameAction;
  cancelDraftAction: TCancelDraftAction;
  submitDraftAction: TSubmitDraftAction;
  moveNodeAction: TMoveNodeAction;
  deleteNodeAction: TDeleteNodeAction;
  activateTabAction: TActivateTabAction;
  closeTabAction: TCloseTabAction;
  reloadDocumentAction: TReloadDocumentAction;
};

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
