import { TILE_TYPE } from "../constants.js";
import { TILE_CLIMATE } from "../constants.js";
import { ASSET } from "../constants.js";
import { NO_BORDER } from "../constants.js";
import { LEFT_BOTTOM_BORDER } from "../constants.js";
import { RIGHT_TOP_BORDER } from "../constants.js";
import { LEFT_TOP_BORDER } from "../constants.js";
import { RIGHT_BOTTOM_BORDER } from "../constants.js";
import { signal } from "@hw/signals";

const MAP_WIDTH = 60;
const MAP_HEIGHT = 60;
const REGION_SIZE = 6;

const defineType = (row, col) =>
    row <= 3 || row >= MAP_HEIGHT - 3 || col <= 3 || col >= MAP_WIDTH - 3 ? TILE_TYPE.WATER : TILE_TYPE.LAND;

const defineClimate = (row, col, type) => {
    if (type === TILE_TYPE.LAND) {
        return Math.random() > 0.5 ? TILE_CLIMATE.GRASS : TILE_CLIMATE.MEDIUM;
    }

    return TILE_CLIMATE.NOTHING;
};

const defineBorder = (row, col) => {
    let border = NO_BORDER;

    if (row % REGION_SIZE === 0) {
        border |= RIGHT_TOP_BORDER;
    }
    if (col % REGION_SIZE === 0) {
        border |= LEFT_TOP_BORDER;
    }

    return border;
};

const getTileAsset = (type, climate) => {
    if (type === TILE_TYPE.WATER) {
        return ASSET.WATER;
    } else {
        if (climate === TILE_CLIMATE.GRASS) {
            return ASSET.GRASS;
        }
        if (climate === TILE_CLIMATE.MEDIUM) {
            return ASSET.MEDIUM;
        }
    }

    throw new Error("Unresolved tile asset");
};

const getBorderAssets = (border) => {
    const assets = [];

    if (border & LEFT_TOP_BORDER) {
        assets.push(ASSET.BORDER_0);
    }
    if (border & LEFT_BOTTOM_BORDER) {
        assets.push(ASSET.BORDER_1);
    }
    if (border & RIGHT_BOTTOM_BORDER) {
        assets.push(ASSET.BORDER_2);
    }
    if (border & RIGHT_TOP_BORDER) {
        assets.push(ASSET.BORDER_3);
    }

    if (assets.length > 0) {
        return assets;
    }

    throw new Error("Unresolved border asset: ", border);
};

/**
 * @deprecated
 */
const generateMap = () => {
    const grid = [];
    const tilesWithBorder = [];

    for (let row = 0; row < MAP_HEIGHT; row++) {
        grid[row] = [];

        for (let col = 0; col < MAP_WIDTH; col++) {
            const type = defineType(row, col);
            const climate = defineClimate(row, col, type);
            const border = defineBorder(row, col);
            const asset = getTileAsset(type, climate);

            const tile = {
                row,
                col,
                type,
                climate,
                border,
                asset: signal(asset),
                borderAssets: signal([]),
            };

            if (border !== NO_BORDER) {
                tile.borderAssets.value = getBorderAssets(border);
                tilesWithBorder.push(tile);
            }

            grid[row][col] = tile;
        }
    }

    return {
        grid,
        tilesWithBorder,
    };
};

export { generateMap };
