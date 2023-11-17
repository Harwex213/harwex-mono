import { Bench } from "tinybench";

const ROWS = 100;
const COLS = 100;
const BIOMS = {
    GRASS: "GRASS",
    SNOW: "SNOW",
    DESERT: "DESERT",
};

const getBiom = () => {
    const rnd = Math.random();
    if (rnd > 0.66) {
        return BIOMS.GRASS;
    }
    if (rnd > 0.33) {
        return BIOMS.SNOW;
    }
    return BIOMS.DESERT;
};

const MAP_TILES_AMOUNT = ROWS * COLS;

const aosMap = {
    bioms: [...Array(MAP_TILES_AMOUNT)].map(() => getBiom()),
};

class Map {
    tiles = [...Array(MAP_TILES_AMOUNT)].map((_, i) => {
        const y = Math.floor(i / COLS);
        const x = i - y * COLS;

        return {
            x,
            y,
            biom: getBiom(),
        };
    });
}

const saoMap = new Map();

const bench = new Bench({ name: "simple benchmark", time: 10000 });

bench
    .add("array of structures", () => {
        for (let i = 0; i < MAP_TILES_AMOUNT; i++) {
            aosMap.bioms[i] = getBiom();
        }
    })
    .add("structure of arrays", () => {
        for (let i = 0; i < MAP_TILES_AMOUNT; i++) {
            saoMap.tiles[i] = getBiom();
        }
    });

await bench.run("bench");

console.log(bench.name);
console.table(bench.table());
