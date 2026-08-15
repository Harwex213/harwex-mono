import { useSyncExternalStore } from "react";

interface NewWidgetDrag {
  kind: "new-widget";
  widgetType: string;
}

interface MoveWidgetDrag {
  kind: "move-widget";
  widgetId: string;
  containerId: string;
}

interface NewSectionDrag {
  kind: "new-section";
  layout: string;
}

type DragPayload = NewWidgetDrag | MoveWidgetDrag | NewSectionDrag;

/**
 * `dataTransfer` is unreadable during `dragover`, and drop targets need to know
 * what is being dragged to decide whether they can accept it. The payload lives
 * here for the length of the gesture instead.
 */
let payload: DragPayload | null = null;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function beginDrag(next: DragPayload): void {
  payload = next;
  emit();
}

function endDrag(): void {
  if (payload === null) {
    return;
  }

  payload = null;
  emit();
}

function getDrag(): DragPayload | null {
  return payload;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function useDrag(): DragPayload | null {
  return useSyncExternalStore(subscribe, getDrag, getDrag);
}

export type { DragPayload, MoveWidgetDrag, NewSectionDrag, NewWidgetDrag };
export { beginDrag, endDrag, getDrag, useDrag };
