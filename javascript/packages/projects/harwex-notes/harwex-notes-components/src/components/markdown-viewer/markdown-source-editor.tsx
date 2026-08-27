import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";
import type { FC } from "react";

type TMarkdownSourceEditorProps = {
  text: string;
  theme: "light" | "dark";
  readOnly: boolean;
  onChange: (text: string) => void;
};

// The editor draws from the host's `--color-*` variables, so the same instance follows a
// theme switch through CSS alone. `dark` only flips CodeMirror's own defaults, such as the
// selection and cursor colours.
const buildTheme = (dark: boolean) => {
  return EditorView.theme(
    {
      "&": {
        height: "100%",
        backgroundColor: "var(--color-surface, #ffffff)",
        color: "var(--color-text, #1d1c1a)",
        fontSize: "14px",
      },
      "&.cm-focused": {
        outline: "none",
      },
      ".cm-scroller": {
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        lineHeight: "1.5",
      },
      ".cm-content": {
        padding: "12px 0",
        caretColor: "var(--color-text, #1d1c1a)",
      },
      ".cm-gutters": {
        backgroundColor: "var(--color-surface, #ffffff)",
        color: "var(--color-text-muted, #6f6c65)",
        borderRight: "1px solid var(--color-border, #d9d7d1)",
      },
      ".cm-activeLine": {
        backgroundColor: "var(--color-line-active, rgba(0, 0, 0, 0.04))",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "var(--color-line-active, rgba(0, 0, 0, 0.04))",
      },
    },
    { dark }
  );
};

const MarkdownSourceEditor: FC<TMarkdownSourceEditorProps> = ({
  text,
  theme,
  readOnly,
  onChange,
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartmentRef = useRef(new Compartment());
  const readOnlyCompartmentRef = useRef(new Compartment());
  // The latest `onChange` without re-creating the editor when the parent re-renders.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const host = hostRef.current;

    if (host === null) {
      return;
    }

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: text,
        extensions: [
          basicSetup,
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          EditorView.lineWrapping,
          themeCompartmentRef.current.of(buildTheme(theme === "dark")),
          readOnlyCompartmentRef.current.of([
            EditorState.readOnly.of(readOnly),
            EditorView.editable.of(!readOnly),
          ]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) {
              return;
            }

            onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });

    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The editor is created once per mount; `text` after that is applied by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;

    if (view === null) {
      return;
    }

    view.dispatch({
      effects: themeCompartmentRef.current.reconfigure(buildTheme(theme === "dark")),
    });
  }, [theme]);

  useEffect(() => {
    const view = viewRef.current;

    if (view === null) {
      return;
    }

    view.dispatch({
      effects: readOnlyCompartmentRef.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly]);

  // Text coming from outside: the host handing back the last edit (same text, nothing to do)
  // or the file changing on disk (replace the document, keep the cursor where it can stay).
  useEffect(() => {
    const view = viewRef.current;

    if (view === null) {
      return;
    }

    const current = view.state.doc.toString();

    if (current === text) {
      return;
    }

    const anchor = Math.min(view.state.selection.main.anchor, text.length);

    view.dispatch({
      changes: { from: 0, to: current.length, insert: text },
      selection: { anchor },
    });
  }, [text]);

  return <div className="markdown-viewer__editor" ref={hostRef} />;
};

export { MarkdownSourceEditor };
