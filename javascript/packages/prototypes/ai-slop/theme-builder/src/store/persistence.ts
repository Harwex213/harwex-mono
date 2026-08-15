import { DEFAULT_SECTION_STYLE } from "../data/layouts";
import { DEFAULT_THEME } from "../data/theme";
import { createId } from "../ids";
import type { ContainerNode, PageNode, SectionNode, SiteDoc, WidgetNode } from "../types";

const STORAGE_KEY = "theme-builder:doc:v1";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readWidget(value: unknown): WidgetNode | null {
  if (!isRecord(value) || typeof value.type !== "string") {
    return null;
  }

  return {
    id: asString(value.id, createId("w")),
    type: value.type,
    props: isRecord(value.props) ? (value.props as WidgetNode["props"]) : {},
  };
}

function readContainer(value: unknown): ContainerNode {
  const widgets = isRecord(value) && Array.isArray(value.widgets) ? value.widgets : [];

  return {
    id: isRecord(value) ? asString(value.id, createId("c")) : createId("c"),
    widgets: widgets.map(readWidget).filter((widget): widget is WidgetNode => widget !== null),
  };
}

function readSection(value: unknown): SectionNode | null {
  if (!isRecord(value)) {
    return null;
  }

  const containers = Array.isArray(value.containers) ? value.containers : [];
  const style = isRecord(value.style) ? value.style : {};

  return {
    id: asString(value.id, createId("s")),
    name: asString(value.name, "Section"),
    layout: asString(value.layout, "single") as SectionNode["layout"],
    style: {
      background: asString(style.background, DEFAULT_SECTION_STYLE.background) as SectionNode["style"]["background"],
      paddingY: asNumber(style.paddingY, DEFAULT_SECTION_STYLE.paddingY),
      gap: asNumber(style.gap, DEFAULT_SECTION_STYLE.gap),
      maxWidth: asNumber(style.maxWidth, DEFAULT_SECTION_STYLE.maxWidth),
    },
    containers: containers.length === 0 ? [readContainer(null)] : containers.map(readContainer),
  };
}

function readPage(value: unknown): PageNode | null {
  if (!isRecord(value)) {
    return null;
  }

  const sections = Array.isArray(value.sections) ? value.sections : [];

  return {
    id: asString(value.id, createId("p")),
    name: asString(value.name, "Page"),
    path: asString(value.path, "/page"),
    sections: sections.map(readSection).filter((section): section is SectionNode => section !== null),
  };
}

/** Returns null when the payload is not a document this build can open. */
function readDoc(value: unknown): SiteDoc | null {
  if (!isRecord(value) || !Array.isArray(value.pages)) {
    return null;
  }

  const pages = value.pages.map(readPage).filter((page): page is PageNode => page !== null);

  if (pages.length === 0) {
    return null;
  }

  const theme = isRecord(value.theme) ? value.theme : {};

  return {
    name: asString(value.name, "Untitled site"),
    theme: {
      brand: asString(theme.brand, DEFAULT_THEME.brand),
      accent: asString(theme.accent, DEFAULT_THEME.accent),
      base: asString(theme.base, DEFAULT_THEME.base),
      surface: asString(theme.surface, DEFAULT_THEME.surface),
      text: asString(theme.text, DEFAULT_THEME.text),
      muted: asString(theme.muted, DEFAULT_THEME.muted),
      radius: asNumber(theme.radius, DEFAULT_THEME.radius),
      density: asNumber(theme.density, DEFAULT_THEME.density),
      fontFamily: asString(theme.fontFamily, DEFAULT_THEME.fontFamily),
    },
    pages,
  };
}

function parseDoc(raw: string): SiteDoc | null {
  try {
    return readDoc(JSON.parse(raw));
  } catch {
    return null;
  }
}

function loadDoc(): SiteDoc | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);

  if (!raw) {
    return null;
  }

  return parseDoc(raw);
}

function saveDoc(doc: SiteDoc): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(doc));
  } catch {
    // Storage full or blocked — the session keeps working, it just will not restore.
  }
}

function clearDoc(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}

function serializeDoc(doc: SiteDoc): string {
  return JSON.stringify(doc, null, 2);
}

function downloadDoc(doc: SiteDoc): void {
  const blob = new Blob([serializeDoc(doc)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `${doc.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export { clearDoc, downloadDoc, loadDoc, parseDoc, saveDoc, serializeDoc, STORAGE_KEY };
