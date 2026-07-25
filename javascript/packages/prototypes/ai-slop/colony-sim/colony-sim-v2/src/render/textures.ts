import { Assets, Rectangle, Texture } from "pixi.js";
import chickenUrl from "@assets/Animals/Chicken.png";
import grassUrl from "@assets/Ground/Grass.png";
import texturedGrassUrl from "@assets/Ground/TexturedGrass.png";
import shoreUrl from "@assets/Ground/Shore.png";
import deadGrassUrl from "@assets/Ground/DeadGrass.png";
import treesUrl from "@assets/Nature/Trees.png";
import rocksUrl from "@assets/Nature/Rocks.png";

// The sheets ship without JSON atlases, so every frame layout is described here
// by hand. All of the ones used so far are on a 16px grid = one logical tile.
const FRAME = 16;
const FRAMES_PER_ROW = 4; // chicken walk cycle length
const FACING_ROWS = 4;

// Row index in an animal sheet == facing direction.
const enum Facing {
  Down = 0,
  Up = 1,
  Left = 2,
  Right = 3,
}

// Grass.png is a 5×1 palette strip: water, light grass, dark grass, then two sand
// fills. Only the sand is taken from here — grass comes from the textured sheet
// and water from the shore ramp — and the two sand frames are pixel-identical, so
// one of them is the whole beach.
const GRASS_STRIP_COLS = 5;
const SAND_COL = 3;

// Shore.png is a 5×1 depth ramp (sand → wet sand → shallow → mid → open water).
// Frame 0 is the same fill as the beach above; the rest is the whole shore ramp,
// wet sand included — it is the palette step that carries sand into water. Water
// frames stay ordered shallow → deep, the order the water materials are numbered
// in.
const SHORE_STRIP_COLS = 5;
const WET_SAND_COL = 1;
const WATER_COLS = [2, 3, 4];

// Sheet grids that map straight onto a semantic axis. TexturedGrass.png and
// DeadGrass.png share this layout, so the two grounds are interchangeable.
const GRASS_SHADES = 2; // rows: light / dark
const GRASS_VARIANTS = 3; // cols: plain, tuft A, tuft B
const TREE_VARIANTS = 4; // cols: stump, then three canopies
const ROCK_TINTS = 4; // rows: bare, mossy, green moss, snow
const ROCK_SIZES = 3; // cols: small → large

// Sheets the renderer draws as sprites, resolved to a semantic axis so callers
// never index raw sheet coordinates.
interface Sheets {
  chicken: Texture[][]; // [facing][walk frame]
  trees: Texture[]; // [0] = stump, [1..] = canopies
  rocks: Texture[][]; // [tint][size]
}

// The ground fills are needed as raw RGBA bytes, not as textures: the terrain is
// composed pixel by pixel on the CPU (see terrain.ts) and a GPU texture cannot be
// read back. Each entry is one 16×16 frame, RGBA, row-major.
interface Fills {
  grass: Uint8Array[][]; // [shade][plain | tuft A | tuft B]
  dryGrass: Uint8Array[][]; // same axes as `grass`, for high rocky ground
  sand: Uint8Array; // beach fill
  wetSand: Uint8Array; // the band where the beach meets the water
  water: Uint8Array[]; // shallow → open water
}

let loaded: Sheets | null = null;
let decoded: Fills | null = null;

// Cut a grid of sub-textures sharing one GPU source. `nearest` keeps pixel art
// crisp at the camera's ×1…×8 zoom.
function sliceSheet(base: Texture, rows: number, cols: number, frame: number): Texture[][] {
  base.source.scaleMode = "nearest";
  const grid: Texture[][] = [];
  for (let row = 0; row < rows; row += 1) {
    const line: Texture[] = [];
    for (let col = 0; col < cols; col += 1) {
      line.push(
        new Texture({
          source: base.source,
          frame: new Rectangle(col * frame, row * frame, frame, frame),
        }),
      );
    }
    grid.push(line);
  }
  return grid;
}

// The fill sheets are decoded straight to bytes through a scratch canvas instead
// of going through `Assets`: they never reach the GPU as themselves, only as the
// pixels the bake copies out of them.
async function decodeFrames(url: string, rows: number, cols: number, frame: number): Promise<Uint8Array[][]> {
  const blob = await (await fetch(url)).blob();
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: "none" });
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("no 2d canvas context — cannot decode ground fills");
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const grid: Uint8Array[][] = [];
  for (let row = 0; row < rows; row += 1) {
    const line: Uint8Array[] = [];
    for (let col = 0; col < cols; col += 1) {
      line.push(new Uint8Array(ctx.getImageData(col * frame, row * frame, frame, frame).data));
    }
    grid.push(line);
  }
  return grid;
}

// Must be awaited during boot, before the first render frame: the renderer's
// reconcile() creates sprites synchronously and cannot await, and the terrain bake
// needs the fills already decoded.
async function loadTextures(): Promise<void> {
  const [chicken, trees, rocks, grassStrip, texturedGrass, deadGrass, shore] = await Promise.all([
    Assets.load<Texture>(chickenUrl),
    Assets.load<Texture>(treesUrl),
    Assets.load<Texture>(rocksUrl),
    decodeFrames(grassUrl, 1, GRASS_STRIP_COLS, FRAME),
    decodeFrames(texturedGrassUrl, GRASS_SHADES, GRASS_VARIANTS, FRAME),
    decodeFrames(deadGrassUrl, GRASS_SHADES, GRASS_VARIANTS, FRAME),
    decodeFrames(shoreUrl, 1, SHORE_STRIP_COLS, FRAME),
  ]);

  loaded = {
    chicken: sliceSheet(chicken, FACING_ROWS, FRAMES_PER_ROW, FRAME),
    trees: sliceSheet(trees, 1, TREE_VARIANTS, FRAME)[0],
    rocks: sliceSheet(rocks, ROCK_TINTS, ROCK_SIZES, FRAME),
  };

  decoded = {
    grass: texturedGrass,
    dryGrass: deadGrass,
    sand: grassStrip[0][SAND_COL],
    wetSand: shore[0][WET_SAND_COL],
    water: WATER_COLS.map((col) => shore[0][col]),
  };
}

function sheets(): Sheets {
  if (!loaded) {
    throw new Error("textures not loaded — call loadTextures() during boot");
  }
  return loaded;
}

function fills(): Fills {
  if (!decoded) {
    throw new Error("textures not loaded — call loadTextures() during boot");
  }
  return decoded;
}

export type { Fills, Sheets };
export { Facing, FRAMES_PER_ROW, GRASS_VARIANTS, TREE_VARIANTS, loadTextures, sheets, fills };
