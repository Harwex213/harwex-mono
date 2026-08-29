type TTeamPalette = {
  body: string;
  bodyDark: string;
  ring: string;
  glyph: string;
  zone: string;
  shot: string;
};

const PALETTE = {
  backdropInner: "#132a3f",
  backdropOuter: "#08131f",
  boardLine: "rgba(150, 195, 235, 0.18)",
  boardEdge: "rgba(170, 215, 255, 0.38)",
  neutralBand: "rgba(200, 225, 245, 0.05)",
  shadow: "rgba(0, 0, 0, 0.35)",
  hpBack: "rgba(6, 14, 22, 0.75)",
  hpGood: "#7fd08a",
  hpFair: "#ffd75e",
  hpBad: "#e0603f",
  heal: "#8ff0b5",
  damageText: "#ffd0c2",
  healText: "#a8f5c6",
  selection: "#ffd75e",
  hover: "rgba(255, 255, 255, 0.55)",
  invalid: "#e0603f",
} as const;

const TEAM_PALETTE: Record<"player" | "enemy", TTeamPalette> = {
  player: {
    body: "#3f8fd0",
    bodyDark: "#1d4f7c",
    ring: "#a6dcff",
    glyph: "#eaf6ff",
    zone: "rgba(90, 175, 245, 0.10)",
    shot: "#bfe6ff",
  },
  enemy: {
    body: "#c25a3c",
    bodyDark: "#79301f",
    ring: "#ffb489",
    glyph: "#fff0e6",
    zone: "rgba(230, 120, 80, 0.10)",
    shot: "#ffc3a1",
  },
};

const healthColor = (share: number): string => {
  if (share > 0.55) {
    return PALETTE.hpGood;
  }

  if (share > 0.25) {
    return PALETTE.hpFair;
  }

  return PALETTE.hpBad;
};

export type { TTeamPalette };
export { PALETTE, TEAM_PALETTE, healthColor };
