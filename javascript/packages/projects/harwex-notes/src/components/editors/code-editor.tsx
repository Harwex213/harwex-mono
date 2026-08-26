import type { Extension } from "@codemirror/state";
import { docsByPath, setDraft } from "../../state/doc-store.ts";
import { useCodeMirror } from "./use-code-mirror.ts";

type CodeEditorProps = {
  path: string;
  language: Extension | null;
};

/**
 * The draft is read with `peek` on purpose: the view owns the text after mount,
 * so subscribing here would re-render the host on every keystroke for nothing.
 */
function CodeEditor({ path, language }: CodeEditorProps) {
  const hostRef = useCodeMirror({
    initialText: docsByPath.peek()[path]?.draftText ?? "",
    language,
    onChange: (text) => {
      setDraft(path, text);
    },
  });
  return <div className="cm-host" ref={hostRef} />;
}

export { CodeEditor };
