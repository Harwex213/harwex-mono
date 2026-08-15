import type { DragEvent, MouseEvent, ReactNode } from "react";
import { definitionOf, isKnownWidget } from "../data/widget-registry";
import { beginDrag, endDrag } from "../dnd/drag-state";
import { useEditor } from "../store/editor-context";
import type { WidgetNode } from "../types";

interface WidgetViewProps {
  widget: WidgetNode;
  containerId: string;
}

function WidgetView({ widget, containerId }: WidgetViewProps): ReactNode {
  const { state, dispatch } = useEditor();
  const definition = definitionOf(widget.type);
  const selected = state.selection?.kind === "widget" && state.selection.id === widget.id;

  function onSelect(event: MouseEvent<HTMLDivElement>): void {
    event.stopPropagation();
    dispatch({ type: "select", selection: { kind: "widget", id: widget.id } });
  }

  function onDragStart(event: DragEvent<HTMLDivElement>): void {
    event.stopPropagation();
    beginDrag({ kind: "move-widget", widgetId: widget.id, containerId });
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", widget.id);
    dispatch({ type: "select", selection: { kind: "widget", id: widget.id } });
  }

  function tool(event: MouseEvent<HTMLButtonElement>, run: () => void): void {
    event.stopPropagation();
    run();
  }

  const classes = ["tb-widget"];

  if (selected) {
    classes.push("is-selected");
  }

  if (state.preview) {
    classes.push("is-preview");
  }

  return (
    <div
      className={classes.join(" ")}
      data-widget-slot="true"
      draggable={!state.preview}
      onDragStart={onDragStart}
      onDragEnd={endDrag}
      onClick={state.preview ? undefined : onSelect}
    >
      {state.preview ? null : (
        <span className="tb-widget__tag">
          <span className="tb-widget__name">
            <span aria-hidden="true">{definition.glyph}</span> {definition.name}
          </span>
          <span className="tb-widget__tools">
            <button
              type="button"
              className="tb-icon"
              title="Duplicate"
              onClick={(event) => tool(event, () => dispatch({ type: "duplicate-widget", widgetId: widget.id }))}
            >
              ⧉
            </button>
            <button
              type="button"
              className="tb-icon tb-icon--danger"
              title="Delete"
              onClick={(event) => tool(event, () => dispatch({ type: "delete-widget", widgetId: widget.id }))}
            >
              ✕
            </button>
          </span>
        </span>
      )}

      <div className="tb-widget__content">
        {isKnownWidget(widget.type) ? (
          definition.render(widget.props)
        ) : (
          <div className="tb-widget__missing">Unknown widget type “{widget.type}”</div>
        )}
      </div>
    </div>
  );
}

export { WidgetView };
