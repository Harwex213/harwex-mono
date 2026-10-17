import type { TFsFileKind } from "@hw/harwex-notes-protocol";

type TResolvedFileKind = Exclude<TFsFileKind, "file">;

const EXTENSIONS_BY_FILE_KIND: Readonly<Record<TResolvedFileKind, readonly string[]>> = {
  markdown: [".md", ".markdown"],
  text: [".txt"],
  excalidraw: [".excalidraw"],
  html: [".html", ".htm"],
  image: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico", ".avif"],
};

const FILE_KINDS: readonly TResolvedFileKind[] = Object.keys(
  EXTENSIONS_BY_FILE_KIND
) as TResolvedFileKind[];

// An empty file is not an image, so a new file can only be one of the other kinds (IMG-6).
const CREATABLE_FILE_KINDS: readonly TResolvedFileKind[] = ["markdown", "text", "excalidraw", "html"];

const FILE_EXTENSIONS: readonly string[] = CREATABLE_FILE_KINDS.flatMap((kind) => {
  return EXTENSIONS_BY_FILE_KIND[kind];
});

// A bare extension is not a file name, so ".md" on its own stays unresolved.
const readFileKind = (name: string): TResolvedFileKind | null => {
  const trimmed = name.trim().toLowerCase();
  const dotIndex = trimmed.lastIndexOf(".");
  if (dotIndex <= 0) {
    return null;
  }

  const extension = trimmed.slice(dotIndex);

  const kind = FILE_KINDS.find((candidate) => {
    return EXTENSIONS_BY_FILE_KIND[candidate].includes(extension);
  });

  return kind ?? null;
};

export { FILE_EXTENSIONS, readFileKind };
