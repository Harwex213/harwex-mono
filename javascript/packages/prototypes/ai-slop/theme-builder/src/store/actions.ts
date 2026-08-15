import type {
  BreakpointId,
  LeftTabId,
  PropValue,
  SectionLayoutId,
  SectionStyle,
  Selection,
  SiteDoc,
  ThemeTokens,
} from "../types";

type EditorAction =
  | { type: "select"; selection: Selection | null }
  | { type: "set-breakpoint"; breakpoint: BreakpointId }
  | { type: "set-preview"; preview: boolean }
  | { type: "set-left-tab"; tab: LeftTabId }
  | { type: "set-active-page"; pageId: string }
  | { type: "rename-site"; name: string }
  | { type: "add-page" }
  | { type: "update-page"; pageId: string; patch: { name?: string; path?: string } }
  | { type: "duplicate-page"; pageId: string }
  | { type: "delete-page"; pageId: string }
  | { type: "move-page"; pageId: string; offset: number }
  | { type: "add-section"; layout: SectionLayoutId; index: number }
  | { type: "update-section"; sectionId: string; patch: { name?: string; style?: Partial<SectionStyle> } }
  | { type: "set-section-layout"; sectionId: string; layout: SectionLayoutId }
  | { type: "duplicate-section"; sectionId: string }
  | { type: "delete-section"; sectionId: string }
  | { type: "move-section"; sectionId: string; offset: number }
  | { type: "add-widget"; containerId: string; widgetType: string; index: number }
  | { type: "move-widget"; widgetId: string; containerId: string; index: number }
  | { type: "update-widget-prop"; widgetId: string; key: string; value: PropValue }
  | { type: "reset-widget"; widgetId: string }
  | { type: "duplicate-widget"; widgetId: string }
  | { type: "delete-widget"; widgetId: string }
  | { type: "update-theme"; patch: Partial<ThemeTokens> }
  | { type: "load-doc"; doc: SiteDoc }
  | { type: "reset-site" }
  | { type: "undo" }
  | { type: "redo" };

/** Actions that change the document. Everything else is editor chrome and skips history. */
const DOC_ACTIONS: ReadonlySet<EditorAction["type"]> = new Set([
  "rename-site",
  "add-page",
  "update-page",
  "duplicate-page",
  "delete-page",
  "move-page",
  "add-section",
  "update-section",
  "set-section-layout",
  "duplicate-section",
  "delete-section",
  "move-section",
  "add-widget",
  "move-widget",
  "update-widget-prop",
  "reset-widget",
  "duplicate-widget",
  "delete-widget",
  "update-theme",
  "load-doc",
  "reset-site",
]);

export type { EditorAction };
export { DOC_ACTIONS };
