import type {
  TDiscardConflictAction,
  TFsFileKind,
  TOverwriteConflictAction,
} from "@hw/harwex-notes-protocol";

type TConflict = {
  id: string;
  name: string;
  kind: TFsFileKind;
};

type TConflictModalRegistrySlice = {
  overwriteConflictAction: TOverwriteConflictAction;
  discardConflictAction: TDiscardConflictAction;
};

type TConflictModalProps = {
  conflict: TConflict | null;
  waitingCount?: number;
  registry: TConflictModalRegistrySlice;
};

export type { TConflict, TConflictModalProps, TConflictModalRegistrySlice };
