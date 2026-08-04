import type { UnitKind } from "../state/units-state";

// Path data copied from `assets/spear.svg`, `assets/sword.svg` and
// `assets/bow-arrow.svg`. The prototype has no SVG loader, and an inline
// `<path>` takes its colour from the stylesheet like every other shape on the
// canvas.

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
  bow: {
    path: "M19.03 6.03L20 7l2-5l-5 2l.97.97l-1.82 1.82C10.87 2.16 3.3 3.94 2.97 4L2 4.26l.5 1.94l.79-.2l6.83 6.82L6.94 16H5l-3 3l2 1l1 2l3-3v-1.94l3.18-3.18L18 20.71l-.19.79l1.93.5l.26-.97c.06-.33 1.84-7.9-2.79-13.18zM4.5 5.78c2.05-.28 6.78-.5 10.23 2.43l-3.91 3.91zM18.22 19.5l-6.34-6.32l3.91-3.91c2.93 3.45 2.71 8.18 2.43 10.23",
    rotation: -45,
  },
};

// `assets/swap-bold.svg`. Not a unit kind: it marks the unit a move would trade
// places with, so it is stroked rather than filled and keeps the source width.
const SWAP_ICON = {
  path: "M11 8L7 4m0 0L3 8m4-4v16m6-4l4 4m0 0l4-4m-4 4V4",
  strokeWidth: 2.5,
};

export { ICON_VIEWBOX, SWAP_ICON, UNIT_ICONS };
export type { UnitIcon };
