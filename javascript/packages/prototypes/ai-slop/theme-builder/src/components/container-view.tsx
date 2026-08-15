import { useRef, useState } from "react";
import type { DragEvent, MouseEvent, ReactNode } from "react";
import { endDrag, getDrag } from "../dnd/drag-state";
import { useEditor } from "../store/editor-context";
import type { ContainerNode } from "../types";
import { WidgetView } from "./widget-view";

interface ContainerViewProps {
  container: ContainerNode;
  position: number;
}

/** Insertion index = the first widget whose middle sits below the pointer. */
function indexAt(list: HTMLElement, clientY: number): number {
  const slots = Array.from(list.querySelectorAll<HTMLElement>("[data-widget-slot]"));

  for (let index = 0; index < slots.length; index += 1) {
    const rect = slots[index].getBoundingClientRect();

    if (clientY < rect.top + rect.height / 2) {
      return index;
    }
  }

  return slots.length;
}

function ContainerView({ container, position }: ContainerViewProps): ReactNode {
  const { state, dispatch } = useEditor();
  const listRef = useRef<HTMLDivElement>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const selected = state.selection?.kind === "container" && state.selection.id === container.id;

  function onDragOver(event: DragEvent<HTMLDivElement>): void {
    const drag = getDrag();

    if (drag?.kind !== "new-widget" && drag?.kind !== "move-widget") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = drag.kind === "new-widget" ? "copy" : "move";

    if (listRef.current) {
      setDropIndex(indexAt(listRef.current, event.clientY));
    }
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>): void {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }

    setDropIndex(null);
  }

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    const drag = getDrag();
    // Read the pointer again instead of trusting `dropIndex`: a drop can land in
    // the same frame as the first `dragover`, before that state has committed.
    const index = listRef.current ? indexAt(listRef.current, event.clientY) : container.widgets.length;

    setDropIndex(null);

    if (!drag) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (drag.kind === "new-widget") {
      dispatch({ type: "add-widget", containerId: container.id, widgetType: drag.widgetType, index });
    }

    if (drag.kind === "move-widget") {
      dispatch({ type: "move-widget", widgetId: drag.widgetId, containerId: container.id, index });
    }

    endDrag();
  }

  function onSelect(event: MouseEvent<HTMLDivElement>): void {
    event.stopPropagation();
    dispatch({ type: "select", selection: { kind: "container", id: container.id } });
  }

  const classes = ["tb-container"];

  if (selected) {
    classes.push("is-selected");
  }

  if (dropIndex !== null) {
    classes.push("is-dropping");
  }

  if (state.preview) {
    classes.push("is-preview");
  }

  const slots: ReactNode[] = [];

  container.widgets.forEach((widget, index) => {
    if (dropIndex === index) {
      slots.push(<span key={`line-${index}`} className="tb-dropline" />);
    }

    slots.push(<WidgetView key={widget.id} widget={widget} containerId={container.id} />);
  });

  if (dropIndex === container.widgets.length) {
    slots.push(<span key="line-end" className="tb-dropline" />);
  }

  return (
    <div
      ref={listRef}
      className={classes.join(" ")}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={state.preview ? undefined : onSelect}
    >
      {state.preview ? null : <span className="tb-container__tag">Container {position + 1}</span>}
      {slots}
      {container.widgets.length === 0 && !state.preview ? (
        <div className="tb-container__empty">Drop a widget here</div>
      ) : null}
    </div>
  );
}

export { ContainerView };
