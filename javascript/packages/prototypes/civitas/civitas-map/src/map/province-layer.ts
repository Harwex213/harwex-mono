import { TRANSPARENT } from "./colors";
import { walkLine, type BrushMask } from "./brush";

// The province layer is a full-resolution paint surface living beside the map
// image. Two copies of it are kept:
//
//   * `pixels` — a `Uint32Array` mirror that every edit writes to. It is the
//     source of truth. Reads (hover lookup, flood fill, the export scan) hit it
//     directly, because pulling those out of a canvas means a `getImageData`
//     round trip per read and a 5120x3402 canvas makes that unusable.
//   * `canvas` — the same pixels, uploaded rect by rect, purely so the renderer
//     can `drawImage` the layer under the view transform.
//
// Undo is per tile rather than per full frame: a snapshot of the whole layer is
// ~70 MB, while a stroke normally touches a handful of 256px tiles.

const TILE = 256;
const UNDO_DEPTH = 40;

type Rect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type TileSnapshot = {
  index: number;
  pixels: Uint32Array;
};

class ProvinceLayer {
  readonly width: number;
  readonly height: number;
  readonly canvas: HTMLCanvasElement;

  private readonly ctx: CanvasRenderingContext2D;
  private readonly pixels: Uint32Array;
  private readonly tilesAcross: number;

  private undoStack: TileSnapshot[][] = [];
  private redoStack: TileSnapshot[][] = [];
  private pending: Map<number, Uint32Array> | null = null;
  private strokeDirty: Rect | null = null;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint32Array(width * height);
    this.tilesAcross = Math.ceil(width / TILE);

    this.canvas = document.createElement("canvas");
    this.canvas.width = width;
    this.canvas.height = height;

    const ctx = this.canvas.getContext("2d");

    if (!ctx) {
      throw new Error("2d canvas context unavailable");
    }

    this.ctx = ctx;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  readPixels(): Readonly<Uint32Array> {
    return this.pixels;
  }

  contains(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  pixelAt(x: number, y: number): number {
    if (!this.contains(x, y)) {
      return TRANSPARENT;
    }

    return this.pixels[y * this.width + x];
  }

  // Every edit is wrapped in a stroke. A drag is one undo step, not one step per
  // pointer sample, and a single click still has to open one so the tile
  // snapshots have somewhere to go.
  beginStroke(): void {
    this.pending = new Map();
    this.strokeDirty = null;
  }

  endStroke(): boolean {
    const pending = this.pending;

    this.pending = null;
    this.strokeDirty = null;

    if (!pending || pending.size === 0) {
      return false;
    }

    const snapshot: TileSnapshot[] = [];

    for (const [index, pixels] of pending) {
      snapshot.push({ index, pixels });
    }

    this.undoStack.push(snapshot);

    if (this.undoStack.length > UNDO_DEPTH) {
      this.undoStack.shift();
    }

    // A new edit invalidates the redo branch, the same as in any editor.
    this.redoStack = [];

    return true;
  }

  stamp(cx: number, cy: number, mask: BrushMask, value: number): void {
    for (const span of mask.spans) {
      this.writeSpan(cx + span.x0, cx + span.x1, cy + span.dy, value);
    }
  }

  strokeSegment(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    mask: BrushMask,
    value: number,
  ): void {
    walkLine(x0, y0, x1, y1, (x, y) => {
      this.stamp(x, y, mask, value);
    });
  }

  // Fills the connected run of pixels that share the colour under the cursor.
  // On an empty layer that run is the whole map, which is the point: outline a
  // province with the brush first, and the fill stops at the outline.
  floodFill(seedX: number, seedY: number, value: number): boolean {
    if (!this.contains(seedX, seedY)) {
      return false;
    }

    const target = this.pixels[seedY * this.width + seedX];

    if (target === value) {
      return false;
    }

    const stack: number[] = [seedX, seedY];
    let filled = false;

    while (stack.length > 0) {
      const y = stack.pop() as number;
      const x = stack.pop() as number;
      const row = y * this.width;

      if (this.pixels[row + x] !== target) {
        continue;
      }

      let left = x;
      let right = x;

      while (left - 1 >= 0 && this.pixels[row + left - 1] === target) {
        left -= 1;
      }
      while (right + 1 < this.width && this.pixels[row + right + 1] === target) {
        right += 1;
      }

      // The written pixels stop matching `target`, so the run itself is the
      // visited marker and no separate visited bitmap is needed.
      this.writeSpan(left, right, y, value);
      filled = true;

      for (const neighbourY of [y - 1, y + 1]) {
        if (neighbourY < 0 || neighbourY >= this.height) {
          continue;
        }

        const neighbourRow = neighbourY * this.width;
        let scanX = left;

        while (scanX <= right) {
          if (this.pixels[neighbourRow + scanX] === target) {
            stack.push(scanX, neighbourY);

            while (scanX <= right && this.pixels[neighbourRow + scanX] === target) {
              scanX += 1;
            }
          } else {
            scanX += 1;
          }
        }
      }
    }

    return filled;
  }

  // Used when a province is deleted or recoloured: its pixels have to follow the
  // registry, or the exported manifest and the exported image disagree.
  replaceColor(from: number, to: number): boolean {
    if (from === to) {
      return false;
    }

    let changed = false;

    for (let y = 0; y < this.height; y += 1) {
      const row = y * this.width;
      let x = 0;

      while (x < this.width) {
        if (this.pixels[row + x] !== from) {
          x += 1;

          continue;
        }

        const start = x;

        while (x < this.width && this.pixels[row + x] === from) {
          x += 1;
        }

        this.writeSpan(start, x - 1, y, to);
        changed = true;
      }
    }

    return changed;
  }

  undo(): boolean {
    return this.applyStep(this.undoStack, this.redoStack);
  }

  redo(): boolean {
    return this.applyStep(this.redoStack, this.undoStack);
  }

  clear(): void {
    this.pixels.fill(TRANSPARENT);
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.resetHistory();
  }

  // Replaces the whole layer, for loading a province image back in. History is
  // dropped rather than recorded: opening a document is not an edit, and the
  // strokes on the stack belong to pixels that no longer exist.
  loadPixels(source: Readonly<Uint32Array>): void {
    if (source.length !== this.pixels.length) {
      throw new Error(
        `province image holds ${source.length} pixels, the layer holds ${this.pixels.length}`,
      );
    }

    this.pixels.set(source);
    this.resetHistory();
    this.flush({ x: 0, y: 0, w: this.width, h: this.height });
  }

  private resetHistory(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.pending = null;
    this.strokeDirty = null;
  }

  private applyStep(from: TileSnapshot[][], to: TileSnapshot[][]): boolean {
    const step = from.pop();

    if (!step) {
      return false;
    }

    const inverse: TileSnapshot[] = [];

    for (const tile of step) {
      const rect = this.tileRect(tile.index);

      inverse.push({ index: tile.index, pixels: this.copyTile(rect) });
      this.pasteTile(rect, tile.pixels);
      this.flush(rect);
    }

    to.push(inverse);

    return true;
  }

  private writeSpan(rawX0: number, rawX1: number, y: number, value: number): void {
    if (y < 0 || y >= this.height) {
      return;
    }

    const x0 = Math.max(0, rawX0);
    const x1 = Math.min(this.width - 1, rawX1);

    if (x1 < x0) {
      return;
    }

    this.snapshotRect({ x: x0, y, w: x1 - x0 + 1, h: 1 });
    this.pixels.fill(value, y * this.width + x0, y * this.width + x1 + 1);
    this.markDirty({ x: x0, y, w: x1 - x0 + 1, h: 1 });
  }

  // Snapshots every tile the write touches, but only the first time in a stroke,
  // so the stored copy is always the pre-stroke state of that tile.
  private snapshotRect(rect: Rect): void {
    const pending = this.pending;

    if (!pending) {
      return;
    }

    const tx0 = Math.floor(rect.x / TILE);
    const tx1 = Math.floor((rect.x + rect.w - 1) / TILE);
    const ty0 = Math.floor(rect.y / TILE);
    const ty1 = Math.floor((rect.y + rect.h - 1) / TILE);

    for (let ty = ty0; ty <= ty1; ty += 1) {
      for (let tx = tx0; tx <= tx1; tx += 1) {
        const index = ty * this.tilesAcross + tx;

        if (pending.has(index)) {
          continue;
        }

        pending.set(index, this.copyTile(this.tileRect(index)));
      }
    }
  }

  private tileRect(index: number): Rect {
    const tx = index % this.tilesAcross;
    const ty = Math.floor(index / this.tilesAcross);
    const x = tx * TILE;
    const y = ty * TILE;

    return {
      x,
      y,
      w: Math.min(TILE, this.width - x),
      h: Math.min(TILE, this.height - y),
    };
  }

  private copyTile(rect: Rect): Uint32Array {
    const out = new Uint32Array(rect.w * rect.h);

    for (let row = 0; row < rect.h; row += 1) {
      const start = (rect.y + row) * this.width + rect.x;

      out.set(this.pixels.subarray(start, start + rect.w), row * rect.w);
    }

    return out;
  }

  private pasteTile(rect: Rect, data: Uint32Array): void {
    for (let row = 0; row < rect.h; row += 1) {
      const start = (rect.y + row) * this.width + rect.x;

      this.pixels.set(data.subarray(row * rect.w, (row + 1) * rect.w), start);
    }
  }

  private markDirty(rect: Rect): void {
    const current = this.strokeDirty;

    if (!current) {
      this.strokeDirty = { ...rect };

      return;
    }

    const x0 = Math.min(current.x, rect.x);
    const y0 = Math.min(current.y, rect.y);
    const x1 = Math.max(current.x + current.w, rect.x + rect.w);
    const y1 = Math.max(current.y + current.h, rect.y + rect.h);

    this.strokeDirty = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // Called by the editor once per pointer event or fill, not once per span: a
  // `putImageData` per one-pixel row would dominate the cost of a wide brush.
  flushDirty(): void {
    const rect = this.strokeDirty;

    this.strokeDirty = null;

    if (rect) {
      this.flush(rect);
    }
  }

  private flush(rect: Rect): void {
    const words = this.copyTile(rect);
    // Two views over one buffer, so the byte order the canvas expects and the
    // word order of the mirror agree on any machine.
    const bytes = new Uint8ClampedArray(words.buffer as ArrayBuffer);

    this.ctx.putImageData(new ImageData(bytes, rect.w, rect.h), rect.x, rect.y);
  }
}

export { ProvinceLayer, type Rect };
