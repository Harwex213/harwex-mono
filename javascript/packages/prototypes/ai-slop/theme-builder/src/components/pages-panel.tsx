import type { ReactNode } from "react";
import { useEditor } from "../store/editor-context";

function PagesPanel(): ReactNode {
  const { state, dispatch } = useEditor();

  return (
    <div className="tb-panel">
      <div className="tb-panel__head">
        <span className="tb-panel__title">Site pages</span>
        <button type="button" className="tb-btn tb-btn--small" onClick={() => dispatch({ type: "add-page" })}>
          ＋ Page
        </button>
      </div>

      <ul className="tb-pages">
        {state.doc.pages.map((page, index) => {
          const isActive = page.id === state.activePageId;
          const widgets = page.sections.reduce(
            (total, section) =>
              total + section.containers.reduce((count, container) => count + container.widgets.length, 0),
            0,
          );

          return (
            <li key={page.id} className={isActive ? "tb-pages__item is-active" : "tb-pages__item"}>
              <button
                type="button"
                className="tb-pages__main"
                onClick={() => dispatch({ type: "set-active-page", pageId: page.id })}
              >
                <span className="tb-pages__name">{page.name}</span>
                <span className="tb-pages__meta">
                  {page.path} · {page.sections.length} sections · {widgets} widgets
                </span>
              </button>
              <span className="tb-pages__tools">
                <button
                  type="button"
                  className="tb-icon"
                  title="Move up"
                  disabled={index === 0}
                  onClick={() => dispatch({ type: "move-page", pageId: page.id, offset: -1 })}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="tb-icon"
                  title="Move down"
                  disabled={index === state.doc.pages.length - 1}
                  onClick={() => dispatch({ type: "move-page", pageId: page.id, offset: 1 })}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="tb-icon"
                  title="Duplicate"
                  onClick={() => dispatch({ type: "duplicate-page", pageId: page.id })}
                >
                  ⧉
                </button>
                <button
                  type="button"
                  className="tb-icon tb-icon--danger"
                  title="Delete"
                  disabled={state.doc.pages.length <= 1}
                  onClick={() => dispatch({ type: "delete-page", pageId: page.id })}
                >
                  ✕
                </button>
              </span>
            </li>
          );
        })}
      </ul>

      <p className="tb-panel__note">
        Select a page to edit it on the canvas. Page name and URL live in the inspector on the right.
      </p>
    </div>
  );
}

export { PagesPanel };
