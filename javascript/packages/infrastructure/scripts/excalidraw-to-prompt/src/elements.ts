import type { ExcalidrawElement } from "@hw/excalidraw-convert";

type Box = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  area: number;
};

type Point = {
  x: number;
  y: number;
};

/* Shapes that carry a label and can hold other shapes. */
const CONTAINER_TYPES = new Set([
  "rectangle",
  "diamond",
  "ellipse",
  "embeddable",
  "iframe",
  "frame",
  "magicframe",
]);

const NESTING_TOLERANCE = 4;
const NESTING_OVERLAP = 0.7;
const ROW_HEIGHT = 16;

function numberOf(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function boundElementId(binding: unknown): string | undefined {
  if (binding === null || typeof binding !== "object") {
    return undefined;
  }
  const id = (binding as Record<string, unknown>).elementId;
  return typeof id === "string" ? id : undefined;
}

function boxOf(element: ExcalidrawElement): Box {
  const x = numberOf(element.x);
  const y = numberOf(element.y);
  const width = numberOf(element.width);
  const height = numberOf(element.height);
  return { x1: x, y1: y, x2: x + width, y2: y + height, area: Math.abs(width * height) };
}

function isFrame(element: ExcalidrawElement): boolean {
  return element.type === "frame" || element.type === "magicframe";
}

function isContainer(element: ExcalidrawElement): boolean {
  return CONTAINER_TYPES.has(element.type);
}

function isFreeText(element: ExcalidrawElement): boolean {
  return element.type === "text" && stringOf(element.containerId) === "";
}

/* A shape drawn with a dashed stroke is a block schema, not a graph node. */
function isDashed(element: ExcalidrawElement): boolean {
  return element.strokeStyle === "dashed";
}

/* How much of the smaller shape lies under the bigger one. */
function overlapRatio(outer: Box, inner: Box): number {
  if (inner.area === 0 || outer.area <= inner.area) {
    return 0;
  }
  const width = Math.min(outer.x2 + NESTING_TOLERANCE, inner.x2) - Math.max(outer.x1 - NESTING_TOLERANCE, inner.x1);
  const height = Math.min(outer.y2 + NESTING_TOLERANCE, inner.y2) - Math.max(outer.y1 - NESTING_TOLERANCE, inner.y1);
  if (width <= 0 || height <= 0) {
    return 0;
  }
  return (width * height) / inner.area;
}

/*
 * Nesting is measured by overlap, not by strict containment: a pane drawn
 * slightly outside its wrapper still counts as held, and two shapes that merely
 * touch do not.
 */
function nests(outer: ExcalidrawElement, inner: ExcalidrawElement): boolean {
  return overlapRatio(boxOf(outer), boxOf(inner)) >= NESTING_OVERLAP;
}

function distanceToBox(box: Box, point: Point): number {
  const dx = Math.max(box.x1 - point.x, 0, point.x - box.x2);
  const dy = Math.max(box.y1 - point.y, 0, point.y - box.y2);
  return Math.hypot(dx, dy);
}

function normalizeRows(text: string): string[] {
  const rows = text.replace(/\r\n/g, "\n").split("\n").map((row) => {
    return row.trimEnd();
  });
  while (rows.length > 0 && rows[0]?.trim() === "") {
    rows.shift();
  }
  while (rows.length > 0 && rows[rows.length - 1]?.trim() === "") {
    rows.pop();
  }
  return rows;
}

/* Labels bound to a shape or to an arrow, top to bottom. */
function collectTexts(elements: ExcalidrawElement[]): Map<string, ExcalidrawElement[]> {
  const texts = new Map<string, ExcalidrawElement[]>();
  for (const element of elements) {
    const containerId = stringOf(element.containerId);
    if (element.type !== "text" || containerId === "") {
      continue;
    }
    const bound = texts.get(containerId) ?? [];
    bound.push(element);
    texts.set(containerId, bound);
  }
  for (const bound of texts.values()) {
    bound.sort((a, b) => {
      return numberOf(a.y) - numberOf(b.y) || numberOf(a.x) - numberOf(b.x);
    });
  }
  return texts;
}

function textOfElement(element: ExcalidrawElement): string {
  return normalizeRows(stringOf(element.originalText) || stringOf(element.text)).join("\n");
}

/*
 * The text a node carries: its own content when it is a text element, the name
 * when it is a frame, and every label bound to it otherwise.
 */
function textOf(element: ExcalidrawElement, texts: Map<string, ExcalidrawElement[]>): string {
  if (element.type === "text") {
    return textOfElement(element);
  }
  const rows: string[] = [];
  for (const label of texts.get(element.id) ?? []) {
    rows.push(...normalizeRows(textOfElement(label)));
  }
  if (rows.length === 0 && isFrame(element)) {
    return normalizeRows(stringOf(element.name)).join("\n");
  }
  return rows.join("\n");
}

function arrowEndpoints(arrow: ExcalidrawElement): { start: Point; end: Point } | null {
  const points = Array.isArray(arrow.points) ? arrow.points as unknown[] : [];
  const first = points[0];
  const last = points[points.length - 1];
  if (!Array.isArray(first) || !Array.isArray(last)) {
    return null;
  }
  const x = numberOf(arrow.x);
  const y = numberOf(arrow.y);
  return {
    start: { x: x + numberOf(first[0]), y: y + numberOf(first[1]) },
    end: { x: x + numberOf(last[0]), y: y + numberOf(last[1]) },
  };
}

/*
 * Shapes drawn side by side never share an exact y, so the row is rounded off
 * before the comparison. Otherwise a fraction of a pixel decides the order.
 */
function readingOrder(a: ExcalidrawElement, b: ExcalidrawElement): number {
  const boxA = boxOf(a);
  const boxB = boxOf(b);
  const rowA = Math.round(boxA.y1 / ROW_HEIGHT);
  const rowB = Math.round(boxB.y1 / ROW_HEIGHT);
  return rowA - rowB || boxA.x1 - boxB.x1;
}

const MAX_NAME_LENGTH = 40;

function slugify(text: string, fallback: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_NAME_LENGTH)
    .replace(/-+$/g, "");
  return slug === "" ? fallback : slug;
}

/* Adds a suffix until the name is free, so nothing overwrites anything. */
function claimName(stem: string, taken: Set<string>): string {
  let name = stem;
  let attempt = 2;
  while (taken.has(name)) {
    name = `${stem}-${attempt}`;
    attempt += 1;
  }
  taken.add(name);
  return name;
}

export {
  arrowEndpoints,
  boundElementId,
  boxOf,
  claimName,
  collectTexts,
  distanceToBox,
  isContainer,
  isDashed,
  isFrame,
  isFreeText,
  nests,
  numberOf,
  readingOrder,
  slugify,
  stringOf,
  textOf,
};
export type { Box, Point };
