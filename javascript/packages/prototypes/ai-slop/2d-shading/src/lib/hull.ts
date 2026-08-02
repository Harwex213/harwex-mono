type Point = { x: number; y: number };

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

// Andrew monotone chain. The shadow of an axis-aligned box under a directional
// light is the hull of 8 points (the box and the box translated by the light
// offset): a hexagon in the general case, a quad when the offset is axis-aligned.
// Building the hull instead of hand-casing those two shapes keeps the caller free
// of the degenerate cases — zero offset collapses to the box itself.
function convexHull(points: Point[]): Point[] {
  const pts = points.slice().sort((a, b) => {
    return a.x - b.x || a.y - b.y;
  });
  if (pts.length < 3) {
    return pts;
  }

  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export { convexHull };
export type { Point };
