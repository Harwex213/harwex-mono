import { html } from "@codemirror/lang-html";
import { useSignals } from "@preact/signals-react/runtime";
import { docsByPath } from "../../state/doc-store.ts";
import { htmlSourceOn } from "../../state/view-store.ts";
import { CodeEditor } from "./code-editor.tsx";

type HtmlPreviewProps = {
  path: string;
};

function HtmlPreview({ path }: HtmlPreviewProps) {
  useSignals();
  const sourceOn = htmlSourceOn(path);
  const savedText = docsByPath.value[path]?.savedText ?? "";

  if (sourceOn) {
    return (
      <div className="editor-single">
        <CodeEditor path={path} language={html()} />
      </div>
    );
  }
  return (
    <div className="editor-single">
      <iframe
        className="html-frame"
        title={`Preview of ${path}`}
        // `allow-scripts` alone keeps the frame on an opaque origin. Adding
        // `allow-same-origin` next to it would let the framed page reach back
        // into the app, which is not a sandbox at all.
        sandbox="allow-scripts"
        srcDoc={savedText}
      />
    </div>
  );
}

export { HtmlPreview };
