import { Assets, Rectangle, Texture } from "pixi.js";
import chickenUrl from "@assets/Animals/Chicken.png";

// Animal sheets ship without JSON atlases, so frame layout is described here by
// hand: rows are facing directions, columns are the walk cycle.
const FRAME = 16;
const FRAMES_PER_ROW = 4;
const FACING_ROWS = 4;

// Row index in an animal sheet == facing direction.
const enum Facing {
  Down = 0,
  Up = 1,
  Left = 2,
  Right = 3,
}

let chicken: Texture[][] | null = null;

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
  const base = await Assets.load<Texture>(chickenUrl);
  chicken = sliceSheet(base, FACING_ROWS, FRAMES_PER_ROW, FRAME);
}

function chickenFrames(): Texture[][] {
  if (!chicken) {
    throw new Error("textures not loaded — call loadTextures() during boot");
  }
  return chicken;
}

export { Facing, FRAMES_PER_ROW, loadTextures, chickenFrames };
