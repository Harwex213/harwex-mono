import { useMemo, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import { LAYOUT_ORDER, LAYOUTS } from "../data/layouts";
import { ALL_WIDGETS, WIDGET_CATEGORIES } from "../data/widget-registry";
import { beginDrag, endDrag } from "../dnd/drag-state";
import { useActivePage, useEditor } from "../store/editor-context";
import { insertTargetOf } from "../store/insert-target";
import type { SectionLayoutId, WidgetDefinition } from "../types";

function matches(definition: WidgetDefinition, query: string): boolean {
  if (query === "") {
    return true;
  }

  const haystack = `${definition.name} ${definition.description} ${definition.type}`.toLowerCase();

  return haystack.includes(query.toLowerCase());
}

function AddPanel(): ReactNode {
  const { state, dispatch } = useEditor();
  const page = useActivePage();
  const [query, setQuery] = useState("");

  const visible = useMemo(() => ALL_WIDGETS.filter((definition) => matches(definition, query)), [query]);

  function onWidgetDragStart(event: DragEvent<HTMLButtonElement>, widgetType: string): void {
    beginDrag({ kind: "new-widget", widgetType });
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", widgetType);
  }

  function onSectionDragStart(event: DragEvent<HTMLButtonElement>, layout: SectionLayoutId): void {
    beginDrag({ kind: "new-section", layout });
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", layout);
  }

  function addWidget(widgetType: string): void {
    const target = insertTargetOf(state, page);

    if (!target) {
      return;
    }

    dispatch({ type: "add-widget", containerId: target.containerId, widgetType, index: target.index });
  }

  return (
    <div className="tb-panel">
      <div className="tb-panel__head">
        <span className="tb-panel__title">Add to page</span>
      </div>

      <input
        className="tb-input tb-input--search"
        placeholder="Search widgets…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />

      <div className="tb-group">
        <div className="tb-group__title">Section layouts</div>
        <div className="tb-group__hint">Drag between sections, or click to append.</div>
        <div className="tb-layouts">
          {LAYOUT_ORDER.map((id) => (
            <button
              key={id}
              type="button"
              className="tb-layouts__item"
              draggable
              onDragStart={(event) => onSectionDragStart(event, id)}
              onDragEnd={endDrag}
              onClick={() => dispatch({ type: "add-section", layout: id, index: page.sections.length })}
              title={LAYOUTS[id].label}
            >
              <span className="tb-layouts__preview">
                {LAYOUTS[id].columns.map((weight, index) => (
                  <span key={index} style={{ flexGrow: weight }} />
                ))}
              </span>
              <span className="tb-layouts__label">{LAYOUTS[id].label}</span>
            </button>
          ))}
        </div>
      </div>

      {WIDGET_CATEGORIES.map((category) => {
        const items = visible.filter((definition) => definition.category === category.id);

        if (items.length === 0) {
          return null;
        }

        return (
          <div key={category.id} className="tb-group">
            <div className="tb-group__title">{category.label}</div>
            <div className="tb-group__hint">{category.hint}</div>
            <div className="tb-widgets">
              {items.map((definition) => (
                <button
                  key={definition.type}
                  type="button"
                  className="tb-widgets__item"
                  draggable
                  onDragStart={(event) => onWidgetDragStart(event, definition.type)}
                  onDragEnd={endDrag}
                  onClick={() => addWidget(definition.type)}
                  title={definition.description}
                >
                  <span className="tb-widgets__glyph">{definition.glyph}</span>
                  <span className="tb-widgets__text">
                    <span className="tb-widgets__name">{definition.name}</span>
                    <span className="tb-widgets__desc">{definition.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {visible.length === 0 ? <p className="tb-panel__note">No widget matches “{query}”.</p> : null}
    </div>
  );
}

export { AddPanel };
