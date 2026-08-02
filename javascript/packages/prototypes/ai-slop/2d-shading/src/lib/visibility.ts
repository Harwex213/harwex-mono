import type { Point } from "./hull";
import type { Segment } from "./scene";

// Rays are fired at each endpoint plus a hair to either side: the middle ray stops
// at the corner, the two neighbours slip past it and land on whatever is behind.
// Without the pair the polygon has no edges leaving a corner and the light stops
// dead at every wall end.
const EPS = 0.00015;

// A light with no occluder in range still needs a polygon; a coarse circle is
// cheaper than special-casing the caller.
const FALLBACK_RAYS = 32;

type Visibility = {
  points: Point[];
  rays: number;
  tested: number;
};

// Distance² from the light to a segment, for the range cull.
function distanceSq(ox: number, oy: number, s: Segment): number {
  const sx = s.x2 - s.x1;
  const sy = s.y2 - s.y1;
  const len2 = sx * sx + sy * sy;
  let t = 0;
  if (len2 > 0) {
    t = ((ox - s.x1) * sx + (oy - s.y1) * sy) / len2;
    t = Math.max(0, Math.min(1, t));
  }
  const dx = ox - (s.x1 + t * sx);
  const dy = oy - (s.y1 + t * sy);
  return dx * dx + dy * dy;
}

// Ray/segment intersection, returning the ray parameter t (distance, since the
// direction is unit) or null. u is the position along the segment and bounds the
// hit to the segment itself.
function rayHit(ox: number, oy: number, dx: number, dy: number, s: Segment): number | null {
  const sx = s.x2 - s.x1;
  const sy = s.y2 - s.y1;
  const denom = dx * sy - dy * sx;
  if (Math.abs(denom) < 1e-9) {
    return null;
  }
  const ax = s.x1 - ox;
  const ay = s.y1 - oy;
  const t = (ax * sy - ay * sx) / denom;
  const u = (ax * dy - ay * dx) / denom;
  if (t <= 0 || u < 0 || u > 1) {
    return null;
  }
  return t;
}

// The visibility polygon of a point light, as a fan of hit points sorted by angle.
//
// Two culls keep it honest at interactive rates: segments further than the radius
// are dropped, and every ray is clamped to the radius, so the polygon is bounded by
// the light's own falloff instead of by the map border. The cost is O(rays x
// segments) with rays = 3 x endpoints-in-range — which is exactly why the caller
// merges wall faces before calling this.
function visibilityPolygon(ox: number, oy: number, radius: number, segments: Segment[]): Visibility {
  const r2 = radius * radius;
  const near: Segment[] = [];
  for (const s of segments) {
    if (distanceSq(ox, oy, s) <= r2) {
      near.push(s);
    }
  }

  const angles: number[] = [];
  for (const s of near) {
    const ends = [
      { x: s.x1, y: s.y1 },
      { x: s.x2, y: s.y2 },
    ];
    for (const end of ends) {
      const dx = end.x - ox;
      const dy = end.y - oy;
      if (dx * dx + dy * dy > r2) {
        continue;
      }
      const a = Math.atan2(dy, dx);
      angles.push(a - EPS, a, a + EPS);
    }
  }

  if (angles.length === 0) {
    for (let i = 0; i < FALLBACK_RAYS; i += 1) {
      angles.push((i / FALLBACK_RAYS) * Math.PI * 2);
    }
  }

  angles.sort((a, b) => {
    return a - b;
  });

  const points: Point[] = [];
  for (const a of angles) {
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    let best = radius;
    for (const s of near) {
      const t = rayHit(ox, oy, dx, dy, s);
      if (t !== null && t < best) {
        best = t;
      }
    }
    points.push({ x: ox + dx * best, y: oy + dy * best });
  }

  return { points, rays: angles.length, tested: near.length };
}

export { visibilityPolygon };
export type { Visibility };
