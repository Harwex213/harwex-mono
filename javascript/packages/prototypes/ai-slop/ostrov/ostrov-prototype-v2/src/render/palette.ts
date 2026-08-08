import { config } from "@hw/ostrov-prototype-v2-config";

type Rgb = {
  r: number;
  g: number;
  b: number;
};

const SKY_TOP = config.background.skyTopColor;
const SKY_MID = config.background.skyMidColor;
const SKY_BOTTOM = config.background.skyBottomColor;

/** Cliff colours: a bright lip under the top face fading into deep wet rock. */
const ROCK_TOP = config.render.rockTopColor;
const ROCK_BOTTOM = config.render.rockBottomColor;

const BORDER_DARK = config.render.borderOuterColor;
const BORDER_BRIGHT = config.render.borderInnerColor;
const BORDER_SHEEN = config.render.borderSheenColor;

const HOVER_FILL = withAlpha(config.render.hoverFillColor, config.render.hoverFillAlpha);
const HOVER_LINE = withAlpha(config.render.hoverLineColor, config.render.hoverLineAlpha);
const SELECT_LINE = config.render.selectColor;

/** Accepts both `#rrggbb` and the `rgb(r, g, b)` strings this module produces. */
function hexToRgb(colour: string): Rgb {
  if (colour.startsWith("#")) {
    const value = Number.parseInt(colour.slice(1), 16);
    return {
      r: (value >> 16) & 255,
      g: (value >> 8) & 255,
      b: value & 255,
    };
  }
  const parts = colour.slice(colour.indexOf("(") + 1, colour.lastIndexOf(")")).split(",");
  return {
    r: Number.parseFloat(parts[0] ?? "0"),
    g: Number.parseFloat(parts[1] ?? "0"),
    b: Number.parseFloat(parts[2] ?? "0"),
  };
}

/** `#rrggbb` plus an alpha, as the `rgba(...)` string canvas wants. */
function withAlpha(colour: string, alpha: number): string {
  const rgb = hexToRgb(colour);
  return `rgba(${clampByte(rgb.r)}, ${clampByte(rgb.g)}, ${clampByte(rgb.b)}, ${alpha})`;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function rgbToCss(rgb: Rgb): string {
  return `rgb(${clampByte(rgb.r)}, ${clampByte(rgb.g)}, ${clampByte(rgb.b)})`;
}

/** Multiplies a colour towards black (`factor < 1`) or white (`factor > 1`). */
function shade(hex: string, factor: number): string {
  const rgb = hexToRgb(hex);
  if (factor <= 1) {
    return rgbToCss({ r: rgb.r * factor, g: rgb.g * factor, b: rgb.b * factor });
  }
  const towards = factor - 1;
  return rgbToCss({
    r: rgb.r + (255 - rgb.r) * towards,
    g: rgb.g + (255 - rgb.g) * towards,
    b: rgb.b + (255 - rgb.b) * towards,
  });
}

/** Linear blend between two hex colours. */
function mix(from: string, to: string, amount: number): string {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  return rgbToCss({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  });
}

export type { Rgb };
export {
  BORDER_BRIGHT,
  BORDER_DARK,
  BORDER_SHEEN,
  HOVER_FILL,
  HOVER_LINE,
  ROCK_BOTTOM,
  ROCK_TOP,
  SELECT_LINE,
  SKY_BOTTOM,
  SKY_MID,
  SKY_TOP,
  hexToRgb,
  mix,
  withAlpha,
  rgbToCss,
  shade,
};
