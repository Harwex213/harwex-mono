import type { ReactNode } from "react";
import { LAYOUTS } from "../data/layouts";
import { definitionOf } from "../data/widget-registry";
import { useActivePage, useEditor } from "../store/editor-context";
import type { Selection } from "../types";

function LayersPanel(): ReactNode {
  const { state, dispatch } = useEditor();
  const page = useActivePage();

  function isSelected(selection: Selection): boolean {
    return state.selection?.kind === selection.kind && state.selection.id === selection.id;
  }

  function select(selection: Selection): void {
    dispatch({ type: "select", selection });
  }

  return (
    <div className="tb-panel">
      <div className="tb-panel__head">
        <span className="tb-panel__title">{page.name} — layers</span>
      </div>

      <ul className="tb-tree">
        {page.sections.map((section) => (
          <li key={section.id}>
            <button
              type="button"
              className={isSelected({ kind: "section", id: section.id }) ? "tb-tree__row is-active" : "tb-tree__row"}
              onClick={() => select({ kind: "section", id: section.id })}
            >
              <span className="tb-tree__glyph">▤</span>
              <span className="tb-tree__name">{section.name}</span>
              <span className="tb-tree__tag">{LAYOUTS[section.layout].label}</span>
            </button>

            <ul className="tb-tree__children">
              {section.containers.map((container, index) => (
                <li key={container.id}>
                  <button
                    type="button"
                    className={
                      isSelected({ kind: "container", id: container.id })
                        ? "tb-tree__row tb-tree__row--sub is-active"
                        : "tb-tree__row tb-tree__row--sub"
                    }
                    onClick={() => select({ kind: "container", id: container.id })}
                  >
                    <span className="tb-tree__glyph">▯</span>
                    <span className="tb-tree__name">Container {index + 1}</span>
                    <span className="tb-tree__tag">{container.widgets.length}</span>
                  </button>

                  <ul className="tb-tree__children">
                    {container.widgets.map((widget) => (
                      <li key={widget.id}>
                        <button
                          type="button"
                          className={
                            isSelected({ kind: "widget", id: widget.id })
                              ? "tb-tree__row tb-tree__row--leaf is-active"
                              : "tb-tree__row tb-tree__row--leaf"
                          }
                          onClick={() => select({ kind: "widget", id: widget.id })}
                        >
                          <span className="tb-tree__glyph">{definitionOf(widget.type).glyph}</span>
                          <span className="tb-tree__name">{definitionOf(widget.type).name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

export { LayersPanel };
