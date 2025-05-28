import { BIOM_TYPE, TILE_TYPE } from "../model/enums.js";
import { TiledMap } from "../model/tiledMap.js";

/**
 * type Tile {
 *     x: number;
 *     y: number;
 * }
 *
 * type TiledMap {
 *      tiles: Tile[];
 *      rows: number;
 *      cols: number;
 * }
 *
 * type TiledMapGeneratorContext {
 *      size: [number, number];
 *      createTile: (x: number, y: number) => Tile;
 * }
 */

const I = {
    ROWS: 0,
    COLS: 1,
};

const generateMockTiledMap = (size) => {
    const tiledMap = new TiledMap(size[I.ROWS], size[I.COLS]);

    const setTileType = (tile, row) => {
        if (row % 2 === 0) {
            tile.type = TILE_TYPE.LAND;
        } else {
            tile.type = TILE_TYPE.SEA;
        }
    };
    const colorBiom = (tile) => {
        if (tile.isLand) {
            const rnd = Math.random();

            if (rnd > 0.8) {
                tile.biom = BIOM_TYPE.DESERT;
            }
            if (rnd > 0.6) {
                tile.biom = BIOM_TYPE.FLATLAND;
            }
            if (rnd > 0.3) {
                tile.biom = BIOM_TYPE.GRASSLAND;
            } else {
                tile.biom = BIOM_TYPE.TUNDRA;
            }
        }
    };

    for (let row = 0; row < size[I.ROWS]; row++) {
        for (let col = 0; col < size[I.COLS]; col++) {
            const tile = tiledMap.tiles[row][col];

            setTileType(tile, row);
            colorBiom(tile);
        }
    }
};

export { generateMockTiledMap };
