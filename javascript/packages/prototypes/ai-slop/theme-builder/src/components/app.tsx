import { useEffect } from "react";
import type { ReactNode } from "react";
import { EditorProvider, useEditor } from "../store/editor-context";
import { Canvas } from "./canvas";
import { Inspector } from "./inspector";
import { LeftPanel } from "./left-panel";
import { TopBar } from "./top-bar";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function Shell(): ReactNode {
  const { state, dispatch } = useEditor();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const mod = event.metaKey || event.ctrlKey;

      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        dispatch({ type: event.shiftKey ? "redo" : "undo" });

        return;
      }

      if (isTypingTarget(event.target)) {
        return;
      }

      if (event.key === "Escape") {
        dispatch({ type: "select", selection: null });

        return;
      }

      if (event.key !== "Backspace" && event.key !== "Delete") {
        return;
      }

      const selection = state.selection;

      if (!selection) {
        return;
      }

      event.preventDefault();

      if (selection.kind === "widget") {
        dispatch({ type: "delete-widget", widgetId: selection.id });
      }

      if (selection.kind === "section") {
        dispatch({ type: "delete-section", sectionId: selection.id });
      }
    }

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch, state.selection]);

  return (
    <div className={state.preview ? "tb-app tb-app--preview" : "tb-app"}>
      <TopBar />
      {state.preview ? null : <LeftPanel />}
      <Canvas />
      {state.preview ? null : <Inspector />}
    </div>
  );
}

function App(): ReactNode {
  return (
    <EditorProvider>
      <Shell />
    </EditorProvider>
  );
}

export { App };
