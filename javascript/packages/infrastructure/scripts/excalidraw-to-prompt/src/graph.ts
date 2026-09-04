import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseScene } from "@hw/excalidraw-convert";
import type { ExcalidrawElement, ExcalidrawScene, ImageFormat, SceneInput } from "@hw/excalidraw-convert";
import {
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
  readingOrder,
  slugify,
  stringOf,
  textOf,
} from "./elements.js";
import type { Box, Point } from "./elements.js";

type NodeType = "block" | "schema" | "image" | "text" | "frame";

type PromptNode = {
  id: string;
  type: NodeType;
  /* The label the block carries. Absent when the block has none. */
  text?: string;
  /* Picture path, relative to the directory the graph is written in. */
  image?: string;
  /* The element's own hyperlink, when it has one. */
  link?: string;
  /* Blocks drawn inside this one. A schema has none: its picture holds them. */
  children?: PromptNode[];
};

type PromptEdge = {
  from: string;
  to: string;
  /* The arrow's own label, when it has one. */
  text?: string;
};

type PromptGraph = {
  nodes: PromptNode[];
  edges: PromptEdge[];
};

/* A dashed block, and everything drawn inside it, waiting for a renderer. */
type GraphPicture = {
  name: string;
  /* Absolute path the picture must be written to. */
  file: string;
  /* Path used inside the graph, relative to `graphDir`. */
  link: string;
  /* The block and its contents, ready for a renderer. */
  scene: ExcalidrawScene;
};

/* An image the scene carries, decoded and ready to be written as it is. */
type GraphFile = {
  name: string;
  file: string;
  link: string;
  data: Buffer;
};

type PromptGraphOptions = {
  /* Directory the graph will live in. Image links are relative to it. */
  graphDir?: string;
  /* Where pictures and flushed images go. Default: `<graphDir>/images`. */
  imageDir?: string;
  /* Format of the pictures drawn for dashed blocks. Default: svg. */
  imageFormat?: ImageFormat;
  /* Stem used for a picture whose block carries no text. */
  namePrefix?: string;
  /* Names already taken, so a batch of scenes cannot overwrite each other. */
  reservedNames?: Set<string>;
};

type PromptGraphResult = {
  graph: PromptGraph;
  /* Pictures of dashed blocks. Each one costs a render. */
  pictures: GraphPicture[];
  /* Images lifted out of the scene. Each one is only a write. */
  files: GraphFile[];
  /* What the scene asked for and could not give, in plain words. */
  warnings: string[];
};

const ENDPOINT_SEARCH_RADIUS = 48;

const FILE_EXTENSIONS: Record<string, string> = {
  "image/avif": "avif",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

type Settings = {
  graphDir: string;
  imageDir: string;
  imageFormat: ImageFormat;
  namePrefix: string;
};

/* A node candidate: everything that carries text, holds blocks, or is drawn. */
function isCandidate(element: ExcalidrawElement): boolean {
  return isContainer(element) || isFreeText(element) || element.type === "image";
}

/* Dashed marks a block schema. A frame groups the canvas, so it is never one. */
function isSchema(element: ExcalidrawElement): boolean {
  return isContainer(element) && !isFrame(element) && isDashed(element);
}

function typeOf(element: ExcalidrawElement): NodeType {
  if (element.type === "image") {
    return "image";
  }
  if (isFrame(element)) {
    return "frame";
  }
  if (element.type === "text") {
    return "text";
  }
  return isSchema(element) ? "schema" : "block";
}

/*
 * The innermost holder wins, so nesting comes out as the tree it was drawn as.
 * A shape that overlaps nothing falls back to the frame it was assigned to,
 * which is how Excalidraw itself records frame membership.
 */
function collectNesting(candidates: ExcalidrawElement[]): {
  childrenOf: Map<string, ExcalidrawElement[]>;
  roots: ExcalidrawElement[];
} {
  const byId = new Map(candidates.map((element) => {
    return [element.id, element];
  }));
  const holderOf = new Map<string, ExcalidrawElement>();
  for (const element of candidates) {
    let holder: ExcalidrawElement | null = null;
    for (const other of candidates) {
      if (other === element || !nests(other, element)) {
        continue;
      }
      if (!holder || boxOf(other).area < boxOf(holder).area) {
        holder = other;
      }
    }
    if (!holder) {
      const frame = byId.get(stringOf(element.frameId));
      holder = frame && isFrame(frame) ? frame : null;
    }
    if (holder) {
      holderOf.set(element.id, holder);
    }
  }

  const childrenOf = new Map<string, ExcalidrawElement[]>();
  const roots: ExcalidrawElement[] = [];
  for (const element of candidates) {
    const holder = holderOf.get(element.id);
    if (!holder) {
      roots.push(element);
      continue;
    }
    const siblings = childrenOf.get(holder.id) ?? [];
    siblings.push(element);
    childrenOf.set(holder.id, siblings);
  }
  for (const siblings of childrenOf.values()) {
    siblings.sort(readingOrder);
  }
  roots.sort(readingOrder);
  return { childrenOf, roots };
}

/*
 * The picture holds the block and everything drawn inside it: nested blocks,
 * their labels, and the arrows between them. An arrow that only crosses the
 * border stays outside, because most of it lies outside. A frame is dropped,
 * because a frame would crop the picture it appears in.
 */
function sceneForSchema(block: ExcalidrawElement, scene: ExcalidrawScene): ExcalidrawScene {
  const inside = scene.elements.filter((element) => {
    if (element.id === block.id || isFrame(element)) {
      return false;
    }
    const containerId = stringOf(element.containerId);
    if (containerId !== "") {
      return containerId === block.id || nests(block, element);
    }
    return nests(block, element);
  });

  const parts = [block, ...inside];
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

function decodeDataUrl(dataUrl: string): { mimeType: string; data: Buffer } | null {
  const comma = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || comma === -1) {
    return null;
  }
  const meta = dataUrl.slice("data:".length, comma).split(";");
  const body = dataUrl.slice(comma + 1);
  const mimeType = meta[0] ?? "";
  if (meta.includes("base64")) {
    return { mimeType, data: Buffer.from(body, "base64") };
  }
  return { mimeType, data: Buffer.from(decodeURIComponent(body), "utf8") };
}

function extensionFor(mimeType: string): string {
  const known = FILE_EXTENSIONS[mimeType.toLowerCase()];
  if (known) {
    return known;
  }
  const subtype = mimeType.split("/")[1] ?? "";
  return /^[a-z0-9]+$/i.test(subtype) ? subtype.toLowerCase() : "bin";
}

function linkFor(file: string, settings: Settings): string {
  return relative(settings.graphDir, file).split(sep).join("/");
}

/* A name comes from the first row: the rest of the label is prose, not a name. */
function headRow(text: string): string {
  return text.split("\n")[0] ?? "";
}

function stemFor(text: string, fallback: string, settings: Settings): string {
  const prefixed = settings.namePrefix === "" ? fallback : `${settings.namePrefix}-${fallback}`;
  return slugify(headRow(text), prefixed);
}

/*
 * Turns a scene into a node graph: text, nesting and arrows, and nothing else.
 * Nothing is written here. Every dashed block comes back in `pictures` with the
 * sub-scene a renderer needs, and every image the scene carries comes back in
 * `files` as the bytes to write.
 */
function sceneToPromptGraph(input: SceneInput, options: PromptGraphOptions = {}): PromptGraphResult {
  const scene = parseScene(input);
  const graphDir = resolve(options.graphDir ?? ".");
  const imageDir = options.imageDir
    ? (isAbsolute(options.imageDir) ? options.imageDir : resolve(graphDir, options.imageDir))
    : join(graphDir, "images");
  const settings: Settings = {
    graphDir,
    imageDir,
    imageFormat: options.imageFormat ?? "svg",
    namePrefix: options.namePrefix ?? "",
  };

  const texts = collectTexts(scene.elements);
  const candidates = scene.elements.filter(isCandidate);
  const { childrenOf, roots } = collectNesting(candidates);

  const names = options.reservedNames ?? new Set<string>();
  const ids = new Set<string>();
  const pictures: GraphPicture[] = [];
  const files: GraphFile[] = [];
  const filesByFileId = new Map<string, GraphFile>();
  const warnings: string[] = [];
  /*
   * Which node an element speaks for, so an arrow drawn to a label, or to a
   * block a schema swallowed, still lands on a node.
   */
  const nodeOf = new Map<string, string>();

  const own = (element: ExcalidrawElement, id: string): void => {
    nodeOf.set(element.id, id);
    for (const label of texts.get(element.id) ?? []) {
      nodeOf.set(label.id, id);
    }
  };

  const claimSubtree = (element: ExcalidrawElement, id: string): void => {
    own(element, id);
    for (const child of childrenOf.get(element.id) ?? []) {
      claimSubtree(child, id);
    }
  };

  const pictureFor = (element: ExcalidrawElement, text: string): GraphPicture => {
    const name = claimName(stemFor(text, `schema-${pictures.length + 1}`, settings), names);
    const file = join(settings.imageDir, `${name}.${settings.imageFormat}`);
    return { name, file, link: linkFor(file, settings), scene: sceneForSchema(element, scene) };
  };

  const fileFor = (element: ExcalidrawElement, text: string): GraphFile | null => {
    const fileId = stringOf(element.fileId);
    const cached = filesByFileId.get(fileId);
    if (cached) {
      return cached;
    }
    const entry = scene.files[fileId] as Record<string, unknown> | undefined;
    const dataUrl = entry !== null && typeof entry === "object" ? stringOf(entry.dataURL) : "";
    if (dataUrl === "") {
      warnings.push(`image ${element.id} has no file in the scene, so nothing was written for it`);
      return null;
    }
    const decoded = decodeDataUrl(dataUrl);
    if (!decoded) {
      warnings.push(`image ${element.id} carries a dataURL this script cannot read`);
      return null;
    }
    const mimeType = stringOf(entry?.mimeType) || decoded.mimeType;
    const name = claimName(stemFor(text, `image-${files.length + 1}`, settings), names);
    const file = join(settings.imageDir, `${name}.${extensionFor(mimeType)}`);
    const flushed = { name, file, link: linkFor(file, settings), data: decoded.data };
    filesByFileId.set(fileId, flushed);
    files.push(flushed);
    return flushed;
  };

  /*
   * One unbound text drawn alone inside an unlabeled block is that block's
   * label. Excalidraw writes the label as a separate element whenever the text
   * was not typed into the block itself.
   */
  const adoptedLabel = (element: ExcalidrawElement, text: string): ExcalidrawElement | null => {
    const children = childrenOf.get(element.id) ?? [];
    const [only] = children;
    if (text !== "" || children.length !== 1 || !only || !isFreeText(only)) {
      return null;
    }
    return (childrenOf.get(only.id) ?? []).length === 0 ? only : null;
  };

  const buildNode = (element: ExcalidrawElement): PromptNode => {
    const type = typeOf(element);
    const label = adoptedLabel(element, textOf(element, texts));
    const text = label ? textOf(label, texts) : textOf(element, texts);
    const fallback = type === "block" ? `node-${ids.size + 1}` : `${type}-${ids.size + 1}`;
    const id = claimName(slugify(headRow(text), fallback), ids);
    const node: PromptNode = { id, type };
    if (text !== "") {
      node.text = text;
    }
    const link = stringOf(element.link);
    if (link !== "") {
      node.link = link;
    }

    if (type === "schema") {
      const picture = pictureFor(element, text);
      pictures.push(picture);
      node.image = picture.link;
      claimSubtree(element, id);
      return node;
    }

    if (type === "image") {
      const flushed = fileFor(element, text);
      if (flushed) {
        node.image = flushed.link;
      }
    }

    own(element, id);
    if (label) {
      nodeOf.set(label.id, id);
    }
    const children: PromptNode[] = [];
    for (const child of childrenOf.get(element.id) ?? []) {
      if (child === label) {
        continue;
      }
      children.push(buildNode(child));
    }
    if (children.length > 0) {
      node.children = children;
    }
    return node;
  };

  const nodes = roots.map(buildNode);

  /* Where an arrow with no binding can land: any block a node speaks for. */
  const targets: { box: Box; id: string }[] = [];
  for (const element of candidates) {
    const id = nodeOf.get(element.id);
    if (id !== undefined) {
      targets.push({ box: boxOf(element), id });
    }
  }
  const nearestTarget = (point: Point): string | undefined => {
    let nearest: string | undefined = undefined;
    let nearestDistance = ENDPOINT_SEARCH_RADIUS;
    for (const target of targets) {
      const distance = distanceToBox(target.box, point);
      if (distance > nearestDistance) {
        continue;
      }
      nearest = target.id;
      nearestDistance = distance;
    }
    return nearest;
  };

  const edges: PromptEdge[] = [];
  const seen = new Set<string>();
  for (const element of scene.elements) {
    if (element.type !== "arrow") {
      continue;
    }
    const endpoints = arrowEndpoints(element);
    const startId = boundElementId(element.startBinding);
    const endId = boundElementId(element.endBinding);
    const start = (startId === undefined ? undefined : nodeOf.get(startId))
      ?? (endpoints ? nearestTarget(endpoints.start) : undefined);
    const end = (endId === undefined ? undefined : nodeOf.get(endId))
      ?? (endpoints ? nearestTarget(endpoints.end) : undefined);
    if (start === undefined || end === undefined || start === end) {
      continue;
    }
    const text = textOf(element, texts);
    const pointsBack = Boolean(element.startArrowhead) && !element.endArrowhead;
    const edge: PromptEdge = pointsBack ? { from: end, to: start } : { from: start, to: end };
    if (text !== "") {
      edge.text = text;
    }
    const key = `${edge.from} ${edge.to} ${text}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    edges.push(edge);
  }

  return { graph: { nodes, edges }, pictures, files, warnings };
}

export { sceneToPromptGraph };
export type {
  GraphFile,
  GraphPicture,
  NodeType,
  PromptEdge,
  PromptGraph,
  PromptGraphOptions,
  PromptGraphResult,
  PromptNode,
};
