import { useSignals } from "@preact/signals-react/runtime";
import { ExcalidrawViewer } from "@hw/harwex-notes-components";
import { useState } from "react";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type {
  TExcalidrawDocument,
  TExcalidrawDocumentChangedAction,
  TExcalidrawViewportChangedAction,
  TOpenVaultLinkAction,
} from "@hw/harwex-notes-protocol";

type TExcalidrawViewerContainerRegistrySlice = {
  excalidrawDocumentChangedAction: TExcalidrawDocumentChangedAction;
  excalidrawViewportChangedAction: TExcalidrawViewportChangedAction;
  openVaultLinkAction: TOpenVaultLinkAction;
};

type TExcalidrawViewerContainerProps = {
  document: TExcalidrawDocument;
  registry: TExcalidrawViewerContainerRegistrySlice;
};

// Mounted once per drawing (the parent keys it on the node).
const ExcalidrawViewerContainer: FC<TExcalidrawViewerContainerProps> = ({ document, registry }) => {
  useSignals();

  const store = useStore();
  // The viewport is read once, when the drawing mounts, the same way Excalidraw reads it.
  // Reading it in render would re-render the drawing on every pan step (EX-8).
  const [viewport] = useState(() => store.documents.excalidrawViewportById.peek()[document.nodeId] ?? null);

  return (
    <ExcalidrawViewer
      defaultStyle={store.derived.excalidrawDefaultStyle.value}
      document={document}
      linkTargets={store.derived.vaultFilePaths.value}
      registry={registry}
      theme={"light"}
      viewport={viewport}
    />
  );
};

export { ExcalidrawViewerContainer };
