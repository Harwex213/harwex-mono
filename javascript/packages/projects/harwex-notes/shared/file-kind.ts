import type { FileKind } from "./contract.ts";

const KIND_BY_EXTENSION: Record<string, FileKind> = {
  ".excalidraw": "excalidraw",
  ".htm": "html",
  ".html": "html",
  ".markdown": "markdown",
  ".md": "markdown",
  ".txt": "text",
};

/** Anything without a mapped extension is treated as plain text. */
function fileKindForName(name: string): FileKind {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return "text";
  }
  return KIND_BY_EXTENSION[name.slice(dot).toLowerCase()] ?? "text";
}

export { fileKindForName };
