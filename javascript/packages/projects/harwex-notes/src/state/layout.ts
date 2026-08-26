import { signal } from "@preact/signals-react";

const STORAGE_KEY = "harwex-notes.panel-width";
const MIN_WIDTH = 160;
const MAX_WIDTH = 620;
const DEFAULT_WIDTH = 260;

function clampWidth(value: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(value)));
}

function readStoredWidth(): number {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === null) {
      return DEFAULT_WIDTH;
    }
    const parsed = Number(stored);
    return Number.isFinite(parsed) ? clampWidth(parsed) : DEFAULT_WIDTH;
  } catch {
    // A blocked localStorage is not a reason to refuse to render.
    return DEFAULT_WIDTH;
  }
}

const panelWidth = signal<number>(readStoredWidth());

function setPanelWidth(value: number): void {
  const next = clampWidth(value);
  panelWidth.value = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(next));
  } catch {
    /* nothing to do: the width simply will not be remembered */
  }
}

export { panelWidth, setPanelWidth };
