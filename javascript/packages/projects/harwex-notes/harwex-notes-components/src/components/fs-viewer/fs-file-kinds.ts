import type { TFsFileKind } from "@hw/harwex-notes-protocol";

// "file" is the kind of a draft that has no extension yet, so it has no extension of its own.
type TResolvedFileKind = Exclude<TFsFileKind, "file">;

// The extension decides the kind of a file, the way it does on disk. The draft input
// reads it to refuse a name it cannot resolve.
const EXTENSION_BY_FILE_KIND: Readonly<Record<TResolvedFileKind, string>> = {
  markdown: ".md",
  excalidraw: ".excalidraw",
};

const FILE_KINDS: readonly TResolvedFileKind[] = Object.keys(
  EXTENSION_BY_FILE_KIND
) as TResolvedFileKind[];

const FILE_EXTENSIONS: readonly string[] = FILE_KINDS.map((kind) => {
  return EXTENSION_BY_FILE_KIND[kind];
});

// A bare extension is not a file name, so ".md" on its own stays unresolved.
const readFileKind = (name: string): TResolvedFileKind | null => {
  const trimmed = name.trim().toLowerCase();

  const kind = FILE_KINDS.find((candidate) => {
    const extension = EXTENSION_BY_FILE_KIND[candidate];

    return trimmed.length > extension.length && trimmed.endsWith(extension);
  });

  return kind ?? null;
};

export { FILE_EXTENSIONS, readFileKind };
