import type { Province } from "../../../domain/index";
import type { HighlightRequest } from "./layers/highlight-layer";

// Pure. Hover on the selected province is skipped, so two fills never stack.
// "select" goes last, so it draws on top.
function buildHighlights(
  hoveredId: number | null,
  selectedId: number | null,
  lookup: (id: number) => Province | null,
): HighlightRequest[] {
  const highlights: HighlightRequest[] = [];
  if (hoveredId !== null && hoveredId !== selectedId) {
    const province = lookup(hoveredId);
    if (province) {
      highlights.push({ province, role: "hover" });
    }
  }
  if (selectedId !== null) {
    const province = lookup(selectedId);
    if (province) {
      highlights.push({ province, role: "select" });
    }
  }
  return highlights;
}

export { buildHighlights };
