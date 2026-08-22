import { config } from "@hw/ostrov-prototype-v2-config";

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
    label: config.terrain.snowLabel,
    top: config.terrain.snowTop,
    rim: config.terrain.snowRim,
    wall: config.terrain.snowWall,
  },
  grass: {
    label: config.terrain.grassLabel,
    top: config.terrain.grassTop,
    rim: config.terrain.grassRim,
    wall: config.terrain.grassWall,
  },
  ice: {
    label: config.terrain.iceLabel,
    top: config.terrain.iceTop,
    rim: config.terrain.iceRim,
    wall: config.terrain.iceWall,
  },
  forest: {
    label: config.terrain.forestLabel,
    top: config.terrain.forestTop,
    rim: config.terrain.forestRim,
    wall: config.terrain.forestWall,
  },
  sand: {
    label: config.terrain.sandLabel,
    top: config.terrain.sandTop,
    rim: config.terrain.sandRim,
    wall: config.terrain.sandWall,
  },
};

export type { TerrainKind, TerrainStyle };
export { TERRAIN_KINDS, TERRAIN_STYLES };
