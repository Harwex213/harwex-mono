import { Sprite } from "pixi.js";
import { TILE_WIDTH } from "../constants.js";
import { TILE_HEIGHT } from "../constants.js";
import { ASSET } from "../constants.js";
import { effect } from "@hw/signals";

const renderMapTilesFactory = (map, sheet, viewport) => (renderTile) => {
    const { grid, mapWidth, mapHeight } = map;

    const isoX = (mapWidth * TILE_WIDTH - TILE_WIDTH) / 2;
    const isoY = 0;

    for (let row = 0; row < grid.length; row++) {
        const tiles = grid[row];

        for (let col = 0; col < tiles.length; col++) {
            const sprite = renderTile(map, row, col, sheet.textures);

            sprite.x = isoX + ((row - col) * TILE_WIDTH) / 2;
            sprite.y = isoY + ((row + col) * TILE_HEIGHT) / 2;

            viewport.addChild(sprite);
            sprite.spriteIndex = viewport.children.length - 1;
        }
    }

    viewport.moveCenter((mapWidth * TILE_WIDTH) / 2, (mapHeight * TILE_HEIGHT) / 2);
};

class MapRenderer {
    #map;
    #sheet;
    #viewport;
    #renderMapTiles;

    constructor(map, sheet, viewport) {
        this.#map = map;
        this.#sheet = sheet;
        this.#viewport = viewport;
        this.#renderMapTiles = renderMapTilesFactory(map, sheet, viewport);
    }

    clearChildren() {
        this.#viewport.removeChildren();
    }

    renderMapTiles() {
        this.#renderMapTiles((map, row, col, textures) => {
            const tile = map.tile(row, col);
            const sprite = new Sprite(textures[tile.asset.peek()]);

            effect(() => {
                sprite.texture = textures[tile.asset.value];
            });

            return sprite;
        });
    }

    renderMapTilesByRegions() {
        this.#renderMapTiles((map, row, col, textures) => {
            const tile = map.tile(row, col);
            const sprite = new Sprite(textures[ASSET.TABULA_RASA]);

            effect(() => {
                const regionId = tile.regionId.value;
                if (regionId !== null) {
                    sprite.tint = map.region(regionId).color;
                }
            });

            return sprite;
        });
    }

    renderMapRegions() {
        // TODO
    }
}

export { MapRenderer };
