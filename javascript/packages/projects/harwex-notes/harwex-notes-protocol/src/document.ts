import { z } from "zod";
import { fsNodeIdSchema } from "./fs.js";

const markdownDocumentSchema = z.object({
  kind: z.literal("markdown"),
  nodeId: fsNodeIdSchema,
  text: z.string(),
});

// Excalidraw owns the shape of its elements and binary files. The protocol carries them
// as opaque records; the frontend narrows them to Excalidraw's own types at the viewer.
const excalidrawElementSchema = z.record(z.string(), z.unknown());
const excalidrawFilesSchema = z.record(z.string(), z.unknown());

const excalidrawSceneSchema = z.object({
  elements: z.array(excalidrawElementSchema).readonly(),
  files: excalidrawFilesSchema,
});

const excalidrawDocumentSchema = z.object({
  kind: z.literal("excalidraw"),
  nodeId: fsNodeIdSchema,
  scene: excalidrawSceneSchema,
});

const documentSchema = z.discriminatedUnion("kind", [
  markdownDocumentSchema,
  excalidrawDocumentSchema,
]);

type TMarkdownDocument = z.infer<typeof markdownDocumentSchema>;
type TExcalidrawScene = z.infer<typeof excalidrawSceneSchema>;
type TExcalidrawDocument = z.infer<typeof excalidrawDocumentSchema>;
type TDocument = z.infer<typeof documentSchema>;

export {
  markdownDocumentSchema,
  excalidrawSceneSchema,
  excalidrawDocumentSchema,
  documentSchema,
};
export type { TMarkdownDocument, TExcalidrawScene, TExcalidrawDocument, TDocument };
