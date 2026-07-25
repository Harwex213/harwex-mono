import { Assets, Rectangle, Texture } from "pixi.js";
import chickenUrl from "@assets/Animals/Chicken.png";
import farmerUrl from "@assets/Characters/Workers/FarmerTemplate.png";
import grassUrl from "@assets/Ground/Grass.png";
import texturedGrassUrl from "@assets/Ground/TexturedGrass.png";
import shoreUrl from "@assets/Ground/Shore.png";
import cliffUrl from "@assets/Ground/Cliff.png";
import deadGrassUrl from "@assets/Ground/DeadGrass.png";
import treesUrl from "@assets/Nature/Trees.png";
import rocksUrl from "@assets/Nature/Rocks.png";
import selectorUrl from "@assets/User Interface/BoxSelector.png";

// The sheets ship without JSON atlases, so every frame layout is described here
// by hand. All of the ones used so far are on a 16px grid = one logical tile.
const FRAME = 16;
const FACING_ROWS = 4;

// Facing is the semantic axis every creature sheet is remapped onto; the numbers
// are Chicken.png's own row order, which the farmer sheet does not share.
const enum Facing {
  Down = 0,
  Up = 1,
  Left = 2,
  Right = 3,
}

const CHICKEN_WALK_FRAMES = 4;

// FarmerTemplate.png is 5×12 frames: three clips stacked, each one row per
// facing, in the sheet's own order (down, up, right, left). Clip 0 stands,
// clip 1 walks with the arms swinging out, clip 2 swings a tool over three
// frames — that last one waits for the work system to emit harvest jobs.
const FARMER_CLIP_ROWS: readonly Facing[] = [Facing.Down, Facing.Up, Facing.Right, Facing.Left];
const FARMER_CLIPS = 3;
const FARMER_COLS = 5;
const FARMER_STAND_CLIP = 0;
const FARMER_WALK_CLIP = 1;

// Grass.png is a 5×1 palette strip: water, light grass, dark grass, then two
// sand fills. Only the sand is taken from here — grass comes from the textured
// sheet and water from the shore ramp.
const GRASS_STRIP_COLS = 5;
const GRASS_STRIP_SAND = [3, 4];

// Shore.png is a 5×1 depth ramp (sand → wet sand → shallow → mid → open water).
// The first two are redundant with the sand fills above.
const SHORE_STRIP_COLS = 5;
const SHORE_STRIP_WATER = [2, 3, 4];

// Cliff.png is 7×9 frames: three 3×3 cliff blocks stacked in the left columns
// (pale stone, weathered stone, sandstone), the rest of the sheet decor this
// renderer has no use for yet. A block is a nine-slice — walls on the outside,
// the plateau top in the middle — so the only axis worth keeping is which way
// the wall faces. Its corners are transparent outside the rounded silhouette,
// which is what lets it be laid over the ground rather than replace it.
const CLIFF_COLS = 7;
const CLIFF_ROWS = 9;
const CLIFF_BLOCK = 3;
const CLIFF_STONE_BLOCK = 0;
// A nine-slice has no frame for a mass one tile wide: each of its nine frames is
// half wall, half plateau, and a mass that narrow has no plateau to show. The
// sheet keeps two freestanding crags for that case, side by side above the decor.
const CRAG_ROW = 0;
const CRAG_COLS = [3, 4];

// Sheet grids that map straight onto a semantic axis. TexturedGrass.png and
// DeadGrass.png share this layout, so the two grounds are interchangeable.
const GRASS_SHADES = 2; // rows: light / dark
const GRASS_VARIANTS = 3; // cols: plain, tuft A, tuft B
const TREE_VARIANTS = 4; // cols: stump, then three canopies
const ROCK_TINTS = 4; // rows: bare, mossy, green moss, snow
const ROCK_SIZES = 3; // cols: small → large
// BoxSelector.png is 32×16: the same corner brackets twice, wide then inset —
// i.e. a two-frame pulse, not two different markers.
const SELECTOR_FRAMES = 2;

// A creature sheet reduced to the two states the renderer distinguishes: the
// pose held while standing, and the cycle played while moving.
interface Creature {
  stand: Texture[]; // [facing]
  walk: Texture[][]; // [facing][frame]
}

// Every texture the renderer can draw, resolved to a semantic axis so callers
// never index raw sheet coordinates.
interface Sheets {
  chicken: Creature;
  colonist: Creature;
  grass: Texture[][]; // [shade][plain | tuft A | tuft B]
  dryGrass: Texture[][]; // same axes as `grass`, for high rocky ground
  sand: Texture[]; // beach fills
  water: Texture[]; // shallow → open water
  cliff: Texture[][]; // [wall north | none | wall south][wall west | none | wall east]
  crag: Texture[]; // whole-tile rock, for cliffs too narrow for the nine-slice
  trees: Texture[]; // [0] = stump, [1..] = canopies
  rocks: Texture[][]; // [tint][size]
  selector: Texture[]; // selection brackets: [wide, inset]
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

// One clip of the farmer sheet, with its rows reordered onto Facing.
function farmerClip(grid: Texture[][], clip: number): Texture[][] {
  const byFacing: Texture[][] = [];
  FARMER_CLIP_ROWS.forEach((facing, row) => {
    byFacing[facing] = grid[clip * FACING_ROWS + row];
  });
  return byFacing;
}

// Must be awaited during boot, before the first render frame: the renderer's
// reconcile() creates sprites synchronously and cannot await.
async function loadTextures(): Promise<void> {
  const [chicken, farmer, grassStrip, texturedGrass, deadGrass, shore, cliff, trees, rocks, selector] =
    await Promise.all([
      Assets.load<Texture>(chickenUrl),
      Assets.load<Texture>(farmerUrl),
      Assets.load<Texture>(grassUrl),
      Assets.load<Texture>(texturedGrassUrl),
      Assets.load<Texture>(deadGrassUrl),
      Assets.load<Texture>(shoreUrl),
      Assets.load<Texture>(cliffUrl),
      Assets.load<Texture>(treesUrl),
      Assets.load<Texture>(rocksUrl),
      Assets.load<Texture>(selectorUrl),
    ]);

  const grassRow = sliceSheet(grassStrip, 1, GRASS_STRIP_COLS, FRAME)[0];
  const shoreRow = sliceSheet(shore, 1, SHORE_STRIP_COLS, FRAME)[0];
  const cliffGrid = sliceSheet(cliff, CLIFF_ROWS, CLIFF_COLS, FRAME);
  // The chicken has no separate standing pose: frame 0 of its walk doubles as one.
  const chickenWalk = sliceSheet(chicken, FACING_ROWS, CHICKEN_WALK_FRAMES, FRAME);
  const farmerGrid = sliceSheet(farmer, FARMER_CLIPS * FACING_ROWS, FARMER_COLS, FRAME);
  const farmerStand = farmerClip(farmerGrid, FARMER_STAND_CLIP);

  loaded = {
    chicken: {
      stand: chickenWalk.map((row) => row[0]),
      walk: chickenWalk,
    },
    colonist: {
      // The stand clip animates a weight shift over five frames; standing still
      // holds its neutral pose so idle colonists do not march in place.
      stand: farmerStand.map((row) => row[0]),
      walk: farmerClip(farmerGrid, FARMER_WALK_CLIP),
    },
    grass: sliceSheet(texturedGrass, GRASS_SHADES, GRASS_VARIANTS, FRAME),
    dryGrass: sliceSheet(deadGrass, GRASS_SHADES, GRASS_VARIANTS, FRAME),
    sand: GRASS_STRIP_SAND.map((col) => grassRow[col]),
    water: SHORE_STRIP_WATER.map((col) => shoreRow[col]),
    cliff: cliffGrid
      .slice(CLIFF_STONE_BLOCK * CLIFF_BLOCK, CLIFF_STONE_BLOCK * CLIFF_BLOCK + CLIFF_BLOCK)
      .map((row) => row.slice(0, CLIFF_BLOCK)),
    crag: CRAG_COLS.map((col) => cliffGrid[CRAG_ROW][col]),
    trees: sliceSheet(trees, 1, TREE_VARIANTS, FRAME)[0],
    rocks: sliceSheet(rocks, ROCK_TINTS, ROCK_SIZES, FRAME),
    selector: sliceSheet(selector, 1, SELECTOR_FRAMES, FRAME)[0],
  };
}

function sheets(): Sheets {
  if (!loaded) {
    throw new Error("textures not loaded — call loadTextures() during boot");
  }
  return loaded;
}

export type { Creature, Sheets };
export { Facing, TREE_VARIANTS, loadTextures, sheets };
