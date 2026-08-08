type TerrainKind = "snow" | "grass" | "ice" | "forest" | "sand";

type TerrainStyle = {
  /** Human label for the overlay panel. */
  label: string;
  /** Flat colour of the top face. */
  top: string;
  /** Slightly darker tone used for the rim shading of the top face. */
  rim: string;
  /** Tint mixed into the cliff walls so terrain reads down the side too. */
  wall: string;
};

const TERRAIN_KINDS: readonly TerrainKind[] = ["snow", "grass", "ice", "forest", "sand"];

const TERRAIN_STYLES: Record<TerrainKind, TerrainStyle> = {
  snow: {
    label: "Снег",
    top: "#f2f6f9",
    rim: "#d3e0ea",
    wall: "#7d94a4",
  },
  grass: {
    label: "Луг",
    top: "#93c24a",
    rim: "#6f9f34",
    wall: "#6f8b74",
  },
  ice: {
    label: "Лёд",
    top: "#c5dee8",
    rim: "#9dc2d4",
    wall: "#6f8fa4",
  },
  forest: {
    label: "Лес",
    top: "#eaf1f6",
    rim: "#cbdae6",
    wall: "#77909f",
  },
  sand: {
    label: "Пустошь",
    top: "#e6dcc3",
    rim: "#cbbe9c",
    wall: "#8b8b7e",
  },
};

export type { TerrainKind, TerrainStyle };
export { TERRAIN_KINDS, TERRAIN_STYLES };
