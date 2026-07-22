import { DEFAULT_MAPS } from "../data/maps.js";
import { DEFAULT_TERRAIN_ID } from "../data/terrains.js";

/**
 * State module for hex maps. Pure: no storage access — the composition root
 * hydrates from a raw localStorage string and persists on `rev` changes
 * (see the persister in index.js). Mutators that must reach storage bump
 * `rev`; in-memory-only ones (setMapCell) don't.
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

/**
 * @returns {MapsState}
 */
const createMaps = () => ({ maps: [], rev: 0 });

// the rev counter is runtime wiring, not data — only the maps are serialized
/**
 * @param {MapsState} maps
 * @returns {string}
 */
const serializeMaps = (maps) => JSON.stringify({ maps: maps.maps });

/**
 * Seeding bumps `rev` so the persister writes the seeds back; a clean load
 * leaves `rev` untouched.
 *
 * @param {MapsState} maps
 * @param {string | null} raw the stored JSON string, or null
 */
const hydrateMaps = (maps, raw) => {
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }
  if (!isValidShape(data)) {
    maps.maps = seedMaps();
    maps.rev += 1;
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
  maps.rev += 1;
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
  maps.rev += 1;
};

/**
 * @param {MapsState} maps
 * @param {number | string} id
 */
const deleteMap = (maps, id) => {
  maps.maps = maps.maps.filter((m) => String(m.id) !== String(id));
  maps.rev += 1;
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
  maps.rev += 1;
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
  maps.rev += 1;
};

export {
  createMaps,
  serializeMaps,
  hydrateMaps,
  getMap,
  createMap,
  renameMap,
  deleteMap,
  setMapCell,
  commitMap,
  setMapImage,
};
