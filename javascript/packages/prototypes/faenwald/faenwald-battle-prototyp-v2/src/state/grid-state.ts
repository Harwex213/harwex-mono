import { computed, signal } from "@preact/signals-react";
import { buildGrid, cellKey, type HexCell } from "../hex/hex-layout";

type Terrain = "plain" | "path" | "arcane" | "hills" | "crag";

const COLS = 13;
const ROWS = 15;

const grid = buildGrid(COLS, ROWS);

// Hand-placed blobs. The example grid is static, so the terrain map is built
// once instead of living in a signal.
const PATH: Array<[number, number]> = [
  [6, 0],
  [5, 1],
  [6, 2],
  [5, 3],
  [6, 4],
  [5, 5],
  [6, 6],
  [5, 7],
  [6, 8],
  [5, 9],
  [6, 10],
  [5, 11],
  [6, 12],
  [5, 13],
  [6, 14],
];

const ARCANE: Array<[number, number]> = [
  [3, 0],
  [4, 0],
  [2, 1],
  [3, 1],
  [4, 1],
  [3, 2],
  [4, 2],
  [3, 3],
  [4, 3],
  [7, 3],
  [8, 3],
  [7, 4],
  [8, 4],
  [4, 10],
  [3, 11],
  [4, 11],
  [7, 11],
  [8, 11],
  [4, 12],
  [7, 12],
];

const HILLS: Array<[number, number]> = [
  [1, 4],
  [2, 4],
  [3, 4],
  [0, 5],
  [1, 5],
  [2, 5],
  [3, 5],
  [0, 6],
  [1, 6],
  [2, 6],
  [3, 6],
  [0, 7],
  [1, 7],
  [2, 7],
  [1, 8],
  [2, 8],
  [10, 5],
  [11, 5],
  [9, 6],
  [10, 6],
  [11, 6],
  [9, 7],
  [10, 7],
  [11, 7],
  [9, 8],
  [10, 8],
];

const CRAG: Array<[number, number]> = [
  [1, 5],
  [2, 5],
  [1, 6],
  [2, 6],
  [1, 7],
  [10, 6],
  [10, 7],
];

const terrainByKey = buildTerrainMap();

const cellByKey = new Map(grid.cells.map((cell) => [cell.key, cell]));

const selectedKey = signal<string | null>(null);

const selectedCell = computed<HexCell | null>(() => {
  const key = selectedKey.value;
  if (key === null) {
    return null;
  }
  return cellOf(key);
});

const hoveredKey = signal<string | null>(null);

const hoveredCell = computed<HexCell | null>(() => {
  const key = hoveredKey.value;
  if (key === null) {
    return null;
  }
  return cellOf(key);
});

function buildTerrainMap(): Map<string, Terrain> {
  const map = new Map<string, Terrain>();
  const layers: Array<[Terrain, Array<[number, number]>]> = [
    ["hills", HILLS],
    ["crag", CRAG],
    ["arcane", ARCANE],
    ["path", PATH],
  ];

  for (const [terrain, coords] of layers) {
    for (const [col, row] of coords) {
      map.set(cellKey(col, row), terrain);
    }
  }

  return map;
}

function cellOf(key: string): HexCell | null {
  return cellByKey.get(key) ?? null;
}

function terrainOf(key: string): Terrain {
  return terrainByKey.get(key) ?? "plain";
}

function selectCell(key: string): void {
  selectedKey.value = selectedKey.value === key ? null : key;
}

// Selects without the toggle above. A control outside the canvas — a roster row
// pointing at a placed unit, say — uses this: clicking it twice should leave the
// unit selected rather than blink the selection off.
function focusCell(key: string): void {
  selectedKey.value = key;
}

function hoverCell(key: string | null): void {
  hoveredKey.value = key;
}

export {
  COLS,
  ROWS,
  cellOf,
  focusCell,
  grid,
  hoverCell,
  hoveredCell,
  hoveredKey,
  selectCell,
  selectedCell,
  selectedKey,
  terrainOf,
};
export type { Terrain };
