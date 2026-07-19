import { DEFAULT_MAPS } from "../data/maps.js";
import { DEFAULT_TERRAIN_ID } from "../data/terrains.js";
import { MAPS_LS_KEY } from "../data/local-storage-keys.js";

/**
 * Domain module for hex maps, persisted through the storage adapter injected
 * by the composition root (model.js passes localStorage; tests pass a fake).
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

const DEFAULT_WIDTH = 14;
const DEFAULT_HEIGHT = 12;

const makeCells = (width, height, terrainId) =>
  Array.from({ length: height }, () => Array.from({ length: width }, () => terrainId));

/**
 * Legacy catalog maps become ordinary hex maps: a uniform fill of their
 * namesake terrain, keeping the PNG as the store-tile preview.
 */
const SEED_FILL = { plains: "plain", water: "water", hills: "hills" };

const seedMaps = () => DEFAULT_MAPS.map((m, index) => ({
  id: index + 1,
  name: m.name,
  width: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT,
  cells: makeCells(DEFAULT_WIDTH, DEFAULT_HEIGHT, SEED_FILL[m.id] ?? DEFAULT_TERRAIN_ID),
  image: m.image,
}));

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

const nextMapId = (maps) => maps.maps.reduce((max, m) => Math.max(max, Number(m.id) || 0), 0) + 1;

// the adapter is runtime wiring, not data — only the maps are serialized
const persist = (maps) => {
  maps.storage.setItem(MAPS_LS_KEY, JSON.stringify({ maps: maps.maps }));
};

/**
 * @param {{ storage: StorageAdapter }} deps
 * @returns {MapsState}
 */
const createMaps = ({ storage }) => ({ storage, maps: [] });

/**
 * @param {MapsState} maps
 */
const hydrateMaps = (maps) => {
  let data = null;
  try {
    data = JSON.parse(maps.storage.getItem(MAPS_LS_KEY));
  } catch {
    data = null;
  }
  if (!isValidShape(data)) {
    maps.maps = seedMaps();
    persist(maps);
    return;
  }
  maps.maps = data.maps;
};

/**
 * id may arrive as a string (route param) or number (in-memory) — compare loosely.
 *
 * @param {MapsState} maps
 * @param {number | string} id
 * @returns {HexMap | null}
 */
const getMap = (maps, id) => maps.maps.find((m) => String(m.id) === String(id)) ?? null;

/**
 * @param {MapsState} maps
 * @returns {HexMap}
 */
const createMap = (maps) => {
  const id = nextMapId(maps);
  const map = {
    id,
    name: `Untitled ${id}`,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    cells: makeCells(DEFAULT_WIDTH, DEFAULT_HEIGHT, DEFAULT_TERRAIN_ID),
  };
  maps.maps.push(map);
  persist(maps);
  return map;
};

/**
 * @param {MapsState} maps
 * @param {number | string} id
 * @param {string} name
 */
const renameMap = (maps, id, name) => {
  const map = getMap(maps, id);
  if (!map) {
    return;
  }
  map.name = name;
  persist(maps);
};

/**
 * @param {MapsState} maps
 * @param {number | string} id
 */
const deleteMap = (maps, id) => {
  maps.maps = maps.maps.filter((m) => String(m.id) !== String(id));
  persist(maps);
};

/**
 * In-memory only — a paint stroke calls this per cell and commitMap() once on
 * release, so a drag isn't a storage write per hex.
 *
 * @param {MapsState} maps
 * @param {number | string} id
 * @param {number} row
 * @param {number} col
 * @param {string} terrainId
 */
const setMapCell = (maps, id, row, col, terrainId) => {
  const map = getMap(maps, id);
  if (!map?.cells[row] || map.cells[row][col] === undefined) {
    return;
  }
  map.cells[row][col] = terrainId;
};

/**
 * cells changed → any stored preview no longer matches them.
 *
 * @param {MapsState} maps
 * @param {number | string} id
 */
const commitMap = (maps, id) => {
  const map = getMap(maps, id);
  if (map) {
    delete map.image;
  }
  persist(maps);
};

/**
 * @param {MapsState} maps
 * @param {number | string} id
 * @param {string} dataUrl
 */
const setMapImage = (maps, id, dataUrl) => {
  const map = getMap(maps, id);
  if (!map) {
    return;
  }
  map.image = dataUrl;
  persist(maps);
};

const MAPS_MODULE = {
  create: createMaps,
  hydrate: hydrateMaps,
  getMap: getMap,
  createMap: createMap,
  renameMap: renameMap,
  deleteMap: deleteMap,
  setMapCell: setMapCell,
  commitMap: commitMap,
  setMapImage: setMapImage,
};

export { MAPS_MODULE };
