import type { TFsFileKind } from "@hw/harwex-notes-protocol";

type TResolvedFileKind = Exclude<TFsFileKind, "file">;

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

const readFileKind = (name: string): TResolvedFileKind | null => {
  const trimmed = name.trim().toLowerCase();

  const kind = FILE_KINDS.find((candidate) => {
    const extension = EXTENSION_BY_FILE_KIND[candidate];

    return trimmed.length > extension.length && trimmed.endsWith(extension);
  });

  return kind ?? null;
};

export { FILE_EXTENSIONS, readFileKind };
