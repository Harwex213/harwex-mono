import type { TExcalidrawStyle, TSetSettingAction } from "@hw/harwex-notes-protocol";

type TSettingsModalRegistrySlice = {
  setSettingAction: TSetSettingAction;
};

type TSettingsModalProps = {
  isOpen: boolean;
  // The style new drawings start with now: the user's choice over the app's own (SET-2).
  drawingStyle: Required<TExcalidrawStyle>;
  // True when the user has chosen a style, so "Reset" has something to undo.
  isDrawingStyleCustom: boolean;
  registry: TSettingsModalRegistrySlice;
  onClose: () => void;
};

export type { TSettingsModalProps, TSettingsModalRegistrySlice };
