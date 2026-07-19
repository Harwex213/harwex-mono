import { DEFAULT_MAPS } from "../data/maps.js";
import { DEFAULT_TERRAIN_ID } from "../data/terrains.js";

/**
 * Domain store for hex maps. Mirrors modifiers-store.js: a module singleton
 * mutated only through the exported helpers, hydrated from / persisted to
 * localStorage.
 *
 * Shape:
 *   map = { id: number, name: string, width, height, cells: string[][], image?: string }
 *
 * `cells[row][col]` is a terrain id — pointy-top hexes, odd-r offset rows
 * (odd rows shift right by half a hex). Convert offset→axial in helpers when
 * neighbor/distance logic arrives; the grid itself stays the stored shape.
 *
 * `image` is the store-tile preview. Invariant: a `data:` image always matches
 * `cells` — commitMap() drops the image on any cell change and callers restore
 * it via setMapImage() (the editor on teardown, the maps page lazily for maps
 * whose image is missing or still a legacy static-catalog PNG path).
 */

const STORAGE_KEY = "hw.faenwald.maps.v2";
const DEFAULT_WIDTH = 14;
const DEFAULT_HEIGHT = 12;

const store = { maps: [] };

const makeCells = (width, height, terrainId) =>
  Array.from({ length: height }, () => Array.from({ length: width }, () => terrainId));

/**
 * Legacy catalog maps become ordinary hex maps: a uniform fill of their
 * namesake terrain, keeping the PNG as the store-tile preview.
 */
const SEED_FILL = { plains: "plain", water: "water", hills: "hills" };

const seed = () => ({
  maps: DEFAULT_MAPS.map((m, index) => ({
    id: index + 1,
    name: m.name,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    cells: makeCells(DEFAULT_WIDTH, DEFAULT_HEIGHT, SEED_FILL[m.id] ?? DEFAULT_TERRAIN_ID),
    image: m.image,
  })),
});

const isValidShape = (data) =>
  Boolean(data) &&
  Array.isArray(data.maps) &&
  data.maps.every(
    (m) =>
      m &&
      m.id != null &&
      typeof m.name === "string" &&
      Number.isInteger(m.width) &&
      Number.isInteger(m.height) &&
      Array.isArray(m.cells) &&
      m.cells.every((row) => Array.isArray(row)),
  );

const nextMapId = () => store.maps.reduce((max, m) => Math.max(max, Number(m.id) || 0), 0) + 1;

const persist = () => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
};

const load = () => {
  let data = null;
  try {
    data = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    data = null;
  }
  if (!isValidShape(data)) {
    store.maps = seed().maps;
    persist();
    return;
  }
  store.maps = data.maps;
};

load();

const getMaps = () => store.maps;

// id may arrive as a string (route param) or number (in-memory) — compare loosely
const getMap = (id) => store.maps.find((m) => String(m.id) === String(id)) ?? null;

const createMap = () => {
  const id = nextMapId();
  const map = {
    id,
    name: `Untitled ${id}`,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    cells: makeCells(DEFAULT_WIDTH, DEFAULT_HEIGHT, DEFAULT_TERRAIN_ID),
  };
  store.maps.push(map);
  persist();
  return map;
};

const renameMap = (id, name) => {
  const map = getMap(id);
  if (!map) return;
  map.name = name;
  persist();
};

const deleteMap = (id) => {
  store.maps = store.maps.filter((m) => String(m.id) !== String(id));
  persist();
};

/**
 * In-memory only — a paint stroke calls this per cell and commitMap() once on
 * release, so a drag isn't a localStorage write per hex.
 */
const setMapCell = (id, row, col, terrainId) => {
  const map = getMap(id);
  if (!map?.cells[row] || map.cells[row][col] === undefined) return;
  map.cells[row][col] = terrainId;
};

// cells changed → any stored preview no longer matches them
const commitMap = (id) => {
  const map = getMap(id);
  if (map) delete map.image;
  persist();
};

const setMapImage = (id, dataUrl) => {
  const map = getMap(id);
  if (!map) return;
  map.image = dataUrl;
  persist();
};

export { getMaps, getMap, createMap, renameMap, deleteMap, setMapCell, commitMap, setMapImage }
