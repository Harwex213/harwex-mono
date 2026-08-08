type Rgb = {
  r: number;
  g: number;
  b: number;
};

const SKY_TOP = "#a4c6dd";
const SKY_MID = "#c6dded";
const SKY_BOTTOM = "#7ca2c0";

/** Cliff colours: a bright lip under the top face fading into deep wet rock. */
const ROCK_TOP = "#adc2ce";
const ROCK_BOTTOM = "#35536a";

const BORDER_DARK = "#0b3f9c";
const BORDER_BRIGHT = "#2f83f0";
const BORDER_SHEEN = "#8fc4ff";

const HOVER_FILL = "rgba(255, 255, 255, 0.14)";
const HOVER_LINE = "rgba(255, 255, 255, 0.85)";
const SELECT_LINE = "#ffd479";

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
  rgbToCss,
  shade,
};
