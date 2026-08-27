import type { TFsFileKind } from "@hw/harwex-notes-protocol";

// The extension decides the kind of a file, the way it does on disk. The rule is pure
// data with no store and no api behind it: `createNode` reads it to resolve the kind of
// a typed name, and the draft input reads it to refuse a name it cannot resolve.
const EXTENSION_BY_FILE_KIND: Readonly<Record<TFsFileKind, string>> = {
  markdown: ".md",
  excalidraw: ".excalidraw",
};

const FILE_KINDS: readonly TFsFileKind[] = Object.keys(
  EXTENSION_BY_FILE_KIND
) as TFsFileKind[];

const FILE_EXTENSIONS: readonly string[] = FILE_KINDS.map((kind) => {
  return EXTENSION_BY_FILE_KIND[kind];
});

// A bare extension is not a file name, so ".md" on its own stays unresolved.
const readFileKind = (name: string): TFsFileKind | null => {
  const trimmed = name.trim().toLowerCase();

  const kind = FILE_KINDS.find((candidate) => {
    const extension = EXTENSION_BY_FILE_KIND[candidate];

    return trimmed.length > extension.length && trimmed.endsWith(extension);
  });

  return kind ?? null;
};

export { FILE_EXTENSIONS, readFileKind };
