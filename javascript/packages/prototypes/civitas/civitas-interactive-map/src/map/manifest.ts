// The province manifest that ships beside the two map PNGs. The shape here
// mirrors `assets/provinces_manifest.json` exactly; see `.plan/PLAN.md` section 2.
//
// The parser is deliberately unforgiving. The manifest is a build artefact that
// ships with the app, so a mismatch is a build error and never something a user
// can cause. Coercing or defaulting a bad field would hide a broken asset behind
// a map that quietly picks the wrong provinces.

type ProvinceKind = "land" | "sea" | "lake";

type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Point = {
  x: number;
  y: number;
};

type Province = {
  id: number;
  name: string;
  kind: ProvinceKind;
  hex: string;
  rgb: [number, number, number];
  pixelCount: number;
  bounds: Bounds;
  centroid: Point;
};

type MapInfo = {
  source: string;
  width: number;
  height: number;
};

type PaintedInfo = {
  pixelCount: number;
  coverage: number;
  unregisteredColors: string[];
};

const MANIFEST_FORMAT = "civitas.province-map";
const MANIFEST_VERSION = 1;
const PROVINCE_KINDS: readonly ProvinceKind[] = ["land", "sea", "lake"];

type MapManifest = {
  format: typeof MANIFEST_FORMAT;
  version: typeof MANIFEST_VERSION;
  map: MapInfo;
  provinces: Province[];
  painted: PaintedInfo;
};

const HEX_PATTERN = /^#[0-9a-f]{6}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function provinceMessage(index: number, detail: string): string {
  return "manifest province at index " + index + ": " + detail;
}

function parseMapInfo(raw: unknown): MapInfo {
  const message =
    "manifest map must have a source string and a positive integer width and height";
  if (!isRecord(raw)) {
    throw new Error(message);
  }
  const source = raw.source;
  const width = raw.width;
  const height = raw.height;
  if (typeof source !== "string") {
    throw new Error(message);
  }
  if (!isInteger(width) || width <= 0 || !isInteger(height) || height <= 0) {
    throw new Error(message);
  }
  return { source, width, height };
}

function parseBounds(raw: unknown, index: number): Bounds {
  const message = provinceMessage(index, "bounds must be four non-negative integers");
  if (!isRecord(raw)) {
    throw new Error(message);
  }
  const x = raw.x;
  const y = raw.y;
  const width = raw.width;
  const height = raw.height;
  if (!isInteger(x) || x < 0 || !isInteger(y) || y < 0) {
    throw new Error(message);
  }
  if (!isInteger(width) || width < 0 || !isInteger(height) || height < 0) {
    throw new Error(message);
  }
  return { x, y, width, height };
}

function parseCentroid(raw: unknown, index: number): Point {
  const message = provinceMessage(index, "centroid must be two non-negative integers");
  if (!isRecord(raw)) {
    throw new Error(message);
  }
  const x = raw.x;
  const y = raw.y;
  if (!isInteger(x) || x < 0 || !isInteger(y) || y < 0) {
    throw new Error(message);
  }
  return { x, y };
}

function parseRgb(raw: unknown, index: number): [number, number, number] {
  const message = provinceMessage(index, "rgb must be three integers in 0..255");
  if (!Array.isArray(raw) || raw.length !== 3) {
    throw new Error(message);
  }
  for (const channel of raw) {
    if (!isInteger(channel) || channel < 0 || channel > 255) {
      throw new Error(message);
    }
  }
  // Rebuilt element by element so the tuple type is real rather than an
  // assertion over an `unknown[]`.
  return [Number(raw[0]), Number(raw[1]), Number(raw[2])];
}

function parseProvince(raw: unknown, index: number, seenIds: Set<number>): Province {
  if (!isRecord(raw)) {
    throw new Error(provinceMessage(index, "province must be a JSON object"));
  }

  const id = raw.id;
  if (!isInteger(id) || id <= 0) {
    throw new Error(provinceMessage(index, "id must be a positive integer"));
  }
  if (seenIds.has(id)) {
    throw new Error(provinceMessage(index, "id " + id + " is already used"));
  }
  seenIds.add(id);

  const name = raw.name;
  if (typeof name !== "string") {
    throw new Error(provinceMessage(index, "name must be a string"));
  }

  const kind = raw.kind;
  if (typeof kind !== "string" || !PROVINCE_KINDS.includes(kind as ProvinceKind)) {
    throw new Error(provinceMessage(index, "kind must be land, sea or lake"));
  }

  const rgb = parseRgb(raw.rgb, index);

  const hex = raw.hex;
  if (typeof hex !== "string" || !HEX_PATTERN.test(hex)) {
    throw new Error(provinceMessage(index, "hex must be #rrggbb"));
  }
  const decoded = Number.parseInt(hex.slice(1), 16);
  if (
    ((decoded >>> 16) & 0xff) !== rgb[0] ||
    ((decoded >>> 8) & 0xff) !== rgb[1] ||
    (decoded & 0xff) !== rgb[2]
  ) {
    throw new Error(
      provinceMessage(index, "hex " + hex + " disagrees with rgb [" + rgb.join(", ") + "]"),
    );
  }

  const pixelCount = raw.pixelCount;
  if (!isInteger(pixelCount) || pixelCount < 0) {
    throw new Error(provinceMessage(index, "pixelCount must be a non-negative integer"));
  }

  return {
    id,
    name,
    kind: kind as ProvinceKind,
    hex,
    rgb,
    pixelCount,
    bounds: parseBounds(raw.bounds, index),
    centroid: parseCentroid(raw.centroid, index),
  };
}

function parsePainted(raw: unknown): PaintedInfo {
  const message = "manifest painted summary is missing or malformed";
  if (!isRecord(raw)) {
    throw new Error(message);
  }
  const pixelCount = raw.pixelCount;
  const coverage = raw.coverage;
  const rawColors = raw.unregisteredColors;
  if (!isInteger(pixelCount) || pixelCount < 0) {
    throw new Error(message);
  }
  if (typeof coverage !== "number" || !Number.isFinite(coverage)) {
    throw new Error(message);
  }
  if (!Array.isArray(rawColors)) {
    throw new Error(message);
  }
  const unregisteredColors: string[] = [];
  for (const color of rawColors) {
    if (typeof color !== "string") {
      throw new Error(message);
    }
    unregisteredColors.push(color);
  }
  return { pixelCount, coverage, unregisteredColors };
}

// Returns newly built objects, never the parsed payload. Copying field by field
// is what makes the return type honest: an unvalidated extra key on the input
// cannot leak into a `MapManifest`.
//
// Duplicate colours are deliberately NOT checked here. A collision only matters
// where the pixel lookup table is built, so `buildColorIndex` in
// `province-index.ts` throws on it and this file stays free of packing knowledge.
function parseManifest(payload: unknown): MapManifest {
  if (!isRecord(payload)) {
    throw new Error("manifest is not a JSON object");
  }

  if (payload.format !== MANIFEST_FORMAT) {
    throw new Error(
      "manifest format is " +
        JSON.stringify(payload.format) +
        ", expected \"" +
        MANIFEST_FORMAT +
        "\"",
    );
  }
  // Strict `===`, so the string "1" is rejected as loudly as the number 2.
  if (payload.version !== MANIFEST_VERSION) {
    throw new Error(
      "manifest version is " + JSON.stringify(payload.version) + ", expected " + MANIFEST_VERSION,
    );
  }

  const map = parseMapInfo(payload.map);

  const rawProvinces = payload.provinces;
  if (!Array.isArray(rawProvinces)) {
    throw new Error("manifest has no provinces array");
  }

  const seenIds = new Set<number>();
  const provinces: Province[] = [];
  for (let i = 0; i < rawProvinces.length; i += 1) {
    provinces.push(parseProvince(rawProvinces[i], i, seenIds));
  }

  return {
    format: MANIFEST_FORMAT,
    version: MANIFEST_VERSION,
    map,
    provinces,
    painted: parsePainted(payload.painted),
  };
}

function parseManifestText(text: string): MapManifest {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("manifest is not valid JSON");
  }
  return parseManifest(payload);
}

// Province ids are NOT array positions. The real manifest runs id 1..1650 over
// 1648 entries — ids 1318 and 1458 do not exist. `provinces[id - 1]` returns the
// wrong province for every id past the first gap, so every lookup goes through
// this map.
function indexProvincesById(provinces: readonly Province[]): Map<number, Province> {
  const byId = new Map<number, Province>();
  for (const province of provinces) {
    byId.set(province.id, province);
  }
  return byId;
}

export {
  MANIFEST_FORMAT,
  MANIFEST_VERSION,
  PROVINCE_KINDS,
  indexProvincesById,
  parseManifest,
  parseManifestText,
  type Bounds,
  type MapInfo,
  type MapManifest,
  type PaintedInfo,
  type Point,
  type Province,
  type ProvinceKind,
};
