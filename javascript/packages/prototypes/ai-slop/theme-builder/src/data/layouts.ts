import type { SectionLayoutId, SectionStyle } from "../types";

interface LayoutDefinition {
  id: SectionLayoutId;
  label: string;
  /** Flex weight of every container the layout owns. Length = container count. */
  columns: number[];
}

const LAYOUTS: Record<SectionLayoutId, LayoutDefinition> = {
  single: {
    id: "single",
    label: "Full width",
    columns: [1],
  },
  halves: {
    id: "halves",
    label: "Two columns",
    columns: [1, 1],
  },
  thirds: {
    id: "thirds",
    label: "Three columns",
    columns: [1, 1, 1],
  },
  quarters: {
    id: "quarters",
    label: "Four columns",
    columns: [1, 1, 1, 1],
  },
  "sidebar-left": {
    id: "sidebar-left",
    label: "Sidebar left",
    columns: [1, 2.4],
  },
  "sidebar-right": {
    id: "sidebar-right",
    label: "Sidebar right",
    columns: [2.4, 1],
  },
};

const LAYOUT_ORDER: SectionLayoutId[] = [
  "single",
  "halves",
  "thirds",
  "quarters",
  "sidebar-left",
  "sidebar-right",
];

const DEFAULT_SECTION_STYLE: SectionStyle = {
  background: "base",
  paddingY: 32,
  gap: 16,
  maxWidth: 1200,
};

function layoutOf(id: SectionLayoutId): LayoutDefinition {
  return LAYOUTS[id] ?? LAYOUTS.single;
}

function containerCount(id: SectionLayoutId): number {
  return layoutOf(id).columns.length;
}

function gridTemplate(id: SectionLayoutId): string {
  return layoutOf(id)
    .columns.map((weight) => `${weight}fr`)
    .join(" ");
}

export type { LayoutDefinition };
export { containerCount, DEFAULT_SECTION_STYLE, gridTemplate, LAYOUT_ORDER, LAYOUTS, layoutOf };
