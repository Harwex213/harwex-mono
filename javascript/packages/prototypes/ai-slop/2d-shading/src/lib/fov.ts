import { MAP_H, MAP_W } from "./scene";

// Recursive shadowcasting works one 45° wedge at a time; the eight multiplier rows
// map the single octant the algorithm can handle onto the other seven.
const OCTANTS: ReadonlyArray<readonly [number, number, number, number]> = [
  [1, 0, 0, 1],
  [0, 1, 1, 0],
  [0, -1, 1, 0],
  [-1, 0, 0, 1],
  [-1, 0, 0, -1],
  [0, -1, -1, 0],
  [0, 1, -1, 0],
  [1, 0, 0, -1],
];

type Fov = {
  // Per-tile light, 0..1, radial falloff included. Grid-sized, not screen-sized.
  light: Float32Array;
  // Tiles the sweep actually touched — the reason this scales where a per-pixel
  // ray cast does not.
  visited: number;
};

// Per-octant sweep: walk row by row away from the origin, carrying the slope range
// that is still lit. A wall narrows the range — the recursion handles the part of
// the wedge to one side of it while the loop keeps scanning the other.
function computeFov(grid: Uint8Array, cx: number, cy: number, radius: number): Fov {
  const light = new Float32Array(MAP_W * MAP_H);
  let visited = 0;

  const solid = (x: number, y: number): boolean => {
    return grid[y * MAP_W + x] !== 0;
  };

  const cast = (
    row: number,
    startSlope: number,
    endSlope: number,
    xx: number,
    xy: number,
    yx: number,
    yy: number,
  ): void => {
    if (startSlope < endSlope) {
      return;
    }
    let start = startSlope;
    let blocked = false;
    let nextStart = start;

    for (let distance = row; distance <= radius && !blocked; distance += 1) {
      const deltaY = -distance;
      for (let deltaX = -distance; deltaX <= 0; deltaX += 1) {
        const x = cx + deltaX * xx + deltaY * xy;
        const y = cy + deltaX * yx + deltaY * yy;
        const leftSlope = (deltaX - 0.5) / (deltaY + 0.5);
        const rightSlope = (deltaX + 0.5) / (deltaY - 0.5);

        if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H || start < rightSlope) {
          continue;
        }
        if (endSlope > leftSlope) {
          break;
        }

        visited += 1;
        const dist = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        if (dist <= radius) {
          const falloff = 1 - dist / radius;
          const idx = y * MAP_W + x;
          // Octants overlap on the diagonals; keep the brighter value instead of
          // adding, or the diagonals come out as bright seams.
          light[idx] = Math.max(light[idx], falloff * falloff);
        }

        if (blocked) {
          if (solid(x, y)) {
            nextStart = rightSlope;
            continue;
          }
          blocked = false;
          start = nextStart;
        } else if (solid(x, y) && distance < radius) {
          blocked = true;
          cast(distance + 1, start, leftSlope, xx, xy, yx, yy);
          nextStart = rightSlope;
        }
      }
    }
  };

  if (cx >= 0 && cy >= 0 && cx < MAP_W && cy < MAP_H) {
    light[cy * MAP_W + cx] = 1;
    for (const [xx, xy, yx, yy] of OCTANTS) {
      cast(1, 1, 0, xx, xy, yx, yy);
    }
  }

  return { light, visited };
}

export { computeFov };
export type { Fov };
