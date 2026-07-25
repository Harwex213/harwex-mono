import { Assets, Rectangle, Texture } from "pixi.js";
import { PLAYER_IDS, type PlayerId, type ResourceKind } from "@hw/colony-sim-v1-core";
import chickenUrl from "@assets/Animals/Chicken.png";
import farmerLimeUrl from "@assets/Characters/Workers/LimeWorker/FarmerLime.png";
import farmerRedUrl from "@assets/Characters/Workers/RedWorker/FarmerRed.png";
import grassUrl from "@assets/Ground/Grass.png";
import texturedGrassUrl from "@assets/Ground/TexturedGrass.png";
import shoreUrl from "@assets/Ground/Shore.png";
import cliffUrl from "@assets/Ground/Cliff.png";
import deadGrassUrl from "@assets/Ground/DeadGrass.png";
import treesUrl from "@assets/Nature/Trees.png";
import rocksUrl from "@assets/Nature/Rocks.png";
import woodUrl from "@assets/Resources/Wood.png";
import stoneUrl from "@assets/Resources/Stone.png";
import foodUrl from "@assets/Resources/Food.png";
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

// One worker sheet per player. They are recolours of that same template, so a team
// is a different image and not a different layout — nothing below this table is
// per-player. Keyed by PlayerId rather than ordered like the art folders: which
// sheet a colonist draws from is decided by who owns it.
const WORKER_SHEETS: Record<PlayerId, string> = {
  red: farmerRedUrl,
  lime: farmerLimeUrl,
};

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
// It has no frame for a concave joint either, so a tile that turns one is laid
// half at a time (see ground.ts). The halves are horizontal because that is where
// the sheet turns a wall: the northern wall face is drawn in the lower half of its
// frame, the plateau starts in the next tile down.
const CLIFF_HALF = FRAME / 2;
// How far the sheet holds the mass off the left and right edge of its tile. Two
// side walls laid on the same half overlap by it, so that the strip each one
// leaves open for the ground is not painted over by the other.
const CLIFF_INSET = 4;

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

// The cliff block on the two axes it is picked by — which side the mass ends on —
// plus the same frames cut into the half-tiles a concave joint is laid from.
interface Cliff {
  face: Texture[][]; // [wall north | none | wall south][wall west | none | wall east]
  half: Texture[][][]; // the same frames, one half-tile: [top | bottom][north…][west…]
  // Side walls trimmed to CLIFF_INSET, for a half the mass ends on both sides of:
  // [top | bottom][north…][west | east]. The east piece goes CLIFF_INSET in.
  joint: Texture[][][];
}

// Every texture the renderer draws as a sprite, resolved to a semantic axis so
// callers never index raw sheet coordinates. The ground fills are not here: they
// never reach the GPU as themselves — see `Fills`.
interface Sheets {
  chicken: Creature;
  colonists: Record<PlayerId, Creature>; // one recolour of the worker sheet per player
  cliff: Cliff;
  crag: Texture[]; // whole-tile rock, for cliffs too narrow for the nine-slice
  trees: Texture[]; // [0] = stump, [1..] = canopies
  rocks: Texture[][]; // [tint][size]
  items: Record<ResourceKind, Texture>; // dropped stacks, one pile art per resource
  selector: Texture[]; // selection brackets: [wide, inset]
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

// Part of a frame, in the frame's own pixels — a cliff tile is not always laid
// whole.
function subFrame(base: Texture, col: number, row: number, part: Rectangle): Texture {
  return new Texture({
    source: base.source,
    frame: new Rectangle(col * FRAME + part.x, row * FRAME + part.y, part.width, part.height),
  });
}

// The stone block of Cliff.png, on the axes ground.ts picks by, with the cuts a
// concave joint needs already made.
function cliffBlock(sheet: Texture, whole: Texture[][]): Cliff {
  const top = CLIFF_STONE_BLOCK * CLIFF_BLOCK;
  const rows = [0, 1, 2];
  const halves = [0, CLIFF_HALF];
  return {
    face: whole.slice(top, top + CLIFF_BLOCK).map((row) => row.slice(0, CLIFF_BLOCK)),
    half: halves.map((y) =>
      rows.map((row) => rows.map((col) => subFrame(sheet, col, top + row, new Rectangle(0, y, FRAME, CLIFF_HALF)))),
    ),
    joint: halves.map((y) =>
      rows.map((row) => [
        subFrame(sheet, 0, top + row, new Rectangle(0, y, FRAME - CLIFF_INSET, CLIFF_HALF)),
        subFrame(sheet, 2, top + row, new Rectangle(CLIFF_INSET, y, FRAME - CLIFF_INSET, CLIFF_HALF)),
      ]),
    ),
  };
}

// The Resources sheets are a single 16px frame each — a whole sheet is one pile,
// so there is nothing to slice, only the pixel-art scale mode to set.
function wholeSheet(base: Texture): Texture {
  base.source.scaleMode = "nearest";
  return base;
}

// One clip of the farmer sheet, with its rows reordered onto Facing.
function farmerClip(grid: Texture[][], clip: number): Texture[][] {
  const byFacing: Texture[][] = [];
  FARMER_CLIP_ROWS.forEach((facing, row) => {
    byFacing[facing] = grid[clip * FACING_ROWS + row];
  });
  return byFacing;
}

// One player's worker, cut from that player's sheet.
function farmerCreature(sheet: Texture): Creature {
  const grid = sliceSheet(sheet, FARMER_CLIPS * FACING_ROWS, FARMER_COLS, FRAME);
  return {
    // The stand clip animates a weight shift over five frames; standing still
    // holds its neutral pose so idle colonists do not march in place.
    stand: farmerClip(grid, FARMER_STAND_CLIP).map((row) => row[0]),
    walk: farmerClip(grid, FARMER_WALK_CLIP),
  };
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
  const [chicken, workers, grassStrip, texturedGrass, deadGrass, shore, cliff, trees, rocks, wood, stone, food, selector] =
    await Promise.all([
      Assets.load<Texture>(chickenUrl),
      // In PLAYER_IDS order, so the sheets line up with the players they belong to.
      Promise.all(PLAYER_IDS.map((player) => Assets.load<Texture>(WORKER_SHEETS[player]))),
      decodeFrames(grassUrl, 1, GRASS_STRIP_COLS, FRAME),
      decodeFrames(texturedGrassUrl, GRASS_SHADES, GRASS_VARIANTS, FRAME),
      decodeFrames(deadGrassUrl, GRASS_SHADES, GRASS_VARIANTS, FRAME),
      decodeFrames(shoreUrl, 1, SHORE_STRIP_COLS, FRAME),
      Assets.load<Texture>(cliffUrl),
      Assets.load<Texture>(treesUrl),
      Assets.load<Texture>(rocksUrl),
      Assets.load<Texture>(woodUrl),
      Assets.load<Texture>(stoneUrl),
      Assets.load<Texture>(foodUrl),
      Assets.load<Texture>(selectorUrl),
    ]);

  const cliffGrid = sliceSheet(cliff, CLIFF_ROWS, CLIFF_COLS, FRAME);
  // The chicken has no separate standing pose: frame 0 of its walk doubles as one.
  const chickenWalk = sliceSheet(chicken, FACING_ROWS, CHICKEN_WALK_FRAMES, FRAME);
  const colonists = {} as Record<PlayerId, Creature>;
  PLAYER_IDS.forEach((player, index) => {
    colonists[player] = farmerCreature(workers[index]);
  });

  loaded = {
    chicken: {
      stand: chickenWalk.map((row) => row[0]),
      walk: chickenWalk,
    },
    colonists,
    cliff: cliffBlock(cliff, cliffGrid),
    crag: CRAG_COLS.map((col) => cliffGrid[CRAG_ROW][col]),
    trees: sliceSheet(trees, 1, TREE_VARIANTS, FRAME)[0],
    rocks: sliceSheet(rocks, ROCK_TINTS, ROCK_SIZES, FRAME),
    items: {
      wood: wholeSheet(wood),
      stone: wholeSheet(stone),
      food: wholeSheet(food),
    },
    selector: sliceSheet(selector, 1, SELECTOR_FRAMES, FRAME)[0],
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

export type { Cliff, Creature, Fills, Sheets };
export { CLIFF_HALF, CLIFF_INSET, Facing, GRASS_VARIANTS, TREE_VARIANTS, loadTextures, sheets, fills };
