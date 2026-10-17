import { z } from "zod";
import { fsNodeIdSchema } from "./fs.js";

// The version of the file the document was read from, as the backend saw it on disk. A
// save that carries a version is refused when the file has changed since (CONF-1). A save
// without one overwrites the file, which is what "Overwrite the file" means (CONF-2).
const documentVersionSchema = z.string().optional();

const markdownDocumentSchema = z.object({
  kind: z.literal("markdown"),
  nodeId: fsNodeIdSchema,
  version: documentVersionSchema,
  text: z.string(),
});

// A plain text file is shown and saved as it is, with no rendering (TXT-1, TXT-2).
const textDocumentSchema = z.object({
  kind: z.literal("text"),
  nodeId: fsNodeIdSchema,
  version: documentVersionSchema,
  text: z.string(),
});

// Excalidraw owns the shape of its elements and binary files. The protocol carries them
// as opaque records; the frontend narrows them to Excalidraw's own types at the viewer.
const excalidrawElementSchema = z.record(z.string(), z.unknown());
const excalidrawFilesSchema = z.record(z.string(), z.unknown());

// The style a new element gets, under the names Excalidraw itself uses in `appState`. A
// drawing keeps it in its own file, so excalidraw.com reads the same keys (EX-3, EX-7). The
// app-wide default for new drawings has the same shape (SET-2). Every key is optional: a
// file written elsewhere may hold any subset.
const excalidrawStyleSchema = z.object({
  currentItemStrokeColor: z.string(),
  currentItemBackgroundColor: z.string(),
  currentItemFillStyle: z.string(),
  currentItemStrokeWidth: z.number(),
  currentItemStrokeStyle: z.string(),
  currentItemRoughness: z.number(),
  currentItemOpacity: z.number(),
  currentItemFontFamily: z.number(),
  currentItemFontSize: z.number(),
  currentItemTextAlign: z.string(),
  currentItemStartArrowhead: z.string().nullable(),
  currentItemEndArrowhead: z.string().nullable(),
  currentItemRoundness: z.string(),
  currentItemArrowType: z.string(),
}).partial();

type TExcalidrawStyle = z.infer<typeof excalidrawStyleSchema>;

const EXCALIDRAW_STYLE_KEYS = Object.keys(excalidrawStyleSchema.shape) as readonly (keyof TExcalidrawStyle)[];

// The app's own style when the user has chosen none. A roughness of 0 is the `architect`
// sloppiness, a font family of 6 is Nunito (`normal` in the picker) and a font size of 16
// is `small`.
const DEFAULT_EXCALIDRAW_STYLE: Required<TExcalidrawStyle> = {
  currentItemStrokeColor: "#1e1e1e",
  currentItemBackgroundColor: "transparent",
  currentItemFillStyle: "solid",
  currentItemStrokeWidth: 2,
  currentItemStrokeStyle: "solid",
  currentItemRoughness: 0,
  currentItemOpacity: 100,
  currentItemFontFamily: 6,
  currentItemFontSize: 16,
  currentItemTextAlign: "left",
  currentItemStartArrowhead: null,
  currentItemEndArrowhead: "arrow",
  currentItemRoundness: "sharp",
  currentItemArrowType: "elbow",
};

// Takes the style keys out of any value (a file's whole `appState`, a stored setting) and
// drops the keys whose value has the wrong type, one by one, so one odd key does not cost
// the rest.
const pickExcalidrawStyle = (value: unknown): TExcalidrawStyle => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }

  const source = value as Record<string, unknown>;
  const style: Record<string, unknown> = {};

  for (const key of EXCALIDRAW_STYLE_KEYS) {
    if (!(key in source)) {
      continue;
    }

    const parsed = excalidrawStyleSchema.shape[key].safeParse(source[key]);
    if (parsed.success && parsed.data !== undefined) {
      style[key] = parsed.data;
    }
  }

  return style as TExcalidrawStyle;
};

// Where the user left a drawing: its scroll offset and zoom. It is view state of one user,
// so it lives in the state database under EXCALIDRAW_VIEWPORT_STATE_KEY, never in the
// file (EX-8).
const excalidrawViewportSchema = z.object({
  scrollX: z.number(),
  scrollY: z.number(),
  zoom: z.number().positive(),
});

type TExcalidrawViewport = z.infer<typeof excalidrawViewportSchema>;

const EXCALIDRAW_VIEWPORT_STATE_KEY = "excalidraw.viewport";

// The app setting that holds the style of new drawings (SET-2), a TExcalidrawStyle.
const EXCALIDRAW_DEFAULT_STYLE_SETTING = "excalidraw.defaultStyle";

// A link from a drawing element to a file of the vault (EX-9). The rest of the link is the
// file's vault-relative path with "/" separators, as the tree shows it.
const VAULT_LINK_PREFIX = "vault:";

const excalidrawSceneSchema = z.object({
  elements: z.array(excalidrawElementSchema).readonly(),
  files: excalidrawFilesSchema,
  // Only the style part of the file's `appState`. The rest of it (and the viewport, which
  // is per-user view state, EX-8) never travels with the scene.
  appState: excalidrawStyleSchema.optional(),
});

const excalidrawDocumentSchema = z.object({
  kind: z.literal("excalidraw"),
  nodeId: fsNodeIdSchema,
  version: documentVersionSchema,
  scene: excalidrawSceneSchema,
});

// Images and HTML pages are never edited, and an image is not text. The document carries
// a URL the browser loads the file from instead of its content (IMG-2, HTML-2).
const imageDocumentSchema = z.object({
  kind: z.literal("image"),
  nodeId: fsNodeIdSchema,
  version: documentVersionSchema,
  src: z.string().min(1),
});

const htmlDocumentSchema = z.object({
  kind: z.literal("html"),
  nodeId: fsNodeIdSchema,
  version: documentVersionSchema,
  src: z.string().min(1),
});

const documentSchema = z.discriminatedUnion("kind", [
  markdownDocumentSchema,
  textDocumentSchema,
  excalidrawDocumentSchema,
  imageDocumentSchema,
  htmlDocumentSchema,
]);

type TMarkdownDocument = z.infer<typeof markdownDocumentSchema>;
type TTextDocument = z.infer<typeof textDocumentSchema>;
type TExcalidrawScene = z.infer<typeof excalidrawSceneSchema>;
type TExcalidrawDocument = z.infer<typeof excalidrawDocumentSchema>;
type TImageDocument = z.infer<typeof imageDocumentSchema>;
type THtmlDocument = z.infer<typeof htmlDocumentSchema>;
type TDocument = z.infer<typeof documentSchema>;

export {
  DEFAULT_EXCALIDRAW_STYLE,
  EXCALIDRAW_DEFAULT_STYLE_SETTING,
  EXCALIDRAW_STYLE_KEYS,
  EXCALIDRAW_VIEWPORT_STATE_KEY,
  VAULT_LINK_PREFIX,
  excalidrawViewportSchema,
  markdownDocumentSchema,
  textDocumentSchema,
  excalidrawStyleSchema,
  excalidrawSceneSchema,
  excalidrawDocumentSchema,
  imageDocumentSchema,
  htmlDocumentSchema,
  documentSchema,
  pickExcalidrawStyle,
};
export type {
  TExcalidrawStyle,
  TExcalidrawViewport,
  TMarkdownDocument,
  TTextDocument,
  TExcalidrawScene,
  TExcalidrawDocument,
  TImageDocument,
  THtmlDocument,
  TDocument,
};
