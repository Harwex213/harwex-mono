// Recovers provinces from a map whose borders are painted into the image itself,
// the way `assets/Karta_provintsiy.png` has them. The pipeline is six passes over
// the pixels; each one exists because of something a real scanned map does.
//
//   1. water     Blue-dominant pixels. An opening (erode, then dilate by the same
//                radius) deletes water features thinner than twice that radius,
//                which is what rivers are: water-coloured, but a few pixels wide.
//                Without this every river would cut its province in half.
//   2. bodies    Connected runs of not-water. A body that reaches the edge of the
//                image is not a landmass — the scanned paper the map sits on does
//                exactly that, and it carries land-coloured speckle that no colour
//                or size test can separate from a small island. Framed maps have
//                water all around their land, so this one rule removes the whole
//                artifact.
//   3. seeds     Land-coloured pixels inside a body. Border ink is far darker than
//                terrain, so it fails this test and each walled-off area becomes a
//                separate component.
//   4. provinces Connected runs of seeds. Runs below `minArea` are texture noise
//                and are dropped here, before the watershed, so a speck cannot
//                seed a province of its own.
//   5. watershed Every province expands into the leftover pixels of its body at
//                one pixel per round, so two provinces meet along the centre line
//                of the ink between them and rivers, dropped specks and dithering
//                are absorbed by whoever is nearest.
//   5b. coast    The shore is drawn with the same ink, but that ring sits in the
//                water mask, so the watershed stops short of it and leaves every
//                island with an unpainted rim. The ink is much darker than the
//                water beside it, so a short bounded expansion into dark pixels
//                claims the outline without reaching open sea.
//   6. lakes     Water that never reaches the edge of the image is enclosed by
//                land. Above `minLake` it becomes a province of its own; below it,
//                it is handed to the watershed so a pond leaves no hole.

type DetectOptions = {
  // Green minus blue at or below which a pixel counts as water. Sea sits near
  // -18 on this map, terrain at +4 and above.
  waterGb: number;
  // Half-width of the widest river to erase from the water mask.
  riverWidth: number;
  landLum: number;
  landGb: number;
  minBody: number;
  minArea: number;
  minLake: number;
  // Keep landmasses that touch the edge of the image. Off by default, which is
  // what discards a scanned-paper background; turn it on for a map whose land
  // genuinely runs off the frame.
  keepEdgeBodies: boolean;
  coastInkLum: number;
  coastGrow: number;
};

type DetectStats = {
  bodies: number;
  keptBodies: number;
  edgeBodies: number;
  landProvinces: number;
  lakes: number;
  discardedSpecks: number;
  riverPixels: number;
  coastInkPixels: number;
  unassignedInsideLand: number;
  largestArea: number;
  medianArea: number;
};

type DetectResult = {
  // One label per pixel, 0 where nothing was detected. Labels run 1..count.
  labels: Int32Array;
  count: number;
  areas: Int32Array;
  // Which labels came from enclosed water rather than land.
  isLake: Uint8Array;
  stats: DetectStats;
};

const DEFAULT_OPTIONS: DetectOptions = {
  waterGb: -6,
  riverWidth: 2,
  landLum: 45,
  landGb: 0,
  minBody: 200,
  minArea: 48,
  minLake: 120,
  keepEdgeBodies: false,
  coastInkLum: 40,
  coastGrow: 6,
};

// A queue that grows on demand. The passes below are breadth-first over up to tens
// of millions of pixels, and a ring buffer sized up front would either waste
// memory or overflow.
class PixelQueue {
  private items: Int32Array;
  private head = 0;
  private tail = 0;

  constructor(capacity = 1 << 16) {
    this.items = new Int32Array(capacity);
  }

  get empty(): boolean {
    return this.head >= this.tail;
  }

  push(value: number): void {
    if (this.tail === this.items.length) {
      const bigger = new Int32Array(this.items.length * 2);

      bigger.set(this.items);
      this.items = bigger;
    }

    this.items[this.tail] = value;
    this.tail += 1;
  }

  shift(): number {
    const value = this.items[this.head];

    this.head += 1;

    return value;
  }
}

function detectProvinces(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  overrides: Partial<DetectOptions> = {},
): DetectResult {
  const opt = { ...DEFAULT_OPTIONS, ...overrides };
  const count = width * height;
  const lum = new Uint8Array(count);
  const gb = new Int16Array(count);

  for (let i = 0; i < count; i += 1) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];

    lum[i] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    gb[i] = g - b;
  }

  const neighbours = new Int32Array(4);

  function fillNeighbours(p: number): Int32Array {
    const x = p % width;

    neighbours[0] = x > 0 ? p - 1 : -1;
    neighbours[1] = x < width - 1 ? p + 1 : -1;
    neighbours[2] = p >= width ? p - width : -1;
    neighbours[3] = p + width < count ? p + width : -1;

    return neighbours;
  }

  // Distance from every pixel to the nearest pixel where `mask` equals `seed`,
  // saturating at `cap`. Seeding on 0 measures how deep inside the mask a pixel
  // sits, which is an erosion; seeding on 1 measures how close it is, a dilation.
  function distanceTo(mask: Uint8Array, seed: 0 | 1, cap: number): Uint8Array {
    const dist = new Uint8Array(count).fill(255);
    const queue = new PixelQueue();

    for (let i = 0; i < count; i += 1) {
      if ((mask[i] ? 1 : 0) === seed) {
        dist[i] = 0;
        queue.push(i);
      }
    }

    while (!queue.empty) {
      const p = queue.shift();
      const d = dist[p];

      if (d >= cap) {
        continue;
      }

      const list = fillNeighbours(p);

      for (let k = 0; k < 4; k += 1) {
        const n = list[k];

        if (n < 0 || dist[n] !== 255) {
          continue;
        }

        dist[n] = d + 1;
        queue.push(n);
      }
    }

    return dist;
  }

  // --- 1. water, with rivers opened out ----------------------------------
  const rawWater = new Uint8Array(count);

  for (let i = 0; i < count; i += 1) {
    rawWater[i] = gb[i] <= opt.waterGb ? 1 : 0;
  }

  const water = new Uint8Array(count);

  if (opt.riverWidth > 0) {
    const inward = distanceTo(rawWater, 0, opt.riverWidth + 1);
    const eroded = new Uint8Array(count);

    for (let i = 0; i < count; i += 1) {
      eroded[i] = inward[i] > opt.riverWidth ? 1 : 0;
    }

    const outward = distanceTo(eroded, 1, opt.riverWidth + 1);

    for (let i = 0; i < count; i += 1) {
      water[i] = eroded[i] || outward[i] <= opt.riverWidth ? 1 : 0;
    }
  } else {
    water.set(rawWater);
  }

  let riverPixels = 0;

  for (let i = 0; i < count; i += 1) {
    if (rawWater[i] && !water[i]) {
      riverPixels += 1;
    }
  }

  // --- 2. landmasses -----------------------------------------------------
  const stack = new Int32Array(count);
  const visited = new Uint8Array(count);
  const inBody = new Uint8Array(count);
  let bodies = 0;
  let keptBodies = 0;
  let edgeBodies = 0;

  for (let seed = 0; seed < count; seed += 1) {
    if (visited[seed] || water[seed]) {
      continue;
    }

    bodies += 1;

    let top = 0;
    let area = 0;
    let touchesEdge = false;

    stack[top] = seed;
    top += 1;
    visited[seed] = 1;

    const members: number[] = [];

    while (top > 0) {
      top -= 1;

      const p = stack[top];

      members.push(p);
      area += 1;

      const x = p % width;
      const y = (p - x) / width;

      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        touchesEdge = true;
      }

      const list = fillNeighbours(p);

      for (let k = 0; k < 4; k += 1) {
        const n = list[k];

        if (n < 0 || visited[n] || water[n]) {
          continue;
        }

        visited[n] = 1;
        stack[top] = n;
        top += 1;
      }
    }

    if (touchesEdge) {
      edgeBodies += 1;
    }
    if (area < opt.minBody || (touchesEdge && !opt.keepEdgeBodies)) {
      continue;
    }

    keptBodies += 1;

    for (const p of members) {
      inBody[p] = 1;
    }
  }

  // --- 3 and 4. province seeds ------------------------------------------
  const labels = new Int32Array(count);
  const areaList: number[] = [0];
  const lakeFlags: number[] = [0];
  let discardedSpecks = 0;
  let next = 0;

  const isSeed = (i: number) => inBody[i] === 1 && lum[i] >= opt.landLum && gb[i] >= opt.landGb;

  for (let seed = 0; seed < count; seed += 1) {
    if (labels[seed] !== 0 || !isSeed(seed)) {
      continue;
    }

    next += 1;

    let top = 0;
    const members: number[] = [];

    stack[top] = seed;
    top += 1;
    labels[seed] = next;

    while (top > 0) {
      top -= 1;

      const p = stack[top];

      members.push(p);

      const list = fillNeighbours(p);

      for (let k = 0; k < 4; k += 1) {
        const n = list[k];

        if (n < 0 || labels[n] !== 0 || !isSeed(n)) {
          continue;
        }

        labels[n] = next;
        stack[top] = n;
        top += 1;
      }
    }

    if (members.length < opt.minArea) {
      discardedSpecks += 1;
      next -= 1;

      for (const p of members) {
        labels[p] = 0;
      }

      continue;
    }

    areaList.push(members.length);
    lakeFlags.push(0);
  }

  const landProvinces = next;

  // --- 6. enclosed water ------------------------------------------------
  const waterSeen = new Uint8Array(count);
  let lakes = 0;

  for (let seed = 0; seed < count; seed += 1) {
    if (!water[seed] || waterSeen[seed]) {
      continue;
    }

    let top = 0;
    let touchesEdge = false;
    const members: number[] = [];

    stack[top] = seed;
    top += 1;
    waterSeen[seed] = 1;

    while (top > 0) {
      top -= 1;

      const p = stack[top];

      members.push(p);

      const x = p % width;
      const y = (p - x) / width;

      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
        touchesEdge = true;
      }

      const list = fillNeighbours(p);

      for (let k = 0; k < 4; k += 1) {
        const n = list[k];

        if (n < 0 || waterSeen[n] || !water[n]) {
          continue;
        }

        waterSeen[n] = 1;
        stack[top] = n;
        top += 1;
      }
    }

    // The ocean, and the scanned paper beside it, both reach the frame.
    if (touchesEdge) {
      continue;
    }

    if (members.length >= opt.minLake) {
      next += 1;
      lakes += 1;
      areaList.push(members.length);
      lakeFlags.push(1);

      for (const p of members) {
        labels[p] = next;
      }

      continue;
    }

    // Too small to be worth a province of its own: let the watershed take it, so
    // it does not stay as a hole in the province around it.
    for (const p of members) {
      inBody[p] = 1;
    }
  }

  const areas = new Int32Array(areaList);
  const isLake = new Uint8Array(lakeFlags);

  // --- 5. watershed ------------------------------------------------------
  {
    const queue = new PixelQueue();

    for (let i = 0; i < count; i += 1) {
      if (labels[i] !== 0) {
        queue.push(i);
      }
    }

    while (!queue.empty) {
      const p = queue.shift();
      const label = labels[p];
      const list = fillNeighbours(p);

      for (let k = 0; k < 4; k += 1) {
        const n = list[k];

        if (n < 0 || labels[n] !== 0 || inBody[n] === 0) {
          continue;
        }

        labels[n] = label;
        areas[label] += 1;
        queue.push(n);
      }
    }
  }

  // --- 5b. the coastline outline ----------------------------------------
  let coastInkPixels = 0;

  if (opt.coastGrow > 0) {
    const dist = new Uint8Array(count);
    const queue = new PixelQueue();

    for (let i = 0; i < count; i += 1) {
      if (labels[i] !== 0) {
        queue.push(i);
      }
    }

    while (!queue.empty) {
      const p = queue.shift();
      const d = dist[p];

      if (d >= opt.coastGrow) {
        continue;
      }

      const label = labels[p];
      const list = fillNeighbours(p);

      for (let k = 0; k < 4; k += 1) {
        const n = list[k];

        if (n < 0 || labels[n] !== 0 || lum[n] >= opt.coastInkLum) {
          continue;
        }

        labels[n] = label;
        dist[n] = d + 1;
        areas[label] += 1;
        coastInkPixels += 1;
        queue.push(n);
      }
    }
  }

  let unassignedInsideLand = 0;

  for (let i = 0; i < count; i += 1) {
    if (labels[i] === 0 && inBody[i] === 1) {
      unassignedInsideLand += 1;
    }
  }

  const sorted = Array.from(areas.subarray(1)).sort((a, b) => a - b);

  return {
    labels,
    count: next,
    areas,
    isLake,
    stats: {
      bodies,
      keptBodies,
      edgeBodies,
      landProvinces,
      lakes,
      discardedSpecks,
      riverPixels,
      coastInkPixels,
      unassignedInsideLand,
      largestArea: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
      medianArea: sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)] : 0,
    },
  };
}

export { DEFAULT_OPTIONS, detectProvinces, type DetectOptions, type DetectResult, type DetectStats };
