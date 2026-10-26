import type { Rect } from "../layer/province-layer";

// Which province each pixel of the layer belongs to, as a small integer slot,
// and the rectangle each province covers. The countries view colours the map
// per slot: a lookup table instead of a colour map per pixel.

type ProvinceIndex = {
  width: number;
  height: number;
  // Per pixel: 0 where no registered province is painted, else slot + 1.
  slots: Uint16Array | Uint32Array;
  // Slot -> province id. Slot 0 is unused and holds 0.
  provinceIds: number[];
  // Slot -> the rectangle its pixels cover. Slot 0 holds an empty rectangle.
  bounds: Rect[];
};

function buildProvinceIndex(
  pixels: Readonly<Uint32Array>,
  width: number,
  height: number,
  provinces: ReadonlyArray<{ id: number; color: number }>,
): ProvinceIndex {
  const slotOfColor = new Map<number, number>();
  const provinceIds = [0];

  for (const province of provinces) {
    if (!slotOfColor.has(province.color)) {
      slotOfColor.set(province.color, provinceIds.length);
      provinceIds.push(province.id);
    }
  }

  const slots = provinceIds.length <= 0xffff ? new Uint16Array(width * height) : new Uint32Array(width * height);
  const minX = new Int32Array(provinceIds.length).fill(width);
  const minY = new Int32Array(provinceIds.length).fill(height);
  const maxX = new Int32Array(provinceIds.length).fill(-1);
  const maxY = new Int32Array(provinceIds.length).fill(-1);
  // Painted areas are long runs of one colour, so the map lookup is skipped
  // while the colour stays the same.
  let lastColor = 0;
  let lastSlot = 0;

  for (let y = 0; y < height; y += 1) {
    const row = y * width;

    for (let x = 0; x < width; x += 1) {
      const color = pixels[row + x];

      if (color !== lastColor) {
        lastColor = color;
        lastSlot = color === 0 ? 0 : (slotOfColor.get(color) ?? 0);
      }

      if (lastSlot === 0) {
        continue;
      }

      slots[row + x] = lastSlot;

      if (x < minX[lastSlot]) {
        minX[lastSlot] = x;
      }
      if (x > maxX[lastSlot]) {
        maxX[lastSlot] = x;
      }
      if (y < minY[lastSlot]) {
        minY[lastSlot] = y;
      }
      maxY[lastSlot] = y;
    }
  }

  const bounds: Rect[] = provinceIds.map((_, slot) => {
    if (maxX[slot] < 0) {
      return { x: 0, y: 0, w: 0, h: 0 };
    }

    return { x: minX[slot], y: minY[slot], w: maxX[slot] - minX[slot] + 1, h: maxY[slot] - minY[slot] + 1 };
  });

  return { width, height, slots, provinceIds, bounds };
}

// The province under a pixel, or null off the map and on unpainted pixels.
function provinceAtPixel(index: ProvinceIndex, x: number, y: number): number | null {
  if (x < 0 || y < 0 || x >= index.width || y >= index.height) {
    return null;
  }

  const slot = index.slots[y * index.width + x];

  return slot === 0 ? null : index.provinceIds[slot];
}

// Writes the colour of every pixel inside `rect` into `out`: `fill[slot]`
// inside a province, `edge[slot]` on a pixel with another slot to its left,
// right, top or bottom, and 0 where nothing is painted. Whether a pixel is an edge
// depends on the slots alone, so a slot whose colours changed needs only its
// own bounds repainted.
function paintSlots(
  index: ProvinceIndex,
  fill: Readonly<Uint32Array>,
  edge: Readonly<Uint32Array>,
  out: Uint32Array,
  rect: Rect,
): void {
  const { width, height, slots } = index;
  const x1 = Math.min(width, rect.x + rect.w);
  const y1 = Math.min(height, rect.y + rect.h);

  for (let y = Math.max(0, rect.y); y < y1; y += 1) {
    const row = y * width;
    const firstRow = y === 0;
    const lastRow = y === height - 1;

    for (let x = Math.max(0, rect.x); x < x1; x += 1) {
      const at = row + x;
      const slot = slots[at];

      if (slot === 0) {
        out[at] = 0;
        continue;
      }

      const left = x === 0 ? slot : slots[at - 1];
      const right = x === width - 1 ? slot : slots[at + 1];
      const above = firstRow ? slot : slots[at - width];
      const below = lastRow ? slot : slots[at + width];
      const onEdge = left !== slot || right !== slot || above !== slot || below !== slot;

      out[at] = onEdge ? edge[slot] : fill[slot];
    }
  }
}

// The smallest rectangle covering both. An empty rectangle adds nothing.
function unionRect(left: Rect | null, right: Rect): Rect | null {
  if (right.w <= 0 || right.h <= 0) {
    return left;
  }

  if (!left) {
    return { ...right };
  }

  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);

  return {
    x,
    y,
    w: Math.max(left.x + left.w, right.x + right.w) - x,
    h: Math.max(left.y + left.h, right.y + right.h) - y,
  };
}

export {
  buildProvinceIndex,
  paintSlots,
  provinceAtPixel,
  unionRect,
  type ProvinceIndex,
};
