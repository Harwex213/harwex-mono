import { useSignals } from "@preact/signals-react/runtime";
import { ExcalidrawViewer, MarkdownViewer } from "@hw/harwex-notes-components";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type {
  TExcalidrawDocumentChangedAction,
  TMarkdownDocumentChangedAction,
  TReloadDocumentAction,
} from "@hw/harwex-notes-protocol";

type TViewerPaneRegistrySlice = {
  reloadDocumentAction: TReloadDocumentAction;
  excalidrawDocumentChangedAction: TExcalidrawDocumentChangedAction;
  markdownDocumentChangedAction: TMarkdownDocumentChangedAction;
};

type TViewerPaneProps = {
  registry: TViewerPaneRegistrySlice;
};

const ViewerPane: FC<TViewerPaneProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const node = store.derived.activeNode.value;
  const entry = store.derived.activeEntry.value;

  if (node === null) {
    return (
      <section className="viewer viewer--centered">
        <p className="viewer__placeholder">{"Pick a note in the vault to open it."}</p>
      </section>
    );
  }

  if (entry === null || entry.status === "loading") {
    return (
      <section className="viewer viewer--centered">
        <p className="viewer__placeholder">{`Opening ${node.name}…`}</p>
      </section>
    );
  }

  if (entry.status === "error") {
    return (
      <section className="viewer viewer--centered">
        <p className="viewer__error">{entry.message}</p>

        <button
          className="viewer__retry"
          onClick={() => registry.reloadDocumentAction(node.id)}
          type="button"
        >
          {"Try again"}
        </button>
      </section>
    );
  }

  if (entry.document.kind === "markdown") {
    return (
      <section className="viewer viewer--markdown">
        <MarkdownViewer document={entry.document} registry={registry} theme={"light"} />
      </section>
    );
  }

  return (
    <section className="viewer viewer--sketch">
      <ExcalidrawViewer document={entry.document} registry={registry} theme={"light"} />
    </section>
  );
};

export { ViewerPane };
