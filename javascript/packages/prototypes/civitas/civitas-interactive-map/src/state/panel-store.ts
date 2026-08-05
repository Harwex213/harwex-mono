import { computed, signal } from "@preact/signals-react";
import type { ReadonlySignal } from "@preact/signals-react";

// Which of the three Phase-3 panels is open. One panel at a time: they share the
// right dock.
//
// NOT persisted, for the same reason `showLabels` is not — it is view state, not
// world state, and `civitas.state.v1` gains no key from T08.

type PanelId = "country" | "provinces" | "economics";

// One DOM id, because one panel is mounted at a time. The bar buttons point
// `aria-controls` at it.
const PANEL_DOM_ID = "civ-panel";

const openSignal = signal<PanelId | null>(null);

const openPanelId: ReadonlySignal<PanelId | null> = computed(() => {
  return openSignal.value;
});

function openPanel(id: PanelId): void {
  if (openSignal.value === id) {
    return;
  }
  openSignal.value = id;
}

function closePanel(): void {
  if (openSignal.value === null) {
    return;
  }
  openSignal.value = null;
}

// The same id closes; a different id switches.
function togglePanel(id: PanelId): void {
  openSignal.value = openSignal.value === id ? null : id;
}

export { PANEL_DOM_ID, closePanel, openPanel, openPanelId, togglePanel, type PanelId };
