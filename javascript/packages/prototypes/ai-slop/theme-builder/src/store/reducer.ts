import { DEFAULT_SECTION_STYLE } from "../data/layouts";
import { createSeedSite } from "../data/seed";
import { createWidget, definitionOf } from "../data/widget-registry";
import { createId } from "../ids";
import type { EditorState, SiteDoc } from "../types";
import type { EditorAction } from "./actions";
import { DOC_ACTIONS } from "./actions";
import {
  clonePage,
  cloneSection,
  cloneWidget,
  emptySection,
  findWidget,
  hasNode,
  insertWidget,
  mapPages,
  mapSection,
  mapWidget,
  moveItem,
  pageOfSection,
  relayoutSection,
  removeWidget,
} from "./doc-utils";

const HISTORY_LIMIT = 60;

function createInitialState(doc?: SiteDoc): EditorState {
  const site = doc ?? createSeedSite();

  return {
    doc: site,
    activePageId: site.pages[0].id,
    selection: null,
    breakpoint: "desktop",
    preview: false,
    leftTab: "pages",
    past: [],
    future: [],
    coalesceKey: null,
  };
}

/**
 * Edits that arrive in a stream — a dragged slider, a typed field — share one
 * signature so they collapse into a single undo step.
 */
function coalesceKeyOf(action: EditorAction): string | null {
  switch (action.type) {
    case "rename-site": {
      return "site-name";
    }

    case "update-page": {
      return `page:${action.pageId}:${Object.keys(action.patch).join(",")}`;
    }

    case "update-section": {
      const keys = [...Object.keys(action.patch.style ?? {}), ...(action.patch.name === undefined ? [] : ["name"])];

      return `section:${action.sectionId}:${keys.join(",")}`;
    }

    case "update-widget-prop": {
      return `widget:${action.widgetId}:${action.key}`;
    }

    case "update-theme": {
      return `theme:${Object.keys(action.patch).join(",")}`;
    }

    default: {
      return null;
    }
  }
}

/** Drops a selection or active page that the last edit removed. */
function prune(state: EditorState): EditorState {
  const activePageId = state.doc.pages.some((page) => page.id === state.activePageId)
    ? state.activePageId
    : state.doc.pages[0].id;
  const selection =
    state.selection && hasNode(state.doc, state.selection.kind, state.selection.id) ? state.selection : null;

  if (activePageId === state.activePageId && selection === state.selection) {
    return state;
  }

  return { ...state, activePageId, selection };
}

function apply(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "select": {
      return { ...state, selection: action.selection };
    }

    case "set-breakpoint": {
      return { ...state, breakpoint: action.breakpoint };
    }

    case "set-preview": {
      return { ...state, preview: action.preview, selection: action.preview ? null : state.selection };
    }

    case "set-left-tab": {
      return { ...state, leftTab: action.tab };
    }

    case "set-active-page": {
      return { ...state, activePageId: action.pageId, selection: { kind: "page", id: action.pageId } };
    }

    case "rename-site": {
      return { ...state, doc: { ...state.doc, name: action.name } };
    }

    case "add-page": {
      const index = state.doc.pages.length + 1;
      const page = {
        id: createId("p"),
        name: `Page ${index}`,
        path: `/page-${index}`,
        sections: [emptySection("single", DEFAULT_SECTION_STYLE, "Section 1")],
      };

      return {
        ...state,
        doc: { ...state.doc, pages: [...state.doc.pages, page] },
        activePageId: page.id,
        selection: { kind: "page", id: page.id },
      };
    }

    case "update-page": {
      return {
        ...state,
        doc: mapPages(state.doc, (page) => (page.id === action.pageId ? { ...page, ...action.patch } : page)),
      };
    }

    case "duplicate-page": {
      const source = state.doc.pages.find((page) => page.id === action.pageId);

      if (!source) {
        return state;
      }

      const copy = clonePage(source);
      const pages = [...state.doc.pages];

      pages.splice(state.doc.pages.indexOf(source) + 1, 0, copy);

      return {
        ...state,
        doc: { ...state.doc, pages },
        activePageId: copy.id,
        selection: { kind: "page", id: copy.id },
      };
    }

    case "delete-page": {
      if (state.doc.pages.length <= 1) {
        return state;
      }

      return {
        ...state,
        doc: { ...state.doc, pages: state.doc.pages.filter((page) => page.id !== action.pageId) },
      };
    }

    case "move-page": {
      const index = state.doc.pages.findIndex((page) => page.id === action.pageId);

      if (index < 0) {
        return state;
      }

      return { ...state, doc: { ...state.doc, pages: moveItem(state.doc.pages, index, index + action.offset) } };
    }

    case "add-section": {
      const section = emptySection("single", DEFAULT_SECTION_STYLE, "New section");
      const withLayout = relayoutSection(section, action.layout);

      return {
        ...state,
        doc: mapPages(state.doc, (page) => {
          if (page.id !== state.activePageId) {
            return page;
          }

          const sections = [...page.sections];
          const at = Math.max(0, Math.min(action.index, sections.length));

          sections.splice(at, 0, withLayout);

          return { ...page, sections };
        }),
        selection: { kind: "section", id: withLayout.id },
      };
    }

    case "update-section": {
      return {
        ...state,
        doc: mapSection(state.doc, action.sectionId, (section) => ({
          ...section,
          name: action.patch.name ?? section.name,
          style: { ...section.style, ...action.patch.style },
        })),
      };
    }

    case "set-section-layout": {
      return {
        ...state,
        doc: mapSection(state.doc, action.sectionId, (section) => relayoutSection(section, action.layout)),
      };
    }

    case "duplicate-section": {
      const page = pageOfSection(state.doc, action.sectionId);

      if (!page) {
        return state;
      }

      const index = page.sections.findIndex((section) => section.id === action.sectionId);
      const copy = cloneSection(page.sections[index]);
      const sections = [...page.sections];

      sections.splice(index + 1, 0, copy);

      return {
        ...state,
        doc: mapPages(state.doc, (item) => (item.id === page.id ? { ...item, sections } : item)),
        selection: { kind: "section", id: copy.id },
      };
    }

    case "delete-section": {
      return {
        ...state,
        doc: mapPages(state.doc, (page) => ({
          ...page,
          sections: page.sections.filter((section) => section.id !== action.sectionId),
        })),
      };
    }

    case "move-section": {
      const page = pageOfSection(state.doc, action.sectionId);

      if (!page) {
        return state;
      }

      const index = page.sections.findIndex((section) => section.id === action.sectionId);

      return {
        ...state,
        doc: mapPages(state.doc, (item) =>
          item.id === page.id ? { ...item, sections: moveItem(item.sections, index, index + action.offset) } : item,
        ),
      };
    }

    case "add-widget": {
      const widget = createWidget(action.widgetType);

      return {
        ...state,
        doc: insertWidget(state.doc, action.containerId, widget, action.index),
        selection: { kind: "widget", id: widget.id },
      };
    }

    case "move-widget": {
      const location = findWidget(state.doc, action.widgetId);

      if (!location) {
        return state;
      }

      const sameContainer = location.containerId === action.containerId;
      const index = sameContainer && location.index < action.index ? action.index - 1 : action.index;

      if (sameContainer && index === location.index) {
        return state;
      }

      const without = removeWidget(state.doc, action.widgetId);

      return {
        ...state,
        doc: insertWidget(without, action.containerId, location.widget, index),
        selection: { kind: "widget", id: action.widgetId },
      };
    }

    case "update-widget-prop": {
      return {
        ...state,
        doc: mapWidget(state.doc, action.widgetId, (widget) => ({
          ...widget,
          props: { ...widget.props, [action.key]: action.value },
        })),
      };
    }

    case "reset-widget": {
      return {
        ...state,
        doc: mapWidget(state.doc, action.widgetId, (widget) => ({
          ...widget,
          props: { ...definitionOf(widget.type).defaults },
        })),
      };
    }

    case "duplicate-widget": {
      const location = findWidget(state.doc, action.widgetId);

      if (!location) {
        return state;
      }

      const copy = cloneWidget(location.widget);

      return {
        ...state,
        doc: insertWidget(state.doc, location.containerId, copy, location.index + 1),
        selection: { kind: "widget", id: copy.id },
      };
    }

    case "delete-widget": {
      return { ...state, doc: removeWidget(state.doc, action.widgetId) };
    }

    case "update-theme": {
      return { ...state, doc: { ...state.doc, theme: { ...state.doc.theme, ...action.patch } } };
    }

    case "load-doc": {
      return {
        ...state,
        doc: action.doc,
        activePageId: action.doc.pages[0].id,
        selection: null,
      };
    }

    case "reset-site": {
      const doc = createSeedSite();

      return { ...state, doc, activePageId: doc.pages[0].id, selection: null };
    }

    case "undo":
    case "redo": {
      return state;
    }

    default: {
      return state;
    }
  }
}

function editorReducer(state: EditorState, action: EditorAction): EditorState {
  if (action.type === "undo") {
    if (state.past.length === 0) {
      return state;
    }

    const past = [...state.past];
    const doc = past.pop() as SiteDoc;

    return prune({ ...state, doc, past, future: [state.doc, ...state.future], coalesceKey: null });
  }

  if (action.type === "redo") {
    if (state.future.length === 0) {
      return state;
    }

    const [doc, ...future] = state.future;

    return prune({ ...state, doc, past: [...state.past, state.doc], future, coalesceKey: null });
  }

  const next = apply(state, action);

  if (!DOC_ACTIONS.has(action.type) || next.doc === state.doc) {
    return next;
  }

  const coalesceKey = coalesceKeyOf(action);

  if (coalesceKey !== null && coalesceKey === state.coalesceKey) {
    return prune({ ...next, future: [], coalesceKey });
  }

  return prune({
    ...next,
    past: [...state.past, state.doc].slice(-HISTORY_LIMIT),
    future: [],
    coalesceKey,
  });
}

export { createInitialState, editorReducer };
