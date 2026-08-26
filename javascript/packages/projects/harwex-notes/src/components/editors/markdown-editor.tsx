import { markdown } from "@codemirror/lang-markdown";
import { useSignals } from "@preact/signals-react/runtime";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo } from "react";
import { docsByPath } from "../../state/doc-store.ts";
import { markdownPreviewOn } from "../../state/view-store.ts";
import { CodeEditor } from "./code-editor.tsx";

type MarkdownEditorProps = {
  path: string;
};

function renderMarkdown(source: string): string {
  const parsed = marked.parse(source, { async: false, gfm: true, breaks: false });
  return DOMPurify.sanitize(parsed);
}

function MarkdownEditor({ path }: MarkdownEditorProps) {
  useSignals();
  const previewOn = markdownPreviewOn(path);
  const draft = docsByPath.value[path]?.draftText ?? "";
  const html = useMemo(() => {
    return previewOn ? renderMarkdown(draft) : "";
  }, [draft, previewOn]);

  return (
    <div className={previewOn ? "editor-split" : "editor-single"}>
      <CodeEditor path={path} language={markdown()} />
      {previewOn ? (
        <div
          className="markdown-preview"
          // The source is a local file the user is editing, and it still goes
          // through DOMPurify before it reaches the DOM.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : null}
    </div>
  );
}

export { MarkdownEditor };
