import { TILE_TYPE } from "./enums.js";

class Tile {
    row;
    col;
    type;
    biom;

    constructor(row, col) {
        this.row = row;
        this.col = col;
    }

    get isLand() {
        return this.type === TILE_TYPE.LAND;
    }
    get isSea() {
        return this.type === TILE_TYPE.SEA;
    }
}

class TiledMap {
    constructor(rows, cols) {
        this.rows = Math.max(rows, 0);
        this.cols = Math.max(cols, 0);

        this.tiles = Array.from(Array(this.rows), (_, row) => {
            return Array.from(Array(this.cols), (_, col) => new Tile(row, col));
        });
    }
}

export { TiledMap, Tile };
