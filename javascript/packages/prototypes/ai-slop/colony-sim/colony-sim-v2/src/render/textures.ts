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

// Grass.png is a 5×1 palette strip: water, light grass, dark grass, then two
// sand fills. Only the sand is taken from here — grass comes from the textured
// sheet and water from the shore ramp.
const GRASS_STRIP_COLS = 5;
const GRASS_STRIP_SAND = [3, 4];

// Shore.png is a 5×1 depth ramp (sand → wet sand → shallow → mid → open water).
// The first two are redundant with the sand fills above.
const SHORE_STRIP_COLS = 5;
const SHORE_STRIP_WATER = [2, 3, 4];

// Sheet grids that map straight onto a semantic axis. TexturedGrass.png and
// DeadGrass.png share this layout, so the two grounds are interchangeable.
const GRASS_SHADES = 2; // rows: light / dark
const GRASS_VARIANTS = 3; // cols: plain, tuft A, tuft B
const TREE_VARIANTS = 4; // cols: stump, then three canopies
const ROCK_TINTS = 4; // rows: bare, mossy, green moss, snow
const ROCK_SIZES = 3; // cols: small → large

// Every texture the renderer can draw, resolved to a semantic axis so callers
// never index raw sheet coordinates.
interface Sheets {
  chicken: Texture[][]; // [facing][walk frame]
  grass: Texture[][]; // [shade][plain | tuft A | tuft B]
  dryGrass: Texture[][]; // same axes as `grass`, for high rocky ground
  sand: Texture[]; // beach fills
  water: Texture[]; // shallow → open water
  trees: Texture[]; // [0] = stump, [1..] = canopies
  rocks: Texture[][]; // [tint][size]
}

let loaded: Sheets | null = null;

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

// Must be awaited during boot, before the first render frame: the renderer's
// reconcile() creates sprites synchronously and cannot await.
async function loadTextures(): Promise<void> {
  const [chicken, grassStrip, texturedGrass, deadGrass, shore, trees, rocks] = await Promise.all([
    Assets.load<Texture>(chickenUrl),
    Assets.load<Texture>(grassUrl),
    Assets.load<Texture>(texturedGrassUrl),
    Assets.load<Texture>(deadGrassUrl),
    Assets.load<Texture>(shoreUrl),
    Assets.load<Texture>(treesUrl),
    Assets.load<Texture>(rocksUrl),
  ]);

  const grassRow = sliceSheet(grassStrip, 1, GRASS_STRIP_COLS, FRAME)[0];
  const shoreRow = sliceSheet(shore, 1, SHORE_STRIP_COLS, FRAME)[0];

  loaded = {
    chicken: sliceSheet(chicken, FACING_ROWS, FRAMES_PER_ROW, FRAME),
    grass: sliceSheet(texturedGrass, GRASS_SHADES, GRASS_VARIANTS, FRAME),
    dryGrass: sliceSheet(deadGrass, GRASS_SHADES, GRASS_VARIANTS, FRAME),
    sand: GRASS_STRIP_SAND.map((col) => grassRow[col]),
    water: SHORE_STRIP_WATER.map((col) => shoreRow[col]),
    trees: sliceSheet(trees, 1, TREE_VARIANTS, FRAME)[0],
    rocks: sliceSheet(rocks, ROCK_TINTS, ROCK_SIZES, FRAME),
  };
}

function sheets(): Sheets {
  if (!loaded) {
    throw new Error("textures not loaded — call loadTextures() during boot");
  }
  return loaded;
}

export type { Sheets };
export { Facing, FRAMES_PER_ROW, TREE_VARIANTS, loadTextures, sheets };
