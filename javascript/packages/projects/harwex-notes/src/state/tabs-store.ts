import { signal } from "@preact/signals-react";
import { dropDoc, loadDoc } from "./doc-store.ts";

const openPaths = signal<readonly string[]>([]);
const activePath = signal<string | null>(null);

function openTab(path: string): void {
  if (!openPaths.value.includes(path)) {
    openPaths.value = [...openPaths.value, path];
  }
  activePath.value = path;
  void loadDoc(path);
}

function activateTab(path: string): void {
  if (openPaths.value.includes(path)) {
    activePath.value = path;
  }
}

/** Closing the active tab hands focus to a neighbour rather than to nothing. */
function closeTab(path: string): void {
  const index = openPaths.value.indexOf(path);
  if (index === -1) {
    return;
  }
  const remaining = openPaths.value.filter((candidate) => {
    return candidate !== path;
  });
  openPaths.value = remaining;
  if (activePath.value === path) {
    const neighbour = remaining[Math.min(index, remaining.length - 1)];
    activePath.value = neighbour ?? null;
  }
  dropDoc(path);
}

export { activateTab, activePath, closeTab, openPaths, openTab };
