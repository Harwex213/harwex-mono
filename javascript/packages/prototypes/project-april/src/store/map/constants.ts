export const TILE_WIDTH = 512;
export const TILE_HEIGHT = 256;

export const ASSET = {
    TABULA_RASA: "Sprite-tabularasa.png",
    WATER: "Sprite-water.png",
    GRASS: "Sprite-grass.png",
    MEDIUM: "Sprite-medium.png",
    BORDER_0: "Sprite-border-0.png",
    BORDER_1: "Sprite-border-1.png",
    BORDER_2: "Sprite-border-2.png",
    BORDER_3: "Sprite-border-3.png",
} as const;

export type TAsset = keyof typeof ASSET;

export const TILE_TYPE = {
    WATER: "WATER",
    LAND: "LAND",
} as const;

export type TTileType = keyof typeof TILE_TYPE;

export const TILE_CLIMATE = {
    NOTHING: "NOTHING",
    GRASS: "GRASS",
    MEDIUM: "MEDIUM",
} as const;

export type TTileClimate = keyof typeof TILE_CLIMATE;

export const NO_BORDER = 0b0000;
export const LEFT_TOP_BORDER = 0b0001;
export const LEFT_BOTTOM_BORDER = 0b0010;
export const RIGHT_BOTTOM_BORDER = 0b0100;
export const RIGHT_TOP_BORDER = 0b1000;
