import { signal } from "@preact/signals-react";

// Per-document view toggles: whether a Markdown tab shows its preview pane, and
// whether an HTML tab shows source instead of the rendered frame.
const flags = signal<Readonly<Record<string, boolean>>>({});

function readFlag(key: string, fallback: boolean): boolean {
  return flags.value[key] ?? fallback;
}

function toggleFlag(key: string, fallback: boolean): void {
  flags.value = { ...flags.value, [key]: !readFlag(key, fallback) };
}

function markdownPreviewOn(path: string): boolean {
  return readFlag(`md-preview:${path}`, true);
}

function toggleMarkdownPreview(path: string): void {
  toggleFlag(`md-preview:${path}`, true);
}

function htmlSourceOn(path: string): boolean {
  return readFlag(`html-source:${path}`, false);
}

function toggleHtmlSource(path: string): void {
  toggleFlag(`html-source:${path}`, false);
}

export { htmlSourceOn, markdownPreviewOn, toggleHtmlSource, toggleMarkdownPreview };
