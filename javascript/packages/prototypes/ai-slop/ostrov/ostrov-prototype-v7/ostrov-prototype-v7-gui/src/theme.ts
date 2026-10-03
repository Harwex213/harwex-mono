import { palette } from "@hw/ostrov-prototype-v7-assets";
import type { CSSProperties } from "react";

// The palette stays the one source of colour. A widget never spells a hex code;
// it reads a variable, and the app puts these on one element above every
// widget.
const colorVariables = Object.entries(palette).map(([name, value]) => {
  return [`--ostrov-${name}`, value];
});

// The type face belongs to the screen, and the screen is DOM. It lives here,
// next to the widgets that read it.
const family = "system-ui, -apple-system, Segoe UI, sans-serif";
const weight = 600;

const themeVariables = Object.fromEntries([
  ...colorVariables,
  ["--ostrov-font", family],
  ["--ostrov-weight", String(weight)],
]) as CSSProperties;

export { themeVariables };
