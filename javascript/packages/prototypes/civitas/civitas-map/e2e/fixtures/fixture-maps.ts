import { encodePng } from "./png";

// The images the mocked map library serves. All of them are drawn here.
//
// `fixture-map.png` is a small hand-drawn-style map: blue water, one large island
// split into four provinces by dark ink borders, and a small second island. The
// colours sit inside the default thresholds of `Detect borders`: the water is
// blue-dominant and bright, the land is green-dominant, the ink is dark.
//
// `fixture-provinces.png` and `fixture-provinces.json` are a provinces export for
// that map, the pair `Export PNG + JSON` writes. `wrong-size.png` is a provinces
// image of another size, which the editor must refuse.

type Rgb = [number, number, number];

const MAP_WIDTH = 360;
const MAP_HEIGHT = 240;

const WATER: Rgb = [38, 84, 150];
const LAND: Rgb = [118, 146, 84];
const HILLS: Rgb = [138, 150, 96];
const INK: Rgb = [20, 25, 34];

const ISLAND = { cx: 170, cy: 122, rx: 124, ry: 82 };
const ISLET = { cx: 318, cy: 46, r: 20 };

// Each province of the export: a colour, a name, and a rectangle inside the island.
const EXPORTED = [
  { id: 1, name: "Northmark", kind: "land", rgb: [214, 96, 77] as Rgb, rect: { x: 80, y: 70, w: 70, h: 40 } },
  { id: 2, name: "Eastvale", kind: "land", rgb: [92, 170, 214] as Rgb, rect: { x: 190, y: 70, w: 80, h: 40 } },
  { id: 3, name: "Southreach", kind: "land", rgb: [238, 196, 72] as Rgb, rect: { x: 110, y: 140, w: 120, h: 40 } },
];

function createCanvas(width: number, height: number): Uint8Array {
  return new Uint8Array(width * height * 4);
}

function setPixel(rgba: Uint8Array, width: number, x: number, y: number, rgb: Rgb, alpha = 255): void {
  const index = (y * width + x) * 4;
  rgba[index] = rgb[0];
  rgba[index + 1] = rgb[1];
  rgba[index + 2] = rgb[2];
  rgba[index + 3] = alpha;
}

function insideIsland(x: number, y: number): boolean {
  const dx = (x - ISLAND.cx) / ISLAND.rx;
  const dy = (y - ISLAND.cy) / ISLAND.ry;
  return dx * dx + dy * dy <= 1;
}

function insideIslet(x: number, y: number): boolean {
  const dx = x - ISLET.cx;
  const dy = y - ISLET.cy;
  return dx * dx + dy * dy <= ISLET.r * ISLET.r;
}

// The ink: a vertical border that bends once, and a horizontal border across
// the island. Together they cut the island into four provinces.
function onBorder(x: number, y: number): boolean {
  const verticalX = y < 122 ? 172 : 160;
  if (Math.abs(x - verticalX) <= 1) {
    return true;
  }
  if (y === 122 && x >= 160 && x <= 172) {
    return true;
  }
  const horizontalY = 122 + Math.round((x - ISLAND.cx) * 0.12);
  return Math.abs(y - horizontalY) <= 1;
}

function drawFixtureMap(): Buffer {
  const rgba = createCanvas(MAP_WIDTH, MAP_HEIGHT);
  for (let y = 0; y < MAP_HEIGHT; y += 1) {
    for (let x = 0; x < MAP_WIDTH; x += 1) {
      let color = WATER;
      if (insideIsland(x, y)) {
        // A band of hills, so the base map is not one flat colour.
        const hills = Math.abs(x - 120) + Math.abs(y - 100) < 34;
        color = onBorder(x, y) ? INK : hills ? HILLS : LAND;
      } else if (insideIslet(x, y)) {
        color = LAND;
      }
      setPixel(rgba, MAP_WIDTH, x, y, color);
    }
  }
  return encodePng(MAP_WIDTH, MAP_HEIGHT, rgba);
}

function drawProvincesExport(): Buffer {
  // Transparent wherever nothing is painted, as the editor exports it.
  const rgba = createCanvas(MAP_WIDTH, MAP_HEIGHT);
  for (const province of EXPORTED) {
    for (let y = province.rect.y; y < province.rect.y + province.rect.h; y += 1) {
      for (let x = province.rect.x; x < province.rect.x + province.rect.w; x += 1) {
        setPixel(rgba, MAP_WIDTH, x, y, province.rgb);
      }
    }
  }
  return encodePng(MAP_WIDTH, MAP_HEIGHT, rgba);
}

function hex(rgb: Rgb): string {
  return "#" + rgb.map((channel) => {
    return channel.toString(16).padStart(2, "0");
  }).join("");
}

function provincesManifest(): string {
  return JSON.stringify({
    format: "civitas.province-map",
    version: 1,
    map: { source: "fixture-map.png", width: MAP_WIDTH, height: MAP_HEIGHT },
    provinces: EXPORTED.map((province) => {
      return {
        id: province.id,
        name: province.name,
        kind: province.kind,
        hex: hex(province.rgb),
        rgb: province.rgb,
      };
    }),
  });
}

function drawWrongSize(): Buffer {
  const width = 100;
  const height = 80;
  const rgba = createCanvas(width, height);
  for (let y = 20; y < 60; y += 1) {
    for (let x = 20; x < 80; x += 1) {
      setPixel(rgba, width, x, y, [214, 96, 77]);
    }
  }
  return encodePng(width, height, rgba);
}

type FixtureFile = {
  body: Buffer;
  contentType: string;
};

// Keyed by file name, as the mocked server serves them under `assets/maps/`.
function createFixtureFiles(): Map<string, FixtureFile> {
  return new Map([
    ["fixture-map.png", { body: drawFixtureMap(), contentType: "image/png" }],
    ["fixture-provinces.png", { body: drawProvincesExport(), contentType: "image/png" }],
    ["fixture-provinces.json", { body: Buffer.from(provincesManifest()), contentType: "application/json" }],
    ["wrong-size.png", { body: drawWrongSize(), contentType: "image/png" }],
  ]);
}

export { MAP_HEIGHT, MAP_WIDTH, createFixtureFiles, type FixtureFile };
