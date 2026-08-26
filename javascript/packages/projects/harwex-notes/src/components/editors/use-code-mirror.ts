import type { Extension } from "@codemirror/state";
import { EditorState } from "@codemirror/state";
import { basicSetup, EditorView } from "codemirror";
import { useEffect, useRef, type RefObject } from "react";

type CodeMirrorOptions = {
  initialText: string;
  language: Extension | null;
  onChange: (text: string) => void;
};

const editorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      fontSize: "13px",
      backgroundColor: "#0f1319",
      color: "#e6edf3",
    },
    ".cm-scroller": {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      lineHeight: "1.6",
    },
    ".cm-gutters": {
      backgroundColor: "#0f1319",
      color: "#4c5661",
      border: "0",
    },
    ".cm-activeLine": {
      backgroundColor: "#161b22",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "#161b22",
      color: "#8b949e",
    },
    ".cm-content": {
      caretColor: "#58a6ff",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "#58a6ff",
    },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
      backgroundColor: "#1f3350",
    },
  },
  { dark: true },
);

/**
 * Builds the `EditorView` once and hands it the document from there on. The
 * component that calls this is keyed by path, so "once" means once per open
 * document; rebuilding the view from React state on each keystroke would throw
 * away the selection and the undo history.
 */
function useCodeMirror(options: CodeMirrorOptions): RefObject<HTMLDivElement | null> {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const changeRef = useRef(options.onChange);
  changeRef.current = options.onChange;
  const initialRef = useRef(options.initialText);
  const languageRef = useRef(options.language);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return undefined;
    }
    const extensions: Extension[] = [
      basicSetup,
      editorTheme,
      EditorView.lineWrapping,
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          changeRef.current(update.state.doc.toString());
        }
      }),
    ];
    const language = languageRef.current;
    if (language !== null) {
      extensions.push(language);
    }
    const view = new EditorView({
      state: EditorState.create({ doc: initialRef.current, extensions }),
      parent: host,
    });
    return () => {
      view.destroy();
    };
  }, []);

  return hostRef;
}

export { useCodeMirror };
