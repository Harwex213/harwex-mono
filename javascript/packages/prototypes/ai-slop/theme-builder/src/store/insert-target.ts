import type { EditorState, PageNode } from "../types";
import { findSection, findWidget } from "./doc-utils";

interface InsertTarget {
  containerId: string;
  index: number;
}

/**
 * Where a click in the Add panel drops a widget: next to the selection when
 * there is one, otherwise at the end of the last section on the page.
 */
function insertTargetOf(state: EditorState, page: PageNode): InsertTarget | null {
  const selection = state.selection;

  if (selection?.kind === "widget") {
    const location = findWidget(state.doc, selection.id);

    if (location) {
      return { containerId: location.containerId, index: location.index + 1 };
    }
  }

  if (selection?.kind === "container") {
    const section = page.sections.find((item) => item.containers.some((container) => container.id === selection.id));
    const container = section?.containers.find((item) => item.id === selection.id);

    if (container) {
      return { containerId: container.id, index: container.widgets.length };
    }
  }

  if (selection?.kind === "section") {
    const section = findSection(state.doc, selection.id);
    const container = section?.containers[0];

    if (container) {
      return { containerId: container.id, index: container.widgets.length };
    }
  }

  const last = page.sections[page.sections.length - 1];
  const fallback = last?.containers[0];

  if (!fallback) {
    return null;
  }

  return { containerId: fallback.id, index: fallback.widgets.length };
}

export type { InsertTarget };
export { insertTargetOf };
