import type { UnitKind } from "../state/units-state";

// Path data copied from `assets/spear.svg` and `assets/sword.svg`. The
// prototype has no SVG loader, and an inline `<path>` takes its colour from the
// stylesheet like every other shape on the canvas.

// Both source files are drawn on a `0 0 24 24` viewBox.
const ICON_VIEWBOX = 24;

type UnitIcon = {
  path: string;
  // Both glyphs are drawn along a diagonal; the marker wants them upright.
  rotation: number;
};

const UNIT_ICONS: Record<UnitKind, UnitIcon> = {
  spear: {
    path: "M16 9h.41l-13 13L2 20.59l13-13V9zm0-5v4h4l2-6z",
    rotation: -45,
  },
  sword: {
    path: "M6.92 5H5l9 9l1-.94m4.96 6.06l-.84.84a.996.996 0 0 1-1.41 0l-3.12-3.12l-2.68 2.66l-1.41-1.41l1.42-1.42L3 7.75V3h4.75l8.92 8.92l1.42-1.42l1.41 1.41l-2.67 2.67l3.12 3.12c.4.4.4 1.03.01 1.42",
    rotation: 45,
  },
};

export { ICON_VIEWBOX, UNIT_ICONS };
export type { UnitIcon };
