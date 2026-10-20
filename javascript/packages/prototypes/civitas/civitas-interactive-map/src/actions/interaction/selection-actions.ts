import {
  nextSelection,
  sameSelection,
  type SelectionIntent,
} from "../../domain/index";
import type { TStore } from "../../store/index";

// Setters skip unchanged writes, so a pointer move inside one province does not repaint.

function apply(store: TStore, intent: SelectionIntent): void {
  const current = store.selection.selection.peek();
  const next = nextSelection(current, intent, store.world.countryOfProvince.peek());
  if (sameSelection(current, next)) {
    return;
  }
  store.selection.selection.value = next;
}

function setHoveredProvince(store: TStore, id: number | null): void {
  if (store.selection.hoveredProvinceId.peek() === id) {
    return;
  }
  store.selection.hoveredProvinceId.value = id;
}

// Left click.
function selectProvince(store: TStore, id: number | null): void {
  apply(store, { kind: "province", provinceId: id });
}

// Right click.
function selectCountryOfProvince(store: TStore, id: number | null): void {
  apply(store, { kind: "countryOfProvince", provinceId: id });
}

// A row in the country panel.
function selectCountry(store: TStore, countryId: number | null): void {
  apply(store, { kind: "country", countryId });
}

function clearSelection(store: TStore): void {
  apply(store, { kind: "clear" });
}

export { clearSelection, selectCountry, selectCountryOfProvince, selectProvince, setHoveredProvince };
