type TLoadTreeAction = () => Promise<void>;

type TToggleFolderAction = (nodeId: string) => void;

type TOpenNodeAction = (nodeId: string) => void;

type TActivateTabAction = (nodeId: string) => void;

type TCloseTabAction = (nodeId: string) => void;

type TReloadDocumentAction = (nodeId: string) => void;

type TAppRegistry = {
  loadTreeAction: TLoadTreeAction;
  toggleFolderAction: TToggleFolderAction;
  openNodeAction: TOpenNodeAction;
  activateTabAction: TActivateTabAction;
  closeTabAction: TCloseTabAction;
  reloadDocumentAction: TReloadDocumentAction;
};

export type {
  TActivateTabAction,
  TAppRegistry,
  TCloseTabAction,
  TLoadTreeAction,
  TOpenNodeAction,
  TReloadDocumentAction,
  TToggleFolderAction,
};
