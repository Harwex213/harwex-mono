import { createContext, useContext, useEffect, useMemo, useReducer } from "react";
import type { Dispatch, ReactNode } from "react";
import type { EditorState, PageNode } from "../types";
import type { EditorAction } from "./actions";
import { loadDoc, saveDoc } from "./persistence";
import { createInitialState, editorReducer } from "./reducer";

interface EditorContextValue {
  state: EditorState;
  dispatch: Dispatch<EditorAction>;
}

const EditorContext = createContext<EditorContextValue | null>(null);

const AUTOSAVE_DELAY = 400;

interface EditorProviderProps {
  children: ReactNode;
}

function EditorProvider({ children }: EditorProviderProps): ReactNode {
  const [state, dispatch] = useReducer(editorReducer, undefined, () => createInitialState(loadDoc() ?? undefined));

  useEffect(() => {
    const timer = window.setTimeout(() => saveDoc(state.doc), AUTOSAVE_DELAY);

    return () => window.clearTimeout(timer);
  }, [state.doc]);

  const value = useMemo(() => ({ state, dispatch }), [state]);

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}

function useEditor(): EditorContextValue {
  const value = useContext(EditorContext);

  if (!value) {
    throw new Error("useEditor must be used inside EditorProvider");
  }

  return value;
}

function useActivePage(): PageNode {
  const { state } = useEditor();

  return state.doc.pages.find((page) => page.id === state.activePageId) ?? state.doc.pages[0];
}

export { EditorProvider, useActivePage, useEditor };
