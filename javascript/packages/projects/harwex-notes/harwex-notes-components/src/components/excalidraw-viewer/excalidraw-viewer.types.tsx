import type {
  TExcalidrawDocument,
  TExcalidrawDocumentChangedAction,
  TExcalidrawStyle,
  TExcalidrawViewport,
  TExcalidrawViewportChangedAction,
  TOpenVaultLinkAction,
} from "@hw/harwex-notes-protocol";

type TExcalidrawViewerRegistrySlice = {
  excalidrawDocumentChangedAction: TExcalidrawDocumentChangedAction;
  excalidrawViewportChangedAction: TExcalidrawViewportChangedAction;
  openVaultLinkAction: TOpenVaultLinkAction;
};

type TExcalidrawViewerProps = {
  document: TExcalidrawDocument;
  registry: TExcalidrawViewerRegistrySlice;
  theme?: "light" | "dark";
  readOnly?: boolean;
  // The style for every key the drawing's file does not set itself (SET-2).
  defaultStyle?: TExcalidrawStyle;
  // Where the user left this drawing. Read once, when the drawing mounts. Without it the
  // drawing opens fitted to its content (EX-8).
  viewport?: TExcalidrawViewport | null;
  // Vault-relative paths of the files a link may point at (EX-9).
  linkTargets?: readonly string[];
};

export type {
  TExcalidrawViewerProps,
  TExcalidrawViewerRegistrySlice,
};
