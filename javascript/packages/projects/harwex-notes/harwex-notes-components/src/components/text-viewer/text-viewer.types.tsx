import type {
  TTextDocument,
  TTextDocumentChangedAction,
} from "@hw/harwex-notes-protocol";

type TTextViewerRegistrySlice = {
  textDocumentChangedAction: TTextDocumentChangedAction;
};

type TTextViewerProps = {
  document: TTextDocument;
  registry: TTextViewerRegistrySlice;
  theme?: "light" | "dark";
  readOnly?: boolean;
};

export type { TTextViewerProps, TTextViewerRegistrySlice };
