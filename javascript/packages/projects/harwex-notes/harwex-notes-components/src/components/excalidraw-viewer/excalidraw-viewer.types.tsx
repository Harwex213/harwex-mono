import type {
  TExcalidrawDocument,
  TExcalidrawDocumentChangedAction,
} from "@hw/harwex-notes-protocol";

type TExcalidrawViewerRegistrySlice = {
  excalidrawDocumentChangedAction: TExcalidrawDocumentChangedAction;
};

type TExcalidrawViewerProps = {
  document: TExcalidrawDocument;
  registry: TExcalidrawViewerRegistrySlice;
  theme?: "light" | "dark";
  readOnly?: boolean;
};

export type {
  TExcalidrawViewerProps,
  TExcalidrawViewerRegistrySlice,
};