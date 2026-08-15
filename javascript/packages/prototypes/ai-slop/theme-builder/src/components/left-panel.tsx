import type { ReactNode } from "react";
import { useEditor } from "../store/editor-context";
import type { LeftTabId } from "../types";
import { AddPanel } from "./add-panel";
import { LayersPanel } from "./layers-panel";
import { PagesPanel } from "./pages-panel";
import { ThemePanel } from "./theme-panel";

const TABS: { id: LeftTabId; label: string; glyph: string }[] = [
  { id: "pages", label: "Pages", glyph: "🗂" },
  { id: "add", label: "Add", glyph: "＋" },
  { id: "layers", label: "Layers", glyph: "☰" },
  { id: "theme", label: "Theme", glyph: "🎨" },
];

function LeftPanel(): ReactNode {
  const { state, dispatch } = useEditor();

  return (
    <aside className="tb-left">
      <nav className="tb-left__tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={state.leftTab === tab.id ? "tb-left__tab is-active" : "tb-left__tab"}
            onClick={() => dispatch({ type: "set-left-tab", tab: tab.id })}
            title={tab.label}
          >
            <span aria-hidden="true">{tab.glyph}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>
      <div className="tb-left__body">
        {state.leftTab === "pages" ? <PagesPanel /> : null}
        {state.leftTab === "add" ? <AddPanel /> : null}
        {state.leftTab === "layers" ? <LayersPanel /> : null}
        {state.leftTab === "theme" ? <ThemePanel /> : null}
      </div>
    </aside>
  );
}

export { LeftPanel };
