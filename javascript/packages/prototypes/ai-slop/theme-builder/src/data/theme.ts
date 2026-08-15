import type { ThemeTokens } from "../types";

interface ThemePreset {
  id: string;
  label: string;
  tokens: ThemeTokens;
}

const FONT_STACKS: Record<string, string> = {
  grotesk: "\"Inter\", \"Segoe UI\", system-ui, sans-serif",
  serif: "\"Iowan Old Style\", \"Times New Roman\", Georgia, serif",
  mono: "\"JetBrains Mono\", \"SF Mono\", ui-monospace, monospace",
  rounded: "\"Nunito\", \"Avenir Next\", system-ui, sans-serif",
};

const DEFAULT_THEME: ThemeTokens = {
  brand: "#12d18e",
  accent: "#ffb703",
  base: "#0b1220",
  surface: "#141d31",
  text: "#eef2ff",
  muted: "#8b9ab8",
  radius: 12,
  density: 1,
  fontFamily: "grotesk",
};

const THEME_PRESETS: ThemePreset[] = [
  {
    id: "midnight-green",
    label: "Midnight Green",
    tokens: DEFAULT_THEME,
  },
  {
    id: "stadium-red",
    label: "Stadium Red",
    tokens: {
      brand: "#ff3b3b",
      accent: "#ffd166",
      base: "#12080b",
      surface: "#201014",
      text: "#fff5f5",
      muted: "#c49a9a",
      radius: 6,
      density: 0.9,
      fontFamily: "grotesk",
    },
  },
  {
    id: "arctic-light",
    label: "Arctic Light",
    tokens: {
      brand: "#1763ff",
      accent: "#ff7a1a",
      base: "#f4f7fc",
      surface: "#ffffff",
      text: "#0d1526",
      muted: "#66748f",
      radius: 16,
      density: 1.1,
      fontFamily: "rounded",
    },
  },
  {
    id: "vegas-gold",
    label: "Vegas Gold",
    tokens: {
      brand: "#e8bf5a",
      accent: "#a855f7",
      base: "#0a0a0c",
      surface: "#17171c",
      text: "#f6f1e4",
      muted: "#9b937f",
      radius: 4,
      density: 1,
      fontFamily: "serif",
    },
  },
];

function fontStackOf(fontFamily: string): string {
  return FONT_STACKS[fontFamily] ?? FONT_STACKS.grotesk;
}

/** CSS custom properties the rendered site reads. Applied to the canvas frame. */
function themeVariables(theme: ThemeTokens): Record<string, string> {
  return {
    "--sb-brand": theme.brand,
    "--sb-accent": theme.accent,
    "--sb-base": theme.base,
    "--sb-surface": theme.surface,
    "--sb-text": theme.text,
    "--sb-muted": theme.muted,
    "--sb-radius": `${theme.radius}px`,
    "--sb-density": `${theme.density}`,
    "--sb-font": fontStackOf(theme.fontFamily),
  };
}

export type { ThemePreset };
export { DEFAULT_THEME, FONT_STACKS, fontStackOf, THEME_PRESETS, themeVariables };
