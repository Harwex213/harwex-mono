import { signal } from "@hw/signals";
import { TILE_CLIMATE } from "../constants.js";
import { ASSET } from "../constants.js";
import { TILE_TYPE } from "../constants.js";
import { ASSET as TILE_ASSET } from "../constants.js";
import { LEFT_BOTTOM_BORDER } from "../constants.js";
import { RIGHT_TOP_BORDER } from "../constants.js";
import { LEFT_TOP_BORDER } from "../constants.js";
import { NO_BORDER } from "../constants.js";

class Map {
    #nextRegionId;

    constructor(MAP_WIDTH, MAP_HEIGHT) {
        const grid = [];

        for (let row = 0; row < MAP_HEIGHT; row++) {
            grid[row] = [];

            for (let col = 0; col < MAP_WIDTH; col++) {
                const type = TILE_TYPE.WATER;
                const climate = TILE_CLIMATE.NOTHING;
                const asset = ASSET.WATER;

                grid[row][col] = {
                    row,
                    col,
                    type,
                    climate,
                    regionId: signal(null),
                    asset: signal(asset),
                    spriteIndex: -1,
                };
            }
        }

        this.grid = grid;
        this.mapHeight = grid.length;
        this.mapWidth = grid[0].length;

        this.regions = {};

        this.#nextRegionId = 0;
    }

    get regionIds() {
        return Reflect.ownKeys(this.regions);
    }

    tile(row, col) {
        return this.grid[row][col];
    }

    region(regionId) {
        return this.regions[regionId];
    }

    createRegion(color) {
        const region = {
            id: this.#nextRegionId.toString(),
            tiles: [],
            border: [],
            color,
        };

        this.#nextRegionId++;

        this.regions[region.id] = region;

        return region.id;
    }

    removeRegion(id) {
        delete this.regions[id];
    }

    assignAssetToTile(row, col, asset) {
        if (!TILE_ASSET[asset]) {
            throw new Error(`Unkown asset by row ${row}, col ${col}, asset ${asset}`);
        }

        const tile = this.tile(row, col);

        if (asset === TILE_ASSET.WATER) {
            tile.type = TILE_TYPE.WATER;
            tile.climate = TILE_CLIMATE.NOTHING;
        } else {
            tile.type = TILE_TYPE.LAND;

            if (asset === TILE_ASSET.GRASS) {
                tile.climate = TILE_CLIMATE.GRASS;
            }
            if (asset === TILE_ASSET.MEDIUM) {
                tile.climate = TILE_CLIMATE.MEDIUM;
            }
        }

        tile.asset.value = asset;
    }

    assignTileToRegion(row, col, regionId) {
        const { mapHeight, mapWidth } = this;

        const region = this.region(regionId);
        const tileToAdd = this.tile(row, col);

        region.tiles.push(tileToAdd);
        region.border = [];

        for (const tile of region.tiles) {
            const { row, col } = tile;

            const traverseCoords = [
                // up by Y
                [Math.min(mapHeight - 1, row + 1), col, LEFT_TOP_BORDER],

                // down by Y
                [Math.max(0, row - 1), col, RIGHT_TOP_BORDER],

                // right by X
                [row, Math.min(mapWidth - 1, col + 1), LEFT_BOTTOM_BORDER],

                // left by Y
                [row, Math.max(0, col - 1), RIGHT_TOP_BORDER],
            ];

            let regionBorder = NO_BORDER;

            for (const [candidateRow, candidateCol, border] of traverseCoords) {
                const candidateTile = this.tile(candidateRow, candidateCol);
                if (candidateTile.regionId.peek() !== regionId) {
                    regionBorder |= border;
                }
            }

            if (regionBorder !== NO_BORDER) {
                region.border.push({
                    row,
                    col,
                    mask: regionBorder,
                });
            }
        }

        tileToAdd.regionId.value = regionId;
    }
}

const createMap = (MAP_WIDTH, MAP_HEIGHT) => new Map(MAP_WIDTH, MAP_HEIGHT);

export { createMap };
