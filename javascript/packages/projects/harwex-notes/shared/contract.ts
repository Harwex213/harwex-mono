import { z } from "zod";

const relPathSchema = z
  .string()
  .max(1024)
  .refine((value) => {
    return !value.startsWith("/");
  }, "Path must be workspace-relative.")
  .refine((value) => {
    return !value.includes("\0");
  }, "Path must not contain NUL.")
  .refine((value) => {
    return !value.split("/").includes("..");
  }, "Path must not escape the root.");

const fileKindSchema = z.enum(["excalidraw", "markdown", "text", "html"]);

const entrySchema = z.object({
  name: z.string(),
  path: relPathSchema,
  type: z.enum(["dir", "file"]),
  fileKind: fileKindSchema.nullable(),
  size: z.number().int().nonnegative(),
  mtimeMs: z.number(),
});

const listInputSchema = z.object({ path: relPathSchema });
const listOutputSchema = z.object({ entries: z.array(entrySchema) });

const readInputSchema = z.object({ path: relPathSchema });
const readOutputSchema = z.object({
  path: relPathSchema,
  fileKind: fileKindSchema,
  text: z.string(),
  mtimeMs: z.number(),
});

const writeInputSchema = z.object({
  path: relPathSchema,
  text: z.string().max(16 * 1024 * 1024),
  baseMtimeMs: z.number(),
});
const writeOutputSchema = z.object({ mtimeMs: z.number() });

type Entry = z.infer<typeof entrySchema>;
type FileKind = z.infer<typeof fileKindSchema>;
type ListOutput = z.infer<typeof listOutputSchema>;
type ReadOutput = z.infer<typeof readOutputSchema>;
type WriteOutput = z.infer<typeof writeOutputSchema>;

export type { Entry, FileKind, ListOutput, ReadOutput, WriteOutput };
export {
  entrySchema,
  fileKindSchema,
  listInputSchema,
  listOutputSchema,
  readInputSchema,
  readOutputSchema,
  relPathSchema,
  writeInputSchema,
  writeOutputSchema,
};
