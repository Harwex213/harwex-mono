import { convexHull, type Point } from "./hull";
import type { Occluder } from "./scene";

// Top-down foreshortening: a shadow running "down the screen" runs away from the
// camera, so its screen length is shorter than the same shadow cast sideways. One
// constant is enough to read as a camera tilt; the alternative is a real 3D
// projection, which these techniques deliberately do not have.
const Y_SQUASH = 0.62;

function sunDirection(angleDeg: number): Point {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: Math.cos(rad), y: Math.sin(rad) * Y_SQUASH };
}

// The shadow of an axis-aligned box under a directional light: the box's four
// corners plus the same four translated along the light, hulled. Elevation scales
// the offset, so pillars reach further than walls under one sun.
function shadowHull(box: Occluder, dir: Point, length: number): Point[] {
  const dx = dir.x * length * box.elev;
  const dy = dir.y * length * box.elev;
  const pts: Point[] = [];
  const corners: Point[] = [
    { x: box.x, y: box.y },
    { x: box.x + box.w, y: box.y },
    { x: box.x + box.w, y: box.y + box.h },
    { x: box.x, y: box.y + box.h },
  ];
  for (const c of corners) {
    pts.push(c, { x: c.x + dx, y: c.y + dy });
  }
  return convexHull(pts);
}

function flatten(points: Point[]): number[] {
  const flat: number[] = [];
  for (const p of points) {
    flat.push(p.x, p.y);
  }
  return flat;
}

export { flatten, shadowHull, sunDirection };
