import { useSignals } from "@preact/signals-react/runtime";
import { docsByPath, forceSaveDoc, reloadDoc } from "../state/doc-store.ts";
import { activePath } from "../state/tabs-store.ts";
import { ExcalidrawEditor } from "./editors/excalidraw-editor.tsx";
import { HtmlPreview } from "./editors/html-preview.tsx";
import { MarkdownEditor } from "./editors/markdown-editor.tsx";
import { TextEditor } from "./editors/text-editor.tsx";

function EditorHost() {
  useSignals();
  const path = activePath.value;
  if (path === null) {
    return (
      <div className="editor-pane">
        <div className="editor-message">
          Pick a file in the tree. Double click, or press Enter on the selected row.
        </div>
      </div>
    );
  }
  const doc = docsByPath.value[path];
  if (doc === undefined || doc.status === "loading") {
    return (
      <div className="editor-pane">
        <div className="editor-message">{`Loading ${path}...`}</div>
      </div>
    );
  }
  if (doc.status === "error") {
    return (
      <div className="editor-pane">
        <div className="editor-message editor-message-bad">
          {doc.error ?? `Could not open ${path}.`}
        </div>
      </div>
    );
  }

  // Each editor is keyed by path and revision, so switching tabs or reloading
  // from disk rebuilds it instead of feeding a live Excalidraw or EditorView a
  // document it never opened.
  const key = `${path}#${doc.revision}`;

  return (
    <div className="editor-pane">
      {doc.conflict ? (
        <div className="conflict-banner">
          <span>
            {`${path} changed on disk after it was opened. Saving would overwrite that change.`}
          </span>
          <span className="conflict-actions">
            <button
              type="button"
              onClick={() => {
                void reloadDoc(path);
              }}
            >
              discard mine, reload
            </button>
            <button
              type="button"
              onClick={() => {
                void forceSaveDoc(path);
              }}
            >
              overwrite theirs
            </button>
          </span>
        </div>
      ) : null}
      {doc.error !== null && !doc.conflict ? (
        <div className="editor-notice editor-message-bad">{doc.error}</div>
      ) : null}
      {doc.fileKind === "excalidraw" ? <ExcalidrawEditor key={key} path={path} /> : null}
      {doc.fileKind === "markdown" ? <MarkdownEditor key={key} path={path} /> : null}
      {doc.fileKind === "html" ? <HtmlPreview key={key} path={path} /> : null}
      {doc.fileKind === "text" ? <TextEditor key={key} path={path} /> : null}
    </div>
  );
}

export { EditorHost };
