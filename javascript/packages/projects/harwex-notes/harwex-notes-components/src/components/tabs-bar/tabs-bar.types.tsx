import type { TActivateTabAction, TCloseTabAction, TFsFileKind } from "@hw/harwex-notes-protocol";

type TTabSaveState =
  | "loading"
  | "saved"
  | "unsaved"
  | "saving"
  | "failed"
  | "conflict"
  | "deleted";

type TTab = {
  id: string;
  name: string;
  kind: TFsFileKind;
  saveState: TTabSaveState;
};

type TTabsBarRegistrySlice = {
  activateTabAction: TActivateTabAction;
  closeTabAction: TCloseTabAction;
};

type TTabsBarProps = {
  tabs: readonly TTab[];
  activeId: string | null;
  // A message that belongs near the tab bar, such as a refused open (FEED-4, TAB-2).
  message?: string | null;
  registry: TTabsBarRegistrySlice;
};

export type { TTab, TTabSaveState, TTabsBarProps, TTabsBarRegistrySlice };
