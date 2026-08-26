import { useSignals } from "@preact/signals-react/runtime";
import { useEffect } from "react";
import { saveDoc } from "../state/doc-store.ts";
import { panelWidth } from "../state/layout.ts";
import { activePath } from "../state/tabs-store.ts";
import { ROOT_PATH, loadChildren } from "../state/tree-store.ts";
import { EditorHost } from "./editor-host.tsx";
import { FsTree } from "./fs-tree.tsx";
import { Splitter } from "./splitter.tsx";
import { TabBar } from "./tab-bar.tsx";

function App() {
  useSignals();

  useEffect(() => {
    void loadChildren(ROOT_PATH);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== "s" || !(event.metaKey || event.ctrlKey)) {
        return;
      }
      // The browser's own save dialog is never what the user meant here.
      event.preventDefault();
      const path = activePath.peek();
      if (path !== null) {
        void saveDoc(path);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <div className="app">
      <aside className="panel" style={{ width: `${panelWidth.value}px` }}>
        <div className="panel-head">notes root</div>
        <FsTree />
      </aside>
      <Splitter />
      <main className="workspace">
        <TabBar />
        <EditorHost />
      </main>
    </div>
  );
}

export { App };
