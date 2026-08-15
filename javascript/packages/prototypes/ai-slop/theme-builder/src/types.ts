import type { ReactNode } from "react";

/** Value a widget prop can hold. Kept flat so the document stays JSON-safe. */
type PropValue = string | number | boolean;

type WidgetProps = Record<string, PropValue>;

type PropFieldType = "text" | "textarea" | "number" | "range" | "boolean" | "select" | "color";

interface PropOption {
  value: string;
  label: string;
}

interface PropField {
  key: string;
  label: string;
  type: PropFieldType;
  options?: PropOption[];
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}

type WidgetCategoryId = "structure" | "betting" | "live" | "promo" | "account";

interface WidgetCategory {
  id: WidgetCategoryId;
  label: string;
  hint: string;
}

interface WidgetDefinition {
  type: string;
  name: string;
  category: WidgetCategoryId;
  glyph: string;
  description: string;
  fields: PropField[];
  defaults: WidgetProps;
  render: (props: WidgetProps) => ReactNode;
}

interface WidgetNode {
  id: string;
  type: string;
  props: WidgetProps;
}

/** A slot inside a section. Widgets live here and nowhere else. */
interface ContainerNode {
  id: string;
  widgets: WidgetNode[];
}

type SectionLayoutId =
  | "single"
  | "halves"
  | "thirds"
  | "quarters"
  | "sidebar-left"
  | "sidebar-right";

type SectionBackground = "base" | "surface" | "brand" | "dark" | "transparent";

interface SectionStyle {
  background: SectionBackground;
  paddingY: number;
  gap: number;
  maxWidth: number;
}

interface SectionNode {
  id: string;
  name: string;
  layout: SectionLayoutId;
  style: SectionStyle;
  containers: ContainerNode[];
}

interface PageNode {
  id: string;
  name: string;
  path: string;
  sections: SectionNode[];
}

interface ThemeTokens {
  brand: string;
  accent: string;
  base: string;
  surface: string;
  text: string;
  muted: string;
  radius: number;
  density: number;
  fontFamily: string;
}

/** Everything that gets exported, imported and undone. */
interface SiteDoc {
  name: string;
  theme: ThemeTokens;
  pages: PageNode[];
}

type BreakpointId = "desktop" | "tablet" | "mobile";

type SelectionKind = "page" | "section" | "container" | "widget";

interface Selection {
  kind: SelectionKind;
  id: string;
}

type LeftTabId = "pages" | "add" | "layers" | "theme";

interface EditorState {
  doc: SiteDoc;
  activePageId: string;
  selection: Selection | null;
  breakpoint: BreakpointId;
  preview: boolean;
  leftTab: LeftTabId;
  past: SiteDoc[];
  future: SiteDoc[];
  /**
   * Signature of the edit on top of the history stack. A slider drag or a typed
   * caption repeats the same signature, and those repeats extend the entry on
   * top instead of pushing one undo step per keystroke.
   */
  coalesceKey: string | null;
}

export type {
  BreakpointId,
  ContainerNode,
  EditorState,
  LeftTabId,
  PageNode,
  PropField,
  PropFieldType,
  PropOption,
  PropValue,
  SectionBackground,
  SectionLayoutId,
  SectionNode,
  SectionStyle,
  Selection,
  SelectionKind,
  SiteDoc,
  ThemeTokens,
  WidgetCategory,
  WidgetCategoryId,
  WidgetDefinition,
  WidgetNode,
  WidgetProps,
};
