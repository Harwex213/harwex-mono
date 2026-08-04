import { signal } from "@preact/signals-react";

// T08 owns selection semantics — right click selecting a country, the panels it
// drives, the UI shell. This file exists now because T04 has to prove hover and
// selection highlights actually work, and because T08 extending a store is
// cheaper than T08 unpicking component state. T08 adds `selectedCountryId` here;
// it does not move these.
//
// Both setters skip the write when the value is unchanged. A pointer move inside
// one province must not schedule a repaint — with the guard, a repaint only
// happens when the cursor actually crosses a province boundary.

const hoveredProvinceId = signal<number | null>(null);
const selectedProvinceId = signal<number | null>(null);

function setHoveredProvince(id: number | null): void {
  if (hoveredProvinceId.value === id) {
    return;
  }
  hoveredProvinceId.value = id;
}

function setSelectedProvince(id: number | null): void {
  if (selectedProvinceId.value === id) {
    return;
  }
  selectedProvinceId.value = id;
}

function clearSelection(): void {
  setSelectedProvince(null);
}

export {
  clearSelection,
  hoveredProvinceId,
  selectedProvinceId,
  setHoveredProvince,
  setSelectedProvince,
};
