import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseScene } from "./scene.js";
import type { ExcalidrawElement, ExcalidrawScene } from "./scene.js";
import type { ImageFormat, SceneInput } from "./renderer.js";

type MarkdownOptions = {
  /* Title placed above the articles. Without it the articles start at `#`. */
  title?: string;
  /* Directory the markdown will live in. Image links are relative to it. */
  markdownDir?: string;
  /* Where pictures are written. Default: `<markdownDir>/images`. */
  imageDir?: string;
  /* Picture format. Default: svg. */
  imageFormat?: ImageFormat;
  /* Stem used for a picture whose block carries no text. Default: "diagram". */
  namePrefix?: string;
  /* Names already taken, so a batch of scenes cannot overwrite each other. */
  reservedNames?: Set<string>;
};

type MarkdownImage = {
  /* File stem, without the extension. */
  name: string;
  /* Absolute path the picture must be written to. */
  file: string;
  /* Path used inside the markdown, relative to `markdownDir`. */
  link: string;
  alt: string;
  /* The block and everything drawn inside it, ready for a renderer. */
  scene: ExcalidrawScene;
};

type MarkdownResult = {
  markdown: string;
  images: MarkdownImage[];
};

type Box = {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  area: number;
};

type BlockKind = "article" | "image";

type Block = {
  id: string;
  element: ExcalidrawElement;
  box: Box;
  rows: string[];
  kind: BlockKind;
};

type Point = {
  x: number;
  y: number;
};

const BLOCK_TYPES = new Set([
  "rectangle",
  "diamond",
  "ellipse",
  "image",
  "embeddable",
  "iframe",
  "frame",
  "magicframe",
]);

const NESTING_TOLERANCE = 4;
const NESTING_OVERLAP = 0.7;
const ENDPOINT_SEARCH_RADIUS = 48;
const ROW_HEIGHT = 16;
const MAX_HEADING_LEVEL = 6;
const MAX_NAME_LENGTH = 40;

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

/* How much of the smaller block lies under the bigger one. */
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

/* A frame only groups the canvas, so it nests nothing. */
function nests(outer: ExcalidrawElement, inner: ExcalidrawElement): boolean {
  if (isFrame(outer) || isFrame(inner)) {
    return false;
  }
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

/* Labels bound to a block, top to bottom. */
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

function rowsOf(element: ExcalidrawElement, texts: Map<string, ExcalidrawElement[]>): string[] {
  if (element.type === "text") {
    return normalizeRows(stringOf(element.originalText) || stringOf(element.text));
  }
  const rows: string[] = [];
  for (const label of texts.get(element.id) ?? []) {
    rows.push(...normalizeRows(stringOf(label.originalText) || stringOf(label.text)));
  }
  return rows;
}

/*
 * Nesting draws a layout, not prose. The block that holds other blocks becomes a
 * picture of itself, and every block it holds goes into that picture instead of
 * into the text. Text does not save a held block from this.
 */
function collectBlocks(
  elements: ExcalidrawElement[],
  texts: Map<string, ExcalidrawElement[]>,
): { blocks: Block[]; swallowedBy: Map<string, Block> } {
  const candidates = elements.filter((element) => {
    const isFreeText = element.type === "text" && stringOf(element.containerId) === "";
    return (BLOCK_TYPES.has(element.type) && !isFrame(element)) || isFreeText;
  });

  /* The outermost holder wins: a layout nested in a layout is one picture. */
  const holderOf = new Map<string, ExcalidrawElement>();
  for (const element of candidates) {
    let holder: ExcalidrawElement | null = null;
    for (const other of candidates) {
      if (other === element || !nests(other, element)) {
        continue;
      }
      if (!holder || boxOf(other).area > boxOf(holder).area) {
        holder = other;
      }
    }
    if (holder) {
      holderOf.set(element.id, holder);
    }
  }

  const blocks: Block[] = [];
  for (const element of candidates) {
    if (holderOf.has(element.id)) {
      continue;
    }
    const holdsBlocks = candidates.some((other) => {
      return holderOf.get(other.id) === element;
    });
    const rows = rowsOf(element, texts);
    if (holdsBlocks) {
      blocks.push({ id: element.id, element, box: boxOf(element), rows, kind: "image" });
      continue;
    }
    if (rows.length > 0) {
      blocks.push({ id: element.id, element, box: boxOf(element), rows, kind: "article" });
    }
  }

  /*
   * An arrow drawn to a swallowed block still means something: it points at the
   * picture that block now lives in.
   */
  const byId = new Map(blocks.map((block) => {
    return [block.id, block];
  }));
  const swallowedBy = new Map<string, Block>();
  for (const element of candidates) {
    let holder = holderOf.get(element.id);
    while (holder && holderOf.has(holder.id)) {
      holder = holderOf.get(holder.id);
    }
    const block = holder ? byId.get(holder.id) : undefined;
    if (block) {
      swallowedBy.set(element.id, block);
    }
  }

  return { blocks, swallowedBy };
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

function blockAtPoint(blocks: Block[], point: Point): Block | null {
  let nearest: Block | null = null;
  let nearestDistance = ENDPOINT_SEARCH_RADIUS;
  for (const block of blocks) {
    const distance = distanceToBox(block.box, point);
    if (distance > nearestDistance) {
      continue;
    }
    nearest = block;
    nearestDistance = distance;
  }
  return nearest;
}

/* An arrow reads as "the block it leaves comes before the block it enters". */
function collectDirections(
  elements: ExcalidrawElement[],
  blocks: Block[],
  swallowedBy: Map<string, Block>,
): { from: Block; to: Block }[] {
  const byId = new Map(blocks.map((block) => {
    return [block.id, block];
  }));
  const blockFor = (id: string | undefined): Block | null => {
    if (id === undefined) {
      return null;
    }
    return byId.get(id) ?? swallowedBy.get(id) ?? null;
  };

  const directions: { from: Block; to: Block }[] = [];
  for (const element of elements) {
    if (element.type !== "arrow") {
      continue;
    }
    const endpoints = arrowEndpoints(element);
    const startId = boundElementId(element.startBinding);
    const endId = boundElementId(element.endBinding);
    const from = element.startBinding
      ? blockFor(startId)
      : (endpoints && blockAtPoint(blocks, endpoints.start));
    const to = element.endBinding
      ? blockFor(endId)
      : (endpoints && blockAtPoint(blocks, endpoints.end));
    if (!from || !to || from === to) {
      continue;
    }
    const pointsBack = Boolean(element.startArrowhead) && !element.endArrowhead;
    directions.push(pointsBack ? { from: to, to: from } : { from, to });
  }
  return directions;
}

/*
 * Blocks drawn side by side never share an exact y, so the row is rounded off
 * before the comparison. Otherwise a fraction of a pixel decides the order.
 */
function readingOrder(a: Block, b: Block): number {
  const rowA = Math.round(a.box.y1 / ROW_HEIGHT);
  const rowB = Math.round(b.box.y1 / ROW_HEIGHT);
  return rowA - rowB || a.box.x1 - b.box.x1;
}

/*
 * Arrows set the order. A block waits until every block pointing at it is
 * written, so each chain of arrows stays together. Position breaks the ties.
 */
function orderBlocks(blocks: Block[], directions: { from: Block; to: Block }[]): Block[] {
  const next = new Map<string, Block[]>(blocks.map((block) => {
    return [block.id, []];
  }));
  const waitingFor = new Map<string, number>(blocks.map((block) => {
    return [block.id, 0];
  }));
  for (const direction of directions) {
    next.get(direction.from.id)?.push(direction.to);
    waitingFor.set(direction.to.id, (waitingFor.get(direction.to.id) ?? 0) + 1);
  }
  for (const followers of next.values()) {
    followers.sort(readingOrder);
  }

  const written = new Set<string>();
  const ordered: Block[] = [];
  const isReady = (block: Block): boolean => {
    return !written.has(block.id) && waitingFor.get(block.id) === 0;
  };
  const write = (block: Block): void => {
    written.add(block.id);
    ordered.push(block);
    for (const child of next.get(block.id) ?? []) {
      waitingFor.set(child.id, (waitingFor.get(child.id) ?? 0) - 1);
      if (isReady(child)) {
        write(child);
      }
    }
  };

  const queue = [...blocks].sort(readingOrder);
  for (const block of queue) {
    if (isReady(block)) {
      write(block);
    }
  }
  /* Blocks left over sit in a loop of arrows: fall back to position. */
  for (const block of queue) {
    if (!written.has(block.id)) {
      write(block);
    }
  }
  return ordered;
}

function slugify(text: string, fallback: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_NAME_LENGTH)
    .replace(/-+$/g, "");
  return slug === "" ? fallback : slug;
}

/*
 * The picture holds the block and everything drawn inside it: nested blocks,
 * their labels, and the arrows between them. An arrow that only crosses the
 * border stays outside, because most of it lies outside.
 */
function sceneForImage(block: Block, scene: ExcalidrawScene): ExcalidrawScene {
  const inside = scene.elements.filter((element) => {
    if (element.id === block.id || isFrame(element)) {
      return false;
    }
    const containerId = stringOf(element.containerId);
    if (containerId !== "") {
      return containerId === block.id || nests(block.element, element);
    }
    return nests(block.element, element);
  });

  const parts = [block.element, ...inside];
  const ids = new Set(parts.map((element) => {
    return element.id;
  }));
  const keepBinding = (binding: unknown): unknown => {
    const id = boundElementId(binding);
    return id !== undefined && ids.has(id) ? binding : null;
  };

  const elements = parts.map((element) => {
    const copy: ExcalidrawElement = { ...element, frameId: null };
    if (Array.isArray(element.boundElements)) {
      copy.boundElements = (element.boundElements as unknown[]).filter((bound) => {
        if (bound === null || typeof bound !== "object") {
          return false;
        }
        const id = (bound as Record<string, unknown>).id;
        return typeof id === "string" && ids.has(id);
      });
    }
    if (element.startBinding || element.endBinding) {
      copy.startBinding = keepBinding(element.startBinding);
      copy.endBinding = keepBinding(element.endBinding);
    }
    return copy;
  });

  return { elements, appState: { ...scene.appState }, files: scene.files };
}

function headingFor(level: number, title: string, link: string): string {
  const hashes = "#".repeat(Math.min(level, MAX_HEADING_LEVEL));
  return `${hashes} ${link === "" ? title : `[${title}](${link})`}`;
}

/* One row is a plain article. Several rows turn the first one into the title. */
function renderArticle(block: Block, level: number): string[] {
  const [first = "", ...rest] = block.rows;
  const link = stringOf(block.element.link);
  const body = normalizeRows(rest.join("\n"));
  if (body.length === 0) {
    return [link === "" ? first : `[${first}](${link})`];
  }
  return [headingFor(level, first.trim(), link), "", ...body];
}

function renderImage(block: Block, level: number, image: MarkdownImage): string[] {
  const picture = `![${image.alt}](${image.link})`;
  const [first = "", ...rest] = block.rows;
  if (block.rows.length === 0) {
    return [picture];
  }
  const body = normalizeRows(rest.join("\n"));
  const head = [headingFor(level, first.trim(), stringOf(block.element.link)), "", picture];
  return body.length === 0 ? head : [...head, "", ...body];
}

type ImageSettings = {
  markdownDir: string;
  imageDir: string;
  imageFormat: ImageFormat;
  namePrefix: string;
};

function imageFor(block: Block, index: number, settings: ImageSettings, taken: Set<string>): Omit<MarkdownImage, "scene"> {
  const fallback = `${settings.namePrefix}-${index + 1}`;
  const title = block.rows[0]?.trim() ?? "";
  const stem = slugify(title, fallback);
  let name = stem;
  let attempt = 2;
  while (taken.has(name)) {
    name = `${stem}-${attempt}`;
    attempt += 1;
  }
  taken.add(name);
  const file = join(settings.imageDir, `${name}.${settings.imageFormat}`);
  return {
    name,
    file,
    link: relative(settings.markdownDir, file).split(sep).join("/"),
    alt: title === "" ? fallback.replace(/-/g, " ") : title,
  };
}

/*
 * Turns a scene into markdown. Pictures are described, not drawn: every entry in
 * `images` carries the scene it needs, and a renderer writes it to `file`.
 */
function sceneToMarkdown(input: SceneInput, options: MarkdownOptions = {}): MarkdownResult {
  const scene = parseScene(input);
  const title = options.title ?? "";
  const markdownDir = resolve(options.markdownDir ?? ".");
  const imageDir = options.imageDir
    ? (isAbsolute(options.imageDir) ? options.imageDir : resolve(markdownDir, options.imageDir))
    : join(markdownDir, "images");
  const settings: ImageSettings = {
    markdownDir,
    imageDir,
    imageFormat: options.imageFormat ?? "svg",
    namePrefix: options.namePrefix ?? "diagram",
  };

  const texts = collectTexts(scene.elements);
  const { blocks, swallowedBy } = collectBlocks(scene.elements, texts);
  const ordered = orderBlocks(blocks, collectDirections(scene.elements, blocks, swallowedBy));
  const level = title === "" ? 1 : 2;
  const taken = options.reservedNames ?? new Set<string>();
  const rows: string[] = [];
  const images: MarkdownImage[] = [];

  if (title !== "") {
    rows.push(`# ${title}`, "");
  }
  for (const block of ordered) {
    if (block.kind === "image") {
      const image = { ...imageFor(block, images.length, settings, taken), scene: sceneForImage(block, scene) };
      images.push(image);
      rows.push(...renderImage(block, level, image), "");
      continue;
    }
    rows.push(...renderArticle(block, level), "");
  }

  return { markdown: `${normalizeRows(rows.join("\n")).join("\n")}\n`, images };
}

export { sceneToMarkdown };
export type { MarkdownImage, MarkdownOptions, MarkdownResult };
