import { useSignals } from "@preact/signals-react/runtime";
import {
  HtmlViewer,
  ImageViewer,
  MarkdownViewer,
  TextViewer,
} from "@hw/harwex-notes-components";
import { useStore } from "../../store/store";
import { ExcalidrawViewerContainer } from "./excalidraw-viewer-container";
import type { FC } from "react";
import type {
  TExcalidrawDocumentChangedAction,
  TExcalidrawViewportChangedAction,
  TMarkdownDocumentChangedAction,
  TOpenVaultLinkAction,
  TReloadDocumentAction,
  TResolveVaultImageAction,
  TTextDocumentChangedAction,
} from "@hw/harwex-notes-protocol";

const HTTP_LINK_PATTERN = /^https?:\/\//i;

type TViewerPaneRegistrySlice = {
  reloadDocumentAction: TReloadDocumentAction;
  excalidrawDocumentChangedAction: TExcalidrawDocumentChangedAction;
  excalidrawViewportChangedAction: TExcalidrawViewportChangedAction;
  markdownDocumentChangedAction: TMarkdownDocumentChangedAction;
  textDocumentChangedAction: TTextDocumentChangedAction;
  resolveVaultImageAction: TResolveVaultImageAction;
  openVaultLinkAction: TOpenVaultLinkAction;
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
    // Read so that an image added to, removed from or changed in the vault redraws the
    // document (MD-5, SYNC-3).
    void store.fs.nodes.value;
    void store.sync.imageVersionById.value;

    return (
      <section className="viewer viewer--markdown">
        <MarkdownViewer
          document={entry.document}
          onLinkClick={(href, event) => {
            // http and https keep the browser's own behaviour: a new tab (MD-8).
            if (HTTP_LINK_PATTERN.test(href)) {
              return;
            }

            // Anything else never navigates the app. A vault link opens its file as a tab,
            // or says why it opens nothing (MD-6, MD-7).
            event.preventDefault();
            registry.openVaultLinkAction(node.id, href);
          }}
          registry={registry}
          resolveImageUrl={(src) => registry.resolveVaultImageAction(node.id, src)}
          theme={"light"}
        />
      </section>
    );
  }

  if (entry.document.kind === "text") {
    return (
      <section className="viewer viewer--text">
        <TextViewer document={entry.document} registry={registry} theme={"light"} />
      </section>
    );
  }

  if (entry.document.kind === "image") {
    return (
      <section className="viewer viewer--image">
        <ImageViewer document={entry.document} name={node.name} />
      </section>
    );
  }

  if (entry.document.kind === "html") {
    return (
      <section className="viewer viewer--html">
        <HtmlViewer document={entry.document} name={node.name} />
      </section>
    );
  }

  return (
    <section className="viewer viewer--sketch">
      <ExcalidrawViewerContainer document={entry.document} key={node.id} registry={registry} />
    </section>
  );
};

export { ViewerPane };
